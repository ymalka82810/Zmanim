/* תפריט המבורגר משותף לשלושת הדפים: לוח זמנים, לוח קידושים וקופת בית הכנסת.
 * כל דף טוען את הקובץ הזה, והוא מוסיף פס עליון עם כפתור תפריט, פס זהב מתחתיו, שורת היום
 * (שם הקהילה, השבת או החג הקרובים והתאריך) ומגירה עם שלושת הדפים.
 * הדף מעדכן את שם הקהילה ב-SiteMenu.setCommunity({ _id, name, il }); השם נשמר במכשיר כדי להופיע מיד בכניסה הבאה.
 * הקובץ גם רושם את ה-service worker מכל דף. הדפים נפתחים מהעותק שבמכשיר; כשגרסה חדשה של האתר
 * מסיימת לרדת ברקע, הדף מתרענן פעם אחת כדי להציג אותה (ואם המשתמש באמצע הקלדה – כשהוא עוזב את הדף).
 * הכתובות מחושבות ביחס למיקום הקובץ, כך שזה עובד גם מתיקיית משנה.
 */
(function(){
"use strict";
const ROOT = new URL('..', document.currentScript.src);
const PAGES = [
  { path: '',                   title: 'לוח זמנים' },
  { path: 'kiddush/',           title: 'לוח קידושים' },
  { path: 'gabbai/',            title: 'קופת בית הכנסת' },
  { path: 'account/',           title: 'החשבון שלי' },
  { path: 'community-calendar/', title: 'יומן קהילה', hidden: true } /* לא במגירה, רק כותרת הפס */
];
const here = location.pathname.replace(/index\.html$/, '');
const current = PAGES.slice().reverse().find(p => here === new URL(p.path, ROOT).pathname) || PAGES[0];

const css = `
.sm-bar{display:flex;align-items:center;gap:10px;box-sizing:border-box;height:calc(48px + env(safe-area-inset-top,0px));padding:0 10px;padding-top:env(safe-area-inset-top,0px);background:#2c4a7c;color:#fff;font-family:"Assistant",Arial,sans-serif;direction:rtl}
.sm-stripe{height:6px;background:linear-gradient(90deg,#1e3a63 0%,#ab7f2e 50%,#1e3a63 100%)}
.sm-btn{display:flex;align-items:center;justify-content:center;flex:none;width:40px;height:40px;padding:0;border:0;border-radius:10px;background:none;color:inherit;cursor:pointer;box-shadow:none;transform:none}
.sm-btn:hover,.sm-btn:focus-visible{background:rgba(255,255,255,.15)}
.sm-btn svg{width:24px;height:24px}
.sm-title{font-weight:700;font-size:1.05rem}
.sm-shade{position:fixed;inset:0;background:rgba(10,14,20,.45);z-index:900;opacity:0;transition:opacity .2s}
.sm-drawer{position:fixed;top:0;bottom:0;right:0;width:min(280px,82vw);background:#fff;color:#1d2b45;z-index:901;transform:translateX(100%);transition:transform .2s;padding:calc(12px + env(safe-area-inset-top,0px)) 10px 12px;box-shadow:-6px 0 24px rgba(10,20,40,.2);font-family:"Assistant",Arial,sans-serif;direction:rtl}
.sm-open .sm-shade{opacity:1}
.sm-open .sm-drawer{transform:none}
.sm-drawer h2{margin:4px 10px 12px;font-size:.85rem;font-weight:600;color:#5d6b82}
.sm-drawer a{display:block;padding:12px 14px;border-radius:10px;color:inherit;text-decoration:none;font-size:1.05rem;font-weight:600}
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
.sm-day-syn{font-size:.92rem;font-weight:600;color:#726c59}
.sm-day-title{font-family:"Frank Ruhl Libre",Georgia,serif;font-weight:900;font-size:clamp(2rem,6vw,2.6rem);line-height:1.15;margin:2px 0 4px;letter-spacing:.2px}
.sm-day-dates{font-size:.95rem;color:#726c59}
.sm-day-dates b{font-family:"Frank Ruhl Libre",Georgia,serif;font-weight:700;color:#202a3f}
:root[data-theme="dark"] .sm-day,:root[data-theme="dark"] .sm-day-dates b{color:#e9ecf5}
:root[data-theme="dark"] .sm-day-syn,:root[data-theme="dark"] .sm-day-dates{color:#98a2c0}
@media print{.sm-bar,.sm-stripe,.sm-day,.sm-layer{display:none!important}}
`;

/* ---------- שורת היום ---------- */
const COMMUNITY_KEY = 'site.community', ACTIVE_KEY = 'site.activeSynagogue', CONFIG_KEY = 'zmanim.config';
const HEBCAL_SRC = new URL('vendor/hebcal/hebcal-core-6.9.3.min.js', ROOT).href;
function read(key){ try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }
function readRaw(key){ try { return localStorage.getItem(key); } catch (e) { return null; } }
function write(key, v){ try { v == null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* אין גישה לאחסון */ } }

let day = null;
const gLong = new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const noNiqqud = s => String(s).replace(/[֑-ׇ]/g, '');

/* הקהילה הפעילה כפי שנשמרה במכשיר; בלי קהילה – שם בית הכנסת מהגדרות לוח הזמנים */
function community(){
  const saved = read(COMMUNITY_KEY), cfg = read(CONFIG_KEY) || {};
  if (saved && saved._id === readRaw(ACTIVE_KEY)) return saved;
  return { name: (cfg.shul || '').trim(), il: cfg.il !== false };
}

/* השבת או החג הקרובים (כמו בקופה): פרשת השבוע, או "שבת <חג>" כשהשבת היא חג */
function occasion(date, il){
  const H = window.hebcal;
  if (!H) return { heb: new Intl.DateTimeFormat('he-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric' }).format(date), title: '' };
  const hd = new H.HDate(date);
  let title = '';
  try {
    const p = new H.Sedra(hd.getFullYear(), il).lookup(hd);
    const name = p.parsha.map(x => noNiqqud(H.Locale.gettext(x, 'he'))).join('-');
    title = p.chag ? 'שבת ' + name : 'פרשת ' + name;
  } catch (e) { /* אין פרשה לתאריך הזה */ }
  return { heb: hd.renderGematriya(true), title };
}

function renderDay(){
  if (!day) return;
  const c = community(), now = new Date(), o = occasion(now, c.il !== false);
  day.syn.textContent = c.name || '';
  day.syn.hidden = !c.name;
  day.title.textContent = o.title;
  day.title.hidden = !o.title;
  day.dates.textContent = '';
  const b = document.createElement('b');
  b.textContent = o.heb;
  day.dates.append(b, ' · ' + gLong.format(now));
}

function loadHebcal(){
  if (window.hebcal) return;
  const s = document.createElement('script');
  s.src = HEBCAL_SRC;
  s.onload = renderDay;
  document.head.appendChild(s);
}

window.SiteMenu = {
  /* s: { _id, name, il } של הקהילה הפעילה, או null כשאין */
  setCommunity(s){
    write(COMMUNITY_KEY, s && s.name ? { _id: s._id, name: s.name, il: !!s.il } : null);
    renderDay();
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
  layer.innerHTML = `<div class="sm-shade"></div><nav class="sm-drawer" id="sm-drawer" aria-label="דפי האתר"><h2>בית הכנסת</h2></nav>`;
  const nav = layer.querySelector('nav');
  for (const p of PAGES){
    if (p.hidden) continue;
    const a = document.createElement('a');
    a.href = new URL(p.path, ROOT).href;
    a.textContent = p.title;
    if (p === current) a.setAttribute('aria-current', 'page');
    nav.appendChild(a);
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
    nav.append(h, seg);
  }

  const btn = bar.querySelector('.sm-btn');
  function open(){
    layer.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => { layer.classList.add('sm-open'); nav.querySelector('a').focus(); });
  }
  function close(){
    layer.classList.remove('sm-open');
    btn.setAttribute('aria-expanded', 'false');
    setTimeout(() => { layer.hidden = true; }, 200);
    btn.focus();
  }
  btn.addEventListener('click', open);
  layer.querySelector('.sm-shade').addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !layer.hidden) close(); });

  const stripe = document.createElement('div');
  stripe.className = 'sm-stripe';
  stripe.setAttribute('aria-hidden', 'true');

  const dayBox = document.createElement('div');
  dayBox.className = 'sm-day';
  dayBox.innerHTML = '<div class="sm-day-in"><div class="sm-day-syn"></div><div class="sm-day-title"></div><div class="sm-day-dates"></div></div>';
  day = { syn: dayBox.querySelector('.sm-day-syn'), title: dayBox.querySelector('.sm-day-title'), dates: dayBox.querySelector('.sm-day-dates') };
  renderDay();
  loadHebcal();

  document.body.prepend(bar, stripe, dayBox);
  document.body.appendChild(layer);
}

if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
})();
