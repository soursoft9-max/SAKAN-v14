// =============================================
// نظام سَكَن | الخدمات الإضافية
// الحضور، الاستضافة، النقل وتغيير الغرفة، الإشعارات،
// حضور السكن للمشرفة، البصمة اليدوية للأمن،
// وإدارة الطالبات والغرف والطلبات والحضور للإدارة
// =============================================

import { supabase } from "./main.js";
import {
  esc, fmtDateTime, fmtTime, fmtDay, todayStr, TYPE_LABELS, pill, statusPill, gatePill,
  stepsTrack, loadPlaces, requestDetailsHTML, cardImagesHTML, hydrateCardImages, setMsg,
  normalizeUsername, usernameRole, friendlyError
} from "./sakan-shared.js";

const $ = (s, p = document) => p.querySelector(s);
const page = document.body.dataset.page;
const ROLE_NAMES = { student: "طالبة", supervisor: "مشرفة", security: "أمن", admin: "إدارة" };

async function session(roles) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { location.href = roles.includes("student") ? "login.html" : "index.html"; return null; }
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!profile || !profile.is_active || !roles.includes(profile.role)) { location.href = "index.html"; return null; }
  const who = $("#sk-who");
  if (who) who.textContent = profile.full_name || user.email;
  return { user, profile };
}

const errText = e => {
  const m = e?.message || "";
  if (e?.code === "23505") return "القيمة مستخدمة لحساب آخر (رقم البصمة أو الرقم الجامعي)";
  return friendlyError(e);
};

/* =============================================
   الطالبة: الحضور (التسجيل ثم البصمة)
   ============================================= */
async function studentAttendance() {
  const s = await session(["student"]); if (!s) return;
  const msg = $("#att-message");

  async function render() {
    const { data, error } = await supabase.from("attendance")
      .select("*").eq("student_id", s.user.id).order("attendance_date", { ascending: false }).limit(30);
    if (error) { setMsg(msg, "تعذّر تحميل سجل الحضور.", "error"); return; }
    const today = (data || []).find(r => r.attendance_date === todayStr());
    const state = !today ? "لم تسجّلي حضورك اليوم"
      : today.fingerprint_at ? "الحضور مكتمل"
      : "سُجّل الحضور، توجّهي لجهاز البصمة";

    $("#att-today").innerHTML = `
      <div class="sk-today">
        <div><div class="sk-num" style="color:var(--muted)">${esc(fmtDay(todayStr()))}</div><div class="state">${esc(state)}</div></div>
        ${!today ? `<button class="sk-btn primary" id="att-register">تسجيل الحضور الآن</button>`
          : today.fingerprint_at ? pill("مكتمل " + fmtTime(today.fingerprint_at), "good") : pill("بانتظار البصمة", "warn")}
      </div>
      <div class="sk-twostep">
        <div class="${today ? "done" : ""}"><i>1</i><span><b>التسجيل في الموقع</b>${today ? esc(fmtTime(today.registered_at)) : "اضغطي زر تسجيل الحضور"}</span></div>
        <div class="${today?.fingerprint_at ? "done" : ""}"><i>2</i><span><b>البصمة على جهاز السكن</b>${today?.fingerprint_at ? esc(fmtTime(today.fingerprint_at)) : `رقمك في الجهاز: <span class="sk-num">${esc(s.profile.fingerprint_id || "لم يُحدد بعد")}</span>`}</span></div>
      </div>`;

    $("#att-history").innerHTML = data?.length ? `<div class="sk-table-wrap"><table class="sk-table">
      <thead><tr><th>اليوم</th><th>التسجيل</th><th>البصمة</th><th>الحالة</th></tr></thead><tbody>
      ${data.map(r => `<tr><td>${esc(fmtDay(r.attendance_date))}</td><td class="sk-num">${esc(fmtTime(r.registered_at || r.created_at))}</td><td class="sk-num">${esc(fmtTime(r.fingerprint_at))}</td>
        <td>${r.status === "present" ? pill("حاضرة", "good") : r.status === "registered" ? pill("بلا بصمة", "warn") : pill(r.status, "muted")}</td></tr>`).join("")}
      </tbody></table></div>` : `<p class="sk-empty">لا يوجد سجل حضور بعد.</p>`;

    $("#att-register")?.addEventListener("click", async e => {
      e.target.disabled = true;
      const { error } = await supabase.rpc("sakan_register_attendance");
      if (error) { setMsg(msg, errText(error), "error"); e.target.disabled = false; return; }
      setMsg(msg, "تم تسجيل حضورك. توجّهي الآن لجهاز البصمة لإكمال الحضور.", "success");
      render();
    });
  }
  if (!s.profile.fingerprint_id) setMsg(msg, "لم تُسجّل إدارة السكن رقم بصمتك بعد. راجعي الإدارة لإكمال الحضور بالبصمة.", "info");
  render();
}

/* =============================================
   قائمة طلبات الطالبة حسب النوع (مشتركة)
   ============================================= */
async function renderMyRequests(userId, types, el, places) {
  const { data, error } = await supabase.from("service_requests").select("*")
    .eq("student_id", userId).in("request_type", types).order("created_at", { ascending: false });
  if (error) { el.innerHTML = `<p class="sk-empty">تعذّر تحميل الطلبات.</p>`; return; }
  el.innerHTML = data?.length ? data.map(r => `
    <article class="sk-req"><div class="sk-req-head"><h3>${esc(TYPE_LABELS[r.request_type])}</h3><div class="sk-row">${statusPill(r.status)}${gatePill(r)}</div></div>
    ${stepsTrack(r)}${requestDetailsHTML(r, places)}</article>`).join("")
    : `<p class="sk-empty">لا توجد طلبات حتى الآن.</p>`;
}

/* =============================================
   الطالبة: الاستضافة
   ============================================= */
async function studentHosting() {
  const s = await session(["student"]); if (!s) return;
  const form = $("#hosting-form"), msg = $("#hosting-message"), list = $("#hosting-list");
  $("#h-date").value = todayStr();
  renderMyRequests(s.user.id, ["hosting"], list);

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const v = id => $("#" + id).value.trim();
    const start = new Date(`${v("h-date")}T${v("h-from")}`), end = new Date(`${v("h-date")}T${v("h-to")}`);
    if (!(end > start)) return setMsg(msg, "وقت انتهاء الزيارة يجب أن يكون بعد وقت بدايتها.", "error");
    if (start < new Date(Date.now() - 3600e3)) return setMsg(msg, "موعد الزيارة في الماضي.", "error");
    const btn = form.querySelector("[type=submit]"); btn.disabled = true;
    setMsg(msg, "جارٍ إرسال الطلب...", "info");
    const { error } = await supabase.from("service_requests").insert({
      student_id: s.user.id, request_type: "hosting", status: "pending_supervisor",
      start_at: start.toISOString(), end_at: end.toISOString(),
      details: { description: v("h-note"), guest: { full_name: v("h-name"), relationship: v("h-rel"), civil_id: v("h-civil"), phone: v("h-phone") } }
    });
    btn.disabled = false;
    if (error) return setMsg(msg, errText(error), "error");
    setMsg(msg, "أُرسل طلب الاستضافة إلى المشرفة.", "success");
    form.reset(); $("#h-date").value = todayStr();
    renderMyRequests(s.user.id, ["hosting"], list);
  });
}

/* =============================================
   الطالبة: النقل بين السكنات وتغيير الغرفة
   ============================================= */
async function studentTransfer() {
  const s = await session(["student"]); if (!s) return;
  const msg = $("#tr-message"), list = $("#tr-list");
  const [{ data: rooms, error }, places] = await Promise.all([supabase.rpc("sakan_room_availability"), loadPlaces(supabase)]);
  if (error) { setMsg(msg, "تعذّر تحميل الغرف المتاحة.", "error"); return; }
  let type = new URLSearchParams(location.search).get("type") === "dorm_transfer" ? "dorm_transfer" : "room_change";
  const cur = s.profile;
  $("#tr-current").textContent = cur.dormitory_id
    ? `${places.dorms.get(cur.dormitory_id) || "—"}${cur.room_id ? " · غرفة " + (places.rooms.get(cur.room_id) || "") : " · لم تُحدد غرفة"}`
    : "لم يُحدد سكنك بعد. راجعي الإدارة.";

  const dormSel = $("#tr-dorm"), roomSel = $("#tr-room");
  const dorms = [...new Map(rooms.map(r => [r.dormitory_id, r.dormitory_name]))];

  function fillRooms() {
    const dormId = type === "room_change" ? cur.dormitory_id : dormSel.value;
    const opts = rooms.filter(r => r.dormitory_id === dormId && r.room_id !== cur.room_id);
    roomSel.innerHTML = opts.length ? opts.map(r => {
      const full = r.occupied >= r.capacity;
      return `<option value="${r.room_id}" ${full ? "disabled" : ""}>غرفة ${esc(r.room_number)} — ${r.occupied}/${r.capacity}${full ? " (ممتلئة)" : ""}</option>`;
    }).join("") : `<option value="">لا توجد غرف أخرى في هذا السكن</option>`;
    const firstFree = opts.find(r => r.occupied < r.capacity);
    if (firstFree) roomSel.value = firstFree.room_id;
  }
  function setType(t) {
    type = t;
    document.querySelectorAll("[data-tr-type]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.trType === t)));
    $("#tr-dorm-field").hidden = t === "room_change";
    $("#tr-title").textContent = t === "room_change" ? "طلب تغيير الغرفة داخل سكنك" : "طلب النقل إلى سكن آخر";
    $("#tr-hint").textContent = t === "room_change" ? "يُنفَّذ التغيير بعد موافقة مشرفة السكن." : "يمر الطلب على المشرفة ثم الإدارة، ويُنفَّذ النقل بعد اعتماد الإدارة.";
    fillRooms();
  }
  dormSel.innerHTML = dorms.filter(([id]) => id !== cur.dormitory_id).map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join("") || `<option value="">لا توجد سكنات أخرى</option>`;
  dormSel.addEventListener("change", fillRooms);
  document.querySelectorAll("[data-tr-type]").forEach(b => b.addEventListener("click", () => setType(b.dataset.trType)));
  setType(type);
  renderMyRequests(s.user.id, ["room_change", "dorm_transfer"], list, places);

  $("#tr-form").addEventListener("submit", async e => {
    e.preventDefault();
    if (!cur.dormitory_id) return setMsg(msg, "لم يُحدد سكنك بعد. راجعي الإدارة.", "error");
    if (!roomSel.value) return setMsg(msg, "اختاري غرفة متاحة.", "error");
    const btn = e.target.querySelector("[type=submit]"); btn.disabled = true;
    const { error } = await supabase.from("service_requests").insert({
      student_id: s.user.id, request_type: type, status: "pending_supervisor",
      destination_dormitory_id: type === "room_change" ? cur.dormitory_id : dormSel.value,
      destination_room_id: roomSel.value,
      details: { description: $("#tr-reason").value.trim() }
    });
    btn.disabled = false;
    if (error) return setMsg(msg, errText(error), "error");
    setMsg(msg, "أُرسل الطلب إلى المشرفة.", "success");
    $("#tr-reason").value = "";
    renderMyRequests(s.user.id, ["room_change", "dorm_transfer"], list, places);
  });
}

/* =============================================
   الإشعارات
   ============================================= */
async function notifications() {
  const s = await session(["student", "supervisor", "security", "admin"]); if (!s) return;
  const { data } = await supabase.from("notifications").select("*").eq("user_id", s.user.id).order("created_at", { ascending: false }).limit(50);
  $("#notif-list").innerHTML = data?.length ? data.map(n => `
    <article class="sk-req"><div class="sk-req-head"><h3>${esc(n.title)}</h3>${n.is_read ? "" : pill("جديد", "info")}</div>
    <p style="margin:0">${esc(n.message)}</p><small style="color:var(--muted)">${esc(fmtDateTime(n.created_at))}</small></article>`).join("")
    : `<p class="sk-empty">لا توجد إشعارات.</p>`;
  const unread = (data || []).filter(n => !n.is_read).map(n => n.id);
  if (unread.length) await supabase.from("notifications").update({ is_read: true }).in("id", unread);
}

/* =============================================
   جدول حضور (للمشرفة والإدارة)
   ============================================= */
function attendanceTable(students, records, places, showDorm) {
  const byStudent = new Map(records.map(r => [r.student_id, r]));
  const rows = students.map(st => {
    const r = byStudent.get(st.id);
    const state = r?.fingerprint_at || r?.status === "present" ? pill("حاضرة", "good") : r ? pill("بلا بصمة", "warn") : pill("لم تسجّل", "bad");
    return `<tr><td>${esc(st.full_name)}</td><td class="sk-num">${esc(st.student_number || "—")}</td>
      ${showDorm ? `<td>${esc(places.dorms.get(st.dormitory_id) || "—")}</td>` : ""}<td>${esc(places.rooms.get(st.room_id) || "—")}</td>
      <td class="sk-num">${esc(st.fingerprint_id || "—")}</td><td class="sk-num">${esc(fmtTime(r?.registered_at))}</td><td class="sk-num">${esc(fmtTime(r?.fingerprint_at))}</td><td>${state}</td></tr>`;
  });
  const present = students.filter(st => { const r = byStudent.get(st.id); return r?.fingerprint_at || r?.status === "present"; }).length;
  const regOnly = students.filter(st => { const r = byStudent.get(st.id); return r && !r.fingerprint_at && r.status !== "present"; }).length;
  return {
    stats: `<div class="sk-stat"><strong>${students.length}</strong><span>الطالبات</span></div><div class="sk-stat"><strong>${present}</strong><span>حاضرة (تسجيل وبصمة)</span></div>
      <div class="sk-stat"><strong>${regOnly}</strong><span>سجّلت بدون بصمة</span></div><div class="sk-stat"><strong>${students.length - present - regOnly}</strong><span>لم تسجّل</span></div>`,
    table: `<div class="sk-table-wrap"><table class="sk-table"><thead><tr><th>الطالبة</th><th>الرقم الجامعي</th>${showDorm ? "<th>السكن</th>" : ""}<th>الغرفة</th><th>رقم البصمة</th><th>التسجيل</th><th>البصمة</th><th>الحالة</th></tr></thead>
      <tbody>${rows.join("") || `<tr><td colspan="8" class="sk-empty">لا توجد طالبات.</td></tr>`}</tbody></table></div>`,
    csv: [["الطالبة", "الرقم الجامعي", "السكن", "الغرفة", "رقم البصمة", "التسجيل", "البصمة", "الحالة"],
      ...students.map(st => { const r = byStudent.get(st.id); return [st.full_name, st.student_number || "", places.dorms.get(st.dormitory_id) || "", places.rooms.get(st.room_id) || "", st.fingerprint_id || "", fmtTime(r?.registered_at), fmtTime(r?.fingerprint_at), r?.fingerprint_at || r?.status === "present" ? "حاضرة" : r ? "بلا بصمة" : "لم تسجّل"]; })]
  };
}
function downloadCSV(rows, name) {
  const text = "﻿" + rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function attendanceReport(isAdmin) {
  const s = await session([isAdmin ? "admin" : "supervisor"]); if (!s) return;
  const places = await loadPlaces(supabase);
  const dateIn = $("#rep-date"), dormSel = $("#rep-dorm"), msg = $("#rep-message");
  dateIn.value = todayStr();
  if (isAdmin) dormSel.innerHTML = `<option value="">كل السكنات</option>` + [...places.dorms].map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join("");
  else { $("#rep-dorm-field").hidden = true; $("#rep-sub").textContent = places.dorms.get(s.profile.dormitory_id) || ""; }
  let last = null;

  async function load() {
    let q = supabase.from("profiles").select("id, full_name, student_number, dormitory_id, room_id, fingerprint_id")
      .eq("role", "student").eq("is_active", true).order("full_name");
    const dorm = isAdmin ? dormSel.value : s.profile.dormitory_id;
    if (dorm) q = q.eq("dormitory_id", dorm);
    const [{ data: students, error: e1 }, { data: recs, error: e2 }] = await Promise.all([q,
      supabase.from("attendance").select("*").eq("attendance_date", dateIn.value)]);
    if (e1 || e2) return setMsg(msg, "تعذّر تحميل الحضور.", "error");
    last = attendanceTable(students || [], recs || [], places, isAdmin);
    $("#rep-stats").innerHTML = last.stats; $("#rep-table").innerHTML = last.table;
  }
  dateIn.addEventListener("change", load); dormSel?.addEventListener("change", load);
  $("#rep-export").addEventListener("click", () => last && downloadCSV(last.csv, `حضور-${dateIn.value}.csv`));
  load();
}

/* =============================================
   الأمن: إدخال البصمة يدوياً
   ============================================= */
function fingerprintPanel() {
  const form = $("#fingerprint-form"); if (!form) return;
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const input = $("#fingerprint-id"), msg = $("#fingerprint-message");
    const { data, error } = await supabase.rpc("sakan_record_fingerprint", { p_fingerprint_id: input.value.trim() });
    if (error) return setMsg(msg, errText(error), "error");
    setMsg(msg, data.message, data.ok ? "success" : "error");
    if (data.ok) input.value = "";
    input.focus();
  });
}

/* =============================================
   الإدارة: تعديل بيانات حساب (طالبة / مشرفة / أمن)
   ============================================= */
async function adminEditUser() {
  const s = await session(["admin"]); if (!s) return;
  const id = new URLSearchParams(location.search).get("id");
  const msg = $("#edit-message");
  const [{ data: p, error }, { data: dorms }, { data: rooms }, { data: avail }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", id).maybeSingle(),
    supabase.from("dormitories").select("id, name, is_active").order("name"),
    supabase.from("rooms").select("id, dormitory_id, room_number, capacity, is_active").order("room_number"),
    supabase.rpc("sakan_room_availability")
  ]);
  if (error || !p) { setMsg(msg, "الحساب غير موجود.", "error"); return; }
  const occ = new Map((avail || []).map(r => [r.room_id, r.occupied]));
  const f = id => $("#" + id);
  f("e-title").textContent = p.full_name;
  f("e-username").value = p.username; f("e-role").value = ROLE_NAMES[p.role];
  ["full_name", "civil_id", "phone", "guardian_name", "guardian_phone", "fingerprint_id"].forEach(k => f("e-" + k).value = p[k] || "");
  f("e-active").checked = p.is_active;
  f("e-dorm").innerHTML = `<option value="">— بدون —</option>` + (dorms || []).map(d => `<option value="${d.id}">${esc(d.name)}${d.is_active ? "" : " (متوقف)"}</option>`).join("");
  f("e-dorm").value = p.dormitory_id || "";
  function fillRooms() {
    const list = (rooms || []).filter(r => r.dormitory_id === f("e-dorm").value && r.is_active);
    f("e-room").innerHTML = `<option value="">— بدون —</option>` + list.map(r => {
      const n = (occ.get(r.id) || 0) - (r.id === p.room_id ? 1 : 0), full = n >= r.capacity;
      return `<option value="${r.id}" ${full ? "disabled" : ""}>${esc(r.room_number)} — ${n}/${r.capacity}${full ? " ممتلئة" : ""}</option>`;
    }).join("");
    if (list.some(r => r.id === p.room_id)) f("e-room").value = p.room_id;
  }
  document.querySelectorAll("[data-student-only]").forEach(x => x.hidden = p.role !== "student");
  f("e-dorm-field").hidden = !["student", "supervisor"].includes(p.role);
  f("e-dorm").addEventListener("change", fillRooms);
  fillRooms();

  $("#edit-form").addEventListener("submit", async e => {
    e.preventDefault();
    if (p.role === "supervisor" && !f("e-dorm").value) return setMsg(msg, "حددي سكن المشرفة.", "error");
    const student = p.role === "student";
    const upd = {
      full_name: f("e-full_name").value.trim(), is_active: f("e-active").checked,
      dormitory_id: ["student", "supervisor"].includes(p.role) ? (f("e-dorm").value || null) : null,
      room_id: student ? (f("e-room").value || null) : null,
      fingerprint_id: student ? (f("e-fingerprint_id").value.trim() || null) : null,
      civil_id: f("e-civil_id").value.trim() || null, phone: f("e-phone").value.trim() || null,
      guardian_name: f("e-guardian_name").value.trim() || null, guardian_phone: f("e-guardian_phone").value.trim() || null
    };
    const { error } = await supabase.from("profiles").update(upd).eq("id", id);
    if (error) return setMsg(msg, errText(error), "error");
    setMsg(msg, "حُفظت البيانات.", "success");
  });

  // البطاقات المحفوظة وأرشيفها
  if (p.role === "student") {
    const fig = (path, cap) => path
      ? `<figure><a data-card-link><img alt="${esc(cap)}" data-card-path="${esc(path)}"></a><figcaption>${esc(cap)}</figcaption></figure>` : "";
    $("#saved-cards-current").innerHTML = (p.student_card_path || p.guardian_card_path)
      ? `<div class="sk-cards">${fig(p.student_card_path, `بطاقة الطالبة · ${p.student_card_name || ""} ${p.student_card_civil || ""}`)}${fig(p.guardian_card_path, `بطاقة ولي الأمر · ${p.guardian_card_name || ""} ${p.guardian_card_civil || ""}`)}</div>`
      : `<p class="sk-empty">لم ترفع الطالبة بطاقات بعد.</p>`;
    const { data: archive } = await supabase.from("id_cards").select("*").eq("student_id", id).order("uploaded_at", { ascending: false });
    $("#saved-cards-archive").innerHTML = archive?.length
      ? `<div class="sk-cards">${archive.map(c => fig(c.image_path, `${c.kind === "student" ? "الطالبة" : "ولي الأمر"} · ${fmtDateTime(c.uploaded_at)}`)).join("")}</div>`
      : `<p class="sk-empty">لا يوجد أرشيف بعد.</p>`;
    hydrateCardImages(supabase, $("#saved-cards-section"));
  }

  const pmsg = $("#pw-message");
  f("pw-gen").addEventListener("click", () => { f("pw-new").value = genPassword(); f("pw-new").type = "text"; });
  $("#pw-form").addEventListener("submit", async e => {
    e.preventDefault();
    const pw = f("pw-new").value;
    if (pw.length < 6) return setMsg(pmsg, "كلمة المرور يجب ألا تقل عن 6 أحرف.", "error");
    const { error } = await supabase.rpc("sakan_admin_set_password", { p_user_id: id, p_password: pw });
    if (error) return setMsg(pmsg, errText(error), "error");
    setMsg(pmsg, `تم تعيين كلمة المرور الجديدة: ${pw}  (أعطيها لصاحبة الحساب)`, "success");
  });

  const del = f("del-account");
  if (id === s.user.id) del.hidden = true;
  del.addEventListener("click", async () => {
    if (!del.dataset.sure) { del.dataset.sure = "1"; del.textContent = "اضغطي مرة أخرى لتأكيد الحذف النهائي"; return; }
    const { error } = await supabase.rpc("sakan_admin_delete_account", { p_user_id: id });
    if (error) return setMsg(pmsg, errText(error), "error");
    location.href = `admin-students.html?role=${p.role}`;
  });
}

/* =============================================
   الإدارة: غرف السكن
   ============================================= */
async function adminRooms() {
  const s = await session(["admin"]); if (!s) return;
  const msg = $("#rooms-message"), sel = $("#rooms-dorm");
  const { data: dorms } = await supabase.from("dormitories").select("id, name").order("name");
  sel.innerHTML = (dorms || []).map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join("");
  const want = new URLSearchParams(location.search).get("dorm");
  if (want) sel.value = want;
  if (!dorms?.length) { $("#rooms-table").innerHTML = `<p class="sk-empty">أضيفي سكناً أولاً من صفحة السكنات.</p>`; return; }

  async function load() {
    const [{ data: rooms }, { data: studs }] = await Promise.all([
      supabase.from("rooms").select("*").eq("dormitory_id", sel.value).order("room_number"),
      supabase.from("profiles").select("full_name, room_id").eq("role", "student").eq("dormitory_id", sel.value).eq("is_active", true)
    ]);
    $("#rooms-table").innerHTML = rooms?.length ? `<div class="sk-table-wrap"><table class="sk-table"><thead><tr><th>الغرفة</th><th>السعة</th><th>الإشغال</th><th>الساكنات</th><th>الحالة</th><th></th></tr></thead><tbody>
      ${rooms.map(r => {
        const ins = (studs || []).filter(x => x.room_id === r.id), pct = Math.min(100, ins.length / r.capacity * 100);
        return `<tr><td class="sk-num">${esc(r.room_number)}</td>
          <td><input type="number" min="1" max="20" value="${r.capacity}" data-cap="${r.id}" style="width:70px" aria-label="سعة الغرفة ${esc(r.room_number)}"></td>
          <td><span class="sk-occ"><span class="${ins.length >= r.capacity ? "full" : ""}" style="width:${pct}%"></span></span><span class="sk-num">${ins.length}/${r.capacity}</span></td>
          <td>${esc(ins.map(x => x.full_name).join("، ") || "—")}</td><td>${r.is_active ? pill("متاحة", "good") : pill("متوقفة", "muted")}</td>
          <td><button class="sk-btn sm" data-toggle="${r.id}" data-active="${r.is_active}">${r.is_active ? "إيقاف" : "تفعيل"}</button></td></tr>`;
      }).join("")}</tbody></table></div>` : `<p class="sk-empty">لا توجد غرف في هذا السكن بعد.</p>`;
  }
  sel.addEventListener("change", load);
  $("#rooms-table").addEventListener("change", async e => {
    const id = e.target.dataset.cap; if (!id) return;
    const { error } = await supabase.from("rooms").update({ capacity: +e.target.value }).eq("id", id);
    setMsg(msg, error ? errText(error) : "حُدّثت السعة.", error ? "error" : "success"); load();
  });
  $("#rooms-table").addEventListener("click", async e => {
    const b = e.target.closest("[data-toggle]"); if (!b) return;
    const { error } = await supabase.from("rooms").update({ is_active: b.dataset.active !== "true" }).eq("id", b.dataset.toggle);
    setMsg(msg, error ? errText(error) : "حُدّثت حالة الغرفة.", error ? "error" : "success"); load();
  });
  $("#room-add-form").addEventListener("submit", async e => {
    e.preventDefault();
    const { error } = await supabase.from("rooms").insert({ dormitory_id: sel.value, room_number: $("#room-no").value.trim(), capacity: +$("#room-cap").value, is_active: true });
    if (error) return setMsg(msg, errText(error), "error");
    setMsg(msg, "أُضيفت الغرفة.", "success"); e.target.reset(); $("#room-cap").value = 2; load();
  });
  load();
}

/* =============================================
   الإدارة: كل الطلبات واعتماد النقل بين السكنات
   ============================================= */
async function adminRequests() {
  const s = await session(["admin"]); if (!s) return;
  const places = await loadPlaces(supabase);
  const list = $("#adm-req-list"), msg = $("#adm-req-message");
  let filter = "pending_admin", rows = [];

  async function load() {
    const { data, error } = await supabase.from("service_requests")
      .select("*, student:profiles!service_requests_student_id_fkey(full_name, student_number)")
      .order("created_at", { ascending: false }).limit(300);
    if (error) return setMsg(msg, "تعذّر تحميل الطلبات.", "error");
    rows = data || []; render();
  }
  function render() {
    document.querySelectorAll("[data-adm-filter]").forEach(b => {
      const k = b.dataset.admFilter, n = k === "all" ? rows.length : rows.filter(r => r.status === k).length;
      b.setAttribute("aria-pressed", String(k === filter)); b.querySelector("span").textContent = n;
    });
    const shown = filter === "all" ? rows : rows.filter(r => r.status === filter);
    list.innerHTML = shown.length ? shown.map(r => `
      <article class="sk-req"><div class="sk-req-head"><h3>${esc(TYPE_LABELS[r.request_type] || r.request_type)}</h3><div class="sk-row">${statusPill(r.status)}${gatePill(r)}</div></div>
      ${stepsTrack(r)}${requestDetailsHTML(r, places)}${cardImagesHTML(r)}
      ${["pending_admin", "pending_supervisor"].includes(r.status) ? `<div class="sk-actions">
        <textarea data-note="${r.id}" placeholder="ملاحظة الإدارة (إلزامية عند الرفض)"></textarea>
        <button class="sk-btn good" data-decide="approved" data-id="${r.id}">${r.request_type === "dorm_transfer" || r.request_type === "room_change" ? "اعتماد وتنفيذ النقل" : "اعتماد"}</button>
        <button class="sk-btn bad" data-decide="rejected" data-id="${r.id}">رفض</button></div>` : ""}
      </article>`).join("") : `<p class="sk-empty">لا توجد طلبات في هذا القسم.</p>`;
    hydrateCardImages(supabase, list);
  }
  document.querySelectorAll("[data-adm-filter]").forEach(b => b.addEventListener("click", () => { filter = b.dataset.admFilter; render(); }));
  list.addEventListener("click", async e => {
    const b = e.target.closest("[data-decide]"); if (!b) return;
    const note = list.querySelector(`[data-note="${b.dataset.id}"]`)?.value.trim() || null;
    b.disabled = true;
    const { data, error } = await supabase.rpc("sakan_decide_request", { p_request_id: b.dataset.id, p_decision: b.dataset.decide, p_note: note });
    if (error) { setMsg(msg, errText(error), "error"); b.disabled = false; return; }
    setMsg(msg, data === "completed" ? "تم اعتماد الطلب وتنفيذ النقل." : data === "rejected" ? "رُفض الطلب." : "تم اعتماد الطلب.", "success");
    load();
  });
  load();
}

/* =============================================
   الإدارة: إضافة الحسابات (فردياً واستيراداً من Excel)
   في صفحة الحسابات admin-students.html
   ============================================= */
const genPassword = () => {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789", buf = new Uint32Array(8);
  crypto.getRandomValues(buf);
  return [...buf].map(n => abc[n % abc.length]).join("");
};

async function loadDormsRooms() {
  const [{ data: dorms }, { data: avail }] = await Promise.all([
    supabase.from("dormitories").select("id, name").eq("is_active", true).order("name"),
    supabase.rpc("sakan_room_availability")
  ]);
  return { dorms: dorms || [], rooms: avail || [] };
}

async function adminAccounts() {
  const form = $("#account-create-form"); if (!form) return;
  const s = await session(["admin"]); if (!s) return;
  const msg = $("#account-create-message");
  let { dorms, rooms } = await loadDormsRooms();
  const f = id => $("#" + id);

  const PREFIX = { supervisor: "supervisor@", security: "security@", admin: "admin@" };
  function fillRooms() {
    const list = rooms.filter(r => r.dormitory_id === f("ac-dorm").value);
    f("ac-room").innerHTML = `<option value="">— بدون غرفة الآن —</option>` + list.map(r => {
      const full = r.occupied >= r.capacity;
      return `<option value="${r.room_id}" ${full ? "disabled" : ""}>${esc(r.room_number)} — ${r.occupied}/${r.capacity}${full ? " ممتلئة" : ""}</option>`;
    }).join("");
  }
  function roleView() {
    const role = f("ac-role").value, student = role === "student";
    f("ac-prefix").textContent = PREFIX[role] || "";
    f("ac-prefix").hidden = student;
    f("ac-user-label").textContent = student ? "الرقم الجامعي" : "اسم المستخدم (بعد @)";
    f("ac-user").placeholder = student ? "مثال: 2024101" : "مثال: mariam";
    f("ac-user").inputMode = student ? "numeric" : "text";
    document.querySelectorAll("[data-ac-student]").forEach(x => x.hidden = !student);
    f("ac-dorm-field").hidden = !(student || role === "supervisor");
  }
  f("ac-dorm").innerHTML = `<option value="">— اختاري السكن —</option>` + dorms.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join("");
  f("ac-role").addEventListener("change", roleView);
  f("ac-dorm").addEventListener("change", fillRooms);
  f("ac-gen").addEventListener("click", () => { f("ac-pass").value = genPassword(); f("ac-pass").type = "text"; });
  roleView(); fillRooms();

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const role = f("ac-role").value;
    const raw = f("ac-user").value.trim();
    const username = role === "student" ? normalizeUsername(raw) : normalizeUsername(PREFIX[role] + raw.replace(/^.*@/, ""));
    if (usernameRole(username) !== role) {
      return setMsg(msg, role === "student" ? "الرقم الجامعي أرقام فقط (3 أرقام على الأقل)." : "اسم المستخدم: حروف إنجليزية وأرقام فقط، حرفان على الأقل، مثل mariam أو gate1.", "error");
    }
    const password = f("ac-pass").value;
    if (password.length < 6) return setMsg(msg, "كلمة المرور يجب ألا تقل عن 6 أحرف.", "error");
    if (role === "supervisor" && !f("ac-dorm").value) return setMsg(msg, "حددي سكن المشرفة.", "error");

    const btn = form.querySelector("[type=submit]"); btn.disabled = true;
    const { error } = await supabase.rpc("sakan_admin_create_account", {
      p_username: username, p_password: password, p_full_name: f("ac-name").value.trim(),
      p_details: {
        dormitory_id: f("ac-dorm").value || null, room_id: role === "student" ? (f("ac-room").value || null) : null,
        fingerprint_id: f("ac-fp").value.trim(), phone: f("ac-phone").value.trim(),
        guardian_name: f("ac-gname").value.trim(), guardian_phone: f("ac-gphone").value.trim()
      }
    });
    btn.disabled = false;
    if (error) return setMsg(msg, errText(error), "error");
    setMsg(msg, `أُنشئ الحساب. اسم الدخول: ${username}  ·  كلمة المرور: ${password}  (أعطيها لصاحبة الحساب)`, "success");
    form.reset(); roleView();
    ({ dorms, rooms } = await loadDormsRooms()); fillRooms();
    if (typeof window.sakanReloadAccounts === "function") window.sakanReloadAccounts();
  });

  setupImport(() => ({ dorms, rooms }), async () => { ({ dorms, rooms } = await loadDormsRooms()); fillRooms(); });
}

/* ---------- الاستيراد من Excel أو CSV ---------- */
const IMPORT_COLUMNS = ["الرقم الجامعي", "الاسم الكامل", "كلمة المرور", "السكن", "الغرفة", "رقم البصمة", "الهاتف", "ولي الأمر", "هاتف ولي الأمر"];

function parseCSV(text) {
  text = text.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/)[0] || "";
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : ",";
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ""));
}

async function readSheet(file) {
  if (/\.(xlsx|xls)$/i.test(file.name)) {
    const XLSX = await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");
    const wb = XLSX.read(await file.arrayBuffer());
    return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" })
      .filter(r => r.some(c => String(c).trim() !== ""));
  }
  return parseCSV(await file.text());
}

function setupImport(getPlaces, onDone) {
  const input = $("#import-file"); if (!input) return;
  const msg = $("#import-message"), out = $("#import-results");
  let created = [];

  $("#import-template").addEventListener("click", () =>
    downloadCSV([IMPORT_COLUMNS, ["2024101", "شيماء سالم الهنائية", "", "السكن الرئيسي", "101", "101", "9xxxxxxx", "سالم الهنائي", "9xxxxxxx"]], "قالب-استيراد-الطالبات.csv"));

  $("#import-credentials").addEventListener("click", () =>
    downloadCSV([["الرقم الجامعي", "الاسم", "كلمة المرور"], ...created.map(c => [c.username, c.name, c.password])], "بيانات-دخول-الطالبات.csv"));

  $("#import-run").addEventListener("click", async () => {
    const file = input.files?.[0];
    if (!file) return setMsg(msg, "اختاري ملف Excel أو CSV أولاً.", "error");
    let rows;
    try { rows = await readSheet(file); }
    catch { return setMsg(msg, "تعذّرت قراءة الملف. احفظيه من Excel بصيغة xlsx أو CSV UTF-8.", "error"); }
    if (rows.length < 2) return setMsg(msg, "الملف فارغ أو بلا صفوف بعد العناوين.", "error");

    const head = rows[0].map(h => String(h).trim());
    const col = name => head.indexOf(name);
    if (col("الرقم الجامعي") < 0 || col("الاسم الكامل") < 0) {
      return setMsg(msg, "يجب أن يحتوي الصف الأول على العناوين: الرقم الجامعي، الاسم الكامل. حمّلي القالب واستخدميه.", "error");
    }
    const { dorms, rooms } = getPlaces();
    const dormByName = new Map(dorms.map(d => [d.name.trim(), d.id]));
    const get = (r, name) => col(name) < 0 ? "" : String(r[col(name)] ?? "").trim();

    $("#import-run").disabled = true;
    created = []; const results = [];
    const data = rows.slice(1);
    for (let i = 0; i < data.length; i++) {
      const r = data[i];
      setMsg(msg, `جارٍ الإنشاء ${i + 1} من ${data.length}...`, "info");
      const username = normalizeUsername(get(r, "الرقم الجامعي"));
      const name = get(r, "الاسم الكامل");
      const password = get(r, "كلمة المرور") || genPassword();
      const dormName = get(r, "السكن"), roomNo = get(r, "الغرفة");
      let dormId = null, roomId = null, note = "";
      if (dormName) {
        dormId = dormByName.get(dormName) || null;
        if (!dormId) note = `السكن "${dormName}" غير موجود`;
      }
      if (dormId && roomNo) {
        roomId = rooms.find(x => x.dormitory_id === dormId && String(x.room_number) === roomNo)?.room_id || null;
        if (!roomId) note = `الغرفة ${roomNo} غير موجودة في ${dormName}`;
      }
      if (note) { results.push({ row: i + 2, username, name, ok: false, text: note }); continue; }
      if (usernameRole(username) !== "student") { results.push({ row: i + 2, username, name, ok: false, text: "الرقم الجامعي غير صالح" }); continue; }

      const { error } = await supabase.rpc("sakan_admin_create_account", {
        p_username: username, p_password: password, p_full_name: name,
        p_details: { dormitory_id: dormId, room_id: roomId, fingerprint_id: get(r, "رقم البصمة"), phone: get(r, "الهاتف"),
                     guardian_name: get(r, "ولي الأمر"), guardian_phone: get(r, "هاتف ولي الأمر") }
      });
      if (error) results.push({ row: i + 2, username, name, ok: false, text: errText(error) });
      else { created.push({ username, name, password }); results.push({ row: i + 2, username, name, ok: true, text: "أُنشئ" }); }
    }
    $("#import-run").disabled = false;
    const okN = results.filter(x => x.ok).length;
    setMsg(msg, `انتهى الاستيراد: أُنشئ ${okN} حساب، وتعذّر ${results.length - okN}.${okN ? " حمّلي ملف بيانات الدخول قبل مغادرة الصفحة." : ""}`, okN ? "success" : "error");
    $("#import-credentials").hidden = !okN;
    out.innerHTML = `<div class="sk-table-wrap"><table class="sk-table"><thead><tr><th>الصف</th><th>الرقم الجامعي</th><th>الاسم</th><th>النتيجة</th></tr></thead><tbody>
      ${results.map(x => `<tr><td class="sk-num">${x.row}</td><td class="sk-num">${esc(x.username)}</td><td>${esc(x.name)}</td><td>${x.ok ? pill(x.text, "good") : pill(x.text, "bad")}</td></tr>`).join("")}
      </tbody></table></div>`;
    await onDone();
    if (typeof window.sakanReloadAccounts === "function") window.sakanReloadAccounts();
  });
}

/* =============================================
   تغيير كلمة المرور (لكل الحسابات)
   ============================================= */
async function accountPage() {
  const s = await session(["student", "supervisor", "security", "admin"]); if (!s) return;
  const HOME = { student: "student-dashboard.html", supervisor: "supervisor-dashboard.html", security: "security-dashboard.html", admin: "admin-dashboard.html" };
  const MOBILE = { student: "m-student.html", supervisor: "m-supervisor.html", security: "m-security.html", admin: "m-admin.html" };
  const onPhone = window.matchMedia("(max-width: 820px)").matches;
  $("#acc-back").href = (onPhone ? MOBILE : HOME)[s.profile.role];
  $("#acc-username").textContent = s.profile.username;
  $("#acc-role").textContent = ROLE_NAMES[s.profile.role];
  $("#acc-name").textContent = s.profile.full_name;
  const msg = $("#acc-message");
  $("#acc-form").addEventListener("submit", async e => {
    e.preventDefault();
    const p1 = $("#acc-pass").value, p2 = $("#acc-pass2").value;
    if (p1.length < 6) return setMsg(msg, "كلمة المرور يجب ألا تقل عن 6 أحرف.", "error");
    if (p1 !== p2) return setMsg(msg, "كلمتا المرور غير متطابقتين.", "error");
    const { error } = await supabase.auth.updateUser({ password: p1 });
    if (error) return setMsg(msg, /same|different/i.test(error.message) ? "اختاري كلمة مرور مختلفة عن الحالية." : "تعذّر تغيير كلمة المرور. حاولي مرة أخرى.", "error");
    e.target.reset();
    setMsg(msg, "تم تغيير كلمة المرور. استخدميها في الدخول القادم.", "success");
  });
}

/* =============================================
   التشغيل حسب الصفحة
   ============================================= */
const PAGES = {
  "student-attendance": studentAttendance,
  "student-hosting": studentHosting,
  "student-transfer": studentTransfer,
  "notifications": notifications,
  "supervisor-attendance": () => attendanceReport(false),
  "admin-attendance": () => attendanceReport(true),
  "admin-edit-user": adminEditUser,
  "admin-rooms": adminRooms,
  "admin-requests": adminRequests,
  "account": accountPage
};
PAGES[page]?.();
fingerprintPanel();
adminAccounts();

// اسم المستخدمة في الشريط العلوي لباقي الصفحات
if (!PAGES[page] && $("#sk-who")) {
  supabase.auth.getUser().then(async ({ data: { user } }) => {
    if (!user) return;
    const { data: p } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
    $("#sk-who").textContent = p?.full_name || user.email;
  });
}

// اسم المستخدمة يفتح صفحة تغيير كلمة المرور
if ($("#sk-who") && !$("#sk-who").closest("a")) {
  const a = document.createElement("a");
  a.href = "account.html"; a.title = "حسابي وتغيير كلمة المرور"; a.style.color = "inherit";
  const who = $("#sk-who");
  who.replaceWith(a); a.append(who);
}

// رابط صفحة الجوال المقابلة لكل صفحة كمبيوتر
(() => {
  const actions = document.querySelector(".header-actions");
  if (!actions || !$("#sk-logout") || $("#sk-mobile-link")) return;
  const file = location.pathname.split("/").pop() || "index.html";
  const type = new URLSearchParams(location.search).get("type");
  const map = {
    "student-dashboard.html": "m-student.html",
    "leave-requests.html": type === "guardian_exit" ? "m-guardian-exit.html" : "m-exit.html",
    "attendance.html": "m-attendance.html",
    "hosting.html": "m-hosting.html",
    "transfer.html": type === "dorm_transfer" ? "m-dorm.html" : "m-room.html",
    "notifications.html": "m-notifications.html",
    "supervisor-dashboard.html": "m-supervisor.html",
    "supervisor-attendance.html": "m-supervisor.html#attendance",
    "security-dashboard.html": "m-security.html"
  };
  const target = map[file] || (file.startsWith("admin-") ? "m-admin.html" : null);
  if (!target) return;
  const a = document.createElement("a");
  a.id = "sk-mobile-link"; a.href = target; a.textContent = "نسخة الجوال";
  a.title = "فتح الصفحة المخصصة للجوال";
  a.style.cssText = "color:var(--gold-light);font-weight:700;font-size:.9rem;text-decoration:none;white-space:nowrap";
  actions.prepend(a);
})();

$("#sk-logout")?.addEventListener("click", async () => { await supabase.auth.signOut(); location.href = "index.html"; });
