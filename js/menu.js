/* תפריט המבורגר משותף לשלושת הדפים: לוח זמנים, לוח קידושים וקופת בית הכנסת.
 * כל דף טוען את הקובץ הזה, והוא מוסיף פס עליון עם כפתור תפריט, פס זהב מתחתיו, שורת היום
 * (שם הקהילה והתאריך) ומגירה עם שלושת הדפים.
 * הדף מעדכן את שם הקהילה ב-SiteMenu.setCommunity({ _id, name, il }); השם נשמר במכשיר כדי להופיע מיד בכניסה הבאה.
 * הקובץ גם רושם את ה-service worker מכל דף. הדפים נפתחים מהעותק שבמכשיר; כשגרסה חדשה של האתר
 * מסיימת לרדת ברקע, הדף מתרענן פעם אחת כדי להציג אותה (ואם המשתמש באמצע הקלדה – כשהוא עוזב את הדף).
 * הכתובות מחושבות ביחס למיקום הקובץ, כך שזה עובד גם מתיקיית משנה.
 */
(function(){
"use strict";
const ROOT = new URL('..', document.currentScript.src);
/* "לוח זמנים" ו"יומן קהילה" מוצגים לסירוגין לפי תפקיד המשתמש בקהילה הפעילה (menu:counts, שדה manager):
 * חבר קהילה רגיל רואה את יומן הקהילה במקום לשונית עריכת לוח הזמנים, שנטו לגבאי/רב. אורח או גבאי/רב
 * רואים את לוח הזמנים כרגיל, ויומן הקהילה נשאר מחוץ למגירה (ברירת המחדל עד שידוע תפקיד המשתמש).
 * דף עם managerOnly מוצג רק לגבאי ולרב. דף עם feature שייך לפיצ'ר שהקהילה צריכה להפעיל (convex/features.ts), ומוצג רק כשהוא ברשימת features של menu:counts */
const PAGES = [
  { path: '',                   title: 'לוח זמנים', hideForMember: true },
  { path: 'week/',              title: 'השבוע שלי', feature: 'week' },
  { path: 'catalog/',           title: 'קטלוג בית הכנסת', feature: 'catalog' },
  { path: 'kiddush/',          title: 'לוח קידושים' },
  { path: 'gabbai/',            title: 'קופת בית הכנסת' },
  { path: 'aliyot/',            title: 'חלוקת עליות', feature: 'aliyot' },
  { path: 'screen/',            title: 'מסך בית הכנסת', managerOnly: true },
  { path: 'account/',           title: 'החשבון שלי' },
  { path: 'community-calendar/', title: 'יומן קהילה', showForMember: true }
];
const here = location.pathname.replace(/index\.html$/, '');
const current = PAGES.slice().reverse().find(p => here === new URL(p.path, ROOT).pathname) || PAGES[0];

const css = `
.sm-bar{position:sticky;top:0;z-index:40;display:flex;align-items:center;gap:10px;box-sizing:border-box;height:calc(48px + env(safe-area-inset-top,0px));padding:0 max(10px,env(safe-area-inset-right,0px)) 0 max(10px,env(safe-area-inset-left,0px));padding-top:env(safe-area-inset-top,0px);background:#2c4a7c;color:#fff;font-family:"Assistant",Arial,sans-serif;direction:rtl}
.sm-stripe{position:sticky;top:calc(48px + env(safe-area-inset-top,0px));z-index:40;height:6px;background:linear-gradient(90deg,#1e3a63 0%,#ab7f2e 50%,#1e3a63 100%)}
.sm-btn{display:flex;align-items:center;justify-content:center;flex:none;width:40px;height:40px;padding:0;border:0;border-radius:10px;background:none;color:inherit;cursor:pointer;box-shadow:none;transform:none}
.sm-btn:hover,.sm-btn:focus-visible{background:rgba(255,255,255,.15)}
.sm-btn svg{width:24px;height:24px}
.sm-btn{position:relative}
.sm-count{flex:none;box-sizing:border-box;min-width:22px;height:22px;padding:0 6px;border-radius:999px;background:#c62828;color:#fff;font-size:.8rem;font-weight:700;line-height:22px;text-align:center}
.sm-btn .sm-count{position:absolute;top:1px;left:0;min-width:18px;height:18px;padding:0 4px;font-size:.7rem;line-height:18px;box-shadow:0 0 0 2px #2c4a7c}
:root[data-theme="dark"] .sm-count{background:#e5534b}
:root[data-theme="dark"] .sm-btn .sm-count{box-shadow:0 0 0 2px #1b2d56}
.sm-title{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-weight:700;font-size:1.05rem}
.sm-shade{position:fixed;inset:0;background:rgba(10,14,20,.45);z-index:900;opacity:0;transition:opacity .2s}
.sm-drawer{position:fixed;top:0;bottom:0;right:0;width:min(280px,82vw);box-sizing:border-box;overflow-y:auto;overscroll-behavior:contain;background:#fff;color:#1d2b45;z-index:901;transform:translateX(100%);transition:transform .2s,width .2s;padding:calc(12px + env(safe-area-inset-top,0px)) 10px 12px;box-shadow:-6px 0 24px rgba(10,20,40,.2);font-family:"Assistant",Arial,sans-serif;direction:rtl}
.sm-open .sm-shade{opacity:1}
.sm-open .sm-drawer{transform:none}
.sm-drawer.sm-searching{width:min(460px,94vw)}
.sm-find{display:flex;align-items:center;gap:6px;margin:0 4px 14px;padding:0 12px;border:1px solid #d6dce8;border-radius:999px;background:#f5f7fb}
.sm-find:focus-within{border-color:#2c4a7c}
.sm-find svg{flex:none;width:18px;height:18px;color:#5d6b82}
.sm-find input{flex:1;min-width:0;padding:9px 0;border:0;outline:0;background:none;color:inherit;font:inherit;font-size:1rem}
:root[data-theme="dark"] .sm-find{border-color:#2d3440;background:#232a36}
:root[data-theme="dark"] .sm-find:focus-within{border-color:#8fb0ec}
:root[data-theme="dark"] .sm-find svg{color:#9ba4b3}
.sm-drawer h2{margin:4px 10px 12px;font-size:.85rem;font-weight:600;color:#5d6b82}
.sm-drawer a{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 14px;border-radius:10px;color:inherit;text-decoration:none;font-size:1.05rem;font-weight:600}
.sm-drawer a[hidden]{display:none}
.sm-drawer a:hover{background:#eef3fa}
.sm-drawer a[aria-current="page"]{background:#e3e9f2;color:#2c4a7c}
.sm-theme{display:flex;margin:0 10px;padding:3px;border:1px solid #d6dce8;border-radius:999px}
.sm-theme button{flex:1;padding:7px 4px;border:0;border-radius:999px;background:none;color:#5d6b82;font:inherit;font-weight:600;cursor:pointer}
.sm-theme button[aria-pressed="true"]{background:#2c4a7c;color:#fff}
:root[data-theme="dark"] .sm-bar{background:#1b2d56}
:root[data-theme="dark"] .sm-stripe{background:linear-gradient(90deg,#8fb0ec 0%,#dfb564 50%,#8fb0ec 100%)}
:root[data-theme="dark"] .sm-drawer{background:#1a1f28;color:#e8ecf2}
:root[data-theme="dark"] .sm-drawer h2{color:#9ba4b3}
:root[data-theme="dark"] .sm-drawer a:hover{background:#232a36}
:root[data-theme="dark"] .sm-drawer a[aria-current="page"]{background:#2a3446;color:#fff}
:root[data-theme="dark"] .sm-theme{border-color:#2d3440}
:root[data-theme="dark"] .sm-theme button{color:#9ba4b3}
:root[data-theme="dark"] .sm-theme button[aria-pressed="true"]{background:#8fb0ec;color:#0f1524}
.sm-day{direction:rtl;color:#202a3f;font-family:"Assistant",Arial,sans-serif}
.sm-day-in{box-sizing:border-box;max-width:var(--page-width,760px);margin:0 auto;padding:22px var(--page-gutter,16px) 0}
.sm-day-syn{font-size:1.15rem;font-weight:700;color:#726c59}
.sm-day-dates{font-size:1.2rem;color:#726c59}
.sm-day-dates b{font-family:"Frank Ruhl Libre",Georgia,serif;font-weight:700;color:#202a3f}
:root[data-theme="dark"] .sm-day,:root[data-theme="dark"] .sm-day-dates b{color:#e9ecf5}
:root[data-theme="dark"] .sm-day-syn,:root[data-theme="dark"] .sm-day-dates{color:#98a2c0}
/* באפליקציה (כשיש אזור מצלמה למעלה): הפס תופס את אזור המצלמה בלי להוסיף לו גובה, ונשאר קבוע
   עם כפתור התפריט, הכותרת ופס הזהב מתחתיו, והדף נכנס מתחת */
.sm-pin{--sm-bar-h:max(48px,env(safe-area-inset-top,0px));--sm-top:calc(var(--sm-bar-h) + 6px)}
.sm-pin .sm-bar{position:sticky;top:0;z-index:40;height:var(--sm-bar-h);padding-top:0;overflow:hidden}
.sm-pin .sm-stripe{position:sticky;top:var(--sm-bar-h);z-index:40}
@keyframes sg-flash{0%,100%{box-shadow:0 0 0 0 rgba(171,127,46,0)}15%,60%{box-shadow:0 0 0 4px rgba(171,127,46,.85)}}
.sg-flash{animation:sg-flash 1.3s ease-in-out 2;border-radius:8px;background-color:rgba(251,231,180,.45)!important}
:root[data-theme="dark"] .sg-flash{background-color:rgba(90,74,30,.55)!important}
.sm-toasts{position:fixed;z-index:950;top:calc(64px + env(safe-area-inset-top,0px));left:12px;display:flex;flex-direction:column;gap:8px;width:min(340px,calc(100vw - 24px));pointer-events:none;direction:rtl;font-family:"Assistant",Arial,sans-serif}
.sm-toast{pointer-events:auto;display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;border-inline-start:4px solid #ab7f2e;background:#fff;color:#1d2b45;box-shadow:0 8px 24px rgba(10,20,40,.22);font-weight:600;line-height:1.35;text-decoration:none;opacity:0;transform:translateX(-24px);transition:opacity .25s,transform .25s}
.sm-toast.sm-in{opacity:1;transform:none}
.sm-toast svg{flex:none;width:22px;height:22px;color:#ab7f2e}
.sm-toast span{flex:1;min-width:0}
.sm-toast button{flex:none;width:26px;height:26px;padding:0;border:0;border-radius:50%;background:none;color:#5d6b82;font-size:1.1rem;line-height:1;cursor:pointer;box-shadow:none;transform:none}
:root[data-theme="dark"] .sm-toast{background:#232a36;color:#e8ecf2;border-color:#dfb564}
:root[data-theme="dark"] .sm-toast svg{color:#dfb564}
:root[data-theme="dark"] .sm-toast button{color:#9ba4b3}
@media (prefers-reduced-motion:reduce){.sm-toast{transition:none}}
@media print{.sm-bar,.sm-stripe,.sm-day,.sm-layer,.sm-toasts{display:none!important}}
`;

/* ---------- שורת היום ---------- */
const COMMUNITY_KEY = 'site.community', ACTIVE_KEY = 'site.activeSynagogue', CONFIG_KEY = 'zmanim.config', TOKEN_KEY = 'convex.auth.token';
const HEBCAL_SRC = new URL('vendor/hebcal/hebcal-core-6.9.3.min.js', ROOT).href;
function read(key){ try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }
function readRaw(key){ try { return localStorage.getItem(key); } catch (e) { return null; } }
function write(key, v){ try { v == null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* אין גישה לאחסון */ } }

/* התשובה האחרונה השמורה של menu:counts לקהילה הפעילה (ראו js/auth.js: cached/remember) – תפקיד המשתמש
 * והפיצ'רים, לפני שיש חיבור ל-Convex ולפני ש-js/auth.js אפילו נטען (menu.js רץ לפניו). כשאין תשובה שמורה: null.
 * ככה המגירה נבנית נכון כבר מההתחלה, ולא רק אחרי שה-watch האסינכרוני מתקן אותה */
function cachedCounts(){
  const sid = readRaw(ACTIVE_KEY);
  if (!sid || !readRaw(TOKEN_KEY)) return null;
  try {
    const raw = localStorage.getItem('site.cache.menu:counts:' + JSON.stringify({ synagogueId: sid }));
    if (raw == null) return null;
    const d = JSON.parse(raw);
    return d && typeof d.manager === 'boolean' ? d : null;
  } catch (e) { return null; }
}

let day = null;
const gLong = new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/* הקהילה הפעילה כפי שנשמרה במכשיר; בלי קהילה – שם בית הכנסת מהגדרות לוח הזמנים */
function community(){
  const saved = read(COMMUNITY_KEY), cfg = read(CONFIG_KEY) || {};
  if (saved && saved._id === readRaw(ACTIVE_KEY)) return saved;
  return { name: (cfg.shul || '').trim(), il: cfg.il !== false };
}

/* התאריך העברי של היום באותיות. עד ש-hebcal נטען (למשל מיד אחרי ריענון) – התאריך השמור מהטעינה הקודמת
 * של אותו יום, ובלעדיו ריק; לא התאריך העברי של הדפדפן, שיוצא במספרים ("7 בתשרי 5787") */
const HEBDATE_KEY = 'site.hebDate';
function hebDate(date){
  const H = window.hebcal, d = date.toDateString();
  if (!H) { const s = read(HEBDATE_KEY); return s && s.d === d ? s.t : ''; }
  const t = new H.HDate(date).renderGematriya(true);
  write(HEBDATE_KEY, { d, t });
  return t;
}

function renderDay(){
  if (!day) return;
  const c = community(), now = new Date();
  day.syn.textContent = c.name || '';
  day.syn.hidden = !c.name;
  day.dates.textContent = '';
  const heb = hebDate(now), greg = gLong.format(now);
  if (!heb) { day.dates.append(greg); return; }
  const b = document.createElement('b');
  b.textContent = heb;
  day.dates.append(b, ' · ' + greg);
}

function loadHebcal(){
  if (window.hebcal) return;
  const s = document.createElement('script');
  s.src = HEBCAL_SRC;
  s.onload = renderDay;
  document.head.appendChild(s);
}

/* ---------- מספר הדברים שלא טופלו בכל דף (menu:counts) ----------
 * auth.js נטען אחרי הקובץ הזה, ולכן המעקב מתחיל רק כשהדף סיים להיטען, ומתחדש כשהקהילה הפעילה מתחלפת */
const badges = { links: [], btn: null, total: null, data: null, sid: null, stop: null };

/* d: תשובת menu:counts, או null כשעדיין לא ידוע */
function hiddenPage(p, d){
  if (p.feature && !(d && Array.isArray(d.features) && d.features.includes(p.feature))) return true;
  const member = !!d && d.manager === false;
  if (p.managerOnly) return !(d && d.manager === true);
  if (p.hideForMember) return member;
  if (p.showForMember) return !member;
  return false;
}

function renderCounts(){
  const d = badges.data || {};
  let total = 0;
  for (const l of badges.links){
    l.a.hidden = hiddenPage(l.page, badges.data);
    const n = l.a.hidden ? 0 : d[l.path] || 0;
    total += n;
    l.count.hidden = !n;
    l.count.textContent = n > 99 ? '99+' : String(n);
    l.a.setAttribute('aria-label', n ? `${l.title}, ${n} ממתינים לטיפול` : l.title);
  }
  if (!badges.total) return;
  badges.total.hidden = !total;
  badges.total.textContent = total > 99 ? '99+' : String(total);
  badges.btn.setAttribute('aria-label', total ? `תפריט, ${total} ממתינים לטיפול` : 'תפריט');
}

function watchCounts(){
  const Auth = window.SiteAuth;
  const sid = Auth && Auth.isAuthenticated() ? Auth.activeSynagogueId() : null;
  if (sid === badges.sid) return;
  if (badges.stop) badges.stop();
  badges.stop = null;
  badges.sid = sid;
  badges.data = null;
  renderCounts();
  watchAuctions();
  if (!sid) return;
  badges.stop = Auth.watch('menu:counts', { synagogueId: sid }, d => { badges.data = d; renderCounts(); watchAuctions(); }, () => {});
}

/* ---------- הודעות צדדיות ממכרז העליות (auctions:live) ----------
 * בכל דף, כשחלוקת העליות פעילה בקהילה: "פלוני הציע ₪180 על שלישי", פתיחה וסגירה של מכרז, וזכייה.
 * מה שכבר הוצג נשמר במכשיר (הזמן של ההודעה האחרונה), כדי שמעבר בין דפים לא יציג אותן שוב,
 * והודעות ישנות מעשר דקות לא קופצות (למשל כשחוזרים לאפליקציה אחרי יום) */
const auctions = { sid: null, stop: null, box: null };
const AUCTION_SEEN = 'site.auctionSeen.', AUCTION_FRESH_MS = 10 * 60e3, TOAST_MS = 7000;
function watchAuctions(){
  const Auth = window.SiteAuth, d = badges.data;
  const sid = Auth && d && Array.isArray(d.features) && d.features.includes('aliyot') ? badges.sid : null;
  if (sid === auctions.sid) return;
  if (auctions.stop) auctions.stop();
  auctions.stop = null;
  auctions.sid = sid;
  if (!sid) return;
  auctions.stop = Auth.watch('auctions:live', { synagogueId: sid }, data => {
    if (!data || !Array.isArray(data.events)) return;
    const key = AUCTION_SEEN + sid, newest = data.events.reduce((m, e) => Math.max(m, e.at), 0);
    const seen = Number(readRaw(key));
    // בפעם הראשונה במכשיר הזה: מה שכבר קרה לא קופץ, וכל מה שיבוא מעכשיו כן
    if (seen) data.events.filter(e => e.at > seen && e.at > Date.now() - AUCTION_FRESH_MS).reverse().forEach(e => auctionToast(e.text));
    if (!seen || newest > seen) try { localStorage.setItem(key, String(Math.max(newest, seen || 1))); } catch (e) { /* אין גישה לאחסון */ }
  }, () => {});
}

function auctionToast(text){
  if (!auctions.box){
    auctions.box = document.createElement('div');
    auctions.box.className = 'sm-toasts';
    auctions.box.setAttribute('role', 'status');
    auctions.box.setAttribute('aria-live', 'polite');
    document.body.appendChild(auctions.box);
  }
  const t = document.createElement('a');
  t.className = 'sm-toast';
  t.href = new URL('aliyot/?view=auction', ROOT).href;
  t.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 13-7.5 7.5a2.12 2.12 0 0 1-3-3L11 10"/><path d="m16 16 6-6"/><path d="m8 8 6-6"/><path d="m9 7 8 8"/><path d="m21 11-8-8"/></svg><span></span><button type="button" aria-label="סגירת ההודעה">×</button>';
  t.querySelector('span').textContent = text;
  const remove = () => { t.classList.remove('sm-in'); setTimeout(() => t.remove(), 300); };
  t.querySelector('button').addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); remove(); });
  auctions.box.appendChild(t);
  while (auctions.box.children.length > 3) auctions.box.firstChild.remove();
  requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('sm-in')));
  setTimeout(remove, TOAST_MS);
}

function startCounts(){
  if (!window.SiteAuth) return;
  SiteAuth.onChange(() => setTimeout(watchCounts));
  watchCounts();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startCounts);
else setTimeout(startCounts);

window.SiteMenu = {
  /* הדפים שהמשתמש רואה במגירה (לפי תפקידו והפיצ'רים של הקהילה), לחיפוש: [{ path, title, href }] */
  visiblePages(){
    const d = badges.data || cachedCounts();
    return PAGES.filter(p => !hiddenPage(p, d)).map(p => ({ path: p.path, title: p.title, href: new URL(p.path, ROOT).href }));
  },
  href(path){ return new URL(path, ROOT).href; },
  /* מה שידוע על המשתמש בקהילה הפעילה, לחיפוש: manager – true/false, או null כשלא ידוע (לא מחובר, או עוד לא נטען) */
  role(){
    const d = badges.data || cachedCounts();
    return { manager: d ? d.manager : null, features: d && Array.isArray(d.features) ? d.features : [] };
  },
  close(){ closeMenu(); },
  /* s: { _id, name, il } של הקהילה הפעילה, או null כשאין */
  setCommunity(s){
    write(COMMUNITY_KEY, s && s.name ? { _id: s._id, name: s.name, il: !!s.il } : null);
    renderDay();
    watchCounts();
  },
  /* c: { w: רוחב ה-WebView בפיקסלים של המסך, rects: [[left, top, right, bottom], ...] } – נקרא מ-MainActivity */
  setCutout(c){
    cutout = c && Array.isArray(c.rects) ? { w: c.w, rects: c.rects } : null;
    write(CUTOUT_KEY, cutout);
    refit();
  }
};

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  // בכניסה הראשונה אין עדיין service worker שמנהל את הדף, ואז אין גרסה ישנה להחליף
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  const busy = () => {
    const el = document.activeElement;
    return (el && el.matches('input, textarea, select, [contenteditable="true"]'))
      || !!document.querySelector('dialog[open], .sheet-wrap:not([hidden]), .sm-open');
  };
  const reload = () => { if (!reloading){ reloading = true; location.reload(); } };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    if (!busy()) return reload();
    document.addEventListener('visibilitychange', () => { if (document.hidden) reload(); });
  });
  navigator.serviceWorker.register(new URL('sw.js', ROOT).href).catch(() => {});
}

/* בחירת תאריך עברי ליד כל שדה תאריך בכל דף (js/heb-date.js) */
{ const s = document.createElement('script'); s.src = new URL('js/heb-date.js', ROOT).href; document.head.appendChild(s); }

function build(){
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const bar = document.createElement('div');
  bar.className = 'sm-bar';
  bar.innerHTML = `<button type="button" class="sm-btn" aria-label="תפריט" aria-expanded="false" aria-controls="sm-drawer">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
    </button><span class="sm-title"></span>`;
  bar.querySelector('.sm-title').textContent = current.title;

  const layer = document.createElement('div');
  layer.className = 'sm-layer';
  layer.hidden = true;
  layer.innerHTML = `<div class="sm-shade"></div><nav class="sm-drawer" id="sm-drawer" aria-label="דפי האתר">
    <div class="sm-find" role="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg><input type="search" enterkeyhint="search" autocomplete="off" placeholder="חיפוש באתר ובקהילה" aria-label="חיפוש באתר ובקהילה" title="חיפוש (Ctrl+K)"></div>
    <div class="sm-results" aria-live="polite" hidden></div>
    <div class="sm-main"><h2>בית הכנסת</h2></div></nav>`;
  const nav = layer.querySelector('nav'), main = nav.querySelector('.sm-main');
  const known = cachedCounts(); /* מה שידוע כבר עכשיו, לפני שה-watch האסינכרוני מתחיל; null = לא ידוע */
  for (const p of PAGES){
    const a = document.createElement('a');
    a.href = new URL(p.path, ROOT).href;
    const label = document.createElement('span');
    label.textContent = p.title;
    const count = document.createElement('span');
    count.className = 'sm-count';
    count.hidden = true;
    a.append(label, count);
    if (p === current) a.setAttribute('aria-current', 'page');
    a.hidden = hiddenPage(p, known);
    main.appendChild(a);
    badges.links.push({ page: p, path: p.path, title: p.title, a, count });
  }

  if (window.SiteTheme){
    const h = document.createElement('h2');
    h.textContent = 'תצוגה';
    h.style.marginTop = '22px';
    const seg = document.createElement('div');
    seg.className = 'sm-theme';
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'מצב תצוגה');
    const choices = [['auto', 'אוטומטי'], ['light', 'יום'], ['dark', 'לילה']];
    const mark = () => seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pref === SiteTheme.pref)));
    for (const [pref, label] of choices){
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.pref = pref;
      b.textContent = label;
      b.addEventListener('click', () => { SiteTheme.set(pref); mark(); });
      seg.appendChild(b);
    }
    mark();
    document.addEventListener('sitethemechange', mark);
    main.append(h, seg);
  }

  const btn = bar.querySelector('.sm-btn');
  badges.btn = btn;
  badges.total = document.createElement('span');
  badges.total.className = 'sm-count';
  badges.total.hidden = true;
  badges.total.setAttribute('aria-hidden', 'true');
  btn.appendChild(badges.total);
  renderCounts();
  const find = searchBox(nav, main);
  /* toSearch: פתיחה עם הסמן בשדה החיפוש (Ctrl+K). בפתיחה רגילה לא, כדי שבטלפון לא תקפוץ המקלדת */
  function open(toSearch){
    layer.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => {
      layer.classList.add('sm-open');
      (toSearch === true ? find.input : main.querySelector('a:not([hidden])')).focus();
    });
  }
  function close(){
    find.clear();
    layer.classList.remove('sm-open');
    btn.setAttribute('aria-expanded', 'false');
    setTimeout(() => { layer.hidden = true; }, 200);
    btn.focus();
  }
  btn.addEventListener('click', open);
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k'){ e.preventDefault(); open(true); }
  });
  closeMenu = () => { if (layer.hidden) return false; close(); return true; };
  layer.querySelector('.sm-shade').addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !layer.hidden) close(); });

  const stripe = document.createElement('div');
  stripe.className = 'sm-stripe';
  stripe.setAttribute('aria-hidden', 'true');

  const dayBox = document.createElement('div');
  dayBox.className = 'sm-day';
  dayBox.innerHTML = '<div class="sm-day-in"><div class="sm-day-syn"></div><div class="sm-day-dates"></div></div>';
  day = { syn: dayBox.querySelector('.sm-day-syn'), dates: dayBox.querySelector('.sm-day-dates') };
  renderDay();
  loadHebcal();

  document.body.prepend(bar, stripe, dayBox);
  document.body.appendChild(layer);
  pinTop(bar);
  checkGo();
}

/* ---------- מעבר למקום מדויק בדף: #go=... ----------
 * תוצאת חיפוש מובילה לכתובת עם #go=<יעד>, והדף פותח את המקום שממנו עושים את הפעולה ומסמן אותו בהבהוב.
 * יעד הוא אחד מאלה:
 *  ui:<צעד>|<צעד>|...       – סלקטורים. כל צעד חוץ מהאחרון נלחץ (לשונית, כפתור שפותח חלון), והאחרון מסומן.
 *                              הוא לא נלחץ, כך שחיפוש לעולם לא מבצע פעולה (מחיקה, שליחה) בעצמו
 *  <שם>:<ערך>;<צעד>|...     – רשומה: הדף רשם ב-SiteGo.on(שם, fn) איך מגיעים אליה (מעבר לחודש, פתיחת חלון),
 *                              ואחר כך, אם יש, צעדים כמו ב-ui
 * כל צעד מחכה שהאלמנט יופיע (הנתונים מגיעים מהשרת אחרי שהדף נטען), ופותח <details> סגור שהוא בתוכו */
const GO_WAIT = 12000;
const goHandlers = {};

function waitFor(test, ms = GO_WAIT){
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll(){
      let v = null;
      try { v = typeof test === 'string' ? document.querySelector(test) : test(); } catch (e) { /* סלקטור לא תקין */ }
      if (v) return resolve(v);
      if (Date.now() - t0 > ms) return reject(new Error('not found: ' + test));
      setTimeout(poll, 120);
    })();
  });
}

function reveal(el){
  for (let d = el.closest('details:not([open])'); d; d = d.closest('details:not([open])')) d.open = true;
}

/* מסמן את המקום: גוללים אליו ומהבהבים את השורה כולה (שורה בטבלה או ברשימה), או את האלמנט עצמו */
function flash(el){
  reveal(el);
  const target = el.closest('tr, .li, .al-row, .file-row, .community-file, .syn-item') || el;
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  target.classList.remove('sg-flash');
  void target.offsetWidth;
  target.classList.add('sg-flash');
  setTimeout(() => target.classList.remove('sg-flash'), 2600);
  if (el.matches('button, a, select, input:not([type=file]), textarea')) el.focus({ preventScroll: true });
}

/* האלמנט הראשון שמתאים לסלקטור ונראה על המסך. אלמנט שקיים בדף אבל מוסתר (עורך שעוד לא נפתח, לשונית אחרת)
 * עוד לא נחשב, אלא אם הוא מוסתר רק בתוך <details> סגור – אותו פותחים */
function visible(selector){
  for (const el of document.querySelectorAll(selector)){
    if (el.closest('details:not([open])')) reveal(el);
    if (el.getClientRects().length) return el;
  }
  return null;
}

async function runSteps(steps){
  for (let i = 0; i < steps.length; i++){
    const el = await waitFor(() => visible(steps[i]));
    if (i === steps.length - 1){ flash(el); return; }
    reveal(el);
    // לשונית שכבר נבחרה ו-<details> שכבר פתוח – לחיצה הייתה מחליפה מצב
    if (el.matches('summary') && el.parentElement.open) continue;
    if (el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-current') === 'page') continue;
    el.click();
    await new Promise(r => setTimeout(r, 150));
  }
}

async function go(spec){
  const i = spec.indexOf(':');
  if (i < 0) return;
  const name = spec.slice(0, i), rest = spec.slice(i + 1);
  const j = name === 'ui' ? -1 : rest.indexOf(';');
  const arg = j < 0 ? rest : rest.slice(0, j);
  const steps = (name === 'ui' ? rest : j < 0 ? '' : rest.slice(j + 1)).split('|').filter(Boolean);
  if (name !== 'ui'){
    const handler = await waitFor(() => goHandlers[name]);
    await handler(arg);
  }
  if (steps.length) await runSteps(steps);
}

function checkGo(){
  const m = /(?:^#|&)go=([^&]*)/.exec(location.hash);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  let spec = '';
  try { spec = decodeURIComponent(m[1]); } catch (e) { return; }
  go(spec).catch(e => console.warn('SiteGo', e));
}
window.addEventListener('hashchange', checkGo);

window.SiteGo = {
  /* דף רושם איך מגיעים לרשומה שלו: fn(ערך) – יכולה להיות אסינכרונית (לחכות לנתונים עם SiteGo.waitFor) */
  on(name, fn){ goHandlers[name] = fn; },
  waitFor,
  flash,
  /* כתובת ליעד: path – נתיב הדף ביחס לשורש האתר, spec – היעד כמו למעלה */
  href(path, spec){ return new URL(path, ROOT).href + (spec ? '#go=' + encodeURIComponent(spec) : ''); }
};

/* ---------- חיפוש בראש המגירה ----------
 * כשיש טקסט בשדה, התוצאות (js/search.js) מוצגות במקום רשימת הדפים והמגירה מתרחבת.
 * המודול נטען רק כשמתחילים להקליד בפעם הראשונה */
function searchBox(nav, main){
  const input = nav.querySelector('.sm-find input'), results = nav.querySelector('.sm-results');
  let search = null, loading = null;
  function show(){
    const on = input.value.trim() !== '';
    results.hidden = !on;
    main.hidden = on;
    nav.classList.toggle('sm-searching', on);
  }
  function clear(){
    input.value = '';
    if (search) search.reset();
    show();
  }
  input.addEventListener('input', () => {
    show();
    if (!loading) loading = import(new URL('js/search.js', ROOT).href)
      .then(m => { search = m.attach({ input, results }); search.run(); })
      .catch(() => { loading = null; });
  });
  // Escape עם טקסט בשדה מנקה את החיפוש, ולא סוגר את המגירה
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape' && input.value){ e.preventDefault(); e.stopPropagation(); clear(); }
  });
  return { input, clear };
}

/* גובה אזור המצלמה/שורת הסטטוס; 0 בדפדפן רגיל, ואז הכותרת נגללת כרגיל */
function topInset(){
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;height:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  return h;
}

/* מיקום המצלמה בפיקסלים של הדף: [{ l, r, b }] מהקצה השמאלי והעליון. MainActivity שולח את המלבנים
 * של המצלמה (בפיקסלים של המסך, יחד עם רוחב ה-WebView) ב-SiteMenu.setCutout; שומרים במכשיר כדי שבדף הבא
 * הפס יהיה מסודר כבר מההתחלה. בלי מידע (דפדפן, או גרסה ישנה של האפליקציה) מניחים מצלמה באמצע. */
const CUTOUT_KEY = 'site.cutout';
let cutout = read(CUTOUT_KEY), refit = () => {};
function cameras(){
  const c = cutout, vw = window.innerWidth;
  // מידע ממצב סיבוב אחר (רוחב אחר) לא מתאים למסך הנוכחי
  if (!c || !c.w || !Array.isArray(c.rects) || Math.abs(vw * (window.devicePixelRatio || 1) / c.w - 1) > 0.03) return [];
  const k = vw / c.w;
  return c.rects.map(([l, t, r, b]) => ({ l: l * k, t: t * k, r: r * k, b: b * k })).filter(x => x.r > x.l && x.b > 0);
}

function pinTop(bar){
  const title = bar.querySelector('.sm-title'), root = document.documentElement;
  const PAD = 10, BTN = 40, GAP = 10, CLEAR = 8, MIN_TITLE = 80;
  let pinned = false;

  /* מסדרים את הפס סביב המצלמה. הכפתור והכותרת מתחילים מימין (RTL), ולכן מודדים מרחקים מהקצה הימני:
   * מצלמה במקום הכפתור – מזיזים את שניהם אחריה; מצלמה בדרך של הכותרת – מקצרים אותה;
   * ואם לא נשאר לכותרת מקום (מגרעת רחבה) – הכפתור והכותרת יורדים לשורה שמתחת למצלמה */
  function setup(){
    const inset = topInset();
    pinned = inset > 0;
    root.classList.toggle('sm-pin', pinned);
    root.style.removeProperty('--sm-bar-h');
    bar.style.paddingRight = bar.style.paddingTop = '';
    title.style.maxWidth = '';
    if (pinned){
      const vw = window.innerWidth, cams = cameras().filter(c => c.t < inset + 1);
      const want = title.scrollWidth;
      let start = PAD, room = Infinity, under = 0;
      for (const c of cams.slice().sort((a, b) => b.r - a.r)){
        const near = vw - c.r, far = vw - c.l;
        if (near < start + BTN + CLEAR) start = Math.max(start, far + CLEAR);
        else room = Math.min(room, near - CLEAR - (start + BTN + GAP));
      }
      room = Math.min(room, vw - PAD - (start + BTN + GAP));
      if (room < Math.min(want, MIN_TITLE)){
        under = Math.ceil(Math.max(inset, ...cams.map(c => c.b)));
        bar.style.paddingTop = under + 'px';
        root.style.setProperty('--sm-bar-h', (under + 48) + 'px');
      } else {
        if (start > PAD) bar.style.paddingRight = Math.ceil(start) + 'px';
        if (room < want) title.style.maxWidth = Math.floor(room) + 'px';
        const low = Math.max(inset, ...cams.map(c => c.b));
        root.style.setProperty('--sm-bar-h', Math.ceil(Math.max(48, low)) + 'px');
      }
    }
  }
  refit = setup;
  window.addEventListener('resize', setup);
  if (document.fonts) document.fonts.ready.then(setup);
  setup();
}

/* כפתור "חזרה" של אנדרואיד באפליקציה: MainActivity קורא ל-SiteBack.handle(), שסוגר את מה שפתוח בדף (חלון,
 * מגירה, או מה שהדף רשם ב-SiteBack.add), ומחזיר true. false – אין מה לסגור, והאפליקציה חוזרת לדף הקודם. */
let closeMenu = () => false;
const backHandlers = [];
window.SiteBack = {
  add(fn){ backHandlers.push(fn); },
  handle(){
    const dialogs = document.querySelectorAll('dialog[open]');
    if (dialogs.length){
      const d = dialogs[dialogs.length - 1];
      if (d.dispatchEvent(new Event('cancel', { cancelable: true }))) d.close();
      return true;
    }
    const panel = document.querySelector('.sd-panel');
    if (panel){ (panel.querySelector('.sd-cancel') || panel.querySelector('.sd-ok')).click(); return true; }
    if (closeMenu()) return true;
    // לחיצה על הרקע של המגירה סוגרת אותה בכל הדפים
    const sheet = document.querySelector('.sheet-wrap:not([hidden])');
    if (sheet){ sheet.click(); return true; }
    for (let i = backHandlers.length - 1; i >= 0; i--) if (backHandlers[i]()) return true;
    return false;
  }
};

if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
})();
