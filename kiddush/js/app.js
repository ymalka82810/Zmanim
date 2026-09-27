/* אפליקציית לוח קידושים: מצב, מסכים, פעולות וגישה לנתונים */
(function(){
"use strict";
const { H, LOC, esc, pad, dkey, pkey, today0, gShort, gFull, heMonth, heDay, heYear, heFull, fmtTime, rid,
  getSlots, slotFor, slotTitle, monthRange } = window.KiddushCalendar || {};
const $ = s => document.querySelector(s);
const slotCache = { clear: () => window.KiddushCalendar && window.KiddushCalendar.clearCache() };
const ROLE_LABEL = {admin:'הנהלה', gabbai:'אחראי קידושים', member:'מתפלל'};

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
  ready:false, fatal:null, db:null, user:null, dl:null, uid:null, owner:false, canWrite:true,
  syns:{}, profile:null, sid:null, members:{}, bookings:{}, terms:[], notes:[],
  names:{}, emails:{}, view:'cal', mode:'heb', anchor:today0(), subs:[]
};
const syn = () => S.syns[S.sid];
const myRole = () => S.owner ? 'admin' : (S.members[S.uid]?.role || null);
const isManager = () => ['admin','gabbai'].includes(myRole());
const isAdmin = () => myRole() === 'admin';
const curTerms = () => S.terms[0] || null;
const bookingOf = k => { const b = S.bookings[k]; return b && b.status ? b : null; };
const P = (...a) => 'synagogues/'+a.join('/');

/* ---------- Boot ---------- */
async function boot(){
  if (!H || !window.KiddushCalendar){ S.fatal = 'לא ניתן לטעון את לוח השנה העברי. רעננו את העמוד.'; return renderMain(); }
  try { const m = localStorage.getItem('kd_mode'); if (m) S.mode = m; } catch(e){}
  renderMain();
  const cl = window.claude;
  if (!cl || !cl.use){ S.fatal = 'העמוד צריך להיפתח דרך Claude כדי לשמור נתונים.'; return renderMain(); }
  const [db, user, dl] = await Promise.all([cl.use('db'), cl.use('user'), cl.use('downloads')]);
  S.db = db; S.user = user; S.dl = dl;
  if (!db){ S.fatal = 'אין גישה למאגר הנתונים בתצוגה הזו.'; return renderMain(); }
  if (user){
    const me = await user.me();
    S.uid = me.id; S.owner = me.isOwner;
    const cw = await user.can('data.write'); if (cw === false) S.canWrite = false;
  }
  S.subs.push(db.collection('synagogues').onSnapshot(snap => {
    S.syns = {}; snap.docs.forEach(d => { if (d.exists) S.syns[d.id] = {id:d.id, ...d.data()}; });
    S.ready = true; pickSyn(); renderAll();
  }, err));
  if (S.uid){
    S.subs.push(db.doc('data/users/'+S.uid+'/profile').onSnapshot(s => {
      S.profile = s.exists ? {...s.data()} : {synagogues:[], current:null};
      pickSyn(); renderAll();
    }, err));
  }
}
function err(e){ console.warn(e); if (e && e.code === 'revoked'){ S.fatal = 'הגישה לעמוד הסתיימה.'; renderAll(); } }

let synSubs = [];
function pickSyn(){
  if (!S.ready) return;
  let sid = S.profile?.current;
  if (sid && !S.syns[sid]) sid = null;
  if (!sid){ const joined = (S.profile?.synagogues || []).filter(x => S.syns[x]); sid = joined[0] || null; }
  if (sid !== S.sid){ S.sid = sid; attachSyn(); }
}
function attachSyn(){
  synSubs.forEach(u => u()); synSubs = [];
  S.members = {}; S.bookings = {}; S.terms = []; S.notes = [];
  if (!S.sid) return;
  const db = S.db, sid = S.sid;
  synSubs.push(db.collection(P(sid,'members')).onSnapshot(s => {
    S.members = {}; s.docs.forEach(d => d.exists && (S.members[d.id] = d.data()));
    resolveNames(Object.keys(S.members)); renderAll();
  }, err));
  synSubs.push(db.collection(P(sid,'bookings')).onSnapshot(s => {
    S.bookings = {}; s.docs.forEach(d => d.exists && (S.bookings[d.id] = d.data()));
    resolveNames(Object.values(S.bookings).map(b => b.uid).filter(Boolean)); renderAll();
  }, err));
  synSubs.push(db.collection(P(sid,'terms')).orderBy('version','desc').onSnapshot(s => {
    S.terms = s.docs.filter(d => d.exists).map(d => ({id:d.id, ...d.data()}));
    resolveNames(S.terms.map(t => t.editedBy).filter(Boolean)); renderAll();
  }, err));
  synSubs.push(db.collection(P(sid,'notifications')).orderBy('at','desc').limit(80).onSnapshot(s => {
    S.notes = s.docs.filter(d => d.exists).map(d => ({id:d.id, ...d.data()})); renderAll();
  }, err));
}
async function resolveNames(ids){
  if (!S.user || !ids.length) return;
  const need = [...new Set(ids)].filter(i => !(i in S.names));
  if (!need.length) return;
  const ps = await S.user.profiles(need);
  for (const id of need){ S.names[id] = ps[id]?.name || ''; S.emails[id] = ps[id]?.email || ''; }
  renderAll();
}
const nameOf = id => id === S.uid ? (S.names[id] || 'אני') : (S.names[id] || 'משתמש');

/* ---------- Writes ---------- */
async function saveProfile(patch){
  const p = {synagogues:[], current:null, ...(S.profile||{}), ...patch};
  await S.db.doc('data/users/'+S.uid+'/profile').set(p);
}
async function notify(to, type, dateKey, text){
  try { await S.db.collection(P(S.sid,'notifications')).add({to, type, dateKey, text, at:Date.now(), by:S.uid, readBy:[]}); }
  catch(e){ console.warn(e); }
}
function guard(fn){
  return async (...a) => {
    try { await fn(...a); }
    catch(e){
      console.warn(e);
      if (e?.code === 'invalid_argument'){ S.canWrite = false; toast('אין לך הרשאת עדכון בעמוד הזה'); renderAll(); }
      else if (e?.code === 'quota_exceeded') toast('מאגר הנתונים מלא. יש למחוק התראות ישנות בדף הניהול.');
      else toast('הפעולה לא נשמרה. נסו שוב.');
    }
  };
}

/* ---------- Render ---------- */
function renderAll(){ renderMain(); renderTabs(); }
function renderTabs(){
  const t = $('#tabs');
  if (forceJoin || !S.sid || !S.members[S.uid] && !S.owner){ t.hidden = true; return; }
  t.hidden = false;
  const pend = isManager() ? Object.values(S.bookings).filter(b => b.status === 'pending').length : 0;
  const tabs = [['cal','לוח',ICON.cal],['mine','הקידושים שלי',ICON.cup],['terms','הנחיות',ICON.doc]];
  if (isManager()) tabs.push(['manage','ניהול',ICON.gear]);
  t.innerHTML = '<div class="in">'+tabs.map(([k,l,i]) =>
    `<button data-act="view" data-v="${k}" ${S.view===k?'aria-current="page"':''}>${i}<span>${l}</span>${k==='manage'&&pend?`<span class="dot">${pend}</span>`:''}</button>`).join('')+'</div>';
}
function renderMain(){
  const app = $('#app');
  if (S.fatal){ app.innerHTML = `<div class="hero"><h1>לוח קידושים</h1><p class="muted">${esc(S.fatal)}</p></div>`; return; }
  if (!S.ready){ app.innerHTML = '<div class="empty">טוען…</div>'; return; }
  if (!S.uid){ app.innerHTML = `<div class="hero"><h1>לוח קידושים</h1><p class="muted">כדי להירשם לקידוש יש להיכנס עם חשבון מחובר.</p></div>`; return; }
  if (!S.sid || (!S.members[S.uid] && !S.owner)) return renderJoin(app);
  const head = headerHTML();
  let body = '';
  if (S.view === 'cal') body = calHTML();
  else if (S.view === 'mine') body = mineHTML();
  else if (S.view === 'terms') body = termsHTML();
  else if (S.view === 'manage' && isManager()) body = manageHTML();
  else { S.view = 'cal'; body = calHTML(); }
  app.innerHTML = head + (S.canWrite ? '' : '<div class="warn">יש לך הרשאת צפייה בלבד. לרישום לקידוש בקשו מבעל העמוד הרשאת Contributor.</div>') + body;
}
function headerHTML(){
  const s = syn(), unread = myNotes().filter(n => !(n.readBy||[]).includes(S.uid)).length;
  const multi = (S.profile?.synagogues||[]).filter(x=>S.syns[x]).length > 1 || S.owner;
  return `<header class="top">
    <div class="shul"><h1>${esc(s.name)}</h1><small>${esc(s.city||'')}${s.city?', ':''}${s.il?'ארץ ישראל':'חוץ לארץ'}${myRole()?' | '+ROLE_LABEL[myRole()]:''}</small></div>
    ${multi?`<button class="iconbtn" data-act="switchSyn" aria-label="החלפת בית כנסת">${ICON.swap}</button>`:''}
    <button class="iconbtn" data-act="notes" aria-label="התראות">${ICON.bell}${unread?`<span class="dot">${unread}</span>`:''}</button>
  </header>`;
}

/* Calendar */
function statusHTML(sl, b, past){
  if (!b) return past ? '<span class="chip block">לא נקבע</span>' : '<span class="chip free">פנוי</span>';
  const mine = b.uid === S.uid && !b.manual;
  if (b.status === 'blocked') return `<span class="chip block">${esc(b.blockLabel||'לא זמין')}</span>`;
  const chip = b.status === 'approved' ? '<span class="chip appr">קידוש ע״י</span>' : '<span class="chip pend">ממתין לאישור</span>';
  return `${chip}<span class="by">${esc(b.sponsorName)}</span>${mine?'<span class="mine-tag">הרישום שלי</span>':''}`;
}
function calHTML(){
  const s = syn(), {start, end} = monthRange(S.anchor, S.mode), {t, alt} = monthTitles();
  const slots = getSlots(start, end, !!s.il), t0 = today0();
  const up = myBookings().filter(b => pkey(b.key) >= t0 && (pkey(b.key)-t0)/864e5 <= 10 && b.status !== 'blocked')[0];
  let remind = '';
  if (up){
    const sl = slotFor(up.key, !!s.il), days = Math.round((pkey(up.key)-t0)/864e5);
    remind = `<section class="card remind"><h3>הקידוש שלך ב${esc(slotTitle(sl))}</h3>
      <p>${days===0?'היום':days===1?'מחר':'בעוד '+days+' ימים'}. ${up.status==='pending'?'הבקשה עדיין ממתינה לאישור.':'כדאי לעבור שוב על ההנחיות.'}</p>
      <div class="row"><button class="btn" data-act="viewTerms">להנחיות</button>${S.dl?`<button class="btn" data-act="ics" data-k="${up.key}">הוספה ליומן</button>`:''}</div></section>`;
  }
  const rows = slots.map(sl => {
    const b = bookingOf(sl.key), past = sl.date < t0, isToday = +sl.date === +t0;
    const big = S.mode === 'heb' ? heDay(sl.hd) : sl.date.getDate();
    const small = S.mode === 'heb' ? gShort(sl.date) : heDay(sl.hd)+' '+heMonth(sl.hd);
    return `<button class="slot${past?' past':''}${isToday?' today':''}" data-act="slot" data-k="${sl.key}">
      <div class="date"><div class="big">${big}</div><div class="small">${esc(small)}</div></div>
      <div><div class="kind">${esc(sl.kind)}</div><h3>${esc(sl.name)}</h3>${sl.subs.length?`<div class="sub">${esc(sl.subs.join(', '))}</div>`:''}</div>
      <div class="stcol">${statusHTML(sl,b,past)}</div></button>`;
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
  return Object.entries(S.bookings).filter(([k,b]) => b.status && b.uid === S.uid && !b.manual)
    .map(([k,b]) => ({key:k, ...b})).sort((a,b) => a.key < b.key ? -1 : 1);
}
function mineHTML(){
  const s = syn(), t0 = today0(), all = myBookings(), ct = curTerms();
  const up = all.filter(b => pkey(b.key) >= t0), past = all.filter(b => pkey(b.key) < t0).reverse();
  const item = b => {
    const sl = slotFor(b.key, !!s.il), outdated = ct && b.termsVersion < ct.version && pkey(b.key) >= t0;
    return `<div class="card">
      <div class="row" style="justify-content:space-between"><div><div class="meta">${esc(heFull(sl.hd))} | ${esc(gFull(sl.date))}</div><h3>${esc(slotTitle(sl))}</h3></div>
      ${b.status==='approved'?'<span class="chip appr">מאושר</span>':'<span class="chip pend">ממתין לאישור</span>'}</div>
      <div class="small">בשם: ${esc(b.sponsorName)}${b.occasion?' | '+esc(b.occasion):''}</div>
      <div class="meta">אושרו הנחיות גרסה ${b.termsVersion||'—'}</div>
      ${outdated?`<div class="warn">ההנחיות עודכנו לגרסה ${ct.version}. יש לעיין ולאשר מחדש.</div>`:''}
      ${pkey(b.key) >= t0 ? `<div class="row" style="margin-top:10px">
        ${outdated?`<button class="btn" data-act="ackTerms" data-k="${b.key}">עיון ואישור</button>`:`<button class="btn sec" data-act="termsVer" data-v="${b.termsVersion}">ההנחיות שאישרתי</button>`}
        ${S.dl?`<button class="btn sec" data-act="ics" data-k="${b.key}">הוספה ליומן</button>`:''}
        <button class="btn danger" data-act="cancelMine" data-k="${b.key}">ביטול הרישום</button></div>`:''}
    </div>`;
  };
  return `<div class="sechead"><h2>הקידושים שלי</h2></div>
    ${up.length ? up.map(item).join('') : '<div class="card empty">אין לך קידושים קרובים. בחרו שבת פנויה בלוח כדי להירשם.<div style="margin-top:12px"><button class="btn" data-act="view" data-v="cal">ללוח השבתות</button></div></div>'}
    ${past.length ? `<div class="sechead"><h2>קידושים קודמים</h2></div>`+past.map(item).join('') : ''}`;
}

/* Terms */
function termsBody(t){
  if (!t) return '<p class="muted">הנהלת בית הכנסת עדיין לא פרסמה הנחיות.</p>';
  return `${t.intro?`<p class="terms-intro">${esc(t.intro)}</p>`:''}
    <ul class="terms-list">${(t.items||[]).map(i=>`<li><span>${esc(i)}</span></li>`).join('')}</ul>
    <div class="meta">גרסה ${t.version}, עודכנה ${esc(fmtTime(t.editedAt))}</div>`;
}
function termsHTML(){
  const t = curTerms();
  return `<div class="sechead"><h2>הנחיות לבעל הקידוש</h2>${isAdmin()?'<button class="btn sec" data-act="editTerms">עריכה</button>':''}</div>
    <div class="card">${termsBody(t)}</div>
    ${S.terms.length > 1 ? `<div class="sechead"><h2>היסטוריית גרסאות</h2></div><div class="card"><div class="list">${S.terms.map(v=>`
      <button class="li" style="border-inline:0;border-top:0;background:none;text-align:right;width:100%" data-act="termsVer" data-v="${v.version}">
        <span class="pill">גרסה ${v.version}</span><span class="grow"><span class="t">${esc(v.note||'עדכון')}</span><br><span class="meta">${esc(fmtTime(v.editedAt))}${v.editedBy?' | '+esc(nameOf(v.editedBy)):''}</span></span></button>`).join('')}</div></div>` : ''}`;
}

/* Manage */
function manageHTML(){
  const s = syn(), t0 = today0();
  const pend = Object.entries(S.bookings).filter(([k,b]) => b.status === 'pending').sort();
  const pendHTML = pend.length ? pend.map(([k,b]) => {
    const sl = slotFor(k, !!s.il);
    return `<div class="li"><div class="grow"><div class="t">${esc(slotTitle(sl))} <span class="meta">${esc(gShort(sl.date))}</span></div>
      <div class="small">${esc(b.sponsorName)}${b.occasion?' | '+esc(b.occasion):''}</div>
      <div class="meta">נרשם: ${esc(nameOf(b.uid))}${b.phone?' | '+esc(b.phone):''}${pkey(k)<t0?' | התאריך עבר':''}</div></div>
      <div class="row"><button class="btn ok" data-act="approve" data-k="${k}">אישור</button><button class="btn danger" data-act="reject" data-k="${k}">דחייה</button></div></div>`;
  }).join('') : '<p class="muted">אין בקשות ממתינות.</p>';
  let admin = '';
  if (isAdmin()){
    const mem = Object.entries(S.members).sort((a,b)=>(a[1].joinedAt||0)-(b[1].joinedAt||0));
    admin = `<div class="sechead"><h2>חברי בית הכנסת</h2><span class="meta">${mem.length} רשומים</span></div>
      <div class="card"><div class="list">${mem.map(([id,m]) => `<div class="li"><div class="grow"><div class="t">${esc(nameOf(id))}${id===S.uid?' (אני)':''}</div>
        <div class="meta">${esc(S.emails[id]||'')}${m.phone?' | '+esc(m.phone):''}</div></div>
        <select data-change="role" data-id="${id}" aria-label="תפקיד" style="width:auto">${['member','gabbai','admin'].map(r=>`<option value="${r}" ${m.role===r?'selected':''}>${ROLE_LABEL[r]}</option>`).join('')}</select>
        ${id!==S.uid?`<button class="btn ghost" data-act="removeMember" data-id="${id}" aria-label="הסרה">הסרה</button>`:''}</div>`).join('')}</div></div>
      <div class="sechead"><h2>הגדרות</h2></div>
      <div class="card"><div class="row"><button class="btn sec" data-act="editTerms">עריכת ההנחיות</button><button class="btn sec" data-act="editSyn">פרטי בית הכנסת</button>${S.owner?'<button class="btn sec" data-act="newSyn">הקמת בית כנסת נוסף</button>':''}</div></div>`;
  }
  return `<div class="sechead"><h2>בקשות לאישור</h2></div><div class="card"><div class="list">${pendHTML}</div></div>
    <div class="card"><h3>רישום ידני או חסימת תאריך</h3><p class="small muted">לחיצה על שבת בלוח פותחת גם פעולות ניהול: רישום בשם משפחה, סימון "קידוש קהילתי" או חסימה.</p>
    <button class="btn sec" data-act="view" data-v="cal">ללוח</button></div>${admin}`;
}

/* Join / create */
function renderJoin(app){
  const list = Object.values(S.syns);
  const joined = S.profile?.synagogues || [];
  app.innerHTML = `<div class="hero"><h1>לוח קידושים</h1><p class="muted">בחרו את בית הכנסת שלכם כדי לראות את שבתות החודש ולהירשם לקידוש.</p></div>
    ${list.length ? `<div class="card"><div class="list">${list.map(s=>`<div class="li"><div class="grow"><div class="t">${esc(s.name)}</div><div class="meta">${esc(s.city||'')}${s.city?', ':''}${s.il?'ארץ ישראל':'חוץ לארץ'}</div></div>
      <button class="btn" data-act="join" data-sid="${s.id}" ${S.canWrite?'':'disabled'}>${joined.includes(s.id)||S.owner?'כניסה':'הצטרפות'}</button></div>`).join('')}</div></div>` :
      `<div class="card"><p class="muted" style="margin:0">${S.owner?'עדיין לא הוגדר בית כנסת. הקימו את הראשון כדי להתחיל.':'עדיין לא הוגדר בית כנסת. מנהל המערכת יקים אותו בקרוב.'}</p></div>`}
    ${S.owner?'<button class="btn" data-act="newSyn">הקמת בית כנסת</button>':''}`;
  $('#tabs').hidden = true;
}

/* ---------- Sheets ---------- */
function openSheet(html){ $('#sheet').innerHTML = html; $('#sheetWrap').hidden = false; const f = $('#sheet').querySelector('input,textarea,select'); if (f && window.innerWidth > 700) f.focus(); }
function closeSheet(){ $('#sheetWrap').hidden = true; $('#sheet').innerHTML = ''; }
const sheetHead = (t, sub) => `<div class="sh"><div style="flex:1"><h2>${esc(t)}</h2>${sub?`<div class="meta">${esc(sub)}</div>`:''}</div><button class="x" data-act="close" aria-label="סגירה">×</button></div>`;
let toastT;
function toast(msg){ let t = $('.toast'); if (!t){ t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role','status'); document.body.appendChild(t); } t.textContent = msg; clearTimeout(toastT); toastT = setTimeout(() => t.remove(), 3200); }

function slotSheet(k){
  const s = syn(), sl = slotFor(k, !!s.il), b = bookingOf(k), past = sl.date < today0();
  const mine = b && b.uid === S.uid && !b.manual;
  let html = sheetHead(slotTitle(sl), heFull(sl.hd)+' | '+gFull(sl.date));
  if (sl.subs.length) html += `<p class="small muted">${esc(sl.subs.join(', '))}</p>`;
  if (b && b.status !== 'blocked'){
    html += `<dl class="kv"><dt>סטטוס</dt><dd>${b.status==='approved'?'מאושר':'ממתין לאישור'}</dd><dt>קידוש ע״י</dt><dd>${esc(b.sponsorName)}</dd>
      ${b.occasion?`<dt>לרגל</dt><dd>${esc(b.occasion)}</dd>`:''}
      ${isManager()?`<dt>נרשם</dt><dd>${b.manual?'רישום ידני ע״י '+esc(nameOf(b.uid)):esc(nameOf(b.uid))}</dd>${b.phone?`<dt>טלפון</dt><dd dir="ltr" style="text-align:right">${esc(b.phone)}</dd>`:''}${b.note?`<dt>הערה</dt><dd>${esc(b.note)}</dd>`:''}`:''}</dl>`;
  } else if (b) html += `<p><span class="chip block">${esc(b.blockLabel||'לא זמין')}</span></p>`;
  else html += `<p><span class="chip ${past?'block':'free'}">${past?'לא נקבע קידוש':'פנוי לקידוש'}</span></p>`;
  const acts = [];
  if (!b && !past && S.canWrite) acts.push(`<button class="btn" data-act="register" data-k="${k}">הרשמה לקידוש</button>`);
  if (mine && !past) acts.push(`<button class="btn danger" data-act="cancelMine" data-k="${k}">ביטול הרישום שלי</button>`);
  if (isManager() && !past){
    if (b?.status === 'pending') acts.push(`<button class="btn ok" data-act="approve" data-k="${k}">אישור</button><button class="btn danger" data-act="reject" data-k="${k}">דחייה</button>`);
    if (b?.status === 'approved' && !mine) acts.push(`<button class="btn danger" data-act="reject" data-k="${k}">ביטול הקידוש</button>`);
    if (b?.status === 'blocked') acts.push(`<button class="btn sec" data-act="unblock" data-k="${k}">שחרור התאריך</button>`);
    if (!b) acts.push(`<button class="btn sec" data-act="manual" data-k="${k}">רישום ידני</button><button class="btn sec" data-act="block" data-k="${k}">חסימה / קידוש קהילתי</button>`);
  }
  if (acts.length) html += `<div class="row" style="margin-top:14px">${acts.join('')}</div>`;
  openSheet(html);
}
function registerSheet(k){
  const s = syn(), sl = slotFor(k, !!s.il), t = curTerms(), me = S.members[S.uid] || {};
  openSheet(sheetHead('הרשמה לקידוש', slotTitle(sl)+' | '+heFull(sl.hd)) + `
    <div class="steps"><span class="on" id="st1"></span><span id="st2"></span></div>
    <div id="step1">
      <label class="f" for="fSponsor">שם שיוצג בלוח</label><input type="text" id="fSponsor" maxlength="60" placeholder="לדוגמה: משפחת לוי">
      <label class="f" for="fOcc">לרגל (לא חובה)</label><input type="text" id="fOcc" maxlength="80" placeholder="בר מצווה, הולדת נכד, אזכרה…">
      <label class="f" for="fPhone">טלפון ליצירת קשר</label><input type="tel" id="fPhone" maxlength="20" dir="ltr" style="text-align:right" value="${esc(me.phone||'')}">
      <label class="f" for="fNote">הערה לאחראי (לא חובה)</label><input type="text" id="fNote" maxlength="200">
      <div class="row" style="margin-top:16px"><button class="btn" data-act="regNext">המשך להנחיות</button></div>
    </div>
    <div id="step2" hidden>
      <div class="card" style="background:var(--surface2)">${termsBody(t)}</div>
      <label class="check"><input type="checkbox" id="fAgree"> קראתי את ההנחיות ואני מאשר אותן</label>
      <div class="row"><button class="btn" data-act="regSubmit" data-k="${k}">שליחת הבקשה</button><button class="btn ghost" data-act="regBack">חזרה</button></div>
    </div>`);
}
function termsVerSheet(v){
  const t = S.terms.find(x => x.version == v);
  if (!t) return toast('הגרסה לא נמצאה');
  openSheet(sheetHead('הנחיות, גרסה '+t.version, t.note||'') + termsBody(t) +
    (isAdmin() && t !== curTerms() ? `<div class="row" style="margin-top:14px"><button class="btn sec" data-act="restoreTerms" data-v="${t.version}">שחזור כגרסה חדשה</button></div>` : ''));
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
function synSheet(isNew){
  const s = isNew ? {name:'', city:'', il:true} : syn();
  openSheet(sheetHead(isNew?'הקמת בית כנסת':'פרטי בית הכנסת') + `
    <label class="f" for="sName">שם בית הכנסת</label><input type="text" id="sName" maxlength="80" value="${esc(s.name)}">
    <label class="f" for="sCity">עיר</label><input type="text" id="sCity" maxlength="60" value="${esc(s.city||'')}">
    <label class="f" for="sIl">מיקום (קובע את סדר הפרשות והחגים)</label>
    <select id="sIl"><option value="1" ${s.il?'selected':''}>ארץ ישראל</option><option value="0" ${!s.il?'selected':''}>חוץ לארץ</option></select>
    <div class="row" style="margin-top:16px"><button class="btn" data-act="saveSyn" data-new="${isNew?1:0}">${isNew?'הקמה':'שמירה'}</button><button class="btn ghost" data-act="close">ביטול</button></div>`);
}
function reasonSheet(k, kind){
  const sl = slotFor(k, !!syn().il);
  const title = kind === 'block' ? 'חסימת תאריך' : kind === 'manual' ? 'רישום ידני' : 'דחייה או ביטול';
  let f = '';
  if (kind === 'block') f = `<label class="f" for="rText">מה יוצג בלוח</label><input type="text" id="rText" maxlength="40" value="קידוש קהילתי">`;
  else if (kind === 'manual') f = `<label class="f" for="rText">שם שיוצג בלוח</label><input type="text" id="rText" maxlength="60" placeholder="משפחת…"><label class="f" for="rOcc">לרגל</label><input type="text" id="rOcc" maxlength="80"><label class="f" for="rPhone">טלפון</label><input type="tel" id="rPhone" dir="ltr" style="text-align:right" maxlength="20">`;
  else f = `<label class="f" for="rText">סיבה (תישלח לנרשם)</label><input type="text" id="rText" maxlength="160">`;
  openSheet(sheetHead(title, slotTitle(sl)+' | '+gFull(sl.date)) + f +
    `<div class="row" style="margin-top:16px"><button class="btn${kind==='reject'?' danger':''}" data-act="doReason" data-k="${k}" data-kind="${kind}">אישור</button><button class="btn ghost" data-act="close">ביטול</button></div>`);
}
function myNotes(){
  return S.notes.filter(n => n.by !== S.uid && (n.to === S.uid || (n.to === 'managers' && isManager())));
}
function notesSheet(){
  const list = myNotes();
  openSheet(sheetHead('התראות') + (list.length ? `<div class="list">${list.map(n => `
    <div class="li ${(n.readBy||[]).includes(S.uid)?'':'unread'}"><div class="grow"><div>${esc(n.text)}</div><div class="meta">${esc(fmtTime(n.at))}</div></div></div>`).join('')}</div>` : '<p class="muted">אין התראות חדשות.</p>'));
  markRead(list);
}
async function markRead(list){
  for (const n of list){
    if ((n.readBy||[]).includes(S.uid)) continue;
    try { await S.db.doc(P(S.sid,'notifications',n.id)).update({readBy:[...(n.readBy||[]), S.uid]}); } catch(e){}
  }
  if (isManager()){ // ניקוי התראות ישנות מ-120 יום
    const old = S.notes.filter(n => Date.now() - n.at > 120*864e5).slice(0,20);
    for (const n of old){ try { await S.db.doc(P(S.sid,'notifications',n.id)).delete(); } catch(e){} }
  }
}
function switchSheet(){
  const ids = S.owner ? Object.keys(S.syns) : (S.profile?.synagogues||[]).filter(x=>S.syns[x]);
  openSheet(sheetHead('בית כנסת') + `<div class="list">${ids.map(id => `<div class="li"><div class="grow"><div class="t">${esc(S.syns[id].name)}</div><div class="meta">${esc(S.syns[id].city||'')}</div></div>
    ${id===S.sid?'<span class="pill">נוכחי</span>':`<button class="btn sec" data-act="join" data-sid="${id}">מעבר</button>`}</div>`).join('')}</div>
    <div class="row" style="margin-top:14px"><button class="btn ghost" data-act="showAllSyn">הצטרפות לבית כנסת אחר</button></div>`);
}

/* ---------- ICS ---------- */
async function downloadIcs(k){
  if (!S.dl) return;
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
  try { await S.dl.save({filename:'kiddush-'+k+'.ics', data:ics}); }
  catch(er){ if (er?.code !== 'declined') toast('ההורדה לא הצליחה'); }
}

const DEFAULT_TERMS = window.KIDDUSH_DEFAULT_TERMS;

/* ---------- Actions ---------- */
const A = {
  view: d => { S.view = d.v; closeSheet(); renderAll(); window.scrollTo(0,0); },
  prev: () => shiftMonth(-1), next: () => shiftMonth(1),
  today: () => { S.anchor = today0(); renderMain(); },
  mode: d => { S.mode = d.m; try{ localStorage.setItem('kd_mode', d.m); }catch(e){} renderMain(); },
  slot: d => slotSheet(d.k),
  close: closeSheet,
  notes: notesSheet,
  switchSyn: switchSheet,
  showAllSyn: () => { closeSheet(); forceJoin = true; renderAll(); },
  viewTerms: () => { S.view = 'terms'; renderAll(); window.scrollTo(0,0); },
  termsVer: d => termsVerSheet(d.v),
  editTerms: editTermsSheet,
  editSyn: () => synSheet(false),
  newSyn: () => synSheet(true),
  ics: d => downloadIcs(d.k),
  register: d => registerSheet(d.k),
  regNext: () => {
    if (!$('#fSponsor').value.trim()){ $('#fSponsor').focus(); return toast('נא למלא שם שיוצג בלוח'); }
    $('#step1').hidden = true; $('#step2').hidden = false; $('#st2').classList.add('on'); $('#sheet').scrollTop = 0;
  },
  regBack: () => { $('#step1').hidden = false; $('#step2').hidden = true; $('#st2').classList.remove('on'); },
  regSubmit: guard(async d => {
    if (!$('#fAgree').checked) return toast('יש לאשר את ההנחיות כדי להירשם');
    const k = d.k, ref = S.db.doc(P(S.sid,'bookings',k));
    const data = { sponsorName:$('#fSponsor').value.trim(), occasion:$('#fOcc').value.trim(), phone:$('#fPhone').value.trim(), note:$('#fNote').value.trim() };
    const lease = await ref.acquire({holder:S.uid, ttlMs:8000});
    if (!lease.acquired) return toast('מישהו אחר נרשם לתאריך הזה ממש עכשיו. נסו שוב בעוד רגע.');
    const cur = await ref.get();
    if (cur.exists && cur.data()?.status){ closeSheet(); return toast('התאריך כבר תפוס'); }
    const ct = curTerms();
    await ref.set({ ...data, uid:S.uid, status:'pending', termsVersion: ct ? ct.version : 0, termsAckAt:Date.now(), createdAt:Date.now() });
    if (data.phone && S.members[S.uid] && S.members[S.uid].phone !== data.phone){ try { await S.db.doc(P(S.sid,'members',S.uid)).update({phone:data.phone}); } catch(e){} }
    const sl = slotFor(k, !!syn().il);
    await notify('managers','new', k, `בקשה חדשה לקידוש ב${slotTitle(sl)} (${gShort(sl.date)}): ${data.sponsorName}`);
    closeSheet(); toast('הבקשה נשלחה לאישור');
  }),
  cancelMine: d => {
    const sl = slotFor(d.k, !!syn().il);
    openSheet(sheetHead('ביטול הרישום', slotTitle(sl)) + `<p>אחראי הקידושים יקבלו הודעה על הביטול.</p>
      <div class="row"><button class="btn danger" data-act="doCancel" data-k="${d.k}">ביטול הרישום</button><button class="btn ghost" data-act="close">השארת הרישום</button></div>`);
  },
  doCancel: guard(async d => {
    const b = bookingOf(d.k); if (!b || b.uid !== S.uid) return closeSheet();
    await S.db.doc(P(S.sid,'bookings',d.k)).delete();
    const sl = slotFor(d.k, !!syn().il);
    await notify('managers','cancel', d.k, `${nameOf(S.uid)} ביטל את הקידוש ב${slotTitle(sl)} (${gShort(sl.date)}). התאריך פנוי כעת.`);
    closeSheet(); toast('הרישום בוטל');
  }),
  approve: guard(async d => {
    const b = bookingOf(d.k); if (!b) return;
    await S.db.doc(P(S.sid,'bookings',d.k)).update({status:'approved', decidedBy:S.uid, decidedAt:Date.now()});
    const sl = slotFor(d.k, !!syn().il);
    if (!b.manual) await notify(b.uid,'approved', d.k, `הקידוש שלך ב${slotTitle(sl)} (${gShort(sl.date)}) אושר. תודה!`);
    closeSheet(); toast('הבקשה אושרה');
  }),
  reject: d => reasonSheet(d.k, 'reject'),
  block: d => reasonSheet(d.k, 'block'),
  manual: d => reasonSheet(d.k, 'manual'),
  unblock: guard(async d => { await S.db.doc(P(S.sid,'bookings',d.k)).delete(); closeSheet(); toast('התאריך שוחרר'); }),
  doReason: guard(async d => {
    const k = d.k, kind = d.kind, txt = $('#rText').value.trim(), ref = S.db.doc(P(S.sid,'bookings',k)), sl = slotFor(k, !!syn().il);
    if (kind === 'reject'){
      const b = bookingOf(k); await ref.delete();
      if (b && !b.manual) await notify(b.uid,'rejected', k, `הרישום שלך לקידוש ב${slotTitle(sl)} (${gShort(sl.date)}) בוטל על ידי הנהלת בית הכנסת.${txt?' סיבה: '+txt:''}`);
      toast('הרישום הוסר');
    } else {
      if (!txt) return toast('נא למלא את השדה');
      const cur = await ref.get(); if (cur.exists && cur.data()?.status) return toast('התאריך כבר תפוס');
      if (kind === 'block') await ref.set({status:'blocked', blockLabel:txt, uid:S.uid, createdAt:Date.now()});
      else await ref.set({status:'approved', manual:true, sponsorName:txt, occasion:$('#rOcc').value.trim(), phone:$('#rPhone').value.trim(), uid:S.uid, termsVersion:curTerms()?.version||0, createdAt:Date.now(), decidedBy:S.uid, decidedAt:Date.now()});
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
    await S.db.doc(P(S.sid,'bookings',d.k)).update({termsVersion:curTerms().version, termsAckAt:Date.now()});
    closeSheet(); toast('תודה, האישור נשמר');
  }),
  saveTerms: guard(async () => {
    const items = $('#tItems').value.split('\n').map(x => x.trim()).filter(Boolean);
    const intro = $('#tIntro').value.trim();
    if (!items.length && !intro) return toast('ההנחיות ריקות');
    const v = (curTerms()?.version || 0) + 1;
    await S.db.doc(P(S.sid,'terms','v'+v)).set({version:v, intro, items, note:$('#tNote').value.trim() || 'עדכון הנחיות', editedBy:S.uid, editedAt:Date.now()});
    closeSheet(); toast('נשמרה גרסה '+v);
  }),
  restoreTerms: guard(async d => {
    const old = S.terms.find(x => x.version == d.v); const v = (curTerms()?.version || 0) + 1;
    await S.db.doc(P(S.sid,'terms','v'+v)).set({version:v, intro:old.intro, items:old.items, note:'שוחזר מגרסה '+old.version, editedBy:S.uid, editedAt:Date.now()});
    closeSheet(); toast('גרסה '+old.version+' שוחזרה כגרסה '+v);
  }),
  saveSyn: guard(async d => {
    const name = $('#sName').value.trim(), city = $('#sCity').value.trim(), il = $('#sIl').value === '1';
    if (!name) return toast('נא למלא שם');
    if (d.new === '1'){
      const sid = 's'+rid();
      await S.db.doc('synagogues/'+sid).set({name, city, il, createdAt:Date.now(), createdBy:S.uid});
      await S.db.doc(P(sid,'members',S.uid)).set({role:'admin', joinedAt:Date.now()});
      await S.db.doc(P(sid,'terms','v1')).set({version:1, ...DEFAULT_TERMS, note:'גרסה ראשונה', editedBy:S.uid, editedAt:Date.now()});
      const list = [...new Set([...(S.profile?.synagogues||[]), sid])];
      await saveProfile({synagogues:list, current:sid});
      forceJoin = false; S.view = 'cal'; toast('בית הכנסת הוקם');
    } else {
      await S.db.doc('synagogues/'+S.sid).update({name, city, il}); slotCache.clear(); toast('נשמר');
    }
    closeSheet();
  }),
  join: guard(async d => {
    const sid = d.sid;
    const m = await S.db.doc(P(sid,'members',S.uid)).get();
    if (!m.exists) await S.db.doc(P(sid,'members',S.uid)).set({role:'member', joinedAt:Date.now()});
    const list = [...new Set([...(S.profile?.synagogues||[]), sid])];
    await saveProfile({synagogues:list, current:sid});
    forceJoin = false; S.view = 'cal'; closeSheet();
  }),
  removeMember: guard(async d => {
    if (!confirm('להסיר את '+nameOf(d.id)+' מבית הכנסת?')) return;
    await S.db.doc(P(S.sid,'members',d.id)).delete(); toast('הוסר');
  })
};
const C = {
  role: guard(async (d, el) => {
    if (d.id === S.uid && el.value !== 'admin' && !S.owner && Object.values(S.members).filter(m => m.role === 'admin').length <= 1){ el.value = 'admin'; return toast('חייב להישאר לפחות מנהל אחד'); }
    await S.db.doc(P(S.sid,'members',d.id)).update({role:el.value}); toast('התפקיד עודכן');
  })
};
let forceJoin = false;
function renderJoinForce(){ renderJoin($('#app')); }
const _renderMain = renderMain;
renderMain = function(){ if (forceJoin && S.ready && S.uid) return renderJoin($('#app')); _renderMain(); };

document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (t){ const f = A[t.dataset.act]; if (f){ e.preventDefault(); f(t.dataset, t); } return; }
  if (e.target === $('#sheetWrap')) closeSheet();
});
document.addEventListener('change', e => { const t = e.target.closest('[data-change]'); if (t && C[t.dataset.change]) C[t.dataset.change](t.dataset, t); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheetWrap').hidden) closeSheet(); });

boot();
})();
