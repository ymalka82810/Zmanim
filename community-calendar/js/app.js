/* יומן קהילה: מסך תצוגה מאוחד שמשלב קידושים מאושרים, איזה לוח זמנים בתוקף ותזכורות קופה,
 * כדי שחבר קהילה לא יצטרך לעבור בין שלושת הדפים כדי לדעת מה קורה בשבת הקרובה.
 * הנתונים מגיעים מ-kiddush:board, schedules:list, fund:ledger ו-events:list.
 * הגבאי או הרב מוסיפים כאן אירועים בכתיבה חופשית, בכל תאריך: שבת קהילתית, ל״ג בעומר, שיעור באמצע השבוע.
 */
(function(){
"use strict";
const { H, esc, pkey, gShort, gFull, heMonth, heYear, heDay, heFull, getSlots, slotFor, slotTitle, monthRange } = window.KiddushCalendar || {};
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
  board: null, boardError: null, schedule: null, fund: null, events: [],
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

let unsubBoard = null, unsubSchedule = null, unsubFund = null, unsubEvents = null;
function attach(sid){
  if (sid === S.sid && unsubBoard) return;
  [unsubBoard, unsubSchedule, unsubFund, unsubEvents].forEach(u => u && u());
  unsubBoard = unsubSchedule = unsubFund = unsubEvents = null;
  S.sid = sid; S.board = null; S.boardError = null; S.schedule = null; S.fund = null; S.events = [];
  if (!sid) return;
  unsubBoard = Auth.client().onUpdate('kiddush:board', { synagogueId: sid }, board => { S.board = board; render(); },
    e => { console.warn(e); S.boardError = errMsg(e); render(); });
  unsubSchedule = Auth.client().onUpdate('schedules:list', { synagogueId: sid }, data => { S.schedule = data; render(); }, () => {});
  unsubFund = Auth.client().onUpdate('fund:ledger', { synagogueId: sid }, data => { S.fund = data; render(); }, () => {});
  unsubEvents = Auth.client().onUpdate('events:list', { synagogueId: sid }, data => { S.events = data; render(); }, () => {});
}

function errMsg(e){ return (e && typeof e.data === 'string') ? e.data : 'הפעולה לא נשמרה. נסו שוב.'; }
async function call(name, args){ return await Auth.client().mutation(name, { synagogueId: S.sid, ...args }); }
function guard(fn){ return async (...a) => { try { await fn(...a); } catch(e){ console.warn(e); toast(errMsg(e)); } }; }
function eventsOf(k){ return S.events.filter(e => e.dateKey === k); }

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
  if (!S.signedIn){ app.innerHTML = hero('כדי לראות את יומן הקהילה יש להתחבר עם חשבון Google.', '<button class="btn btn-google" data-act="signIn">כניסה עם Google</button>'); return; }
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
  const slotKeys = new Set(slots.map(sl => sl.key));
  const extra = [];
  for (const e of S.events){
    const d = pkey(e.dateKey);
    if (d < start || d > end || slotKeys.has(e.dateKey) || extra.some(x => x.key === e.dateKey)) continue;
    extra.push({ key: e.dateKey, date: d, hd: new H.HDate(d), kind: 'אירוע קהילתי', name: '', subs: [] });
  }
  const rows = [...slots, ...extra].sort((a, b) => a.date - b.date);
  const hs = new H.HDate(start);
  const title = heMonth(hs) + ' ' + heYear(hs.getFullYear());
  const alt = (function(){
    const m1 = start.toLocaleDateString('he-IL', { month: 'long' }), m2 = end.toLocaleDateString('he-IL', { month: 'long' });
    return (m1 === m2 ? m1 : m1 + ' – ' + m2) + ' ' + end.getFullYear();
  })();
  const rowsHtml = rows.map(sl => {
    const b = bookingOf(sl.key), past = sl.date < today0(), isToday = +sl.date === +today0();
    const big = heDay(sl.hd), small = gShort(sl.date);
    const evts = eventsOf(sl.key);
    const name = sl.name || evts[0]?.title || '';
    const evtLine = evts.length ? (sl.name ? evts.map(e => e.title).join(' · ') : (evts.length > 1 ? `+${evts.length - 1} אירועים נוספים` : '')) : '';
    return `<button type="button" class="slot${past ? ' past' : ''}${isToday ? ' today' : ''}" data-act="day" data-k="${sl.key}">
      <div class="date"><div class="big">${big}</div><div class="small">${esc(small)}</div></div>
      <div><div class="kind">${esc(sl.kind)}</div><h3>${esc(name)}</h3>${sl.subs.length ? `<div class="sub">${esc(sl.subs.join(', '))}</div>` : ''}${evtLine ? `<div class="sub">${esc(evtLine)}</div>` : ''}</div>
      <div class="stcol">${slotKeys.has(sl.key) ? kiddushChip(b, past) : `<span class="chip appr">${evts.length} אירוע${evts.length > 1 ? 'ים' : ''}</span>`}</div></button>`;
  }).join('');
  const addBtn = isManager() ? `<div class="row" style="margin:10px 0"><button class="btn sec" type="button" data-act="addEventAny">+ הוספת אירוע</button></div>` : '';
  return `<div class="monthbar">
    <button class="nav" type="button" data-act="prev" aria-label="החודש הקודם">${ICON.right}</button>
    <div class="title"><h2>${esc(title)}</h2><div class="alt">${esc(alt)}</div></div>
    <button class="nav" type="button" data-act="next" aria-label="החודש הבא">${ICON.left}</button>
  </div>
  <div class="modebar"><button class="link" type="button" data-act="today">היום</button></div>
  ${addBtn}
  <div class="slots">${rowsHtml || '<div class="empty">אין שבתות, חגים או אירועים בחודש הזה.</div>'}</div>`;
}

/* ---------- Sheets ---------- */
function openSheet(html){ $('#sheet').innerHTML = html; $('#sheetWrap').hidden = false; const f = $('#sheet').querySelector('input,textarea,select'); if (f && window.innerWidth > 700) f.focus(); }
function closeSheet(){ $('#sheetWrap').hidden = true; $('#sheet').innerHTML = ''; }
const sheetHead = (t, sub) => `<div class="sh"><div style="flex:1"><h2>${esc(t)}</h2>${sub ? `<div class="meta">${esc(sub)}</div>` : ''}</div><button class="x" data-act="close" aria-label="סגירה">×</button></div>`;
let toastT;
function toast(msg){ let t = document.querySelector('.toast'); if (!t){ t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); } t.textContent = msg; clearTimeout(toastT); toastT = setTimeout(() => t.remove(), 3200); }

function kiddushStatusLine(b, past){
  if (!b) return `<p class="small">${past ? 'עבר ללא קידוש' : 'פנוי לקידוש'}</p>`;
  if (b.status === 'blocked') return `<p><span class="chip block">${esc(b.blockLabel || 'לא זמין')}</span></p>`;
  if (b.status === 'approved') return `<p><span class="chip appr">מאושר</span> ${esc(b.sponsorLine)}${b.occasionLine ? ' · ' + esc(b.occasionLine) : ''}</p>`;
  return `<p><span class="chip pend">ממתין לאישור</span></p>`;
}
function eventLine(e){
  const canEdit = isManager();
  return `<div class="li"><div class="grow"><div class="t">${esc(e.title)}</div>${e.details ? `<div class="meta">${esc(e.details)}</div>` : ''}<div class="meta">נוסף ע״י ${esc(e.createdBy)}</div></div>
    ${canEdit ? `<button class="btn sec" type="button" data-act="editEvent" data-id="${e._id}">עריכה</button><button class="btn danger" type="button" data-act="delEvent" data-id="${e._id}">מחיקה</button>` : ''}</div>`;
}
function daySheet(k){
  const s = S.board.synagogue, sl = slotFor(k, !!s.il), b = bookingOf(k), evts = eventsOf(k), isSlot = !!sl.kind, past = sl.date < today0();
  let html = sheetHead(isSlot ? slotTitle(sl) : gFull(sl.date), heFull(sl.hd) + ' | ' + gFull(sl.date));
  if (isSlot){
    html += `<div class="card" style="background:var(--surface2)"><h3>קידוש</h3>${kiddushStatusLine(b, past)}
      <div class="row" style="margin-top:8px"><a class="btn sec" href="../kiddush/">לפרטים ולהרשמה</a></div></div>`;
  }
  html += `<h3 style="margin-top:16px">אירועים קהילתיים</h3>`;
  html += evts.length ? `<div class="list">${evts.map(eventLine).join('')}</div>` : '<p class="muted small">אין אירועים ביום זה.</p>';
  if (isManager()) html += `<div class="row" style="margin-top:14px"><button class="btn" type="button" data-act="addEvent" data-k="${k}">הוספת אירוע ליום זה</button></div>`;
  openSheet(html);
}
function eventFormSheet(k, existing){
  const title = existing ? 'עריכת אירוע' : 'הוספת אירוע';
  const dateField = existing ? '' : `<label class="f" for="evDate">תאריך</label><input type="date" id="evDate" value="${k || ''}">`;
  openSheet(sheetHead(title) + dateField +
    `<label class="f" for="evTitle">כותרת</label><input type="text" id="evTitle" maxlength="80" placeholder="לדוגמה: מדורת ל״ג בעומר, שיעור לנשים…" value="${esc(existing?.title || '')}">
     <label class="f" for="evDetails">פרטים (לא חובה)</label><textarea id="evDetails" maxlength="300">${esc(existing?.details || '')}</textarea>
     <div class="row" style="margin-top:16px"><button class="btn" type="button" data-act="saveEvent" data-id="${existing?._id || ''}" data-k="${k || ''}">שמירה</button><button class="btn ghost" type="button" data-act="close">ביטול</button></div>`);
}

function kiddushChip(b, past){
  if (!b) return past ? '<span class="chip block">עבר</span>' : '<span class="chip free">אין קידוש</span>';
  if (b.status === 'blocked') return `<span class="chip block">${esc(b.blockLabel || 'לא זמין')}</span>`;
  if (b.status === 'approved') return `<span class="chip appr">קידוש</span><span class="by">${esc(b.sponsorLine)}${b.occasionLine ? ' · ' + esc(b.occasionLine) : ''}</span>`;
  return isManager() ? '<span class="chip pend">ממתין לאישור</span>' : (past ? '<span class="chip block">עבר</span>' : '<span class="chip free">אין קידוש</span>');
}

/* ---------- Actions ---------- */
const A = {
  signIn: () => Auth.signInWithGoogle(location.href).catch(() => {}),
  prev: () => { const hd = new H.HDate(S.anchor), first = new H.HDate(1, hd.getMonth(), hd.getFullYear()); S.anchor = new H.HDate(first.abs() - 1).greg(); render(); },
  next: () => { const hd = new H.HDate(S.anchor), first = new H.HDate(1, hd.getMonth(), hd.getFullYear()); S.anchor = new H.HDate(first.abs() + first.daysInMonth()).greg(); render(); },
  today: () => { S.anchor = today0(); render(); },
  close: closeSheet,
  day: d => daySheet(d.k),
  addEvent: d => eventFormSheet(d.k, null),
  addEventAny: () => eventFormSheet('', null),
  editEvent: d => { const ev = S.events.find(x => x._id === d.id); if (ev) eventFormSheet(ev.dateKey, ev); },
  delEvent: guard(async d => {
    if (!await SiteDialog.confirm('למחוק את האירוע?', { ok: 'מחיקה', danger: true })) return;
    await call('events:remove', { id: d.id }); toast('האירוע נמחק'); closeSheet();
  }),
  saveEvent: guard(async d => {
    const title = $('#evTitle').value, details = $('#evDetails').value;
    if (!title.trim()) return toast('נא למלא כותרת לאירוע');
    if (d.id){
      await call('events:update', { id: d.id, title, details });
    } else {
      const dateEl = $('#evDate'), k = dateEl ? dateEl.value : d.k;
      if (!k) return toast('נא לבחור תאריך');
      await call('events:add', { dateKey: k, title, details });
    }
    closeSheet(); toast('נשמר');
  }),
};
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (t){ const f = A[t.dataset.act]; if (f){ e.preventDefault(); f(t.dataset, t); } return; }
  if (e.target === $('#sheetWrap')) closeSheet();
});
document.addEventListener('change', e => {
  if (e.target.id === 'synSwitch'){ Auth.setActiveSynagogueId(e.target.value); attach(e.target.value); render(); }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheetWrap').hidden) closeSheet(); });

boot();
})();
