
// =============================================
// نظام سَكَن | SAKAN
// الملف الرئيسي main.js
// الجزء الأول: الاتصال والأدوات الأساسية
// =============================================

import { createClient } from
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// =============================================
// 1. إعداد الاتصال بقاعدة بيانات سَكَن
// =============================================

const SUPABASE_URL =
  "https://qvctiztgjcjtpaezfrck.supabase.co";

// ضعي مفتاح anon أو publishable العام من إعدادات Supabase
// لا تضعي service_role أو أي مفتاح سري هنا.
const SUPABASE_ANON_KEY = "sb_publishable_r-C9NyoZgnf5wCqlaMBwEg_TWokuxL4";

import {
  statusPill, gatePill, stepsTrack, loadPlaces, requestDetailsHTML,
  cardImagesHTML, hydrateCardImages, compressImage, TYPE_LABELS,
  usernameRole, loginEmail, ROLE_LABELS, ROLE_LOGIN_PAGES, guardianPill, isExitType, friendlyError, sendGuardianLink
} from "./sakan-shared.js";

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

// =============================================
// 2. أدوات الوصول إلى عناصر الصفحة
// =============================================

const $ = (selector, parent = document) =>
  parent.querySelector(selector);

const $$ = (selector, parent = document) =>
  [...parent.querySelectorAll(selector)];

function setMessage(element, message, type = "info") {
  if (!element) return;

  element.textContent = message;
  element.dataset.type = type;
}

function showMessage(id, message, type = "info") {
  setMessage(document.getElementById(id), message, type);
}

function formatDate(value) {
  if (!value) return "—";

  return new Intl.DateTimeFormat("ar-OM", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

// =============================================
// 3. بيانات الجلسة الحالية
// =============================================

let currentUser = null;
let currentProfile = null;

const ROLES = {
  STUDENT: "student",
  SUPERVISOR: "supervisor",
  SECURITY: "security",
  ADMIN: "admin"
};

async function loadCurrentUser() {
  const { data, error } = await supabase.auth.getUser();

  if (error) throw error;

  currentUser = data.user;

  if (!currentUser) {
    currentProfile = null;
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", currentUser.id)
    .maybeSingle();

  if (profileError) throw profileError;

  currentProfile = profile;

  return {
    user: currentUser,
    profile: currentProfile
  };
}

// =============================================
// 4. التحقق من تسجيل الدخول والدور
// =============================================

async function requireRole(allowedRoles = []) {
  try {
    const session = await loadCurrentUser();

    if (!session?.user) {
      window.location.href = "login.html";
      return false;
    }

    if (!session.profile || !session.profile.is_active) {
      await supabase.auth.signOut();
      alert("الحساب غير نشط أو لم يتم إعداد بياناته.");
      window.location.href = "login.html";
      return false;
    }

    if (
      allowedRoles.length &&
      !allowedRoles.includes(session.profile.role)
    ) {
      alert("ليس لديكِ صلاحية الدخول إلى هذه الصفحة.");
      window.location.href = "index.html";
      return false;
    }

    return true;

  } catch (error) {
    console.error("خطأ التحقق من الحساب:", error);
    alert("تعذر التحقق من بيانات الحساب.");
    return false;
  }
}

// =============================================
// 5. تسجيل الخروج
// =============================================

async function logout() {
  const { error } = await supabase.auth.signOut();

  if (error) {
    console.error("خطأ تسجيل الخروج:", error);
    alert("تعذر تسجيل الخروج.");
    return;
  }

  window.location.href = "login.html";
}

// =============================================
// 6. ربط أزرار تسجيل الخروج
// =============================================

function setupLogoutButtons() {
  const logoutIds = [
    "logout-button",
    "security-logout-button",
    "admin-logout-button"
  ];

  logoutIds.forEach(id => {
    const button = document.getElementById(id);

    if (!button) return;

    button.addEventListener("click", async event => {
      event.preventDefault();
      await logout();
    });
  });
}

// =============================================
// 7. الاستماع لتغييرات حالة تسجيل الدخول
// =============================================

supabase.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_OUT") {
    currentUser = null;
    currentProfile = null;
  }
});

// =============================================
// 8. تهيئة الملف
// =============================================

setupLogoutButtons();

console.log("تم تحميل أساسيات نظام سَكَن.");

// =============================================
// نظام سَكَن | SAKAN
// الجزء الثاني: تسجيل الدخول وإنشاء الحساب
// =============================================

// =============================================
// 1. تحديد صفحة الدخول حسب الدور
// =============================================

const ROLE_PAGES = {
  student: "student-dashboard.html",
  supervisor: "supervisor-dashboard.html",
  security: "security-dashboard.html",
  admin: "admin-dashboard.html"
};


// =============================================
// 2. تسجيل الدخول
// =============================================

async function handleLogin(formId, emailId, passwordId, messageId, expectedRole = null) {
  const form = document.getElementById(formId);

  if (!form) return;

  form.addEventListener("submit", async event => {
    event.preventDefault();

    const username = document.getElementById(emailId)?.value.trim();
    const password = document.getElementById(passwordId)?.value;
    const message = document.getElementById(messageId);
    const isStudentPage = expectedRole === ROLES.STUDENT;

    if (!username || !password) {
      setMessage(message, isStudentPage ? "يرجى إدخال الرقم الجامعي وكلمة المرور." : "يرجى إدخال اسم المستخدم وكلمة المرور.", "error");
      return;
    }

    // نوع الحساب يُعرف من اسم الدخول نفسه
    const role = usernameRole(username);

    if (!role) {
      setMessage(
        message,
        isStudentPage
          ? "الرقم الجامعي يتكون من أرقام فقط."
          : `اسم المستخدم يبدأ بـ ${expectedRole}@ ثم اسم بحروف إنجليزية، مثل ${{ supervisor: "supervisor@mariam", security: "security@gate1", admin: "admin@ahmed" }[expectedRole]}.`,
        "error"
      );
      return;
    }

    if (expectedRole && role !== expectedRole) {
      setMessage(message, `هذا حساب ${ROLE_LABELS[role]}، ولا يمكن الدخول به من صفحة دخول ${ROLE_LABELS[expectedRole]}.`, "error");
      const link = document.createElement("a");
      link.href = ROLE_LOGIN_PAGES[role];
      link.textContent = " الانتقال إلى صفحة الدخول الصحيحة";
      message?.append(link);
      return;
    }

    const email = loginEmail(username);

    const submitButton = form.querySelector('[type="submit"]');

    if (submitButton) submitButton.disabled = true;

    setMessage(message, "جارٍ التحقق من بيانات الدخول...", "info");

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        throw new Error(
          /invalid login credentials/i.test(error.message)
            ? (isStudentPage ? "الرقم الجامعي أو كلمة المرور غير صحيحة." : "اسم المستخدم أو كلمة المرور غير صحيحة.")
            : /email not confirmed/i.test(error.message)
              ? "الحساب غير مفعّل. راجعي الإدارة."
              : "تعذر تسجيل الدخول. حاولي مرة أخرى."
        );
      }

      const session = await loadCurrentUser();

      if (!session?.profile) {
        await supabase.auth.signOut();
        throw new Error("لا يوجد ملف مستخدم مرتبط بهذا الحساب. يرجى مراجعة الإدارة.");
      }

      const profile = session.profile;

      if (!profile.is_active) {
        await supabase.auth.signOut();
        throw new Error("هذا الحساب غير نشط. يرجى مراجعة الإدارة.");
      }

      if (expectedRole && profile.role !== expectedRole) {
        await supabase.auth.signOut();
        const err = new Error(
          `هذا حساب ${ROLE_LABELS[profile.role] || "آخر"}، ولا يمكن الدخول به من صفحة دخول ${ROLE_LABELS[expectedRole]}.`
        );
        err.loginPage = ROLE_LOGIN_PAGES[profile.role];
        throw err;
      }

      // على الجوال تُفتح صفحة الجوال الخاصة بالدور
      const MOBILE_PAGES = { student: "m-student.html", supervisor: "m-supervisor.html", security: "m-security.html", admin: "m-admin.html" };
      const onPhone = window.matchMedia("(max-width: 820px)").matches || /Android|iPhone|iPod|Mobile/i.test(navigator.userAgent);
      const destination = (onPhone ? MOBILE_PAGES : ROLE_PAGES)[profile.role];

      if (!destination) {
        await supabase.auth.signOut();
        throw new Error("نوع الحساب غير معروف. يرجى مراجعة الإدارة.");
      }

      setMessage(message, "تم تسجيل الدخول بنجاح.", "success");

      window.location.href = destination;

    } catch (error) {
      console.error("Login error:", error);

      setMessage(
        message,
        error.message || "تعذر تسجيل الدخول.",
        "error"
      );

      if (error.loginPage && message) {
        const link = document.createElement("a");
        link.href = error.loginPage;
        link.textContent = " الانتقال إلى صفحة الدخول الصحيحة";
        message.append(link);
      }

    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

// =============================================
// 3. ربط صفحات تسجيل الدخول
// =============================================

handleLogin(
  "login-form",
  "login-email",
  "login-password",
  "auth-message",
  ROLES.STUDENT
);

handleLogin(
  "supervisor-login-form",
  "supervisor-email",
  "supervisor-password",
  "supervisor-auth-message",
  ROLES.SUPERVISOR
);

handleLogin(
  "security-login-form",
  "security-email",
  "security-password",
  "security-auth-message",
  ROLES.SECURITY
);

handleLogin(
  "admin-login-form",
  "admin-email",
  "admin-password",
  "admin-login-message",
  ROLES.ADMIN
);

// إنشاء الحسابات لكل دور: انظر signupPage في sakan-features.js

// =============================================
// نظام سَكَن | SAKAN
// الجزء الثالث: لوحة الطالبة وطلبات الخدمات
// =============================================

// =============================================
// 1. أسماء حالات الطلبات
// =============================================

const REQUEST_STATUS_LABELS = {
  pending_supervisor: "بانتظار موافقة المشرفة",
  pending_admin: "بانتظار موافقة الإدارة",
  approved: "تمت الموافقة",
  rejected: "مرفوض",
  cancelled: "ملغي",
  completed: "مكتمل"
};

const REQUEST_TYPE_LABELS = {
  exit_permit: "استئذان خروج",
  hosting: "استضافة",
  dorm_transfer: "نقل بين السكنات",
  room_change: "تغيير الغرفة"
};

// =============================================
// 2. عرض بيانات الطالبة
// =============================================

async function loadStudentDashboard() {
  const studentEmail = document.getElementById("student-email");
  const dashboardMessage = document.getElementById("dashboard-message");

  if (studentEmail && currentUser) {
    studentEmail.textContent = currentProfile?.full_name ||
      currentUser.email ||
      "الطالبة";
  }

  if (dashboardMessage) {
    setMessage(dashboardMessage, "مرحبًا بكِ في نظام سَكَن.", "success");
  }

  await loadStudentRequests();
}

// =============================================
// 3. جلب طلبات الطالبة
// =============================================

async function loadStudentRequests() {
  const list = document.getElementById("my-requests-list");

  if (!list || !currentProfile) return;

  list.innerHTML = "<p>جارٍ تحميل طلباتك...</p>";

  try {
    const { data, error } = await supabase
      .from("service_requests")
      .select("*")
      .eq("student_id", currentProfile.id)
      .in("request_type", document.getElementById("leave-request-form")?.dataset.fixedType
        ? [document.getElementById("leave-request-form").dataset.fixedType]
        : ["exit_permit", "guardian_exit"])
      .order("created_at", { ascending: false });

    if (error) throw error;

    if (!data || data.length === 0) {
      list.innerHTML = "<p>لا توجد طلبات حتى الآن.</p>";
      return;
    }

    list.innerHTML = data.map(request => `
      <article class="request-card sk-req">
        <div class="sk-req-head">
          <h3>${escapeHTML(TYPE_LABELS[request.request_type] || request.request_type)}</h3>
          <div class="sk-row">${statusPill(request.status)}${gatePill(request)}</div>
        </div>
        ${stepsTrack(request)}
        ${requestDetailsHTML(request)}
      </article>
    `).join("");

  } catch (error) {
    console.error("Student requests error:", error);

    list.innerHTML =
      "<p>تعذر تحميل الطلبات. تحققي من اتصال قاعدة البيانات وصلاحيات RLS.</p>";
  }
}

// =============================================
// 4. إرسال طلب خدمة جديد
// =============================================

// تجهيز نموذج التصريح: نوع "بموافقة ولي الأمر"، بيانات المرافق، والبطاقات المحفوظة
async function enhanceRequestForm(form) {
  const typeSelect = form.querySelector("#request-type");

  if (typeSelect && !typeSelect.querySelector('option[value="guardian_exit"]')) {
    typeSelect.insertAdjacentHTML(
      "beforeend",
      '<option value="guardian_exit">خروج مع مرافق بموافقة ولي الأمر (واتساب)</option>'
    );
  }

  // بيانات المرافق
  const typeGroup = typeSelect?.closest(".form-group") || typeSelect;
  if (typeGroup && !form.querySelector("#companion-fields")) {
    typeGroup.insertAdjacentHTML("afterend", `
      <div id="companion-fields" class="document-section" hidden>
        <h3>الشخص الذي ستخرجين معه</h3>
        <p class="sk-note">تصل لولي أمرك رسالة واتساب يوافق فيها أو يرفض خروجك مع هذا الشخص، ثم يصل رده للمشرفة.</p>
        <div class="form-group"><label for="companion-name">اسم المرافق</label><input id="companion-name" type="text" placeholder="الاسم الكامل"></div>
        <div class="form-group"><label for="companion-relation">صلة القرابة</label>
          <select id="companion-relation"><option>أب</option><option>أم</option><option>أخ</option><option>أخت</option><option>عم</option><option>خال</option><option>عمة</option><option>خالة</option><option>زوج</option><option>سائق معتمد</option><option>أخرى</option></select></div>
        <div class="form-group"><label for="companion-phone">هاتف المرافق</label><input id="companion-phone" type="tel" inputmode="tel" dir="ltr"></div>
        <div class="form-group"><label for="companion-civil">الرقم المدني للمرافق (اختياري)</label><input id="companion-civil" inputmode="numeric" dir="ltr"></div>
      </div>`);
  }

  // صفحة مخصصة لنوع واحد (صفحات الجوال) أو نوع محدد من الرابط ?type=
  const fixedType = form.dataset.fixedType;
  const wanted = fixedType || new URLSearchParams(location.search).get("type");
  if (typeSelect && wanted && typeSelect.querySelector(`option[value="${wanted}"]`)) {
    typeSelect.value = wanted;
    if (fixedType && typeGroup) typeGroup.hidden = true;
  }

  // البطاقات المحفوظة
  const docs = form.querySelector("#student-card-image")?.closest(".document-section");
  const p = currentProfile || {};
  const hasSaved = Boolean(p.student_card_path && p.guardian_card_path);

  if (docs && !form.querySelector("#saved-cards")) {
    docs.insertAdjacentHTML("beforebegin", `
      <div id="saved-cards" class="document-section" ${hasSaved ? "" : "hidden"}>
        <h3>بطاقاتك المحفوظة</h3>
        <div class="sk-cards">
          <figure><img alt="بطاقة الطالبة" data-card-path="${escapeHTML(p.student_card_path || "")}"><figcaption>${escapeHTML(p.student_card_name || "بطاقة الطالبة")} · <span class="sk-num">${escapeHTML(p.student_card_civil || "")}</span></figcaption></figure>
          <figure><img alt="بطاقة ولي الأمر" data-card-path="${escapeHTML(p.guardian_card_path || "")}"><figcaption>${escapeHTML(p.guardian_card_name || "بطاقة ولي الأمر")} · <span class="sk-num">${escapeHTML(p.guardian_card_civil || "")}</span></figcaption></figure>
        </div>
        <label style="display:flex;gap:8px;align-items:center;margin-top:10px;font-weight:600">
          <input type="checkbox" id="use-saved-cards" ${hasSaved ? "checked" : ""} style="width:auto"> استخدام البطاقات المحفوظة
        </label>
        <p class="sk-note" style="margin-top:6px">أزيلي العلامة إذا تغيّرت بطاقتك أو بطاقة ولي الأمر، وارفعي الجديدة. تُحفظ كل بطاقة ترفعينها في ملفك.</p>
      </div>`);
    if (hasSaved) hydrateCardImages(supabase, form.querySelector("#saved-cards"));
  }

  const fileInputs = [form.querySelector("#student-card-image"), form.querySelector("#guardian-card-image")].filter(Boolean);
  const syncCards = () => {
    const useSaved = form.querySelector("#use-saved-cards")?.checked && hasSaved;
    if (docs) docs.hidden = Boolean(useSaved);
    fileInputs.forEach(input => { input.required = !useSaved; });
  };
  const syncType = () => {
    if (fixedType && typeSelect) typeSelect.value = fixedType;
    const box = form.querySelector("#companion-fields");
    const guardian = typeSelect?.value === "guardian_exit";
    if (box) box.hidden = !guardian;
    const name = form.querySelector("#companion-name");
    if (name) name.required = guardian;
  };

  form.querySelector("#use-saved-cards")?.addEventListener("change", syncCards);
  typeSelect?.addEventListener("change", syncType);
  syncCards();
  syncType();
  return { syncCards, syncType };
}

function setupStudentRequestForm() {
  const form = document.getElementById("leave-request-form");

  if (!form || form.dataset.bound) return;
  form.dataset.bound = "true";

  const ready = enhanceRequestForm(form);

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const { syncCards, syncType } = await ready;

    const message = document.getElementById("submit-request-message");
    const button = document.getElementById("submit-request-button");

    if (!currentProfile) {
      setMessage(message, "تعذر تحديد حساب الطالبة.", "error");
      return;
    }

    const requestType = $("#request-type")?.value;
    const startValue = $("#request-start")?.value;
    const endValue = $("#request-end")?.value;
    const detailsText = $("#request-details")?.value.trim() || "";
    const destination = $("#request-destination")?.value.trim() || "";

    if (!["exit_permit", "guardian_exit"].includes(requestType)) {
      setMessage(message, "اختاري نوع التصريح.", "error");
      return;
    }

    if (!startValue || !endValue) {
      setMessage(message, "يرجى تحديد وقت المغادرة ووقت العودة.", "error");
      return;
    }

    const startDate = new Date(startValue);
    const endDate = new Date(endValue);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
      setMessage(message, "يجب أن يكون وقت العودة بعد وقت المغادرة.", "error");
      return;
    }

    let companion = null;
    if (requestType === "guardian_exit") {
      companion = {
        full_name: $("#companion-name")?.value.trim() || "",
        relationship: $("#companion-relation")?.value || "",
        phone: $("#companion-phone")?.value.trim() || "",
        civil_id: $("#companion-civil")?.value.trim() || ""
      };
      if (!companion.full_name) {
        setMessage(message, "اكتبي اسم الشخص الذي ستخرجين معه.", "error");
        return;
      }
    }

    const useSaved = Boolean($("#use-saved-cards")?.checked && currentProfile.student_card_path && currentProfile.guardian_card_path);
    let studentCard, guardianCard;

    if (useSaved) {
      studentCard = { full_name: currentProfile.student_card_name, id_number: currentProfile.student_card_civil, image_path: currentProfile.student_card_path };
      guardianCard = { full_name: currentProfile.guardian_card_name, id_number: currentProfile.guardian_card_civil, image_path: currentProfile.guardian_card_path };
    } else {
      const studentFile = $("#student-card-image")?.files?.[0];
      const guardianFile = $("#guardian-card-image")?.files?.[0];

      if (!studentFile || !guardianFile) {
        setMessage(message, "يرجى إرفاق صورة البطاقة الشخصية للطالبة وصورة بطاقة ولي الأمر.", "error");
        return;
      }

      studentCard = { full_name: $("#ocr-student-name")?.value?.trim() || null, id_number: $("#ocr-student-number")?.value?.trim() || null, file: studentFile };
      guardianCard = { full_name: $("#ocr-guardian-name")?.value?.trim() || null, id_number: $("#ocr-guardian-number")?.value?.trim() || null, file: guardianFile };

      if (!studentCard.full_name || !studentCard.id_number || !guardianCard.full_name || !guardianCard.id_number) {
        setMessage(message, "اقرئي البطاقتين أو اكتبي الاسم والرقم المدني لكل منهما.", "error");
        return;
      }
    }

    if (button) button.disabled = true;

    try {
      // البطاقات الجديدة: رفع ثم حفظ دائم في ملف الطالبة وأرشيفها
      if (!useSaved) {
        setMessage(message, "جارٍ رفع صور البطاقات وحفظها في ملفك...", "info");
        const stamp = Date.now();

        for (const [kind, card] of [["student", studentCard], ["guardian", guardianCard]]) {
          const path = `${currentProfile.id}/${stamp}-${kind}.jpg`;
          const blob = await compressImage(card.file);
          const { error: uploadError } = await supabase.storage
            .from("id-cards")
            .upload(path, blob, { contentType: "image/jpeg", upsert: false });
          if (uploadError) throw uploadError;

          const { error: saveError } = await supabase.rpc("sakan_save_my_card", {
            p_kind: kind, p_path: path, p_name: card.full_name, p_civil: card.id_number
          });
          if (saveError) throw saveError;

          card.image_path = path;
          delete card.file;
        }

        await loadCurrentUser();
      }

      setMessage(message, "جارٍ إرسال الطلب...", "info");

      const { data: created, error } = await supabase
        .from("service_requests")
        .insert({
          student_id: currentProfile.id,
          request_type: requestType,
          status: "pending_supervisor",
          start_at: startDate.toISOString(),
          end_at: endDate.toISOString(),
          details: {
            description: detailsText,
            destination,
            student_card: studentCard,
            guardian_card: guardianCard,
            ...(companion ? { companion } : {})
          }
        })
        .select("id")
        .single();

      if (error) throw error;

      if (requestType === "guardian_exit") {
        setMessage(message, "جارٍ إرسال رسالة واتساب لولي أمرك...", "info");
        const { data: sent, error: sendError } = await supabase.functions.invoke("whatsapp-send", {
          body: { request_id: created.id }
        });

        if (sendError || !sent?.ok) {
          // الإرسال التلقائي غير مفعّل أو فشل ← تُبلَّغ المشرفة لترسل رابط الموافقة بنفسها
          await supabase.rpc("sakan_guardian_client_failed", {
            p_request_id: created.id,
            p_error: sent?.error || sendError?.message || null
          });
          setMessage(message, "أُرسل الطلب. ستُرسل المشرفة لولي أمرك رابط الموافقة على واتساب، وسيصلها رده.", "success");
        } else {
          setMessage(message, "أُرسل الطلب، ووصلت لولي أمرك رسالة واتساب للموافقة. سيصل رده للمشرفة.", "success");
        }
      } else {
        setMessage(message, "تم إرسال الطلب بنجاح، وهو الآن بانتظار موافقة المشرفة.", "success");
      }

      const keep = message.textContent, type = message.dataset.type;
      form.reset();
      syncCards(); syncType();
      setMessage(message, keep, type);

      await loadStudentRequests();

    } catch (error) {
      console.error("Submit request error:", error);

      const text = friendlyError(error, "تعذر إرسال الطلب. حاولي مرة أخرى.");

      setMessage(message, text, "error");

    } finally {
      if (button) button.disabled = false;
    }
  });
}

// =============================================
// 5. تهيئة صفحات الطالبة
// =============================================

async function initializeStudentPages() {
  const isStudentPage =
    document.getElementById("student-email") ||
    document.getElementById("leave-request-form");

  if (!isStudentPage) return;

  const allowed = await requireRole([ROLES.STUDENT]);

  if (!allowed) return;

  await loadStudentDashboard();

  setupStudentRequestForm();
}

// =============================================
// 6. تشغيل الجزء الثالث
// =============================================

initializeStudentPages();

// =============================================
// نظام سَكَن | SAKAN
// الجزء الرابع: لوحة المشرفة
// =============================================

let supervisorRequests = [];
let supervisorCurrentFilter = "pending_supervisor";

// =============================================
// 1. جلب الطلبات
// =============================================

let supervisorPlaces = null;

async function loadSupervisorRequests() {
  const container = document.getElementById("requests-list");
  const message = document.getElementById("dashboard-message");

  if (!container) return;

  container.innerHTML = "<p>جارٍ تحميل الطلبات...</p>";

  try {
    if (!supervisorPlaces) supervisorPlaces = await loadPlaces(supabase);

    const { data, error } = await supabase
      .from("service_requests")
      .select("*, student:profiles!service_requests_student_id_fkey(full_name, student_number)")
      .order("created_at", { ascending: false });

    if (error) throw error;

    supervisorRequests = data || [];

    updateSupervisorStatistics();
    renderSupervisorRequests();

    setMessage(message, "تم تحديث قائمة الطلبات.", "success");

  } catch (error) {
    console.error("Supervisor requests error:", error);

    container.innerHTML =
      "<p>تعذر تحميل الطلبات. تحققي من صلاحيات العرض في قاعدة البيانات.</p>";

    setMessage(message, "حدث خطأ أثناء تحميل الطلبات.", "error");
  }
}

// =============================================
// 2. تحديث الإحصائيات
// =============================================

function updateSupervisorStatistics() {
  const pending = supervisorRequests.filter(
    item => item.status === "pending_supervisor"
  ).length;

  const approved = supervisorRequests.filter(
    item => item.status === "approved"
  ).length;

  const rejected = supervisorRequests.filter(
    item => item.status === "rejected"
  ).length;

  const pendingElement = document.getElementById("pending-count");
  const approvedElement = document.getElementById("approved-count");
  const rejectedElement = document.getElementById("rejected-count");

  if (pendingElement) pendingElement.textContent = pending;
  if (approvedElement) approvedElement.textContent = approved;
  if (rejectedElement) rejectedElement.textContent = rejected;
}

// =============================================
// 3. عرض الطلبات
// =============================================


function renderSupervisorRequests() {
  const container = document.getElementById("requests-list");

  if (!container) return;

  let filtered = supervisorRequests;

  if (supervisorCurrentFilter !== "all") {
    filtered = supervisorRequests.filter(
      item => item.status === supervisorCurrentFilter
    );
  }

  if (filtered.length === 0) {
    container.innerHTML = "<p>لا توجد طلبات في هذا القسم.</p>";
    return;
  }

  const approveLabel = {
    exit_permit: "✓ موافقة وإرسال للأمن",
    guardian_exit: "✓ موافقة وإرسال للأمن",
    hosting: "✓ موافقة على الاستضافة",
    room_change: "✓ موافقة وتنفيذ تغيير الغرفة",
    dorm_transfer: "✓ موافقة وإحالة للإدارة"
  };

  const id = request => escapeHTML(request.id);
  const noteBox = request => `
    <textarea class="supervisor-decision-note" data-note-for="${id(request)}"
      placeholder="ملاحظة المشرفة (إلزامية عند الرفض)" rows="2"></textarea>`;
  const rejectBtn = request => `
    <button type="button" class="reject-request-button sk-btn bad" data-action="rejected" data-request-id="${id(request)}">✕ رفض الطلب</button>`;

  function actions(request) {
    // بانتظار رد ولي الأمر: إعادة الإرسال أو تسجيل الرد هاتفياً
    if (request.status === "pending_guardian") {
      return `
        <div class="request-actions sk-actions">
          <button type="button" class="sk-btn gold" data-guardian="link" data-request-id="${id(request)}">إرسال رابط الموافقة لولي الأمر على واتساب</button>
          <button type="button" class="sk-btn" data-guardian="resend" data-request-id="${id(request)}">إعادة الإرسال التلقائي (Meta)</button>
          <button type="button" class="sk-btn good" data-guardian="approved" data-request-id="${id(request)}">ولي الأمر وافق (اتصال هاتفي)</button>
          <button type="button" class="sk-btn bad" data-guardian="rejected" data-request-id="${id(request)}">ولي الأمر رفض (اتصال هاتفي)</button>
        </div>
        <div class="request-actions sk-actions">${noteBox(request)}${rejectBtn(request)}</div>`;
    }
    if (request.status !== "pending_supervisor") return "";
    const canApprove = request.request_type !== "guardian_exit" || request.guardian_status === "approved";
    return `
      <div class="request-actions sk-actions">
        ${noteBox(request)}
        ${canApprove ? `<button type="button" class="approve-request-button sk-btn good" data-action="approved" data-request-id="${id(request)}">${approveLabel[request.request_type] || "✓ موافقة"}</button>` : ""}
        ${rejectBtn(request)}
      </div>`;
  }

  container.innerHTML = filtered.map(request => `
    <article class="request-card sk-req" data-request-id="${id(request)}">
      <div class="sk-req-head">
        <h3>${escapeHTML(TYPE_LABELS[request.request_type] || request.request_type)}</h3>
        <div class="sk-row">${statusPill(request.status)}${guardianPill(request)}${gatePill(request)}</div>
      </div>
      ${stepsTrack(request)}
      ${requestDetailsHTML(request, supervisorPlaces)}
      ${cardImagesHTML(request)}
      ${actions(request)}
    </article>
  `).join("");

  hydrateCardImages(supabase, container);
}

// =============================================
// 5. زر تحديث الطلبات
// =============================================

function setupSupervisorRefresh() {
  const button = document.getElementById("refresh-requests");

  if (!button) return;

  button.addEventListener("click", async () => {
    button.disabled = true;

    await loadSupervisorRequests();

    button.disabled = false;
  });
}

// =============================================
// 6. تهيئة لوحة المشرفة
// =============================================
// إعداد أزرار تصفية طلبات المشرفة
function setupSupervisorFilters() {
  const filterButtons = document.querySelectorAll("[data-filter]");

  filterButtons.forEach(button => {
    button.addEventListener("click", () => {
      supervisorCurrentFilter = button.dataset.filter;

      filterButtons.forEach(item => {
        item.classList.remove("active");
      });

      button.classList.add("active");

      renderSupervisorRequests();
    });
  });
}

// =============================================
// تنفيذ قرارات المشرفة: موافقة أو رفض
// =============================================

// إعادة إرسال واتساب، أو تسجيل رد ولي الأمر بعد اتصال هاتفي
async function handleGuardianAction(button) {
  const requestId = button.dataset.requestId;
  const action = button.dataset.guardian;
  const message = document.getElementById("dashboard-message");
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "جارٍ التنفيذ...";

  try {
    let text, type = "success";
    if (action === "link") {
      const sent = await sendGuardianLink(supabase, requestId);
      text = sent.local
        ? "فُتح واتساب برسالة الموافقة. تنبيه: الموقع يعمل الآن من جهازك، فلن يفتح الرابط عند ولي الأمر قبل رفع الموقع على الاستضافة."
        : `فُتح واتساب برسالة الموافقة لرقم ولي الأمر ${sent.phone}. اضغطي "إرسال" في واتساب، وسيصل رده هنا تلقائياً.`;
      if (sent.local) type = "error";
    } else if (action === "resend") {
      const { data, error } = await supabase.functions.invoke("whatsapp-send", { body: { request_id: requestId } });
      if (error || !data?.ok) throw new Error(data?.error || "الإرسال التلقائي غير مفعّل بعد (يحتاج إعداد Meta). استخدمي زر رابط الموافقة.");
      text = "أُعيد إرسال رسالة الموافقة لولي الأمر.";
    } else {
      const note = document.querySelector(`[data-note-for="${requestId}"]`)?.value.trim() || null;
      const { error } = await supabase.rpc("sakan_guardian_manual", { p_request_id: requestId, p_answer: action, p_note: note });
      if (error) throw error;
      text = action === "approved" ? "سُجّلت موافقة ولي الأمر. يمكنك الآن اعتماد الطلب." : "سُجّل رفض ولي الأمر.";
    }
    await loadSupervisorRequests();
    setMessage(message, text, type);   // بعد تحديث القائمة حتى لا تُستبدل الرسالة
  } catch (error) {
    setMessage(message, friendlyError(error, "تعذّر تنفيذ الإجراء."), "error");
    button.disabled = false;
    button.textContent = original;
  }
}

function setupSupervisorDecisionActions() {
  const container = document.getElementById("requests-list");

  if (!container || container.dataset.decisionBound) return;

  container.dataset.decisionBound = "true";

  container.addEventListener("click", async event => {
    const button = event.target.closest(
      "[data-action][data-request-id]"
    );

    const guardianButton = event.target.closest("[data-guardian][data-request-id]");

    if (guardianButton) {
      await handleGuardianAction(guardianButton);
      return;
    }

    if (!button) return;

    const requestId = button.dataset.requestId;
    const decision = button.dataset.action;

    if (!["approved", "rejected"].includes(decision)) return;

    const noteField = container.querySelector(
      `[data-note-for="${requestId}"]`
    );

    const note = noteField?.value.trim() || "";

    if (decision === "rejected" && !note) {
      alert("يرجى كتابة سبب رفض الطلب.");
      noteField?.focus();
      return;
    }

    const confirmation =
      decision === "approved"
        ? "هل تريدين الموافقة على هذا الطلب؟"
        : "هل أنت متأكدة من رفض الطلب؟";

    if (!confirm(confirmation)) return;

    button.disabled = true;

    try {
      const { data: newStatus, error } = await supabase.rpc(
        "sakan_decide_request",
        {
          p_request_id: requestId,
          p_decision: decision,
          p_note: note || null
        }
      );

      if (error) throw error;

      setMessage(
        document.getElementById("dashboard-message"),
        decision === "rejected"
          ? "تم رفض الطلب بنجاح."
          : newStatus === "completed"
            ? "تمت الموافقة وتنفيذ تغيير الغرفة."
            : newStatus === "pending_admin"
              ? "تمت الموافقة وإحالة طلب النقل للإدارة."
              : "تمت الموافقة على الطلب.",
        "success"
      );

      await loadSupervisorRequests();

    } catch (error) {
      console.error("Supervisor decision error:", error);

      alert(
        error.message || "تعذر تنفيذ القرار. يرجى المحاولة مرة أخرى."
      );

      button.disabled = false;
    }
  });
}

async function initializeSupervisorDashboard() {
  if (!document.getElementById("requests-list")) return;

  const allowed = await requireRole([ROLES.SUPERVISOR]);

  if (!allowed) return;

  const emailElement = document.getElementById("student-email");

  if (emailElement && currentProfile) {
    emailElement.textContent =
      currentProfile.full_name || currentUser.email;
  }

  setupSupervisorFilters();
  setupSupervisorRefresh();
  setupSupervisorDecisionActions();

  await loadSupervisorRequests();
}

// =============================================
// 7. تشغيل الجزء الرابع
// =============================================

initializeSupervisorDashboard();

// =============================================
// نظام سَكَن | SAKAN
// الجزء الخامس: لوحة الأمن
// =============================================

let securityRequests = [];

// =============================================
// 1. تسميات حالات الأمن
// =============================================

const SECURITY_STATUS_LABELS = {
  not_received: "لم يتم استلام البطاقة",
  received: "تم استلام البطاقة",
  verified: "تم التحقق من البطاقة",
  mismatch: "يوجد اختلاف في البيانات"
};

// =============================================
// 2. تحميل طلبات الأمن
// =============================================


async function loadSecurityRequests() {
  const container = document.getElementById(
    "security-requests-container"
  );

  const message = document.getElementById(
    "security-dashboard-message"
  );

  if (!container) return;

  container.innerHTML = "<p>جارٍ تحميل الطلبات...</p>";

  try {
    const since = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 19) + "Z";

    const { data, error } = await supabase
      .from("service_requests")
      .select("*, student:profiles!service_requests_student_id_fkey(full_name, student_number)")
      .in("request_type", ["exit_permit", "guardian_exit", "hosting"])
      .or(`status.eq.approved,and(status.eq.completed,created_at.gte.${since})`)
      .order("created_at", { ascending: false });

    if (error) throw error;

    securityRequests = data || [];

    updateSecurityStatistics();
    renderSecurityRequests();

    setMessage(message, "تم تحديث بيانات الأمن.", "success");

  } catch (error) {
    console.error("Security requests error:", error);

    container.innerHTML =
      "<p>تعذر تحميل الطلبات. تحققي من صلاحيات الأمن وسياسات RLS.</p>";

    setMessage(message, "حدث خطأ أثناء تحميل الطلبات.", "error");
  }
}

// =============================================
// 3. تحديث إحصائيات الأمن
// =============================================

function updateSecurityStatistics() {
  const exits = securityRequests.filter(r => isExitType(r.request_type) && r.status === "approved");

  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  set("security-total", exits.length);
  set("security-pending", exits.filter(r => !r.security_status || r.security_status === "not_received").length);
  set("security-received", exits.filter(r => r.security_status === "received").length);
  set("security-verified", exits.filter(r => r.security_status === "verified" && !r.gate_out_at).length);
  set("security-out", exits.filter(r => r.gate_out_at && !r.gate_in_at).length);
  set("security-guests", securityRequests.filter(r => r.request_type === "hosting" && r.status === "approved").length);
}

// =============================================
// 4. عرض الطلبات في لوحة الأمن
// =============================================

function securityActionsHTML(request) {
  const id = escapeHTML(request.id);
  const btn = (attr, label, tone = "primary") =>
    `<button type="button" class="security-action-button sk-btn ${tone}" ${attr} data-request-id="${id}">${label}</button>`;

  if (request.status !== "approved") return "";

  if (isExitType(request.request_type)) {
    if (!request.security_status || request.security_status === "not_received") return btn('data-action="received"', "✓ تم استلام البطاقة");
    if (request.security_status === "received") return btn('data-action="verified"', "✓ تم التحقق من البطاقة");
    if (request.security_status === "verified" && !request.gate_out_at) return btn('data-gate="out"', "تسجيل خروج الطالبة", "gold");
    if (request.gate_out_at && !request.gate_in_at) return btn('data-gate="in"', "تسجيل عودة الطالبة", "gold");
  }

  if (request.request_type === "hosting") {
    if (!request.gate_in_at) return btn('data-gate="in"', "تسجيل دخول الضيفة", "gold");
    if (!request.gate_out_at) return btn('data-gate="out"', "تسجيل مغادرة الضيفة", "gold");
  }
  return "";
}

function renderSecurityRequests() {
  const container = document.getElementById(
    "security-requests-container"
  );

  if (!container) return;

  if (securityRequests.length === 0) {
    container.innerHTML =
      "<p>لا توجد طلبات متاحة للأمن حاليًا.</p>";
    return;
  }

  // الطلبات التي تحتاج إجراء أولاً، ثم المكتملة
  const ordered = [...securityRequests].sort((a, b) =>
    (a.status === "completed") - (b.status === "completed"));

  container.innerHTML = ordered.map(request => {
    const actions = securityActionsHTML(request);

    return `
      <article class="request-card sk-req" data-request-id="${escapeHTML(request.id)}">
        <div class="sk-req-head">
          <h3>${escapeHTML(TYPE_LABELS[request.request_type] || request.request_type)}</h3>
          <div class="sk-row">${statusPill(request.status)}${gatePill(request)}</div>
        </div>
        ${stepsTrack(request)}
        ${requestDetailsHTML(request)}
        ${cardImagesHTML(request)}
        ${actions ? `<div class="security-actions sk-actions">${actions}</div>` : ""}
      </article>
    `;
  }).join("");

  hydrateCardImages(supabase, container);
}

// =============================================
// 5. زر تحديث لوحة الأمن
// =============================================

function setupSecurityRefresh() {
  const button = document.getElementById(
    "security-refresh-button"
  );

  if (!button) return;

  button.addEventListener("click", async () => {
    button.disabled = true;

    try {
      await loadSecurityRequests();
    } finally {
      button.disabled = false;
    }
  });
}

// =============================================
// 6. تهيئة لوحة الأمن
// =============================================

function setupSecurityActions() {
  const container = document.getElementById(
    "security-requests-container"
  );

  if (!container) return;

  container.addEventListener("click", async event => {
    const button = event.target.closest(".security-action-button");

    if (!button) return;

    const requestId = button.dataset.requestId;
    const action = button.dataset.action;
    const gate = button.dataset.gate;

    if (!requestId) return;

    const original = button.textContent;
    button.disabled = true;
    button.textContent = "جارٍ التنفيذ...";

    try {
      let error;

      if (gate) {
        ({ error } = await supabase.rpc("sakan_security_gate", {
          p_request_id: requestId,
          p_action: gate
        }));
      } else if (["received", "verified"].includes(action)) {
        ({ error } = await supabase.rpc("security_update_request", {
          p_request_id: requestId,
          p_action: action,
          p_note: null
        }));
      } else {
        return;
      }

      if (error) throw error;

      await loadSecurityRequests();

    } catch (error) {
      console.error("Security action error:", error);

      setMessage(
        document.getElementById("security-dashboard-message"),
        error.message || "تعذر تنفيذ الإجراء. حاولي مرة أخرى.",
        "error"
      );

      button.disabled = false;
      button.textContent = original;
    }
  });
}


async function initializeSecurityDashboard() {
  if (!document.getElementById("security-requests-container")) {
    return;
  }

  const allowed = await requireRole([ROLES.SECURITY]);

  if (!allowed) return;

  setupSecurityRefresh();
  setupSecurityActions();

  await loadSecurityRequests();
}


// =============================================
// 7. تشغيل الجزء الخامس
// =============================================

initializeSecurityDashboard();

// =============================================
// نظام سَكَن | SAKAN
// الجزء السادس: لوحة الإدارة والإحصائيات
// =============================================

// =============================================
// 1. إظهار لوحة الإدارة بعد التحقق
// =============================================

function showAdminDashboard() {
  document.querySelectorAll("[data-admin-dashboard]").forEach(
    element => {
      element.style.display = "block";
    }
  );
}

// =============================================
// 2. تحميل إحصائيات الإدارة
// =============================================

async function loadAdminStatistics() {
  const message = document.getElementById("admin-auth-message");

  try {
    const [
      dormitoriesResult,
      studentsResult,
      supervisorsResult,
      requestsResult
    ] = await Promise.all([
      supabase
        .from("dormitories")
        .select("id", { count: "exact", head: true }),

      supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "student"),

      supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "supervisor"),

      supabase
        .from("service_requests")
        .select("id", { count: "exact", head: true })
    ]);

    const results = [
      dormitoriesResult,
      studentsResult,
      supervisorsResult,
      requestsResult
    ];

    const failed = results.find(result => result.error);

    if (failed) throw failed.error;

    const dormitoriesElement =
      document.getElementById("admin-total-dormitories");

    const studentsElement =
      document.getElementById("admin-total-students");

    const supervisorsElement =
      document.getElementById("admin-total-supervisors");

    const requestsElement =
      document.getElementById("admin-total-requests");

    if (dormitoriesElement) {
      dormitoriesElement.textContent = dormitoriesResult.count ?? 0;
    }

    if (studentsElement) {
      studentsElement.textContent = studentsResult.count ?? 0;
    }

    if (supervisorsElement) {
      supervisorsElement.textContent = supervisorsResult.count ?? 0;
    }

    if (requestsElement) {
      requestsElement.textContent = requestsResult.count ?? 0;
    }

  } catch (error) {
    console.error("Admin statistics error:", error);

    setMessage(
      message,
      "تعذر تحميل الإحصائيات. تحققي من صلاحيات الإدارة وسياسات قاعدة البيانات.",
      "error"
    );
  }
}

// =============================================
// 3. تحميل قائمة الطالبات
// =============================================

let adminStudents = [];

let adminPlaces = null;
const adminListRole = new URLSearchParams(location.search).get("role") || "student";

async function loadAdminStudents() {
  const tableBody = document.getElementById("students-table-body");
  const countElement = document.getElementById("students-count");
  const message = document.getElementById("students-message");

  if (!tableBody) return;

  tableBody.innerHTML =
    '<tr><td colspan="6">جارٍ التحميل...</td></tr>';

  document.querySelectorAll("[data-role-tab]").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.roleTab === adminListRole);
  });

  try {
    if (!adminPlaces) adminPlaces = await loadPlaces(supabase);

    const { data, error } = await supabase
      .from("profiles")
      .select("id, username, full_name, student_number, role, dormitory_id, room_id, fingerprint_id, is_active")
      .eq("role", adminListRole)
      .order("full_name", { ascending: true });

    if (error) throw error;

    adminStudents = data || [];

    if (countElement) {
      countElement.textContent = adminStudents.length;
    }

    renderAdminStudents();

    setMessage(message, "تم تحميل القائمة.", "success");

  } catch (error) {
    console.error("Admin students error:", error);

    tableBody.innerHTML =
      '<tr><td colspan="6">تعذر تحميل القائمة.</td></tr>';

    setMessage(message, "تعذر تحميل البيانات.", "error");
  }
}

window.sakanReloadAccounts = () => loadAdminStudents();

function renderAdminStudents(searchText = "") {
  const tableBody = document.getElementById("students-table-body");

  if (!tableBody) return;

  const search = searchText.trim().toLowerCase();

  const filtered = adminStudents.filter(item =>
    (item.full_name || "").toLowerCase().includes(search) ||
    (item.username || "").toLowerCase().includes(search) ||
    (item.fingerprint_id || "").includes(search)
  );

  if (filtered.length === 0) {
    tableBody.innerHTML =
      '<tr><td colspan="6">لا توجد نتائج مطابقة.</td></tr>';
    return;
  }

  tableBody.innerHTML = filtered.map(item => `
    <tr>
      <td>${escapeHTML(item.full_name || "غير محدد")}</td>
      <td dir="ltr" style="text-align:end">${escapeHTML(item.username || "—")}</td>
      <td>${escapeHTML(adminPlaces?.dorms.get(item.dormitory_id) || "—")}${item.room_id ? " · " + escapeHTML(adminPlaces?.rooms.get(item.room_id) || "") : ""}</td>
      <td>${escapeHTML(item.fingerprint_id || "—")}</td>
      <td>${item.is_active ? "نشط" : "غير نشط"}</td>
      <td><a class="sk-btn sm" href="admin-edit-user.html?id=${encodeURIComponent(item.id)}">تعديل</a></td>
    </tr>
  `).join("");
}

function setupAdminStudentsSearch() {
  const searchInput = document.getElementById("students-search");

  if (!searchInput) return;

  searchInput.addEventListener("input", () => {
    renderAdminStudents(searchInput.value);
  });
}

// =============================================
// إدارة السكنات
// =============================================

let adminDormitories = [];

// تحميل السكنات وعدد الطالبات
async function loadAdminDormitories() {
  const tableBody = document.getElementById("dormitories-table-body");
  const message = document.getElementById("admin-auth-message");

  if (!tableBody) return;

  tableBody.innerHTML =
    '<tr><td colspan="6">جارٍ تحميل السكنات...</td></tr>';

  try {
    const [
      dormitoriesResult,
      studentsResult
    ] = await Promise.all([
      supabase
        .from("dormitories")
        .select("id, name, address, is_active, created_at")
        .order("created_at", { ascending: false }),

      supabase
        .from("profiles")
        .select("dormitory_id")
        .eq("role", "student")
    ]);

    if (dormitoriesResult.error) throw dormitoriesResult.error;
    if (studentsResult.error) throw studentsResult.error;

    const studentCounts = {};

    (studentsResult.data || []).forEach(student => {
      const dormitoryId = student.dormitory_id;

      if (dormitoryId) {
        studentCounts[dormitoryId] =
          (studentCounts[dormitoryId] || 0) + 1;
      }
    });

    adminDormitories = (dormitoriesResult.data || []).map(dormitory => ({
      ...dormitory,
      students_count: studentCounts[dormitory.id] || 0
    }));

    renderAdminDormitories();

    setMessage(message, "تم تحميل السكنات بنجاح.", "success");

  } catch (error) {
    console.error("Admin dormitories error:", error);

    tableBody.innerHTML =
      '<tr><td colspan="6">تعذر تحميل السكنات.</td></tr>';

    setMessage(
      message,
      "تعذر تحميل السكنات. تحققي من صلاحيات قاعدة البيانات.",
      "error"
    );
  }
}

// عرض السكنات
function renderAdminDormitories(searchText = "") {
  const tableBody = document.getElementById("dormitories-table-body");

  if (!tableBody) return;

  const search = searchText.trim().toLowerCase();

  const filteredDormitories = adminDormitories.filter(dormitory => {
    const name = (dormitory.name || "").toLowerCase();
    const address = (dormitory.address || "").toLowerCase();

    return name.includes(search) || address.includes(search);
  });

  if (filteredDormitories.length === 0) {
    tableBody.innerHTML =
      '<tr><td colspan="6" class="empty-message">لا توجد سكنات مطابقة.</td></tr>';
    return;
  }

  tableBody.innerHTML = filteredDormitories.map((dormitory, index) => `
    <tr>
      <td>${index + 1}</td>

      <td>${escapeHTML(dormitory.name || "غير محدد")}</td>

      <td>${escapeHTML(dormitory.address || "غير محدد")}</td>

      <td>${dormitory.students_count}</td>

      <td>
        ${dormitory.is_active ? "نشط" : "متوقف"}
      </td>

      <td>
        <button
          type="button"
          class="primary-button"
          data-dormitory-action="edit"
          data-id="${escapeHTML(dormitory.id)}">
          تعديل
        </button>

        <a class="primary-button" href="admin-rooms.html?dorm=${encodeURIComponent(dormitory.id)}">الغرف</a>

        <button
          type="button"
          class="primary-button"
          data-dormitory-action="toggle"
          data-id="${escapeHTML(dormitory.id)}">
          ${dormitory.is_active ? "إيقاف" : "تفعيل"}
        </button>
      </td>
    </tr>
  `).join("");
}

// إضافة سكن جديد
async function addAdminDormitory() {
  const name = prompt("أدخلي اسم السكن الجديد:");

  if (name === null) return;

  if (!name.trim()) {
    alert("يرجى إدخال اسم السكن.");
    return;
  }

  const address = prompt("أدخلي عنوان السكن:");

  if (address === null) return;

  try {
    const { error } = await supabase
      .from("dormitories")
      .insert({
        name: name.trim(),
        address: address.trim() || null,
        is_active: true
      });

    if (error) throw error;

    alert("تمت إضافة السكن بنجاح.");

    await loadAdminDormitories();

  } catch (error) {
    console.error("Add dormitory error:", error);
    alert("تعذرت إضافة السكن. تحققي من صلاحيات قاعدة البيانات.");
  }
}

// تعديل بيانات السكن
async function editAdminDormitory(id) {
  const dormitory = adminDormitories.find(item => item.id === id);

  if (!dormitory) return;

  const name = prompt("تعديل اسم السكن:", dormitory.name || "");

  if (name === null) return;

  if (!name.trim()) {
    alert("اسم السكن مطلوب.");
    return;
  }

  const address = prompt("تعديل عنوان السكن:", dormitory.address || "");

  if (address === null) return;

  try {
    const { error } = await supabase
      .from("dormitories")
      .update({
        name: name.trim(),
        address: address.trim() || null
      })
      .eq("id", id);

    if (error) throw error;

    alert("تم تعديل بيانات السكن بنجاح.");

    await loadAdminDormitories();

  } catch (error) {
    console.error("Edit dormitory error:", error);
    alert("تعذر تعديل بيانات السكن.");
  }
}

// تفعيل أو إيقاف السكن
async function toggleAdminDormitory(id) {
  const dormitory = adminDormitories.find(item => item.id === id);

  if (!dormitory) return;

  const action = dormitory.is_active ? "إيقاف" : "تفعيل";

  if (!confirm(`هل أنتِ متأكدة من ${action} هذا السكن؟`)) {
    return;
  }

  try {
    const { error } = await supabase
      .from("dormitories")
      .update({
        is_active: !dormitory.is_active
      })
      .eq("id", id);

    if (error) throw error;

    alert(`تم ${action} السكن بنجاح.`);

    await loadAdminDormitories();

  } catch (error) {
    console.error("Toggle dormitory error:", error);
    alert("تعذر تغيير حالة السكن.");
  }
}

// ربط البحث والأزرار
function setupAdminDormitoriesActions() {
  const searchInput = document.getElementById("dormitories-search");
  const addButton = document.getElementById("add-dormitory-button");
  const tableBody = document.getElementById("dormitories-table-body");

  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = "true";

    searchInput.addEventListener("input", () => {
      renderAdminDormitories(searchInput.value);
    });
  }

  if (addButton && !addButton.dataset.bound) {
    addButton.dataset.bound = "true";

    addButton.addEventListener("click", addAdminDormitory);
  }

  if (tableBody && !tableBody.dataset.bound) {
    tableBody.dataset.bound = "true";

    tableBody.addEventListener("click", async event => {
      const button = event.target.closest("[data-dormitory-action]");

      if (!button) return;

      const id = button.dataset.id;
      const action = button.dataset.dormitoryAction;

      if (action === "edit") {
        await editAdminDormitory(id);
      }

      if (action === "toggle") {
        await toggleAdminDormitory(id);
      }
    });
  }
}

// =============================================
// 5. تهيئة صفحات الإدارة
// =============================================

async function initializeAdminPages() {
  const isAdminPage =
    document.getElementById("admin-auth-message") ||
    document.getElementById("admin-total-students") ||
    document.getElementById("students-table-body") ||
    document.getElementById("dormitories-table-body") ||
    document.querySelector("[data-admin-dashboard]");

  if (!isAdminPage) return;

  const allowed = await requireRole([ROLES.ADMIN]);

  if (!allowed) return;

  showAdminDashboard();

  const message = document.getElementById("admin-auth-message");

  if (message && currentUser) {
    setMessage(message, "تم التحقق من صلاحية الإدارة.", "success");
  }

  if (
    document.getElementById("admin-total-dormitories") ||
    document.getElementById("admin-total-students") ||
    document.getElementById("admin-total-supervisors") ||
    document.getElementById("admin-total-requests")
  ) {
    await loadAdminStatistics();
  }

  if (document.getElementById("students-table-body")) {
    setupAdminStudentsSearch();
    await loadAdminStudents();
  }

  if (document.getElementById("dormitories-table-body")) {
    setupAdminDormitoriesActions();
    await loadAdminDormitories();
  }
}

initializeAdminPages();
// 2. تحسين الصورة قبل القراءة
async function preprocessCardImage(file) {
  const image = await createImageBitmap(file);

  const canvas = document.createElement("canvas");

  const scale = Math.min(2.5, 2600 / image.width);

  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);

  const context = canvas.getContext("2d", {
    willReadFrequently: true
  });

  context.drawImage(
    image,
    0,
    0,
    canvas.width,
    canvas.height
  );

  const imageData = context.getImageData(
    0,
    0,
    canvas.width,
    canvas.height
  );

  const pixels = imageData.data;

  for (let i = 0; i < pixels.length; i += 4) {
    const gray =
      0.299 * pixels[i] +
      0.587 * pixels[i + 1] +
      0.114 * pixels[i + 2];

    const enhanced = Math.max(
      0,
      Math.min(255, (gray - 128) * 1.35 + 128)
    );

    pixels[i] = enhanced;
    pixels[i + 1] = enhanced;
    pixels[i + 2] = enhanced;
  }

  context.putImageData(imageData, 0, 0);

  image.close();

  return canvas;
}

// 3. استخراج الرقم المدني

function normalizeOCRDigits(text = "") {
  return String(text)
    .replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
}

function extractCardNumberFromOCR(text) {
  const normalized = normalizeOCRDigits(text);
  const lines = normalized.split(/\r?\n/);

  // البحث عن الرقم بجوار عبارة ID No.
  const labelPattern =
    /(?:ID\s*\.?\s*(?:NO|NUMBER)\s*\.?|CIVIL\s*(?:ID|NO|NUMBER)|رقم\s*البطاقة|الرقم\s*المدني)/i;

  for (let i = 0; i < lines.length; i++) {
    if (!labelPattern.test(lines[i])) continue;

    // النص الموجود بجوار المسمى أو في السطر التالي
    const sameLine = lines[i].replace(labelPattern, " ");

    const candidatesText = [
      sameLine,
      lines[i + 1] || ""
    ].join(" ");

    const candidates =
      candidatesText.match(/\d(?:[\s-]*\d){7,11}/g) || [];

    for (const candidate of candidates) {
      const number = candidate.replace(/\D/g, "");

      if (number.length >= 8 && number.length <= 12) {
        return number;
      }
    }
  }

  // لا نختار أرقامًا عشوائية من بقية البطاقة
  return "";
}

// =============================================
// 4. تنظيف النص العربي
// =============================================

function cleanArabicOCRLine(line) {
  return line
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .replace(/[0-9٠-٩۰-۹]/g, "")
    .replace(/[^\u0600-\u06FF\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// =============================================
// 5. استخراج اسم صاحبة البطاقة
// =============================================

function extractCardNameFromOCR(text) {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const nameLabel =
    /(?:الاسم|اسم\s*حامل\s*البطاقة|name)/i;

  for (let i = 0; i < lines.length; i++) {
    if (nameLabel.test(lines[i])) {
      const sameLine = cleanArabicOCRLine(
        lines[i].replace(nameLabel, "")
      );

      if (sameLine.split(/\s+/).filter(Boolean).length >= 2) {
        return sameLine;
      }

      if (lines[i + 1]) {
        const nextLine = cleanArabicOCRLine(lines[i + 1]);

        if (nextLine.split(/\s+/).filter(Boolean).length >= 2) {
          return nextLine;
        }
      }
    }
  }

  const candidates = lines
    .map(cleanArabicOCRLine)
    .filter(line => {
      const words = line.split(/\s+/).filter(Boolean);

      return (
        words.length >= 2 &&
        words.length <= 6 &&
        line.length >= 5
      );
    });

  return candidates[0] || "";
}

// =============================================
// 6. قراءة البطاقة الشخصية
// =============================================

async function runCardOCR(prefix) {
  const fileInput = document.getElementById(
    prefix + "-card-image"
  );

  const statusElement = document.getElementById(
    prefix + "-ocr-status"
  );

  const nameElement = document.getElementById(
    "ocr-" + prefix + "-name"
  );

  const numberElement = document.getElementById(
    "ocr-" + prefix + "-number"
  );

  const rawTextElement = document.getElementById(
    "ocr-" + prefix + "-raw-text"
  );

  const button = document.getElementById(
    "scan-" + prefix + "-card"
  );

  if (!fileInput?.files?.[0]) {
    setMessage(statusElement, "اختاري صورة البطاقة أولًا.", "error");
    return;
  }

  if (!window.Tesseract) {
    setMessage(
      statusElement,
      "مكتبة قراءة البطاقات غير متاحة.",
      "error"
    );
    return;
  }

  const file = fileInput.files[0];

  if (!file.type.startsWith("image/")) {
    setMessage(statusElement, "اختاري ملف صورة صحيحًا.", "error");
    return;
  }

  if (button) button.disabled = true;

  setMessage(statusElement, "جارٍ تجهيز الصورة...", "info");

  try {
    const preparedImage = await preprocessCardImage(file);

    // قراءة الاسم باللغة العربية
    setMessage(
      statusElement,
      "جارٍ قراءة الاسم...",
      "info"
    );

    const arabicResult = await window.Tesseract.recognize(
      preparedImage,
      "ara"
    );

    const arabicText = arabicResult.data.text || "";

    // قراءة الرقم باللغة الإنجليزية
    setMessage(
      statusElement,
      "جارٍ قراءة الرقم المدني...",
      "info"
    );

    const englishResult = await window.Tesseract.recognize(
      preparedImage,
      "eng"
    );

    const englishText = englishResult.data.text || "";

    const combinedText =
      arabicText + "\n" + englishText;

    if (rawTextElement) {
      rawTextElement.value = combinedText;
    }

    // استخراج الاسم من القراءة العربية
    const detectedName =
      extractCardNameFromOCR(arabicText);

    // استخراج الرقم مع التركيز على مسمى ID No.
    const detectedNumber =
      extractCardNumberFromOCR(
        englishText + "\n" + arabicText
      );

    if (nameElement) {
      nameElement.value = detectedName;
    }

    if (numberElement) {
      numberElement.value = detectedNumber;
    }

    if (!arabicText.trim() && !englishText.trim()) {
      setMessage(
        statusElement,
        "لم يتم التعرف على محتوى الصورة.",
        "error"
      );
    } else if (!detectedName || !detectedNumber) {
      setMessage(
        statusElement,
        "اكتملت القراءة جزئيًا. تحققي من البيانات.",
        "info"
      );
    } else {
      setMessage(
        statusElement,
        "تم استخراج البيانات مبدئيًا. يرجى التحقق من صحتها.",
        "success"
      );
    }

  } catch (error) {
    console.error("Card OCR error:", error);

    setMessage(
      statusElement,
      "تعذرت قراءة الصورة. جربي صورة أوضح.",
      "error"
    );

  } finally {
    if (button) button.disabled = false;
  }
}

// =============================================
// 7. ربط أزرار قراءة البطاقات
// =============================================

function setupCardOCR() {
  const buttons = [
    {
      id: "scan-student-card",
      prefix: "student"
    },
    {
      id: "scan-guardian-card",
      prefix: "guardian"
    }
  ];

  buttons.forEach(item => {
    const button = document.getElementById(item.id);

    if (!button || button.dataset.ocrBound) return;

    button.dataset.ocrBound = "true";

    button.addEventListener("click", () => {
      runCardOCR(item.prefix);
    });
  });
}

// =============================================
// 8. تشغيل قارئ البطاقات
// =============================================

setupCardOCR();

console.log("تم تشغيل قارئ البطاقات في نظام سَكَن.");
