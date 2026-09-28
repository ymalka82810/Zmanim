/* אפליקציית לוח קידושים: מצב, מסכים ופעולות. הנתונים ב-Convex (convex/kiddush.ts), לפי הקהילה הפעילה. */
(function(){
"use strict";
const { H, esc, pad, pkey, today0, gShort, gFull, heMonth, heDay, heYear, heFull, fmtTime,
  getSlots, slotFor, slotTitle, monthRange } = window.KiddushCalendar || {};
const $ = s => document.querySelector(s);
const Auth = window.SiteAuth;
const ROLE_LABEL = {gabbai:'גבאי', rabbi:'רב', member:'חבר קהילה'};
const ACCOUNT_URL = '../account/';

const ICON = {
  cal:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  cup:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h10l-1 7a4 4 0 0 1-8 0L7 3zM12 14v5M8 21h8"/></svg>',
  doc:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/></svg>',
  gear:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>',
  bell:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
  right:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg>',
  left:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m15 6-6 6 6 6"/></svg>',
  swap:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M7 7h11l-3-3M17 17H6l3 3"/></svg>'
};

function shiftMonth(dir){
  const a = S.anchor;
  if (S.mode === 'greg') S.anchor = new Date(a.getFullYear(), a.getMonth()+dir, 1);
  else { const {first} = monthRange(a,'heb'); S.anchor = dir > 0 ? new H.HDate(first.abs()+first.daysInMonth()).greg() : new H.HDate(first.abs()-1).greg(); }
  renderMain();
}
function monthTitles(){
  const {start, end} = monthRange(S.anchor, S.mode);
  const hs = new H.HDate(start), he = new H.HDate(end);
  if (S.mode === 'greg'){
    const t = start.toLocaleDateString('he-IL',{month:'long',year:'numeric'});
    const alt = heMonth(hs) === heMonth(he) ? heMonth(hs)+' '+heYear(hs.getFullYear()) : heMonth(hs)+' – '+heMonth(he)+' '+heYear(he.getFullYear());
    return {t, alt};
  }
  const t = heMonth(hs)+' '+heYear(hs.getFullYear());
  const m1 = start.toLocaleDateString('he-IL',{month:'long'}), m2 = end.toLocaleDateString('he-IL',{month:'long'});
  return {t, alt: (m1 === m2 ? m1 : m1+' – '+m2)+' '+end.getFullYear()};
}

/* ---------- State ---------- */
const S = {
  ready:false, fatal:null, signedIn:false, synagogues:[], sid:null, board:null, boardError:null,
  view:'cal', mode:'heb', anchor:today0()
};
const syn = () => S.board.synagogue;
const myRole = () => S.board?.role || null;
const isManager = () => myRole() === 'gabbai' || myRole() === 'rabbi';
const curTerms = () => S.board?.terms[0] || null;
const bookingOf = k => S.board?.bookings.find(b => b.dateKey === k) || null;
const slotLabel = k => { const sl = slotFor(k, !!syn().il); return `${slotTitle(sl)} (${gShort(sl.date)})`; };

/* ---------- Boot & data ---------- */
async function boot(){
  if (!H || !window.KiddushCalendar){ S.fatal = 'לא ניתן לטעון את לוח השנה העברי. רעננו את העמוד.'; return renderAll(); }
  try { const m = localStorage.getItem('kd_mode'); if (m) S.mode = m; } catch(e){}
  renderAll();
  try { await Auth.completeSignInFromRedirect(); } catch(e){ console.warn(e); toast('ההתחברות נכשלה. נסו שוב.'); }
  Auth.onChange(() => { S.signedIn = Auth.isAuthenticated(); loadSynagogues(); });
  S.signedIn = Auth.isAuthenticated();
  await loadSynagogues();
}

async function loadSynagogues(){
  if (!S.signedIn){ S.ready = true; S.synagogues = []; attach(null); return renderAll(); }
  try {
    const [me, synagogues] = await Promise.all([Auth.client().query('users:me', {}), Auth.client().query('synagogues:mine', {})]);
    if (me === null) S.signedIn = false;
    S.synagogues = synagogues;
  } catch(e){ console.warn(e); S.synagogues = []; }
  if (!S.signedIn){ S.ready = true; attach(null); return renderAll(); }
  S.ready = true;
  let sid = Auth.activeSynagogueId();
  if (!S.synagogues.some(s => s._id === sid)){ sid = S.synagogues[0]?._id || null; Auth.setActiveSynagogueId(sid); }
  attach(sid);
  renderAll();
}

let unsubscribe = null, termsInitRequested = false;
function attach(sid){
  if (sid === S.sid && unsubscribe) return;
  if (unsubscribe){ unsubscribe(); unsubscribe = null; }
  S.sid = sid; S.board = null; S.boardError = null; termsInitRequested = false;
  if (!sid) return;
  unsubscribe = Auth.client().onUpdate('kiddush:board', { synagogueId: sid }, board => {
    S.board = board;
    if (!board.terms.length && isManager() && !termsInitRequested){
      termsInitRequested = true;
      call('kiddush:initTerms', {});
    }
    renderAll();
  }, e => { console.warn(e); S.boardError = errMsg(e); renderAll(); });
}

function errMsg(e){ return (e && typeof e.data === 'string') ? e.data : 'הפעולה לא נשמרה. נסו שוב.'; }
async function call(name, args){
  return await Auth.client().mutation(name, { synagogueId: S.sid, ...args });
}
function guard(fn){
  return async (...a) => {
    try { await fn(...a); }
    catch(e){ console.warn(e); toast(errMsg(e)); }
  };
}

/* ---------- Render ---------- */
function renderAll(){ renderMain(); renderTabs(); }
function renderTabs(){
  const t = $('#tabs');
  if (!S.board){ t.hidden = true; return; }
  t.hidden = false;
  const pend = isManager() ? S.board.bookings.filter(b => b.status === 'pending').length : 0;
  const tabs = [['cal','לוח',ICON.cal],['mine','הקידושים שלי',ICON.cup],['terms','הנחיות',ICON.doc]];
  if (isManager()) tabs.push(['manage','ניהול',ICON.gear]);
  t.innerHTML = '<div class="in">'+tabs.map(([k,l,i]) =>
    `<button data-act="view" data-v="${k}" ${S.view===k?'aria-current="page"':''}>${i}<span>${l}</span>${k==='manage'&&pend?`<span class="dot">${pend}</span>`:''}</button>`).join('')+'</div>';
}
function hero(text, button){
  return `<div class="hero"><h1>לוח קידושים</h1><p class="muted">${text}</p></div>${button || ''}`;
}
function renderMain(){
  const app = $('#app');
  if (S.fatal){ app.innerHTML = hero(esc(S.fatal)); return; }
  if (!S.ready){ app.innerHTML = '<div class="empty">טוען…</div>'; return; }
  if (!S.signedIn){ app.innerHTML = hero('כדי לראות את הלוח ולהירשם לקידוש יש להתחבר עם חשבון Google.', '<button class="btn btn-google" data-act="signIn">כניסה עם Google</button>'); return; }
  if (!S.sid){ app.innerHTML = hero('עדיין לא הצטרפת לקהילה. אפשר להצטרף דרך הזמנה מהגבאי או לפתוח קהילה חדשה.', `<a class="btn" href="${ACCOUNT_URL}">לחשבון שלי</a>`); return; }
  if (S.boardError){ app.innerHTML = hero(esc(S.boardError), `<a class="btn" href="${ACCOUNT_URL}">לחשבון שלי</a>`); return; }
  if (!S.board){ app.innerHTML = '<div class="empty">טוען…</div>'; return; }
  let body = '';
  if (S.view === 'cal') body = calHTML();
  else if (S.view === 'mine') body = mineHTML();
  else if (S.view === 'terms') body = termsHTML();
  else if (S.view === 'manage' && isManager()) body = manageHTML();
  else { S.view = 'cal'; body = calHTML(); }
  app.innerHTML = headerHTML() + body;
}
function headerHTML(){
  const s = syn(), unread = S.board.notifications.filter(n => !n.read).length;
  return `<header class="top">
    <div class="shul"><h1>${esc(s.name)}</h1><small>${esc(s.city||'')}${s.city?', ':''}${s.il?'ארץ ישראל':'חוץ לארץ'} | ${ROLE_LABEL[myRole()]}</small></div>
    ${S.synagogues.length > 1?`<button class="iconbtn" data-act="switchSyn" aria-label="החלפת קהילה">${ICON.swap}</button>`:''}
    <button class="iconbtn" data-act="notes" aria-label="התראות">${ICON.bell}${unread?`<span class="dot">${unread}</span>`:''}</button>
  </header>`;
}

/* Calendar */
function statusHTML(b, past){
  if (!b) return past ? '<span class="chip block">עבר</span>' : '<span class="chip free">פנוי</span>';
  if (b.status === 'blocked') return `<span class="chip block">${esc(b.blockLabel||'לא זמין')}</span>`;
  const mineTag = b.mine ? '<span class="mine-tag">הרישום שלי</span>' : '';
  if (past) return `<span class="chip done">נעשה</span><span class="by">${esc(b.sponsorLine)}</span>${mineTag}`;
  const chip = b.status === 'approved' ? `<span class="chip appr">קידוש ${esc(syn().kiddushBy)}</span>` : '<span class="chip pend">ממתין לאישור</span>';
  return `${chip}<span class="by">${esc(b.sponsorLine)}</span>${mineTag}`;
}
function calHTML(){
  const s = syn(), {start, end} = monthRange(S.anchor, S.mode), {t, alt} = monthTitles();
  const slots = getSlots(start, end, !!s.il), t0 = today0();
  const up = myBookings().filter(b => pkey(b.dateKey) >= t0 && (pkey(b.dateKey)-t0)/864e5 <= 10)[0];
  let remind = '';
  if (up){
    const sl = slotFor(up.dateKey, !!s.il), days = Math.round((pkey(up.dateKey)-t0)/864e5);
    remind = `<section class="card remind"><h3>הקידוש שלך ב${esc(slotTitle(sl))}</h3>
      <p>${days===0?'היום':days===1?'מחר':'בעוד '+days+' ימים'}. ${up.status==='pending'?'הבקשה עדיין ממתינה לאישור.':'כדאי לעבור שוב על ההנחיות.'}</p>
      <div class="row"><button class="btn" data-act="viewTerms">להנחיות</button><button class="btn" data-act="ics" data-k="${up.dateKey}">הוספה ליומן</button></div></section>`;
  }
  const rows = slots.map(sl => {
    const b = bookingOf(sl.key), past = sl.date < t0, isToday = +sl.date === +t0;
    const big = S.mode === 'heb' ? heDay(sl.hd) : sl.date.getDate();
    const small = S.mode === 'heb' ? gShort(sl.date) : heDay(sl.hd)+' '+heMonth(sl.hd);
    return `<button class="slot${past?' past':''}${isToday?' today':''}" data-act="slot" data-k="${sl.key}">
      <div class="date"><div class="big">${big}</div><div class="small">${esc(small)}</div></div>
      <div><div class="kind">${esc(sl.kind)}</div><h3>${esc(sl.name)}</h3>${sl.subs.length?`<div class="sub">${esc(sl.subs.join(', '))}</div>`:''}</div>
      <div class="stcol">${statusHTML(b,past)}</div></button>`;
  }).join('');
  return `${remind}
  <div class="monthbar">
    <button class="nav" data-act="prev" aria-label="החודש הקודם">${ICON.right}</button>
    <div class="title"><h2>${esc(t)}</h2><div class="alt">${esc(alt)}</div></div>
    <button class="nav" data-act="next" aria-label="החודש הבא">${ICON.left}</button>
  </div>
  <div class="modebar"><div class="seg" role="group" aria-label="סוג חודש">
    <button data-act="mode" data-m="heb" aria-pressed="${S.mode==='heb'}">חודש עברי</button>
    <button data-act="mode" data-m="greg" aria-pressed="${S.mode==='greg'}">חודש לועזי</button></div>
    <button class="link" data-act="today">היום</button></div>
  <div class="slots">${rows || '<div class="empty">אין שבתות או חגים בטווח הזה.</div>'}</div>`;
}

/* My bookings */
function myBookings(){
  return S.board.bookings.filter(b => b.mine).sort((a,b) => a.dateKey < b.dateKey ? -1 : 1);
}
function mineHTML(){
  const s = syn(), t0 = today0(), all = myBookings(), ct = curTerms();
  const up = all.filter(b => pkey(b.dateKey) >= t0), past = all.filter(b => pkey(b.dateKey) < t0).reverse();
  const item = b => {
    const k = b.dateKey, sl = slotFor(k, !!s.il), outdated = ct && b.termsVersion < ct.version && pkey(k) >= t0;
    return `<div class="card">
      <div class="row" style="justify-content:space-between"><div><div class="meta">${esc(heFull(sl.hd))} | ${esc(gFull(sl.date))}</div><h3>${esc(slotTitle(sl))}</h3></div>
      ${b.status==='approved'?'<span class="chip appr">מאושר</span>':'<span class="chip pend">ממתין לאישור</span>'}</div>
      <div class="small">${esc(syn().kiddushBy)} ${esc(b.sponsorLine)}${b.occasionLine?' | '+esc(b.occasionLine):''}</div>
      <div class="meta">אושרו הנחיות גרסה ${b.termsVersion||'—'}</div>
      ${outdated?`<div class="warn">ההנחיות עודכנו לגרסה ${ct.version}. יש לעיין ולאשר מחדש.</div>`:''}
      ${pkey(k) >= t0 ? `<div class="row" style="margin-top:10px">
        ${outdated?`<button class="btn" data-act="ackTerms" data-k="${k}">עיון ואישור</button>`:`<button class="btn sec" data-act="termsVer" data-v="${b.termsVersion}">ההנחיות שאישרתי</button>`}
        <button class="btn sec" data-act="ics" data-k="${k}">הוספה ליומן</button>
        <button class="btn danger" data-act="cancelMine" data-k="${k}">ביטול הרישום</button></div>`:''}
    </div>`;
  };
  return `<div class="sechead"><h2>הקידושים שלי</h2></div>
    ${up.length ? up.map(item).join('') : '<div class="card empty">אין לך קידושים קרובים. בחרו שבת פנויה בלוח כדי להירשם.<div style="margin-top:12px"><button class="btn" data-act="view" data-v="cal">ללוח השבתות</button></div></div>'}
    ${past.length ? `<div class="sechead"><h2>קידושים קודמים</h2></div>`+past.map(item).join('') : ''}`;
}

/* Terms */
function termsBody(t){
  if (!t) return '<p class="muted">הגבאי עדיין לא פרסם הנחיות.</p>';
  return `${t.intro?`<p class="terms-intro">${esc(t.intro)}</p>`:''}
    <ul class="terms-list">${(t.items||[]).map(i=>`<li><span>${esc(i)}</span></li>`).join('')}</ul>
    <div class="meta">גרסה ${t.version}, עודכנה ${esc(fmtTime(t.editedAt))}</div>`;
}
function termsHTML(){
  const terms = S.board.terms;
  return `<div class="sechead"><h2>הנחיות לבעל הקידוש</h2>${isManager()?'<button class="btn sec" data-act="editTerms">עריכה</button>':''}</div>
    <div class="card">${termsBody(curTerms())}</div>
    ${terms.length > 1 ? `<div class="sechead"><h2>היסטוריית גרסאות</h2></div><div class="card"><div class="list">${terms.map(v=>`
      <button class="li" style="border-inline:0;border-top:0;background:none;text-align:right;width:100%" data-act="termsVer" data-v="${v.version}">
        <span class="pill">גרסה ${v.version}</span><span class="grow"><span class="t">${esc(v.note||'עדכון')}</span><br><span class="meta">${esc(fmtTime(v.editedAt))} | ${esc(v.editedBy)}</span></span></button>`).join('')}</div></div>` : ''}`;
}

/* Manage */
function manageHTML(){
  const s = syn(), t0 = today0();
  const pend = S.board.bookings.filter(b => b.status === 'pending').sort((a,b) => a.dateKey < b.dateKey ? -1 : 1);
  const pendHTML = pend.length ? pend.map(b => {
    const k = b.dateKey, sl = slotFor(k, !!s.il);
    return `<div class="li"><div class="grow"><div class="t">${esc(slotTitle(sl))} <span class="meta">${esc(gShort(sl.date))}</span></div>
      <div class="small">${esc(b.sponsorLine)}${b.occasionLine?' | '+esc(b.occasionLine):''}</div>
      <div class="meta">נרשם: ${esc(b.registrant)}${b.phone?' | '+esc(b.phone):''}${pkey(k)<t0?' | התאריך עבר':''}</div></div>
      <div class="row"><button class="btn ok" data-act="approve" data-k="${k}">אישור</button><button class="btn danger" data-act="reject" data-k="${k}">דחייה</button></div></div>`;
  }).join('') : '<p class="muted">אין בקשות ממתינות.</p>';
  return `<div class="sechead"><h2>בקשות לאישור</h2></div><div class="card"><div class="list">${pendHTML}</div></div>
    <div class="card"><h3>רישום ידני או חסימת תאריך</h3><p class="small muted">לחיצה על שבת בלוח פותחת גם פעולות ניהול: רישום בשם משפחה, סימון "קידוש קהילתי" או חסימה.</p>
    <button class="btn sec" data-act="view" data-v="cal">ללוח</button></div>
    <div class="sechead"><h2>הגדרות</h2></div>
    <div class="card"><div class="row"><button class="btn sec" data-act="editTerms">עריכת ההנחיות</button><button class="btn sec" data-act="editWording">נוסח ההכרזה על הקידוש</button><a class="btn sec" href="${ACCOUNT_URL}">חברי הקהילה ופרטיה</a></div></div>`;
}

/* ---------- Sheets ---------- */
function openSheet(html){ $('#sheet').innerHTML = html; $('#sheetWrap').hidden = false; const f = $('#sheet').querySelector('input,textarea,select'); if (f && window.innerWidth > 700) f.focus(); }
function closeSheet(){ $('#sheetWrap').hidden = true; $('#sheet').innerHTML = ''; }
const sheetHead = (t, sub) => `<div class="sh"><div style="flex:1"><h2>${esc(t)}</h2>${sub?`<div class="meta">${esc(sub)}</div>`:''}</div><button class="x" data-act="close" aria-label="סגירה">×</button></div>`;
let toastT;
function toast(msg){ let t = $('.toast'); if (!t){ t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role','status'); document.body.appendChild(t); } t.textContent = msg; clearTimeout(toastT); toastT = setTimeout(() => t.remove(), 3200); }

function slotSheet(k){
  const s = syn(), sl = slotFor(k, !!s.il), b = bookingOf(k), past = sl.date < today0();
  let html = sheetHead(slotTitle(sl), heFull(sl.hd)+' | '+gFull(sl.date));
  if (sl.subs.length) html += `<p class="small muted">${esc(sl.subs.join(', '))}</p>`;
  if (b && b.status !== 'blocked'){
    html += announceView(b) + `<dl class="kv"><dt>סטטוס</dt><dd>${b.status==='approved'?'מאושר':'ממתין לאישור'}</dd>
      ${isManager()?`<dt>נרשם</dt><dd>${b.manual?'רישום ידני ע״י '+esc(b.registrant):esc(b.registrant)}</dd>`:''}
      ${b.phone?`<dt>טלפון</dt><dd dir="ltr" style="text-align:right">${esc(b.phone)}</dd>`:''}${b.note?`<dt>הערה</dt><dd>${esc(b.note)}</dd>`:''}</dl>`;
  } else if (b) html += `<p><span class="chip block">${esc(b.blockLabel||'לא זמין')}</span></p>`;
  else html += `<p><span class="chip ${past?'block':'free'}">${past?'עבר ללא קידוש':'פנוי לקידוש'}</span></p>`;
  const acts = [];
  if (!b && !past) acts.push(`<button class="btn" data-act="register" data-k="${k}">הרשמה לקידוש</button>`);
  if (b?.mine && !past) acts.push(`<button class="btn danger" data-act="cancelMine" data-k="${k}">ביטול הרישום שלי</button>`);
  if (isManager() && !past){
    if (b?.status === 'pending') acts.push(`<button class="btn ok" data-act="approve" data-k="${k}">אישור</button><button class="btn danger" data-act="reject" data-k="${k}">דחייה</button>`);
    if (b?.status === 'approved' && !b.mine) acts.push(`<button class="btn danger" data-act="reject" data-k="${k}">ביטול הקידוש</button>`);
    if (b?.status === 'blocked') acts.push(`<button class="btn sec" data-act="unblock" data-k="${k}">שחרור התאריך</button>`);
    if (!b) acts.push(`<button class="btn sec" data-act="manual" data-k="${k}">רישום ידני</button><button class="btn sec" data-act="block" data-k="${k}">חסימה / קידוש קהילתי</button>`);
  }
  if (acts.length) html += `<div class="row" style="margin-top:14px">${acts.join('')}</div>`;
  openSheet(html);
}
/* נוסח ההכרזה: שורה קבועה של הגבאי, "ע״י" + בעל הקידוש, ואז "לרגל / לזכות / לעילוי נשמת…" + שם.
   הרשימות זהות לאלו שהשרת מקבל (convex/kiddush.ts) */
const LIVING_SFX = ['שיחי׳','שתחי׳','שיחיו'], MEMORIAL_SFX = ['ז״ל','ע״ה'], MEMORIAL = 'לעילוי נשמת';
const OCC_HINT = {'לרגל':'בר המצווה של בנם','לזכות':'בנם משה','לרפואת':'משה בן שרה','להצלחת':'בנם משה',[MEMORIAL]:'ר׳ משה בן יעקב'};
const options = (list, sel, none) => (none ? `<option value="">${none}</option>` : '') + list.map(x => `<option${x===sel?' selected':''}>${esc(x)}</option>`).join('');
function announceHTML(p){
  const s = syn();
  return `<div class="announce">
    <div class="an-head">${esc(s.kiddushHeading)}</div>
    <label class="f" for="${p}Sponsor">מי מביא את הקידוש</label>
    <div class="an-line">${s.kiddushBy?`<span class="an-fixed">${esc(s.kiddushBy)}</span>`:''}<input type="text" id="${p}Sponsor" maxlength="60" placeholder="משפחת לוי">
      <select id="${p}SponsorSfx" aria-label="תוספת אחרי השם">${options(LIVING_SFX, '', 'ללא')}</select></div>
    <label class="f" for="${p}Occ">סיבת הקידוש (לא חובה)</label>
    <div class="an-line"><select id="${p}OccType" data-announce="${p}" aria-label="סוג">${options(Object.keys(OCC_HINT), 'לרגל')}</select><input type="text" id="${p}Occ" maxlength="80" placeholder="${OCC_HINT['לרגל']}">
      <select id="${p}OccSfx" aria-label="תוספת אחרי השם">${options(LIVING_SFX, '', 'ללא')}</select></div>
  </div>`;
}
/** סוג הסיבה השתנה: לעילוי נשמת מקבל ז״ל / ע״ה, והשאר שיחי׳ / שתחי׳ / שיחיו */
function announceTypeChanged(p){
  const type = $('#'+p+'OccType').value, sfx = $('#'+p+'OccSfx');
  sfx.innerHTML = options(type === MEMORIAL ? MEMORIAL_SFX : LIVING_SFX, '', 'ללא');
  $('#'+p+'Occ').placeholder = OCC_HINT[type] || '';
}
const announceValues = p => ({
  sponsorName: $('#'+p+'Sponsor').value, sponsorSuffix: $('#'+p+'SponsorSfx').value,
  occasionType: $('#'+p+'OccType').value, occasion: $('#'+p+'Occ').value, occasionSuffix: $('#'+p+'OccSfx').value
});
function announceView(b){
  const s = syn();
  return `<div class="announce view"><div class="an-head">${esc(s.kiddushHeading)}</div>
    <div>${s.kiddushBy?esc(s.kiddushBy)+' ':''}<b>${esc(b.sponsorLine)}</b></div>${b.occasionLine?`<div>${esc(b.occasionLine)}</div>`:''}</div>`;
}

function registerSheet(k){
  const sl = slotFor(k, !!syn().il);
  openSheet(sheetHead('הרשמה לקידוש', slotTitle(sl)+' | '+heFull(sl.hd)) + `
    <div class="steps"><span class="on" id="st1"></span><span id="st2"></span></div>
    <div id="step1">
      ${announceHTML('f')}
      <label class="f" for="fPhone">טלפון ליצירת קשר</label><input type="tel" id="fPhone" maxlength="20" dir="ltr" style="text-align:right" value="${esc(S.board.myPhone)}">
      <label class="f" for="fNote">הערה לגבאי (לא חובה)</label><input type="text" id="fNote" maxlength="200">
      <div class="row" style="margin-top:16px"><button class="btn" data-act="regNext">המשך להנחיות</button></div>
    </div>
    <div id="step2" hidden>
      <div class="card" style="background:var(--surface2)">${termsBody(curTerms())}</div>
      <label class="check"><input type="checkbox" id="fAgree"> קראתי את ההנחיות ואני מאשר אותן</label>
      <div class="row"><button class="btn" data-act="regSubmit" data-k="${k}">${isManager()?'רישום הקידוש':'שליחת הבקשה'}</button><button class="btn ghost" data-act="regBack">חזרה</button></div>
    </div>`);
}
function termsVerSheet(v){
  const t = S.board.terms.find(x => x.version == v);
  if (!t) return toast('הגרסה לא נמצאה');
  openSheet(sheetHead('הנחיות, גרסה '+t.version, t.note||'') + termsBody(t) +
    (isManager() && t !== curTerms() ? `<div class="row" style="margin-top:14px"><button class="btn sec" data-act="restoreTerms" data-v="${t.version}">שחזור כגרסה חדשה</button></div>` : ''));
}
function editTermsSheet(){
  const t = curTerms() || {intro:'', items:[]};
  openSheet(sheetHead('עריכת ההנחיות', t.version ? 'השמירה תיצור גרסה '+(t.version+1) : '') + `
    <label class="f" for="tIntro">פתיח</label><textarea id="tIntro">${esc(t.intro||'')}</textarea>
    <label class="f" for="tItems">רשימת דגשים (שורה לכל סעיף)</label><textarea id="tItems" style="min-height:220px">${esc((t.items||[]).join('\n'))}</textarea>
    <label class="f" for="tNote">מה השתנה?</label><input type="text" id="tNote" maxlength="120" placeholder="לדוגמה: עודכנה שעת ההגעה">
    <p class="small muted">בעלי קידוש עתידיים יתבקשו לאשר את הגרסה החדשה.</p>
    <div class="row"><button class="btn" data-act="saveTerms">שמירת גרסה חדשה</button><button class="btn ghost" data-act="close">ביטול</button></div>`);
}
function wordingSheet(){
  const s = syn();
  openSheet(sheetHead('נוסח ההכרזה על הקידוש') + `
    <label class="f" for="wHead">שורה ראשונה</label><input type="text" id="wHead" maxlength="80" value="${esc(s.kiddushHeading)}" placeholder="לדוגמה: קידוש והתוועדות לאחר התפילה">
    <label class="f" for="wBy">לפני שם בעל הקידוש</label><input type="text" id="wBy" maxlength="30" value="${esc(s.kiddushBy)}" placeholder="ע״י">
    <p class="small muted">שתי השורות מופיעות בטופס ההרשמה כטקסט קבוע. בעל הקידוש ממלא רק את השם ואת סיבת הקידוש.</p>
    <div class="row"><button class="btn" data-act="saveWording">שמירה</button><button class="btn ghost" data-act="close">ביטול</button></div>`);
}
function reasonSheet(k, kind){
  const sl = slotFor(k, !!syn().il);
  const title = kind === 'block' ? 'חסימת תאריך' : kind === 'manual' ? 'רישום ידני' : 'דחייה או ביטול';
  let f = '';
  if (kind === 'block') f = `<label class="f" for="rText">מה יוצג בלוח</label><input type="text" id="rText" maxlength="40" value="קידוש קהילתי">`;
  else if (kind === 'manual') f = `${announceHTML('r')}<label class="f" for="rPhone">טלפון</label><input type="tel" id="rPhone" dir="ltr" style="text-align:right" maxlength="20">`;
  else f = `<label class="f" for="rText">סיבה (תישלח לנרשם)</label><input type="text" id="rText" maxlength="160">`;
  openSheet(sheetHead(title, slotTitle(sl)+' | '+gFull(sl.date)) + f +
    `<div class="row" style="margin-top:16px"><button class="btn${kind==='reject'?' danger':''}" data-act="doReason" data-k="${k}" data-kind="${kind}">אישור</button><button class="btn ghost" data-act="close">ביטול</button></div>`);
}
function notesSheet(){
  const list = S.board.notifications;
  openSheet(sheetHead('התראות') + (list.length ? `<div class="list">${list.map(n => `
    <div class="li ${n.read?'':'unread'}"><div class="grow"><div>${esc(n.text)}</div><div class="meta">${esc(fmtTime(n.at))}</div></div></div>`).join('')}</div>` : '<p class="muted">אין התראות חדשות.</p>'));
  if (list.some(n => !n.read) || isManager()) call('kiddush:markRead', {}).catch(e => console.warn(e));
}
function switchSheet(){
  openSheet(sheetHead('קהילה') + `<div class="list">${S.synagogues.map(s => `<div class="li"><div class="grow"><div class="t">${esc(s.name)}</div><div class="meta">${esc(s.city||'')}</div></div>
    ${s._id===S.sid?'<span class="pill">נוכחית</span>':`<button class="btn sec" data-act="setSyn" data-sid="${s._id}">מעבר</button>`}</div>`).join('')}</div>
    <div class="row" style="margin-top:14px"><a class="btn ghost" href="${ACCOUNT_URL}">הצטרפות לקהילה אחרת</a></div>`);
}

/* ---------- ICS ---------- */
function downloadIcs(k){
  const s = syn(), sl = slotFor(k, !!s.il), d = sl.date, nd = new Date(d); nd.setDate(nd.getDate()+1);
  const ymd = x => x.getFullYear()+pad(x.getMonth()+1)+pad(x.getDate());
  const stamp = new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+/,'');
  const e = x => x.replace(/[,;\\]/g, m => '\\'+m);
  const sum = e('קידוש – '+slotTitle(sl)+' – '+s.name);
  const ics = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//kiddush//he','CALSCALE:GREGORIAN','BEGIN:VEVENT',
    'UID:'+k+'-'+S.sid+'@kiddush','DTSTAMP:'+stamp,'DTSTART;VALUE=DATE:'+ymd(d),'DTEND;VALUE=DATE:'+ymd(nd),
    'SUMMARY:'+sum,'DESCRIPTION:'+e('הקידוש שלך ב'+s.name+'. יש לעבור על ההנחיות בלוח הקידושים.'),
    'BEGIN:VALARM','TRIGGER:-PT62H','ACTION:DISPLAY','DESCRIPTION:'+sum,'END:VALARM',
    'BEGIN:VALARM','TRIGGER:-PT38H','ACTION:DISPLAY','DESCRIPTION:'+sum,'END:VALARM',
    'END:VEVENT','END:VCALENDAR'].join('\r\n');
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'kiddush-'+k+'.ics'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- Actions ---------- */
const A = {
  signIn: guard(() => Auth.signInWithGoogle(location.href)),
  view: d => { S.view = d.v; closeSheet(); renderAll(); window.scrollTo(0,0); },
  prev: () => shiftMonth(-1), next: () => shiftMonth(1),
  today: () => { S.anchor = today0(); renderMain(); },
  mode: d => { S.mode = d.m; try{ localStorage.setItem('kd_mode', d.m); }catch(e){} renderMain(); },
  slot: d => slotSheet(d.k),
  close: closeSheet,
  notes: notesSheet,
  switchSyn: switchSheet,
  setSyn: d => { Auth.setActiveSynagogueId(d.sid); closeSheet(); S.view = 'cal'; attach(d.sid); renderAll(); },
  viewTerms: () => { S.view = 'terms'; renderAll(); window.scrollTo(0,0); },
  termsVer: d => termsVerSheet(d.v),
  editTerms: editTermsSheet,
  ics: d => downloadIcs(d.k),
  register: d => registerSheet(d.k),
  regNext: () => {
    if (!$('#fSponsor').value.trim()){ $('#fSponsor').focus(); return toast('נא למלא את שם בעל הקידוש'); }
    $('#step1').hidden = true; $('#step2').hidden = false; $('#st2').classList.add('on'); $('#sheet').scrollTop = 0;
  },
  regBack: () => { $('#step1').hidden = false; $('#step2').hidden = true; $('#st2').classList.remove('on'); },
  regSubmit: guard(async d => {
    if (!$('#fAgree').checked) return toast('יש לאשר את ההנחיות כדי להירשם');
    const res = await call('kiddush:register', { dateKey:d.k, label:slotLabel(d.k),
      ...announceValues('f'), phone:$('#fPhone').value, note:$('#fNote').value });
    closeSheet(); toast(res?.status === 'approved' ? 'הקידוש נרשם ואושר' : 'הבקשה נשלחה לאישור');
  }),
  cancelMine: d => {
    const sl = slotFor(d.k, !!syn().il);
    openSheet(sheetHead('ביטול הרישום', slotTitle(sl)) + `<p>הגבאי יקבל הודעה על הביטול.</p>
      <div class="row"><button class="btn danger" data-act="doCancel" data-k="${d.k}">ביטול הרישום</button><button class="btn ghost" data-act="close">השארת הרישום</button></div>`);
  },
  doCancel: guard(async d => {
    await call('kiddush:cancelMine', { dateKey:d.k, label:slotLabel(d.k) });
    closeSheet(); toast('הרישום בוטל');
  }),
  approve: guard(async d => {
    await call('kiddush:approve', { dateKey:d.k, label:slotLabel(d.k) });
    closeSheet(); toast('הבקשה אושרה');
  }),
  reject: d => reasonSheet(d.k, 'reject'),
  block: d => reasonSheet(d.k, 'block'),
  manual: d => reasonSheet(d.k, 'manual'),
  unblock: guard(async d => { await call('kiddush:unblock', { dateKey:d.k }); closeSheet(); toast('התאריך שוחרר'); }),
  doReason: guard(async d => {
    const k = d.k, kind = d.kind;
    if (kind === 'manual'){
      if (!$('#rSponsor').value.trim()) return toast('נא למלא את שם בעל הקידוש');
      await call('kiddush:registerManual', { dateKey:k, ...announceValues('r'), phone:$('#rPhone').value });
      toast('נשמר');
    } else if (kind === 'reject'){
      await call('kiddush:reject', { dateKey:k, label:slotLabel(k), reason:$('#rText').value.trim() });
      toast('הרישום הוסר');
    } else {
      const txt = $('#rText').value.trim();
      if (!txt) return toast('נא למלא את השדה');
      await call('kiddush:block', { dateKey:k, blockLabel:txt });
      toast('נשמר');
    }
    closeSheet();
  }),
  ackTerms: d => {
    const t = curTerms();
    openSheet(sheetHead('הנחיות מעודכנות', 'גרסה '+t.version) + termsBody(t) + `
      <label class="check"><input type="checkbox" id="fAgree"> קראתי את ההנחיות ואני מאשר אותן</label>
      <div class="row"><button class="btn" data-act="doAck" data-k="${d.k}">אישור</button></div>`);
  },
  doAck: guard(async d => {
    if (!$('#fAgree').checked) return toast('יש לסמן את תיבת האישור');
    await call('kiddush:ackTerms', { dateKey:d.k });
    closeSheet(); toast('תודה, האישור נשמר');
  }),
  saveTerms: guard(async () => {
    const items = $('#tItems').value.split('\n').map(x => x.trim()).filter(Boolean);
    const v = await call('kiddush:saveTerms', { intro:$('#tIntro').value, items, note:$('#tNote').value });
    closeSheet(); toast('נשמרה גרסה '+v);
  }),
  editWording: wordingSheet,
  saveWording: guard(async () => {
    await call('kiddush:saveWording', { kiddushHeading:$('#wHead').value, kiddushBy:$('#wBy').value });
    closeSheet(); toast('הנוסח נשמר');
  }),
  restoreTerms: guard(async d => {
    const v = await call('kiddush:restoreTerms', { version:Number(d.v) });
    closeSheet(); toast('גרסה '+d.v+' שוחזרה כגרסה '+v);
  })
};

document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (t){ const f = A[t.dataset.act]; if (f){ e.preventDefault(); f(t.dataset, t); } return; }
  if (e.target === $('#sheetWrap')) closeSheet();
});
document.addEventListener('change', e => { if (e.target.dataset.announce) announceTypeChanged(e.target.dataset.announce); });
document.addEventListener('keydown',e => { if (e.key === 'Escape' && !$('#sheetWrap').hidden) closeSheet(); });

boot();
})();
