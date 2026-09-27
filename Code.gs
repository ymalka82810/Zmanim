/**
 * לוח זמנים לבית הכנסת - אפליקציה עם טופס + שליחה אוטומטית במייל
 * -----------------------------------------------------------------
 * התקנה חד-פעמית:
 *   1. script.google.com ← פרויקט חדש ← מדביקים את כל הקוד ← שמירה
 *   2. פריסה ← פריסה חדשה ← סוג: אפליקציית אינטרנט
 *      ביצוע בתור: אני | גישה: רק אני ← פריסה ← אישור הרשאות
 *   3. פותחים את הקישור שמתקבל (אפשר לשמור במסך הבית בטלפון)
 * מכאן הכל נעשה דרך הטופס. אין צורך לגעת בקוד.
 *
 * זמני היום מחושבים ע"י Hebcal.com (רישיון CC BY 4.0).
 */

const TZ = 'Asia/Jerusalem';
const BASES = {
  'הדלקת נרות': 'candles', 'שקיעה': 'sunset', 'צאת הכוכבים': 'tzeit',
  'צאת שבת/חג': 'havdalah', 'עלות השחר': 'alotHaShachar', 'הנץ': 'sunrise',
  'סו"ז ק"ש מג"א': 'sofZmanShmaMGA', 'סו"ז ק"ש גר"א': 'sofZmanShma',
  'חצות': 'chatzot', 'מנחה גדולה': 'minchaGedola', 'מנחה קטנה': 'minchaKetana',
  'פלג המנחה': 'plagHaMincha', 'שעה קבועה': 'fixed'
};
const DEFAULT_CONFIG = {
  shul: '', city: 'jerusalem', lat: 31.769, lng: 35.2163, candle: 40, havdalah: '40',
  emails: '', daysBefore: 1, notes: '',
  rules: [
    { name: 'מנחה וקבלת שבת', when: 'כניסה', applies: 'שבת וחג', base: 'הדלקת נרות', offset: '15', round: 'ללא' },
    { name: 'שחרית', when: 'כל יום', applies: 'שבת וחג', base: 'שעה קבועה', offset: '08:00', round: 'ללא' },
    { name: 'מנחה', when: 'כל יום', applies: 'שבת וחג', base: 'שקיעה', offset: '-40', round: 'למטה ל-5' },
    { name: 'ערבית', when: 'יציאה', applies: 'שבת וחג', base: 'צאת שבת/חג', offset: '0', round: 'ללא' }
  ]
};

/* ================= האפליקציה ================= */

function doGet() {
  return HtmlService.createHtmlOutput(APP_HTML)
    .setTitle('לוח זמנים לבית הכנסת')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** נקראות מהטופס */
function getConfig() {
  const cfg = loadConfig();
  if (!cfg.emails) cfg.emails = Session.getEffectiveUser().getEmail();
  cfg.auto = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'dailyCheck');
  return cfg;
}
function saveConfig(cfg) {
  delete cfg.auto;
  PropertiesService.getScriptProperties().setProperty('config', JSON.stringify(cfg));
  PropertiesService.getScriptProperties().deleteProperty('lastSent');
  return true;
}
function previewNext() {
  const cfg = readSettings(), occ = nextOccasion(cfg);
  if (!occ) throw new Error('לא נמצאה שבת או חג בחודש הקרוב');
  const zm = fetchZmanim(cfg, occ.erev, occ.days[occ.days.length - 1].date);
  return buildHtml(cfg, occ, zm, readRules());
}
function sendNow() { testSend(); return 'נשלח אל ' + readSettings().emails; }
function setAuto(on) {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'dailyCheck')
    .forEach(t => ScriptApp.deleteTrigger(t));
  if (on) ScriptApp.newTrigger('dailyCheck').timeBased().everyDays(1).atHour(8).inTimezone(TZ).create();
  return on;
}

function loadConfig() {
  const raw = PropertiesService.getScriptProperties().getProperty('config');
  try { return raw ? JSON.parse(raw) : JSON.parse(JSON.stringify(DEFAULT_CONFIG)); }
  catch (e) { return JSON.parse(JSON.stringify(DEFAULT_CONFIG)); }
}

/* ================= הרצה ================= */

/** רץ כל בוקר: שולח אם הכניסה לשבת/חג בעוד N ימים, ורק פעם אחת לכל אירוע */
function dailyCheck() {
  const cfg = readSettings();
  const occ = nextOccasion(cfg);
  if (!occ) return;
  const today = ymd(new Date());
  const sendOn = addDays(occ.erev, -cfg.daysBefore);
  const props = PropertiesService.getScriptProperties();
  if (today >= sendOn && props.getProperty('lastSent') !== occ.id) {
    sendOccasion(cfg, occ);
    props.setProperty('lastSent', occ.id);
  }
}

/** שליחה מיידית של הלוח הקרוב, לבדיקה */
function testSend() {
  const cfg = readSettings();
  const occ = nextOccasion(cfg);
  if (!occ) throw new Error('לא נמצאה שבת או חג בחודש הקרוב');
  sendOccasion(cfg, occ);
}

function sendOccasion(cfg, occ) {
  const zm = fetchZmanim(cfg, occ.erev, occ.days[occ.days.length - 1].date);
  const rules = readRules();
  const html = buildHtml(cfg, occ, zm, rules);
  const pdf = Utilities.newBlob(html, MimeType.HTML, 'luach.html')
    .getAs(MimeType.PDF).setName('לוח זמנים - ' + occ.title + '.pdf');
  const subject = 'לוח זמנים - ' + occ.title + (cfg.shul ? ' - ' + cfg.shul : '');
  GmailApp.sendEmail(cfg.emails, subject, 'לוח הזמנים מצורף כקובץ PDF.', {
    htmlBody: html, attachments: [pdf], name: cfg.shul || 'לוח זמנים'
  });
}

/* ================= קריאת ההגדרות ================= */

function readSettings() {
  const c = loadConfig();
  return {
    shul: String(c.shul || '').trim(), lat: Number(c.lat), lng: Number(c.lng),
    candle: Number(c.candle) || 0, havdalah: String(c.havdalah || '8.5'),
    emails: String(c.emails || '').trim() || Session.getEffectiveUser().getEmail(),
    daysBefore: Number(c.daysBefore) || 0, notes: String(c.notes || '').trim()
  };
}

function readRules() {
  return (loadConfig().rules || []).filter(r => r && String(r.name).trim()).map(r => ({
    name: String(r.name).trim(), when: r.when, applies: r.applies,
    base: BASES[r.base] || 'sunset', offset: String(r.offset || '').trim(), round: r.round || 'ללא'
  }));
}

/* ================= Hebcal ================= */

function api(path, params) {
  const q = Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&');
  const res = UrlFetchApp.fetch('https://www.hebcal.com/' + path + '?' + q, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Hebcal: ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText());
}

const noNikud = s => (s || '').replace(/[\u0591-\u05C7]/g, '');

function nextOccasion(cfg) {
  const start = ymd(new Date()), end = addDays(start, 40);
  const params = {
    v: 1, cfg: 'json', maj: 'on', min: 'off', mod: 'off', nx: 'off', ss: 'off', mf: 'off',
    c: 'on', s: 'on', i: 'on', lg: 'he', b: cfg.candle, start: start, end: end,
    geo: 'pos', latitude: cfg.lat, longitude: cfg.lng, tzid: TZ
  };
  if (String(cfg.havdalah) === '8.5') params.M = 'on'; else params.m = cfg.havdalah;
  const items = api('hebcal', params).items || [];

  const byDay = {};
  const day = d => (byDay[d] = byDay[d] || { candles: null, havdalah: null, chag: [], parasha: null });
  items.forEach(it => {
    const d = it.date.slice(0, 10), info = day(d), heb = noNikud(it.hebrew || it.title);
    if (it.category === 'candles') info.candles = new Date(it.date);
    else if (it.category === 'havdalah') info.havdalah = new Date(it.date);
    else if (it.category === 'parashat') info.parasha = heb;
    else if (it.category === 'holiday' && it.yomtov) info.chag.push(heb);
  });

  let cur = null;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const info = byDay[d] || { candles: null, havdalah: null, chag: [], parasha: null };
    const shabbat = dow(d) === 6, chag = info.chag.length > 0;
    if (shabbat || chag) {
      if (!cur) cur = { days: [] };
      cur.days.push({ date: d, shabbat: shabbat, chag: chag, info: info });
    } else if (cur) break;
  }
  if (!cur) return null;

  const first = cur.days[0];
  cur.erev = addDays(first.date, -1);
  cur.erevInfo = byDay[cur.erev] || {};
  cur.id = first.date;
  const clean = n => n.replace(/\s*\d{4}$/, '').replace(/\s+א׳$/, '').trim();
  const chags = [];
  cur.days.forEach(d => d.info.chag.forEach(c => { if (chags.indexOf(clean(c)) < 0) chags.push(clean(c)); }));
  if (chags.length) cur.title = chags.join(' ו') + (cur.days.some(d => d.shabbat) ? ' ושבת' : '');
  else cur.title = first.info.parasha ? 'שבת ' + first.info.parasha : 'שבת';
  cur.hebDate = noNikud(api('converter', { cfg: 'json', g2h: 1, date: first.date }).hebrew);
  return cur;
}

function fetchZmanim(cfg, start, end) {
  const t = api('zmanim', { cfg: 'json', latitude: cfg.lat, longitude: cfg.lng, tzid: TZ, start: start, end: end }).times;
  return (key, d) => (t[key] && t[key][d]) ? new Date(t[key][d]) : null;
}

/* ================= חישוב כללים ================= */

function baseTime(base, d, zm, cfg, extra) {
  const sunset = zm('sunset', d);
  switch (base) {
    case 'candles': return extra.candles || (sunset && new Date(sunset.getTime() - cfg.candle * 60000));
    case 'tzeit': return zm('tzeit85deg', d);
    case 'havdalah':
      if (extra.havdalah) return extra.havdalah;
      return String(cfg.havdalah) === '8.5' ? zm('tzeit85deg', d) : (sunset && new Date(sunset.getTime() + Number(cfg.havdalah) * 60000));
    default: return zm(base, d);
  }
}

function ruleTime(rule, d, zm, cfg, extra) {
  if (rule.base === 'fixed') {
    const m = /^(\d{1,2}):(\d{2})/.exec(rule.offset);
    if (!m) return null;
    return { text: ('0' + m[1]).slice(-2) + ':' + m[2], key: +m[1] * 60 + +m[2] };
  }
  const b = baseTime(rule.base, d, zm, cfg, extra);
  if (!b) return null;
  let t = Math.floor((b.getTime() + (Number(rule.offset) || 0) * 60000) / 60000) * 60000;
  const r = 300000;
  if (rule.round === 'למטה ל-5') t = Math.floor(t / r) * r;
  if (rule.round === 'למעלה ל-5') t = Math.ceil(t / r) * r;
  if (rule.round === 'לקרוב ל-5') t = Math.round(t / r) * r;
  const text = hm(new Date(t)), p = text.split(':');
  return { text: text, key: +p[0] * 60 + +p[1] };
}

function applies(rule, day) {
  return rule.applies === 'שבת וחג' || !rule.applies ||
    (rule.applies === 'שבת בלבד' && day.shabbat) || (rule.applies === 'חג בלבד' && day.chag);
}

function rowsFor(rules, when, day, d, zm, cfg, extra) {
  return rules.filter(r => r.when === when && applies(r, day))
    .map(r => Object.assign({ name: r.name }, ruleTime(r, d, zm, cfg, extra) || { text: '—', key: 9999 }))
    .sort((a, b) => a.key - b.key);
}

/* ================= HTML / PDF ================= */

function buildHtml(cfg, occ, zm, rules) {
  const first = occ.days[0], last = occ.days[occ.days.length - 1];
  const kind = d => d.chag ? 'חג' : 'שבת';
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const section = (title, date, rows, zmanim) => {
    let h = '<table class="sec"><tr><td class="h">' + esc(title) + '</td><td class="h d">' + gDate(date) + '</td></tr>';
    rows.forEach(r => { h += '<tr><td class="n">' + esc(r.name) + '</td><td class="t">' + r.text + '</td></tr>'; });
    const z = zmanim.filter(x => x[1]).map(x => x[0] + ' <b>' + hm(x[1]) + '</b>').join('&nbsp;&nbsp;&nbsp;');
    if (z) h += '<tr><td colspan="2" class="z">' + z + '</td></tr>';
    return h + '</table>';
  };

  let body = '';
  body += section('ערב ' + kind(first), occ.erev,
    rowsFor(rules, 'כניסה', first, occ.erev, zm, cfg, { candles: occ.erevInfo.candles }),
    [['הדלקת נרות', occ.erevInfo.candles], ['שקיעה', zm('sunset', occ.erev)]]);

  occ.days.forEach((d, i) => {
    const label = occ.days.length > 1 ? (d.chag ? d.info.chag[0].replace(/\s*\d{4}$/, '') : 'שבת') : 'יום ה' + kind(d);
    const z = [['סו"ז ק"ש מג"א', zm('sofZmanShmaMGA', d.date)], ['סו"ז ק"ש גר"א', zm('sofZmanShma', d.date)], ['שקיעה', zm('sunset', d.date)]];
    if (i < occ.days.length - 1 && d.info.candles) z.push(['הדלקת נרות', d.info.candles]);
    body += section(label, d.date,
      rowsFor(rules, 'כל יום', d, d.date, zm, cfg, { candles: d.info.candles, havdalah: d.info.havdalah }), z);
  });

  body += section('מוצאי ' + kind(last), last.date,
    rowsFor(rules, 'יציאה', last, last.date, zm, cfg, { havdalah: last.info.havdalah }),
    [['צאת ה' + kind(last), last.info.havdalah]]);

  if (cfg.notes) body += '<div class="notes">' + esc(cfg.notes).replace(/\n/g, '<br>') + '</div>';

  return '<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><style>' +
    'body{font-family:Arial,sans-serif;color:#1d2b45;direction:rtl;margin:0}' +
    '.stripe{height:5px;background:#2c4a7c;margin-bottom:4px}.stripe.s{height:2px}' +
    '.shul{text-align:center;font-size:15px;font-weight:bold;color:#2c4a7c;margin-top:14px}' +
    '.title{text-align:center;font-size:30px;font-weight:bold;margin:4px 0}' +
    '.dates{text-align:center;font-size:13px;color:#56637a;margin-bottom:10px}' +
    'table.sec{width:100%;border-collapse:collapse;margin-top:16px}' +
    'td{padding:6px 2px;border-bottom:1px solid #e3e9f2;font-size:15px;text-align:right}' +
    'td.h{font-size:17px;font-weight:bold;border-bottom:2px solid #2c4a7c}' +
    'td.h.d,td.t{text-align:left}td.h.d{font-weight:normal;font-size:13px;color:#56637a}' +
    'td.t{font-weight:bold;width:80px}td.z{font-size:12px;color:#56637a;border:none}' +
    '.notes{margin-top:18px;padding:10px;background:#eef3fa;font-size:14px}' +
    '.credit{margin-top:24px;font-size:9px;color:#8a95a8;text-align:center}' +
    '</style></head><body>' +
    '<div class="stripe"></div><div class="stripe s"></div><div class="stripe"></div>' +
    (cfg.shul ? '<div class="shul">' + esc(cfg.shul) + '</div>' : '') +
    '<div class="title">' + esc(occ.title) + '</div>' +
    '<div class="dates">' + esc(occ.hebDate) + ', ' + gDate(first.date, true) + '</div>' +
    body + '<div class="credit">זמני היום: Hebcal.com</div></body></html>';
}

/* ================= עזרי תאריך ================= */

function ymd(date) { return Utilities.formatDate(date, TZ, 'yyyy-MM-dd'); }
function hm(date) { return Utilities.formatDate(date, TZ, 'HH:mm'); }
function noon(d) { return new Date(d + 'T12:00:00Z'); }
function addDays(d, n) { const x = noon(d); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
function dow(d) { return noon(d).getUTCDay(); }
function gDate(d, year) {
  const days = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const months = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  const x = noon(d);
  return (year ? '' : 'יום ' + days[x.getUTCDay()] + ', ') + x.getUTCDate() + ' ב' + months[x.getUTCMonth()] + (year ? ' ' + x.getUTCFullYear() : '');
}

/* ================= ממשק (HTML) ================= */

const APP_HTML = String.raw`<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@700;900&family=Assistant:wght@400;600;700&display=swap" rel="stylesheet">
<style>
:root{--ink:#1d2b45;--blue:#2c4a7c;--line:#c9d5e6;--bg:#f6f8fb;--panel:#fff;--muted:#5d6b82;--danger:#a33a3a;--ok:#2d6a45}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:"Assistant",Arial,sans-serif;font-size:16px;line-height:1.5}
.wrap{max-width:760px;margin:0 auto;padding:16px 14px 120px}
.stripes{height:22px;background:repeating-linear-gradient(180deg,var(--bg) 0 4px,var(--blue) 4px 8px,var(--bg) 8px 11px,var(--blue) 11px 13px,var(--bg) 13px 16px,var(--blue) 16px 20px,var(--bg) 20px 22px)}
h1{font-family:"Frank Ruhl Libre",Georgia,serif;font-weight:900;font-size:1.8rem;margin:10px 0 2px}
.sub{color:var(--muted);margin:0 0 14px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px;margin-bottom:14px}
h2{font-family:"Frank Ruhl Libre",Georgia,serif;font-size:1.2rem;margin:0 0 10px}
label{display:block;font-weight:600;font-size:.88rem;margin-bottom:3px}
input,select,textarea{font:inherit;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:8px;width:100%}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}
.field{margin-bottom:10px}
button{font:inherit;cursor:pointer;border-radius:6px;border:1px solid var(--blue);background:transparent;color:var(--blue);padding:8px 14px;font-weight:600}
button.primary{background:var(--blue);color:#fff}
button:disabled{opacity:.5;cursor:default}
.rule{border:1px solid var(--line);border-radius:8px;padding:10px;margin-bottom:10px;background:var(--bg)}
.rule-top{display:flex;gap:8px;margin-bottom:8px}
.rule-top input{font-weight:700}
.rule-top button{border-color:transparent;color:var(--danger);padding:6px 8px}
.rgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
@media(min-width:600px){.rgrid{grid-template-columns:repeat(5,minmax(0,1fr))}}
.rgrid label{font-size:.76rem;color:var(--muted)}
.rgrid select,.rgrid input{padding:6px;font-size:.92rem}
.hint{font-size:.85rem;color:var(--muted);margin:6px 0 0}
.switch{display:flex;align-items:center;gap:10px;font-weight:600}
.switch input{width:auto;transform:scale(1.3)}
.bar{position:fixed;left:0;right:0;bottom:0;background:var(--panel);border-top:1px solid var(--line);padding:10px 14px;display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
.status{width:100%;text-align:center;font-size:.9rem;color:var(--muted);min-height:1.3em}
.status.ok{color:var(--ok)}.status.err{color:var(--danger)}
#preview{background:#fff;border:1px solid var(--line);border-radius:6px;padding:14px;overflow-x:auto}
</style></head><body>
<div class="stripes"></div>
<div class="wrap">
  <h1>לוח זמנים לבית הכנסת</h1>
  <p class="sub">ממלאים פעם אחת, והלוח נשלח למייל לפני כל שבת וחג.</p>

  <div class="panel">
    <h2>בית הכנסת</h2>
    <div class="field"><label for="shul">שם בית הכנסת</label><input id="shul"></div>
    <div class="row2">
      <div><label for="city">עיר</label><select id="city"></select></div>
      <div><label for="candle">הדלקת נרות (דקות לפני השקיעה)</label><input id="candle" type="number" min="0" max="60"></div>
    </div>
    <div class="row2" id="coords" hidden>
      <div><label for="lat">קו רוחב</label><input id="lat" type="number" step="0.0001"></div>
      <div><label for="lng">קו אורך</label><input id="lng" type="number" step="0.0001"></div>
    </div>
    <div class="field"><label for="havdalah">צאת שבת וחג</label>
      <select id="havdalah">
        <option value="8.5">צאת הכוכבים (8.5°)</option><option value="30">30 דקות אחרי השקיעה</option>
        <option value="35">35 דקות אחרי השקיעה</option><option value="40">40 דקות אחרי השקיעה</option>
        <option value="42">42 דקות אחרי השקיעה</option><option value="72">72 דקות (רבנו תם)</option>
      </select></div>
  </div>

  <div class="panel">
    <h2>זמני התפילות</h2>
    <div id="rules"></div>
    <button type="button" id="add">הוספת תפילה או שיעור</button>
    <p class="hint">"כניסה" הוא ערב שבת או חג, "כל יום" חל על כל יום של השבת או החג, ו"יציאה" הוא המוצאי. בשעה קבועה כותבים את השעה בשדה, למשל 08:00.</p>
  </div>

  <div class="panel">
    <h2>משלוח</h2>
    <div class="field"><label for="emails">כתובות מייל (אפשר כמה, מופרדות בפסיק)</label><input id="emails" type="text" dir="ltr"></div>
    <div class="row2">
      <div><label for="daysBefore">לשלוח כמה ימים לפני הכניסה</label><select id="daysBefore"><option value="0">ביום הכניסה</option><option value="1">יום לפני</option><option value="2">יומיים לפני</option><option value="3">3 ימים לפני</option></select></div>
      <div style="display:flex;align-items:end"><label class="switch"><input type="checkbox" id="auto"> שליחה אוטומטית פעילה</label></div>
    </div>
    <div class="field"><label for="notes">הודעה בתחתית הלוח</label><textarea id="notes" rows="2"></textarea></div>
  </div>

  <div class="panel" id="prevPanel" hidden><h2>תצוגה מקדימה</h2><div id="preview"></div></div>
</div>

<div class="bar">
  <button class="primary" id="save">שמירה</button>
  <button id="prev">תצוגה מקדימה</button>
  <button id="send">שליחה עכשיו</button>
  <div class="status" id="status" role="status">טוען…</div>
</div>

<script>
var CITIES=[['jerusalem','ירושלים',31.7690,35.2163,40],['bneibrak','בני ברק',32.0840,34.8340,22],['telaviv','תל אביב',32.0809,34.7806,22],['petach','פתח תקווה',32.0871,34.8875,22],['haifa','חיפה',32.8184,34.9885,30],['beitshemesh','בית שמש',31.7470,34.9881,30],['modiin','מודיעין',31.8969,35.0095,22],['elad','אלעד',32.0523,34.9513,22],['ashdod','אשדוד',31.7921,34.6497,22],['ashkelon','אשקלון',31.6688,34.5743,22],['beersheva','באר שבע',31.2518,34.7913,22],['netanya','נתניה',32.3215,34.8532,22],['rehovot','רחובות',31.8928,34.8113,22],['rishon','ראשון לציון',31.9730,34.7925,22],['safed','צפת',32.9646,35.4960,30],['tiberias','טבריה',32.7922,35.5312,22],['eilat','אילת',29.5581,34.9482,22],['custom','מיקום אחר (קואורדינטות)',31.7690,35.2163,22]];
var WHEN=['כניסה','כל יום','יציאה'],APPLIES=['שבת וחג','שבת בלבד','חג בלבד'],ROUND=['ללא','למטה ל-5','למעלה ל-5','לקרוב ל-5'];
var BASES=['הדלקת נרות','שקיעה','צאת הכוכבים','צאת שבת/חג','עלות השחר','הנץ','סו"ז ק"ש מג"א','סו"ז ק"ש גר"א','חצות','מנחה גדולה','מנחה קטנה','פלג המנחה','שעה קבועה'];
var cfg=null,dirty=false;
function $(id){return document.getElementById(id)}
function esc(s){var d=document.createElement('div');d.textContent=s==null?'':s;return d.innerHTML.replace(/"/g,'&quot;')}
function opts(list,v){return list.map(function(x){return '<option'+(x===v?' selected':'')+'>'+esc(x)+'</option>'}).join('')}
function status(t,cls){var s=$('status');s.textContent=t;s.className='status '+(cls||'')}
function busy(b){['save','prev','send'].forEach(function(id){$(id).disabled=b})}
function run(fn,arg,msg,ok){busy(true);status(msg);var r=google.script.run.withSuccessHandler(function(x){busy(false);ok(x)}).withFailureHandler(function(e){busy(false);status('שגיאה: '+(e&&e.message||e),'err')});r[fn](arg)}

$('city').innerHTML=CITIES.map(function(c){return '<option value="'+c[0]+'">'+c[1]+'</option>'}).join('');

function fill(){
  $('shul').value=cfg.shul||'';$('city').value=cfg.city||'jerusalem';$('candle').value=cfg.candle;
  $('lat').value=cfg.lat;$('lng').value=cfg.lng;$('havdalah').value=String(cfg.havdalah);
  $('emails').value=cfg.emails||'';$('daysBefore').value=String(cfg.daysBefore);$('notes').value=cfg.notes||'';
  $('auto').checked=!!cfg.auto;$('coords').hidden=cfg.city!=='custom';renderRules();
}
function renderRules(){
  $('rules').innerHTML=cfg.rules.map(function(r,i){
    var fixed=r.base==='שעה קבועה';
    return '<div class="rule" data-i="'+i+'"><div class="rule-top"><input data-k="name" value="'+esc(r.name)+'" placeholder="שם התפילה או השיעור" aria-label="שם"><button type="button" data-del="'+i+'">מחיקה</button></div>'+
    '<div class="rgrid"><div><label>מתי</label><select data-k="when">'+opts(WHEN,r.when)+'</select></div>'+
    '<div><label>חל על</label><select data-k="applies">'+opts(APPLIES,r.applies)+'</select></div>'+
    '<div><label>לפי</label><select data-k="base">'+opts(BASES,r.base)+'</select></div>'+
    '<div><label>'+(fixed?'שעה':'הפרש (דקות)')+'</label><input data-k="offset" value="'+esc(r.offset)+'" placeholder="'+(fixed?'08:00':'-20')+'" inputmode="'+(fixed?'text':'numeric')+'"></div>'+
    '<div><label>עיגול</label><select data-k="round"'+(fixed?' disabled':'')+'>'+opts(ROUND,r.round)+'</select></div></div></div>';
  }).join('');
}
function changed(){dirty=true;status('יש שינויים שלא נשמרו')}
$('rules').addEventListener('input',function(e){
  var box=e.target.closest('.rule'),k=e.target.getAttribute('data-k');if(!box||!k)return;
  var r=cfg.rules[+box.getAttribute('data-i')];r[k]=e.target.value;
  if(k==='base'){if(r.base==='שעה קבועה'&&r.offset.indexOf(':')<0)r.offset='08:00';if(r.base!=='שעה קבועה'&&r.offset.indexOf(':')>=0)r.offset='0';renderRules()}
  changed();
});
$('rules').addEventListener('click',function(e){var i=e.target.getAttribute('data-del');if(i===null)return;cfg.rules.splice(+i,1);renderRules();changed()});
$('add').onclick=function(){cfg.rules.push({name:'',when:'כל יום',applies:'שבת וחג',base:'שקיעה',offset:'0',round:'ללא'});renderRules();changed()};
$('city').onchange=function(){var c=CITIES.filter(function(x){return x[0]===$('city').value})[0];if(c&&c[0]!=='custom'){$('candle').value=c[4];$('lat').value=c[2];$('lng').value=c[3]}$('coords').hidden=$('city').value!=='custom';changed()};
['shul','candle','lat','lng','havdalah','emails','daysBefore','notes'].forEach(function(id){$(id).addEventListener('input',changed)});

function collect(){
  cfg.shul=$('shul').value;cfg.city=$('city').value;cfg.candle=$('candle').value;cfg.lat=$('lat').value;cfg.lng=$('lng').value;
  cfg.havdalah=$('havdalah').value;cfg.emails=$('emails').value;cfg.daysBefore=$('daysBefore').value;cfg.notes=$('notes').value;
  return cfg;
}
function saveThen(next){ if(!dirty){next();return} run('saveConfig',collect(),'שומר…',function(){dirty=false;status('נשמר','ok');next()}) }
$('save').onclick=function(){dirty=true;saveThen(function(){})};
$('prev').onclick=function(){saveThen(function(){run('previewNext',null,'מחשב…',function(h){
  var m=h.match(/<body[^>]*>([\s\S]*)<\/body>/),st=h.match(/<style>([\s\S]*?)<\/style>/);
  $('preview').innerHTML=(st?'<style>#preview '+st[1].replace(/}/g,'}#preview ').replace(/#preview\s*$/,'')+'</style>':'')+(m?m[1]:h);
  $('prevPanel').hidden=false;$('prevPanel').scrollIntoView({behavior:'smooth'});status('')})})};
$('send').onclick=function(){saveThen(function(){run('sendNow',null,'שולח…',function(t){status(t,'ok')})})};
$('auto').onchange=function(){var on=$('auto').checked;run('setAuto',on,on?'מפעיל…':'מכבה…',function(){status(on?'השליחה האוטומטית פעילה':'השליחה האוטומטית כבויה','ok')})};

run('getConfig',null,'טוען…',function(c){cfg=c;if(!cfg.rules)cfg.rules=[];fill();status('')});
</script></body></html>`;
