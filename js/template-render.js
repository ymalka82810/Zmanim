/**
 * ציור לוח על גבי תבנית מקובץ ישן: כל אזור מכוסה בצבע הרקע שלו,
 * והערך החדש נכתב במקומו בצבע, בגודל ובגופן של הטקסט המקורי.
 * גופן שמוטמע ב-PDF הוא בדרך כלל חלקי: אות שאין בו נכתבת בגופן חלופי.
 */

import { hebDateString } from './hebrew.js';
import { toYmd } from './dates.js';

const FALLBACK = '"Assistant", Arial, sans-serif';
const SERIF_FALLBACK = '"Frank Ruhl Libre", "David Libre", Georgia, serif';
// pdf.js לא תמיד מזהה גופן עם תגים (למשל David מ-Chrome/Word), ותבניות ישנות נשמרו בלי serif – משלימים לפי שם הגופן
const SERIF_NAME = /serif|times|roman|david|frank|narkis|guttman|keter|hadasim|drugulin|koren|taamey|ezra|sbl|cardo|georgia|garamond/i;

/** גופן חלופי לגופן מהקובץ: קודם הגופן עצמו לפי השם (אם מותקן במכשיר), ואחר כך גופן עברי בסגנון דומה – עם תגים או בלי */
function fallbackCss(f) {
  const serif = f.serif || SERIF_NAME.test(f.family || '');
  return (f.family ? '"' + f.family.replace(/"/g, '') + '", ' : '') + (serif ? SERIF_FALLBACK : FALLBACK);
}

/* ---------- ניתוח צבעים (פעם אחת, בשמירת התבנית) ---------- */

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const hex = c => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

function median(list) {
  const out = [0, 1, 2].map(i => { const v = list.map(p => p[i]).sort((a, b) => a - b); return v[v.length >> 1] || 255; });
  return out;
}

/** צבע רקע, צבע טקסט ועובי, לפי הפיקסלים סביב האזור ובתוכו */
export function analyzeSlot(canvas, box) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const pad = 3;
  const x0 = Math.max(0, Math.floor(box.x) - pad), y0 = Math.max(0, Math.floor(box.y) - pad);
  const x1 = Math.min(canvas.width, Math.ceil(box.x + box.w) + pad), y1 = Math.min(canvas.height, Math.ceil(box.y + box.h) + pad);
  if (x1 - x0 < 2 || y1 - y0 < 2) return { bg: '#ffffff', fg: '#000000', bold: false };
  const data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data, W = x1 - x0, H = y1 - y0;
  const px = (x, y) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };

  const ring = [];
  for (let x = 0; x < W; x++) { ring.push(px(x, 0), px(x, H - 1)); }
  for (let y = 0; y < H; y++) { ring.push(px(0, y), px(W - 1, y)); }
  const bg = median(ring);

  const inside = [];
  for (let y = pad; y < H - pad; y++) for (let x = pad; x < W - pad; x++) inside.push(px(x, y));
  const far = inside.map(p => [dist(p, bg), p]).sort((a, b) => b[0] - a[0]);
  const top = far.slice(0, Math.max(1, Math.floor(far.length * 0.08)));
  const fg = top[0] && top[0][0] > 40 ? [0, 1, 2].map(i => top.reduce((s, x) => s + x[1][i], 0) / top.length) : [0, 0, 0];
  // עובי הקו: אורך חציוני של רצפי דיו אופקיים ביחס לגובה האותיות
  const threshold = dist(fg, bg) * 0.5, runs = [];
  for (let y = pad; y < H - pad; y++) {
    let run = 0;
    for (let x = pad; x < W - pad; x++) {
      if (dist(px(x, y), bg) > threshold) run++;
      else if (run) { runs.push(run); run = 0; }
    }
    if (run) runs.push(run);
  }
  runs.sort((a, b) => a - b);
  const stroke = (runs[runs.length >> 1] || 0) / Math.max(1, H - 2 * pad);
  return { bg: hex(bg), fg: hex(fg), bold: stroke > 0.16, stroke };
}

/**
 * התאמת גובה התיבה לדיו בפועל: המיקום מה-PDF מוערך לפי גודל הגופן, ותיבה גבוהה מדי
 * הייתה מכסה גם חלק מהשורה שמעל או מתחת.
 */
export function refineBox(canvas, box) {
  if (!box.size) return box;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const x0 = Math.max(0, Math.floor(box.x)), x1 = Math.min(canvas.width, Math.ceil(box.x + box.w));
  const y0 = Math.max(0, Math.floor(box.baseline - box.size * 1.05)), y1 = Math.min(canvas.height, Math.ceil(box.baseline + box.size * 0.4));
  if (x1 - x0 < 2 || y1 - y0 < 2) return box;
  // קוראים גם מעט מסביב לתיבה, כדי להשלים אות שנחתכה בקצה
  const ext = Math.ceil(box.size * 0.6), xa = Math.max(0, x0 - ext), xb = Math.min(canvas.width, x1 + ext);
  const DW = xb - xa, H = y1 - y0, data = ctx.getImageData(xa, y0, DW, H).data;
  const px = (x, y) => { const i = (y * DW + x - xa) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const bg = median([...Array(x1 - x0).keys()].flatMap(i => [px(x0 + i, 0), px(x0 + i, H - 1)]));
  const inkRow = y => { for (let x = x0; x < x1; x++) if (dist(px(x, y), bg) > 70) return true; return false; };
  // מתחילים מאמצע האותיות ומתרחבים עד שורה ריקה
  let top = Math.min(H - 1, Math.max(0, Math.round(box.baseline - box.size * 0.35) - y0)), bottom = top;
  if (!inkRow(top)) return box;
  while (top > 0 && inkRow(top - 1)) top--;
  while (bottom < H - 1 && inkRow(bottom + 1)) bottom++;
  // "דיו" גבוה בהרבה מהטקסט: הרקע לא אחיד (צבעים, תמונה), ואי אפשר למצוא לפיו את גבולות הטקסט
  if (bottom - top > box.size * 1.5) return box;
  // המיקום האופקי מוערך לפי רוחב תווים, ולפעמים חותך אות: מרחיבים עד עמודה ריקה
  const inkCol = x => { for (let y = top; y <= bottom; y++) if (dist(px(x, y), bg) > 70) return true; return false; };
  let left = x0, right = x1 - 1;
  while (left > xa && inkCol(left)) left--;
  while (right < xb - 1 && inkCol(right)) right++;
  // הגענו עד קצה התחום: זה רקע צבעוני ולא אות שנחתכה
  if (left === xa && xa < x0) left = x0;
  if (right === xb - 1 && xb > x1) right = x1 - 1;
  return { ...box, x: left, w: right - left + 1, y: y0 + top - 2, h: bottom - top + 5 };
}

/* ---------- ערכים ---------- */

function gregText(day, fmt) {
  const [y, m, d] = toYmd(day).split('-');
  const p = s => fmt.pad ? s : String(+s);
  return p(d) + fmt.sep + p(m) + fmt.sep + (fmt.year === 2 ? y.slice(2) : y);
}

/** הטקסט החדש לאזור, או null אם אין ערך */
export function slotValue(slot, v) {
  switch (slot.kind) {
    case 'rule': case 'kiddush': return v.rules[slot.when + '|' + slot.name] ?? null;
    case 'zman': return (v.zmanim[slot.when] || {})[slot.zman] ?? null;
    case 'title': return v.title;
    case 'parasha': return (slot.prefix || '') + v.parasha;
    case 'parashaName': return (slot.prefix || '') + v.parashaName;
    // בשבת בלי שם מיוחד האזור נמחק (נכתב טקסט ריק על הרקע)
    case 'special': return v.special || '';
    // בלי כתובת בהגדרות – הכתובת מהקובץ נשארת כמו שהיא
    case 'address': return v.address || null;
    case 'hebDate': {
      let s = hebDateString(v.hebDay);
      if (slot.noYear) s = s.split(' ').slice(0, -1).join(' ');
      // "ה'תשפ"ז" כמו בקובץ הישן
      else if (slot.hei) s = s.replace(/ (\S+)$/, ' ה׳$1');
      return slot.ascii ? s.replace(/״/g, '"').replace(/׳/g, "'") : s;
    }
    case 'gregDate': return gregText(v.firstDay, slot.fmt || { sep: '/', year: 4, pad: false });
    case 'text': return slot.text ?? '';
    default: return null;
  }
}

/** מפתח קבוע לאזור, לטקסט שהגבאי שינה בו. אזורים עם אותו תוכן (למשל הכותרת פעמיים) משתנים יחד */
export const slotKey = s => s.kind === 'text' ? 'text|' + Math.round(s.box.x) + ',' + Math.round(s.box.y)
  : [s.kind, s.when, s.name, s.zman].filter(x => x != null && x !== '').join('|');

/**
 * כשאין בתבנית אזור לשבת מיוחדת: סוג האזור שאליו מוסיפים את שם השבת ("שבת זכור") –
 * הכותרת, ואם אין כותרת – הפרשה. null כשיש אזור משלה, או כשאין לאן להוסיף.
 */
export function specialHost(slots) {
  if (slots.some(s => s.kind === 'special')) return null;
  return ['title', 'parasha', 'parashaName'].find(k => slots.some(s => s.kind === k)) || null;
}

/** הטקסט שנכתב באזור: מה שהגבאי כתב (v.edits), או הערך המחושב. host – מ-specialHost */
export function slotText(slot, v, host) {
  const k = slotKey(slot);
  if (v.edits && k in v.edits) return String(v.edits[k]);
  const text = slotValue(slot, v);
  // "שבת פרשת תצוה – שבת זכור", "לשבת תצוה – זכור"
  if (!v.special || slot.kind !== host || text == null) return text;
  return text + ' – ' + (slot.kind === 'parashaName' ? v.special.replace(/^שבת\s+/, '') : v.special);
}

/* ---------- ציור ---------- */

const imgCache = new Map();
function loadImage(src) {
  if (!imgCache.has(src)) {
    imgCache.clear();
    imgCache.set(src, new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = src; }));
  }
  return imgCache.get(src);
}

/* ---------- גופנים מהקובץ ---------- */

const faces = new Map();   // שם משפחה ← Promise<boolean>

function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i += 7) h = (h * 33 + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + str.length.toString(36);
}

/**
 * טעינת גופן (base64) לדפדפן. מחזיר את שם המשפחה, או null אם הטעינה נכשלה.
 * weight – המשקל שהגופן רשום בו, כדי שהדפדפן לא יעבה שוב גופן שכבר מודגש
 */
async function loadFace(data, weight = 'normal') {
  const family = 'tpl-' + hash(data) + (weight === 'normal' ? '' : '-' + weight);
  if (!faces.has(family)) {
    faces.set(family, (async () => {
      const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
      const face = new FontFace(family, bytes, { weight });
      await face.load();
      document.fonts.add(face);
      return true;
    })().catch(() => false));
  }
  return (await faces.get(family)) ? family : null;
}

/** לכל גופן בתבנית: { family, map } לגופן מוטמע, או { css, bold } לגופן מערכת לפי השם */
async function templateFonts(tpl) {
  const out = {};
  for (const [k, f] of Object.entries(tpl.fonts || {})) {
    const family = f.data && f.map ? await loadFace(f.data) : null;
    // f.full – האותיות מהגופן המלא (מהמחשב של הגבאי או מקובץ שהעלה), לאותיות שחסרות בגופן המוטמע
    const full = f.full ? await loadFace(f.full, f.bold ? '700' : '400') : null;
    const css = (full ? '"' + full + '", ' : '') + fallbackCss(f);
    out[k] = family ? { family, map: f.map, bold: f.bold, css } : { css, bold: f.bold };
    // הקנבס לא מחכה לגופן רשת – טוענים מראש את האותיות העבריות של הגופן החלופי
    await document.fonts.load((f.bold ? '700 ' : '400 ') + '20px ' + css, 'אבצץ').catch(() => {});
  }
  return out;
}

const HEB = /[֐-׿]/;

/**
 * הטקסט בסדר ויזואלי (משמאל לימין), כי האותיות בגופן המוטמע נמצאות בקוד פרטי
 * שהדפדפן לא מזהה כעברית. מספרים ואותיות לטיניות נשארים משמאל לימין.
 */
function visualOrder(text) {
  if (!HEB.test(text)) return text;
  const mirror = { '(': ')', ')': '(', '[': ']', ']': '[' };
  return [...text].reverse().join('')
    .replace(/[0-9A-Za-z:./-]+/g, m => [...m].reverse().join(''))
    .replace(/[()[\]]/g, c => mirror[c]);
}

/**
 * כותב טקסט במרכז (cx) בגופן מהקובץ. אות שאין בגופן נכתבת בגופן החלופי.
 * draw=false – רק מודד ומחזיר את הרוחב.
 */
function embeddedText(ctx, text, f, size, cx, baseline, draw) {
  const segs = [];
  for (const ch of visualOrder(text)) {
    const emb = !/\s/.test(ch) && ch in f.map;
    const last = segs[segs.length - 1];
    if (last && last.emb === emb) last.s += emb ? f.map[ch] : ch;
    else segs.push({ emb, s: emb ? f.map[ch] : ch });
  }
  const fonts = { true: size + 'px "' + f.family + '"', false: (f.bold ? '700 ' : '400 ') + size + 'px ' + f.css };
  // LRO … PDF – כופה סדר משמאל לימין על קטע בגופן החלופי, שכבר נמצא בסדר ויזואלי
  const str = sg => sg.emb ? sg.s : '\u202D' + sg.s + '\u202C';
  let w = 0;
  for (const sg of segs) { ctx.font = fonts[sg.emb]; sg.w = ctx.measureText(str(sg)).width; w += sg.w; }
  if (draw) {
    ctx.save();
    ctx.direction = 'ltr'; ctx.textAlign = 'left';
    let x = cx - w / 2;
    for (const sg of segs) { ctx.font = fonts[sg.emb]; ctx.fillText(str(sg), x, baseline); x += sg.w; }
    ctx.restore();
  }
  return w;
}

/** מחלקים טקסט לעד n שורות בנקודות הרווח שבהן השורה הרחבה ביותר הכי צרה */
function splitLines(text, measure, n) {
  const words = text.trim().split(/\s+/);
  if (words.length < 2) return null;
  let best = null, bestMax = Infinity;
  // כל החלוקות של המילים לשורות רצופות (עד n), מהשורה הראשונה והלאה
  const walk = (from, acc) => {
    if (from === words.length) {
      if (acc.length < 2) return;
      const max = Math.max(...acc.map(measure));
      if (max < bestMax) { bestMax = max; best = acc; }
      return;
    }
    if (acc.length === n) return;
    for (let i = from + 1; i <= words.length; i++) walk(i, [...acc, words.slice(from, i).join(' ')]);
  };
  walk(0, []);
  return best;
}

/**
 * החלוקה שהגבאי בחר: lines[i] – השורה (0 עד count-1) של המילה ה-i. מילים שאחרי סוף הרשימה
 * (שם פרשה ארוך יותר מזה שבתצוגה) הולכות לשורה של המילה האחרונה.
 */
export function wordLine(lines, i, count = 2) {
  return Math.min(lines && lines.length ? lines[Math.min(i, lines.length - 1)] || 0 : 0, count - 1);
}
/** השורות לפי הבחירה, בלי שורות ריקות. null כשהכל נשאר בשורה אחת */
function chosenLines(text, lines, count) {
  const out = Array.from({ length: count }, () => []);
  text.trim().split(/\s+/).forEach((w, i) => out[wordLine(lines, i, count)].push(w));
  const full = out.filter(a => a.length).map(a => a.join(' '));
  return full.length > 1 ? full : null;
}

export async function templateCanvas(tpl, values) {
  const img = await loadImage(tpl.image);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';
  const fonts = await templateFonts(tpl);

  const host = specialHost(tpl.slots);
  for (const s of tpl.slots) {
    const text = slotText(s, values, host);
    if (text == null) continue;
    const b = s.box, st = s.style || { bg: '#fff', fg: '#000', bold: false };
    let size = (b.size || b.h * 0.72) * ((s.sizePct || 100) / 100);
    const cx = b.x + b.w / 2, baseline = b.baseline ?? (b.y + b.h * 0.78);
    const writeAt = textWriter(ctx, fonts[b.font] || fonts[tpl.mainFont], st.bold, cx);
    // טקסט ארוך מהמקום: מקטינים עד 70%, ואם עדיין לא נכנס ומותר לגלוש – מחלקים לכמה שורות
    let w = writeAt(text, size, baseline, false);
    const room = Math.max(b.w * 1.15, b.w + size);
    let lines = [text];
    // שם שבת מיוחדת שנוסף לכותרת ולא נכנס בשורה אחת יורד לשורה משלו, בגודל המקורי ככל האפשר
    const added = s.kind === host && values.special ? text.lastIndexOf(' – ') : -1;
    const count = s.lineCount || 2;
    const chosen = s.wrap ? chosenLines(text, s.lines, count) : null;
    if (w > room && chosen) {
      size = Math.max(size * 0.7, size * room / w);
      lines = chosen;
      w = Math.max(...lines.map(ln => writeAt(ln, size, baseline, false)));
    } else if (w > room && added > 0) {
      lines = [text.slice(0, added), text.slice(added + 3)];
      const widest = () => Math.max(...lines.map(ln => writeAt(ln, size, baseline, false)));
      w = widest();
      if (w > room) { size = Math.max(size * 0.7, size * room / w); w = widest(); }
    } else if (w > room) {
      size = Math.max(size * 0.7, size * room / w);
      w = writeAt(text, size, baseline, false);
      if (s.wrap) {
        const split = splitLines(text, str => writeAt(str, size, baseline, false), count);
        if (split) { lines = split; w = Math.max(...lines.map(ln => writeAt(ln, size, baseline, false))); }
      }
    }
    // השורות ממורכזות סביב קו הבסיס המקורי
    const lineGap = size * 1.15 * ((s.lineHeightPct || 100) / 100);
    const baselines = lines.map((ln, i) => baseline + (i - (lines.length - 1) / 2) * lineGap);
    const left = Math.min(b.x, cx - w / 2) - 2, right = Math.max(b.x + b.w, cx + w / 2) + 2;
    const top = Math.min(b.y, baselines[0] - size) - 1, bottom = Math.max(b.y + b.h, baselines[baselines.length - 1] + size * 0.3) + 1;
    ctx.fillStyle = st.bg;
    ctx.fillRect(left, top, right - left, bottom - top);
    ctx.fillStyle = st.fg;
    lines.forEach((ln, i) => writeAt(ln, size, baselines[i], true));
    if ((s.sizePct || 100) !== 100) redrawLabel(ctx, tpl, s, fonts, st);
  }
  return canvas;
}

/** כותב טקסט ממורכז ב-cx בגופן f מהקובץ, או לפי שם הגופן אם הוא לא מוטמע. draw=false – רק מודד */
function textWriter(ctx, f, bold, cx) {
  if (f && f.family) return (str, sz, y, draw) => embeddedText(ctx, str, f, sz, cx, y, draw);
  const css = f ? f.css : FALLBACK, b = f ? f.bold || bold : bold;
  return (str, sz, y, draw) => {
    ctx.font = (b ? '700 ' : '400 ') + sz + 'px ' + css;
    if (draw) ctx.fillText(str, cx, y);
    return ctx.measureText(str).width;
  };
}

/**
 * השם שליד השעה ("מנחה") הוא חלק מהתמונה, ולכן כשמשנים את גודל האזור כותבים אותו מחדש באותו גודל.
 * הצד הקרוב לשעה נשאר במקומו, כך שהשם גדל לכיוון הרחוק ממנה ולא עולה עליה.
 */
function redrawLabel(ctx, tpl, s, fonts, timeStyle) {
  const lb = s.labelBox;
  if (!lb || !['rule', 'zman', 'kiddush'].includes(s.kind)) return;
  const cand = (tpl.candidates || []).find(c => c.box.x === lb.x && c.box.y === lb.y);
  const text = cand ? cand.old : s.label;
  if (!text) return;
  const st = s.labelStyle || timeStyle;
  const size = (lb.size || lb.h * 0.72) * (s.sizePct / 100);
  const baseline = lb.baseline ?? (lb.y + lb.h * 0.78);
  const f = fonts[lb.font] || fonts[tpl.mainFont];
  const w = textWriter(ctx, f, st.bold, 0)(text, size, baseline, false);
  const onRight = lb.x + lb.w / 2 > s.box.x + s.box.w / 2;
  const cx = onRight ? lb.x + w / 2 : lb.x + lb.w - w / 2;
  const left = Math.min(lb.x, cx - w / 2) - 2, right = Math.max(lb.x + lb.w, cx + w / 2) + 2;
  const top = Math.min(lb.y, baseline - size) - 1, bottom = Math.max(lb.y + lb.h, baseline + size * 0.3) + 1;
  ctx.fillStyle = st.bg;
  ctx.fillRect(left, top, right - left, bottom - top);
  ctx.fillStyle = st.fg;
  textWriter(ctx, f, st.bold, cx)(text, size, baseline, true);
}
