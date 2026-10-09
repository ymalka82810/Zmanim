/* השבוע שלי: מסך אישי אחד לחבר קהילה. מרכז את הקידוש שלי, חוב פתוח בקופה, האזכרות שלי,
 * הרשמה למניין ("אני מגיע") ואירועי הקהילה של השבוע הקרוב.
 * הנתונים מגיעים מ-kiddush:board, fund:ledger, events:list, yahrzeits:list, minyan:list ו-week:notifications.
 * גבאי או רב רואים גם את אזכרות השבוע בקהילה, מי נרשם לכל תפילה, ויכולים לשלוח קריאה כשחסרים למניין.
 */
(function(){
"use strict";
const { H, LOC, esc, dkey, pkey, gShort, heFull } = window.KiddushCalendar || {};
const $ = s => document.querySelector(s);
const Auth = window.SiteAuth;
const ROLE_LABEL = { gabbai: 'גבאי', rabbi: 'רב', member: 'חבר קהילה' };
const ACCOUNT_URL = '../account/';
const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const WEEK_DAYS = 7;
/** סדר החודשים לבחירה, מתשרי עד אלול. 12 = אדר (אדר א׳ בשנה מעוברת), 13 = אדר ב׳ */
const MONTH_ORDER = [7, 8, 9, 10, 11, 12, 13, 1, 2, 3, 4, 5, 6];
const RELATIONS = ['אבי', 'אמי', 'אחי', 'אחותי', 'בעלי', 'אשתי', 'בני', 'בתי', 'סבי', 'סבתי', 'חמי', 'חמותי'];

const S = {
  ready: false, fatal: null, signedIn: false, synagogues: [], sid: null, me: null,
  board: null, boardError: null, fund: null, events: [], yahrzeits: null, minyan: null, notes: [],
};
/* הפיצ'ר פעיל בקהילה (convex/features.ts). בלי אישור של כל הגבאים והרב הדף לא זמין */
const featureOn = sid => !!S.synagogues.find(s => s._id === sid)?.features?.includes('week');
const todayKey = () => dkey(new Date());
const isManager = () => S.board && (S.board.role === 'gabbai' || S.board.role === 'rabbi');
const daysUntil = k => Math.round((pkey(k) - pkey(todayKey())) / 864e5);
const inWeek = k => { const d = daysUntil(k); return d >= 0 && d < WEEK_DAYS; };

function dayLabel(k){
  const d = daysUntil(k), dow = DAY_NAMES[pkey(k).getDay()];
  if (d === 0) return 'היום, יום ' + dow;
  if (d === 1) return 'מחר, יום ' + dow;
  return 'יום ' + dow + ' ' + gShort(pkey(k));
}
const heOf = k => heFull(new H.HDate(pkey(k)));
const monthName = (m, y) => H.Locale.gettext(H.HDate.getMonthName(m, y), LOC);

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
  const saved = Auth.cached('synagogues:mine', {});
  if (saved) useSynagogues(saved);
  let synagogues = [];
  try {
    const [me, list] = await Promise.all([Auth.query('users:me', {}), Auth.query('synagogues:mine', {})]);
    if (me === null) S.signedIn = false;
    S.me = me;
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

let unsubs = [], attachedDay = null;
function attach(sid){
  const day = todayKey();
  if (sid === S.sid && day === attachedDay && unsubs.length) return;
  unsubs.forEach(u => u());
  unsubs = [];
  S.sid = sid; attachedDay = day;
  S.board = null; S.boardError = null; S.fund = null; S.events = []; S.yahrzeits = null; S.minyan = null; S.notes = [];
  if (!sid || !featureOn(sid)) return;
  const w = (name, args, set, onErr) => unsubs.push(Auth.watch(name, { synagogueId: sid, ...args }, d => { set(d); render(); }, onErr || (e => console.warn(e))));
  w('kiddush:board', {}, d => S.board = d, e => { console.warn(e); S.boardError = errMsg(e); render(); });
  w('fund:ledger', {}, d => S.fund = d);
  w('events:list', {}, d => S.events = d);
  w('yahrzeits:list', { today: day }, d => S.yahrzeits = d);
  w('minyan:list', { from: day }, d => S.minyan = d);
  w('week:notifications', {}, d => S.notes = d);
}
// מסך שנשאר פתוח עד למחרת עובר לשבוע החדש
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.sid && todayKey() !== attachedDay){ attach(S.sid); render(); } });

function errMsg(e){ return (e && typeof e.data === 'string') ? e.data : 'הפעולה לא נשמרה. נסו שוב.'; }
async function call(name, args){ return await Auth.client().mutation(name, { synagogueId: S.sid, ...args }); }
function guard(fn){ return async (...a) => { try { await fn(...a); } catch(e){ console.warn(e); toast(errMsg(e)); } }; }

/* ---------- Render ---------- */
function hero(text, button){ return `<div class="hero"><h1>השבוע שלי</h1><p class="muted">${text}</p></div>${button || ''}`; }

function render(){
  const app = $('#app');
  if (S.fatal){ app.innerHTML = hero(esc(S.fatal)); return; }
  if (!S.ready){ app.innerHTML = '<div class="empty">טוען…</div>'; return; }
  if (!S.signedIn){ app.innerHTML = hero('כדי לראות את השבוע שלך יש להתחבר עם חשבון Google.', '<button class="btn btn-google" data-act="signIn">כניסה עם Google</button>'); return; }
  if (!S.sid){ app.innerHTML = hero('עדיין לא הצטרפת לקהילה. אפשר להצטרף דרך הזמנה מהגבאי או לפתוח קהילה חדשה.', `<a class="btn" href="${ACCOUNT_URL}">לחשבון שלי</a>`); return; }
  if (!featureOn(S.sid)){ app.innerHTML = hero('"השבוע שלי" אינו פעיל בקהילה זו. כדי להשתמש בו, כל הגבאים והרב צריכים לאשר אותו ב"החשבון שלי", בפרטי הקהילה.', `<a class="btn" href="${ACCOUNT_URL}">לחשבון שלי</a>`); return; }
  if (S.boardError){ app.innerHTML = hero(esc(S.boardError), `<a class="btn" href="${ACCOUNT_URL}">לחשבון שלי</a>`); return; }
  if (!S.board){ app.innerHTML = '<div class="empty">טוען…</div>'; return; }
  app.innerHTML = headerHTML() + notesHTML() + minyanHTML() + kiddushHTML() + fundHTML() + yahrzeitHTML() + eventsHTML();
}

function headerHTML(){
  const s = S.board.synagogue;
  if (window.SiteMenu) SiteMenu.setCommunity({ _id: S.sid, name: s.name, il: s.il });
  const name = S.me?.name ? ' ' + S.me.name.split(' ')[0] : '';
  return `<header class="top">
    <div class="shul"><h1>שלום${esc(name)}</h1><small>${esc(s.name)} | ${ROLE_LABEL[S.board.role]}</small></div>
  </header>`;
}

function section(title, body, action){
  return `<div class="sechead"><h2>${esc(title)}</h2>${action || ''}</div>${body}`;
}

function notesHTML(){
  const unread = S.notes.filter(n => !n.read);
  if (!unread.length) return '';
  return `<div class="card remind"><h3>${unread.length === 1 ? 'הודעה חדשה' : unread.length + ' הודעות חדשות'}</h3>
    ${unread.slice(0, 5).map(n => `<p>${esc(n.text)}</p>`).join('')}
    <div class="row"><button class="btn sec" type="button" data-act="readNotes">סימון כנקרא</button></div></div>`;
}

/* --- מניין --- */
function minyanHTML(){
  const M = S.minyan;
  if (!M) return '';
  const manage = isManager() ? `<button class="link" type="button" data-act="manageMinyan">ניהול תפילות</button>` : '';
  if (!M.minyanim.length){
    return isManager() ? section('אני מגיע למניין', `<div class="card"><p class="small muted">עדיין לא הוגדרו תפילות להרשמה. אפשר להוסיף תפילה קבועה (למשל מנחה בימי חול או ותיקין), וחברי הקהילה יסמנו שהם מגיעים.</p>
      <div class="row"><button class="btn sec" type="button" data-act="addMinyan">הוספת תפילה</button></div></div>`) : '';
  }
  const byId = Object.fromEntries(M.minyanim.map(m => [m._id, m]));
  const body = M.days.map(d => `<div class="dayhead">${esc(dayLabel(d.dateKey))}</div>` + d.items.map(it => {
    const m = byId[it.minyanId], full = it.count >= M.quorum, missing = M.quorum - it.count;
    const chip = full ? `<span class="chip done">${it.count} · יש מניין</span>` : `<span class="chip ${it.count ? 'pend' : 'free'}">${it.count}/${M.quorum}</span>`;
    const names = isManager() && it.names.length ? `<div class="meta">${esc(it.names.join(', '))}</div>` : '';
    const btn = it.mine
      ? `<button class="btn ok" type="button" data-act="rsvp" data-id="${it.minyanId}" data-k="${d.dateKey}" data-c="0" aria-pressed="true">✓ מגיע</button>`
      : `<button class="btn sec" type="button" data-act="rsvp" data-id="${it.minyanId}" data-k="${d.dateKey}" data-c="1">אני מגיע</button>`;
    const callBtn = isManager() && !full ? `<button class="btn ghost" type="button" data-act="callMinyan" data-id="${it.minyanId}" data-k="${d.dateKey}" title="שליחת הודעה לכל חברי הקהילה">חסרים ${missing} – קריאה</button>` : '';
    return `<div class="mrow"><div class="grow"><div class="t"><b>${esc(m.name)}</b>${m.time ? ' · ' + esc(m.time) : ''}</div>${names}</div>${chip}${callBtn}${btn}</div>`;
  }).join('')).join('');
  return section('אני מגיע למניין', `<div class="card">${body || '<p class="small muted">אין תפילות להרשמה בשבוע הקרוב.</p>'}</div>`, manage);
}

/* --- קידוש --- */
function kiddushHTML(){
  const today = todayKey();
  const mine = S.board.bookings.filter(b => b.mine && b.dateKey >= today && b.status !== 'blocked').sort((a, b) => a.dateKey < b.dateKey ? -1 : 1);
  const body = mine.length
    ? `<div class="list">${mine.map(b => `<div class="li"><div class="grow"><div class="t">${esc(dayLabelLong(b.dateKey))}</div>
        <div class="meta">${esc(b.sponsorLine)}${b.occasionLine ? ' · ' + esc(b.occasionLine.replace(/\n/g, ' · ')) : ''}</div></div>
        ${b.status === 'approved' ? '<span class="chip appr">מאושר</span>' : '<span class="chip pend">ממתין לאישור</span>'}</div>`).join('')}</div>`
    : '<p class="small muted">אין לך קידוש קרוב.</p>';
  return section('הקידוש שלי', `<div class="card">${body}<div class="row" style="margin-top:8px"><a class="btn sec" href="../kiddush/">ללוח הקידושים</a></div></div>`);
}
function dayLabelLong(k){
  return inWeek(k) ? dayLabel(k) : heOf(k) + ' · ' + gShort(pkey(k));
}

/* --- קופה --- */
function fundHTML(){
  if (!S.fund) return '';
  const myId = S.me?.userId;
  const txs = (S.fund.txs || []).filter(t => !t.paid && (isManager() ? t.donorId && t.donorId === myId : true));
  if (!txs.length){
    return section('הקופה', `<div class="card"><p class="small">אין לך חובות פתוחים בקופה. תודה!</p></div>`);
  }
  const total = txs.reduce((s, t) => s + t.amount, 0);
  const lines = txs.slice(0, 5).map(t => `<div class="li"><div class="grow"><div class="t">${esc(t.type === 'mitzvah' ? 'מכירת מצווה' + (t.mitzvah ? ': ' + t.mitzvah : '') : 'תרומה')}</div>${t.desc ? `<div class="meta">${esc(t.desc)}</div>` : ''}</div><b>₪${t.amount.toLocaleString('he-IL')}</b></div>`).join('');
  return section('הקופה', `<div class="card"><p>${txs.length === 1 ? 'חיוב אחד פתוח' : txs.length + ' חיובים פתוחים'} על סך <b>₪${total.toLocaleString('he-IL')}</b>.</p>
    <div class="list">${lines}</div><div class="row" style="margin-top:8px"><a class="btn sec" href="../gabbai/">לפרטים ותשלום</a></div></div>`);
}

/* --- אזכרות --- */
function yahrzeitLine(y, showOwner){
  const d = y.next ? daysUntil(y.next) : null;
  const when = y.next ? `${heOf(y.next)} · ${gShort(pkey(y.next))}${d === 0 ? ' · היום' : d === 1 ? ' · מחר' : d < 31 ? ` · בעוד ${d} ימים` : ''}` : '';
  const who = showOwner ? ` · ${esc(y.owner)}` : '';
  const edit = y.mine || isManager();
  return `<div class="li"><div class="grow"><div class="t">${esc(y.name)}${y.relation ? ` <span class="muted small">(${esc(y.relation)})</span>` : ''}</div>
    <div class="meta">${esc(when)}${who}</div><div class="meta">נפטר/ה ${esc(y.hebrewDate)}${y.mine && !y.shared ? ' · לא מוצג לקהילה' : ''}</div></div>
    ${edit ? `<button class="btn sec" type="button" data-act="editYahrzeit" data-id="${y._id}">עריכה</button>` : ''}</div>`;
}
function yahrzeitHTML(){
  if (!S.yahrzeits) return '';
  const items = S.yahrzeits.items;
  const mine = items.filter(y => y.mine);
  const week = items.filter(y => y.next && inWeek(y.next));
  let html = '';
  if (week.length){
    html += section('אזכרות השבוע בקהילה', `<div class="card"><p class="small muted">${isManager() ? 'כדי לדעת למי לתת עלייה ומי אומר קדיש.' : 'יהי זכרם ברוך.'}</p>
      <div class="list">${week.map(y => yahrzeitLine(y, true)).join('')}</div></div>`);
  }
  const body = mine.length
    ? `<div class="list">${mine.map(y => yahrzeitLine(y, false)).join('')}</div>`
    : '<p class="small muted">אפשר להזין כאן אזכרות של קרובים. האזכרה תופיע ביומן הקהילה, ותגיע אליך תזכורת שבוע לפני.</p>';
  html += section('האזכרות שלי', `<div class="card">${body}<div class="row" style="margin-top:8px"><button class="btn sec" type="button" data-act="addYahrzeit">+ הוספת אזכרה</button></div></div>`);
  return html;
}

/* --- אירועים --- */
function eventsHTML(){
  const evts = S.events.filter(e => inWeek(e.dateKey));
  const body = evts.length
    ? `<div class="list">${evts.map(e => `<div class="li"><div class="grow"><div class="t">${esc(e.title)}</div><div class="meta">${esc(dayLabel(e.dateKey))}${e.details ? ' · ' + esc(e.details) : ''}</div></div></div>`).join('')}</div>`
    : '<p class="small muted">אין אירועים קהילתיים בשבוע הקרוב.</p>';
  return section('אירועי הקהילה השבוע', `<div class="card">${body}<div class="row" style="margin-top:8px"><a class="btn sec" href="../community-calendar/">ליומן הקהילה</a></div></div>`);
}

/* ---------- Sheets ---------- */
function openSheet(html){ $('#sheet').innerHTML = html; $('#sheetWrap').hidden = false; const f = $('#sheet').querySelector('input[type=text],textarea'); if (f && window.innerWidth > 700) f.focus(); }
function closeSheet(){ $('#sheetWrap').hidden = true; $('#sheet').innerHTML = ''; }
const sheetHead = (t, sub) => `<div class="sh"><div style="flex:1"><h2>${esc(t)}</h2>${sub ? `<div class="meta">${esc(sub)}</div>` : ''}</div><button class="x" data-act="close" aria-label="סגירה">×</button></div>`;
let toastT;
function toast(msg){ let t = document.querySelector('.toast'); if (!t){ t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); } t.textContent = msg; clearTimeout(toastT); toastT = setTimeout(() => t.remove(), 3200); }

/* --- טופס אזכרה --- */
function monthOptions(year, selected){
  const leap = H.HDate.isLeapYear(year);
  return MONTH_ORDER.filter(m => m !== 13 || leap).map(m =>
    `<option value="${m}"${m === selected ? ' selected' : ''}>${esc(monthName(m, year))}</option>`).join('');
}
function dayOptions(month, year, selected){
  const n = H.HDate.daysInMonth(month, year);
  return Array.from({ length: n }, (_, i) => i + 1).map(d => `<option value="${d}"${d === selected ? ' selected' : ''}>${H.gematriya(d)}</option>`).join('');
}
function yearOptions(selected){
  const cur = new H.HDate().getFullYear();
  let html = '';
  for (let y = cur; y >= cur - 130; y--) html += `<option value="${y}"${y === selected ? ' selected' : ''}>${H.gematriya(y)} (${y})</option>`;
  return html;
}
function yahrzeitSheet(y){
  const now = new H.HDate();
  const hy = y?.hYear || now.getFullYear(), hm = y?.hMonth || now.getMonth(), hd = y?.hDay || now.getDate();
  openSheet(sheetHead(y ? 'עריכת אזכרה' : 'הוספת אזכרה') +
    `<label class="f" for="yzName">שם הנפטר/ת</label><input type="text" id="yzName" maxlength="80" placeholder="לדוגמה: יעקב בן אברהם" value="${esc(y?.name || '')}">
     <label class="f" for="yzRel">קרבה (לא חובה)</label><input type="text" id="yzRel" maxlength="40" list="yzRels" placeholder="לדוגמה: אבי" value="${esc(y?.relation || '')}">
     <datalist id="yzRels">${RELATIONS.map(r => `<option value="${r}">`).join('')}</datalist>
     <label class="f">תאריך הפטירה העברי</label>
     <div class="hdate"><select id="yzDay" aria-label="יום">${dayOptions(hm, hy, hd)}</select><select id="yzMonth" aria-label="חודש">${monthOptions(hy, hm)}</select><select id="yzYear" aria-label="שנה">${yearOptions(hy)}</select></div>
     <details style="margin-top:8px"><summary class="small">יודעים רק את התאריך הלועזי?</summary>
       <input type="date" id="yzGreg" style="margin-top:6px"><label class="check"><input type="checkbox" id="yzEve"> הפטירה הייתה אחרי השקיעה</label>
       <p class="small muted">התאריך העברי יתעדכן לפי התאריך הלועזי.</p></details>
     <label class="check"><input type="checkbox" id="yzShared"${!y || y.shared ? ' checked' : ''}> להציג ביומן הקהילה (הגבאי והרב רואים תמיד, כדי לתת עלייה)</label>
     <div class="row" style="margin-top:16px"><button class="btn" type="button" data-act="saveYahrzeit" data-id="${y?._id || ''}">שמירה</button>
     ${y ? `<button class="btn danger" type="button" data-act="delYahrzeit" data-id="${y._id}">מחיקה</button>` : ''}<button class="btn ghost" type="button" data-act="close">ביטול</button></div>`);
}
function refreshHebrewSelects(day, month, year){
  if (month === 13 && !H.HDate.isLeapYear(year)) month = 12;
  $('#yzMonth').innerHTML = monthOptions(year, month);
  day = Math.min(day, H.HDate.daysInMonth(month, year));
  $('#yzDay').innerHTML = dayOptions(month, year, day);
  if (+$('#yzYear').value !== year){
    if (!$('#yzYear').querySelector(`option[value="${year}"]`)) return toast('התאריך מחוץ לטווח השנים');
    $('#yzYear').value = String(year);
  }
}
function fromGregorian(){
  const v = $('#yzGreg').value;
  if (!v) return;
  const d = pkey(v);
  if ($('#yzEve').checked) d.setDate(d.getDate() + 1);
  const h = new H.HDate(d);
  refreshHebrewSelects(h.getDate(), h.getMonth(), h.getFullYear());
}

/* --- ניהול תפילות --- */
function minyanManageSheet(){
  const list = S.minyan.minyanim;
  openSheet(sheetHead('תפילות להרשמה', 'חברי הקהילה מסמנים "אני מגיע" לכל תפילה ביום שהיא מתקיימת') +
    (list.length ? `<div class="list">${list.map(m => `<div class="li"><div class="grow"><div class="t">${esc(m.name)}${m.time ? ' · ' + esc(m.time) : ''}</div>
      <div class="meta">${m.days.length === 7 ? 'כל יום' : 'ימי ' + m.days.map(d => DAY_NAMES[d]).join(', ')}</div></div>
      <button class="btn sec" type="button" data-act="editMinyan" data-id="${m._id}">עריכה</button></div>`).join('')}</div>` : '<p class="muted small">עדיין אין תפילות.</p>') +
    `<div class="row" style="margin-top:14px"><button class="btn" type="button" data-act="addMinyan">הוספת תפילה</button><button class="btn ghost" type="button" data-act="close">סגירה</button></div>`);
}
function minyanFormSheet(m){
  const days = m ? m.days : [0, 1, 2, 3, 4];
  openSheet(sheetHead(m ? 'עריכת תפילה' : 'הוספת תפילה') +
    `<label class="f" for="mnName">שם התפילה</label><input type="text" id="mnName" maxlength="40" list="mnNames" placeholder="לדוגמה: מנחה" value="${esc(m?.name || '')}">
     <datalist id="mnNames"><option value="שחרית"><option value="ותיקין"><option value="מנחה"><option value="ערבית"><option value="מנחה וערבית"></datalist>
     <label class="f" for="mnTime">שעה (לא חובה)</label><input type="text" id="mnTime" maxlength="20" placeholder="לדוגמה: 13:30, או 10 דקות לפני השקיעה" value="${esc(m?.time || '')}">
     <label class="f">ימים</label><div class="days">${DAY_NAMES.map((n, i) => `<label><input type="checkbox" class="mnDay" value="${i}"${days.includes(i) ? ' checked' : ''}> ${n}</label>`).join('')}</div>
     <p class="small muted">התפילה נרשמת גם בהגדרות לוח הזמנים: ימי חול בתבנית "ימות השבוע" ושבת בתבנית "שבתות". תפילה בשם שכבר קיים בלוח (למשל "מנחה") קובעת את השעה בימים שלה.</p>
     <div class="row" style="margin-top:16px"><button class="btn" type="button" data-act="saveMinyan" data-id="${m?._id || ''}">שמירה</button>
     ${m ? `<button class="btn danger" type="button" data-act="delMinyan" data-id="${m._id}">מחיקה</button>` : ''}<button class="btn ghost" type="button" data-act="manageMinyan">חזרה</button></div>`);
}

/* ---------- Actions ---------- */
const A = {
  signIn: () => Auth.signInWithGoogle(location.href).catch(() => {}),
  close: closeSheet,
  readNotes: guard(async () => { await call('week:markRead', {}); }),
  rsvp: guard(async (d, el) => {
    el.disabled = true;
    try { await call('minyan:rsvp', { minyanId: d.id, dateKey: d.k, coming: d.c === '1' }); }
    finally { el.disabled = false; }
  }),
  callMinyan: guard(async d => {
    const m = S.minyan.minyanim.find(x => x._id === d.id);
    if (!await SiteDialog.confirm(`לשלוח לכל חברי הקהילה הודעה שחסרים אנשים ל${m ? m.name : 'תפילה'}?`, { ok: 'שליחה' })) return;
    await call('minyan:call', { minyanId: d.id, dateKey: d.k }); toast('הקריאה נשלחה');
  }),
  manageMinyan: minyanManageSheet,
  addMinyan: () => minyanFormSheet(null),
  editMinyan: d => { const m = S.minyan.minyanim.find(x => x._id === d.id); if (m) minyanFormSheet(m); },
  saveMinyan: guard(async d => {
    const name = $('#mnName').value, time = $('#mnTime').value;
    const days = [...document.querySelectorAll('.mnDay:checked')].map(c => +c.value);
    if (!name.trim()) return toast('נא למלא שם לתפילה');
    if (!days.length) return toast('נא לבחור לפחות יום אחד');
    const res = d.id ? await call('minyan:updateMinyan', { id: d.id, name, time, days }) : await call('minyan:addMinyan', { name, time, days });
    toast(res && res.scheduled ? 'נשמר, וגם נרשם בלוח הזמנים' : 'נשמר. כדי שהתפילה תופיע בלוח הזמנים, כתבו שעה כמו 13:30 או "10 דקות לפני השקיעה"');
    minyanManageSheet();
  }),
  delMinyan: guard(async d => {
    if (!await SiteDialog.confirm('למחוק את התפילה? ההרשמות אליה יימחקו.', { ok: 'מחיקה', danger: true })) return;
    await call('minyan:removeMinyan', { id: d.id }); toast('נמחק'); minyanManageSheet();
  }),
  addYahrzeit: () => yahrzeitSheet(null),
  editYahrzeit: d => { const y = S.yahrzeits.items.find(x => x._id === d.id); if (y) yahrzeitSheet(y); },
  saveYahrzeit: guard(async d => {
    const args = {
      name: $('#yzName').value, relation: $('#yzRel').value,
      hDay: +$('#yzDay').value, hMonth: +$('#yzMonth').value, hYear: +$('#yzYear').value,
      shared: $('#yzShared').checked,
    };
    if (!args.name.trim()) return toast('נא למלא את שם הנפטר');
    if (d.id) await call('yahrzeits:update', { id: d.id, ...args });
    else await call('yahrzeits:add', args);
    closeSheet(); toast('נשמר');
  }),
  delYahrzeit: guard(async d => {
    if (!await SiteDialog.confirm('למחוק את האזכרה?', { ok: 'מחיקה', danger: true })) return;
    await call('yahrzeits:remove', { id: d.id }); closeSheet(); toast('נמחק');
  }),
};
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (t){ const f = A[t.dataset.act]; if (f){ e.preventDefault(); f(t.dataset, t); } return; }
  if (e.target === $('#sheetWrap')) closeSheet();
});
document.addEventListener('change', e => {
  const id = e.target.id;
  if (id === 'yzYear' || id === 'yzMonth') refreshHebrewSelects(+$('#yzDay').value, +$('#yzMonth').value, +$('#yzYear').value);
  else if (id === 'yzGreg' || id === 'yzEve') fromGregorian();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheetWrap').hidden) closeSheet(); });

boot();
})();
