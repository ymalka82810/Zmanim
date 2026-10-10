/* מכרז עליות: הגבאי או הרב פותחים מכירה פומבית על עליות וכיבודים (שלישי, מפטיר, פתיחת הארון, גלילה, או כל שם אחר),
 * וקובעים ממתי עד מתי המכרז פתוח. חברי הקהילה מציעים, והדף מתעדכן אצל כולם בזמן אמת (auctions:list).
 * בסגירה הזוכה נרשם בקופה כחוב פתוח ובחלוקת העליות (convex/auctions.ts).
 * ההודעות הצדדיות על הצעות ("פלוני הציע ₪180 על שלישי") מוצגות בכל דף על ידי js/menu.js.
 */
(function(){
"use strict";
const { H, esc, dkey, pkey, gShort, gFull, heFull, getSlots, slotFor, slotTitle } = window.KiddushCalendar || {};
const $ = s => document.querySelector(s);
const Auth = window.SiteAuth;
const ROLE_LABEL = { gabbai: 'גבאי', rabbi: 'רב', member: 'חבר קהילה' };
const ACCOUNT_URL = '../account/';
/** העליות לפי סוג היום, והכיבודים שאפשר להוסיף בכל יום (כמו ב-aliyot/js/app.js) */
const SEQ_SHABBAT = ['כהן', 'לוי', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שביעי', 'מפטיר'];
const SEQ_CHAG = ['כהן', 'לוי', 'שלישי', 'רביעי', 'חמישי', 'מפטיר'];
const SEQ_WEEKDAY = ['כהן', 'לוי', 'ישראל'];
const HONORS = ['פתיחת הארון', 'הוצאת ספר תורה', 'הגבהה', 'גלילה', 'הכנסת ספר תורה'];
const DEFAULT_MIN = 18, DEFAULT_STEP = 10;

function today0(){ const d = new Date(); d.setHours(0,0,0,0); return d; }
function addDays(d, n){ const x = new Date(d); x.setDate(x.getDate() + n); return x; }
const shekel = n => '₪' + Math.round(n).toLocaleString('he-IL');

const S = { ready: false, fatal: null, signedIn: false, synagogues: [], sid: null, data: null, error: null };
const isManager = () => !!S.data?.manager;
const featureOn = sid => !!S.synagogues.find(s => s._id === sid)?.features?.includes('auctions');

/* ---------- Boot & data ---------- */
async function boot(){
  if (!H || !window.KiddushCalendar){ S.fatal = 'לא ניתן לטעון את לוח השנה העברי. רעננו את העמוד.'; return render(); }
  render();
  try { await Auth.completeSignInFromRedirect(); } catch(e){ console.warn(e); }
  Auth.onChange(() => { S.signedIn = Auth.isAuthenticated(); loadSynagogues(); });
  S.signedIn = Auth.isAuthenticated();
  await loadSynagogues();
  setInterval(tick, 1000);
}

async function loadSynagogues(){
  if (!S.signedIn){ S.ready = true; S.synagogues = []; attach(null); return render(); }
  const saved = Auth.cached('synagogues:mine', {});
  if (saved) useSynagogues(saved);
  let synagogues = [];
  try {
    const [me, list] = await Promise.all([Auth.query('users:me', {}), Auth.query('synagogues:mine', {})]);
    if (me === null) S.signedIn = false;
    synagogues = list;
  } catch(e){ console.warn(e); if (saved) return; }
  if (!S.signedIn){ S.synagogues = synagogues; S.ready = true; attach(null); return render(); }
  useSynagogues(synagogues);
}

function useSynagogues(synagogues){
  S.synagogues = synagogues;
  S.ready = true;
  let sid = Auth.activeSynagogueId();
  if (!S.synagogues.some(s => s._id === sid)){ sid = S.synagogues[0]?._id || null; Auth.setActiveSynagogueId(sid); }
  attach(sid);
  render();
}

let unsub = null;
function attach(sid){
  if (sid === S.sid && (unsub || !sid)) return;
  if (unsub) unsub();
  unsub = null;
  S.sid = sid; S.data = null; S.error = null;
  if (!sid || !featureOn(sid)) return;
  unsub = Auth.watch('auctions:list', { synagogueId: sid }, data => { S.data = data; render(); },
    e => { console.warn(e); S.error = errMsg(e); render(); });
}

function errMsg(e){ return (e && typeof e.data === 'string') ? e.data : 'הפעולה לא נשמרה. נסו שוב.'; }
async function call(name, args){ return await Auth.client().mutation(name, { synagogueId: S.sid, ...args }); }
function guard(fn){ return async (...a) => { try { await fn(...a); } catch(e){ console.warn(e); toast(errMsg(e)); } }; }

/* ---------- Dates & times ---------- */
const il = () => S.data ? !!S.data.synagogue.il : true;
function nextSlotKey(d){ const s = getSlots(addDays(d, 1), addDays(d, 60), il()); return s.length ? s[0].key : dkey(addDays(d, 1)); }
function dayInfo(k){
  const sl = slotFor(k, il()), d = pkey(k);
  const seq = d.getDay() === 6 ? SEQ_SHABBAT : sl.isChag ? SEQ_CHAG : SEQ_WEEKDAY;
  return { sl, d, seq, title: sl.kind ? slotTitle(sl) : gFull(d).replace(/ \d{4}$/, '') + ', יום ' + 'אבגדהוש'[d.getDay()] + '׳' };
}
const pad = n => String(n).padStart(2, '0');
/** ערך לשדה datetime-local, בשעון המקומי */
const toLocalInput = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fromLocalInput = s => s ? new Date(s).getTime() : NaN;
const WEEKDAY = 'אבגדהוש';
function when(ms){
  const d = new Date(ms), t = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const days = Math.round((new Date(d).setHours(0,0,0,0) - today0()) / 864e5);
  if (days === 0) return 'היום ב-' + t;
  if (days === 1) return 'מחר ב-' + t;
  return `יום ${WEEKDAY[d.getDay()]}׳ ${gShort(d)} ב-${t}`;
}
function left(ms){
  const s = Math.max(0, Math.floor(ms / 1000)), dd = Math.floor(s / 86400), hh = Math.floor(s % 86400 / 3600), mm = Math.floor(s % 3600 / 60), ss = s % 60;
  if (dd > 0) return `${dd} ימים ו-${hh} שעות`;
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
}
/** המצב לפי השעון של המכשיר; השרת מעדכן את status בשעות שנקבעו, ובודק שוב בכל הצעה */
function phase(a, now = Date.now()){
  if (a.status === 'closed') return 'closed';
  if (now >= a.closesAt) return 'closing';
  return now >= a.opensAt ? 'open' : 'scheduled';
}
function clockText(a){
  const p = phase(a), now = Date.now();
  if (p === 'scheduled') return `נפתח בעוד ${left(a.opensAt - now)}`;
  if (p === 'open') return `נסגר בעוד ${left(a.closesAt - now)}`;
  if (p === 'closing') return 'נסגר, קובעים זוכה…';
  return 'נסגר ' + when(a.closesAt);
}
/** שבת וחג: אין משתמשים באפליקציה, ולכן מזהירים כשהמכרז נסגר או נפתח בהם */
function onHoly(ms){
  if (!Number.isFinite(ms)) return false;
  const d = new Date(ms), key = dkey(d), sl = slotFor(key, il());
  if (d.getDay() === 6 || sl.isChag) return true;
  const tomorrow = slotFor(dkey(addDays(d, 1)), il());
  return (d.getDay() === 5 || tomorrow.isChag) && d.getHours() >= 16;
}

/* ---------- Render ---------- */
function hero(text, button){ return `<div class="hero"><h1>מכרז עליות</h1><p class="muted">${text}</p></div>${button || ''}`; }

let lastPhases = '';
const tops = new Map();
function render(){
  const app = $('#app');
  if (S.fatal){ app.innerHTML = hero(esc(S.fatal)); return; }
  if (!S.ready){ app.innerHTML = '<div class="empty">טוען…</div>'; return; }
  if (!S.signedIn){ app.innerHTML = hero('כדי להשתתף במכרז העליות יש להתחבר עם חשבון Google.', '<button class="btn btn-google" data-act="signIn">כניסה עם Google</button>'); return; }
  if (!S.sid){ app.innerHTML = hero('עדיין לא הצטרפת לקהילה. אפשר להצטרף דרך הזמנה מהגבאי או לפתוח קהילה חדשה.', `<a class="btn" href="${ACCOUNT_URL}">לחשבון שלי</a>`); return; }
  if (!featureOn(S.sid)){ app.innerHTML = hero('מכרז העליות אינו פעיל בקהילה זו. כדי להשתמש בו, כל הגבאים והרב צריכים לאשר אותו ב"החשבון שלי", בפרטי הקהילה.', `<a class="btn" href="${ACCOUNT_URL}">לחשבון שלי</a>`); return; }
  if (S.error && !S.data){ app.innerHTML = hero(esc(S.error), `<a class="btn" href="${ACCOUNT_URL}">לחשבון שלי</a>`); return; }
  if (!S.data){ app.innerHTML = '<div class="empty">טוען…</div>'; return; }

  // ההקלדה בשדות הסכום נשמרת כשהדף מתעדכן מהשרת באמצע
  const typed = {}, focused = document.activeElement?.id;
  document.querySelectorAll('.au-bid input').forEach(i => { if (i.value) typed[i.id] = i.value; });

  app.innerHTML = headerHTML() + activeHTML() + closedHTML();

  for (const [id, v] of Object.entries(typed)){ const i = document.getElementById(id); if (i) i.value = v; }
  if (focused){ const i = document.getElementById(focused); if (i && i.matches('input')) i.focus(); }
  // הבהוב כשהמחיר עולה
  for (const a of S.data.active){
    const before = tops.get(a._id), now = a.top ? a.top.amount : 0;
    if (before !== undefined && now > before) document.querySelector(`[data-top="${a._id}"]`)?.classList.add('bump');
    tops.set(a._id, now);
  }
  lastPhases = S.data.active.map(a => phase(a)).join();
}

/* כל שנייה: השעונים מתעדכנים במקום, ובמעבר בין פתוח לסגור הדף נבנה מחדש */
function tick(){
  if (!S.data) return;
  if (S.data.active.map(a => phase(a)).join() !== lastPhases) return render();
  document.querySelectorAll('[data-clock]').forEach(el => {
    const a = S.data.active.find(x => x._id === el.dataset.clock);
    if (a) el.textContent = clockText(a);
  });
}

function headerHTML(){
  const s = S.data.synagogue;
  if (window.SiteMenu) SiteMenu.setCommunity({ _id: S.sid, name: s.name, il: s.il });
  return `<header class="top">
    <div class="shul"><h1>מכרז עליות</h1><small>${esc(s.name)} | ${ROLE_LABEL[S.data.role]}</small></div>
    ${isManager() ? '<button class="btn" type="button" data-act="add">+ מכרז חדש</button>' : ''}
  </header>`;
}

function activeHTML(){
  const list = S.data.active.slice().sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0) || a.opensAt - b.opensAt || a.order - b.order);
  if (!list.length){
    return `<div class="card"><p class="muted" style="margin:0">${isManager()
      ? 'אין כרגע מכרזים פתוחים. אפשר לפתוח מכרז על כל העליות של השבת בבת אחת, או על כיבוד אחד, עם שעת פתיחה וסגירה.'
      : 'אין כרגע מכרזים פתוחים. כשהגבאי יפתח מכרז, תופיע הודעה בכל דף באפליקציה.'}</p></div>`;
  }
  const groups = [];
  for (const a of list){ const g = groups[groups.length - 1]; if (g && g.k === a.dateKey) g.list.push(a); else groups.push({ k: a.dateKey, list: [a] }); }
  return groups.map(({ k, list }) => `<h2 class="au-day">${esc(dayInfo(k).title)} <span class="meta">${esc(heFull(dayInfo(k).sl.hd))}</span></h2>
    <div class="au-grid">${list.map(auctionHTML).join('')}</div>`).join('');
}

function auctionHTML(a){
  const p = phase(a), live = p === 'open';
  const top = a.top
    ? `<div class="au-top${a.top.mine ? ' mine' : ''}" data-top="${a._id}"><b>${shekel(a.top.amount)}</b><span>${esc(a.top.name)}${a.top.mine ? ' · ההצעה שלך מובילה' : ''}</span></div>`
    : `<div class="au-top" data-top="${a._id}"><span class="meta">מחיר פתיחה</span><b>${shekel(a.minBid)}</b></div>`;
  const quick = [a.next, a.next + a.step, a.next + a.step * 4];
  const bid = live && !(a.top && a.top.mine) ? `<div class="au-bid">
      ${quick.map(n => `<button class="btn sec" type="button" data-act="bid" data-id="${a._id}" data-amount="${n}">${shekel(n)}</button>`).join('')}
      <input type="text" inputmode="numeric" id="amt-${a._id}" placeholder="סכום אחר" aria-label="סכום אחר על ${esc(a.title)}">
      <button class="btn" type="button" data-act="bidTyped" data-id="${a._id}">הצעה</button></div>` : '';
  const bids = a.bids.length ? `<details><summary>${a.bidCount} הצעות</summary><ul class="au-bids">
      ${a.bids.map(b => `<li class="${b.mine ? 'me' : ''}"><span>${esc(b.name)}</span><span>${shekel(b.amount)} · ${esc(when(b.at).replace(/^היום ב-/, ''))}</span></li>`).join('')}</ul></details>` : '';
  const tools = isManager() ? `<div class="au-tools">
      ${live ? `<button class="btn sec" type="button" data-act="bidFor" data-id="${a._id}">הצעה בשם…</button>` : ''}
      <button class="btn sec" type="button" data-act="edit" data-id="${a._id}">עריכה</button>
      ${p !== 'closing' ? `<button class="btn sec" type="button" data-act="closeNow" data-id="${a._id}">סגירה עכשיו</button>` : ''}
      <button class="btn danger" type="button" data-act="del" data-id="${a._id}" aria-label="מחיקת המכרז">×</button></div>` : '';
  return `<div class="card au${live ? ' live' : ''}">
    <div class="au-head"><h3>${esc(a.title)}</h3><span class="chip ${live ? 'pend' : p === 'scheduled' ? 'appr' : 'block'}">${live ? 'פתוח' : p === 'scheduled' ? 'טרם נפתח' : 'נסגר'}</span></div>
    <div class="au-clock" data-clock="${a._id}">${clockText(a)}</div>
    <div class="meta">${p === 'scheduled' ? 'נפתח ' + esc(when(a.opensAt)) + ' · ' : ''}נסגר ${esc(when(a.closesAt))} · קפיצה ${shekel(a.step)}</div>
    ${top}${bid}${bids}${tools}</div>`;
}

function closedHTML(){
  const list = S.data.closed;
  if (!list.length) return '';
  return `<div class="card" style="margin-top:22px"><h3>מכרזים שנסגרו</h3><div class="list">${list.map(a => `<div class="li"><div class="grow">
      <div class="t">${esc(a.title)} <span class="meta">· ${esc(dayInfo(a.dateKey).title)}</span></div>
      <div class="meta">${a.top ? `${esc(a.top.name)}${a.top.mine ? ' (את/ה)' : ''} · ${shekel(a.top.amount)}${a.recorded && isManager() ? ' · נרשם בקופה' : ''}` : 'לא היו הצעות'}</div></div>
      ${isManager() ? `<button class="btn danger" type="button" data-act="del" data-id="${a._id}" aria-label="מחיקה מהרשימה">×</button>` : ''}</div>`).join('')}</div></div>`;
}

/* ---------- Sheets ---------- */
function openSheet(html){ $('#sheet').innerHTML = html; $('#sheetWrap').hidden = false; }
function closeSheet(){ $('#sheetWrap').hidden = true; $('#sheet').innerHTML = ''; }
const sheetHead = (t, sub) => `<div class="sh"><div style="flex:1"><h2>${esc(t)}</h2>${sub ? `<div class="meta">${esc(sub)}</div>` : ''}</div><button class="x" data-act="close" aria-label="סגירה">×</button></div>`;
let toastT;
function toast(msg){ let t = document.querySelector('.toast'); if (!t){ t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); } t.textContent = msg; clearTimeout(toastT); toastT = setTimeout(() => t.remove(), 3200); }

/** ברירת מחדל: נפתח עכשיו, ונסגר ביום שישי שלפני השבת (או ערב החג) ב-12:00 */
function defaultTimes(dateKey){
  const now = Date.now(), close = addDays(pkey(dateKey), -1);
  close.setHours(12, 0, 0, 0);
  return { opensAt: now, closesAt: close.getTime() > now + 3600e3 ? close.getTime() : now + 24 * 3600e3 };
}

const timesHTML = (opensAt, closesAt, locked) => `<div class="au-2">
    <div><label class="f" for="fOpens">נפתח</label><input type="datetime-local" id="fOpens" value="${toLocalInput(opensAt)}"${locked ? ' disabled' : ''}></div>
    <div><label class="f" for="fCloses">נסגר</label><input type="datetime-local" id="fCloses" value="${toLocalInput(closesAt)}"></div></div>
  <p class="au-warn" id="holyWarn" hidden>שימו לב: המכרז פתוח או נסגר בשבת או בחג.</p>`;
const pricesHTML = (minBid, step, locked) => `<div class="au-2">
    <div><label class="f" for="fMin">מחיר פתיחה (₪)</label><input type="text" inputmode="numeric" id="fMin" value="${minBid}"${locked ? ' disabled' : ''}></div>
    <div><label class="f" for="fStep">קפיצת מחיר (₪)</label><input type="text" inputmode="numeric" id="fStep" value="${step}"${locked ? ' disabled' : ''}></div></div>`;

function itemsHTML(dateKey){
  const { seq } = dayInfo(dateKey), taken = new Set(S.data.active.filter(a => a.dateKey === dateKey).map(a => a.title));
  const box = n => `<label><input type="checkbox" name="item" value="${esc(n)}"${taken.has(n) ? ' disabled' : ''}>${esc(n)}${taken.has(n) ? ' ✓' : ''}</label>`;
  return `<div class="au-items">${seq.map(box).join('')}</div><div class="au-items">${HONORS.map(box).join('')}</div>
    <div class="row"><button class="link" type="button" data-act="allSeq">כל העליות</button><button class="link" type="button" data-act="noneSeq">ניקוי</button></div>`;
}

function addSheet(){
  const dateKey = nextSlotKey(addDays(today0(), -1)), t = defaultTimes(dateKey);
  openSheet(sheetHead('מכרז חדש') +
    `<label class="f" for="fDate">שבת או יום</label><input type="date" id="fDate" value="${dateKey}">
     <div class="meta" id="fDateTitle">${esc(dayInfo(dateKey).title)}</div>
     <label class="f">על מה המכרז</label><div id="itemsWrap">${itemsHTML(dateKey)}</div>
     <label class="f" for="fOther">כיבודים נוספים (לא חובה, מופרדים בפסיק)</label><input type="text" id="fOther" maxlength="200" placeholder="לדוגמה: חתן תורה, אתה הראית">
     ${timesHTML(t.opensAt, t.closesAt, false)}${pricesHTML(DEFAULT_MIN, DEFAULT_STEP, false)}
     <p class="small muted">לכל עלייה נפתח מכרז נפרד. בסגירה הזוכה נרשם בקופה כחוב פתוח, ובחלוקת העליות אם היא פעילה בקהילה.</p>
     <div class="row" style="margin-top:12px"><button class="btn" type="button" data-act="saveNew">פתיחת המכרז</button><button class="btn ghost" type="button" data-act="close">ביטול</button></div>`);
  checkHoly();
}

function editSheet(a){
  const locked = a.bidCount > 0;
  openSheet(sheetHead('עריכת מכרז', dayInfo(a.dateKey).title) +
    `<label class="f" for="fTitle">עלייה או כיבוד</label><input type="text" id="fTitle" maxlength="40" value="${esc(a.title)}">
     ${timesHTML(a.opensAt, a.closesAt, locked)}${pricesHTML(a.minBid, a.step, locked)}
     ${locked ? '<p class="small muted">יש כבר הצעות, ולכן אפשר לשנות רק את השם ואת שעת הסגירה.</p>' : ''}
     <div class="row" style="margin-top:12px"><button class="btn" type="button" data-act="saveEdit" data-id="${a._id}">שמירה</button><button class="btn ghost" type="button" data-act="close">ביטול</button></div>`);
  checkHoly();
}

function bidForSheet(a){
  const opts = S.data.members.map(m => `<option value="${m.userId}">${esc(m.name)}</option>`).join('');
  openSheet(sheetHead('הצעה בשם מישהו', `${a.title} · מינימום ${shekel(a.next)}`) +
    `<label class="f" for="fPerson">מי הציע</label><select id="fPerson"><option value="">— בחירה —</option>${opts}<option value="guest">אורח (שם חופשי)</option></select>
     <div id="guestWrap" hidden><label class="f" for="fName">שם האורח</label><input type="text" id="fName" maxlength="80"></div>
     <label class="f" for="fAmount">סכום (₪)</label><input type="text" inputmode="numeric" id="fAmount" value="${a.next}">
     <div class="row" style="margin-top:12px"><button class="btn" type="button" data-act="saveBidFor" data-id="${a._id}">רישום ההצעה</button><button class="btn ghost" type="button" data-act="close">ביטול</button></div>`);
}

function checkHoly(){
  const w = $('#holyWarn');
  if (w) w.hidden = !(onHoly(fromLocalInput($('#fOpens').value)) || onHoly(fromLocalInput($('#fCloses').value)));
}
const num = v => Number(String(v).replace(/[^\d.]/g, ''));
const find = id => S.data.active.find(a => a._id === id) || S.data.closed.find(a => a._id === id);

async function placeBid(id, amount, extra){
  const a = find(id);
  if (!a) return;
  if (!(amount >= a.next)) return toast(`ההצעה צריכה להיות לפחות ${shekel(a.next)}`);
  const who = extra && (extra.name || S.data.members.find(m => m.userId === extra.userId)?.name);
  if (!await SiteDialog.confirm(`${who ? who + ': ' : ''}להציע ${shekel(amount)} על ${a.title}?`, { ok: 'הצעה' })) return;
  await call('auctions:bid', { id, amount, ...(extra || {}) });
  toast(who ? 'ההצעה נרשמה' : 'ההצעה שלך נרשמה');
}

/* ---------- Actions ---------- */
const A = {
  signIn: () => Auth.signInWithGoogle(location.href).catch(() => {}),
  close: closeSheet,
  add: () => addSheet(),
  edit: d => { const a = find(d.id); if (a) editSheet(a); },
  bidFor: d => { const a = find(d.id); if (a) bidForSheet(a); },
  allSeq: () => document.querySelectorAll('#itemsWrap .au-items:first-child input:not(:disabled)').forEach(i => { i.checked = true; }),
  noneSeq: () => document.querySelectorAll('#itemsWrap input').forEach(i => { i.checked = false; }),
  bid: guard(async d => placeBid(d.id, Number(d.amount))),
  bidTyped: guard(async d => {
    const input = document.getElementById('amt-' + d.id), amount = num(input.value);
    if (!amount) return toast('נא לכתוב סכום');
    await placeBid(d.id, amount);
    input.value = '';
  }),
  saveBidFor: guard(async d => {
    const v = $('#fPerson').value;
    const extra = v === 'guest' ? { name: $('#fName').value.trim() } : v ? { userId: v } : null;
    if (!extra || (!extra.userId && !extra.name)) return toast('נא לבחור חבר קהילה או לכתוב שם');
    await placeBid(d.id, num($('#fAmount').value), extra);
    closeSheet();
  }),
  saveNew: guard(async () => {
    const dateKey = $('#fDate').value;
    if (!dateKey) return toast('נא לבחור תאריך');
    const titles = [...document.querySelectorAll('#itemsWrap input:checked')].map(i => i.value)
      .concat($('#fOther').value.split(/[,،]/).map(s => s.trim()).filter(Boolean));
    if (!titles.length) return toast('נא לבחור עלייה או כיבוד');
    await call('auctions:create', { dateKey, titles, opensAt: fromLocalInput($('#fOpens').value), closesAt: fromLocalInput($('#fCloses').value),
      minBid: num($('#fMin').value), step: num($('#fStep').value) });
    closeSheet(); toast(titles.length > 1 ? `נפתחו ${titles.length} מכרזים` : 'המכרז נפתח');
  }),
  saveEdit: guard(async d => {
    await call('auctions:update', { id: d.id, title: $('#fTitle').value, opensAt: fromLocalInput($('#fOpens').value), closesAt: fromLocalInput($('#fCloses').value),
      minBid: num($('#fMin').value), step: num($('#fStep').value) });
    closeSheet(); toast('נשמר');
  }),
  closeNow: guard(async d => {
    const a = find(d.id);
    if (!a || !await SiteDialog.confirm(a.top ? `לסגור עכשיו? ${a.top.name} יזכה ב${a.title} ב-${shekel(a.top.amount)}.` : `לסגור עכשיו את המכרז על ${a.title}? אין עדיין הצעות.`, { ok: 'סגירה' })) return;
    await call('auctions:closeNow', { id: d.id }); toast('המכרז נסגר');
  }),
  del: guard(async d => {
    const a = find(d.id);
    if (!a) return;
    const text = a.status === 'closed' && a.recorded ? 'למחוק את המכרז מהרשימה? החיוב בקופה והעלייה שנרשמו נשארים.' : `למחוק את המכרז על ${a.title}${a.bidCount ? ' ואת כל ההצעות' : ''}?`;
    if (!await SiteDialog.confirm(text, { ok: 'מחיקה', danger: true })) return;
    await call('auctions:remove', { id: d.id }); toast('נמחק');
  }),
};
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (t){ const f = A[t.dataset.act]; if (f){ e.preventDefault(); f(t.dataset, t); } return; }
  if (e.target === $('#sheetWrap')) closeSheet();
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'fDate' && t.value){ $('#fDateTitle').textContent = dayInfo(t.value).title; $('#itemsWrap').innerHTML = itemsHTML(t.value); const tm = defaultTimes(t.value); $('#fCloses').value = toLocalInput(tm.closesAt); checkHoly(); }
  else if (t.id === 'fOpens' || t.id === 'fCloses') checkHoly();
  else if (t.id === 'fPerson') $('#guestWrap').hidden = t.value !== 'guest';
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#sheetWrap').hidden) closeSheet();
  if (e.key === 'Enter' && e.target.matches('.au-bid input')) A.bidTyped({ id: e.target.id.slice(4) });
});

boot();
})();
