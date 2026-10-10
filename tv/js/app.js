/* מסך טלוויזיה לבית הכנסת (tv/?c=קוד): שעון, תאריך עברי, זמני היום והלוח המאושר, במסך מלא.
 * משתמש באותו קוד ציבורי של עמוד האורחים (convex/guest.ts), בלי התחברות. הדף מתעדכן לבד.
 * מה שהגבאים ערכו מהטלפון ואישרו (screen/, convex/tv.ts): שקופיות הודעה שמתחלפות עם הלוחות, פס רץ, אילו חלקים
 * מוצגים, ולאן מוביל ה-QR – לעמוד האורחים, או ישר לתרומה בזמנים מיוחדים */
import { CITIES } from '../../js/config.js';
import { zmanim, roundZman } from '../../js/zmanim.js';
import { todayIn, dow, hm, toDayNum } from '../../js/dates.js';
import { hebDateString, yomTov, cholHamoed, parasha } from '../../js/hebrew.js';

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const code = new URLSearchParams(location.search).get('c') || '';
const TZ = 'Asia/Jerusalem';
const MIN = 60000;
const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const DEFAULT_SCREEN = { slides: [], ticker: '', show: { zmanim: true, board: true, qr: true }, rotateSec: 20, qr: 'guest', qrText: '' };
const isoToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

/** QR לעמוד האורחים באותו אתר שהמסך נפתח ממנו. donate – ישר לתרומה */
function qrSvg(donate){
  if (!window.qrcode) return '';
  const url = new URL('../guest/', location.href);
  url.searchParams.set('c', code);
  if (donate) url.searchParams.set('donate', '1');
  const q = window.qrcode(0, 'M');
  q.addData(url.toString());
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}
const QR = { guest: qrSvg(false), donate: qrSvg(true) };

let aliyot = [], board = null, screen = DEFAULT_SCREEN, slide = 0, built = '', shownHead = '', shownZm = '', rotateTimer = null;

/** הקהילה שומרת עיר בטקסט חופשי; מתאימים לפי שם. בלי התאמה לא מציגים זמני יום, כדי לא להציג זמנים של עיר אחרת */
const cityOf = name => {
  const n = String(name || '').trim();
  return n ? CITIES.find(c => n.includes(c[1]) || c[1].includes(n)) : undefined;
};

function message(text){ built = ''; $('app').className = 'tv'; $('app').innerHTML = `<div class="tv-msg">${esc(text)}</div>`; }

function dayInfo(b){
  const dn = todayIn(TZ), il = b.il !== false;
  const tags = [];
  if (dow(dn) === 6) tags.push('שבת קודש');
  const yt = yomTov(dn, il), chm = cholHamoed(dn, il);
  if (yt) tags.push(yt);
  if (chm) tags.push('חול המועד ' + chm);
  const p = dow(dn) >= 5 ? parasha(dn + (6 - dow(dn)), il) : null;
  if (p) tags.push('פרשת ' + p);
  return { dn, dayName: 'יום ' + DAYS[dow(dn)], heb: hebDateString(dn), tags };
}

function zmanRows(b, dn){
  const c = cityOf(b.city);
  if (!c) return null;
  const z = zmanim(dn, c[2], c[3]);
  const list = [
    ['עלות השחר', roundZman('alotHaShachar', z.alotHaShachar)], ['הנץ', roundZman('sunrise', z.sunrise)],
    ['סוף זמן ק"ש (מג"א)', roundZman('sofZmanShmaMGA', z.sofZmanShmaMGA)], ['סוף זמן ק"ש (גר"א)', roundZman('sofZmanShma', z.sofZmanShma)],
    ['חצות', roundZman('chatzot', z.chatzot)], ['מנחה גדולה', roundZman('minchaGedola', z.minchaGedola)],
    ['פלג המנחה', roundZman('plagHaMincha', z.plagHaMincha)],
  ];
  if (dow(dn) === 5 && z.sunset != null) list.push(['הדלקת נרות', Math.floor((z.sunset - c[4] * MIN) / MIN) * MIN, true]);
  list.push(['שקיעה', roundZman('sunset', z.sunset)], [dow(dn) === 6 ? 'צאת השבת' : 'צאת הכוכבים', roundZman('tzeit', z.tzeit)]);
  return list.filter(x => x[1] != null).map(x => ({ name: x[0], ms: x[1], key: !!x[2] }));
}

function drawZmanim(b, info){
  const rows = zmanRows(b, info.dn);
  if (!rows) return '';
  const now = Date.now(), next = rows.find(x => x.ms > now);
  return '<h2>זמני היום</h2>' + rows.map(x =>
    `<div class="tv-row${x.ms <= now ? ' past' : ''}${x === next ? ' next' : ''}${x.key ? ' key' : ''}"><span>${esc(x.name)}</span><span>${hm(x.ms, TZ)}</span></div>`).join('')
    + `<div class="tv-note">${esc(b.city)}</div>`;
}

function drawQr(){
  if (!screen.show.qr) return '';
  const svg = QR[screen.qr] || QR.guest;
  if (!svg) return '';
  const text = screen.qrText || (screen.qr === 'donate' ? 'סרקו לתרומה לבית הכנסת' : 'סרקו לזמני בית הכנסת בטלפון');
  return `<div class="tv-qr${screen.qr === 'donate' ? ' donate' : ''}">${svg}<div>${esc(text)}</div></div>`;
}

/** מה שמתחלף באזור המרכזי: הלוחות המאושרים (אם מוצגים) ושקופיות ההודעה שבתוקף היום */
function items(){
  const today = isoToday();
  const files = screen.show.board ? (board.files || []).filter(f => f.url).map(f => ({ file: f })) : [];
  const slides = screen.slides.filter(s => (!s.from || s.from <= today) && (!s.to || s.to >= today)).map(s => ({ slide: s }));
  return files.concat(aliyot.map(d => ({ aliyot: d })), slides);
}

/** שקופית עליות של יום אחד, מהמכרזים שנסגרו: איזו עלייה ומי עולה בה */
function aliyotSlide(d){
  const dn = toDayNum(d.dateKey), il = board.il !== false;
  const tag = yomTov(dn, il) || (dow(dn) === 6 && parasha(dn, il) ? 'פרשת ' + parasha(dn, il) : '');
  return `<div class="tv-aliyot"><h2>עליות לתורה</h2>
    <div class="tv-aliyot-day">יום ${DAYS[dow(dn)]} · ${esc(hebDateString(dn))}${tag ? ' · ' + esc(tag) : ''}</div>
    ${d.items.map(x => `<div class="tv-aliyot-row"><span>${esc(x.title)}</span><b>${esc(x.name)}</b></div>`).join('')}</div>`;
}

function drawMain(){
  const list = items(), el = $('tvBoard');
  if (!el) return;
  if (!list.length) {
    el.className = 'tv-board';
    el.innerHTML = '<div class="tv-empty">עדיין אין לוח זמנים מפורסם</div>';
    return;
  }
  const it = list[slide % list.length];
  if (it.file) {
    el.className = 'tv-board';
    el.innerHTML = `<img src="${esc(it.file.url)}" alt="${esc(it.file.title)}">${list.length > 1 ? `<div class="tv-title">${esc(it.file.title)}</div>` : ''}`;
  } else if (it.aliyot) {
    el.className = 'tv-board tv-slide';
    el.innerHTML = aliyotSlide(it.aliyot);
  } else {
    el.className = 'tv-board tv-slide';
    el.innerHTML = `<div>${it.slide.title ? `<h2>${esc(it.slide.title)}</h2>` : ''}${it.slide.text ? `<p>${esc(it.slide.text)}</p>` : ''}</div>`;
  }
}

function startTicker(){
  const box = $('tvTicker');
  if (!box) return;
  const span = box.firstElementChild;
  // מתחיל מחוץ למסך משמאל ונע ימינה, כך שתחילת המשפט (בצד ימין שלו) נכנסת ראשונה
  const travel = box.clientWidth + span.offsetWidth;
  span.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${travel}px)` }],
    { duration: travel / 0.12, iterations: Infinity });
}

/** בונה את המסך מחדש כשהלוח או הגדרות המסך משתנים */
function build(){
  const aside = screen.show.zmanim || screen.show.qr;
  const sig = JSON.stringify([screen, board.name, board.city, board.il, board.files, aliyot]);
  if (sig === built) return;
  built = sig;
  shownHead = shownZm = '';
  const app = $('app');
  app.className = 'tv' + (aside ? '' : ' no-aside') + (screen.ticker ? ' with-ticker' : '');
  app.innerHTML = `<header class="tv-head" id="tvHead"></header>
    <main class="tv-board" id="tvBoard"></main>
    ${aside ? '<aside class="tv-zm" id="tvZm"></aside>' : ''}
    ${screen.ticker ? `<footer class="tv-ticker" id="tvTicker"><span>${esc(screen.ticker)}</span></footer>` : ''}`;
  slide = 0;
  drawMain();
  tick();
  startTicker();
  clearInterval(rotateTimer);
  rotateTimer = setInterval(rotate, screen.rotateSec * 1000);
}

function tick(){
  if (!board || !built) return;
  const info = dayInfo(board);
  const head = `<div><h1 class="tv-name">${esc(board.name)}</h1>
      <div class="tv-dates">${esc(info.dayName)} · <b>${esc(info.heb)}</b>${info.tags.map(t => ' · ' + esc(t)).join('')}</div></div>
      <div class="tv-clock">${hm(Date.now(), TZ)}</div>`;
  if (head !== shownHead) { shownHead = head; $('tvHead').innerHTML = head; }
  const zmEl = $('tvZm');
  if (zmEl) {
    const zm = (screen.show.zmanim ? drawZmanim(board, info) : '') + drawQr();
    if (zm !== shownZm) { shownZm = zm; zmEl.innerHTML = zm; }
  }
}

function rotate(){
  if (!board || items().length < 2) return;
  slide++;
  drawMain();
}

async function keepAwake(){
  try { if (navigator.wakeLock) await navigator.wakeLock.request('screen'); } catch (e) { /* לא נתמך */ }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) keepAwake(); });

if (!code) message('חסר קוד בקישור. הקישור למסך נמצא ב"החשבון שלי" ← הקהילה ← עמוד לאורחים.');
else {
  keepAwake();
  const client = new window.convex.ConvexClient(window.CONVEX_URL);
  client.onUpdate('guest:board', { code }, b => {
    if (b === null) { board = null; return message('הקישור לא תקף, או שהקהילה כיבתה את עמוד האורחים.'); }
    board = b; build();
  }, () => { if (!board) message('לא ניתן לטעון את הנתונים כרגע. נסו לרענן את העמוד.'); });
  client.onUpdate('tv:live', { code }, s => {
    screen = s || DEFAULT_SCREEN;
    if (board) build();
  }, () => { /* נשארים עם ההגדרות האחרונות */ });
  client.onUpdate('tv:aliyot', { code }, d => {
    aliyot = d || [];
    if (board) build();
  }, () => { /* בלי שקופית עליות */ });
  setInterval(tick, 1000);
  // שקופית שתוקפה התחיל או נגמר בחצות
  setInterval(() => { if (board) drawMain(); }, 10 * MIN);
}
