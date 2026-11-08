// =============================================
// نظام سَكَن | صفحات الجوال
// الطالبة: m-student.html (الرئيسية) و m-attendance / m-exit / m-guardian-exit / m-hosting / m-room / m-dorm / m-notifications
// m-supervisor.html · m-security.html · m-admin.html
// نموذج التصريح في صفحة الطالبة يعمل من main.js (نفس كود الكمبيوتر وقراءة البطاقة)
// =============================================

import { supabase } from "./main.js";
import {
  esc, fmtDateTime, fmtTime, fmtDay, todayStr, TYPE_LABELS, pill, statusPill, gatePill, guardianPill,
  stepsTrack, loadPlaces, requestDetailsHTML, cardImagesHTML, hydrateCardImages, isExitType, ROLE_LABELS, friendlyError, sendGuardianLink
} from "./sakan-shared.js";

const $ = (s, p = document) => p.querySelector(s);
const $$ = (s, p = document) => [...p.querySelectorAll(s)];
const ROLE = document.body.dataset.mrole;
const MOBILE_PAGES = { student: "m-student.html", supervisor: "m-supervisor.html", security: "m-security.html", admin: "m-admin.html" };
const LOGIN_PAGES = { student: "login.html", supervisor: "supervisor-login.html", security: "security-login.html", admin: "admin-login.html" };

const errText = e => friendlyError(e);

/* ---------- رسالة عائمة ---------- */
function toast(text, type = "info") {
  const t = $("#m-toast");
  t.textContent = text;
  t.dataset.type = type;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 3800);
}

/* ---------- الجلسة ---------- */
async function mSession() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { location.href = LOGIN_PAGES[ROLE]; return null; }
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!profile || !profile.is_active) { await supabase.auth.signOut(); location.href = LOGIN_PAGES[ROLE]; return null; }
  if (profile.role !== ROLE) { location.href = MOBILE_PAGES[profile.role]; return null; }
  $("#m-who").textContent = profile.full_name;
  return { user, profile };
}

/* ---------- التبويبات ---------- */
function setupTabs(loaders) {
  const show = view => {
    if (!$(`[data-view="${view}"]`)) view = $$("[data-view]")[0].dataset.view;
    $$("[data-view]").forEach(v => { v.hidden = v.dataset.view !== view; });
    $$(".m-tabs [data-tab]").forEach(b => b.setAttribute("aria-current", b.dataset.tab === view ? "page" : "false"));
    $("#m-title").textContent = $(`.m-tabs [data-tab="${view}"] span`)?.textContent || "";
    window.scrollTo(0, 0);
    try { history.replaceState(null, "", "#" + view); } catch { /* */ }
    loaders[view]?.();
  };
  $$(".m-tabs [data-tab]").forEach(b => b.addEventListener("click", () => show(b.dataset.tab)));
  $$("[data-go]").forEach(b => b.addEventListener("click", () => show(b.dataset.go)));
  $("#m-refresh")?.addEventListener("click", () => show(location.hash.slice(1)));
  show(location.hash.slice(1));
  return show;
}

function badge(tab, n) {
  const b = $(`.m-tabs [data-tab="${tab}"] .m-badge`);
  if (!b) return;
  b.textContent = n > 99 ? "99+" : String(n);
  b.hidden = !n;
}

/* ---------- بطاقة طلب ---------- */
function requestCard(r, places, actions = "") {
  return `
    <article class="m-card" data-id="${esc(r.id)}">
      <div class="m-card-head">
        <h3>${esc(r.student?.full_name || TYPE_LABELS[r.request_type] || r.request_type)}</h3>
        <span class="m-sub">${esc(r.student ? (TYPE_LABELS[r.request_type] || "") : fmtDateTime(r.created_at))}</span>
      </div>
      <div class="sk-row">${statusPill(r.status)}${guardianPill(r)}${gatePill(r)}</div>
      ${stepsTrack(r)}
      <details class="m-more"><summary>التفاصيل</summary>${requestDetailsHTML(r, places)}${cardImagesHTML(r)}</details>
      ${actions}
    </article>`;
}

const empty = text => `<p class="m-empty">${esc(text)}</p>`;

async function loadNotifications(userId, el) {
  const { data } = await supabase.from("notifications").select("*").eq("user_id", userId)
    .order("created_at", { ascending: false }).limit(40);
  el.innerHTML = data?.length ? data.map(n => `
    <article class="m-card ${n.is_read ? "" : "m-unread"}">
      <div class="m-card-head"><h3>${esc(n.title)}</h3><span class="m-sub">${esc(fmtDateTime(n.created_at))}</span></div>
      <p class="m-text">${esc(n.message)}</p>
    </article>`).join("") : empty("لا توجد إشعارات.");
  const unread = (data || []).filter(n => !n.is_read).map(n => n.id);
  if (unread.length) await supabase.from("notifications").update({ is_read: true }).in("id", unread);
  badge("notifs", 0);
}

async function countUnread(userId) {
  const { count } = await supabase.from("notifications").select("id", { count: "exact", head: true })
    .eq("user_id", userId).eq("is_read", false);
  badge("notifs", count || 0);
}

/* =============================================
   الطالبة: كل خدمة في صفحة مستقلة (data-mpage)
   ============================================= */
async function studentApp(s) {
  const me = s.profile;
  const PAGE = document.body.dataset.mpage || "home";
  let places = null;
  const getPlaces = async () => (places ||= await loadPlaces(supabase));

  async function myList(types, el) {
    await getPlaces();
    const { data } = await supabase.from("service_requests").select("*").eq("student_id", me.id)
      .in("request_type", types).order("created_at", { ascending: false });
    el.innerHTML = data?.length ? data.map(r => requestCard(r, places)).join("") : empty("لا توجد طلبات حتى الآن.");
    hydrateCardImages(supabase, el);
  }

  // بطاقة حضور اليوم (الرئيسية مختصرة، وصفحة الحضور فيها زر التسجيل)
  async function attendanceHero(full) {
    const { data: att } = await supabase.from("attendance").select("*")
      .eq("student_id", me.id).eq("attendance_date", todayStr()).maybeSingle();
    const state = !att ? "لم تسجّلي حضورك اليوم" : att.fingerprint_at ? "الحضور مكتمل" : "سُجّل الحضور، توجّهي لجهاز البصمة";
    $("#m-att").innerHTML = `
      <div class="m-day">${esc(fmtDay(todayStr()))}</div>
      <div class="m-state">${esc(state)}</div>
      <div class="m-steps2">
        <span class="${att ? "done" : ""}">1 · التسجيل ${att ? esc(fmtTime(att.registered_at)) : ""}</span>
        <span class="${att?.fingerprint_at ? "done" : ""}">2 · البصمة ${att?.fingerprint_at ? esc(fmtTime(att.fingerprint_at)) : ""}</span>
      </div>
      ${full && !att ? `<button class="m-btn gold m-wide" id="m-att-btn">تسجيل الحضور الآن</button>` : ""}
      ${full ? (!me.fingerprint_id ? `<p class="m-note">لم تُسجّل الإدارة رقم بصمتك بعد. راجعي الإدارة.</p>`
        : `<p class="m-note">رقمك في جهاز البصمة: <b class="sk-num">${esc(me.fingerprint_id)}</b></p>`) : ""}`;
    $("#m-att-btn")?.addEventListener("click", async e => {
      e.target.disabled = true;
      const { error } = await supabase.rpc("sakan_register_attendance");
      if (error) { toast(errText(error), "error"); e.target.disabled = false; return; }
      toast("سُجّل حضورك. توجّهي الآن لجهاز البصمة.", "success");
      pages.attendance();
    });
  }

  const pages = {
    async home() {
      await getPlaces();
      $("#m-home-place").textContent = `${places.dorms.get(me.dormitory_id) || "لم يُحدد السكن"}${me.room_id ? " · غرفة " + (places.rooms.get(me.room_id) || "") : ""}`;
      attendanceHero(false);
      const { data: reqs } = await supabase.from("service_requests").select("*").eq("student_id", me.id)
        .order("created_at", { ascending: false }).limit(3);
      $("#m-home-latest").innerHTML = reqs?.length ? reqs.map(r => requestCard(r, places)).join("") : empty("لا توجد طلبات بعد.");
      hydrateCardImages(supabase, $("#m-home-latest"));
    },

    async attendance() {
      attendanceHero(true);
      const { data } = await supabase.from("attendance").select("*").eq("student_id", me.id)
        .order("attendance_date", { ascending: false }).limit(14);
      $("#m-att-history").innerHTML = data?.length ? data.map(a => `
        <div class="m-row"><div><b>${esc(fmtDay(a.attendance_date))}</b>
          <span class="m-sub">تسجيل ${esc(fmtTime(a.registered_at))}${a.fingerprint_at ? " · بصمة " + esc(fmtTime(a.fingerprint_at)) : ""}</span></div>
          ${a.fingerprint_at ? pill("حاضرة", "good") : pill("بلا بصمة", "warn")}</div>`).join("")
        : empty("لا يوجد سجل حضور بعد.");
    },

    // نموذج التصريح وقائمته يديرهما main.js (نفس كود الكمبيوتر وقراءة البطاقة)
    exit() {},
    guardian() {
      const phone = me.guardian_phone;
      const el = $("#m-gphone");
      if (phone) {
        el.innerHTML = `تصل الرسالة لولي أمرك${me.guardian_name ? " " + esc(me.guardian_name) : ""} على الرقم <b class="sk-num" dir="ltr">${esc(phone)}</b>. إذا كان الرقم خطأ راجعي الإدارة.`;
      } else {
        el.classList.add("m-warn");
        el.textContent = "لا يوجد رقم ولي أمر مسجّل في ملفك، فلا يمكن إرسال هذا الطلب. راجعي الإدارة لإضافته.";
        const btn = $("#submit-request-button");
        if (btn) btn.disabled = true;
      }
    },

    hosting: () => myList(["hosting"], $("#mh-list")),
    room: () => transferPage("room_change"),
    dorm: () => transferPage("dorm_transfer"),
    notifs: () => loadNotifications(me.id, $("#m-notifs"))
  };

  // الاستضافة
  $("#mh-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const v = id => $("#" + id).value.trim();
    const start = new Date(`${v("mh-date")}T${v("mh-from")}`), end = new Date(`${v("mh-date")}T${v("mh-to")}`);
    if (!(end > start)) return toast("وقت انتهاء الزيارة يجب أن يكون بعد بدايتها.", "error");
    const btn = e.target.querySelector("[type=submit]"); btn.disabled = true;
    const { error } = await supabase.from("service_requests").insert({
      student_id: me.id, request_type: "hosting", status: "pending_supervisor",
      start_at: start.toISOString(), end_at: end.toISOString(),
      details: { description: v("mh-note"), guest: { full_name: v("mh-name"), relationship: v("mh-rel"), civil_id: v("mh-civil"), phone: v("mh-phone") } }
    });
    btn.disabled = false;
    if (error) return toast(errText(error), "error");
    toast("أُرسل طلب الاستضافة إلى المشرفة.", "success");
    e.target.reset(); $("#mh-date").value = todayStr();
    myList(["hosting"], $("#mh-list"));
  });
  if ($("#mh-date")) $("#mh-date").value = todayStr();

  // تغيير الغرفة / النقل بين السكنات
  let rooms = [];
  async function transferPage(type) {
    await getPlaces();
    $("#mt-current").textContent = `مكانك الحالي: ${places.dorms.get(me.dormitory_id) || "لم يُحدد"}${me.room_id ? " · غرفة " + (places.rooms.get(me.room_id) || "") : ""}`;
    const { data } = await supabase.rpc("sakan_room_availability");
    rooms = data || [];
    if (type === "dorm_transfer") {
      const dorms = [...new Map(rooms.map(r => [r.dormitory_id, r.dormitory_name]))].filter(([id]) => id !== me.dormitory_id);
      $("#mt-dorm").innerHTML = dorms.map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join("") || `<option value="">لا توجد سكنات أخرى</option>`;
    }
    fillRooms(type);
    myList([type], $("#mt-list"));
  }
  function fillRooms(type) {
    const dormId = type === "room_change" ? me.dormitory_id : $("#mt-dorm").value;
    const list = rooms.filter(r => r.dormitory_id === dormId && r.room_id !== me.room_id);
    $("#mt-room").innerHTML = list.length ? list.map(r => {
      const full = r.occupied >= r.capacity;
      return `<option value="${r.room_id}" ${full ? "disabled" : ""}>غرفة ${esc(r.room_number)} — ${r.occupied}/${r.capacity}${full ? " ممتلئة" : ""}</option>`;
    }).join("") : `<option value="">لا توجد غرف متاحة</option>`;
    const free = list.find(r => r.occupied < r.capacity);
    if (free) $("#mt-room").value = free.room_id;
  }
  const mtForm = $("#mt-form");
  $("#mt-dorm")?.addEventListener("change", () => fillRooms("dorm_transfer"));
  mtForm?.addEventListener("submit", async e => {
    e.preventDefault();
    const type = mtForm.dataset.mtType;
    if (!me.dormitory_id) return toast("لم يُحدد سكنك بعد. راجعي الإدارة.", "error");
    if (!$("#mt-room").value) return toast("اختاري غرفة متاحة.", "error");
    const btn = e.target.querySelector("[type=submit]"); btn.disabled = true;
    const { error } = await supabase.from("service_requests").insert({
      student_id: me.id, request_type: type, status: "pending_supervisor",
      destination_dormitory_id: type === "room_change" ? me.dormitory_id : $("#mt-dorm").value,
      destination_room_id: $("#mt-room").value, details: { description: $("#mt-reason").value.trim() }
    });
    btn.disabled = false;
    if (error) return toast(errText(error), "error");
    toast(type === "room_change" ? "أُرسل طلب تغيير الغرفة إلى المشرفة." : "أُرسل طلب النقل إلى المشرفة.", "success");
    $("#mt-reason").value = "";
    myList([type], $("#mt-list"));
  });

  $("#m-refresh")?.addEventListener("click", () => {
    if (PAGE === "exit" || PAGE === "guardian") location.reload();
    else { pages[PAGE]?.(); if (PAGE !== "notifs") countUnread(me.id); }
  });
  await pages[PAGE]?.();
  if (PAGE !== "notifs") countUnread(me.id);
}

/* =============================================
   المشرفة
   ============================================= */
async function supervisorApp(s) {
  const me = s.profile;
  const places = await loadPlaces(supabase);
  $("#m-dorm-name").textContent = places.dorms.get(me.dormitory_id) || "";
  let rows = [], filter = "mine";

  async function requests() {
    const { data, error } = await supabase.from("service_requests")
      .select("*, student:profiles!service_requests_student_id_fkey(full_name, student_number)")
      .order("created_at", { ascending: false }).limit(200);
    if (error) { $("#ms-list").innerHTML = empty("تعذّر تحميل الطلبات."); return; }
    rows = data || [];
    badge("requests", rows.filter(r => r.status === "pending_supervisor").length);
    renderRequests();
  }

  function actions(r) {
    const note = `<textarea class="m-input" data-note="${esc(r.id)}" rows="2" placeholder="ملاحظة (إلزامية عند الرفض)"></textarea>`;
    if (r.status === "pending_guardian") {
      return `<div class="m-actions">
        <button class="m-btn gold" data-g="link" data-id="${esc(r.id)}">إرسال رابط الموافقة على واتساب</button>
        <button class="m-btn" data-g="resend" data-id="${esc(r.id)}">إعادة الإرسال التلقائي</button>
        <button class="m-btn good" data-g="approved" data-id="${esc(r.id)}">ولي الأمر وافق (اتصال)</button>
        <button class="m-btn bad" data-g="rejected" data-id="${esc(r.id)}">ولي الأمر رفض (اتصال)</button>
        ${note}<button class="m-btn bad" data-d="rejected" data-id="${esc(r.id)}">رفض الطلب</button></div>`;
    }
    if (r.status !== "pending_supervisor") return "";
    const canApprove = r.request_type !== "guardian_exit" || r.guardian_status === "approved";
    return `<div class="m-actions">${note}
      ${canApprove ? `<button class="m-btn good" data-d="approved" data-id="${esc(r.id)}">موافقة</button>` : ""}
      <button class="m-btn bad" data-d="rejected" data-id="${esc(r.id)}">رفض</button></div>`;
  }

  function renderRequests() {
    const sets = {
      mine: rows.filter(r => r.status === "pending_supervisor"),
      guardian: rows.filter(r => r.status === "pending_guardian"),
      open: rows.filter(r => r.status === "approved"),
      all: rows
    };
    $$("[data-ms-filter]").forEach(b => {
      b.setAttribute("aria-pressed", String(b.dataset.msFilter === filter));
      b.querySelector("b").textContent = sets[b.dataset.msFilter].length;
    });
    const list = sets[filter];
    $("#ms-list").innerHTML = list.length ? list.map(r => requestCard(r, places, actions(r))).join("") : empty("لا توجد طلبات هنا.");
    hydrateCardImages(supabase, $("#ms-list"));
  }

  $$("[data-ms-filter]").forEach(b => b.addEventListener("click", () => { filter = b.dataset.msFilter; renderRequests(); }));

  $("#ms-list").addEventListener("click", async e => {
    const d = e.target.closest("[data-d]"), g = e.target.closest("[data-g]");
    const btn = d || g; if (!btn) return;
    const id = btn.dataset.id;
    const note = $(`[data-note="${id}"]`)?.value.trim() || null;
    btn.disabled = true;
    try {
      if (d) {
        if (d.dataset.d === "rejected" && !note) { toast("اكتبي سبب الرفض.", "error"); btn.disabled = false; return; }
        const { error } = await supabase.rpc("sakan_decide_request", { p_request_id: id, p_decision: d.dataset.d, p_note: note });
        if (error) throw error;
        toast(d.dataset.d === "approved" ? "تمت الموافقة." : "رُفض الطلب.", "success");
      } else if (g.dataset.g === "link") {
        const sent = await sendGuardianLink(supabase, id);
        toast(sent.local ? "فُتح واتساب. لن يعمل الرابط عند ولي الأمر قبل رفع الموقع على الاستضافة."
                         : "فُتح واتساب برسالة الموافقة. اضغطي إرسال، وسيصل الرد هنا.", sent.local ? "error" : "success");
      } else if (g.dataset.g === "resend") {
        const { data, error } = await supabase.functions.invoke("whatsapp-send", { body: { request_id: id } });
        if (error || !data?.ok) throw new Error(data?.error || "الإرسال التلقائي غير مفعّل بعد (يحتاج إعداد Meta). استخدمي زر رابط الموافقة.");
        toast("أُعيد الإرسال لولي الأمر.", "success");
      } else {
        const { error } = await supabase.rpc("sakan_guardian_manual", { p_request_id: id, p_answer: g.dataset.g, p_note: note });
        if (error) throw error;
        toast("سُجّل رد ولي الأمر.", "success");
      }
      requests();
    } catch (err) {
      toast(errText(err), "error");
      btn.disabled = false;
    }
  });

  async function attendance() {
    const [{ data: students }, { data: recs }] = await Promise.all([
      supabase.from("profiles").select("id, full_name, room_id, fingerprint_id").eq("role", "student")
        .eq("dormitory_id", me.dormitory_id).eq("is_active", true).order("full_name"),
      supabase.from("attendance").select("*").eq("attendance_date", todayStr())
    ]);
    const by = new Map((recs || []).map(r => [r.student_id, r]));
    const list = students || [];
    const present = list.filter(st => by.get(st.id)?.fingerprint_at).length;
    const regOnly = list.filter(st => by.get(st.id) && !by.get(st.id).fingerprint_at).length;
    $("#ms-att-stats").innerHTML = `
      <div><b>${present}</b><span>حاضرة</span></div><div><b>${regOnly}</b><span>بلا بصمة</span></div>
      <div><b>${list.length - present - regOnly}</b><span>لم تسجّل</span></div>`;
    $("#ms-att-day").textContent = fmtDay(todayStr());
    $("#ms-att-list").innerHTML = list.length ? list.map(st => {
      const r = by.get(st.id);
      return `<div class="m-row"><div><b>${esc(st.full_name)}</b><span class="m-sub">غرفة ${esc(places.rooms.get(st.room_id) || "—")}</span></div>
        ${r?.fingerprint_at ? pill("حاضرة " + fmtTime(r.fingerprint_at), "good") : r ? pill("بلا بصمة", "warn") : pill("لم تسجّل", "bad")}</div>`;
    }).join("") : empty("لا توجد طالبات في سكنك.");
  }

  let students = [];
  async function studentsView() {
    const { data } = await supabase.from("profiles").select("*").eq("role", "student")
      .eq("dormitory_id", me.dormitory_id).order("full_name");
    students = data || [];
    renderStudents();
  }
  function renderStudents() {
    const q = $("#ms-search").value.trim();
    const list = students.filter(st => !q || st.full_name.includes(q) || (st.username || "").includes(q));
    $("#ms-students").innerHTML = list.length ? list.map(st => `
      <details class="m-card">
        <summary class="m-row" style="border:0;padding:0"><div><b>${esc(st.full_name)}</b><span class="m-sub sk-num">${esc(st.username)} · غرفة ${esc(places.rooms.get(st.room_id) || "—")}</span></div>${st.is_active ? "" : pill("غير نشط", "muted")}</summary>
        <dl class="sk-kv" style="margin-top:10px">
          ${st.phone ? `<div><dt>هاتف الطالبة</dt><dd><a class="sk-num" href="tel:${esc(st.phone)}">${esc(st.phone)}</a></dd></div>` : ""}
          <div><dt>ولي الأمر</dt><dd>${esc(st.guardian_name || "—")} ${st.guardian_phone ? `<a class="sk-num" href="tel:${esc(st.guardian_phone)}">${esc(st.guardian_phone)}</a>` : ""}</dd></div>
          <div><dt>رقم البصمة</dt><dd class="sk-num">${esc(st.fingerprint_id || "—")}</dd></div>
        </dl>
        ${st.student_card_path || st.guardian_card_path ? `<div class="sk-cards" style="margin-top:10px">
          ${st.student_card_path ? `<figure><a data-card-link><img alt="بطاقة الطالبة" data-card-path="${esc(st.student_card_path)}"></a><figcaption>بطاقة الطالبة</figcaption></figure>` : ""}
          ${st.guardian_card_path ? `<figure><a data-card-link><img alt="بطاقة ولي الأمر" data-card-path="${esc(st.guardian_card_path)}"></a><figcaption>بطاقة ولي الأمر</figcaption></figure>` : ""}
        </div>` : ""}
      </details>`).join("") : empty("لا نتائج.");
  }
  $("#ms-search").addEventListener("input", renderStudents);
  $("#ms-students").addEventListener("toggle", e => { if (e.target.open) hydrateCardImages(supabase, e.target); }, true);

  setupTabs({ requests, attendance, students: studentsView, notifs: () => loadNotifications(me.id, $("#m-notifs")) });
  countUnread(me.id);
}

/* =============================================
   الأمن
   ============================================= */
async function securityApp(s) {
  let rows = [];

  async function load() {
    const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 19) + "Z";
    const { data, error } = await supabase.from("service_requests")
      .select("*, student:profiles!service_requests_student_id_fkey(full_name, student_number)")
      .in("request_type", ["exit_permit", "guardian_exit", "hosting"])
      .or(`status.eq.approved,and(status.eq.completed,created_at.gte.${since})`)
      .order("start_at", { ascending: true });
    if (error) { toast("تعذّر تحميل الطلبات.", "error"); return false; }
    rows = data || [];
    return true;
  }

  function actions(r) {
    const b = (attr, label, tone = "primary") => `<button class="m-btn ${tone}" ${attr} data-id="${esc(r.id)}">${label}</button>`;
    if (r.status !== "approved") return "";
    if (isExitType(r.request_type)) {
      if (!r.security_status || r.security_status === "not_received") return `<div class="m-actions">${b('data-sec="received"', "تم استلام البطاقة")}</div>`;
      if (r.security_status === "received") return `<div class="m-actions">${b('data-sec="verified"', "تم التحقق من البطاقة")}</div>`;
      if (r.security_status === "verified" && !r.gate_out_at) return `<div class="m-actions">${b('data-gate="out"', "تسجيل خروج الطالبة", "gold")}</div>`;
      if (r.gate_out_at && !r.gate_in_at) return `<div class="m-actions">${b('data-gate="in"', "تسجيل عودة الطالبة", "gold")}</div>`;
    }
    if (r.request_type === "hosting") {
      if (!r.gate_in_at) return `<div class="m-actions">${b('data-gate="in"', "دخول الضيفة", "gold")}</div>`;
      if (!r.gate_out_at) return `<div class="m-actions">${b('data-gate="out"', "مغادرة الضيفة", "gold")}</div>`;
    }
    return "";
  }

  async function gate() {
    if (!(await load())) return;
    const todo = rows.filter(r => r.status === "approved" && !(isExitType(r.request_type) && r.gate_out_at));
    badge("gate", todo.length);
    $("#mg-list").innerHTML = todo.length ? todo.map(r => requestCard(r, null, actions(r))).join("") : empty("لا توجد إجراءات على البوابة الآن.");
    hydrateCardImages(supabase, $("#mg-list"));
  }

  async function out() {
    if (!(await load())) return;
    const list = rows.filter(r => isExitType(r.request_type) && r.gate_out_at && !r.gate_in_at)
      .sort((a, b) => new Date(a.end_at) - new Date(b.end_at));
    const late = list.filter(r => new Date(r.end_at) < new Date()).length;
    $("#mo-stats").innerHTML = `<div><b>${list.length}</b><span>خارج السكن</span></div><div><b>${late}</b><span>متأخرات</span></div>`;
    $("#mo-list").innerHTML = list.length ? list.map(r => requestCard(r, null, actions(r))).join("") : empty("لا توجد طالبات خارج السكن.");
  }

  for (const id of ["#mg-list", "#mo-list"]) {
    $(id).addEventListener("click", async e => {
      const b = e.target.closest("[data-sec],[data-gate]"); if (!b) return;
      b.disabled = true;
      const { error } = b.dataset.sec
        ? await supabase.rpc("security_update_request", { p_request_id: b.dataset.id, p_action: b.dataset.sec, p_note: null })
        : await supabase.rpc("sakan_security_gate", { p_request_id: b.dataset.id, p_action: b.dataset.gate });
      if (error) { toast(errText(error), "error"); b.disabled = false; return; }
      toast("تم.", "success");
      id === "#mg-list" ? gate() : out();
    });
  }

  $("#mf-form").addEventListener("submit", async e => {
    e.preventDefault();
    const input = $("#mf-id");
    const { data, error } = await supabase.rpc("sakan_record_fingerprint", { p_fingerprint_id: input.value.trim() });
    const line = error ? errText(error) : data.message;
    $("#mf-log").insertAdjacentHTML("afterbegin",
      `<div class="m-row"><span>${esc(line)}</span>${pill(fmtTime(new Date()), !error && data.ok ? "good" : "bad")}</div>`);
    if (!error && data.ok) input.value = "";
    input.focus();
  });

  setupTabs({ gate, out, finger: () => $("#mf-id").focus() });
}

/* =============================================
   الإدارة
   ============================================= */
async function adminApp(s) {
  const places = await loadPlaces(supabase);

  async function home() {
    const [d, st, sup, pend, outN, att] = await Promise.all([
      supabase.from("dormitories").select("id", { count: "exact", head: true }),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "student").eq("is_active", true),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "supervisor"),
      supabase.from("service_requests").select("id", { count: "exact", head: true }).eq("status", "pending_admin"),
      supabase.from("service_requests").select("id", { count: "exact", head: true }).not("gate_out_at", "is", null).is("gate_in_at", null).in("request_type", ["exit_permit", "guardian_exit"]),
      supabase.from("attendance").select("id", { count: "exact", head: true }).eq("attendance_date", todayStr()).not("fingerprint_at", "is", null)
    ]);
    $("#ma-stats").innerHTML = [
      [st.count, "طالبة"], [att.count, "حاضرة اليوم"], [outN.count, "خارج السكن"],
      [pend.count, "بانتظار الإدارة"], [d.count, "سكن"], [sup.count, "مشرفة"]
    ].map(([n, l]) => `<div><b>${n ?? 0}</b><span>${l}</span></div>`).join("");
    badge("requests", pend.count || 0);
  }

  async function requests() {
    const { data } = await supabase.from("service_requests")
      .select("*, student:profiles!service_requests_student_id_fkey(full_name, student_number)")
      .in("status", ["pending_admin", "pending_supervisor", "pending_guardian"]).order("created_at", { ascending: false });
    const list = (data || []).sort((a, b) => (b.status === "pending_admin") - (a.status === "pending_admin"));
    $("#mr-list").innerHTML = list.length ? list.map(r => {
      const canApprove = r.status !== "pending_guardian" && (r.request_type !== "guardian_exit" || r.guardian_status === "approved");
      return requestCard(r, places, `<div class="m-actions">
        <textarea class="m-input" data-note="${esc(r.id)}" rows="2" placeholder="ملاحظة (إلزامية عند الرفض)"></textarea>
        ${canApprove ? `<button class="m-btn good" data-d="approved" data-id="${esc(r.id)}">اعتماد</button>` : ""}
        <button class="m-btn bad" data-d="rejected" data-id="${esc(r.id)}">رفض</button></div>`);
    }).join("") : empty("لا توجد طلبات معلّقة.");
    hydrateCardImages(supabase, $("#mr-list"));
  }
  $("#mr-list").addEventListener("click", async e => {
    const b = e.target.closest("[data-d]"); if (!b) return;
    const note = $(`[data-note="${b.dataset.id}"]`)?.value.trim() || null;
    if (b.dataset.d === "rejected" && !note) return toast("اكتبي سبب الرفض.", "error");
    b.disabled = true;
    const { data, error } = await supabase.rpc("sakan_decide_request", { p_request_id: b.dataset.id, p_decision: b.dataset.d, p_note: note });
    if (error) { toast(errText(error), "error"); b.disabled = false; return; }
    toast(data === "completed" ? "اعتُمد ونُفّذ النقل." : data === "rejected" ? "رُفض الطلب." : "اعتُمد الطلب.", "success");
    requests(); home();
  });

  let accounts = [];
  async function accountsView() {
    const { data } = await supabase.from("profiles").select("id, username, full_name, role, is_active, dormitory_id, room_id").order("full_name");
    accounts = data || [];
    renderAccounts();
  }
  function renderAccounts() {
    const q = $("#mu-search").value.trim().toLowerCase();
    const list = accounts.filter(a => !q || a.full_name.toLowerCase().includes(q) || a.username.includes(q)).slice(0, 60);
    $("#mu-list").innerHTML = list.length ? list.map(a => `
      <details class="m-card">
        <summary class="m-row" style="border:0;padding:0"><div><b>${esc(a.full_name)}</b><span class="m-sub sk-num">${esc(a.username)} · ${esc(ROLE_LABELS[a.role])}</span></div>${a.is_active ? "" : pill("غير نشط", "muted")}</summary>
        <p class="m-sub" style="margin:8px 0">${esc(places.dorms.get(a.dormitory_id) || "")}${a.room_id ? " · غرفة " + esc(places.rooms.get(a.room_id) || "") : ""}</p>
        <div class="m-actions">
          <button class="m-btn" data-pw="${esc(a.id)}">كلمة مرور جديدة</button>
          ${a.id !== s.user.id ? `<button class="m-btn ${a.is_active ? "bad" : "good"}" data-active="${esc(a.id)}" data-to="${!a.is_active}">${a.is_active ? "إيقاف الحساب" : "تفعيل الحساب"}</button>` : ""}
          <a class="m-btn" href="admin-edit-user.html?id=${encodeURIComponent(a.id)}">تعديل كامل</a>
        </div>
        <p class="m-text" data-pw-out="${esc(a.id)}" style="user-select:all"></p>
      </details>`).join("") : empty("لا نتائج.");
  }
  $("#mu-search").addEventListener("input", renderAccounts);
  $("#mu-list").addEventListener("click", async e => {
    const pw = e.target.closest("[data-pw]"), ac = e.target.closest("[data-active]");
    if (pw) {
      const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789", buf = new Uint32Array(8);
      crypto.getRandomValues(buf);
      const pass = [...buf].map(n => abc[n % abc.length]).join("");
      pw.disabled = true;
      const { error } = await supabase.rpc("sakan_admin_set_password", { p_user_id: pw.dataset.pw, p_password: pass });
      pw.disabled = false;
      if (error) return toast(errText(error), "error");
      $(`[data-pw-out="${pw.dataset.pw}"]`).textContent = `كلمة المرور الجديدة: ${pass}`;
    }
    if (ac) {
      const { error } = await supabase.from("profiles").update({ is_active: ac.dataset.to === "true" }).eq("id", ac.dataset.active);
      if (error) return toast(errText(error), "error");
      toast("حُدّث الحساب.", "success");
      accountsView();
    }
  });

  async function attendance() {
    const [{ data: students }, { data: recs }] = await Promise.all([
      supabase.from("profiles").select("id, dormitory_id").eq("role", "student").eq("is_active", true),
      supabase.from("attendance").select("student_id, fingerprint_at").eq("attendance_date", todayStr())
    ]);
    const by = new Map((recs || []).map(r => [r.student_id, r]));
    $("#mat-day").textContent = fmtDay(todayStr());
    $("#mat-list").innerHTML = [...places.dorms].map(([id, name]) => {
      const list = (students || []).filter(st => st.dormitory_id === id);
      const p = list.filter(st => by.get(st.id)?.fingerprint_at).length;
      const r = list.filter(st => by.get(st.id) && !by.get(st.id).fingerprint_at).length;
      return `<div class="m-card"><div class="m-card-head"><h3>${esc(name)}</h3><span class="m-sub">${list.length} طالبة</span></div>
        <div class="m-stats m-stats3"><div><b>${p}</b><span>حاضرة</span></div><div><b>${r}</b><span>بلا بصمة</span></div><div><b>${list.length - p - r}</b><span>لم تسجّل</span></div></div></div>`;
    }).join("") || empty("لا توجد سكنات.");
  }

  setupTabs({ home, requests, accounts: accountsView, attendance });
  home();
}

/* ---------- التشغيل ---------- */
$("#m-logout")?.addEventListener("click", async () => { await supabase.auth.signOut(); location.href = LOGIN_PAGES[ROLE]; });

const s = await mSession();
if (s) {
  ({ student: studentApp, supervisor: supervisorApp, security: securityApp, admin: adminApp })[ROLE]?.(s);
}
