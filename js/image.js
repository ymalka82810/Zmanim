/**
 * ציור הלוח כתמונה (canvas) ויצירת PNG ו-PDF ממנה, בלי ספריות חיצוניות.
 * העיצוב תואם לתצוגת הלוח באתר, בכל אחת מתבניות התצוגה.
 */

let C = { ink: '#1d2b45', blue: '#2c4a7c', muted: '#5d6b82', soft: '#e3e9f2', note: '#eef3fa', bg: '#ffffff' };
import { fontFamilies, themeColors } from './config.js';
import { splitColumns } from './render.js';

let SERIF, SANS;   // גופן הכותרת וגופן הטקסט, לפי התבנית
let SZ = { title: 1, name: 1, time: 1, zman: 1 };   // גדלי הטקסט של התבנית (1 = רגיל)
let LAY = 'classic';   // תבנית התצוגה (LAYOUTS ב-config.js)
let COLS = 1;   // מספר העמודות של קטעי השבת/החג
const px = (n, k) => Math.round(n * SZ[k] * 10) / 10;
const M = 56, SCALE = 2;   // שוליים, רזולוציה (בדף גדול יותר – באותו יחס, כדי שהדפסה של ה-PDF תהיה חדה)
let W = 800;   // רוחב לוגי (1600 פיקסלים), ובדף לרוחב רחב יותר לפי היחס של הדף

/** פירוק טקסט לשורות לפי רוחב */
function wrap(ctx, text, width) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? line + ' ' + word : word;
      if (line && ctx.measureText(test).width > width) { lines.push(line); line = word; }
      else line = test;
    }
    lines.push(line);
  }
  return lines;
}

/** קו מופרד בין שורות, לפי תבנית התצוגה. x0–x1 – הרוחב (בלוח בעמודות – העמודה) */
function rowLine(rect, y, x0 = M, x1 = W - M) {
  if (LAY === 'classic') rect(x0, y - 1, x1 - x0, 1, C.soft);
  else if (LAY === 'framed') for (let x = x0; x < x1; x += 5) rect(x, y - 1, 2, 1, C.line);
}

/** קו מתחת לכותרת של קטע או של טבלת הימים, לפי תבנית התצוגה. מחזיר את ה-y שאחריו */
function headLine(rect, y, x0 = M, x1 = W - M) {
  const inner = x1 - x0;
  if (LAY === 'framed') { rect(x0, y, inner, 1.5, C.blue); rect(x0, y + 4, inner, 1.5, C.blue); return y + 6; }
  if (LAY === 'minimal') { rect(x0, y, inner, 1, C.line); return y + 3; }
  if (LAY === 'classic') rect(x0, y, inner, 3, C.blue);
  return y + 3;
}

/** עובר על כל הלוח. אם draw=false רק מודד ומחזיר את הגובה. H – גובה הלוח (בציור) */
function layout(ctx, l, draw, H) {
  const R = W - M, inner = W - 2 * M;
  const text = (s, x, y, font, color, align) => {
    if (!draw) return;
    ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(s, x, y);
  };
  const rect = (x, y, w, h, color) => { if (draw) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); } };
  const round = (x, y, w, h, r, color) => {
    if (!draw) return;
    ctx.fillStyle = color; ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
    ctx.fill();
  };

  if (LAY === 'framed' && draw) {
    ctx.strokeStyle = C.blue;
    ctx.lineWidth = 3; ctx.strokeRect(16, 16, W - 32, H - 32);
    ctx.lineWidth = 1; ctx.strokeRect(23.5, 23.5, W - 47, H - 47);
  }

  let y = 40;
  const tf = '900 ' + px(50, 'title') + 'px ' + SERIF;
  if (LAY === 'banner') {
    ctx.font = tf;
    const lines = wrap(ctx, l.title, inner - 40);
    round(M, y, inner, (l.shul ? 40 : 0) + lines.length * px(60, 'title') + 54, 12, C.blue);
    if (l.shul) { y += 40; text(l.shul, W / 2, y, '700 22px ' + SANS, C.bg, 'center'); }
    for (const line of lines) { y += px(60, 'title'); text(line, W / 2, y, tf, C.bg, 'center'); }
    y += 32; text(l.dates, W / 2, y, '400 18px ' + SANS, C.bg, 'center');
    y += 22;
  } else {
    const minimal = LAY === 'minimal', top = y;
    const ax = minimal ? R - 18 : W / 2, al = minimal ? 'right' : 'center';
    if (LAY === 'classic') { rect(M, y, inner, 8, C.blue); rect(M, y + 13, inner, 3, C.blue); rect(M, y + 21, inner, 8, C.blue); }
    if (!minimal) y += 29;
    if (l.shul) { y += minimal ? 24 : 40; text(l.shul, ax, y, '700 ' + (minimal ? 19 : 22) + 'px ' + SANS, minimal ? C.muted : C.blue, al); }
    ctx.font = tf;
    for (const line of wrap(ctx, l.title, minimal ? inner - 18 : inner)) { y += px(60, 'title'); text(line, ax, y, tf, C.ink, al); }
    y += 32; text(l.dates, ax, y, '400 18px ' + SANS, C.muted, al);
    if (minimal) rect(R - 4, top, 4, y + 10 - top, C.blue);
    if (LAY === 'framed') {
      y += 24;
      rect(W / 2 - 60, y, 120, 1, C.blue);
      rect(W / 2 - 14, y - 7, 28, 15, C.bg);
      if (draw) { ctx.fillStyle = C.blue; ctx.beginPath(); ctx.moveTo(W / 2, y - 5.5); ctx.lineTo(W / 2 + 5.5, y + .5); ctx.lineTo(W / 2, y + 6.5); ctx.lineTo(W / 2 - 5.5, y + .5); ctx.fill(); }
    }
  }

  // קטע של שבת/חג בעמודה שבין M ל-R. מחזיר את ה-y בסוף הקטע
  const section = (s, y, M, R) => {
    const inner = R - M;
    y += 52;
    const bar = LAY === 'banner' ? 12 : 0;
    if (bar) round(M, y - 31, inner, 44, 8, C.soft);
    const minimal = LAY === 'minimal';
    const sf = '700 ' + (minimal ? 20 : 24) + 'px ' + SANS;
    if (LAY === 'framed') {
      // הכותרת במרכז המקום שמימין לתאריך, כמו בתצוגה באתר
      ctx.font = '400 16px ' + SANS;
      text(s.title, (R + M + ctx.measureText(s.date).width + 12) / 2, y, sf, C.ink, 'center');
    } else text(s.title, R - bar, y, sf, minimal ? C.blue : C.ink, 'right');
    text(s.date, M + bar, y, '400 16px ' + SANS, C.muted, 'left');
    y = headLine(rect, y + (bar ? 13 : 12), M, R);

    s.rows.forEach((r, k) => {
      const nf = '400 ' + px(21, 'name') + 'px ' + SANS, lh = px(28, 'name');
      ctx.font = nf;
      const lines = wrap(ctx, r.name, inner - px(110, 'time') - 2 * bar);
      const top = y, base = top + 10 + Math.max(px(22, 'name'), px(22, 'time'));
      const next = base + 14 + (lines.length - 1) * lh;
      if (bar && k % 2) round(M, top, inner, next - top, 6, C.note);
      lines.forEach((line, i) => text(line, R - bar, base + i * lh, nf, C.ink, 'right'));
      text(r.text, M + bar, base, '700 ' + px(22, 'time') + 'px ' + SANS, C.ink, 'left');
      y = next;
      rowLine(rect, y, M, R);
    });

    if (s.zmanim.length) {
      // זמני היום: פריטים מימין לשמאל, עם מעבר שורה כשצריך
      const zs = px(15, 'zman'), zl = '400 ' + zs + 'px ' + SANS, zb = '700 ' + zs + 'px ' + SANS;
      ctx.font = zl;
      const gap = 22, items = s.zmanim.map(z => ({ label: z[0] + ' ', time: z[1] }));
      const widthOf = it => {
        ctx.font = zl; const a = ctx.measureText(it.label).width;
        ctx.font = zb; return a + ctx.measureText(it.time).width;
      };
      y += 11 + zs;
      let x = R;
      for (const it of items) {
        const w = widthOf(it);
        if (x !== R && x - w < M) { x = R; y += Math.round(zs * 1.6); }
        if (draw) {
          ctx.font = zl; const lw = ctx.measureText(it.label).width;
          text(it.label, x, y, zl, C.muted, 'right');
          text(it.time, x - lw, y, zb, C.muted, 'right');
        }
        x -= w + gap;
      }
    }
    return y;
  };

  if (l.type === 'days') y = daysGrid(ctx, l, y, text, rect, round);
  else {
    // הקטעים מחולקים לעמודות (הראשונה מימין), והלוח ממשיך מתחת לעמודה הארוכה
    const cols = splitColumns(l.sections, COLS), gap = 32, cw = (inner - gap * (cols.length - 1)) / cols.length;
    y = Math.max(y, ...cols.map((c, i) => c.reduce((cy, s) => section(s, cy, R - i * (cw + gap) - cw, R - i * (cw + gap)), y)));
  }

  if (l.notes) {
    ctx.font = '400 18px ' + SANS;
    const lines = wrap(ctx, l.notes, inner - 32);
    y += 36;
    const h = 28 + lines.length * 28;
    rect(M, y, inner, h, C.note);
    lines.forEach((line, i) => text(line, R - 16, y + 34 + i * 28, '400 18px ' + SANS, C.ink, 'right'));
    y += h;
  }
  return y + 48;
}

/** לוח ימי חול: עמודת שמות מימין ועמודה לכל יום. מחזיר את ה-y בסוף הטבלה */
function daysGrid(ctx, l, y, text, rect, round) {
  const R = W - M, inner = W - 2 * M, labelW = 150, n = l.days.length, colW = (inner - labelW) / n;
  const cx = i => R - labelW - colW * (i + 0.5);
  const specials = l.days.some(d => d.special);
  const banner = LAY === 'banner';

  y += 50;
  if (banner) round(M, y - 30, inner, (specials ? 70 : 32) + 28, 8, C.soft);
  l.days.forEach((d, i) => {
    text(d.name, cx(i), y, '700 19px ' + SANS, C.ink, 'center');
    text(d.date, cx(i), y + 22, '400 15px ' + SANS, C.muted, 'center');
    if (d.special) {
      ctx.font = '700 13px ' + SANS;
      wrap(ctx, d.special.replace(/ · /g, '\n'), colW - 6).slice(0, 2)
        .forEach((line, k) => text(line, cx(i), y + 42 + k * 16, '700 13px ' + SANS, C.blue, 'center'));
    }
  });
  y = headLine(rect, y + (specials ? 70 : 32));

  // ns – גודל השם, ts – גודל השעות. fill – רקע לשורה (שורות מתחלפות בתבנית פס צבעוני)
  const pad = banner ? 8 : 0;
  const row = (r, ns, ts, color, fill) => {
    ctx.font = '400 ' + ns + 'px ' + SANS;
    const lines = wrap(ctx, r.name, labelW - 10 - pad), top = y, size = Math.max(ns, ts);
    const next = top + size + 24 + (lines.length - 1) * (ns + 7);
    if (fill) round(M, top, inner, next - top, 6, C.note);
    lines.forEach((line, k) => text(line, R - pad, top + size + 12 + k * (ns + 7), '400 ' + ns + 'px ' + SANS, color, 'right'));
    r.cells.forEach((c, i) => { if (c != null) text(c, cx(i), top + size + 12, '700 ' + ts + 'px ' + SANS, color, 'center'); });
    y = next;
  };
  l.rows.forEach((r, k) => { row(r, px(20, 'name'), px(20, 'time'), C.ink, banner && k % 2); rowLine(rect, y); });
  y += 6;
  for (const r of l.zmanim) row(r, px(15, 'zman'), px(15, 'zman'), C.muted);
  return y;
}

async function loadFonts(font) {
  if (!document.fonts) return;
  // הגדרות הגופן מ-Google Fonts עוד בטעינה (למשל מיד אחרי שהגופן הוחלף)
  const link = document.getElementById('fontLink-' + font);
  if (link && !link.sheet) {
    await new Promise(ok => {
      link.addEventListener('load', ok, { once: true });
      link.addEventListener('error', ok, { once: true });
      setTimeout(ok, 4000);
    });
  }
  try {
    await Promise.all(['900 50px ' + SERIF, '400 20px ' + SANS, '700 20px ' + SANS]
      .map(f => document.fonts.load(f, 'אבג 0123')));
  } catch (e) { /* בלי חיבור ובלי מטמון – גופן חלופי */ }
}

/**
 * מצייר את הלוח ומחזיר canvas. font/theme/layout – מזהי הגופן, ערכת הצבעים ותבנית התצוגה של התבנית,
 * sizes – הגדלים שלה באחוזים, page – הדף שלה (pageOf ב-config.js), cols – מספר העמודות
 */
export async function luachCanvas(l, font, sizes = {}, theme, lay, page, cols = 1) {
  COLS = cols;
  ({ title: SERIF, body: SANS } = fontFamilies(font));
  W = page && page.landscape ? Math.round(800 * page.w / page.h) : 800;
  const t = themeColors(theme);
  C = { ink: t.ink, blue: t.blue, muted: t.muted, soft: t.soft, note: t.note, line: t.line, bg: t.paper };
  LAY = lay || 'classic';
  SZ = {};
  for (const k of ['title', 'name', 'time', 'zman']) SZ[k] = (Number(sizes[k]) || 100) / 100;
  await loadFonts(font);
  const canvas = document.createElement('canvas');
  let ctx = canvas.getContext('2d');
  ctx.direction = 'rtl';
  const h = Math.ceil(layout(ctx, l, false));
  const scale = SCALE * (page ? page.k : 1);
  canvas.width = Math.round(W * scale); canvas.height = Math.round(h * scale);
  ctx = canvas.getContext('2d');
  ctx.scale(canvas.width / W, canvas.height / h);
  ctx.direction = 'rtl';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, h);
  layout(ctx, l, true, h);
  return canvas;
}

const toBlob = (canvas, type, q) => new Promise((ok, fail) =>
  canvas.toBlob(b => b ? ok(b) : fail(new Error('toBlob failed')), type, q));

export const pngBlob = canvas => toBlob(canvas, 'image/png');

/** כמה עמודים (עמוד לכל יום בחג רב-יומי) בתמונה אחת, אחד מתחת לשני – לשיתוף כתמונה */
export function stackCanvases(list) {
  if (list.length === 1) return list[0];
  const gap = 24, W = Math.max(...list.map(c => c.width));
  const out = document.createElement('canvas');
  out.width = W; out.height = list.reduce((h, c) => h + c.height, 0) + gap * (list.length - 1);
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, out.width, out.height);
  let y = 0;
  for (const c of list) { ctx.drawImage(c, (W - c.width) / 2, y); y += c.height + gap; }
  return out;
}

/**
 * PDF בעמודים בגודל page (במ"מ, pageOf ב-config.js; בלי – A4 לאורך), תמונה בראש כל עמוד (מוקטנת אם היא ארוכה מהעמוד).
 * canvases – קנבס אחד או רשימה, עמוד לכל אחד
 */
export async function pdfBlob(canvases, page = { w: 210, h: 297 }) {
  const list = Array.isArray(canvases) ? canvases : [canvases];
  const jpegs = await Promise.all(list.map(async c => new Uint8Array(await (await toBlob(c, 'image/jpeg', 0.92)).arrayBuffer())));
  const PW = page.w * 72 / 25.4, PH = page.h * 72 / 25.4;
  const f = n => n.toFixed(2);

  const enc = new TextEncoder(), parts = [], offsets = [];
  let len = 0;
  const push = p => { const b = typeof p === 'string' ? enc.encode(p) : p; parts.push(b); len += b.length; };
  const obj = (n, body) => { offsets[n] = len; push(n + ' 0 obj\n'); body(); push('\nendobj\n'); };
  // לכל עמוד שלושה אובייקטים: העמוד, התמונה והתוכן
  const pageNum = i => 3 + i * 3, total = 2 + list.length * 3;

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push('<< /Type /Pages /Kids [' + list.map((c, i) => pageNum(i) + ' 0 R').join(' ') + '] /Count ' + list.length + ' >>'));
  list.forEach((canvas, i) => {
    const n = pageNum(i), jpeg = jpegs[i], iw = canvas.width, ih = canvas.height;
    let dw = PW, dh = PW * ih / iw;
    if (dh > PH) { dh = PH; dw = PH * iw / ih; }
    const content = 'q ' + f(dw) + ' 0 0 ' + f(dh) + ' ' + f((PW - dw) / 2) + ' ' + f(PH - dh) + ' cm /Im0 Do Q';
    obj(n, () => push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + f(PW) + ' ' + f(PH) + '] ' +
      '/Resources << /XObject << /Im0 ' + (n + 1) + ' 0 R >> >> /Contents ' + (n + 2) + ' 0 R >>'));
    obj(n + 1, () => {
      push('<< /Type /XObject /Subtype /Image /Width ' + iw + ' /Height ' + ih +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.length + ' >>\nstream\n');
      push(jpeg); push('\nendstream');
    });
    obj(n + 2, () => push('<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream'));
  });

  const xref = len;
  push('xref\n0 ' + (total + 1) + '\n0000000000 65535 f \n' +
    Array.from({ length: total }, (_, i) => String(offsets[i + 1]).padStart(10, '0') + ' 00000 n \n').join('') +
    'trailer\n<< /Size ' + (total + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
  return new Blob(parts, { type: 'application/pdf' });
}
