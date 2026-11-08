// =============================================
// نظام سَكَن | أدوات العرض المشتركة
// تستخدمها main.js و sakan-features.js
// =============================================

export const TZ = "Asia/Muscat";

/* اسم الدخول يحدد نوع الحساب (مطابق للدوال sakan_username_role و sakan_login_email في قاعدة البيانات)
   الطالبة: الرقم الجامعي        2024101           -> s2024101@sakan.local
   العاملون: الدور@الاسم         supervisor@mariam -> supervisor.mariam@sakan.local */
export const ROLE_LABELS = { student: "طالبة", supervisor: "مشرفة", security: "أمن", admin: "إدارة" };
export const ROLE_LOGIN_PAGES = { student: "login.html", supervisor: "supervisor-login.html", security: "security-login.html", admin: "admin-login.html" };

export function normalizeUsername(value = "") {
  return String(value)
    .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/\s+/g, "")
    .toLowerCase();
}

export function usernameRole(value) {
  const u = normalizeUsername(value);
  if (/^[0-9]{3,20}$/.test(u)) return "student";
  const m = u.match(/^(supervisor|security|admin)@[a-z0-9][a-z0-9._-]{1,39}$/);
  return m ? m[1] : null;
}

export function loginEmail(value) {
  const u = normalizeUsername(value), role = usernameRole(u);
  if (!role) return null;
  return role === "student" ? `s${u}@sakan.local` : `${u.replace("@", ".")}@sakan.local`;
}

export const esc = (value = "") =>
  String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[c]);

export const fmtDateTime = value => value
  ? new Intl.DateTimeFormat("ar-OM-u-nu-latn", { dateStyle: "medium", timeStyle: "short", timeZone: TZ }).format(new Date(value))
  : "—";

export const fmtTime = value => value
  ? new Intl.DateTimeFormat("ar-OM-u-nu-latn", { hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(new Date(value))
  : "—";

export const fmtDay = day => day
  ? new Intl.DateTimeFormat("ar-OM-u-nu-latn", { weekday: "long", day: "numeric", month: "long", timeZone: TZ }).format(new Date(day + "T12:00:00Z"))
  : "—";

export const todayStr = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });

export const TYPE_LABELS = {
  exit_permit: "استئذان خروج",
  guardian_exit: "خروج بموافقة ولي الأمر",
  hosting: "استضافة",
  dorm_transfer: "نقل بين السكنات",
  room_change: "تغيير الغرفة"
};

export const STATUS_LABELS = {
  pending_guardian: ["بانتظار رد ولي الأمر", "warn"],
  pending_supervisor: ["بانتظار المشرفة", "warn"],
  pending_admin: ["بانتظار الإدارة", "warn"],
  approved: ["معتمد", "info"],
  rejected: ["مرفوض", "bad"],
  cancelled: ["ملغي", "muted"],
  completed: ["مكتمل", "good"]
};

export const SECURITY_LABELS = {
  not_received: "لم تُستلم البطاقة",
  received: "استُلمت البطاقة",
  verified: "تم التحقق من البطاقة",
  mismatch: "اختلاف في البيانات"
};

export const GUARDIAN_LABELS = {
  pending: ["لم تُرسل لولي الأمر بعد", "muted"],
  sent: ["أُرسلت لولي الأمر على واتساب", "info"],
  approved: ["ولي الأمر موافق", "good"],
  rejected: ["ولي الأمر غير موافق", "bad"],
  failed: ["تعذّر إرسال واتساب", "bad"]
};

export const isExitType = t => t === "exit_permit" || t === "guardian_exit";

export function guardianPill(req) {
  if (req.request_type !== "guardian_exit" || !req.guardian_status) return "";
  const [text, tone] = GUARDIAN_LABELS[req.guardian_status] || [req.guardian_status, "muted"];
  return pill(text, tone);
}

export function pill(text, tone = "muted") {
  return `<span class="sk-pill sk-${tone}">${esc(text)}</span>`;
}

export function statusPill(status) {
  const [text, tone] = STATUS_LABELS[status] || [status, "muted"];
  return pill(text, tone);
}

/** حالة البوابة لطلب الاستئذان أو الاستضافة */
export function gatePill(req) {
  if (isExitType(req.request_type)) {
    if (req.gate_in_at) return pill("عادت إلى السكن", "good");
    if (req.gate_out_at) {
      const late = req.end_at && new Date(req.end_at) < new Date();
      return pill(late ? "خارج السكن — متأخرة" : "خارج السكن", late ? "bad" : "info");
    }
  }
  if (req.request_type === "hosting") {
    if (req.gate_out_at) return pill("غادرت الضيفة", "good");
    if (req.gate_in_at) return pill("الضيفة داخل السكن", "info");
  }
  return "";
}

/** مراحل الطلب كشريط خطوات */
export function stepsTrack(req) {
  const t = req.request_type;
  const steps = t === "guardian_exit"
    ? ["التقديم", "ولي الأمر", "المشرفة", "الأمن: البطاقة", "الخروج", "العودة"]
    : t === "exit_permit"
    ? ["التقديم", "المشرفة", "الأمن: البطاقة", "الخروج", "العودة"]
    : t === "hosting"
      ? ["التقديم", "المشرفة", "دخول الضيفة", "المغادرة"]
      : t === "dorm_transfer"
        ? ["التقديم", "المشرفة", "الإدارة", "تنفيذ النقل"]
        : ["التقديم", "المشرفة", "تنفيذ النقل"];

  let done = 1;
  if (t === "guardian_exit") {
    if (["approved", "rejected"].includes(req.guardian_status)) done = 2;
    if (req.status === "approved" || req.status === "completed") done = 3;
    if (req.security_status === "verified") done = 4;
    if (req.gate_out_at) done = 5;
    if (req.gate_in_at) done = 6;
  } else if (t === "exit_permit") {
    if (req.status === "approved" || req.status === "completed") done = 2;
    if (req.security_status === "verified") done = 3;
    if (req.gate_out_at) done = 4;
    if (req.gate_in_at) done = 5;
  } else if (t === "hosting") {
    if (req.status === "approved" || req.status === "completed") done = 2;
    if (req.gate_in_at) done = 3;
    if (req.gate_out_at) done = 4;
  } else {
    if (req.status === "pending_admin") done = 2;
    if (req.status === "completed") done = steps.length;
  }
  const rejected = req.status === "rejected";

  return `<ol class="sk-steps">${steps.map((s, i) => {
    const cls = i < done ? "done" : (rejected && i === done ? "bad" : (!rejected && i === done ? "now" : ""));
    return `<li class="${cls}">${esc(rejected && i === done ? "رُفض" : s)}</li>`;
  }).join("")}</ol>`;
}

/** تحميل أسماء السكنات والغرف لعرض طلبات النقل */
export async function loadPlaces(supabase) {
  const [d, r] = await Promise.all([
    supabase.from("dormitories").select("id, name"),
    supabase.from("rooms").select("id, room_number, dormitory_id")
  ]);
  return {
    dorms: new Map((d.data || []).map(x => [x.id, x.name])),
    rooms: new Map((r.data || []).map(x => [x.id, x.room_number]))
  };
}

const placeText = (places, dormId, roomId) => {
  const dorm = places?.dorms.get(dormId) || "—";
  const room = roomId ? places?.rooms.get(roomId) : null;
  return room ? `${dorm} · غرفة ${room}` : dorm;
};

/** تفاصيل الطلب حسب نوعه */
export function requestDetailsHTML(req, places) {
  const d = req.details || {};
  const rows = [];
  const row = (label, value) => rows.push(`<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`);

  if (req.student) {
    row("الطالبة", `${esc(req.student.full_name || "—")} <span class="sk-num">${esc(req.student.student_number || "")}</span>`);
  }
  if (req.source_dormitory_id && places) row("السكن الحالي", esc(placeText(places, req.source_dormitory_id, req.source_room_id)));

  if (req.request_type === "guardian_exit") {
    const c = d.companion || {};
    row("المرافق", `${esc(c.full_name || "—")}${c.relationship ? ` (${esc(c.relationship)})` : ""}`);
    if (c.phone) row("هاتف المرافق", `<span class="sk-num">${esc(c.phone)}</span>`);
    if (c.civil_id) row("الرقم المدني للمرافق", `<span class="sk-num">${esc(c.civil_id)}</span>`);
    row("موافقة ولي الأمر", guardianPill(req) || "—");
    if (req.guardian_phone) row("رقم ولي الأمر", `<span class="sk-num">+${esc(req.guardian_phone)}</span>`);
    if (req.guardian_reply) row("رد ولي الأمر", `${esc(req.guardian_reply)}${req.guardian_channel === "manual" ? " (سُجّل يدوياً)" : ""} · ${esc(fmtDateTime(req.guardian_replied_at))}`);
    if (req.guardian_status === "failed" && req.guardian_error) row("سبب تعذّر الإرسال", esc(req.guardian_error));
  }

  if (isExitType(req.request_type)) {
    row("الخروج", esc(fmtDateTime(req.start_at)));
    row("العودة المتوقعة", esc(fmtDateTime(req.end_at)));
    if (d.destination) row("الوجهة", esc(d.destination));
    const sc = d.student_card || {}, gc = d.guardian_card || {};
    row("بطاقة الطالبة", `${esc(sc.full_name || "—")} · <span class="sk-num">${esc(sc.id_number || "—")}</span>`);
    row("بطاقة ولي الأمر", `${esc(gc.full_name || "—")} · <span class="sk-num">${esc(gc.id_number || "—")}</span>`);
    if (req.security_status) row("حالة البطاقة لدى الأمن", esc(SECURITY_LABELS[req.security_status] || req.security_status));
    if (req.gate_out_at) row("خرجت", esc(fmtDateTime(req.gate_out_at)));
    if (req.gate_in_at) row("عادت", esc(fmtDateTime(req.gate_in_at)));
  }

  if (req.request_type === "hosting") {
    const g = d.guest || {};
    row("الضيفة", `${esc(g.full_name || "—")}${g.relationship ? ` (${esc(g.relationship)})` : ""}`);
    row("الرقم المدني للضيفة", `<span class="sk-num">${esc(g.civil_id || "—")}</span>`);
    if (g.phone) row("هاتف الضيفة", `<span class="sk-num">${esc(g.phone)}</span>`);
    row("موعد الزيارة", `${esc(fmtDateTime(req.start_at))} ← ${esc(fmtTime(req.end_at))}`);
    if (req.gate_in_at) row("دخلت", esc(fmtDateTime(req.gate_in_at)));
    if (req.gate_out_at) row("غادرت", esc(fmtDateTime(req.gate_out_at)));
  }

  if (req.request_type === "dorm_transfer" || req.request_type === "room_change") {
    row("المطلوب", esc(placeText(places, req.destination_dormitory_id, req.destination_room_id)));
  }

  if (d.description) row("التفاصيل", esc(d.description));
  if (req.decision_note) row("ملاحظة القرار", esc(req.decision_note));
  row("تاريخ التقديم", esc(fmtDateTime(req.created_at)));
  return `<dl class="sk-kv">${rows.join("")}</dl>`;
}

/** صور البطاقات المرفوعة (تُحمّل بروابط مؤقتة) */
export function cardImagesHTML(req) {
  const d = req.details || {};
  const s = d.student_card?.image_path, g = d.guardian_card?.image_path;
  if (!s && !g) return "";
  const fig = (path, cap) => path
    ? `<figure><a data-card-link><img alt="${esc(cap)}" data-card-path="${esc(path)}"></a><figcaption>${esc(cap)}</figcaption></figure>`
    : "";
  return `<div class="sk-cards">${fig(s, "بطاقة الطالبة")}${fig(g, "بطاقة ولي الأمر")}</div>`;
}

export async function hydrateCardImages(supabase, root = document) {
  const imgs = [...root.querySelectorAll("img[data-card-path]:not([src])")];
  if (!imgs.length) return;
  const paths = [...new Set(imgs.map(i => i.dataset.cardPath))];
  const { data } = await supabase.storage.from("id-cards").createSignedUrls(paths, 900);
  const urls = new Map((data || []).map(x => [x.path, x.signedUrl]));
  imgs.forEach(img => {
    const url = urls.get(img.dataset.cardPath);
    if (!url) { img.closest("figure")?.classList.add("sk-missing"); return; }
    img.src = url;
    const a = img.closest("a[data-card-link]");
    if (a) { a.href = url; a.target = "_blank"; a.rel = "noopener"; }
  });
}

/** ضغط الصورة قبل الرفع */
export async function compressImage(file, max = 1600, quality = 0.82) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return await new Promise(res => c.toBlob(res, "image/jpeg", quality));
}

export function setMsg(el, text, type = "info") {
  if (!el) return;
  el.textContent = text;
  el.dataset.type = type;
}

/* ---------- رسالة خطأ واضحة بدل "تعذّر الإرسال" ---------- */
// تعرض سبب الخطأ الحقيقي بالعربية، وتضيف النص التقني بين قوسين للتشخيص
export function friendlyError(e, fallback = "تعذّر تنفيذ العملية. حاولي مرة أخرى.") {
  const m = String(e?.message || e?.error_description || e?.error || e || "");
  if (/[؀-ۿ]/.test(m)) return m;
  const code = e?.code || "";
  const tech = m ? ` (السبب: ${m.slice(0, 160)})` : "";
  if (code === "PGRST202" || code === "42703" || code === "42883" || code === "42P01" || code === "23514"
      || /schema cache|does not exist|violates check constraint/i.test(m)) {
    return "قاعدة البيانات تحتاج تحديثاً لهذه الخدمة. يجب على الإدارة تشغيل ملف database/01-upgrade.sql في Supabase." + tech;
  }
  if (code === "23505") return "القيمة مستخدمة مسبقاً لسجل آخر." + tech;
  if (code === "42501" || /row-level security|permission denied/i.test(m)) return "ليست لديك صلاحية لهذا الإجراء." + tech;
  if (/bucket not found/i.test(m)) return "مخزن صور البطاقات (id-cards) غير موجود في Supabase. يجب على الإدارة تشغيل ملف قاعدة البيانات." + tech;
  if (/payload too large|exceeded the maximum allowed size/i.test(m)) return "حجم الصورة كبير جداً. صوّري البطاقة مرة أخرى بدقة أقل." + tech;
  if (/jwt expired|invalid jwt|refresh token/i.test(m)) return "انتهت جلسة الدخول. سجّلي الدخول مرة أخرى.";
  if (/failed to fetch|networkerror|load failed/i.test(m)) return "تعذّر الاتصال بالخادم. تحققي من الإنترنت وحاولي مرة أخرى.";
  return fallback + tech;
}

/* ---------- رابط موافقة ولي الأمر عبر واتساب (بدون Meta) ---------- */
// المشرفة تضغط الزر ← يُنشأ رابط سري ← يُفتح واتساب برسالة جاهزة لرقم ولي الأمر
export const isLocalSite = () => location.protocol === "file:" || /^(localhost|127\.|0\.0\.0\.0|192\.168\.|10\.)/.test(location.hostname);

export async function sendGuardianLink(supabase, requestId) {
  const win = window.open("", "_blank");          // يُفتح قبل الانتظار حتى لا يمنعه المتصفح
  try {
    const { data, error } = await supabase.rpc("sakan_guardian_link", { p_request_id: requestId });
    if (error) throw error;
    const link = new URL(`guardian.html?t=${data.token}`, location.href).href;
    const when = v => v ? new Intl.DateTimeFormat("ar-OM", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }).format(new Date(v)) : "—";
    const text = [
      `السلام عليكم ${data.guardian_name}،`,
      `تطلب الطالبة ${data.student_name} الخروج من السكن مع ${data.companion_name} (${data.companion_relation}).`,
      `من: ${when(data.start_at)}`,
      `إلى: ${when(data.end_at)}`,
      `الوجهة: ${data.destination}`,
      "",
      "للموافقة أو الرفض اضغط على الرابط:",
      link,
      "",
      "إدارة سكن الطالبات"
    ].join("\n");
    const url = `https://wa.me/${data.phone}?text=${encodeURIComponent(text)}`;
    if (win && !win.closed) win.location.href = url; else location.href = url;
    return { phone: data.phone, link, local: isLocalSite() };
  } catch (err) {
    if (win && !win.closed) win.close();
    throw err;
  }
}
