/* לוח קידושים: מציג את הגיליון של בית הכנסת כלוח שבתות וחגים, ומקים גיליון חדש לגבאי */
(function(){
"use strict";
const { H, esc, dkey, pkey, today0, gShort, gFull, heMonth, heDay, heYear, heFull,
  getSlots, slotFor, slotTitle, monthRange } = window.KiddushCalendar || {};
const G = window.KiddushSheets;
const ERR = {
  network: 'אין חיבור לאינטרנט. מוצג המידע האחרון שנשמר במכשיר.',
  'no-gate': 'הלוח עדיין לא חובר לשירות ההרשמה של האתר. בעל האתר צריך להשלים את ההתקנה.',
  'no-access': 'הגיליון לא נמצא. ודאו שהקישור נכון, ושהגיליון נוצר מתוך הלוח.',
  'not-board': 'הקישור מוביל לגיליון שאינו לוח קידושים שנוצר מתוך הלוח.',
  'bad-sheet': 'הקישור לא תקין.',
  closed: 'לא הצלחנו לקרוא את הגיליון. ודאו שהקישור נכון ושהגיליון משותף ל"כל מי שיש לו את הקישור".'
};
const errText = e => ERR[e && e.code] || 'לא הצלחנו לקרוא את הלוח. נסו שוב בעוד רגע.';
const $ = s => document.querySelector(s);
const LS_ID = 'kd_sheet', LS_CACHE = 'kd_cache', LS_MODE = 'kd_mode';
const YEAR_DAYS = 365;

const ICON = {
  right:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg>',
  left:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m15 6-6 6 6 6"/></svg>',
  refresh:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/></svg>',
  gear:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>'
};

/* ---------- State ---------- */
const S = { id:null, info:null, rows:{}, loading:false, error:null, at:0, fatal:null, mode:'heb', anchor:today0(), created:null };
const store = {
  get(k){ try { return localStorage.getItem(k); } catch(e){ return null; } },
  set(k, v){ try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch(e){} }
};
const IN_APP = location.hostname === 'localhost' && !!window.Capacitor;
const siteUrl = id => (IN_APP ? window.KIDDUSH_CONFIG.publicUrl : location.origin + location.pathname) + '?sheet=' + id;

/* ---------- Boot ---------- */
function boot(){
  if (!H || !window.KiddushCalendar || !G){ S.fatal = 'לא ניתן לטעון את לוח השנה העברי. רעננו את העמוד.'; return render(); }
  const m = store.get(LS_MODE); if (m) S.mode = m;
  const fromUrl = G.idFrom(new URLSearchParams(location.search).get('sheet'));
  connect(fromUrl || store.get(LS_ID));
}
function connect(id){
  S.id = id || null; S.info = null; S.rows = {}; S.error = null; S.at = 0;
  store.set(LS_ID, S.id);
  history.replaceState(null, '', S.id ? '?sheet='+S.id : location.pathname);
  if (!S.id){ render(); if (G.hasClientId()) G.loadGis().then(render, () => {}); return; }
  try {
    const c = JSON.parse(store.get(LS_CACHE) || 'null');
    if (c && c.id === S.id){ S.info = c.info; S.rows = c.rows; S.at = c.at; }
  } catch(e){}
  render(); refresh();
}
async function refresh(){
  if (!S.id || S.loading) return;
  S.loading = true; render();
  try {
    const { info, rows } = await G.load(S.id);
    S.info = info; S.rows = rows; S.at = Date.now(); S.error = null;
    store.set(LS_CACHE, JSON.stringify({ id:S.id, info, rows, at:S.at }));
  } catch(e){
    console.warn(e);
    S.error = errText(e);
  }
  S.loading = false; render();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.id && Date.now() - S.at > 60e3) refresh(); });

/* ---------- Render ---------- */
function render(){
  const app = $('#app');
  if (S.fatal){ app.innerHTML = `<div class="hero"><h1>לוח קידושים</h1><p class="muted">${esc(S.fatal)}</p></div>`; return; }
  if (!S.id) return renderStart(app);
  if (!S.info){
    app.innerHTML = S.error
      ? `<div class="hero"><h1>לוח קידושים</h1><div class="warn">${esc(S.error)}</div></div>
         <div class="row"><button class="btn" data-act="refresh">ניסיון נוסף</button><button class="btn sec" data-act="disconnect">חיבור גיליון אחר</button></div>`
      : '<div class="empty">טוען את הגיליון…</div>';
    return;
  }
  app.innerHTML = headerHTML() + (S.error ? `<div class="warn">${esc(S.error)}</div>` : '') + calHTML();
}
function headerHTML(){
  const i = S.info;
  const upd = S.loading ? 'מעדכן…' : S.at ? 'עודכן '+new Date(S.at).toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'}) : '';
  return `<header class="top">
    <div class="shul"><h1>${esc(i.name || 'לוח קידושים')}</h1><small>${i.il?'ארץ ישראל':'חוץ לארץ'}${upd?' | '+upd:''}</small></div>
    <button class="iconbtn${S.loading?' spin':''}" data-act="refresh" aria-label="רענון">${ICON.refresh}</button>
    <button class="iconbtn" data-act="settings" aria-label="הגדרות">${ICON.gear}</button>
  </header>`;
}

/* Calendar */
function shiftMonth(dir){
  const a = S.anchor;
  if (S.mode === 'greg') S.anchor = new Date(a.getFullYear(), a.getMonth()+dir, 1);
  else { const {first} = monthRange(a,'heb'); S.anchor = dir > 0 ? new H.HDate(first.abs()+first.daysInMonth()).greg() : new H.HDate(first.abs()-1).greg(); }
  render();
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
/* השבתות והחגים של החודש, יחד עם שורות נוספות שהגבאי הוסיף לגיליון בתאריכים אחרים */
function monthSlots(){
  const {start, end} = monthRange(S.anchor, S.mode), il = !!S.info.il;
  const list = getSlots(start, end, il).slice(), have = new Set(list.map(s => s.key));
  const s0 = dkey(start), s1 = dkey(end);
  for (const [k, r] of Object.entries(S.rows)){
    if (k < s0 || k > s1 || have.has(k)) continue;
    const sl = slotFor(k, il);
    list.push(sl.kind ? sl : { ...sl, kind:'', name: r.label || gFull(sl.date) });
  }
  return list.sort((a, b) => a.key < b.key ? -1 : 1);
}
const dedicText = r => r.dname ? (r.dedic === 'לזכות' ? 'לזכות ' : r.dedic ? 'לע״נ ' : '') + r.dname : '';
function statusHTML(r, past){
  if (!r) return past ? '' : '<span class="chip block">לא בגיליון</span>';
  if (!r.sponsor) return past ? '<span class="chip block">לא נקבע</span>' : '<span class="chip free">פנוי</span>';
  const d = dedicText(r);
  return `<span class="chip appr">קידוש ע״י</span><span class="by">${esc(r.sponsor)}</span>${d?`<span class="ded">${esc(d)}</span>`:''}`;
}
function calHTML(){
  const {t, alt} = monthTitles(), t0 = today0();
  const rows = monthSlots().map(sl => {
    const r = S.rows[sl.key], past = sl.date < t0, isToday = +sl.date === +t0;
    const big = S.mode === 'heb' ? heDay(sl.hd) : sl.date.getDate();
    const small = S.mode === 'heb' ? gShort(sl.date) : heDay(sl.hd)+' '+heMonth(sl.hd);
    return `<button class="slot${past?' past':''}${isToday?' today':''}" data-act="slot" data-k="${sl.key}">
      <div class="date"><div class="big">${big}</div><div class="small">${esc(small)}</div></div>
      <div><div class="kind">${esc(sl.kind)}</div><h3>${esc(sl.name)}</h3>${sl.subs?.length?`<div class="sub">${esc(sl.subs.join(', '))}</div>`:''}</div>
      <div class="stcol">${statusHTML(r, past)}</div></button>`;
  }).join('');
  return `<div class="monthbar">
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

/* Start: הקמת גיליון או חיבור לגיליון קיים */
function renderStart(app){
  const canCreate = G.hasClientId(), gated = G.hasGate();
  app.innerHTML = `<div class="hero"><h1>לוח קידושים</h1><p class="muted">הלוח מציג את גיליון הקידושים של בית הכנסת. ${gated
      ? 'המתפללים נרשמים בלוח, והרישומים נשמרים בגיליון גוגל של הגבאי.'
      : 'המתפללים נרשמים בגיליון גוגל של הגבאי, והלוח מסדר את הרישומים לפי שבתות וחגים.'}</p></div>
    <div class="card"><h3>קיבלתי קישור מהגבאי</h3>
      <label class="f" for="fLink">הדביקו כאן את הקישור ללוח או לגיליון</label>
      <input type="text" id="fLink" dir="ltr" placeholder="https://docs.google.com/spreadsheets/d/…">
      <div class="row" style="margin-top:12px"><button class="btn" data-act="connect">פתיחת הלוח</button></div></div>
    <div class="card"><h3>אני גבאי: הקמת גיליון חדש</h3>
      <p class="small muted" style="margin:0 0 4px">הגיליון ייווצר בגוגל דרייב שלך ויהיה שייך לך. יהיו בו שורות לכל השבתות והחגים בשנה הקרובה. ${gated
        ? 'רק את/ה יכול/ה לערוך אותו. המתפללים נרשמים דרך הלוח, והלוח כותב רק לשבת פנויה.'
        : 'כל מי שיקבל ממך את הקישור יוכל לכתוב בו.'}</p>
      <label class="f" for="fName">שם בית הכנסת</label><input type="text" id="fName" maxlength="80">
      <label class="f" for="fIl">מיקום (קובע את סדר הפרשות והחגים)</label>
      <select id="fIl"><option value="1">ארץ ישראל</option><option value="0">חוץ לארץ</option></select>
      ${canCreate ? '' : '<div class="warn">הקמת גיליון עדיין לא זמינה באתר הזה: בעל האתר צריך להשלים את החיבור לגוגל.</div>'}
      <div class="row" style="margin-top:14px"><button class="btn" data-act="create" ${canCreate && G.ready() ? '' : 'disabled'}>יצירת הגיליון בגוגל</button></div></div>`;
}

/* ---------- Sheets (חלונות) ---------- */
function openSheet(html){ $('#sheet').innerHTML = html; $('#sheetWrap').hidden = false; }
function closeSheet(){ $('#sheetWrap').hidden = true; $('#sheet').innerHTML = ''; }
const sheetHead = (t, sub) => `<div class="sh"><div style="flex:1"><h2>${esc(t)}</h2>${sub?`<div class="meta">${esc(sub)}</div>`:''}</div><button class="x" data-act="close" aria-label="סגירה">×</button></div>`;
let toastT;
function toast(msg){ let t = $('.toast'); if (!t){ t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role','status'); document.body.appendChild(t); } t.textContent = msg; clearTimeout(toastT); toastT = setTimeout(() => t.remove(), 3600); }

function slotSheet(k){
  const sl = slotFor(k, !!S.info.il), r = S.rows[k], past = sl.date < today0();
  let html = sheetHead(sl.kind ? slotTitle(sl) : (r?.label || gFull(sl.date)), heFull(sl.hd)+' | '+gFull(sl.date));
  if (sl.subs?.length) html += `<p class="small muted">${esc(sl.subs.join(', '))}</p>`;
  if (r && r.sponsor){
    html += `<dl class="kv"><dt>קידוש ע״י</dt><dd>${esc(r.sponsor)}</dd>
      ${r.dname?`<dt>${r.dedic==='לזכות'?'לזכות':'לעילוי נשמת'}</dt><dd>${esc(r.dname)}</dd>`:''}
      ${r.reason?`<dt>סיבה</dt><dd>${esc(r.reason)}</dd>`:''}
      ${r.note?`<dt>הערה</dt><dd>${esc(r.note)}</dd>`:''}</dl>`;
  } else if (r) html += `<p><span class="chip ${past?'block':'free'}">${past?'לא נקבע קידוש':'פנוי לקידוש'}</span></p>`;
  else html += `<p class="muted">התאריך הזה עדיין לא נמצא בגיליון.${past?'':' הגבאי יכול להוסיף את השנה הבאה מתפריט ההגדרות.'}</p>`;
  if (r && !past && G.hasGate()){
    html += r.sponsor
      ? '<p class="meta">לשינוי או לביטול הרישום פנו לגבאי.</p>'
      : `<div class="row" style="margin-top:14px"><button class="btn" data-act="register" data-k="${k}">הרשמה לקידוש</button></div>`;
  } else if (r && !past){ // בלי שומר סף: נרשמים ישירות בגיליון
    html += `<div class="row" style="margin-top:14px"><a class="btn" href="${esc(G.editUrl(S.id, r.row))}" target="_blank" rel="noopener">${r.sponsor ? 'עריכה בגיליון' : 'להרשמה בגיליון'}</a></div>
      <p class="meta">הגיליון ייפתח בשורה של השבת הזו. אחרי ההרשמה חזרו ללוח ולחצו על כפתור הרענון.</p>`;
  }
  openSheet(html);
}
function registerSheet(k){
  const sl = slotFor(k, !!S.info.il);
  openSheet(sheetHead('הרשמה לקידוש', (sl.kind ? slotTitle(sl) : gFull(sl.date))+' | '+heFull(sl.hd)) + `
    <label class="f" for="fSponsor">שם התורם (יוצג בלוח)</label><input type="text" id="fSponsor" maxlength="60" placeholder="לדוגמה: משפחת לוי">
    <label class="f" for="fDedic">הקדשה</label>
    <select id="fDedic"><option value="">ללא הקדשה</option><option>לעילוי נשמת</option><option>לזכות</option></select>
    <div id="dnameBox" hidden><label class="f" for="fDname">שם</label><input type="text" id="fDname" maxlength="80"></div>
    <label class="f" for="fReason">סיבה (לא חובה)</label><input type="text" id="fReason" maxlength="80" placeholder="בר מצווה, יארצייט, הולדת נכד…">
    <label class="f" for="fPhone">טלפון (יוצג רק לגבאי)</label><input type="tel" id="fPhone" maxlength="20" dir="ltr" style="text-align:right">
    <label class="f" for="fNote">הערה (לא חובה)</label><input type="text" id="fNote" maxlength="200">
    <p class="meta">אחרי ההרשמה, שינוי או ביטול נעשים דרך הגבאי.</p>
    <div class="row" style="margin-top:12px"><button class="btn" data-act="doRegister" data-k="${k}">הרשמה</button><button class="btn ghost" data-act="close">ביטול</button></div>`);
}
function shareBlock(id){
  const url = siteUrl(id);
  return `<label class="f">קישור ללוח (לשליחה למתפללים)</label>
    <input type="text" readonly dir="ltr" value="${esc(url)}" id="shareUrl">
    <div class="row" style="margin-top:10px"><button class="btn" data-act="copy">העתקה</button>${navigator.share?'<button class="btn sec" data-act="share">שיתוף</button>':''}
      <a class="btn sec" href="${esc(G.editUrl(id))}" target="_blank" rel="noopener">פתיחת הגיליון (לגבאי)</a></div>`;
}
function createdSheet(res){
  openSheet(sheetHead('הגיליון מוכן') + `
    ${G.hasGate() ? `<p>הגיליון נוצר בגוגל דרייב שלך, ורק את/ה יכול/ה לערוך אותו.</p>
    <p class="small muted">שלחו למתפללים את הקישור ללוח. הם יירשמו דרך הלוח, והרישום ייכתב בגיליון. בגיליון אפשר לתקן או למחוק רישומים.</p>`
    : `<p>הגיליון נוצר בגוגל דרייב שלך, וכל מי שיש לו את הקישור יכול לכתוב בו.</p>
    <p class="small muted">שלחו למתפללים את הקישור ללוח. בלוח, ליד כל שבת פנויה, יש כפתור שפותח את הגיליון בדיוק בשורה של אותה שבת.</p>`}
    ${res.formatted ? '' : '<div class="warn">חלק מהעיצוב של הגיליון (רשימת הבחירה והצבעים) לא הושלם. הגיליון עצמו תקין.</div>'}
    ${shareBlock(res.id)}`);
}
function settingsSheet(){
  const canExtend = G.hasClientId();
  openSheet(sheetHead('הגדרות הלוח', S.info.name) + shareBlock(S.id) + `
    <div class="sechead"><h2>לגבאי</h2></div>
    <p class="small muted" style="margin-top:0">שם בית הכנסת והמיקום נקבעים בלשונית "הגדרות" שבגיליון.</p>
    ${canExtend ? `<button class="btn sec" data-act="extend" ${G.ready()?'':'disabled'}>הוספת שנה נוספת לגיליון</button>
      <p class="meta">אפשרי רק מחשבון הגוגל שיצר את הגיליון.</p>` : ''}
    <div class="sechead"><h2>גיליון אחר</h2></div>
    <button class="btn danger" data-act="disconnect">ניתוק מהגיליון הזה</button>
    <p class="meta">הגיליון עצמו לא נמחק. אפשר לחזור אליו בכל עת דרך הקישור.</p>`);
  if (canExtend && !G.ready()) G.loadGis().then(() => { const b = $('[data-act="extend"]'); if (b) b.disabled = false; }, () => {});
}

/* ---------- Actions ---------- */
function slotsFrom(start, il){ const end = new Date(start); end.setDate(end.getDate()+YEAR_DAYS); return getSlots(start, end, il); }
function authError(e){
  console.warn(e);
  if (e && (e.type === 'popup_closed' || e.error === 'access_denied')) return 'ההתחברות לגוגל בוטלה';
  if (e && e.type === 'popup_failed_to_open') return 'הדפדפן חסם את חלון ההתחברות. אפשרו חלונות קופצים ונסו שוב.';
  if (e && (e.status === 403 || e.status === 404)) return 'אין הרשאה. אפשר לעשות זאת רק מחשבון הגוגל שיצר את הגיליון, דרך האתר הזה.';
  return 'הפעולה לא הצליחה. נסו שוב.';
}
const A = {
  prev: () => shiftMonth(-1), next: () => shiftMonth(1),
  today: () => { S.anchor = today0(); render(); },
  mode: d => { S.mode = d.m; store.set(LS_MODE, d.m); render(); },
  slot: d => slotSheet(d.k),
  close: closeSheet,
  refresh: () => refresh(),
  register: d => registerSheet(d.k),
  doRegister: async (d, btn) => {
    const v = id => $(id).value.trim();
    const data = { sponsor: v('#fSponsor'), dedic: v('#fDedic'), dname: v('#fDname'), reason: v('#fReason'), phone: v('#fPhone'), note: v('#fNote') };
    if (!data.sponsor){ $('#fSponsor').focus(); return toast('נא למלא את שם התורם'); }
    if (data.dedic && !data.dname){ $('#fDname').focus(); return toast('נא למלא את השם'); }
    if (!data.dedic) data.dname = '';
    btn.disabled = true; btn.textContent = 'שולח…';
    try {
      await G.register(S.id, d.k, data);
      closeSheet(); toast('נרשמת לקידוש. תודה!');
    } catch(e){
      console.warn(e);
      btn.disabled = false; btn.textContent = 'הרשמה';
      if (e.code === 'taken'){ closeSheet(); toast('מישהו אחר כבר נרשם לשבת הזו'); }
      else return toast(e.code === 'network' ? 'אין חיבור לאינטרנט. נסו שוב.' : 'ההרשמה לא נשמרה. נסו שוב.');
    }
    S.at = 0; refresh();
  },
  settings: settingsSheet,
  connect: () => {
    const id = G.idFrom($('#fLink').value);
    if (!id) return toast('הקישור לא נראה כמו קישור לגיליון גוגל');
    connect(id);
  },
  disconnect: () => {
    if (!confirm('לנתק את הלוח מהגיליון? הגיליון עצמו לא יימחק.')) return;
    store.set(LS_CACHE, null); closeSheet(); connect(null);
  },
  create: (d, btn) => {
    const name = $('#fName').value.trim(), il = $('#fIl').value === '1';
    if (!name){ $('#fName').focus(); return toast('נא למלא את שם בית הכנסת'); }
    const login = G.signIn(); // מיד בלחיצה, כדי שחלון ההתחברות לא ייחסם
    btn.disabled = true; btn.textContent = 'יוצר את הגיליון…';
    login.then(async () => {
      const res = await G.create({ name, il, siteBase: siteUrl(''), slots: slotsFrom(today0(), il) });
      connect(res.id); createdSheet(res);
    }).catch(e => { toast(authError(e)); btn.disabled = false; btn.textContent = 'יצירת הגיליון בגוגל'; });
  },
  extend: (d, btn) => {
    const login = G.signIn();
    btn.disabled = true; btn.textContent = 'מוסיף…';
    login.then(() => G.extend(S.id, start => slotsFrom(start, !!S.info.il))).then(n => {
      closeSheet(); toast(n ? 'נוספו '+n+' שורות לגיליון' : 'אין מה להוסיף'); refresh();
    }).catch(e => { toast(authError(e)); btn.disabled = false; btn.textContent = 'הוספת שנה נוספת לגיליון'; });
  },
  copy: async () => {
    const el = $('#shareUrl');
    try { await navigator.clipboard.writeText(el.value); toast('הקישור הועתק'); }
    catch(e){ el.select(); document.execCommand('copy'); toast('הקישור הועתק'); }
  },
  share: () => navigator.share({ title: 'לוח קידושים', text: 'לוח הקידושים של בית הכנסת. אפשר להירשם לקידוש דרך הלוח:', url: $('#shareUrl').value }).catch(() => {})
};

document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (t){ const f = A[t.dataset.act]; if (f){ e.preventDefault(); f(t.dataset, t); } return; }
  if (e.target === $('#sheetWrap')) closeSheet();
});
document.addEventListener('change', e => {
  if (e.target.id === 'fDedic'){ $('#dnameBox').hidden = !e.target.value; $('label[for="fDname"]').textContent = e.target.value ? 'שם ('+e.target.value+')' : 'שם'; }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#sheetWrap').hidden) closeSheet();
  if (e.key === 'Enter' && e.target.id === 'fLink') A.connect();
});

boot();
})();
