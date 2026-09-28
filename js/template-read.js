/**
 * קריאת לוח ישן (PDF או תמונה) כתבנית: ציור העמוד, חילוץ הטקסט עם המיקומים,
 * זיהוי שעות, תאריכים ופרשה, והסקת הכללים (למשל "מנחה = שקיעה פחות 40").
 * ספריית pdf.js נטענת רק כשמעלים קובץ PDF.
 */

import { hm, toDayNum } from './dates.js';
import { PARSHIYOT, fromHebrew, TISHREI, CHESHVAN, KISLEV, TEVET, SHVAT, ADAR, ADAR2, NISAN, IYYAR, SIVAN, TAMUZ, AV, ELUL } from './hebrew.js';
import { timesFor, applyOffset } from './luach.js';

const PDFJS = new URL('../vendor/pdfjs/', import.meta.url).href;   // pdf.js 6.3.289, רישיון Apache 2.0
const PAGE_W = 1600;   // רוחב התבנית בפיקסלים

let pdfjsPromise;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(PDFJS + 'pdf.min.mjs').then(m => {
      m.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs';
      return m;
    });
    pdfjsPromise.catch(() => { pdfjsPromise = null; });
  }
  return pdfjsPromise;
}

/* ---------- קריאת הקובץ ---------- */

/**
 * מחזיר { canvas, items } – העמוד הראשון כתמונה, ופריטי הטקסט עם תיבות בפיקסלים.
 * לתמונה או ל-PDF סרוק items ריק.
 */
export async function readFile(file) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  return isPdf ? readPdf(file) : readImage(file);
}

async function readPdf(file) {
  const pdfjs = await loadPdfjs();
  // fontExtraProperties: שומר את קובצי הגופנים אחרי הציור, כדי שאפשר יהיה לכתוב בהם את הערכים החדשים
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, fontExtraProperties: true });
  const doc = await task.promise;
  const page = await doc.getPage(1);
  const scale = PAGE_W / page.getViewport({ scale: 1 }).width;
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;

  const content = await page.getTextContent();
  const items = [];
  for (const it of content.items) {
    const str = fixVisualOrder(String(it.str || '').replace(/\s+/g, ' ').trim());
    if (!str) continue;
    const tx = pdfjs.Util.transform(vp.transform, it.transform);
    const size = Math.hypot(tx[2], tx[3]);
    if (size < 4) continue;
    const w = it.width * scale;
    const baseline = tx[5];
    items.push({ str, x: tx[4], w, baseline, size, y: baseline - size * 0.92, h: size * 1.2, rtl: it.dir === 'rtl' || /[א-ת]/.test(str), font: it.fontName });
  }
  let fonts = {};
  try { fonts = await readFonts(pdfjs, page); } catch (e) { console.warn('לא ניתן לקרוא את הגופנים מהקובץ', e); }
  task.destroy();
  return { canvas, items: joinFragments(items), fonts };
}

/**
 * ב-Word ובעוד תוכנות טקסט נשמר לפעמים בכמה פריטים צמודים: שעה ("1", "8", ":", "24")
 * או כותרת ("מנחה ערב", "שבת"). מחברים פריטים סמוכים באותה שורה – ספרות עם ספרות ועברית עם עברית –
 * כדי שהשעה והתווית שלה יזוהו בשלמותן.
 */
export function joinFragments(items) {
  const kindOf = it => /^[\d:.]+$/.test(it.str) ? 'num' : /^[א-ת"'״׳,.()\s\-–־]+$/.test(it.str) && /[א-ת]/.test(it.str) ? 'heb' : null;
  const list = items.map((it, i) => ({ ...it, i, k: kindOf(it) }));
  const joinable = list.filter(it => it.k).sort((a, b) => a.baseline - b.baseline || a.x - b.x);
  const runs = [];
  let run = null;
  for (const it of joinable) {
    const gap = run ? it.x - (run.x + run.w) : 0;
    const touches = run && run.k === it.k && Math.abs(it.baseline - run.baseline) < run.size * 0.3 &&
      Math.abs(it.size - run.size) < run.size * 0.1 && gap > -run.size * 0.3 && gap < run.size * (it.k === 'num' ? 0.15 : 0.5);
    if (touches) {
      // עברית: הפריט השמאלי בא אחרי הקודם בטקסט. רווח רק כשיש רווח גם בדף
      const sp = it.k === 'heb' && gap > run.size * 0.15 && !/[-–־]$/.test(it.str) && !/^[-–־]/.test(run.str) ? ' ' : '';
      run.str = it.k === 'heb' ? it.str + sp + run.str : run.str + it.str;
      run.w = it.x + it.w - run.x; run.i = Math.min(run.i, it.i);
      continue;
    }
    run = { ...it };
    runs.push(run);
  }
  // כל רצף נכנס במקום הפריט הראשון שלו, כדי שסדר האזורים יישאר כמו בקובץ
  const at = new Map(runs.map(r => [r.i, r]));
  return list.flatMap(({ i, k, ...it }) => !k ? [it] : at.has(i) ? [(({ i: _, k: __, ...r }) => r)(at.get(i))] : []);
}

/**
 * הגופנים שבקובץ. pdf.js ממיר כל גופן מוטמע לקובץ OpenType שבו כל אות נמצאת בקוד פרטי (PUA),
 * ולכן שומרים גם מפה מהאות האמיתית לקוד שבגופן, לפי האותיות שמופיעות בעמוד.
 * גופן מוטמע הוא בדרך כלל חלקי – יש בו רק האותיות שהיו בקובץ.
 * מחזיר { [שם פנימי]: { family, bold, italic, data (base64) או null, map } }
 */
async function readFonts(pdfjs, page) {
  const ops = await page.getOperatorList();
  const maps = {};
  let cur = null;
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], args = ops.argsArray[i];
    if (fn === pdfjs.OPS.setFont) { cur = args[0]; maps[cur] = maps[cur] || {}; continue; }
    if (fn !== pdfjs.OPS.showText || !cur) continue;
    for (const g of args[0]) {
      if (!g || typeof g !== 'object' || !g.fontChar || typeof g.unicode !== 'string') continue;
      const u = [...g.unicode];
      // רווח לא נשמר: בגופן המומר הוא מופיע כריבוע
      if (u.length === 1 && !/\s/.test(u[0]) && !(u[0] in maps[cur])) maps[cur][u[0]] = g.fontChar;
    }
  }
  const out = {};
  for (const name of Object.keys(maps)) {
    let f;
    try { f = page.commonObjs.get(name); } catch (e) { continue; }
    if (!f || f.isType3Font) continue;
    const raw = String(f.name || '');
    const data = f.data && !f.missingFile && !f.disableFontFace ? toBase64(f.data) : null;
    out[name] = { family: familyName(raw), bold: !!f.bold || /bold|black|heavy/i.test(raw), italic: !!f.italic, data, map: data ? maps[name] : null };
  }
  return out;
}

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** שם גופן להצגה ולגופן מערכת: "ABCDEF+TimesNewRomanPS-BoldMT" ← "Times New Roman" */
function familyName(raw) {
  const n = raw.replace(/^[A-Z]{6}\+/, '').replace(/[-,](Bold|Italic|Regular|Black|Light|Medium|Oblique|Heavy|Semi\w*|Demi\w*)+.*$/i, '')
    .replace(/(PSMT|PS|MT)$/, '').replace(/(Bold|Italic|Regular)+$/i, '');
  return /\s/.test(n) ? n : n.replace(/([a-z])([A-Z])/g, '$1 $2');
}

async function readImage(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, PAGE_W / bmp.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return { canvas, items: [], fonts: {} };
}

/**
 * יש קובצי PDF שבהם העברית שמורה הפוכה (סדר ויזואלי). מזהים לפי אותיות סופיות:
 * בטקסט תקין הן בסוף מילה, בטקסט הפוך – בתחילתה.
 */
function fixVisualOrder(s) {
  let atStart = 0, atEnd = 0;
  for (const w of s.match(/[א-ת]{2,}/g) || []) {
    if (/[ךםןףץ]/.test(w[0])) atStart++;
    if (/[ךםןףץ]/.test(w[w.length - 1])) atEnd++;
  }
  if (atStart <= atEnd) return s;
  return s.split('').reverse().join('')
    .replace(/[0-9A-Za-z:./-]+/g, m => m.split('').reverse().join(''))
    .replace(/[()]/g, c => c === '(' ? ')' : '(');
}

/* ---------- פירוק לאסימונים: שעות, תאריכים וטקסט ---------- */

const TIME_RE = /(?<![\d:./])(\d{1,2}):(\d{2})(?![\d:])/g;
const GREG_RE = /(?<!\d)(\d{1,2})([./-])(\d{1,2})\2(\d{4}|\d{2})(?!\d)/;
const HEB_MONTHS = [['מרחשון', CHESHVAN], ['חשוון', CHESHVAN], ['חשון', CHESHVAN], ['תשרי', TISHREI], ['כסליו', KISLEV], ['כסלו', KISLEV],
  ['טבת', TEVET], ['שבט', SHVAT], ['אדר ב', ADAR2], ['אדר א', ADAR], ['אדר', ADAR], ['ניסן', NISAN], ['אייר', IYYAR],
  ['סיוון', SIVAN], ['סיון', SIVAN], ['תמוז', TAMUZ], ['אלול', ELUL], ['אב', AV]];
// אחרי שם החודש לא באה אות, כדי ש"רח' אברהם" לא ייקרא "ח' אב"
const HEB_DATE_RE = new RegExp('(?:^|\\s)([א-ת]{1,2}["\'״׳]?[א-ת]?)\\s+(?:ב|ל)?(' + HEB_MONTHS.map(m => m[0]).join('|') + ')[\'׳]?(?![א-ת])(?:\\s+([א-ת]{0,3}["״][א-ת]))?');
const isGregDate = s => { const m = GREG_RE.exec(s); return !!m && +m[1] >= 1 && +m[1] <= 31 && +m[3] >= 1 && +m[3] <= 12; };
const isHebDate = s => { const m = HEB_DATE_RE.exec(s); if (!m) return false; const d = gemValue(m[1]); return d >= 1 && d <= 30; };
// "רח' הרצל 3", "רחוב…", "שד' ירושלים", "כתובת: …"
const ADDRESS_RE = /(?:^|[^א-ת])ב?(?:רח['׳"]?|רחוב|שד['׳]|שדרות|סמ['׳]|סמטת|כיכר|ככר|כתובת)(?![א-ת])\s*:?\s*[א-ת]/;

let measureCtx;
function textWidth(s, size) {
  measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
  measureCtx.font = size + 'px Arial';
  return measureCtx.measureText(s).width;
}

/**
 * מפרק כל פריט טקסט לאסימונים: שעה (time) או טקסט (text). כשבפריט אחד יש גם תווית וגם שעה
 * ("מנחה 17:40"), המיקום של השעה בתוך הפריט מוערך לפי רוחב התווים.
 */
export function tokenize(items) {
  const tokens = [];
  for (const raw of items) {
    const it = trimSeparators(raw);
    if (!it) continue;
    const matches = [...it.str.matchAll(TIME_RE)];
    if (!matches.length) { pushText(tokens, it); continue; }
    // הטקסט שבין השעות ("הדלקת נרות 18:24 | שקיעה 19:04") – כל קטע עם התיבה שלו, כדי שכל שעה תמצא את התווית שלידה
    const segs = [];
    let last = 0;
    for (const m of matches) {
      tokens.push({ ...it, ...subBox(it, m.index, m[0]), str: m[0], kind: 'time', minutes: +m[1] * 60 + +m[2] });
      segs.push([last, it.str.slice(last, m.index)]);
      last = m.index + m[0].length;
    }
    segs.push([last, it.str.slice(last)]);
    for (const [at, s] of segs) {
      const lead = /^[\s|:–-]*/.exec(s)[0].length;
      const txt = s.replace(/^[\s|:–-]+|[\s|:–-]+$/g, '');
      if (txt && /[א-תA-Za-z]/.test(txt)) tokens.push({ ...it, ...subBox(it, at + lead, txt), str: txt, kind: classifyText(txt), partOf: true });
    }
  }
  return joinParashaPairs(joinAddress(tokens));
}

/** כתובת שנשמרה בכמה פריטים ("רח' אברהם כחילה", "3", "גן חב"ד"): מצרפים את ההמשך שמשמאל באותה שורה */
function joinAddress(tokens) {
  const drop = new Set();
  for (const a of tokens) {
    if (a.kind !== 'address') continue;
    for (;;) {
      const next = tokens.find(t => t !== a && !drop.has(t) && t.kind === 'text' && sameLine(t, a) &&
        Math.abs(t.size - a.size) < a.size * 0.3 && a.x - (t.x + t.w) < a.size * 2.5 && t.x < a.x);
      if (!next) break;
      a.str = a.str + ' ' + next.str;
      a.w = a.x + a.w - next.x; a.x = next.x;
      drop.add(next);
    }
  }
  return tokens.filter(t => !drop.has(t));
}

/** המיקום המשוער של קטע טקסט בתוך פריט, לפי רוחב התווים */
function subBox(it, index, s) {
  const total = textWidth(it.str, it.size) || 1;
  const w = it.w * textWidth(s, it.size) / total;
  const before = textWidth(it.str.slice(0, index), it.size) / total;
  // בפריט מימין לשמאל, מה שבא קודם בטקסט נמצא מימין
  return { x: it.rtl ? it.x + it.w * (1 - before) - w : it.x + it.w * before, w };
}

/** שם פרשה בכתיב חסר או מלא: "נצבים" מתאים גם ל"ניצבים", "חוקת" ל"חקת" */
const spellings = name => [...name].map((c, i) => c === ' ' ? '\\s+' : i > 0 && /[יו]/.test(c) ? '' : c + '[יו]*').join('');
const NAMES = '(?:' + [...PARSHIYOT].sort((a, b) => b.length - a.length).map(spellings).join('|') + ')(?![א-ת])';
const PAIR = NAMES + '(?:\\s*[-–־]\\s*' + NAMES + ')?';
const PARASHA_RE = new RegExp('פרשת\\s+' + PAIR);
// "לשבת ניצבים-וילך", "שבת קודש וירא" – בלי המילה "פרשת". האזור כולל את "לשבת", שנשמר כטקסט קבוע לפני השם
const NAME_RE = new RegExp('(?:^|[^א-ת])(ל?שבת\\s+(?:קודש\\s+)?)(' + PAIR + ')');
const PREFIX_RE = /^ל?שבת(?:\s+קודש)?$/;
// המקף בקצה הפריט כבר הוסר ב-trimSeparators
const PAIR_TAIL_RE = new RegExp('^[-–־]?\\s*' + NAMES + '\\s*[-–־]?$');

/** טקסט רגיל; אם יש בו פרשה באמצע שורה (למשל "זמני תפילות – פרשת וירא"), הפרשה הופכת לאזור נפרד */
function pushText(tokens, it) {
  const kind = classifyText(it.str);
  let m = kind === 'text' && PARASHA_RE.exec(it.str), pk = 'parasha', at, s, prefix;
  if (m) { at = m.index; s = m[0]; }
  else if (kind === 'text' && (m = NAME_RE.exec(it.str))) {
    pk = 'parashaName'; s = m[1] + m[2]; at = m.index + m[0].length - s.length;
    prefix = m[1].replace(/\s+/g, ' ');
  }
  if (!m) { tokens.push({ ...it, kind }); return; }
  tokens.push({ ...it, ...subBox(it, at, s), str: s, kind: pk, ...(prefix ? { prefix } : {}) });
  const rest = (it.str.slice(0, at) + ' ' + it.str.slice(at + s.length)).replace(/[\s|–-]+/g, ' ').trim();
  if (/[א-ת]/.test(rest)) tokens.push({ ...it, ...restBox(it, at, s), str: rest, kind: 'text', partOf: true });
}

/** התיבה של מה שנשאר בפריט אחרי שהוצא ממנו קטע – הצד הגדול יותר */
function restBox(it, at, s) {
  const before = it.str.slice(0, at), after = it.str.slice(at + s.length);
  return before.trim().length >= after.trim().length ? subBox(it, 0, before) : subBox(it, at + s.length, after);
}

/** פרשות מחוברות שנשמרו בשני פריטים ("…ניצבים" ו"-וילך"): מחברים לאזור אחד */
function joinParashaPairs(tokens) {
  const drop = new Set();
  const absorb = (p, t) => {
    const x = Math.min(p.x, t.x);
    p.w = Math.max(p.x + p.w, t.x + t.w) - x; p.x = x;
    drop.add(t);
  };
  // שם פרשה בודד ("וילך") ש"לשבת" לפניו בפריט נפרד
  for (const t of tokens) {
    if (t.kind !== 'text' || !new RegExp('^' + PAIR + '$').test(t.str)) continue;
    const pre = tokens.find(x => x.kind === 'text' && !drop.has(x) && PREFIX_RE.test(x.str) && sameLine(x, t) &&
      x.x > t.x && x.x - (t.x + t.w) < t.size * 1.5);
    if (pre) { t.kind = 'parashaName'; t.prefix = pre.str.replace(/\s+/g, ' ') + ' '; t.str = pre.str + ' ' + t.str; absorb(t, pre); }
  }
  for (const p of tokens) {
    if (p.kind !== 'parasha' && p.kind !== 'parashaName') continue;
    if (new RegExp('[-–־]\\s*' + NAMES + '$').test(p.str)) continue;
    const tail = tokens.find(t => t.kind === 'text' && !drop.has(t) && PAIR_TAIL_RE.test(t.str) && sameLine(t, p) &&
      Math.abs(p.x - (t.x + t.w)) < p.size * 1.5 && Math.abs(t.x - p.x) > 1);
    if (!tail) continue;
    p.str = p.str + '-' + tail.str.replace(/^[-–־\s]+|[-–־\s]+$/g, '');
    absorb(p, tail);
  }
  return tokens.filter(t => !drop.has(t));
}

/** מסיר מפרידים (| • – ,) מקצות הפריט ומקטין את התיבה בהתאם */
function trimSeparators(it) {
  const m = /^([\s|•·–\-,]*)(.*?)([\s|•·–\-,]*)$/.exec(it.str);
  if (!m[2]) return null;
  if (!m[1] && !m[3]) return it;
  const total = textWidth(it.str, it.size) || 1;
  const lead = it.w * textWidth(m[1], it.size) / total, trail = it.w * textWidth(m[3], it.size) / total;
  // מימין לשמאל: ההתחלה בצד ימין והסוף בצד שמאל
  const x = it.rtl ? it.x + trail : it.x + lead;
  return { ...it, str: m[2], x, w: Math.max(1, it.w - lead - trail) };
}

function classifyText(s) {
  if (isGregDate(s)) return 'gregDate';
  if (isHebDate(s)) return 'hebDate';
  if (ADDRESS_RE.test(s)) return 'address';
  if (/^שבת\s+פרשת/.test(s)) return 'title';
  if (/^פרשת\s/.test(s)) return 'parasha';
  return 'text';
}

/* ---------- זיהוי התאריך של הלוח הישן ---------- */

const gemValue = s => [...s.replace(/["'״׳]/g, '')].reduce((a, c) => a + ({
  'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5, 'ו': 6, 'ז': 7, 'ח': 8, 'ט': 9, 'י': 10, 'כ': 20, 'ך': 20, 'ל': 30, 'מ': 40, 'ם': 40,
  'נ': 50, 'ן': 50, 'ס': 60, 'ע': 70, 'פ': 80, 'ף': 80, 'צ': 90, 'ץ': 90, 'ק': 100, 'ר': 200, 'ש': 300, 'ת': 400
}[c] || 0), 0);

/** מנסה למצוא בקובץ את תאריך הלוח. מחזיר dayNum או null */
export function detectDate(tokens) {
  for (const t of tokens) {
    const m = t.kind === 'gregDate' && GREG_RE.exec(t.str);
    if (m) {
      const y = m[4].length === 2 ? 2000 + +m[4] : +m[4];
      const d = toDayNum(y + '-' + String(m[3]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0'));
      if (isFinite(d)) return d;
    }
  }
  for (const t of tokens) {
    const m = t.kind === 'hebDate' && HEB_DATE_RE.exec(t.str);
    if (m && m[3]) {
      const month = HEB_MONTHS.find(x => x[0] === m[2])[1];
      const day = gemValue(m[1]), year = 5000 + gemValue(m[3]);
      if (day >= 1 && day <= 30) return fromHebrew(year, month, day);
    }
  }
  return null;
}

/** תבנית התאריך הלועזי כמו בקובץ הישן (מפריד, ספרות שנה, אפסים מובילים) */
export function gregFormat(str) {
  const m = GREG_RE.exec(str);
  if (!m) return { sep: '/', year: 4, pad: false };
  return { sep: m[2], year: m[4].length, pad: m[1].length === 2 && m[1][0] === '0' };
}

/* ---------- הסקת התפקיד של כל שעה ---------- */

const ZMAN_WORDS = [
  [/הדלק/, 'candles', 'כניסה'],
  [/(צאת|יציאת|מוצ).{0,6}(שבת|חג|ש"ק|השבת|החג)|^צאת ש/, 'havdalah', 'יציאה'],
  [/צאת הכוכבים|צה"כ/, 'tzeit', null],
  [/שקיע/, 'sunset', null],
  [/עלות/, 'alotHaShachar', 'כל יום'],
  [/נץ|זריחה/, 'sunrise', 'כל יום'],
  [/מג"?א|מגן אברהם/, 'sofZmanShmaMGA', 'כל יום'],
  [/סו"?ז|סוף זמן|גר"?א/, 'sofZmanShma', 'כל יום'],
  [/חצות/, 'chatzot', 'כל יום'],
  [/מנחה גדולה/, 'minchaGedola', 'כל יום'],
  [/פלג/, 'plagHaMincha', null]
];
const PRAYER_WORDS = /שחרית|מנחה|ערבית|מעריב|קבלת שבת|מוסף|שיעור|דף יומי|תהילים|לימוד|הלל|סליחות|ותיקין|אבות ובנים|תפילה|קריאת/;
const WHEN_WORDS = [
  ['יציאה', /מוצ|הבדלה|יציאת|צאת ה?(שבת|חג)/],
  ['כניסה', /ערב שבת|ערב חג|עש"ק|ערש"ק|ליל שבת|ליל חג|קבלת שבת|כניסת|יום ו|שישי/],
  ['כל יום', /יום שבת|שבת קודש|שבת בבוקר|בוקר|שחרית|מוסף|צהריים|יום החג|^שבת$|^חג$|יום השבת/]
];
const whenOf = s => { for (const [w, re] of WHEN_WORDS) if (re.test(s)) return w; return null; };
const isOnlyDayWord = s => !!whenOf(s) && !PRAYER_WORDS.test(s) && s.length < 16;

const BASE_BY_WHEN = {
  'כניסה': ['candles', 'sunset', 'plagHaMincha', 'tzeit'],
  'כל יום': ['sunrise', 'sofZmanShmaMGA', 'sofZmanShma', 'chatzot', 'minchaGedola', 'minchaKetana', 'plagHaMincha', 'sunset', 'tzeit'],
  'יציאה': ['havdalah', 'tzeit', 'sunset']
};
const BASE_LABEL = { candles: 'הדלקת נרות', sunset: 'שקיעה', tzeit: 'צאת הכוכבים', havdalah: 'צאת שבת/חג', alotHaShachar: 'עלות השחר',
  sunrise: 'הנץ', sofZmanShmaMGA: 'סו"ז ק"ש מג"א', sofZmanShma: 'סו"ז ק"ש גר"א', chatzot: 'חצות', minchaGedola: 'מנחה גדולה',
  minchaKetana: 'מנחה קטנה', plagHaMincha: 'פלג המנחה' };

const overlapX = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
const sameLine = (a, b) => Math.abs(a.baseline - b.baseline) < Math.max(a.size, b.size) * 0.45;

/** התווית של שעה: הטקסט הקרוב באותה שורה, קודם מימין (עברית) ואחר כך משמאל */
function labelFor(t, texts) {
  const line = texts.filter(x => sameLine(x, t));
  const right = line.filter(x => x.x >= t.x + t.w * 0.5).sort((a, b) => a.x - b.x)[0];
  const left = line.filter(x => x.x + x.w <= t.x + t.w * 0.5).sort((a, b) => (b.x + b.w) - (a.x + a.w))[0];
  if (right && left) {
    // אם שני הצדדים קרובים באותה מידה, בעברית התווית בדרך כלל מימין
    const dr = right.x - (t.x + t.w), dl = t.x - (left.x + left.w);
    return dl < dr * 0.5 ? left : right;
  }
  return right || left || null;
}

/** כותרות מעל השעה (באותה עמודה), מהקרובה לרחוקה */
function headersAbove(t, texts) {
  return texts.filter(x => x.baseline < t.baseline - t.size * 0.5 && overlapX(x, t) > -t.size)
    .sort((a, b) => b.baseline - a.baseline);
}

/** הבסיס המקובל לפי שם התפילה, אם הוא בטווח סביר */
const PREFER = [
  [/קבלת שבת/, ['candles', 'sunset']],
  [/מנחה(?! גדולה)/, ['sunset', 'candles']],
  [/ערבית|מעריב/, ['havdalah', 'tzeit', 'sunset']],
  [/ותיקין|כותיקין|נץ/, ['sunrise']]
];

/** מציאת בסיס, הפרש ועיגול שמסבירים את השעה. name – שם התפילה (לא חובה) */
export function inferRule(minutes, when, times, tz, name = '') {
  const toMin = ms => { const [h, m] = hm(ms, tz).split(':').map(Number); return h * 60 + m; };
  const bases = BASE_BY_WHEN[when].filter(k => times[k] != null).map(k => ({ k, min: toMin(times[k]), ms: times[k] }));
  const near = bases.map(b => ({ ...b, diff: minutes - b.min })).filter(b => Math.abs(b.diff) <= 120);
  const pref = when === 'כניסה' ? 'candles' : when === 'יציאה' ? 'havdalah' : null;
  const round5 = minutes % 5 === 0;
  if (!near.length || (minutes < 12 * 60 && minutes % 15 === 0) || (when === 'כל יום' && minutes < 12 * 60 && round5)) {
    return { base: 'שעה קבועה', offset: String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0'), round: 'ללא' };
  }
  near.sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff));
  const byName = (PREFER.find(p => p[0].test(name)) || [null, []])[1];
  const best = byName.map(k => near.find(b => b.k === k && Math.abs(b.diff) <= 90)).find(Boolean) ||
    near.find(b => b.k === pref && Math.abs(b.diff) <= 45) || near[0];
  const target = best.ms + best.diff * 60000;
  // אם השעה עגולה ל-5 והבסיס לא – מחפשים הפרש עגול עם עיגול שנותן בדיוק את השעה
  if (round5 && best.min % 5 !== 0) {
    const d5 = Math.round(best.diff / 5) * 5;
    for (const round of ['למטה ל-5', 'למעלה ל-5', 'לקרוב ל-5']) {
      for (const off of [d5, d5 - 5, d5 + 5]) {
        if (toMin(applyOffset(best.ms, off, round)) === toMin(target)) return { base: BASE_LABEL[best.k], offset: String(off), round };
      }
    }
  }
  return { base: BASE_LABEL[best.k], offset: String(best.diff), round: 'ללא' };
}

const DAY_WORDS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי']
  .map((w, i) => [new RegExp('(^|[^א-ת])(' + w + '|יום ' + 'אבגדהו'[i] + '[\'׳]?)($|[^א-ת])'), i]);
/** היום בשבוע (0–5) שמוזכר בטקסט, או null */
export const dowOf = s => { for (const [re, i] of DAY_WORDS) if (re.test(s)) return i; return null; };

/**
 * הצעה ראשונית לכל האזורים בתבנית.
 * day – יום השבת/החג של הלוח הישן (dayNum), או null אם לא ידוע.
 * period – בלוח של ימי חול: הלוח הישן (findPeriod), ואז כל שעה משויכת ליום (d0…d5) לפי הטקסט שלידה.
 */
export function suggestSlots(tokens, cfg, day, period) {
  const texts = tokens.filter(t => t.kind !== 'time');
  if (period && period.mode === 'days') return suggestDaySlots(tokens, texts, cfg, period);
  const slots = [];
  const tErev = day != null ? timesFor(cfg, day - 1) : null;
  const tDay = day != null ? timesFor(cfg, day) : null;

  for (const t of tokens) {
    const box = boxOf(t);
    if (isFixedKind(t.kind)) { slots.push(fixedSlot(t, box)); continue; }
    if (t.kind !== 'time') continue;

    const lab = labelFor(t, texts);
    const labelBox = lab ? boxOf(lab) : null;
    const heads = headersAbove(t, texts);
    const rowLabel = lab ? lab.str : '';
    let label = rowLabel;
    // בטבלה שבה השורה היא היום והעמודה היא התפילה – השם בא מהכותרת שמעל
    if ((!label || isOnlyDayWord(label)) && heads.length) {
      const h = heads.find(x => PRAYER_WORDS.test(x.str) || ZMAN_WORDS.some(z => z[0].test(x.str)));
      if (h) label = h.str;
    }
    let when = whenOf(rowLabel) || whenOf(label);
    // שורה משותפת, למשל "הדלקת נרות 18:24 || שקיעה 19:04": השקיעה היא של ערב שבת
    for (const x of texts) {
      if (when) break;
      if (x !== lab && sameLine(x, t)) when = whenOf(x.str) || (ZMAN_WORDS.find(z => z[2] && z[0].test(x.str)) || [])[2] || null;
    }
    // כותרת מעל: בטבלה כל כותרת, ברשימה (לשעה יש תווית בשורה) רק כותרת קצרה של יום ("ערב שבת"), לא משפט
    for (const h of heads) { if (when) break; if (!lab || isOnlyDayWord(h.str)) when = whenOf(h.str); }
    // ערבית ביום השבת/החג היא של מוצאי שבת/חג
    if (!when) when = /ערבית|מעריב/.test(label) ? 'יציאה' : 'כל יום';

    const zm = !PRAYER_WORDS.test(label) && ZMAN_WORDS.find(z => z[0].test(label));
    const name = label.replace(/[:\-–|]+$/g, '').trim();
    if (zm) {
      slots.push({ box, labelBox, kind: 'zman', zman: zm[1], when: zm[2] || when, old: t.str, label: name });
    } else {
      const rule = tDay ? inferRule(t.minutes, when, when === 'כניסה' ? tErev : tDay, cfg.tz, label)
        : { base: 'שעה קבועה', offset: t.str, round: 'ללא' };
      slots.push({ box, labelBox, kind: 'rule', when, name: name || 'תפילה', old: t.str, label: name, ...rule });
    }
  }
  return slots;
}

const boxOf = t => ({ x: t.x, y: t.y, w: t.w, h: t.h, baseline: t.baseline, size: t.size, font: t.font });
const isFixedKind = k => ['title', 'parasha', 'parashaName', 'hebDate', 'gregDate', 'address'].includes(k);
function fixedSlot(t, box) {
  if (t.kind === 'gregDate') return { box, kind: 'gregDate', old: t.str, fmt: gregFormat(t.str) };
  if (t.kind === 'address') return { box, kind: 'address', old: t.str };
  return { box, kind: t.kind, old: t.str, ...(t.prefix ? { prefix: t.prefix } : {}), ascii: /["']/.test(t.str) && !/[״׳]/.test(t.str), noYear: t.kind === 'hebDate' && !HEB_DATE_RE.exec(t.str)[3] };
}

/** כמו suggestSlots, ללוח של ימי חול: היום נקבע לפי שם היום בשורה או בכותרת שמעל */
function suggestDaySlots(tokens, texts, cfg, period) {
  const slots = [];
  for (const t of tokens) {
    const box = boxOf(t);
    if (isFixedKind(t.kind)) { slots.push(fixedSlot(t, box)); continue; }
    if (t.kind !== 'time') continue;

    const lab = labelFor(t, texts), heads = headersAbove(t, texts);
    const labelBox = lab ? boxOf(lab) : null;
    let label = lab ? lab.str : '';
    // בטבלה שבה השורה היא היום – שם התפילה בכותרת שמעל
    if ((!label || dowOf(label) != null) && heads.length) {
      const h = heads.find(x => PRAYER_WORDS.test(x.str) || ZMAN_WORDS.some(z => z[0].test(x.str)));
      if (h) label = h.str;
    }
    let w = null;
    for (const s of [lab ? lab.str : '', ...texts.filter(x => sameLine(x, t)).map(x => x.str), ...heads.map(h => h.str)]) {
      w = dowOf(s);
      if (w != null) break;
    }
    const col = period.days.find(x => x.dow === w) || period.days[0];
    const zm = !PRAYER_WORDS.test(label) && ZMAN_WORDS.find(z => z[0].test(label));
    const name = label.replace(/[:\-–|]+$/g, '').trim();
    if (zm) slots.push({ box, labelBox, kind: 'zman', zman: zm[1], when: col.key, old: t.str, label: name });
    else {
      const rule = inferRule(t.minutes, 'כל יום', timesFor(cfg, col.day), cfg.tz, label);
      slots.push({ box, labelBox, kind: 'rule', when: col.key, name: name || 'תפילה', old: t.str, label: name, ...rule });
    }
  }
  return slots;
}

/** טקסטים שאינם שעות ואינם מזוהים – אפשר ללחוץ עליהם ולהפוך אותם לאזור */
export function textCandidates(tokens) {
  return tokens.filter(t => t.kind === 'text').map(t => ({ box: boxOf(t), old: t.str }));
}
