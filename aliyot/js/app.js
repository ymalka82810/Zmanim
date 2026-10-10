/* חלוקת עליות: הגבאי או הרב רושמים מי עלה ומתי, ומקבלים הצעה למי לתת עלייה בשבת הקרובה:
 * קודם החיובים (חתן, בר מצווה, אבי הבן/הבת, אזכרה בשבוע הקרוב מלוח האזכרות), ואחריהם מי שלא עלה הכי הרבה זמן,
 * בנפרד לכהנים, ללויים ולישראלים. עלייה שנמכרה אפשר לרשום מכאן גם כחיוב בקופה (fund:save).
 * חבר קהילה רואה את העליות שלו, מסמן אם הוא כהן או לוי, ורושם חיוב לעצמו (למשל בר מצווה של הבן).
 * הנתונים מגיעים מ-aliyot:board. הלשונית "מכרז" (מכירה פומבית של עליות וכיבודים) נמצאת ב-aliyot/js/auctions.js.
 */
(function(){
"use strict";
const { H, esc, dkey, pkey, gShort, gFull, heFull, getSlots, slotFor, slotTitle } = window.KiddushCalendar || {};
const $ = s => document.querySelector(s);
const Auth = window.SiteAuth;
const Auctions = window.AliyotAuctions;
const ROLE_LABEL = { gabbai: 'גבאי', rabbi: 'רב', member: 'חבר קהילה' };
const TRIBE_LABEL = { kohen: 'כהן', levi: 'לוי', israel: 'ישראל' };
const ACCOUNT_URL = '../account/';
/** סדר העליות לפי סוג היום, והכיבודים שאפשר להוסיף בכל יום */
const SEQ_SHABBAT = ['כהן', 'לוי', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שביעי', 'מפטיר'];
const SEQ_CHAG = ['כהן', 'לוי', 'שלישי', 'רביעי', 'חמישי', 'מפטיר'];
const SEQ_WEEKDAY = ['כהן', 'לוי', 'ישראל'];
const SEQ_FOUR = ['כהן', 'לוי', 'שלישי', 'רביעי'];
const SEQ_YK = ['כהן', 'לוי', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'מפטיר'];
const HONORS = ['הוספה', 'פתיחת הארון', 'הגבהה', 'גלילה'];
/** שמות המצוות ברשימה של הקופה (gabbai/index.html); עלייה אחרת נרשמת שם כ"עלייה לתורה" */
const FUND_MITZVOT = ['שלישי', 'שישי', 'מפטיר', 'פתיחת הארון', 'הגבהה', 'גלילה'];
const ICON = {
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg>',
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m15 6-6 6 6 6"/></svg>',
};

/* היום לפי המנהג העברי: אחרי השקיעה כבר מתחיל היום הבא (js/theme.js) */
function today0(){ if (window.SiteTheme?.hebToday) return window.SiteTheme.hebToday(); const d = new Date(); d.setHours(0,0,0,0); return d; }
function addDays(d, n){ const x = new Date(d); x.setDate(x.getDate() + n); return x; }

const ALL_KEY = 'aliyot:allDays';
const S = {
  all: (() => { try { return localStorage.getItem(ALL_KEY) === '1'; } catch(e){ return false; } })(),
  ready: false, fatal: null, signedIn: false, synagogues: [], sid: null,
  dateKey: null, data: null, error: null,
  // הודעה צדדית על מכרז (js/menu.js) מובילה ל-?view=auction
  view: new URLSearchParams(location.search).get('view') === 'auction' ? 'auction' : 'day',
};
const isManager = () => !!S.data?.manager;
/* הפיצ'ר פעיל בקהילה (convex/features.ts). בלי אישור של כל הגבאים והרב הדף לא זמין */
const featureOn = sid => !!S.synagogues.find(s => s._id === sid)?.features?.includes('aliyot');


/* ---------- Boot & data ---------- */
async function boot(){
  if (!H || !window.KiddushCalendar){ S.fatal = 'לא ניתן לטעון את לוח השנה העברי. רעננו את העמוד.'; return render(); }
  S.dateKey = stepKey(addDays(today0(), -1), 1);
  render();
  try { await Auth.completeSignInFromRedirect(); } catch(e){ console.warn(e); }
  Auth.onChange(() => { S.signedIn = Auth.isAuthenticated(); loadSynagogues(); });
  S.signedIn = Auth.isAuthenticated();
  await loadSynagogues();
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

let unsub = null, watching = '';
function attach(sid){
  const key = sid ? sid + '|' + S.dateKey : '';
  if (key === watching && unsub) return;
  if (unsub) unsub();
  unsub = null; watching = key;
  // בהחלפת תאריך הנתונים הקודמים נשארים עד שהחדשים מגיעים, כדי שהדף לא יהבהב
  if (sid !== S.sid){ S.data = null; }
  S.sid = sid; S.error = null;
  Auctions.watch(sid && featureOn(sid) ? sid : null);
  if (!sid || !featureOn(sid)) return;
  unsub = Auth.watch('aliyot:board', { synagogueId: sid, dateKey: S.dateKey }, data => { S.data = data; render(); },
    e => { console.warn(e); S.error = errMsg(e); render(); });
}
function setDate(k){ if (!k || k === S.dateKey) return; S.dateKey = k; attach(S.sid); render(); }

function errMsg(e){ return (e && typeof e.data === 'string') ? e.data : 'הפעולה לא נשמרה. נסו שוב.'; }
async function call(name, args){ return await Auth.client().mutation(name, { synagogueId: S.sid, ...args }); }
function guard(fn){ return async (...a) => { try { await fn(...a); } catch(e){ console.warn(e); toast(errMsg(e)); } }; }

/* ---------- Dates ---------- */
const il = () => S.data ? !!S.data.synagogue.il : true;
/** השבת או החג הבאים אחרי התאריך */
function nextSlotKey(d){ const s = getSlots(addDays(d, 1), addDays(d, 60), il()); return s.length ? s[0].key : dkey(addDays(d, 1)); }
function prevSlotKey(d){ const s = getSlots(addDays(d, -60), addDays(d, -1), il()); return s.length ? s[s.length - 1].key : dkey(addDays(d, -1)); }

/* מצב "כל ימי הקריאה" (גבאי ורב): בנוסף לשבתות וחגים, גם שני וחמישי, צומות, ראשי חודשים, חנוכה, פורים,
 * חול המועד וכל תאריך שנרשמו בו עליות */
const READ_FLAGS = H ? H.flags.CHAG | H.flags.MINOR_FAST | H.flags.MAJOR_FAST | H.flags.ROSH_CHODESH | H.flags.CHOL_HAMOED : 0;
const evCache = new Map();
/** שם היום (צום, ראש חודש, חנוכה…) לפי תאריך, לימים שיש להם אירוע */
function readingEvents(start, end){
  const ck = dkey(start) + '|' + dkey(end) + '|' + il();
  if (evCache.has(ck)) return evCache.get(ck);
  const by = {};
  for (const e of H.HebrewCalendar.calendar({ start, end, il: il(), noModern: true })){
    if (!(e.getFlags() & READ_FLAGS) && !/^(Chanukah|Purim$)/.test(e.getDesc())) continue;
    (by[dkey(e.getDate().greg())] ||= []).push(e.render('he-x-NoNikud').replace(/\s*\d{4}$/, ''));
  }
  evCache.set(ck, by);
  return by;
}
/** היום הבא (dir=1) או הקודם (dir=-1) לתאריך, לפי המצב הנבחר */
function stepKey(d, dir){
  if (!S.all) return dir > 0 ? nextSlotKey(d) : prevSlotKey(d);
  const from = dir > 0 ? addDays(d, 1) : addDays(d, -60), to = dir > 0 ? addDays(d, 60) : addDays(d, -1), ev = readingEvents(from, to);
  const keys = new Set((S.data?.aliyotDates || []).filter(k => dir > 0 ? k > dkey(d) : k < dkey(d)));
  for (let x = new Date(from); x <= to; x.setDate(x.getDate() + 1)){ const k = dkey(x); if (ev[k] || [1, 4, 6].includes(x.getDay())) keys.add(k); }
  const sorted = [...keys].sort();
  return (dir > 0 ? sorted[0] : sorted[sorted.length - 1]) || dkey(addDays(d, dir));
}
/** סדר העליות לפי סוג היום: שבת 7 ומפטיר, יום טוב 5 ומפטיר, יום כיפור 6 ומפטיר, חול המועד וראש חודש 4, שאר הימים 3 */
function seqFor(d, sl){
  if (d.getDay() === 6) return SEQ_SHABBAT;
  if (sl.isChag) return SEQ_CHAG;
  const evs = H.HebrewCalendar.calendar({ start: d, end: d, il: il(), noModern: true });
  if (evs.some(e => e.getDesc() === 'Yom Kippur')) return SEQ_YK;
  if (evs.some(e => e.getFlags() & (H.flags.CHOL_HAMOED | H.flags.ROSH_CHODESH))) return SEQ_FOUR;
  return SEQ_WEEKDAY;
}
function dayInfo(k){
  const sl = slotFor(k, il()), d = pkey(k);
  const seq = seqFor(d, sl);
  const label = sl.kind ? '' : (readingEvents(d, d)[k] || [])[0];
  const wd = 'יום ' + 'אבגדהוש'[d.getDay()] + '׳';
  return { sl, d, seq, title: sl.kind ? slotTitle(sl) : label ? label + ', ' + wd : gFull(d).replace(/ \d{4}$/, '') + ', ' + wd };
}
function ago(k){
  if (!k) return 'לא עלה עדיין';
  const weeks = Math.round((pkey(S.dateKey) - pkey(k)) / (7 * 864e5));
  return weeks < 1 ? 'עלה השבוע' : weeks === 1 ? 'עלה לפני שבוע' : weeks < 9 ? `עלה לפני ${weeks} שבועות` : `עלה לאחרונה ב-${gShort(pkey(k))}.${pkey(k).getFullYear() % 100}`;
}

/* ---------- Render ---------- */
function hero(text, button){ return `<div class="hero"><h1>חלוקת עליות</h1><p class="muted">${text}</p></div>${button || ''}`; }

function render(){
  const app = $('#app');
  if (S.fatal){ app.innerHTML = hero(esc(S.fatal)); return; }
  if (!S.ready){ app.innerHTML = '<div class="empty">טוען…</div>'; return; }
  if (!S.signedIn){ app.innerHTML = hero('כדי לראות את חלוקת העליות יש להתחבר עם חשבון Google.', '<button class="btn btn-google" data-act="signIn">כניסה עם Google</button>'); return; }
  if (!S.sid){ app.innerHTML = hero('עדיין לא הצטרפת לקהילה. אפשר להצטרף דרך הזמנה מהגבאי או לפתוח קהילה חדשה.', `<a class="btn" href="${ACCOUNT_URL}">לחשבון שלי</a>`); return; }
  if (!featureOn(S.sid)){ app.innerHTML = hero('חלוקת העליות אינה פעילה בקהילה זו. כדי להשתמש בה, כל הגבאים והרב צריכים לאשר אותה ב"החשבון שלי", בפרטי הקהילה.', `<a class="btn" href="${ACCOUNT_URL}">לחשבון שלי</a>`); return; }
  if (S.error && !S.data){ app.innerHTML = hero(esc(S.error), `<a class="btn" href="${ACCOUNT_URL}">לחשבון שלי</a>`); return; }
  if (!S.data){ app.innerHTML = '<div class="empty">טוען…</div>'; return; }
  const auction = S.view === 'auction';
  if (auction) Auctions.beforeRender();
  app.innerHTML = headerHTML() + segHTML() + (auction ? Auctions.html() : isManager() ? managerHTML() : memberHTML());
  if (auction) Auctions.afterRender();
}

function segHTML(){
  const n = Auctions.openCount();
  const tab = (v, label) => `<button type="button" data-act="view" data-v="${v}" aria-pressed="${S.view === v}">${label}</button>`;
  const tabs = isManager()
    ? tab('day', 'חלוקה') + tab('auction', 'מכרז' + (n ? ` (${n})` : '')) + tab('history', 'היסטוריה') + tab('tribes', 'כהנים ולויים')
    : tab('day', 'העליות שלי') + tab('auction', 'מכרז' + (n ? ` (${n})` : ''));
  return `<div class="al-seg"><div class="seg" role="group">${tabs}</div></div>`;
}

function headerHTML(){
  const s = S.data.synagogue;
  if (window.SiteMenu) SiteMenu.setCommunity({ _id: S.sid, name: s.name, il: s.il });
  return `<header class="top">
    <div class="shul"><h1>חלוקת עליות</h1><small>${esc(s.name)} | ${ROLE_LABEL[S.data.role]}</small></div>
  </header>`;
}

function dateBarHTML(){
  const { title, sl } = dayInfo(S.dateKey);
  return `<div class="monthbar">
    <button class="nav" type="button" data-act="prev" aria-label="${S.all ? 'היום הקודם' : 'השבת הקודמת'}">${ICON.right}</button>
    <div class="title"><h2>${esc(title)}</h2><div class="alt">${esc(heFull(sl.hd) + ' | ' + gFull(pkey(S.dateKey)))}</div></div>
    <button class="nav" type="button" data-act="next" aria-label="${S.all ? 'היום הבא' : 'השבת הבאה'}">${ICON.left}</button>
  </div>
  <div class="al-date"><button class="btn ${S.all ? '' : 'sec'}" type="button" data-act="toggleAll" aria-pressed="${S.all}">ימי חול, צומות וכל תאריך עם עליות: ${S.all ? 'מוצג' : 'מוסתר'}</button></div>
  <div class="al-date"><button class="link" type="button" data-act="upcoming">${S.all ? 'היום הקרוב' : 'השבת הקרובה'}</button>
    <label class="small muted" for="pickDate">או יום אחר:</label><input type="date" id="pickDate" value="${S.dateKey}"></div>`;
}

function managerHTML(){
  if (S.view === 'history') return historyHTML();
  if (S.view === 'tribes') return tribesHTML();
  return dateBarHTML() + chiyuvimHTML() + givenHTML() + suggestionsHTML();
}

function chiyuvimHTML(){
  const list = S.data.chiyuvim;
  const rows = list.map(c => `<div class="li"><div class="grow">
      <div class="t">${esc(c.name)} <span class="chip ${c.given ? 'done' : 'pend'}">${esc(c.reasonLabel)}${c.given ? ' · קיבל עלייה' : ''}</span></div>
      <div class="meta">${c.source === 'yahrzeit' ? 'מלוח האזכרות · ' + esc(gShort(pkey(c.dateKey))) + (c.note ? ' · ' + esc(c.note) : '') : esc(c.note || '')}</div></div>
      ${c.given ? '' : `<button class="btn sec" type="button" data-act="give" data-u="${c.userId || ''}" data-n="${esc(c.name)}" data-r="${c.reason}">מתן עלייה</button>`}
      ${c.claimId ? `<button class="btn danger" type="button" data-act="delClaim" data-id="${c.claimId}" aria-label="מחיקת החיוב">×</button>` : ''}</div>`).join('');
  return `<div class="card"><div class="sechead" style="margin:0 0 4px"><h3>חיובים</h3><button class="btn sec" type="button" data-act="addClaim">+ רישום חיוב</button></div>
    ${rows ? `<div class="list">${rows}</div>` : '<p class="small muted">אין חיובים רשומים לתאריך הזה. אזכרות מהשבוע הקרוב מופיעות כאן לבד.</p>'}</div>`;
}

function givenHTML(){
  const { seq } = dayInfo(S.dateKey), given = S.data.given, used = new Set();
  const line = (label, a) => a
    ? `<div class="al-row"><div class="nm">${esc(label)}</div><div class="who"><div class="t">${esc(a.name)}</div>${a.reasonLabel ? `<div class="meta">${esc(a.reasonLabel)}</div>` : ''}</div>
        <button class="btn danger" type="button" data-act="delAliyah" data-id="${a._id}" aria-label="מחיקת העלייה">×</button></div>`
    : `<div class="al-row open"><div class="nm">${esc(label)}</div><div class="who">פנוי</div><button class="btn sec" type="button" data-act="give" data-a="${esc(label)}">רישום</button></div>`;
  let rows = seq.map(label => { const a = given.find(g => g.aliyah === label && !used.has(g._id)); if (a) used.add(a._id); return line(label, a); }).join('');
  rows += given.filter(g => !used.has(g._id)).map(g => line(g.aliyah, g)).join('');
  return `<div class="card"><div class="sechead" style="margin:0 0 4px"><h3>העליות</h3><button class="btn sec" type="button" data-act="give">+ עלייה או כיבוד</button></div>${rows}</div>`;
}

function suggestionsHTML(){
  const free = S.data.members.filter(m => !m.given);
  const group = (tribe, title) => {
    const list = free.filter(m => m.tribe === tribe).slice(0, tribe === 'israel' ? 8 : 4);
    const items = list.map(m => `<button type="button" class="al-pick" data-act="give" data-u="${m.userId}" data-a="${tribe === 'israel' ? '' : TRIBE_LABEL[tribe]}">
      <span>${esc(m.name)}</span><span class="meta">${esc(ago(m.last))}${m.countYear ? ` · ${m.countYear} השנה` : ''}</span></button>`).join('');
    return `<div><h4>${title}</h4>${items || '<p class="small muted">אין</p>'}</div>`;
  };
  const hasTribes = S.data.members.some(m => m.tribe !== 'israel');
  return `<div class="card"><h3>הצעות: מי לא עלה הרבה זמן</h3>
    ${hasTribes ? '' : '<p class="small muted">עוד לא סומנו כהנים ולויים. אפשר לסמן בלשונית "כהנים ולויים", או שכל חבר יסמן בעצמו בדף הזה.</p>'}
    <div class="al-sugg">${group('kohen', 'כהנים')}${group('levi', 'לויים')}${group('israel', 'ישראלים')}</div></div>`;
}

function historyHTML(){
  const recent = S.data.recent;
  if (!recent.length) return '<div class="empty">עוד לא נרשמו עליות.</div>';
  const byDate = [];
  for (const a of recent){ const last = byDate[byDate.length - 1]; if (last && last.k === a.dateKey) last.list.push(a); else byDate.push({ k: a.dateKey, list: [a] }); }
  return byDate.map(({ k, list }) => `<div class="card"><h3><button class="link" type="button" data-act="goto" data-k="${k}" style="padding:0">${esc(dayInfo(k).title)}</button> <span class="meta">${esc(gShort(pkey(k)))}</span></h3>
    ${list.map(a => `<div class="al-row"><div class="nm">${esc(a.aliyah)}</div><div class="who">${esc(a.name)}${a.reasonLabel ? ` <span class="meta">· ${esc(a.reasonLabel)}</span>` : ''}</div></div>`).join('')}</div>`).join('');
}

function tribeSelect(id, value, userId){
  return `<select id="${id}" data-tribe-for="${userId || ''}" style="width:auto">${Object.entries(TRIBE_LABEL).map(([v, l]) => `<option value="${v}"${v === value ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
}
function tribesHTML(){
  const members = S.data.members.slice().sort((a, b) => a.name.localeCompare(b.name, 'he'));
  return `<div class="card"><p class="small muted" style="margin-top:0">הסימון קובע מי מוצע לעליית כהן ולוי. כל חבר יכול גם לסמן לעצמו.</p>
    <div class="list">${members.map((m, i) => `<div class="li"><div class="grow"><div class="t">${esc(m.name)}</div><div class="meta">${esc(ago(m.last))}${m.countYear ? ` · ${m.countYear} עליות בשנה האחרונה` : ''}</div></div>${tribeSelect('tr' + i, m.tribe, m.userId)}</div>`).join('')}</div></div>`;
}

function memberHTML(){
  const d = S.data;
  const claims = d.myClaims.map(c => `<div class="li"><div class="grow"><div class="t">${esc(dayInfo(c.dateKey).title)} <span class="chip pend">${esc(c.reasonLabel)}</span></div>
    <div class="meta">${esc(gFull(pkey(c.dateKey)))}${c.note ? ' · ' + esc(c.note) : ''}</div></div>
    <button class="btn danger" type="button" data-act="delClaim" data-id="${c._id}">מחיקה</button></div>`).join('');
  const mine = d.mine.map(a => `<div class="al-row" data-id="${a._id}"><div class="nm">${esc(a.aliyah)}</div><div class="who">${esc(dayInfo(a.dateKey).title)}<div class="meta">${esc(gFull(pkey(a.dateKey)))}</div></div></div>`).join('');
  return `<div class="card"><h3>כהן, לוי או ישראל?</h3><p class="small muted">לפי הסימון הגבאי יודע לאיזו עלייה להציע אותך.</p>${tribeSelect('myTribe', d.myTribe, '')}</div>
    <div class="card"><div class="sechead" style="margin:0 0 4px"><h3>החיובים שלי</h3><button class="btn sec" type="button" data-act="addClaim">+ רישום חיוב</button></div>
      ${claims ? `<div class="list">${claims}</div>` : '<p class="small muted">יש לך שמחה או אזכרה? רשום כאן את השבת, והגבאי יראה שיש לך חיוב לעלייה. אזכרות מלוח האזכרות מגיעות אליו לבד.</p>'}</div>
    <div class="card"><h3>העליות שלי</h3>${mine || '<p class="small muted">עוד לא נרשמו לך עליות.</p>'}</div>`;
}

/* ---------- Sheets ---------- */
function openSheet(html){ $('#sheet').innerHTML = html; $('#sheetWrap').hidden = false; }
function closeSheet(){ $('#sheetWrap').hidden = true; $('#sheet').innerHTML = ''; }
const sheetHead = (t, sub) => `<div class="sh"><div style="flex:1"><h2>${esc(t)}</h2>${sub ? `<div class="meta">${esc(sub)}</div>` : ''}</div><button class="x" data-act="close" aria-label="סגירה">×</button></div>`;
let toastT;
function toast(msg){ let t = document.querySelector('.toast'); if (!t){ t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); } t.textContent = msg; clearTimeout(toastT); toastT = setTimeout(() => t.remove(), 3200); }

/** בחירת אדם: חברי הקהילה (מי שכבר עלה היום בסוף), או אורח בשם חופשי */
const isKohenLevi = a => a === 'כהן' || a === 'לוי';
function personOptions(userId, name, preferTribe, aliyah){
  // מי שמסומן ישראל לא מוצע לעלייה של כהן או לוי
  const members = S.data.members.filter(m => !(isKohenLevi(aliyah) && m.tribe === 'israel'))
    .sort((a, b) => (a.given - b.given) || ((b.tribe === preferTribe) - (a.tribe === preferTribe)));
  const guest = !userId && !!name;
  const opts = members.map(m => `<option value="${m.userId}"${m.userId === userId ? ' selected' : ''}>${esc(m.name)}${m.tribe !== 'israel' ? ' (' + TRIBE_LABEL[m.tribe] + ')' : ''} · ${esc(m.given ? 'כבר עלה היום' : ago(m.last))}</option>`).join('');
  return `<option value="">— בחירה —</option>${opts}<option value="guest"${guest ? ' selected' : ''}>אורח (שם חופשי)</option>`;
}
function personField(userId, name, preferTribe, aliyah){
  const guest = !userId && !!name;
  return `<label class="f" for="fPerson">מי</label><select id="fPerson">${personOptions(userId, name, preferTribe, aliyah)}</select>
    <div id="guestWrap"${guest ? '' : ' hidden'}><label class="f" for="fName">שם האורח</label><input type="text" id="fName" maxlength="80" value="${esc(guest ? name : '')}"></div>`;
}
function reasonOptions(selected, withNone){
  return (withNone ? `<option value="">בלי חיוב</option>` : '') + Object.entries(S.data.reasons).map(([v, l]) => `<option value="${v}"${v === selected ? ' selected' : ''}>${esc(l)}</option>`).join('');
}

function giveSheet(d){
  const { seq, title } = dayInfo(S.dateKey), taken = new Set(S.data.given.map(g => g.aliyah));
  // ישראל מוצע לעלייה הפנויה הראשונה שאחרי כהן ולוי
  const tribe = d.u ? S.data.members.find(m => m.userId === d.u)?.tribe : '';
  const firstOpen = seq.find(l => !taken.has(l) && (tribe !== 'israel' || (l !== 'כהן' && l !== 'לוי'))) || '';
  const aliyah = d.a !== undefined && d.a !== '' ? d.a : firstOpen;
  const preferTribe = aliyah === 'כהן' ? 'kohen' : aliyah === 'לוי' ? 'levi' : '';
  const names = [...seq, ...HONORS];
  const listed = names.includes(aliyah);
  openSheet(sheetHead('רישום עלייה', title) +
    `<label class="f" for="fAliyah">עלייה או כיבוד</label><select id="fAliyah">${names.map(n => `<option${n === aliyah ? ' selected' : ''}>${esc(n)}${taken.has(n) ? ' ✓' : ''}</option>`).join('')}<option value="__other"${listed || !aliyah ? '' : ' selected'}>אחר…</option></select>
     <div id="otherWrap"${listed || !aliyah ? ' hidden' : ''}><input type="text" id="fOther" maxlength="40" placeholder="לדוגמה: חתן תורה" value="${esc(listed ? '' : aliyah)}"></div>
     ${personField(d.u || '', d.n || '', preferTribe, aliyah)}
     <label class="f" for="fReason">חיוב</label><select id="fReason">${reasonOptions(d.r || '', true)}</select>
     <label class="f" for="fAmount">נמכרה בסכום (₪, לא חובה)</label><input type="text" inputmode="decimal" id="fAmount" placeholder="ירשם בקופה כחוב פתוח על שם העולה">
     <div class="row" style="margin-top:16px"><button class="btn" type="button" data-act="saveAliyah">שמירה</button><button class="btn ghost" type="button" data-act="close">ביטול</button></div>`);
}

function claimSheet(){
  const manager = isManager();
  openSheet(sheetHead('רישום חיוב לעלייה') +
    `<label class="f" for="cDate">שבת או יום</label><input type="date" id="cDate" value="${S.dateKey}">
     <label class="f" for="cReason">סיבה</label><select id="cReason">${reasonOptions('barMitzvah', false)}</select>
     ${manager ? personField('', '', '') : ''}
     <label class="f" for="cNote">פרטים (לא חובה)</label><input type="text" id="cNote" maxlength="120" placeholder="לדוגמה: בר מצווה לבן, אזכרה לאבא">
     <p class="small muted">${manager ? 'אזכרות מלוח האזכרות מופיעות לבד, ואין צורך לרשום אותן כאן.' : 'הגבאי יראה את החיוב כשהוא מחלק את העליות של אותו יום.'}</p>
     <div class="row" style="margin-top:12px"><button class="btn" type="button" data-act="saveClaim">שמירה</button><button class="btn ghost" type="button" data-act="close">ביטול</button></div>`);
}

function readPerson(){
  const v = $('#fPerson').value;
  if (v === 'guest') return { name: $('#fName').value.trim() };
  if (v) return { userId: v };
  return null;
}

/* ---------- Actions ---------- */
const A = {
  signIn: () => Auth.signInWithGoogle(location.href).catch(() => {}),
  prev: () => setDate(stepKey(pkey(S.dateKey), -1)),
  next: () => setDate(stepKey(pkey(S.dateKey), 1)),
  upcoming: () => setDate(stepKey(addDays(today0(), -1), 1)),
  toggleAll: () => { S.all = !S.all; try { localStorage.setItem(ALL_KEY, S.all ? '1' : '0'); } catch(e){} render(); },
  goto: d => { S.view = 'day'; setDate(d.k); render(); },
  view: d => { S.view = d.v; render(); },
  close: closeSheet,
  give: d => giveSheet(d),
  addClaim: () => claimSheet(),
  saveAliyah: guard(async () => {
    const sel = $('#fAliyah').value, aliyah = (sel === '__other' ? $('#fOther').value : sel).trim();
    if (!aliyah) return toast('נא לבחור עלייה');
    const who = readPerson();
    if (!who || (!who.userId && !who.name)) return toast('נא לבחור חבר קהילה או לכתוב שם');
    const amount = Number(String($('#fAmount').value).replace(/[^\d.]/g, '')) || 0;
    const reason = $('#fReason').value || undefined;
    await call('aliyot:add', { dateKey: S.dateKey, aliyah, ...who, ...(reason ? { reason } : {}) });
    if (amount > 0){
      const member = who.userId ? S.data.members.find(m => m.userId === who.userId) : null;
      try {
        await call('fund:save', { type: 'mitzvah', amount, date: S.dateKey, donorId: who.userId || null, name: member ? member.name : who.name,
          mitzvah: FUND_MITZVOT.includes(aliyah) ? aliyah : 'עלייה לתורה', desc: aliyah + ' · ' + dayInfo(S.dateKey).title, paid: false });
      } catch(e){ console.warn(e); closeSheet(); return toast('העלייה נשמרה, אבל החיוב בקופה לא נרשם: ' + errMsg(e)); }
    }
    closeSheet(); toast(amount > 0 ? 'נשמר, והחיוב נרשם בקופה' : 'נשמר');
  }),
  delAliyah: guard(async d => {
    if (!await SiteDialog.confirm('למחוק את העלייה מהרישום?', { ok: 'מחיקה', danger: true })) return;
    await call('aliyot:remove', { id: d.id }); toast('נמחק');
  }),
  saveClaim: guard(async () => {
    const dateKey = $('#cDate').value;
    if (!dateKey) return toast('נא לבחור תאריך');
    let who = {};
    if (isManager()){
      who = readPerson();
      if (!who || (!who.userId && !who.name)) return toast('נא לבחור חבר קהילה או לכתוב שם');
    }
    await call('aliyot:addClaim', { dateKey, reason: $('#cReason').value, note: $('#cNote').value, ...who });
    closeSheet(); toast('החיוב נרשם');
  }),
  delClaim: guard(async d => {
    if (!await SiteDialog.confirm('למחוק את החיוב?', { ok: 'מחיקה', danger: true })) return;
    await call('aliyot:removeClaim', { id: d.id }); toast('נמחק');
  }),
};
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (t){ const f = A[t.dataset.act] || Auctions.actions[t.dataset.act]; if (f){ e.preventDefault(); f(t.dataset, t); } return; }
  if (e.target === $('#sheetWrap')) closeSheet();
});
document.addEventListener('change', guard(async e => {
  const t = e.target;
  if (t.id === 'pickDate') setDate(t.value);
  else if (t.id === 'fAliyah'){
    $('#otherWrap').hidden = t.value !== '__other';
    const p = $('#fPerson'), cur = p.value;
    p.innerHTML = personOptions(cur !== 'guest' ? cur : '', cur === 'guest' ? 'x' : '', t.value === 'כהן' ? 'kohen' : t.value === 'לוי' ? 'levi' : '', t.value);
    if (cur && !p.value) p.value = '';
    $('#guestWrap').hidden = p.value !== 'guest';
  }
  else if (t.id === 'fPerson') $('#guestWrap').hidden = t.value !== 'guest';
  else if (t.dataset.tribeFor !== undefined){
    await call('aliyot:setTribe', { ...(t.dataset.tribeFor ? { userId: t.dataset.tribeFor } : {}), tribe: t.value });
    toast('נשמר');
  }
}));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheetWrap').hidden) closeSheet(); });

/* תוצאת חיפוש (js/menu.js, SiteGo): "day:YYYY-MM-DD" עובר לחלוקת העליות של אותו יום; הצעדים שאחריו מסמנים את השורה */
if (window.SiteGo) SiteGo.on('day', async k => {
  await SiteGo.waitFor(() => S.data);
  S.view = 'day';
  setDate(k);
  render();
});

Auctions.init({ call, guard, toast, openSheet, closeSheet, sheetHead, dayInfo, nextSlotKey, il, render,
  dateKey: () => S.dateKey, active: () => S.view === 'auction' && !!S.data });
boot();
})();
