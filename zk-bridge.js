// =============================================
// نظام سَكَن | برنامج ربط جهاز البصمة ZKTeco
// يعمل على أي جهاز كمبيوتر في السكن متصل بنفس شبكة جهاز البصمة.
// يسحب البصمات الجديدة كل فترة ويرسلها إلى Supabase،
// والنظام يؤكد حضور الطالبة فقط إذا سجّلت في الموقع قبل البصمة.
// =============================================

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const ZKLib = require("node-zklib");
const { createClient } = require("@supabase/supabase-js");

const cfg = {
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_ANON_KEY,
  username: process.env.BRIDGE_USERNAME,
  password: process.env.BRIDGE_PASSWORD,
  ip: process.env.ZK_IP,
  port: +(process.env.ZK_PORT || 4370),
  every: +(process.env.POLL_SECONDS || 30) * 1000
};
for (const [k, v] of Object.entries(cfg)) {
  if (!v) { console.error(`القيمة ناقصة في ملف .env: ${k}`); process.exit(1); }
}

const STATE = path.join(__dirname, "state.json");
const loadState = () => { try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return { lastSeen: Date.now() - 12 * 3600e3 }; } };
const saveState = s => fs.writeFileSync(STATE, JSON.stringify(s));
const log = (...a) => console.log(new Date().toLocaleString("ar-OM-u-nu-latn", { timeZone: "Asia/Muscat" }), "|", ...a);

// اسم المستخدم مثل security@device -> البريد الداخلي (مطابق لـ sakan_login_email في قاعدة البيانات)
const loginEmail = u => {
  u = String(u).replace(/\s+/g, "").toLowerCase();
  if (!/^security@[a-z0-9][a-z0-9._-]{1,39}$/.test(u)) {
    console.error("BRIDGE_USERNAME يجب أن يكون حساب أمن مثل security@device");
    process.exit(1);
  }
  return u.replace("@", ".") + "@sakan.local";
};

const supabase = createClient(cfg.url, cfg.key, { auth: { persistSession: false, autoRefreshToken: true } });

async function signIn() {
  const { error } = await supabase.auth.signInWithPassword({ email: loginEmail(cfg.username), password: cfg.password });
  if (error) throw new Error("تعذّر تسجيل دخول حساب الربط: " + error.message);
  log("تم تسجيل الدخول بحساب الأمن الخاص بالربط");
}

let busy = false;
async function poll() {
  if (busy) return;
  busy = true;
  const state = loadState();
  const zk = new ZKLib(cfg.ip, cfg.port, 10000, 4000);
  try {
    await zk.createSocket();
    const logs = await zk.getAttendances();
    const fresh = (logs?.data || [])
      .map(r => ({ fp: String(r.deviceUserId ?? r.userId).trim(), at: new Date(r.recordTime) }))
      .filter(r => r.fp && r.at.getTime() > state.lastSeen)
      .sort((a, b) => a.at - b.at);

    for (const r of fresh) {
      const { data, error } = await supabase.rpc("sakan_record_fingerprint", {
        p_fingerprint_id: r.fp,
        p_at: r.at.toISOString()
      });
      if (error) {
        log("خطأ في إرسال البصمة", r.fp, error.message);
        if (/JWT|token/i.test(error.message)) await signIn();
        break; // نعيد المحاولة في الدورة القادمة دون تخطي البصمة
      }
      log(data.ok ? "✓" : "•", data.message);
      state.lastSeen = r.at.getTime();
      saveState(state);
    }
  } catch (e) {
    log("تعذّر الاتصال بجهاز البصمة:", e?.message || e?.err?.message || e);
  } finally {
    try { await zk.disconnect(); } catch {}
    busy = false;
  }
}

(async () => {
  await signIn();
  log(`سحب البصمات من ${cfg.ip}:${cfg.port} كل ${cfg.every / 1000} ثانية`);
  await poll();
  setInterval(poll, cfg.every);
})().catch(e => { console.error(e.message); process.exit(1); });
