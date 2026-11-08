// =============================================
// نظام سَكَن | إرسال طلب موافقة ولي الأمر عبر واتساب
// Supabase Edge Function: whatsapp-send   (Verify JWT: مفعّل)
// تستدعيها صفحة الطالبة بعد تقديم "تصريح بموافقة ولي الأمر"،
// وتستدعيها المشرفة لإعادة الإرسال.
// =============================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || SERVICE_KEY;
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN");
const WA_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
const WA_TEMPLATE = Deno.env.get("WHATSAPP_TEMPLATE") || "sakan_guardian_approval";
const WA_LANG = Deno.env.get("WHATSAPP_LANG") || "ar";
const WA_API = Deno.env.get("WHATSAPP_API_BASE") || "https://graph.facebook.com/v21.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function rpc(fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(args)
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error((data && data.message) || `خطأ في قاعدة البيانات (${res.status})`);
  return data;
}

const fmt = value => new Intl.DateTimeFormat("ar-OM-u-nu-latn", {
  weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", timeZone: "Asia/Muscat"
}).format(new Date(value)).replace(/[\u200e\u200f]/g, "");

// قيم القالب لا تقبل أسطراً جديدة أو مسافات متتالية
const clean = value => String(value ?? "—").replace(/\s+/g, " ").trim().slice(0, 200) || "—";

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "طريقة غير مدعومة" }, 405);

  // من يطلب الإرسال؟
  const auth = req.headers.get("Authorization") || "";
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: auth, apikey: ANON_KEY } });
  if (!userRes.ok) return json({ ok: false, error: "سجّلي الدخول أولاً" }, 401);
  const user = await userRes.json();

  let requestId;
  try { requestId = (await req.json()).request_id; } catch { /* body فارغ */ }
  if (!requestId) return json({ ok: false, error: "رقم الطلب مفقود" }, 400);

  let info;
  try {
    info = await rpc("sakan_guardian_prepare", { p_request_id: requestId, p_actor: user.id });
  } catch (e) {
    return json({ ok: false, error: e.message }, 400);
  }

  if (!WA_TOKEN || !WA_PHONE_ID) {
    const error = "واتساب غير مُعدّ في النظام بعد";
    await rpc("sakan_guardian_mark_sent", { p_request_id: requestId, p_message_id: null, p_error: error });
    return json({ ok: false, error });
  }

  const message = {
    messaging_product: "whatsapp",
    to: info.phone,
    type: "template",
    template: {
      name: WA_TEMPLATE,
      language: { code: WA_LANG },
      components: [
        {
          type: "body",
          parameters: [
            info.guardian_name, info.student_name, info.companion_name, info.companion_relation,
            fmt(info.start_at), fmt(info.end_at), info.destination
          ].map(v => ({ type: "text", text: clean(v) }))
        },
        { type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: `sakan|${info.token}|yes` }] },
        { type: "button", sub_type: "quick_reply", index: "1", parameters: [{ type: "payload", payload: `sakan|${info.token}|no` }] }
      ]
    }
  };

  let messageId = null, error = null;
  try {
    const res = await fetch(`${WA_API}/${WA_PHONE_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(message)
    });
    const data = await res.json().catch(() => ({}));
    messageId = data?.messages?.[0]?.id || null;
    if (!res.ok || !messageId) error = data?.error?.message || `تعذّر الإرسال (${res.status})`;
  } catch (e) {
    error = "تعذّر الاتصال بخدمة واتساب";
  }

  await rpc("sakan_guardian_mark_sent", { p_request_id: requestId, p_message_id: messageId, p_error: error });
  return json(error ? { ok: false, error } : { ok: true, message_id: messageId });
});
