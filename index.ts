// =============================================
// نظام سَكَن | استقبال رد ولي الأمر من واتساب
// Supabase Edge Function: whatsapp-webhook   (Verify JWT: مُعطّل، لأن واتساب يستدعيها مباشرة)
// رابطها يوضع في إعدادات Webhook لتطبيق Meta، مع اشتراك "messages".
// =============================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN");
const APP_SECRET = Deno.env.get("WHATSAPP_APP_SECRET");
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN");
const WA_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
const WA_API = Deno.env.get("WHATSAPP_API_BASE") || "https://graph.facebook.com/v21.0";

async function rpc(fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(args)
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.message) || `خطأ في قاعدة البيانات (${res.status})`);
  return data;
}

async function validSignature(raw, header) {
  if (!APP_SECRET) return true;
  if (!header || !header.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(APP_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const hex = [...sig].map(b => b.toString(16).padStart(2, "0")).join("");
  const given = header.slice(7);
  if (given.length !== hex.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

// تفسير رد مكتوب: "غير موافق" يُفحص قبل "موافق"
function answerFromText(text) {
  const t = String(text || "")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/\s+/g, " ").trim().toLowerCase();
  // نهاية الكلمة: مسافة أو علامة ترقيم أو نهاية النص (\b لا يعمل مع الحروف العربية)
  const end = "(?=$|[\\s.!،,؟?])";
  if (new RegExp(`^(غير موافق|لا اوافق|مو موافق|مرفوض|ارفض|رفض|لا|no)${end}`).test(t)) return "rejected";
  if (new RegExp(`^(موافق|اوافق|نعم|اي|ايوه|تمام|yes|ok)${end}`).test(t)) return "approved";
  return null;
}

async function replyToGuardian(to, text) {
  if (!WA_TOKEN || !WA_PHONE_ID) return;
  try {
    await fetch(`${WA_API}/${WA_PHONE_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } })
    });
  } catch { /* تأكيد اختياري */ }
}

async function handleMessage(m) {
  const from = m.from;
  const payload = m.button?.payload || m.interactive?.button_reply?.id || "";
  const shownText = m.button?.text || m.interactive?.button_reply?.title || m.text?.body || "";
  let result = null, answer = null;

  if (payload.startsWith("sakan|")) {
    const [, token, choice] = payload.split("|");
    answer = choice === "yes" ? "approved" : "rejected";
    result = await rpc("sakan_guardian_reply", { p_token: token, p_answer: answer, p_from: from, p_text: shownText });
  } else if (m.type === "text") {
    answer = answerFromText(m.text?.body);
    if (!answer) return;
    result = await rpc("sakan_guardian_reply_by_phone", { p_from: from, p_answer: answer, p_text: shownText });
  } else {
    return;
  }

  if (result?.ok) {
    await replyToGuardian(from, answer === "approved"
      ? `شكراً لك. سُجّلت موافقتك على خروج ${result.student_name}، وأُبلغت مشرفة السكن.`
      : `شكراً لك. سُجّل عدم موافقتك على خروج ${result.student_name}، وأُبلغت مشرفة السكن.`);
  } else if (result?.code === "closed") {
    await replyToGuardian(from, "تم تسجيل ردك على هذا الطلب مسبقاً.");
  }
}

Deno.serve(async req => {
  const url = new URL(req.url);

  // تحقق Meta من الرابط عند ربط الـ Webhook
  if (req.method === "GET") {
    if (url.searchParams.get("hub.mode") === "subscribe" && VERIFY_TOKEN &&
        url.searchParams.get("hub.verify_token") === VERIFY_TOKEN) {
      return new Response(url.searchParams.get("hub.challenge") || "", { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const raw = await req.text();
  if (!(await validSignature(raw, req.headers.get("x-hub-signature-256")))) {
    return new Response("invalid signature", { status: 401 });
  }

  let body;
  try { body = JSON.parse(raw); } catch { return new Response("ok", { status: 200 }); }

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      for (const st of value.statuses || []) {
        if (st.status === "failed") {
          try { await rpc("sakan_guardian_mark_failed", { p_message_id: st.id, p_error: st.errors?.[0]?.title || "لم تُسلَّم الرسالة" }); }
          catch (e) { console.error(e.message); }
        }
      }
      for (const m of value.messages || []) {
        try { await handleMessage(m); } catch (e) { console.error(e.message); }
      }
    }
  }
  // واتساب يعيد المحاولة إن لم يستلم 200
  return new Response("ok", { status: 200 });
});
