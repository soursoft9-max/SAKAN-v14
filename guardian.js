// =============================================
// نظام سَكَن | صفحة موافقة ولي الأمر (بدون تسجيل دخول)
// guardian.html?t=<رمز سري تُرسله المشرفة على واتساب>
// =============================================
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const supabase = createClient(
  "https://qvctiztgjcjtpaezfrck.supabase.co",
  "sb_publishable_r-C9NyoZgnf5wCqlaMBwEg_TWokuxL4",
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const $ = s => document.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const when = v => v ? new Intl.DateTimeFormat("ar-OM", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }).format(new Date(v)) : "—";
const token = new URLSearchParams(location.search).get("t") || "";
const box = $("#g-box");

function done(answer, again = false) {
  const ok = answer === "approved";
  box.innerHTML = `
    <div class="g-result ${ok ? "good" : "bad"}">
      <b>${ok ? "سُجّلت موافقتك" : "سُجّل عدم موافقتك"}</b>
      <p>${again ? "سبق تسجيل ردك على هذا الطلب." : "شكراً لك. وصل ردك لمشرفة السكن."}</p>
    </div>`;
}

async function load() {
  if (!/^[0-9a-f]{16,64}$/.test(token)) {
    box.innerHTML = `<p class="g-msg">الرابط غير صحيح. تأكد من فتح الرابط كاملاً كما وصلك على واتساب.</p>`;
    return;
  }
  const { data, error } = await supabase.rpc("sakan_guardian_web_view", { p_token: token });
  if (error || !data?.ok) {
    box.innerHTML = `<p class="g-msg">${error ? "تعذّر الاتصال. تحقق من الإنترنت وأعد فتح الرابط." : "الرابط غير صحيح أو انتهت صلاحيته."}</p>`;
    return;
  }
  if (data.state === "approved" || data.state === "rejected") return done(data.state, true);
  if (data.state !== "pending") {
    box.innerHTML = `<p class="g-msg">هذا الطلب لم يعد بانتظار ردك.</p>`;
    return;
  }

  box.innerHTML = `
    <p class="g-hello">السلام عليكم ${esc(data.guardian_name)}،</p>
    <p>تطلب الطالبة <b>${esc(data.student_name)}</b> الخروج من ${esc(data.dormitory || "السكن")} مع:</p>
    <div class="g-who"><b>${esc(data.companion_name)}</b><span>${esc(data.companion_relation || "مرافق")}</span></div>
    <dl class="g-kv">
      <dt>الخروج</dt><dd>${esc(when(data.start_at))}</dd>
      <dt>العودة</dt><dd>${esc(when(data.end_at))}</dd>
      <dt>الوجهة</dt><dd>${esc(data.destination || "—")}</dd>
    </dl>
    <p class="g-q">هل توافق على خروجها مع هذا الشخص؟</p>
    <div class="g-actions">
      <button type="button" class="g-btn good" data-a="approved">موافق</button>
      <button type="button" class="g-btn bad" data-a="rejected">غير موافق</button>
    </div>
    <p class="g-msg" id="g-err" hidden></p>`;

  box.querySelectorAll("[data-a]").forEach(b => b.addEventListener("click", async () => {
    const answer = b.dataset.a;
    if (!confirm(answer === "approved" ? "تأكيد الموافقة على الخروج؟" : "تأكيد عدم الموافقة؟")) return;
    box.querySelectorAll("[data-a]").forEach(x => { x.disabled = true; });
    const { data: res, error: err } = await supabase.rpc("sakan_guardian_web_reply", { p_token: token, p_answer: answer });
    if (err) {
      $("#g-err").hidden = false;
      $("#g-err").textContent = "تعذّر تسجيل الرد. تحقق من الإنترنت وحاول مرة أخرى.";
      box.querySelectorAll("[data-a]").forEach(x => { x.disabled = false; });
      return;
    }
    if (res?.ok) return done(answer);
    load();   // سبق الرد أو أُغلق الطلب
  }));
}

load();
