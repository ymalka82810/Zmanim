/**
 * תרומות לזמנים מיוחדים בקופה (convex/specialDonations.ts; הסוגים והנוסחים ב-js/special-donations.js).
 *
 * גבאי ורב: לשונית "זמנים מיוחדים" – פתיחה, עריכה וסגירה של תרומה (פדיון כפרות, מחצית השקל וכו'), הנוסח לכל עדה,
 * ורשימת התורמים. חבר קהילה: מעל "התרומות שלי" מוצגות התרומות הפתוחות; בחלון התרומה הוא בוחר נוסח (אשכנז, ספרד,
 * עדות המזרח), קורא אותו ורושם את התרומה על שמו כחוב פתוח בקופה.
 *
 * המודול עצמאי מ-js/app.js: הלשונית שלו מוסתרת ומוצגת כאן, והתצוגה שלו (#specialView) מחוץ ל-#view.
 */
import { MACHATZIT_GRAMS, NUSACHIM, SPECIAL_KINDS, SPECIAL_KIND_IDS, machatzitAmount, textLines } from '../../js/special-donations.js';

const Auth = window.SiteAuth;
const $ = (s, root = document) => root.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nf = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 2 });
const money = (n) => '₪' + nf.format(Number(n) || 0);
const errText = (e, fallback) => (e && typeof e.data === 'string' ? e.data : fallback);
const NUSACH_KEY = 'special-nusach';
const readNusach = () => { try { return localStorage.getItem(NUSACH_KEY) || ''; } catch (e) { return ''; } };
const writeNusach = (n) => { try { localStorage.setItem(NUSACH_KEY, n); } catch (e) { /* אחסון חסום */ } };

function toast(t) {
  const e = $('#toast');
  e.textContent = t;
  e.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => e.classList.remove('on'), 2200);
}

let sid = null, data = null, unsubscribe = null, active = false;
const call = (name, args) => Auth.client().mutation(name, Object.assign({ synagogueId: sid }, args));
const byId = (id) => data && data.items.find((s) => s.id === id);

// ---------- הלשונית והמקום בדף ----------
const view = document.createElement('section');
view.id = 'specialView';
view.className = 'wrap special';
view.hidden = true;
$('#view').before(view);

const tabBtn = document.createElement('button');
tabBtn.type = 'button';
tabBtn.setAttribute('role', 'tab');
tabBtn.setAttribute('aria-selected', 'false');
tabBtn.dataset.special = '1';
tabBtn.textContent = 'זמנים מיוחדים';
tabBtn.hidden = true;
const tabs = $('nav.tabs .in');
const after = $('button[data-tab="donations"]', tabs);
if (after) after.after(tabBtn); else tabs.append(tabBtn);

// לפני הטיפול של app.js בלשוניות: לחיצה על הלשונית הזו לא מגיעה אליו, ולחיצה על לשונית אחרת יוצאת מכאן
tabs.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b === tabBtn) {
    e.stopPropagation();
    active = true;
    window.scrollTo(0, 0);
  } else {
    active = false;
  }
  layout();
}, true);

// app.js מצייר מחדש את #view ואת הלשוניות כשהקופה מתעדכנת – מחזירים את מצב הלשונית הזו
new MutationObserver(() => layout()).observe($('#view'), { childList: true });

function layout() {
  const manager = !!(data && data.manager);
  tabBtn.hidden = !manager;
  if (manager && active) {
    tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b === tabBtn)));
    $('#view').hidden = true;
    $('#addBtn').hidden = true;
    view.hidden = false;
  } else {
    if (tabBtn.getAttribute('aria-selected') === 'true') tabBtn.setAttribute('aria-selected', 'false');
    $('#view').hidden = false;
    // חבר קהילה רואה כאן את התרומות הפתוחות, מעל "התרומות שלי"
    view.hidden = !(data && !manager && data.items.length);
  }
  if (!manager && active) active = false;
}

// ---------- תצוגה ----------
function kindTitle(s) {
  return SPECIAL_KINDS[s.kind] && SPECIAL_KINDS[s.kind].when ? SPECIAL_KINDS[s.kind].when : '';
}
const nusachList = (s) => Object.keys(NUSACHIM).filter((n) => s.texts && s.texts[n]);
const perPerson = (kind) => !!(SPECIAL_KINDS[kind] && SPECIAL_KINDS[kind].perPerson);

/** מחצית השקל לפי מחיר הכסף העדכני (convex/silverPrice.ts), או null אם עוד אין מחיר */
const silverAmount = () => (data && data.silver ? machatzitAmount(data.silver.ilsPerGram) : null);

/** הסכום המוצע: מה שהגבאי קבע, ובמחצית השקל בלי סכום קבוע – לפי מחיר הכסף. auto – שהסכום מחושב */
function amountOf(s) {
  if (s.amount) return { amount: s.amount, auto: false };
  if (perPerson(s.kind) && silverAmount()) return { amount: silverAmount(), auto: true };
  return { amount: null, auto: false };
}

function amountLine(s) {
  const a = amountOf(s);
  if (!a.amount) return '';
  if (!perPerson(s.kind)) return 'סכום מוצע: ' + money(a.amount);
  return `${money(a.amount)} לנפש` + (a.auto ? ` (שווי ${MACHATZIT_GRAMS} גרם כסף טהור לפי מחיר הכסף היום)` : '');
}

function memberCard(s) {
  const mine = s.mine.reduce((sum, t) => sum + t.amount, 0);
  const nus = nusachList(s);
  return `<article class="sp-card">
    <div class="sp-top"><h3>${esc(s.title)}</h3>${kindTitle(s) ? `<span class="sub">${esc(kindTitle(s))}</span>` : ''}</div>
    ${s.desc ? `<p>${esc(s.desc)}</p>` : ''}
    ${amountLine(s) ? `<div class="sub">${esc(amountLine(s))}</div>` : ''}
    ${mine ? `<div class="sp-mine">נרשמת לתרומה של ${money(mine)}${s.mine.every((t) => t.paid) ? ' · שולם' : ''}</div>` : ''}
    <div class="rowact"><button class="btn" data-give="${esc(s.id)}">${nus.length ? 'לנוסח ולתרומה' : 'לתרומה'}</button></div>
  </article>`;
}

function managerCard(s) {
  const nus = nusachList(s);
  const rows = s.entries.map((t) => `<tr><td><b>${esc(t.name || 'ללא שם')}</b>${t.forWhom ? `<span class="sub">${esc(t.forWhom)}</span>` : ''}</td>
    <td class="num">${money(t.amount)}</td>
    <td>${t.paid ? '<span class="pill ok">שולם</span>' : `<span class="pill no">לא שולם</span> <button class="lnk pay" data-pay="${esc(t.txId)}">סמן כשולם</button>`}</td></tr>`).join('');
  return `<article class="sp-card${s.status === 'closed' ? ' closed' : ''}">
    <div class="sp-top"><h3>${esc(s.title)}</h3><span class="pill ${s.status === 'open' ? 'ok' : 'no'}">${s.status === 'open' ? 'פתוחה' : 'סגורה'}</span></div>
    ${s.desc ? `<p>${esc(s.desc)}</p>` : ''}
    <div class="sub">${[amountLine(s), nus.length ? 'נוסח: ' + nus.map((n) => NUSACHIM[n]).join(', ') : 'בלי נוסח', s.guests ? 'פתוחה גם לאורחים' : ''].filter(Boolean).join(' · ')}</div>
    <div class="sp-sum"><span>${s.entries.length} תורמים</span><span>נרשם ${money(s.total)}</span><span>שולם ${money(s.paidTotal)}</span></div>
    <div class="rowact">
      <button class="lnk" data-give="${esc(s.id)}">רישום תרומה${nus.length ? ' / הנוסח' : ''}</button>
      <button class="lnk" data-edit="${esc(s.id)}">עריכה</button>
      <button class="lnk" data-toggle="${esc(s.id)}">${s.status === 'open' ? 'סגירה' : 'פתיחה מחדש'}</button>
      <button class="lnk del" data-del="${esc(s.id)}">מחיקה</button>
    </div>
    ${s.entries.length ? `<details class="sp-entries"><summary>רשימת התורמים</summary><div class="panel scroll"><table><tbody>${rows}</tbody></table></div></details>` : ''}
  </article>`;
}

function render() {
  if (!data) { view.innerHTML = ''; layout(); return; }
  if (data.manager) {
    view.innerHTML = `<h2>תרומות לזמנים מיוחדים</h2>
      <p class="sp-intro">פדיון כפרות, מחצית השקל, מתנות לאביונים, קמחא דפסחא ונדר צדקה ביזכור. תרומה פתוחה מוצגת לכל חברי הקהילה בקופה,
      עם הנוסח לפי העדה שהם בוחרים, וכל תרומה נרשמת בקופה כחוב פתוח על שם התורם.</p>
      <div class="bar"><button class="btn" id="spNew">פתיחת תרומה מיוחדת</button></div>
      ${data.items.length ? data.items.map(managerCard).join('') : '<div class="empty" style="padding-top:6vh">עדיין לא נפתחו תרומות מיוחדות.</div>'}`;
  } else {
    view.innerHTML = `<h2>תרומות לזמנים מיוחדים</h2>${data.items.map(memberCard).join('')}`;
  }
  layout();
}

view.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.id === 'spNew') return openEditor(null);
  if (b.dataset.give) return openGive(byId(b.dataset.give));
  if (b.dataset.edit) return openEditor(byId(b.dataset.edit));
  if (b.dataset.toggle) {
    const s = byId(b.dataset.toggle);
    if (!s) return;
    try { await call('specialDonations:setOpen', { id: s.id, open: s.status !== 'open' }); toast(s.status === 'open' ? 'התרומה נסגרה' : 'התרומה נפתחה מחדש'); }
    catch (err) { toast(errText(err, 'העדכון נכשל')); }
    return;
  }
  if (b.dataset.del) {
    const s = byId(b.dataset.del);
    if (!s) return;
    const text = s.entries.length ? `למחוק את "${s.title}" מהרשימה? ${s.entries.length} התרומות שנרשמו נשארות בקופה.` : `למחוק את "${s.title}"?`;
    if (!await SiteDialog.confirm(text, { ok: 'מחיקה', danger: true })) return;
    try { await call('specialDonations:remove', { id: s.id }); toast('נמחק'); } catch (err) { toast(errText(err, 'המחיקה נכשלה')); }
    return;
  }
  if (b.dataset.pay) {
    try { await call('fund:markPaid', { id: b.dataset.pay, paidDate: new Date().toLocaleDateString('en-CA') }); toast('סומן כשולם'); }
    catch (err) { toast(errText(err, 'העדכון נכשל')); }
  }
});

// ---------- חלון פתיחה ועריכה (גבאי ורב) ----------
const edlg = document.createElement('dialog');
edlg.innerHTML = `<form method="dialog" class="sp-form">
  <div class="dlg-h"><h3 id="spEdTitle">פתיחת תרומה מיוחדת</h3><button type="button" class="lnk" data-close>סגור</button></div>
  <div class="dlg-b">
    <div class="f" id="spKindWrap"><span>סוג</span><select name="kind">${SPECIAL_KIND_IDS.map((k) => `<option value="${k}">${esc(SPECIAL_KINDS[k].title || 'אחר (שם חופשי)')}</option>`).join('')}</select></div>
    <div class="f"><span>שם התרומה</span><input name="title" maxlength="80" required></div>
    <div class="f"><span>הסבר לתורמים</span><textarea name="desc" rows="3" maxlength="500"></textarea></div>
    <div class="f"><span id="spEdAmountLbl">סכום מוצע (₪, לא חובה)</span><input name="amount" type="number" inputmode="decimal" min="0" step="0.01"><div class="hint" id="spEdAmountHint"></div></div>
    <div class="f"><span>נוסחים להצגה</span>
      <div class="sp-nus">${Object.entries(NUSACHIM).map(([k, label]) => `<label class="check"><input type="checkbox" name="nus" value="${k}"> ${esc(label)}</label>`).join('')}</div>
      <div class="hint" id="spNusHint"></div></div>
    <div id="spTexts"></div>
    <label class="check"><input type="checkbox" name="guests"> פתוחה גם לאורחים (בעמוד האורחים ובקישור שלו)</label>
  </div>
  <div class="dlg-f"><button class="btn" type="submit" id="spEdSave">פתיחה</button><button class="btn ghost" type="button" data-close>ביטול</button></div>
</form>`;
document.body.append(edlg);
const ef = $('form', edlg);
let editing = null;

/**
 * הנוסחים שמוצעים כברירת מחדל: אלה של התרומה האחרונה מאותו סוג שנפתחה בקהילה (אולי תוקנו בה), ואם אין – כל
 * הנוסחים שבקובץ. texts – הנוסח לכל עדה, גם לעדה שלא הוצעה בפעם הקודמת (מהקובץ)
 */
function defaultTexts(kind) {
  const own = SPECIAL_KINDS[kind].texts || {};
  const prev = data && data.items.find((s) => s.kind === kind && Object.keys(s.texts || {}).length);
  return { offered: Object.keys(prev ? prev.texts : own), texts: Object.assign({}, own, prev && prev.texts) };
}

function amountField(kind) {
  const per = perPerson(kind);
  $('#spEdAmountLbl', edlg).textContent = per ? 'סכום לנפש (₪)' : 'סכום מוצע (₪, לא חובה)';
  const auto = silverAmount();
  $('#spEdAmountHint', edlg).textContent = !per ? '' : auto
    ? `השאירו ריק, והסכום יחושב לבד לפי מחיר הכסף ויתעדכן מעצמו בכל שנה. היום: ${money(auto)} (${MACHATZIT_GRAMS} גרם × ${money(data.silver.ilsPerGram)} לגרם).`
    : 'השאירו ריק, והסכום יחושב לבד לפי מחיר הכסף (המחיר עוד לא התקבל).';
}

function drawTexts(texts) {
  const box = $('#spTexts', edlg);
  const keep = {};
  box.querySelectorAll('textarea').forEach((t) => { keep[t.dataset.nus] = t.value; });
  const checked = [...ef.querySelectorAll('input[name=nus]:checked')].map((i) => i.value);
  box.innerHTML = checked.map((n) => `<div class="f"><span>הנוסח – ${esc(NUSACHIM[n])}</span>
    <textarea rows="7" data-nus="${n}" class="sp-ta">${esc(keep[n] != null ? keep[n] : (texts[n] || ''))}</textarea></div>`).join('');
  $('#spNusHint', edlg).textContent = checked.length
    ? 'שורה שמתחילה ב-* מוצגת כהוראה באותיות קטנות. כדאי שהרב יעבור על הנוסח לפני הפתיחה.'
    : 'בלי נוסח – התורמים יראו רק את ההסבר.';
}

function fillKind(kind) {
  const k = SPECIAL_KINDS[kind];
  ef.title.value = k.title;
  ef.desc.value = [k.desc, k.when ? 'מועד: ' + k.when + '.' : ''].filter(Boolean).join(' ');
  ef.amount.value = '';
  amountField(kind);
  const d = defaultTexts(kind);
  ef.querySelectorAll('input[name=nus]').forEach((i) => { i.checked = d.offered.includes(i.value); });
  $('#spTexts', edlg).innerHTML = '';
  drawTexts(d.texts);
}

function openEditor(s) {
  editing = s;
  ef.reset();
  $('#spEdTitle', edlg).textContent = s ? 'עריכת ' + s.title : 'פתיחת תרומה מיוחדת';
  $('#spEdSave', edlg).textContent = s ? 'שמירה' : 'פתיחה';
  $('#spKindWrap', edlg).hidden = !!s;
  if (s) {
    ef.kind.value = s.kind;
    ef.title.value = s.title;
    ef.desc.value = s.desc;
    ef.amount.value = s.amount || '';
    ef.guests.checked = !!s.guests;
    amountField(s.kind);
    ef.querySelectorAll('input[name=nus]').forEach((i) => { i.checked = !!s.texts[i.value]; });
    $('#spTexts', edlg).innerHTML = '';
    drawTexts(Object.assign({}, SPECIAL_KINDS[s.kind] && SPECIAL_KINDS[s.kind].texts, s.texts));
  } else {
    ef.kind.value = 'kaparot';
    fillKind('kaparot');
  }
  edlg.showModal();
}

ef.kind.addEventListener('change', () => fillKind(ef.kind.value));
ef.addEventListener('change', (e) => {
  if (e.target.name === 'nus') drawTexts(Object.assign({}, defaultTexts(editing ? editing.kind : ef.kind.value).texts, editing ? editing.texts : {}));
});
ef.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) edlg.close(); });
ef.addEventListener('submit', async (e) => {
  e.preventDefault();
  const texts = {};
  ef.querySelectorAll('textarea[data-nus]').forEach((t) => { if (t.value.trim()) texts[t.dataset.nus] = t.value; });
  const body = {
    kind: editing ? editing.kind : ef.kind.value,
    title: ef.title.value.trim(),
    desc: ef.desc.value.trim(),
    amount: parseFloat(ef.amount.value) || null,
    texts,
    guests: ef.guests.checked,
  };
  const btn = $('#spEdSave', edlg);
  btn.disabled = true;
  try {
    if (editing) await call('specialDonations:update', Object.assign({ id: editing.id }, body));
    else await call('specialDonations:open', body);
    edlg.close();
    toast(editing ? 'נשמר' : 'התרומה נפתחה לקהילה');
  } catch (err) { toast(errText(err, 'השמירה נכשלה. נסו שוב.')); }
  btn.disabled = false;
});

// ---------- חלון הנוסח והתרומה ----------
const gdlg = document.createElement('dialog');
gdlg.innerHTML = `<form method="dialog" class="sp-form">
  <div class="dlg-h"><h3 id="spGTitle"></h3><button type="button" class="lnk" data-close>סגור</button></div>
  <div class="dlg-b">
    <p id="spGDesc" class="sp-desc"></p>
    <div id="spGNus" class="seg" role="group" aria-label="נוסח"></div>
    <div id="spGText" class="sp-text"></div>
    <div id="spGWho" hidden>
      <div class="f"><span>חבר קהילה</span><select name="donor"></select></div>
      <div class="f"><span>שם התורם</span><input name="name" autocomplete="off"></div>
    </div>
    <div class="f" id="spGCountWrap"><span>מספר נפשות</span><input name="count" type="number" inputmode="numeric" min="1" max="99" step="1" value="1"><div class="hint" id="spGCountHint"></div></div>
    <div class="f"><span>סכום (₪)</span><input name="amount" type="number" inputmode="decimal" min="0" step="0.01" required></div>
    <div class="f" id="spGForWrap"><span id="spGForLbl"></span><input name="forWhom" maxlength="200" autocomplete="off"></div>
    <div id="spGPaid" hidden>
      <label class="check"><input type="checkbox" name="paid"> שולם</label>
      <div class="f"><span>אמצעי תשלום</span><select name="method"><option>מזומן</option><option>העברה בנקאית</option><option>צ׳ק</option><option>אשראי</option></select></div>
    </div>
    <div class="hint" id="spGHint"></div>
  </div>
  <div class="dlg-f"><button class="btn" type="submit" id="spGSave">רישום התרומה</button><button class="btn ghost" type="button" data-close>סגירה</button></div>
</form>`;
document.body.append(gdlg);
const gf = $('form', gdlg);
let giving = null, nusach = '';

function drawText() {
  const s = giving, list = nusachList(s);
  $('#spGNus', gdlg).hidden = list.length < 2;
  $('#spGNus', gdlg).innerHTML = list.map((n) => `<button type="button" data-nus="${n}" aria-pressed="${n === nusach}">${esc(NUSACHIM[n])}</button>`).join('');
  const lines = textLines(s.texts[nusach]);
  $('#spGText', gdlg).hidden = !lines.length;
  $('#spGText', gdlg).innerHTML = (list.length === 1 ? `<div class="sp-note">נוסח ${esc(NUSACHIM[nusach])}</div>` : '') +
    lines.map((l) => (l.note ? `<div class="sp-note">${esc(l.note)}</div>` : `<p class="sp-say">${esc(l.say)}</p>`)).join('');
}

/** בתרומה לנפש (מחצית השקל) הסכום הוא מספר הנפשות כפול הסכום לנפש; בשאר – הסכום המוצע */
function syncCount() {
  const a = amountOf(giving);
  if (!perPerson(giving.kind)) { gf.amount.value = a.amount || ''; return; }
  const n = Math.max(1, Math.round(Number(gf.count.value) || 1));
  gf.amount.value = a.amount ? a.amount * n : '';
  $('#spGCountHint', gdlg).textContent = a.amount ? `${money(a.amount)} לנפש${a.auto ? ` – שווי ${MACHATZIT_GRAMS} גרם כסף טהור לפי מחיר הכסף היום` : ''}` : '';
}

function openGive(s) {
  if (!s) return;
  giving = s;
  gf.reset();
  const list = nusachList(s);
  const saved = readNusach();
  nusach = list.includes(saved) ? saved : (list[0] || '');
  $('#spGTitle', gdlg).textContent = s.title;
  $('#spGDesc', gdlg).textContent = s.desc;
  drawText();
  const k = SPECIAL_KINDS[s.kind] || SPECIAL_KINDS.custom;
  $('#spGForWrap', gdlg).hidden = !k.forLabel;
  $('#spGForLbl', gdlg).textContent = k.forLabel;
  const per = perPerson(s.kind);
  $('#spGCountWrap', gdlg).hidden = !per;
  syncCount();
  const manager = data.manager;
  $('#spGWho', gdlg).hidden = !manager;
  $('#spGPaid', gdlg).hidden = !manager;
  if (manager) {
    gf.donor.innerHTML = '<option value="">לא חבר קהילה (שם חופשי)</option>' + data.members.map((m) => `<option value="${esc(m.userId)}">${esc(m.name)}</option>`).join('');
  }
  $('#spGHint', gdlg).textContent = manager
    ? (s.status === 'open' ? '' : 'התרומה סגורה לחברי הקהילה, אבל אפשר לרשום בה מכאן.')
    : 'התרומה תירשם בקופה כחוב פתוח על שמך עד שהגבאי יסמן אותה כשולמה.';
  gdlg.showModal();
  gdlg.querySelector('.dlg-b').scrollTop = 0;
}

gf.addEventListener('click', (e) => {
  const n = e.target.closest('button[data-nus]');
  if (n) { nusach = n.dataset.nus; writeNusach(nusach); drawText(); return; }
  if (e.target.closest('[data-close]')) gdlg.close();
});
gf.count.addEventListener('input', syncCount);
gf.donor.addEventListener('change', () => {
  const m = data.members.find((x) => x.userId === gf.donor.value);
  if (m) gf.name.value = m.name;
});
gf.addEventListener('submit', async (e) => {
  e.preventDefault();
  const amount = parseFloat(gf.amount.value);
  if (!(amount > 0)) { gf.amount.focus(); toast('יש להזין סכום גדול מאפס'); return; }
  const body = { id: giving.id, amount, forWhom: gf.forWhom.value.trim() };
  if (data.manager) {
    Object.assign(body, { donorId: gf.donor.value || null, name: gf.name.value.trim(), paid: gf.paid.checked, method: gf.method.value });
    if (!body.donorId && !body.name) { gf.name.focus(); toast('יש לבחור חבר קהילה או לכתוב שם'); return; }
  }
  const btn = $('#spGSave', gdlg);
  btn.disabled = true;
  try { await call('specialDonations:pledge', body); gdlg.close(); toast('התרומה נרשמה. תזכו למצוות!'); }
  catch (err) { toast(errText(err, 'הרישום נכשל. נסו שוב.')); }
  btn.disabled = false;
});

// ---------- התחייבויות של אורחים (convex/guest.ts) ----------
// אורח שתרם מעמוד האורחים לא נרשם בקופה עד שגבאי או רב מאשרים. הרשימה מוצגת בראש הדף בכל הלשוניות, כל עוד יש בה משהו
const pledgeBox = document.createElement('section');
pledgeBox.className = 'wrap gp';
pledgeBox.hidden = true;
view.before(pledgeBox);
let pledges = [], unwatchPledges = null;
const pledgeDate = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function renderPledges() {
  pledgeBox.hidden = !pledges.length;
  if (!pledges.length) { pledgeBox.innerHTML = ''; return; }
  pledgeBox.innerHTML = `<h2>תרומות מאורחים שממתינות לאישור (${pledges.length})</h2>
    <p class="sp-intro">אורחים התחייבו לתרום דרך עמוד האורחים. באישור התרומה נרשמת בקופה על שם האורח. כדאי לוודא מול האורח לפני האישור.</p>
    ${pledges.map((p) => `<article class="sp-card gp-card">
      <div class="sp-top"><h3>${esc(p.name)} · ${money(p.amount)}</h3><span class="sub">${esc(pledgeDate.format(p.at))}</span></div>
      <div>${esc(p.title)}${p.forWhom ? ` – ${esc(p.forWhom)}` : ''}</div>
      <div class="sub"><a href="tel:${esc(p.phone.replace(/[^\d+]/g, ''))}" dir="ltr">${esc(p.phone)}</a></div>
      <div class="rowact">
        <button class="lnk pay" data-gp-accept="${esc(p.id)}">אישור (לא שולם)</button>
        <button class="lnk pay" data-gp-paid="${esc(p.id)}">אישור כשולם</button>
        <button class="lnk del" data-gp-reject="${esc(p.id)}">דחייה</button>
      </div>
    </article>`).join('')}`;
}

pledgeBox.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const p = pledges.find((x) => x.id === (b.dataset.gpAccept || b.dataset.gpPaid || b.dataset.gpReject));
  if (!p) return;
  if (b.dataset.gpReject) {
    if (!await SiteDialog.confirm(`לדחות את ההתחייבות של ${p.name} (${money(p.amount)})? היא לא תירשם בקופה.`, { ok: 'דחייה', danger: true })) return;
    try { await call('guest:rejectPledge', { id: p.id }); toast('נדחתה'); } catch (err) { toast(errText(err, 'העדכון נכשל')); }
    return;
  }
  const paid = !!b.dataset.gpPaid;
  b.disabled = true;
  try { await call('guest:acceptPledge', { id: p.id, paid, method: paid ? 'העברה בנקאית' : '' }); toast(paid ? 'נרשם בקופה כשולם' : 'נרשם בקופה כחוב פתוח'); }
  catch (err) { toast(errText(err, 'האישור נכשל')); b.disabled = false; }
});

function watchPledges() {
  const want = !!(data && data.manager) && sid;
  if (want && !unwatchPledges) {
    unwatchPledges = Auth.watch('guest:pledges', { synagogueId: sid }, (list) => { pledges = list || []; renderPledges(); },
      (e) => { console.warn(e); pledges = []; renderPledges(); });
  } else if (!want && unwatchPledges) {
    unwatchPledges(); unwatchPledges = null;
    pledges = []; renderPledges();
  }
}

// ---------- טעינה ----------
function subscribe() {
  const id = Auth.isAuthenticated() ? Auth.activeSynagogueId() : null;
  if (id === sid && (unsubscribe || !id)) return;
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  if (unwatchPledges) { unwatchPledges(); unwatchPledges = null; }
  sid = id;
  data = null;
  pledges = [];
  render();
  renderPledges();
  watchPledges();
  if (!id) return;
  unsubscribe = Auth.watch('specialDonations:list', { synagogueId: id }, (d) => { data = d; render(); watchPledges(); },
    (e) => { console.warn(e); data = null; render(); watchPledges(); });
}
Auth.onChange(() => {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  if (unwatchPledges) { unwatchPledges(); unwatchPledges = null; }
  sid = undefined;
  subscribe();
});
// app.js בוחר את הקהילה הפעילה אחרי הטעינה, ולכן בודקים מדי פעם אם היא השתנתה
setInterval(subscribe, 2000);
subscribe();
