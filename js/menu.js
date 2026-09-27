/* תפריט המבורגר משותף לשלושת הדפים: לוח זמנים, לוח קידושים וקופת בית הכנסת.
 * כל דף טוען את הקובץ הזה, והוא מוסיף פס עליון עם כפתור תפריט ומגירה עם שלושת הדפים.
 * הכתובות מחושבות ביחס למיקום הקובץ, כך שזה עובד גם מתיקיית משנה.
 */
(function(){
"use strict";
const ROOT = new URL('..', document.currentScript.src);
const PAGES = [
  { path: '',         title: 'לוח זמנים' },
  { path: 'kiddush/', title: 'לוח קידושים' },
  { path: 'gabbai/',  title: 'קופת בית הכנסת' }
];
const here = location.pathname.replace(/index\.html$/, '');
const current = PAGES.slice().reverse().find(p => here === new URL(p.path, ROOT).pathname) || PAGES[0];

const css = `
.sm-bar{display:flex;align-items:center;gap:10px;height:48px;padding:0 10px;padding-top:env(safe-area-inset-top,0px);background:#2c4a7c;color:#fff;font-family:"Assistant",Arial,sans-serif;direction:rtl}
.sm-btn{display:flex;align-items:center;justify-content:center;flex:none;width:40px;height:40px;padding:0;border:0;border-radius:10px;background:none;color:inherit;cursor:pointer}
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
:root[data-theme="dark"] .sm-drawer{background:#1a1f28;color:#e8ecf2}
:root[data-theme="dark"] .sm-drawer h2{color:#9ba4b3}
:root[data-theme="dark"] .sm-drawer a:hover{background:#232a36}
:root[data-theme="dark"] .sm-drawer a[aria-current="page"]{background:#2a3446;color:#fff}
:root[data-theme="dark"] .sm-theme{border-color:#2d3440}
:root[data-theme="dark"] .sm-theme button{color:#9ba4b3}
:root[data-theme="dark"] .sm-theme button[aria-pressed="true"]{background:#8fb0ec;color:#0f1524}
@media print{.sm-bar,.sm-layer{display:none!important}}
`;

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

  document.body.prepend(bar);
  document.body.appendChild(layer);
}

if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
})();
