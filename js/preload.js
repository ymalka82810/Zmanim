/* טעינה מוקדמת במסך הפתיחה (index.html): מביאה מהשרת את הנתונים שכל דפי האתר מציגים לקהילה הפעילה,
 * ושומרת אותם במטמון של js/auth.js (SiteAuth.query). כשנכנסים לדף הוא מציג מיד את מה שנטען כאן
 * (SiteAuth.watch/cached), וממשיך להתעדכן בזמן אמת מהשרת, בלי לחכות לטעינה משלו.
 * הארגומנטים של כל שאילתה חייבים להיות זהים לאלה שהדף שולח, כולל סדר המפתחות, כי הם חלק ממפתח המטמון.
 * run(onProgress) קוראת ל-onProgress(0..1) בכל פעם ששאילתה או קובץ מסתיימים (גם בשגיאה), וכך פס הטעינה
 * מראה את ההתקדמות האמיתית: 30% לפרטי המשתמש והקהילות, ו-70% לנתוני הקהילה הפעילה, שמספרם ידוע רק אחרי השלב הראשון.
 * דורש: js/auth.js נטען לפני קובץ זה.
 */
(function(){
"use strict";
const ROOT = new URL('..', document.currentScript.src);
const HEBCAL_SRC = new URL('vendor/hebcal/hebcal-core-6.9.3.min.js', ROOT).href;
const CALENDAR_SRC = new URL('kiddush/js/calendar.js', ROOT).href;
const isManager = role => role === 'gabbai' || role === 'rabbi';
const pad = n => String(n).padStart(2, '0');
const dkey = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

/* טוען סקריפט פעם אחת; אם הוא כבר נוסף לדף (menu.js מוסיף את hebcal) – מחכה לו */
function script(src, ready){
  if (ready()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let s = document.querySelector(`script[src="${src}"]`);
    if (!s){ s = document.createElement('script'); s.src = src; document.head.appendChild(s); }
    s.addEventListener('load', resolve);
    s.addEventListener('error', reject);
  });
}
const loadHebcal = () => script(HEBCAL_SRC, () => !!window.hebcal);
/* calendar.js קורא את window.hebcal כשהוא נטען, ולכן רק אחרי hebcal */
const loadCalendar = () => loadHebcal().then(() => script(CALENDAR_SRC, () => !!window.KiddushCalendar));

/* השבת או החג הקרובים, כמו nextSlotKey ב-aliyot/js/app.js לפני שיש נתונים (il = true) */
function aliyotDateKey(){
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const end = new Date(t); end.setDate(end.getDate() + 59);
  const slots = window.KiddushCalendar.getSlots(t, end, true);
  return slots.length ? slots[0].key : dkey(t);
}

/* מחכה שהכניסה מגוגל (?code=...) תושלם בדף עצמו, עד timeout */
function until(ok, timeout){
  return new Promise(resolve => {
    const start = Date.now();
    (function check(){ if (ok() || Date.now() - start > timeout) resolve(); else setTimeout(check, 100); })();
  });
}

async function run(onProgress, options){
  const Auth = window.SiteAuth;
  if (!Auth) return;
  if (options && options.signingIn) await until(() => Auth.isAuthenticated(), 8000);
  if (!Auth.isAuthenticated()) return;

  /* מריץ את המשימות במקביל; כל אחת שמסתיימת מקדמת את הפס בחלק שלה מ-weight. שגיאה (למשל שאילתה
   * שמותרת רק לגבאי) לא עוצרת את השאר */
  let base = 0;
  function stage(weight, fns){
    const from = base;
    let finished = 0;
    base += weight;
    return Promise.all(fns.map(fn => Promise.resolve().then(fn).catch(() => null)
      .finally(() => onProgress(from + weight * ++finished / fns.length))));
  }

  const [me, list] = await stage(0.3, [
    () => Auth.query('users:me', {}),
    () => Auth.query('synagogues:mine', {}),
    () => Auth.query('invitations:mine', {}),
  ]);
  if (!me || !Array.isArray(list)) return;
  // כמו useSynagogues בדפים: הקהילה הפעילה, ואם היא כבר לא ברשימה – הראשונה
  let sid = Auth.activeSynagogueId();
  if (!list.some(s => s._id === sid)){ sid = list[0] ? list[0]._id : null; Auth.setActiveSynagogueId(sid); }
  const syn = list.find(s => s._id === sid);
  if (!syn) return;

  const today = dkey(new Date()), features = syn.features || [];
  const cached = (name, args) => () => Auth.query(name, { synagogueId: sid, ...args });
  // לוח הזמנים עצמו מאזין לאלה בלי מטמון (js/settings-sync.js, js/app.js); הבאתם כאן רק מקדימה את התשובה שהדף מחכה לה
  const live = name => () => Auth.client().query(name, { synagogueId: sid });

  const jobs = [
    cached('menu:counts'),
    cached('schedules:list'),
    cached('kiddush:board'),
    cached('events:list'),
    cached('fund:ledger'),
    cached('yahrzeits:list', { today }),
    loadHebcal,   // שורת התאריך העברי וכל הדפים שמציגים לוח שנה
  ];
  if (isManager(syn.role)) jobs.push(
    cached('storage:overview'),
    live('zmanimSettings:get'),
    live('zmanimSettings:designList'),
    live('zmanimProfiles:list'),
  );
  if (features.includes('week')) jobs.push(
    cached('minyan:list', { from: today }),
    cached('week:notifications'),
  );
  if (features.includes('aliyot')) jobs.push(
    () => loadCalendar().then(() => Auth.query('aliyot:board', { synagogueId: sid, dateKey: aliyotDateKey() })),
    cached('auctions:list'),
  );
  await stage(0.7, jobs);
}

window.SitePreload = { run };
})();
