/* מכרז עליות – לשונית "מכרז" בדף חלוקת העליות (aliyot/js/app.js), חלק מאותו פיצ'ר.
 * הגבאי או הרב פותחים מכירה פומבית על עליות וכיבודים (שלישי, מפטיר, פתיחת הארון, גלילה, או כל שם אחר),
 * וקובעים ממתי עד מתי המכרז פתוח. חברי הקהילה מציעים, והלשונית מתעדכנת אצל כולם בזמן אמת (auctions:list).
 * בסגירה הזוכה נרשם בקופה כחוב פתוח ובחלוקת העליות (convex/auctions.ts).
 * ההודעות הצדדיות על הצעות ("פלוני הציע ₪180 על שלישי") מוצגות בכל דף על ידי js/menu.js.
 * app.js קורא ל-init פעם אחת, ל-watch כשהקהילה מתחלפת, ול-html/beforeRender/afterRender כשהלשונית מוצגת.
 * הפעולות (data-act שמתחיל ב-au) נמצאות ב-actions, ו-app.js מפנה אליהן.
 */
(function(){
"use strict";
const { esc, dkey, pkey, gShort, heFull, slotFor } = window.KiddushCalendar || {};
const $ = s => document.querySelector(s);
const Auth = window.SiteAuth;
const HONORS = ['פתיחת הארון', 'הוצאת ספר תורה', 'הגבהה', 'גלילה', 'הכנסת ספר תורה'];
const DEFAULT_MIN = 18, DEFAULT_STEP = 10;

/* מ-app.js: call, guard, toast, openSheet, closeSheet, sheetHead, dayInfo, nextSlotKey, il, render, active (הלשונית מוצגת) */
let X = null;
const S = { sid: null, data: null, error: null };
const isManager = () => !!S.data?.manager;

function today0(){ if (window.SiteTheme?.hebToday) return window.SiteTheme.hebToday(); const d = new Date(); d.setHours(0,0,0,0); return d; }
function addDays(d, n){ const x = new Date(d); x.setDate(x.getDate() + n); return x; }
const shekel = n => '₪' + Math.round(n).toLocaleString('he-IL');

let unsub = null;
function watch(sid){
  if (sid === S.sid && (unsub || !sid)) return;
  if (unsub) unsub();
  unsub = null;
  S.sid = sid; S.data = null; S.error = null;
  if (!sid) return;
  unsub = Auth.watch('auctions:list', { synagogueId: sid }, data => { S.data = data; X.render(); },
    e => { console.warn(e); S.error = (e && typeof e.data === 'string') ? e.data : 'לא ניתן לטעון את המכרזים'; X.render(); });
}

/* ---------- Times ---------- */
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
  const d = new Date(ms), sl = slotFor(dkey(d), X.il());
  if (d.getDay() === 6 || sl.isChag) return true;
  const tomorrow = slotFor(dkey(addDays(d, 1)), X.il());
  return (d.getDay() === 5 || tomorrow.isChag) && d.getHours() >= 16;
}

/* ---------- Render ---------- */
let lastPhases = '', typed = {}, focused = null;
const tops = new Map();

/** מספר המכרזים הפתוחים, לתג על הלשונית */
function openCount(){ return S.data ? S.data.active.filter(a => phase(a) === 'open').length : 0; }

/* ההקלדה בשדות הסכום נשמרת כשהדף מתעדכן מהשרת באמצע */
function beforeRender(){
  typed = {}; focused = document.activeElement?.id;
  document.querySelectorAll('.au-bid input').forEach(i => { if (i.value) typed[i.id] = i.value; });
}
function afterRender(){
  for (const [id, v] of Object.entries(typed)){ const i = document.getElementById(id); if (i) i.value = v; }
  if (focused){ const i = document.getElementById(focused); if (i && i.matches('.au-bid input')) i.focus(); }
  if (!S.data) return;
  // הבהוב כשהמחיר עולה
  for (const a of S.data.active){
    const before = tops.get(a._id), now = a.top ? a.top.amount : 0;
    if (before !== undefined && now > before) document.querySelector(`[data-top="${a._id}"]`)?.classList.add('bump');
    tops.set(a._id, now);
  }
  lastPhases = S.data.active.map(a => phase(a)).join();
}

/* כל שנייה: השעונים מתעדכנים במקום, ובמעבר בין פתוח לסגור הלשונית נבנית מחדש */
function tick(){
  if (!S.data || !X.active()) return;
  if (S.data.active.map(a => phase(a)).join() !== lastPhases) return X.render();
  document.querySelectorAll('[data-clock]').forEach(el => {
    const a = S.data.active.find(x => x._id === el.dataset.clock);
    if (a) el.textContent = clockText(a);
  });
}

function html(){
  if (S.error && !S.data) return `<div class="card"><p class="muted" style="margin:0">${esc(S.error)}</p></div>`;
  if (!S.data) return '<div class="empty">טוען…</div>';
  return (isManager() ? '<div class="row" style="justify-content:flex-end;margin-bottom:10px"><button class="btn" type="button" data-act="auAdd">+ מכרז חדש</button></div>' : '')
    + activeHTML() + closedHTML();
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
  return groups.map(({ k, list }) => `<h2 class="au-day">${esc(X.dayInfo(k).title)} <span class="meta">${esc(heFull(X.dayInfo(k).sl.hd))}</span></h2>
    <div class="au-grid">${list.map(auctionHTML).join('')}</div>`).join('');
}

function auctionHTML(a){
  const p = phase(a), live = p === 'open';
  const top = a.top
    ? `<div class="au-top${a.top.mine ? ' mine' : ''}" data-top="${a._id}"><b>${shekel(a.top.amount)}</b><span>${esc(a.top.name)}${a.top.forName ? ' · עבור ' + esc(a.top.forName) : ''}${a.top.mine ? ' · ההצעה שלך מובילה' : ''}</span></div>`
    : `<div class="au-top" data-top="${a._id}"><span class="meta">מחיר פתיחה</span><b>${shekel(a.minBid)}</b></div>`;
  const quick = [a.next, a.next + a.step, a.next + a.step * 4];
  const bid = live && !(a.top && a.top.mine) ? `<div class="au-bid">
      ${quick.map(n => `<button class="btn sec" type="button" data-act="auBid" data-id="${a._id}" data-amount="${n}">${shekel(n)}</button>`).join('')}
      <input type="text" inputmode="numeric" id="amt-${a._id}" placeholder="סכום אחר" aria-label="סכום אחר על ${esc(a.title)}">
      <button class="btn" type="button" data-act="auBidTyped" data-id="${a._id}">הצעה</button></div>` : '';
  const bids = a.bids.length ? `<details><summary>${a.bidCount} הצעות</summary><ul class="au-bids">
      ${a.bids.map(b => `<li class="${b.mine ? 'me' : ''}"><span>${esc(b.name)}${b.forName ? ' · עבור ' + esc(b.forName) : ''}</span><span>${shekel(b.amount)} · ${esc(when(b.at).replace(/^היום ב-/, ''))}</span></li>`).join('')}</ul></details>` : '';
  const forOther = live ? `<div class="au-tools"><button class="btn ghost" type="button" data-act="auBidFor" data-id="${a._id}">הצעה כדי שמישהו אחר יעלה…</button></div>` : '';
  const tools = isManager() ? `<div class="au-tools">
      <button class="btn sec" type="button" data-act="auEdit" data-id="${a._id}">עריכה</button>
      ${p !== 'closing' ? `<button class="btn sec" type="button" data-act="auCloseNow" data-id="${a._id}">סגירה עכשיו</button>` : ''}
      <button class="btn danger" type="button" data-act="auDel" data-id="${a._id}" aria-label="מחיקת המכרז">×</button></div>` : '';
  return `<div class="card au${live ? ' live' : ''}">
    <div class="au-head"><h3>${esc(a.title)}</h3><span class="chip ${live ? 'pend' : p === 'scheduled' ? 'appr' : 'block'}">${live ? 'פתוח' : p === 'scheduled' ? 'טרם נפתח' : 'נסגר'}</span></div>
    <div class="au-clock" data-clock="${a._id}">${clockText(a)}</div>
    <div class="meta">${p === 'scheduled' ? 'נפתח ' + esc(when(a.opensAt)) + ' · ' : ''}נסגר ${esc(when(a.closesAt))} · קפיצה ${shekel(a.step)}</div>
    ${top}${bid}${forOther}${bids}${tools}</div>`;
}

function closedHTML(){
  const list = S.data.closed;
  if (!list.length) return '';
  return `<div class="card" style="margin-top:22px"><h3>מכרזים שנסגרו</h3><div class="list">${list.map(a => `<div class="li"><div class="grow">
      <div class="t">${esc(a.title)} <span class="meta">· ${esc(X.dayInfo(a.dateKey).title)}</span></div>
      <div class="meta">${a.top ? `${esc(a.top.name)}${a.top.forName ? ' · עבור ' + esc(a.top.forName) : ''}${a.top.mine ? ' (את/ה)' : ''} · ${shekel(a.top.amount)}${a.recorded && isManager() ? ' · נרשם בקופה ובחלוקה' : ''}` : 'לא היו הצעות'}</div></div>
      ${isManager() ? `<button class="btn danger" type="button" data-act="auDel" data-id="${a._id}" aria-label="מחיקה מהרשימה">×</button>` : ''}</div>`).join('')}</div></div>`;
}

/* ---------- Sheets ---------- */
/** ברירת מחדל: נפתח עכשיו, ונסגר ביום שישי שלפני השבת (או ערב החג) ב-12:00 */
function defaultTimes(dateKey){
  const now = Date.now(), close = addDays(pkey(dateKey), -1);
  close.setHours(12, 0, 0, 0);
  return { opensAt: now, closesAt: close.getTime() > now + 3600e3 ? close.getTime() : now + 24 * 3600e3 };
}

const timesHTML = (opensAt, closesAt, locked) => `<div class="au-2">
    <div><label class="f" for="auOpens">נפתח</label><input type="datetime-local" id="auOpens" value="${toLocalInput(opensAt)}"${locked ? ' disabled' : ''}></div>
    <div><label class="f" for="auCloses">נסגר</label><input type="datetime-local" id="auCloses" value="${toLocalInput(closesAt)}"></div></div>
  <p class="au-warn" id="auHolyWarn" hidden>שימו לב: המכרז פתוח או נסגר בשבת או בחג.</p>`;
const pricesHTML = (minBid, step, locked) => `<div class="au-2">
    <div><label class="f" for="auMin">מחיר פתיחה (₪)</label><input type="text" inputmode="numeric" id="auMin" value="${minBid}"${locked ? ' disabled' : ''}></div>
    <div><label class="f" for="auStep">קפיצת מחיר (₪)</label><input type="text" inputmode="numeric" id="auStep" value="${step}"${locked ? ' disabled' : ''}></div></div>`;

/* כיבודים נוספים שהגבאי הוסיף: נשמרים במכשיר ומוצעים בכל מכרז חדש, עד שמוחקים אותם */
const CUSTOM_KEY = 'auctionCustomHonors';
function loadCustom(){
  try { const v = JSON.parse(localStorage.getItem(CUSTOM_KEY)); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []; } catch { return []; }
}
function saveCustom(list){ try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); } catch {} }

function itemsHTML(dateKey, checked = new Set()){
  const { seq } = X.dayInfo(dateKey), taken = new Set(S.data.active.filter(a => a.dateKey === dateKey).map(a => a.title));
  const box = (n, del) => `<label><input type="checkbox" name="auItem" value="${esc(n)}"${taken.has(n) ? ' disabled' : checked.has(n) ? ' checked' : ''}>${esc(n)}${taken.has(n) ? ' ✓' : ''}${del ? `<button class="link" type="button" data-act="auDelCustom" data-name="${esc(n)}" aria-label="מחיקת ${esc(n)} מהרשימה">×</button>` : ''}</label>`;
  const custom = loadCustom().filter(n => !seq.includes(n) && !HONORS.includes(n));
  return `<div class="au-items" id="auSeq">${seq.map(n => box(n)).join('')}</div><div class="au-items">${HONORS.map(n => box(n)).join('')}${custom.map(n => box(n, true)).join('')}</div>
    <div class="row"><input type="text" id="auOther" maxlength="40" placeholder="כיבוד נוסף, לדוגמה: חתן תורה"><button class="btn ghost" type="button" data-act="auAddCustom">הוספה</button></div>
    <div class="row"><button class="link" type="button" data-act="auAllSeq">כל העליות</button><button class="link" type="button" data-act="auNone">ניקוי</button></div>`;
}

function addSheet(dateKey){
  const t = defaultTimes(dateKey);
  X.openSheet(X.sheetHead('מכרז חדש') +
    `<label class="f" for="auDate">שבת או יום</label><input type="date" id="auDate" value="${dateKey}">
     <div class="meta" id="auDateTitle">${esc(X.dayInfo(dateKey).title)}</div>
     <label class="f">על מה המכרז</label><div id="auItemsWrap">${itemsHTML(dateKey)}</div>
     ${timesHTML(t.opensAt, t.closesAt, false)}${pricesHTML(DEFAULT_MIN, DEFAULT_STEP, false)}
     <p class="small muted">לכל עלייה נפתח מכרז נפרד. בסגירה הזוכה נרשם בחלוקת העליות של אותו יום, ובקופה כחוב פתוח.</p>
     <div class="row" style="margin-top:12px"><button class="btn" type="button" data-act="auSaveNew">פתיחת המכרז</button><button class="btn ghost" type="button" data-act="close">ביטול</button></div>`);
  checkHoly();
}

function editSheet(a){
  const locked = a.bidCount > 0;
  X.openSheet(X.sheetHead('עריכת מכרז', X.dayInfo(a.dateKey).title) +
    `<label class="f" for="auTitle">עלייה או כיבוד</label><input type="text" id="auTitle" maxlength="40" value="${esc(a.title)}">
     ${timesHTML(a.opensAt, a.closesAt, locked)}${pricesHTML(a.minBid, a.step, locked)}
     ${locked ? '<p class="small muted">יש כבר הצעות, ולכן אפשר לשנות רק את השם ואת שעת הסגירה.</p>' : ''}
     <div class="row" style="margin-top:12px"><button class="btn" type="button" data-act="auSaveEdit" data-id="${a._id}">שמירה</button><button class="btn ghost" type="button" data-act="close">ביטול</button></div>`);
  checkHoly();
}

function bidForSheet(a){
  const opts = S.data.members.map(m => `<label class="au-person" data-n="${esc(m.name)}"><input type="radio" name="auWho" value="${m.userId}"> ${esc(m.name)}</label>`).join('');
  X.openSheet(X.sheetHead('הצעה כדי שמישהו אחר יעלה', `${a.title} · מינימום ${shekel(a.next)}`) +
    `<p class="small muted">ההצעה נרשמת על שמך, ואתה המשלם. בקהילה יופיע שמך בלבד; הגבאי והרב יראו עבור מי ביקשת שיעלה.</p>
     <label class="f" for="auSearch">מי יעלה? חיפוש חבר קהילה</label><input type="search" id="auSearch" placeholder="הקלד שם" autocomplete="off">
     <div class="au-people" style="max-height:240px;overflow:auto;margin:8px 0">${opts}
       <label class="au-person"><input type="radio" name="auWho" value="guest"> אורח (שם חופשי)</label></div>
     <div id="auGuestWrap" hidden><label class="f" for="auName">שם האורח</label><input type="text" id="auName" maxlength="80"></div>
     <label class="f" for="auAmount">סכום (₪)</label><input type="text" inputmode="numeric" id="auAmount" value="${a.next}">
     <div class="row" style="margin-top:12px"><button class="btn" type="button" data-act="auSaveBidFor" data-id="${a._id}">רישום ההצעה</button><button class="btn ghost" type="button" data-act="close">ביטול</button></div>`);
}

function checkHoly(){
  const w = $('#auHolyWarn');
  if (w) w.hidden = !(onHoly(fromLocalInput($('#auOpens').value)) || onHoly(fromLocalInput($('#auCloses').value)));
}
/** בונה מחדש את בחירת העליות והכיבודים ושומר על הסימונים; extra – כיבוד שנוסף עכשיו ומסומן */
function refreshItems(extra){
  const checked = new Set([...document.querySelectorAll('#auItemsWrap input:checked')].map(i => i.value));
  if (extra) checked.add(extra);
  $('#auItemsWrap').innerHTML = itemsHTML($('#auDate').value, checked);
}
const num = v => Number(String(v).replace(/[^\d.]/g, ''));
const find = id => S.data && (S.data.active.find(a => a._id === id) || S.data.closed.find(a => a._id === id));

async function placeBid(id, amount, extra){
  const a = find(id);
  if (!a) return;
  if (!(amount >= a.next)) return X.toast(`ההצעה צריכה להיות לפחות ${shekel(a.next)}`);
  const who = extra && (extra.forName || S.data.members.find(m => m.userId === extra.forUserId)?.name);
  if (!await SiteDialog.confirm(`להציע ${shekel(amount)} על ${a.title}${who ? ', כדי ש' + who + ' יעלה' : ''}?`, { ok: 'הצעה' })) return false;
  await X.call('auctions:bid', { id, amount, ...(extra || {}) });
  X.toast('ההצעה שלך נרשמה');
  return true;
}

/* ---------- Actions ---------- */
function makeActions(){
  const { guard, call, toast, closeSheet } = X;
  return {
    auAdd: () => addSheet(X.dateKey() >= dkey(today0()) ? X.dateKey() : X.nextSlotKey(addDays(today0(), -1))),
    auEdit: d => { const a = find(d.id); if (a) editSheet(a); },
    auBidFor: d => { const a = find(d.id); if (a) bidForSheet(a); },
    auSaveBidFor: guard(async d => {
      const v = document.querySelector('input[name="auWho"]:checked')?.value;
      const extra = v === 'guest' ? { forName: $('#auName').value.trim() } : v ? { forUserId: v } : null;
      if (!extra || (!extra.forUserId && !extra.forName)) return toast('נא לבחור מי יעלה: חבר קהילה או אורח');
      if (await placeBid(d.id, num($('#auAmount').value), extra)) closeSheet();
    }),
    auAllSeq: () => document.querySelectorAll('#auSeq input:not(:disabled)').forEach(i => { i.checked = true; }),
    auAddCustom: () => {
      const name = $('#auOther').value.trim().replace(/\s+/g, ' ');
      if (!name) return toast('נא לכתוב את שם הכיבוד');
      const list = loadCustom();
      if (!list.includes(name) && !HONORS.includes(name)) saveCustom(list.concat(name));
      refreshItems(name);
    },
    auDelCustom: d => { saveCustom(loadCustom().filter(n => n !== d.name)); refreshItems(); },
    auNone: () => document.querySelectorAll('#auItemsWrap input').forEach(i => { i.checked = false; }),
    auBid: guard(async d => placeBid(d.id, Number(d.amount))),
    auBidTyped: guard(async d => {
      const input = document.getElementById('amt-' + d.id), amount = num(input.value);
      if (!amount) return toast('נא לכתוב סכום');
      if (await placeBid(d.id, amount)) input.value = '';
    }),
    auSaveNew: guard(async () => {
      const dateKey = $('#auDate').value;
      if (!dateKey) return toast('נא לבחור תאריך');
      const titles = [...document.querySelectorAll('#auItemsWrap input:checked')].map(i => i.value);
      if (!titles.length) return toast('נא לבחור עלייה או כיבוד');
      await call('auctions:create', { dateKey, titles, opensAt: fromLocalInput($('#auOpens').value), closesAt: fromLocalInput($('#auCloses').value),
        minBid: num($('#auMin').value), step: num($('#auStep').value) });
      closeSheet(); toast(titles.length > 1 ? `נפתחו ${titles.length} מכרזים` : 'המכרז נפתח');
    }),
    auSaveEdit: guard(async d => {
      await call('auctions:update', { id: d.id, title: $('#auTitle').value, opensAt: fromLocalInput($('#auOpens').value), closesAt: fromLocalInput($('#auCloses').value),
        minBid: num($('#auMin').value), step: num($('#auStep').value) });
      closeSheet(); toast('נשמר');
    }),
    auCloseNow: guard(async d => {
      const a = find(d.id);
      if (!a || !await SiteDialog.confirm(a.top ? `לסגור עכשיו? ${a.top.name} יזכה ב${a.title} ב-${shekel(a.top.amount)}.` : `לסגור עכשיו את המכרז על ${a.title}? אין עדיין הצעות.`, { ok: 'סגירה' })) return;
      await call('auctions:closeNow', { id: d.id }); toast('המכרז נסגר');
    }),
    auDel: guard(async d => {
      const a = find(d.id);
      if (!a) return;
      const text = a.status === 'closed' && a.recorded ? 'למחוק את המכרז מהרשימה? החיוב בקופה והעלייה שנרשמו נשארים.' : `למחוק את המכרז על ${a.title}${a.bidCount ? ' ואת כל ההצעות' : ''}?`;
      if (!await SiteDialog.confirm(text, { ok: 'מחיקה', danger: true })) return;
      await call('auctions:remove', { id: d.id }); toast('נמחק');
    }),
  };
}

const api = { watch, html, beforeRender, afterRender, openCount, actions: {} };
api.init = deps => {
  X = deps;
  api.actions = makeActions();
  setInterval(tick, 1000);
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'auDate' && t.value){
      $('#auDateTitle').textContent = X.dayInfo(t.value).title;
      refreshItems();
      $('#auCloses').value = toLocalInput(defaultTimes(t.value).closesAt);
      checkHoly();
    } else if (t.id === 'auOpens' || t.id === 'auCloses') checkHoly();
    else if (t.name === 'auWho') $('#auGuestWrap').hidden = t.value !== 'guest';  });
  document.addEventListener('input', e => {
    if (e.target.id !== 'auSearch') return;
    const q = e.target.value.trim();
    document.querySelectorAll('.au-people .au-person[data-n]').forEach(l => { l.hidden = !!q && !l.dataset.n.includes(q); });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.id === 'auOther'){ e.preventDefault(); api.actions.auAddCustom(); }
    else if (e.key === 'Enter' && e.target.matches('.au-bid input')) api.actions.auBidTyped({ id: e.target.id.slice(4) });
  });
};
window.AliyotAuctions = api;
})();
