/* חלונית החיפוש של האתר והאפליקציה. נטענת מ-js/menu.js בפעם הראשונה שלוחצים על כפתור החיפוש (או Ctrl+K).
 * מחפשת בשני מקומות:
 *  - דפי האתר שהמשתמש רואה במגירה (SiteMenu.visiblePages), עם מילים נרדפות לכל דף – גם בלי חיבור ובלי התחברות;
 *  - נתוני הקהילה הפעילה ב-search:run (convex/search.ts), שמחזיר רק מה שהמשתמש רשאי לראות לפי תפקידו.
 * התוצאות לא נשמרות במכשיר (בניגוד ל-SiteAuth.query), כדי שחיפושים לא יישארו באחסון של הדפדפן.
 */
(function(){
"use strict";

/* מילים נוספות שמובילות לכל דף, לפי הנתיב שב-js/menu.js */
const PAGE_WORDS = {
  '':                   'זמני תפילות לוח שבת חג הגדרות תבנית עיצוב הדפסה pdf שקיעה מנחה ערבית שחרית',
  'week/':              'השבוע שלי אזכרות מניין אני מגיע תזכורות',
  'kiddush/':           'קידוש רישום שבת בעל קידוש שותפים תקנון',
  'gabbai/':            'קופה תרומה תרומות כסף תשלום מצווה הוצאות משכורת',
  'aliyot/':            'עלייה עליות לתורה חיוב חתן בר מצווה כהן לוי',
  'account/':           'חשבון פרופיל קהילה חברים הזמנה הזמנות התחברות התנתקות יציאה שם טלפון פיצרים',
  'community-calendar/':'יומן לוח שנה אירועים אירוע'
};

const KINDS = {
  page:     'דפים',
  event:    'אירועי קהילה',
  kiddush:  'קידושים',
  schedule: 'לוחות זמנים',
  yahrzeit: 'אזכרות',
  minyan:   'מניינים',
  aliyah:   'עליות לתורה',
  fund:     'קופה',
  member:   'חברי קהילה'
};

/* כמו normalize ב-convex/search.ts */
function normalize(text){
  return String(text || '').toLowerCase()
    .replace(/[֑-ׇ]/g, '')
    .replace(/[׳״'"`]/g, '')
    .replace(/[ךםןףץ]/g, c => ({ ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' })[c] || c)
    .replace(/[\s\-–—_.,:;!?()/\\·]+/g, ' ')
    .trim();
}

const css = `
.ss-dlg{box-sizing:border-box;width:min(620px,100vw - 24px);max-height:min(640px,100dvh - 24px);margin:max(12px,env(safe-area-inset-top,0px)) auto auto;padding:0;border:0;border-radius:16px;background:#fff;color:#1d2b45;box-shadow:0 18px 48px rgba(10,20,40,.28);font-family:"Assistant",Arial,sans-serif;direction:rtl;overflow:hidden}
.ss-dlg[open]{display:flex;flex-direction:column}
.ss-dlg::backdrop{background:rgba(10,14,20,.45)}
.ss-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #e3e8f0}
.ss-head svg{flex:none;width:22px;height:22px;color:#5d6b82}
.ss-input{flex:1;min-width:0;padding:10px 4px;border:0;outline:0;background:none;color:inherit;font:inherit;font-size:1.1rem}
.ss-close{flex:none;padding:6px 10px;border:0;border-radius:8px;background:none;color:#5d6b82;font:inherit;font-weight:600;cursor:pointer}
.ss-close:hover{background:#eef3fa}
.ss-body{overflow:auto;padding:6px 8px 12px;overscroll-behavior:contain}
.ss-group{margin:10px 8px 4px;font-size:.8rem;font-weight:700;color:#5d6b82}
.ss-item{display:block;padding:9px 10px;border-radius:10px;color:inherit;text-decoration:none}
.ss-item:hover,.ss-item:focus-visible,.ss-item.ss-sel{background:#eef3fa;outline:0}
.ss-title{font-weight:600}
.ss-sub{font-size:.88rem;color:#5d6b82;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ss-date{color:#2c4a7c;font-weight:600}
.ss-note{margin:14px 10px;color:#5d6b82;font-size:.95rem}
mark.ss-hit{background:#fbe7b4;color:inherit;border-radius:3px}
:root[data-theme="dark"] .ss-dlg{background:#1a1f28;color:#e8ecf2}
:root[data-theme="dark"] .ss-head{border-color:#2d3440}
:root[data-theme="dark"] .ss-head svg,:root[data-theme="dark"] .ss-close,:root[data-theme="dark"] .ss-group,:root[data-theme="dark"] .ss-sub,:root[data-theme="dark"] .ss-note{color:#9ba4b3}
:root[data-theme="dark"] .ss-close:hover,:root[data-theme="dark"] .ss-item:hover,:root[data-theme="dark"] .ss-item:focus-visible,:root[data-theme="dark"] .ss-item.ss-sel{background:#232a36}
:root[data-theme="dark"] .ss-date{color:#8fb0ec}
:root[data-theme="dark"] mark.ss-hit{background:#5a4a1e}
@media (max-width:560px){.ss-dlg{width:100vw;max-width:100vw;height:100dvh;max-height:100dvh;margin:0;border-radius:0;padding-top:env(safe-area-inset-top,0px)}}
@media print{.ss-dlg{display:none!important}}
`;

let dlg = null, input = null, body = null, timer = 0, seq = 0, lastQ = null;

function build(){
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  dlg = document.createElement('dialog');
  dlg.className = 'ss-dlg';
  dlg.setAttribute('aria-label', 'חיפוש');
  dlg.innerHTML = `<div class="ss-head">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>
      <input class="ss-input" type="search" enterkeyhint="search" autocomplete="off" placeholder="חיפוש באתר ובקהילה" aria-label="חיפוש">
      <button type="button" class="ss-close">סגירה</button>
    </div><div class="ss-body" role="listbox" aria-label="תוצאות"></div>`;
  input = dlg.querySelector('.ss-input');
  body = dlg.querySelector('.ss-body');
  dlg.querySelector('.ss-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 220); });
  input.addEventListener('keydown', onKey);
  document.body.appendChild(dlg);
}

/* חיצים למעלה/למטה בין התוצאות, Enter פותח את המסומנת (או את הראשונה) */
function onKey(e){
  const items = [...body.querySelectorAll('.ss-item')];
  if (!items.length) return;
  let i = items.findIndex(a => a.classList.contains('ss-sel'));
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){
    e.preventDefault();
    if (i >= 0) items[i].classList.remove('ss-sel');
    i = e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1);
    items[i].classList.add('ss-sel');
    items[i].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter'){
    e.preventDefault();
    items[Math.max(0, i)].click();
  }
}

function searchPages(phrase){
  const terms = phrase.split(' ');
  const pages = window.SiteMenu ? SiteMenu.visiblePages() : [];
  return pages
    .filter(p => { const t = normalize(p.title + ' ' + (PAGE_WORDS[p.path] || '')); return terms.every(w => t.includes(w)); })
    .map(p => ({ kind: 'page', title: p.title, sub: '', dateKey: null, href: p.href }));
}

const gDate = new Intl.DateTimeFormat('he-IL', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
function dateText(key){
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (isNaN(date)) return '';
  const heb = window.hebcal ? new hebcal.HDate(date).renderGematriya(true) : '';
  return heb ? `${heb} · ${gDate.format(date)}` : gDate.format(date);
}

/* הטקסט, כשהמילים שחיפשו מודגשות. ההשוואה בלי ניקוד וסופיות, ולכן מסמנים רק התאמה מדויקת שקל למצוא */
function highlighted(text, terms){
  const frag = document.createDocumentFragment();
  const words = terms.filter(t => t.length > 1).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length){ frag.append(text); return frag; }
  const re = new RegExp('(' + words.join('|') + ')', 'gi');
  text.split(re).forEach((part, i) => {
    if (i % 2){ const m = document.createElement('mark'); m.className = 'ss-hit'; m.textContent = part; frag.append(m); }
    else if (part) frag.append(part);
  });
  return frag;
}

function render(items, terms, note){
  body.textContent = '';
  let group = null;
  const order = Object.keys(KINDS);
  items.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  for (const r of items){
    if (r.kind !== group){
      group = r.kind;
      const h = document.createElement('div');
      h.className = 'ss-group';
      h.textContent = KINDS[r.kind] || '';
      body.append(h);
    }
    const a = document.createElement('a');
    a.className = 'ss-item';
    a.href = r.href;
    a.setAttribute('role', 'option');
    const t = document.createElement('div');
    t.className = 'ss-title';
    t.append(highlighted(r.title, terms));
    a.append(t);
    if (r.sub || r.dateKey){
      const s = document.createElement('div');
      s.className = 'ss-sub';
      if (r.dateKey){
        const d = document.createElement('span');
        d.className = 'ss-date';
        d.textContent = dateText(r.dateKey);
        s.append(d, r.sub ? ' · ' : '');
      }
      if (r.sub) s.append(highlighted(r.sub, terms));
      a.append(s);
    }
    a.addEventListener('click', () => dlg.close());
    body.append(a);
  }
  if (note){
    const p = document.createElement('p');
    p.className = 'ss-note';
    p.textContent = note;
    body.append(p);
  }
}

async function run(){
  const q = input.value;
  const phrase = normalize(q);
  if (phrase === lastQ) return;
  lastQ = phrase;
  const id = ++seq;
  if (phrase.length < 2){
    render([], [], phrase ? 'יש להקליד לפחות שתי אותיות' : 'אפשר לחפש דפים, אירועים, קידושים, אזכרות ועוד – לפי מה שפתוח לך בקהילה.');
    return;
  }
  const terms = q.trim().split(/\s+/);
  const pages = searchPages(phrase);
  const Auth = window.SiteAuth;
  const sid = Auth && Auth.isAuthenticated() ? Auth.activeSynagogueId() : null;
  if (!sid){
    render(pages, terms, pages.length ? '' : 'לא נמצאו תוצאות. כדי לחפש גם בנתוני הקהילה יש להתחבר.');
    return;
  }
  render(pages, terms, 'מחפש…');
  let data = null, failed = false;
  try { data = await Auth.client().query('search:run', { synagogueId: sid, q }); }
  catch (e){ failed = true; }
  if (id !== seq) return;   // בינתיים הקלידו עוד
  const items = pages.concat((data && data.items || []).map(r => ({ ...r, href: SiteMenu.href(r.page) })));
  const note = failed ? 'אין חיבור, ולכן החיפוש הוא רק בדפי האתר.'
    : !items.length ? 'לא נמצאו תוצאות.'
    : data && data.more ? 'יש תוצאות נוספות – אפשר לדייק את החיפוש.' : '';
  render(items, terms, note);
}

window.SiteSearch = {
  open(){
    if (!dlg) build();
    if (!dlg.open) dlg.showModal();
    lastQ = null;
    input.select();
    run();
  }
};
})();
