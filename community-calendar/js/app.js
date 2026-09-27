/* יומן קהילה: מסך תצוגה מאוחד שמשלב קידושים מאושרים, איזה לוח זמנים בתוקף ותזכורות קופה,
 * כדי שחבר קהילה לא יצטרך לעבור בין שלושת הדפים כדי לדעת מה קורה בשבת הקרובה.
 * הנתונים מגיעים משלוש שאילתות קיימות (kiddush:board, schedules:list, fund:ledger) בלי לוגיקת שרת חדשה.
 */
(function(){
"use strict";
const { H, esc, gShort, heMonth, heYear, heDay, getSlots, monthRange } = window.KiddushCalendar || {};
const $ = s => document.querySelector(s);
const Auth = window.SiteAuth;
const ROLE_LABEL = { gabbai: 'גבאי', rabbi: 'רב', member: 'חבר קהילה' };
const ACCOUNT_URL = '../account/';
const MODE_LABEL = { holy: 'שבתות וחגים', days: 'ימות השבוע' };

const ICON = {
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg>',
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m15 6-6 6 6 6"/></svg>',
};

const S = {
  ready: false, fatal: null, signedIn: false, synagogues: [], sid: null,
  board: null, boardError: null, schedule: null, fund: null,
  anchor: (window.KiddushCalendar ? today0() : new Date()),
};
function today0(){ const d = new Date(); d.setHours(0,0,0,0); return d; }

const isManager = () => S.board && (S.board.role === 'gabbai' || S.board.role === 'rabbi');
const bookingOf = k => S.board?.bookings.find(b => b.dateKey === k) || null;

/* ---------- Boot & data ---------- */
async function boot(){
  if (!H || !window.KiddushCalendar){ S.fatal = 'לא ניתן לטעון את לוח השנה העברי. רעננו את העמוד.'; return render(); }
  render();
  try { await Auth.completeSignInFromRedirect(); } catch(e){ console.warn(e); }
  Auth.onChange(() => { S.signedIn = Auth.isAuthenticated(); loadSynagogues(); });
  S.signedIn = Auth.isAuthenticated();
  await loadSynagogues();
}

async function loadSynagogues(){
  if (!S.signedIn){ S.ready = true; S.synagogues = []; attach(null); return render(); }
  let synagogues = [];
  try {
    const [me, list] = await Promise.all([Auth.client().query('users:me', {}), Auth.client().query('synagogues:mine', {})]);
    if (me === null) S.signedIn = false;
    synagogues = list;
  } catch(e){ console.warn(e); }
  S.synagogues = synagogues;
  if (!S.signedIn){ S.ready = true; attach(null); return render(); }
  S.ready = true;
  let sid = Auth.activeSynagogueId();
  if (!S.synagogues.some(s => s._id === sid)){ sid = S.synagogues[0]?._id || null; Auth.setActiveSynagogueId(sid); }
  attach(sid);
  render();
}

let unsubBoard = null, unsubSchedule = null, unsubFund = null;
function attach(sid){
  if (sid === S.sid && unsubBoard) return;
  [unsubBoard, unsubSchedule, unsubFund].forEach(u => u && u());
  unsubBoard = unsubSchedule = unsubFund = null;
  S.sid = sid; S.board = null; S.boardError = null; S.schedule = null; S.fund = null;
  if (!sid) return;
  unsubBoard = Auth.client().onUpdate('kiddush:board', { synagogueId: sid }, board => { S.board = board; render(); },
    e => { console.warn(e); S.boardError = errMsg(e); render(); });
  unsubSchedule = Auth.client().onUpdate('schedules:list', { synagogueId: sid }, data => { S.schedule = data; render(); }, () => {});
  unsubFund = Auth.client().onUpdate('fund:ledger', { synagogueId: sid }, data => { S.fund = data; render(); }, () => {});
}

function errMsg(e){ return (e && typeof e.data === 'string') ? e.data : 'הפעולה לא נשמרה. נסו שוב.'; }

/* ---------- Derived data ---------- */
function currentScheduleFile(){
  if (!S.schedule) return undefined; // עדיין בטעינה
  const approved = S.schedule.files.filter(f => f.status === 'approved').sort((a, b) => a.firstDate < b.firstDate ? -1 : 1);
  return approved[approved.length - 1] || null;
}
function fundSummary(){
  if (!S.fund) return undefined;
  if (isManager()){
    const open = (S.fund.txs || []).filter(t => !t.paid && t.donorId && (t.type === 'donation' || t.type === 'mitzvah'));
    return { count: open.length, total: open.reduce((s, t) => s + t.amount, 0), manager: true };
  }
  const unpaid = (S.fund.txs || []).filter(t => !t.paid);
  const unread = (S.fund.notifications || []).filter(n => !n.read).length;
  return { count: unpaid.length, total: unpaid.reduce((s, t) => s + t.amount, 0), unread, manager: false };
}

/* ---------- Render ---------- */
function hero(text, button){ return `<div class="hero"><h1>יומן קהילה</h1><p class="muted">${text}</p></div>${button || ''}`; }

function render(){
  const app = $('#app');
  if (S.fatal){ app.innerHTML = hero(esc(S.fatal)); return; }
  if (!S.ready){ app.innerHTML = '<div class="empty">טוען…</div>'; return; }
  if (!S.signedIn){ app.innerHTML = hero('כדי לראות את יומן הקהילה יש להתחבר עם חשבון Google.', '<button class="btn" data-act="signIn">כניסה עם Google</button>'); return; }
  if (!S.sid){ app.innerHTML = hero('עדיין לא הצטרפת לקהילה. אפשר להצטרף דרך הזמנה מהגבאי או לפתוח קהילה חדשה.', `<a class="btn" href="${ACCOUNT_URL}">לחשבון שלי</a>`); return; }
  if (S.boardError){ app.innerHTML = hero(esc(S.boardError), `<a class="btn" href="${ACCOUNT_URL}">לחשבון שלי</a>`); return; }
  if (!S.board){ app.innerHTML = '<div class="empty">טוען…</div>'; return; }
  app.innerHTML = headerHTML() + bannersHTML() + calendarHTML();
}

function headerHTML(){
  const s = S.board.synagogue;
  const switcher = S.synagogues.length > 1
    ? `<select class="btn sec" id="synSwitch" aria-label="החלפת קהילה">${S.synagogues.map(x => `<option value="${x._id}"${x._id === S.sid ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`
    : '';
  return `<header class="top">
    <div class="shul"><h1>${esc(s.name)}</h1><small>${esc(s.city || '')}${s.city ? ', ' : ''}${s.il ? 'ארץ ישראל' : 'חוץ לארץ'} | ${ROLE_LABEL[S.board.role]}</small></div>
    ${switcher}
  </header>`;
}

function bannersHTML(){
  const file = currentScheduleFile();
  const scheduleCard = file === undefined ? ''
    : file === null
      ? `<div class="card"><h3>לוח הזמנים</h3><p class="small muted">עדיין אין לוח זמנים מאושר לקהילה.</p></div>`
      : `<div class="card"><h3>לוח הזמנים בתוקף</h3><p class="small">${esc(file.title)} · ${MODE_LABEL[file.mode]}</p>
        <div class="row" style="margin-top:8px"><a class="btn sec" href="../">ללוח המלא</a></div></div>`;

  const fund = fundSummary();
  let fundCard = '';
  if (fund && fund.count > 0){
    fundCard = fund.manager
      ? `<div class="card remind"><h3>חיובים פתוחים בקופה</h3><p>${fund.count} חיובים על סך ₪${fund.total.toLocaleString('he-IL')} עדיין לא שולמו.</p>
          <div class="row"><a class="btn sec" href="../gabbai/">לקופה</a></div></div>`
      : `<div class="card remind"><h3>יש לך תשלום פתוח</h3><p>${fund.count} חיובים על סך ₪${fund.total.toLocaleString('he-IL')} מחכים לתשלום מצדך.</p>
          <div class="row"><a class="btn sec" href="../gabbai/">לפרטים ותשלום</a></div></div>`;
  }

  let pendingCard = '';
  if (isManager()){
    const pending = S.board.bookings.filter(b => b.status === 'pending').length;
    if (pending > 0) pendingCard = `<div class="card remind"><h3>בקשות קידוש ממתינות</h3><p>${pending} בקשות מחכות לאישור שלך.</p>
      <div class="row"><a class="btn sec" href="../kiddush/">לאישור</a></div></div>`;
  }

  return pendingCard + fundCard + scheduleCard;
}

function calendarHTML(){
  const s = S.board.synagogue, { start, end } = monthRange(S.anchor, 'heb');
  const slots = getSlots(start, end, !!s.il);
  const hs = new H.HDate(start);
  const title = heMonth(hs) + ' ' + heYear(hs.getFullYear());
  const alt = (function(){
    const m1 = start.toLocaleDateString('he-IL', { month: 'long' }), m2 = end.toLocaleDateString('he-IL', { month: 'long' });
    return (m1 === m2 ? m1 : m1 + ' – ' + m2) + ' ' + end.getFullYear();
  })();
  const rows = slots.map(sl => {
    const b = bookingOf(sl.key), past = sl.date < today0(), isToday = +sl.date === +today0();
    const big = heDay(sl.hd), small = gShort(sl.date);
    return `<a class="slot${past ? ' past' : ''}${isToday ? ' today' : ''}" href="../kiddush/">
      <div class="date"><div class="big">${big}</div><div class="small">${esc(small)}</div></div>
      <div><div class="kind">${esc(sl.kind)}</div><h3>${esc(sl.name)}</h3>${sl.subs.length ? `<div class="sub">${esc(sl.subs.join(', '))}</div>` : ''}</div>
      <div class="stcol">${kiddushChip(b, past)}</div></a>`;
  }).join('');
  return `<div class="monthbar">
    <button class="nav" type="button" data-act="prev" aria-label="החודש הקודם">${ICON.right}</button>
    <div class="title"><h2>${esc(title)}</h2><div class="alt">${esc(alt)}</div></div>
    <button class="nav" type="button" data-act="next" aria-label="החודש הבא">${ICON.left}</button>
  </div>
  <div class="modebar"><button class="link" type="button" data-act="today">היום</button></div>
  <div class="slots">${rows || '<div class="empty">אין שבתות או חגים בחודש הזה.</div>'}</div>`;
}

function kiddushChip(b, past){
  if (!b) return past ? '<span class="chip block">עבר</span>' : '<span class="chip free">אין קידוש</span>';
  if (b.status === 'blocked') return `<span class="chip block">${esc(b.blockLabel || 'לא זמין')}</span>`;
  if (b.status === 'approved') return `<span class="chip appr">קידוש</span><span class="by">${esc(b.sponsorName)}${b.occasion ? ' · ' + esc(b.occasion) : ''}</span>`;
  return isManager() ? '<span class="chip pend">ממתין לאישור</span>' : (past ? '<span class="chip block">עבר</span>' : '<span class="chip free">אין קידוש</span>');
}

/* ---------- Actions ---------- */
const A = {
  signIn: () => Auth.signInWithGoogle(location.href).catch(() => {}),
  prev: () => { const hd = new H.HDate(S.anchor), first = new H.HDate(1, hd.getMonth(), hd.getFullYear()); S.anchor = new H.HDate(first.abs() - 1).greg(); render(); },
  next: () => { const hd = new H.HDate(S.anchor), first = new H.HDate(1, hd.getMonth(), hd.getFullYear()); S.anchor = new H.HDate(first.abs() + first.daysInMonth()).greg(); render(); },
  today: () => { S.anchor = today0(); render(); },
};
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const f = A[t.dataset.act];
  if (f){ e.preventDefault(); f(); }
});
document.addEventListener('change', e => {
  if (e.target.id === 'synSwitch'){ Auth.setActiveSynagogueId(e.target.value); attach(e.target.value); render(); }
});

boot();
})();
