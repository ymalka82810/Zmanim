/* עדכון עצמי של אפליקציית האנדרואיד (האפליקציה לא בחנות, ולכן לא מתעדכנת לבד).
 * ה-workflow ב-GitHub מעלה כל APK ל-Convex (convex/appUpdate.ts), והקישור ניתן רק למשתמש מחובר.
 * בכל פתיחה של האפליקציה שואלים את appUpdate:latest אם יש versionCode גבוה מהמותקן,
 * ואם כן שואלים את המשתמש אם לעדכן. משתמש לא מחובר לא מקבל עדכונים.
 * בהסכמה ה-APK יורד בתוך האפליקציה עם אחוזי התקדמות, ונפתח חלון ההתקנה של אנדרואיד – המשתמש רק לוחץ "עדכון".
 * בפעם הראשונה אנדרואיד מבקש לאשר "התקנה ממקור זה" לאפליקציה. "אחר כך" דוחה את השאלה על אותה גרסה ביום.
 * בדפדפן הקובץ לא עושה כלום. החלק ה-native ב-android/.../AppUpdaterPlugin.java.
 */
(function(){
"use strict";
const cap = window.Capacitor;
if (!(cap && cap.isNativePlatform && cap.isNativePlatform())) return;

const SNOOZE = 24 * 3600e3;
const KEY = 'app.update';
const call = (method, opts) => cap.nativePromise('AppUpdater', method, opts);

function read(){ try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
function write(v){ try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* אין גישה לאחסון */ } }

/* {versionCode, version, url} של הגרסה האחרונה אם היא חדשה מהמותקנת, אחרת null.
 * לא דרך SiteAuth.query, כדי שהקישור לא יישמר במטמון של הדף */
async function findUpdate(){
  const { versionCode } = await call('appInfo');
  return SiteAuth.client().query('appUpdate:latest', { versionCode });
}

const css = `
.au{position:fixed;z-index:1000;left:16px;right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));max-width:420px;margin:0 auto;padding:14px 18px;border-radius:14px;background:#1e3a63;color:#fff;font-family:"Assistant",Arial,sans-serif;direction:rtl;box-shadow:0 10px 30px rgba(10,20,40,.3)}
.au-text{font-weight:700;margin-bottom:8px}
.au-bar{height:6px;border-radius:999px;background:rgba(255,255,255,.25);overflow:hidden}
.au-bar i{display:block;height:100%;width:0;background:#dfb564;transition:width .2s}
.au-bar.au-unknown i{width:30%;animation:au-slide 1.2s linear infinite}
@keyframes au-slide{from{transform:translateX(100%)}to{transform:translateX(-340%)}}
`;

function progressPanel(version){
  const style = document.createElement('style');
  style.textContent = css;
  const el = document.createElement('div');
  el.className = 'au';
  el.setAttribute('role', 'status');
  el.innerHTML = '<div class="au-text"></div><div class="au-bar"><i></i></div>';
  const text = el.querySelector('.au-text'), bar = el.querySelector('.au-bar'), fill = bar.querySelector('i');
  text.textContent = `מוריד את גרסה ${version}…`;
  document.head.appendChild(style);
  document.body.appendChild(el);
  return {
    set(percent){
      bar.classList.toggle('au-unknown', percent < 0);
      if (percent >= 0){ fill.style.width = percent + '%'; text.textContent = `מוריד את גרסה ${version}… ${percent}%`; }
    },
    remove(){ el.remove(); style.remove(); }
  };
}

const ERRORS = {
  permission: 'כדי לעדכן צריך לאשר לאפליקציה להתקין עדכונים (בחלון ההגדרות שנפתח). נסו שוב.',
  download: 'ההורדה נכשלה. בדקו את החיבור לאינטרנט ונסו שוב.',
  'not an update': 'הקובץ שהורד אינו עדכון של האפליקציה הזו.',
  'no installer': 'לא נמצא במכשיר מתקין אפליקציות.'
};

async function install(update){
  const panel = progressPanel(update.version);
  const listener = cap.addListener('AppUpdater', 'progress', e => panel.set(e.percent));
  try {
    await call('downloadAndInstall', { url: update.url });
  } catch (e) {
    const msg = ERRORS[e && e.message];
    if (msg && window.SiteDialog) SiteDialog.alert(msg);
  } finally {
    Promise.resolve(listener).then(l => l && l.remove());
    panel.remove();
  }
}

async function check(){
  if (!(window.SiteAuth && SiteAuth.isAuthenticated())) return;
  const state = read(), now = Date.now();
  let update;
  try { update = await findUpdate(); } catch (e) { return; } // בלי אינטרנט – ננסה בפתיחה הבאה
  if (!update || (state.snoozed === update.versionCode && now - state.snoozedAt < SNOOZE) || !window.SiteDialog) return;
  const ok = await SiteDialog.confirm(`גרסה חדשה של האפליקציה זמינה (${update.version}).\nלעדכן עכשיו?`, { ok: 'עדכון', cancel: 'אחר כך' });
  if (ok) return install(update);
  write(Object.assign(read(), { snoozed: update.versionCode, snoozedAt: Date.now() }));
}

// אחרי שמסך הפתיחה נעלם והדף התייצב
window.addEventListener('load', () => setTimeout(check, 3000));
})();
