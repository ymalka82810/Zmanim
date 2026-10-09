/* מסך טלוויזיה לבית הכנסת (tv/?c=קוד): שעון, תאריך עברי, זמני היום והלוח המאושר, במסך מלא.
 * משתמש באותו קוד ציבורי של עמוד האורחים (convex/guest.ts), בלי התחברות. הדף מתעדכן לבד. */
import { CITIES } from '../../js/config.js';
import { zmanim, roundZman } from '../../js/zmanim.js';
import { todayIn, dow, hm } from '../../js/dates.js';
import { hebDateString, yomTov, cholHamoed, parasha } from '../../js/hebrew.js';

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const code = new URLSearchParams(location.search).get('c') || '';
const TZ = 'Asia/Jerusalem';
const ROTATE_MS = 20000;
const MIN = 60000;
const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/** QR לעמוד האורחים באותו אתר שהמסך נפתח ממנו */
function qrSvg(){
  if (!window.qrcode) return '';
  const url = new URL('../guest/', location.href);
  url.searchParams.set('c', code);
  const q = window.qrcode(0, 'M');
  q.addData(url.toString());
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}
const QR = qrSvg();
const drawQr = () => QR ? `<div class="tv-qr">${QR}<div>סרקו לזמני בית הכנסת בטלפון</div></div>` : '';

let board = null, slide = 0, shown = '';

/** הקהילה שומרת עיר בטקסט חופשי; מתאימים לפי שם. בלי התאמה לא מציגים זמני יום, כדי לא להציג זמנים של עיר אחרת */
const cityOf = name => {
  const n = String(name || '').trim();
  return n ? CITIES.find(c => n.includes(c[1]) || c[1].includes(n)) : undefined;
};

function message(text){ $('app').innerHTML = `<div class="tv-msg">${esc(text)}</div>`; }

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

function drawBoard(){
  const files = (board.files || []).filter(f => f.url);
  if (!files.length) return '<div class="tv-empty">עדיין אין לוח זמנים מפורסם</div>';
  const f = files[slide % files.length];
  return `<img src="${esc(f.url)}" alt="${esc(f.title)}">${files.length > 1 ? `<div class="tv-title">${esc(f.title)}</div>` : ''}`;
}

function tick(){
  if (!board) return;
  const info = dayInfo(board);
  const head = `<div><h1 class="tv-name">${esc(board.name)}</h1>
      <div class="tv-dates">${esc(info.dayName)} · <b>${esc(info.heb)}</b>${info.tags.map(t => ' · ' + esc(t)).join('')}</div></div>
      <div class="tv-clock">${hm(Date.now(), TZ)}</div>`;
  const zm = drawZmanim(board, info);
  const sig = head + zm;
  if (sig === shown) return;
  shown = sig;
  $('app').innerHTML = `<header class="tv-head">${head}</header>
    <main class="tv-board" id="tvBoard">${drawBoard()}</main>
    <aside class="tv-zm">${zm}${drawQr()}</aside>`;
}

function rotate(){
  const el = $('tvBoard');
  if (!board || !el || (board.files || []).filter(f => f.url).length < 2) return;
  slide++;
  el.innerHTML = drawBoard();
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
    board = b; shown = ''; tick();
  }, () => { if (!board) message('לא ניתן לטעון את הנתונים כרגע. נסו לרענן את העמוד.'); });
  setInterval(tick, 1000);
  setInterval(rotate, ROTATE_MS);
}
