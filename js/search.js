/* החיפוש שבראש מגירת התפריט (js/menu.js). מודול שנטען בפעם הראשונה שמתחילים להקליד בשדה החיפוש.
 * מחפש בשלושה מקומות:
 *  - דפי האתר שהמשתמש רואה במגירה (SiteMenu.visiblePages), עם מילים שמובילות לכל דף – גם בלי חיבור ובלי התחברות;
 *  - הפעולות וההגדרות שבדפים האלה (js/search-actions.js), לפי התפקיד – גם בלי חיבור;
 *  - נתוני הקהילה הפעילה ב-search:run (convex/search.ts), שמחזיר רק מה שהמשתמש רשאי לראות לפי תפקידו.
 * כל תוצאה מובילה למקום המדויק בדף (SiteGo ב-js/menu.js): ללשונית, לחלון ולכפתור שממנו עושים את הפעולה.
 * ההשוואה (מילים נרדפות, כתיב מלא, אותיות שימוש) ב-js/search-words.js, המשותף לשרת.
 * התוצאות לא נשמרות במכשיר (בניגוד ל-SiteAuth.query), כדי שחיפושים לא יישארו באחסון של הדפדפן.
 */
import { normalize, parseQuery, score } from './search-words.js';
import { ACTIONS } from './search-actions.js';

/* מילים שמובילות לכל דף, לפי הנתיב שב-js/menu.js: מה שיש בדף ומה שעושים בו */
const PAGE_WORDS = {
  '':                   'זמני תפילות לוח זמנים שבת חג הגדרות תבנית עיצוב הדפסה pdf שיתוף וואטסאפ שקיעה הדלקת נרות מנחה ערבית שחרית מוסף הבדלה',
  'week/':              'השבוע שלי אזכרות מניין אני מגיע תזכורות',
  'kiddush/':           'קידוש רישום שבת בעל קידוש שותפים תקנון ביטול',
  'gabbai/':            'קופה תרומה כסף תשלום מצווה הוצאות משכורת קופה קטנה דוח',
  'aliyot/':            'עלייה לתורה חיוב חתן בר מצווה כהן לוי מכרז מכירה פומבית הצעה מחיר כיבוד פתיחה גלילה הגבהה מפטיר',
  'account/':           'חשבון פרופיל קהילה חברים הזמנה קישור הצטרפות התחברות התנתקות יציאה שם בעברית טלפון פיצרים עמוד לאורחים',
  'community-calendar/':'יומן קהילה לוח שנה אירוע שיעור הוספת אירוע'
};

const KINDS = {
  page:     'דפים',
  action:   'פעולות והגדרות',
  event:    'אירועי קהילה',
  kiddush:  'קידושים',
  schedule: 'לוחות זמנים',
  yahrzeit: 'אזכרות',
  minyan:   'מניינים',
  aliyah:   'עליות לתורה',
  fund:     'קופה',
  member:   'חברי קהילה'
};

/* הפעולות שהמשתמש יכול לעשות: הדף שלהן מוצג לו במגירה, ופעולה של גבאי ורב – רק כשידוע שהוא גבאי או רב */
function searchActions(query){
  const pages = new Set((window.SiteMenu ? SiteMenu.visiblePages() : []).map(p => p.path));
  const role = window.SiteMenu ? SiteMenu.role() : { manager: null };
  const sid = window.SiteAuth && SiteAuth.activeSynagogueId();
  return ACTIONS
    .filter(a => pages.has(a.page) && (a.who !== 'manager' || role.manager === true) && (sid || !a.go.includes('{sid}')))
    .map(a => ({ kind: 'action', title: a.title, sub: '', dateKey: null,
      href: SiteGo.href(a.page, 'ui:' + a.go.replace(/\{sid\}/g, sid)), score: score(a.title, a.words || '', query) }))
    .filter(a => a.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

const css = `
.sm-results .ss-group{margin:12px 10px 4px;font-size:.8rem;font-weight:700;color:#5d6b82}
.sm-drawer .sm-results a.ss-item{display:block;padding:9px 10px;font-size:1rem;font-weight:400}
.sm-drawer .sm-results a.ss-item.ss-sel{background:#eef3fa}
.ss-title{font-weight:600}
.ss-sub{font-size:.88rem;color:#5d6b82;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.ss-date{color:#2c4a7c;font-weight:600}
.ss-note{margin:12px 10px;color:#5d6b82;font-size:.92rem}
mark.ss-hit{background:#fbe7b4;color:inherit;border-radius:3px}
:root[data-theme="dark"] .sm-results .ss-group,:root[data-theme="dark"] .ss-sub,:root[data-theme="dark"] .ss-note{color:#9ba4b3}
:root[data-theme="dark"] .sm-drawer .sm-results a.ss-item.ss-sel{background:#232a36}
:root[data-theme="dark"] .ss-date{color:#8fb0ec}
:root[data-theme="dark"] mark.ss-hit{background:#5a4a1e}
`;

let input, results, timer = 0, seq = 0, lastQ = null;

function searchPages(query){
  const pages = window.SiteMenu ? SiteMenu.visiblePages() : [];
  return pages
    .map(p => ({ kind: 'page', title: p.title, sub: '', dateKey: null, href: p.href, score: score(p.title, PAGE_WORDS[p.path] || '', query) }))
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score);
}

const gDate = new Intl.DateTimeFormat('he-IL', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
function dateText(key){
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (isNaN(date)) return '';
  const heb = window.hebcal ? new hebcal.HDate(date).renderGematriya(true) : '';
  return heb ? `${heb} · ${gDate.format(date)}` : gDate.format(date);
}

/* הטקסט, כשמילים שמתאימות לחיפוש מודגשות (מילה שלמה שאחת מצורות החיפוש נמצאת בה) */
function highlighted(text, query){
  const frag = document.createDocumentFragment();
  const alts = query.flat().map(a => a.trim()).filter(a => a.length > 1);
  text.split(/(\s+)/).forEach(word => {
    const n = normalize(word);
    if (n && alts.some(a => n.includes(a) || a.includes(n) && n.length > 2)){
      const m = document.createElement('mark');
      m.className = 'ss-hit';
      m.textContent = word;
      frag.append(m);
    } else frag.append(word);
  });
  return frag;
}

function render(items, query, note){
  results.textContent = '';
  let group = null;
  const order = Object.keys(KINDS);
  items.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  for (const r of items){
    if (r.kind !== group){
      group = r.kind;
      const h = document.createElement('div');
      h.className = 'ss-group';
      h.textContent = KINDS[r.kind] || '';
      results.append(h);
    }
    const a = document.createElement('a');
    a.className = 'ss-item';
    a.href = r.href;
    const t = document.createElement('div');
    t.className = 'ss-title';
    t.append(highlighted(r.title, query));
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
      if (r.sub) s.append(highlighted(r.sub, query));
      a.append(s);
    }
    // מעבר באותו דף משנה רק את ה-#, ולכן סוגרים את המגירה כדי שיראו לאן הגיעו
    a.addEventListener('click', () => SiteMenu.close());
    results.append(a);
  }
  if (note){
    const p = document.createElement('p');
    p.className = 'ss-note';
    p.textContent = note;
    results.append(p);
  }
}

async function run(){
  const q = input.value;
  if (q === lastQ) return;
  lastQ = q;
  const id = ++seq;
  const query = parseQuery(q);
  if (!query.length){
    render([], query, q.trim() ? 'יש להקליד לפחות שתי אותיות' : '');
    return;
  }
  const pages = searchPages(query).concat(searchActions(query));
  const Auth = window.SiteAuth;
  const sid = Auth && Auth.isAuthenticated() ? Auth.activeSynagogueId() : null;
  if (!sid){
    render(pages, query, pages.length ? '' : 'לא נמצאו תוצאות. כדי לחפש גם בנתוני הקהילה יש להתחבר.');
    return;
  }
  render(pages, query, 'מחפש…');
  let data = null, failed = false;
  try { data = await Auth.client().query('search:run', { synagogueId: sid, q }); }
  catch (e){ failed = true; }
  if (id !== seq) return;   // בינתיים הקלידו עוד
  const items = pages.concat((data && data.items || []).map(r => ({ ...r, href: SiteGo.href(r.page, r.go) })));
  const note = failed ? 'אין חיבור, ולכן החיפוש הוא רק בדפי האתר.'
    : !items.length ? 'לא נמצאו תוצאות.'
    : data && data.more ? 'יש תוצאות נוספות – אפשר לדייק את החיפוש.' : '';
  render(items, query, note);
}

/* חיצים למעלה/למטה בין התוצאות, Enter פותח את המסומנת (או את הראשונה) */
function onKey(e){
  const items = [...results.querySelectorAll('.ss-item')];
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

/* מחבר את החיפוש לשדה ולאזור התוצאות שבמגירה. menu.js מציג את התוצאות במקום רשימת הדפים כשיש טקסט בשדה */
export function attach(el){
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  input = el.input;
  results = el.results;
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 200); });
  input.addEventListener('keydown', onKey);
  return { run: () => { lastQ = null; run(); }, reset: () => { lastQ = null; seq++; results.textContent = ''; } };
}
