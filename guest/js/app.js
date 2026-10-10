/* העמוד הציבורי לאורחים (guest/?c=קוד): זמני השבוע וכתובת בית הכנסת, לקריאה בלבד ובלי התחברות.
 * הגבאי או הרב מפעילים אותו ב"החשבון שלי" ← הקהילה ← עמוד לאורחים (convex/guest.ts).
 * בתחתית: תרומה לבית הכנסת. אורח מתחייב לתרומה כללית, לתרומה לזמן מיוחד או למגבית שהגבאי פתח גם לאורחים,
 * וההתחייבות ממתינה לגבאי. אחרי השליחה מוצגים פרטי התשלום שהגבאי הגדיר. guest/?c=קוד&donate=1 (ה-QR של מסך
 * הטלוויזיה בזמנים מיוחדים) מוביל ישר לתרומה */
import { MACHATZIT_GRAMS, NUSACHIM, SPECIAL_KINDS, machatzitAmount, textLines } from '../../js/special-donations.js';

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const MODE = { holy: 'שבתות וחגים', days: 'ימות השבוע', events: 'מודעת אירוע' };
const params = new URLSearchParams(location.search);
const code = params.get('c') || '';
let jumpToDonate = params.get('donate') === '1';
const isApp = () => !!(window.NativeFiles && NativeFiles.isApp());
const nf = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 2 });
const money = n => '₪' + nf.format(Number(n) || 0);
const errText = (e, fallback) => (e && typeof e.data === 'string' ? e.data : fallback);
const DONOR_KEY = 'guest.donor';
const readDonor = () => { try { return JSON.parse(localStorage.getItem(DONOR_KEY)) || {}; } catch (e) { return {}; } };
const writeDonor = d => { try { localStorage.setItem(DONOR_KEY, JSON.stringify(d)); } catch (e) { /* אחסון חסום */ } };

let client = null, board = null;

function toast(text){
  const t = document.createElement('div');
  t.className = 'guest-toast'; t.setAttribute('role', 'status'); t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

function message(text){
  $('app').innerHTML = `<div class="empty">${esc(text)}</div>`;
}

const mapsLinks = q => {
  const e = encodeURIComponent(q);
  return `<a class="btn sec" href="https://waze.com/ul?q=${e}&navigate=yes">ניווט ב-Waze</a>
    <a class="btn sec" href="https://www.google.com/maps/search/?api=1&query=${e}">Google Maps</a>`;
};

// ---------- תרומות ----------
const perPerson = kind => !!(SPECIAL_KINDS[kind] && SPECIAL_KINDS[kind].perPerson);
const nusachList = s => Object.keys(NUSACHIM).filter(n => s.texts && s.texts[n]);

/** הסכום המוצע: מה שהגבאי קבע, ובמחצית השקל בלי סכום קבוע – לפי מחיר הכסף */
function amountOf(s){
  if (s.amount) return { amount: s.amount, auto: false };
  const silver = board && board.donate.silver;
  if (perPerson(s.kind) && silver) return { amount: machatzitAmount(silver.ilsPerGram), auto: true };
  return { amount: null, auto: false };
}

function donateSection(d){
  const special = s => {
    const a = amountOf(s);
    const line = !a.amount ? '' : perPerson(s.kind) ? `${money(a.amount)} לנפש` : `סכום מוצע: ${money(a.amount)}`;
    return `<article class="gd-card">
      <h3>${esc(s.title)}</h3>
      ${s.desc ? `<p>${esc(s.desc)}</p>` : ''}
      ${line ? `<div class="sub">${esc(line)}</div>` : ''}
      <button type="button" class="btn" data-special="${esc(s.id)}">${nusachList(s).length ? 'לנוסח ולתרומה' : 'לתרומה'}</button>
    </article>`;
  };
  const campaign = c => {
    const pct = c.goal > 0 ? Math.min(100, c.pledged / c.goal * 100) : 0;
    return `<article class="gd-card">
      ${c.imageUrl ? `<img src="${esc(c.imageUrl)}" alt="" loading="lazy">` : ''}
      <h3>${esc(c.title)}</h3>
      ${c.desc ? `<p>${esc(c.desc)}</p>` : ''}
      <div class="gd-prog" role="meter" aria-valuemin="0" aria-valuemax="${c.goal}" aria-valuenow="${c.pledged}" aria-label="נאסף למגבית"><span style="width:${pct.toFixed(1)}%"></span></div>
      <div class="sub">${money(c.pledged)} מתוך ${money(c.goal)} · נותרו ${money(c.left)}</div>
      <button type="button" class="btn" data-campaign="${esc(c.id)}">תרומה למגבית</button>
    </article>`;
  };
  return `<section class="gd" id="donate">
    <h2>תרומה לבית הכנסת</h2>
    ${d.specials.map(special).join('')}
    ${d.campaigns.map(campaign).join('')}
    <article class="gd-card">
      <h3>תרומה כללית</h3>
      <p>לצורכי בית הכנסת והקהילה.</p>
      <button type="button" class="btn${d.specials.length || d.campaigns.length ? ' sec' : ''}" data-general="1">תרומה</button>
    </article>
  </section>`;
}

function render(b){
  board = b;
  document.title = 'זמני ' + b.name;
  const place = [b.address, b.city].filter(Boolean).join(', ');
  const target = isApp() ? '' : ' target="_blank" rel="noopener"';
  $('app').innerHTML = `
    <header class="guest-head">
      <h1>${esc(b.name)}</h1>
      <p class="where">${esc(place)}</p>
      <div class="guest-actions">
        ${b.address ? mapsLinks(place) : ''}
        <a class="btn sec" href="#donate">תרומה</a>
        <button type="button" class="btn sec" id="btnShare">שיתוף העמוד</button>
      </div>
    </header>
    ${b.files.length ? b.files.map(f => `
      <section class="guest-file">
        <h2>${esc(f.title)}</h2>
        <p class="kind">${MODE[f.mode] || ''}</p>
        ${f.url ? `<a href="${esc(f.url)}"${target}><img src="${esc(f.url)}" alt="${esc(f.title)}"></a>` : ''}
      </section>`).join('')
      : '<div class="empty">עדיין אין לוח זמנים מפורסם לשבוע הזה.</div>'}
    ${donateSection(b.donate)}
    <p class="guest-foot">שבת שלום! העמוד מתעדכן אוטומטית כשהגבאי מפרסם לוח חדש.</p>`;
  $('btnShare').onclick = () => share(b.name);
  if (jumpToDonate) {
    jumpToDonate = false;
    requestAnimationFrame(() => $('donate').scrollIntoView());
  }
}

$('app').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || !board) return;
  const d = board.donate;
  if (b.dataset.special) openGive({ type: 'special', item: d.specials.find(s => s.id === b.dataset.special) });
  else if (b.dataset.campaign) openGive({ type: 'campaign', item: d.campaigns.find(c => c.id === b.dataset.campaign) });
  else if (b.dataset.general) openGive({ type: 'general' });
});

// ---------- חלון התרומה ----------
const dlg = document.createElement('dialog');
dlg.className = 'gd-dlg';
document.body.append(dlg);
let giving = null, nusach = '';

function drawText(){
  const s = giving.item, list = nusachList(s), lines = textLines(s.texts[nusach]);
  if (!lines.length) return '';
  return `${list.length > 1 ? `<div class="seg" role="group" aria-label="נוסח">${list.map(n => `<button type="button" data-nus="${n}" aria-pressed="${n === nusach}">${esc(NUSACHIM[n])}</button>`).join('')}</div>`
    : `<div class="gd-note">נוסח ${esc(NUSACHIM[nusach])}</div>`}
    <div class="gd-text">${lines.map(l => l.note ? `<div class="gd-note">${esc(l.note)}</div>` : `<p>${esc(l.say)}</p>`).join('')}</div>`;
}

function openGive(g){
  if (g.type !== 'general' && !g.item) return;
  giving = g;
  const s = g.type === 'special' ? g.item : null;
  if (s) {
    const list = nusachList(s);
    nusach = list[0] || '';
  }
  const kind = s ? (SPECIAL_KINDS[s.kind] || SPECIAL_KINDS.custom) : null;
  const a = s ? amountOf(s) : { amount: null };
  const per = s && perPerson(s.kind);
  const title = g.type === 'general' ? 'תרומה לבית הכנסת' : g.type === 'campaign' ? 'תרומה למגבית: ' + g.item.title : s.title;
  const forLabel = kind ? kind.forLabel : 'הקדשה (לא חובה)';
  const donor = readDonor();
  dlg.innerHTML = `<form method="dialog" class="gd-form">
    <div class="gd-h"><h3>${esc(title)}</h3><button type="button" class="btn ghost" data-close>סגירה</button></div>
    <div class="gd-b">
      ${s && s.desc ? `<p class="muted">${esc(s.desc)}</p>` : ''}
      <div id="gdText">${s ? drawText() : ''}</div>
      ${per ? `<label class="f" for="gdCount">מספר נפשות</label><input type="number" id="gdCount" name="count" inputmode="numeric" min="1" max="99" step="1" value="1">
        ${a.amount ? `<div class="hint">${money(a.amount)} לנפש${a.auto ? ` – שווי ${MACHATZIT_GRAMS} גרם כסף טהור לפי מחיר הכסף היום` : ''}</div>` : ''}` : ''}
      <label class="f" for="gdAmount">סכום (₪)</label>
      <input type="number" id="gdAmount" name="amount" inputmode="decimal" min="1" step="any" required value="${a.amount || ''}">
      ${g.type === 'campaign' ? `<div class="hint">אפשר לתרום עד ${money(g.item.left)}</div>` : ''}
      ${forLabel ? `<label class="f" for="gdFor">${esc(forLabel)}</label><input type="text" id="gdFor" name="forWhom" maxlength="200" autocomplete="off">` : ''}
      <label class="f" for="gdName">שם</label>
      <input type="text" id="gdName" name="name" maxlength="80" autocomplete="name" required value="${esc(donor.name || '')}">
      <label class="f" for="gdPhone">טלפון</label>
      <input type="tel" id="gdPhone" name="phone" maxlength="30" autocomplete="tel" dir="ltr" required value="${esc(donor.phone || '')}">
      <div class="hint">הגבאי יקבל את ההתחייבות ויוכל ליצור איתך קשר. בשלב הבא יוצגו פרטי התשלום.</div>
    </div>
    <div class="gd-f"><button class="btn" type="submit">שליחת ההתחייבות</button></div>
  </form>`;
  dlg.showModal();
  dlg.querySelector('.gd-b').scrollTop = 0;
}

function showThanks(amount){
  const d = board.donate;
  dlg.innerHTML = `<div class="gd-form">
    <div class="gd-h"><h3>תודה רבה! תזכו למצוות</h3><button type="button" class="btn ghost" data-close>סגירה</button></div>
    <div class="gd-b">
      <p>ההתחייבות לתרומה של <b>${money(amount)}</b> נשלחה לגבאי.</p>
      ${d.payText || d.payLink ? `<h4>איך משלמים</h4>
        ${d.payText ? `<p class="gd-pay">${esc(d.payText)}</p>` : ''}
        ${d.payLink ? `<a class="btn" href="${esc(d.payLink)}" target="_blank" rel="noopener">לתשלום</a>` : ''}`
        : '<p class="muted">הגבאי ייצור איתך קשר לגבי התשלום.</p>'}
    </div>
  </div>`;
}

dlg.addEventListener('click', e => {
  if (e.target === dlg || e.target.closest('[data-close]')) { dlg.close(); return; }
  const n = e.target.closest('button[data-nus]');
  if (n) { nusach = n.dataset.nus; $('gdText').innerHTML = drawText(); }
});
dlg.addEventListener('input', e => {
  if (e.target.name !== 'count' || !giving.item) return;
  const a = amountOf(giving.item);
  if (a.amount) dlg.querySelector('[name=amount]').value = a.amount * Math.max(1, Math.round(Number(e.target.value) || 1));
});
dlg.addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target;
  const amount = parseFloat(f.amount.value);
  if (!(amount > 0)) { f.amount.focus(); toast('יש להזין סכום גדול מאפס'); return; }
  const body = { code, amount, name: f.name.value.trim(), phone: f.phone.value.trim(), forWhom: f.forWhom ? f.forWhom.value.trim() : '' };
  if (giving.type === 'special') body.specialId = giving.item.id;
  if (giving.type === 'campaign') body.campaignId = giving.item.id;
  const btn = f.querySelector('[type=submit]');
  btn.disabled = true;
  try {
    await client.mutation('guest:pledge', body);
    writeDonor({ name: body.name, phone: body.phone });
    showThanks(amount);
  } catch (err) {
    toast(errText(err, 'השליחה נכשלה. נסו שוב.'));
    btn.disabled = false;
  }
});

async function share(name){
  const url = window.SiteAuth ? SiteAuth.publicUrl(location.href) : location.href;
  let r;
  try { r = await NativeFiles.share({ title: 'זמני ' + name, url }); } catch (e) { r = 'unsupported'; }
  if (r !== 'unsupported') return;
  try { await navigator.clipboard.writeText(url); toast('הקישור הועתק'); }
  catch (e) { toast('העתקה נכשלה'); }
}

if (!code) message('חסר קוד בקישור. בקשו מהגבאי את הקישור לעמוד האורחים.');
else {
  client = new window.convex.ConvexClient(window.CONVEX_URL);
  client.onUpdate('guest:board', { code }, b => {
    if (b === null) message('הקישור לא תקף, או שהקהילה כיבתה את עמוד האורחים.');
    else render(b);
  }, () => message('לא ניתן לטעון את הזמנים כרגע. נסו לרענן את העמוד.'));
}
