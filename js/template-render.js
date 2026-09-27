/**
 * ציור לוח על גבי תבנית מקובץ ישן: כל אזור מכוסה בצבע הרקע שלו,
 * והערך החדש נכתב במקומו בצבע ובגודל של הטקסט המקורי.
 */

import { hebDateString } from './hebrew.js';
import { toYmd } from './dates.js';

const FONT = '"Assistant", Arial, sans-serif';

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
  const W = x1 - x0, H = y1 - y0, data = ctx.getImageData(x0, y0, W, H).data;
  const px = (x, y) => { const i = (y * W + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const bg = median([...Array(W).keys()].flatMap(x => [px(x, 0), px(x, H - 1)]));
  const inkRow = y => { for (let x = 0; x < W; x++) if (dist(px(x, y), bg) > 70) return true; return false; };
  // מתחילים מאמצע האותיות ומתרחבים עד שורה ריקה
  let top = Math.min(H - 1, Math.max(0, Math.round(box.baseline - box.size * 0.35) - y0)), bottom = top;
  if (!inkRow(top)) return box;
  while (top > 0 && inkRow(top - 1)) top--;
  while (bottom < H - 1 && inkRow(bottom + 1)) bottom++;
  return { ...box, y: y0 + top - 2, h: bottom - top + 5 };
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
    case 'rule': return v.rules[slot.when + '|' + slot.name] ?? null;
    case 'zman': return (v.zmanim[slot.when] || {})[slot.zman] ?? null;
    case 'title': return v.title;
    case 'parasha': return v.parasha;
    case 'parashaName': return v.parashaName;
    case 'hebDate': {
      let s = hebDateString(v.hebDay);
      if (slot.noYear) s = s.split(' ').slice(0, -1).join(' ');
      return slot.ascii ? s.replace(/״/g, '"').replace(/׳/g, "'") : s;
    }
    case 'gregDate': return gregText(v.firstDay, slot.fmt || { sep: '/', year: 4, pad: false });
    default: return null;
  }
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

export async function templateCanvas(tpl, values) {
  const img = await loadImage(tpl.image);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';

  for (const s of tpl.slots) {
    const text = slotValue(s, values);
    if (text == null) continue;
    const b = s.box, st = s.style || { bg: '#fff', fg: '#000', bold: false };
    let size = b.size || b.h * 0.72;
    const font = sz => (st.bold ? '700 ' : '400 ') + sz + 'px ' + FONT;
    ctx.font = font(size);
    // טקסט ארוך מהמקום: מקטינים עד 70%, ומעבר לזה מרחיבים את הכיסוי
    let w = ctx.measureText(text).width;
    const room = Math.max(b.w * 1.15, b.w + size);
    if (w > room) { size = Math.max(size * 0.7, size * room / w); ctx.font = font(size); w = ctx.measureText(text).width; }
    const cx = b.x + b.w / 2;
    const left = Math.min(b.x, cx - w / 2) - 2, right = Math.max(b.x + b.w, cx + w / 2) + 2;
    ctx.fillStyle = st.bg;
    ctx.fillRect(left, b.y - 1, right - left, b.h + 2);
    ctx.fillStyle = st.fg;
    const baseline = b.baseline ?? (b.y + b.h * 0.78);
    ctx.fillText(text, cx, baseline);
  }
  return canvas;
}
