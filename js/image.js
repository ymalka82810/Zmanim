/**
 * ציור הלוח כתמונה (canvas) ויצירת PNG ו-PDF ממנה, בלי ספריות חיצוניות.
 * העיצוב תואם לתצוגת הלוח באתר.
 */

const C = { ink: '#1d2b45', blue: '#2c4a7c', muted: '#5d6b82', soft: '#e3e9f2', note: '#eef3fa', bg: '#ffffff' };
import { fontFamilies } from './config.js';

let SERIF, SANS;   // גופן הכותרת וגופן הטקסט, לפי התבנית
let SZ = { title: 1, name: 1, time: 1, zman: 1 };   // גדלי הטקסט של התבנית (1 = רגיל)
const px = (n, k) => Math.round(n * SZ[k] * 10) / 10;
const W = 800, M = 56, SCALE = 2;   // רוחב לוגי, שוליים, רזולוציה (1600 פיקסלים)

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

/** עובר על כל הלוח. אם draw=false רק מודד ומחזיר את הגובה. */
function layout(ctx, l, draw) {
  const R = W - M, inner = W - 2 * M;
  const text = (s, x, y, font, color, align) => {
    if (!draw) return;
    ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(s, x, y);
  };
  const rect = (x, y, w, h, color) => { if (draw) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); } };

  let y = 40;
  rect(M, y, inner, 8, C.blue); rect(M, y + 13, inner, 3, C.blue); rect(M, y + 21, inner, 8, C.blue);
  y += 29;

  if (l.shul) { y += 40; text(l.shul, W / 2, y, '700 22px ' + SANS, C.blue, 'center'); }

  const tf = '900 ' + px(50, 'title') + 'px ' + SERIF;
  ctx.font = tf;
  for (const line of wrap(ctx, l.title, inner)) { y += px(60, 'title'); text(line, W / 2, y, tf, C.ink, 'center'); }
  y += 32; text(l.dates, W / 2, y, '400 18px ' + SANS, C.muted, 'center');

  if (l.type === 'days') y = daysGrid(ctx, l, y, text, rect);
  else for (const s of l.sections) {
    y += 52;
    text(s.title, R, y, '700 24px ' + SANS, C.ink, 'right');
    text(s.date, M, y, '400 16px ' + SANS, C.muted, 'left');
    y += 12; rect(M, y, inner, 3, C.blue); y += 3;

    for (const r of s.rows) {
      const nf = '400 ' + px(21, 'name') + 'px ' + SANS, lh = px(28, 'name');
      ctx.font = nf;
      const lines = wrap(ctx, r.name, inner - px(110, 'time'));
      const top = y, base = top + 10 + Math.max(px(22, 'name'), px(22, 'time'));
      lines.forEach((line, i) => text(line, R, base + i * lh, nf, C.ink, 'right'));
      text(r.text, M, base, '700 ' + px(22, 'time') + 'px ' + SANS, C.ink, 'left');
      y = base + 14 + (lines.length - 1) * lh;
      rect(M, y - 1, inner, 1, C.soft);
    }

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
function daysGrid(ctx, l, y, text, rect) {
  const R = W - M, inner = W - 2 * M, labelW = 150, n = l.days.length, colW = (inner - labelW) / n;
  const cx = i => R - labelW - colW * (i + 0.5);
  const specials = l.days.some(d => d.special);

  y += 50;
  l.days.forEach((d, i) => {
    text(d.name, cx(i), y, '700 19px ' + SANS, C.ink, 'center');
    text(d.date, cx(i), y + 22, '400 15px ' + SANS, C.muted, 'center');
    if (d.special) {
      ctx.font = '700 13px ' + SANS;
      wrap(ctx, d.special.replace(/ · /g, '\n'), colW - 6).slice(0, 2)
        .forEach((line, k) => text(line, cx(i), y + 42 + k * 16, '700 13px ' + SANS, C.blue, 'center'));
    }
  });
  y += specials ? 70 : 32;
  rect(M, y, inner, 3, C.blue); y += 3;

  // ns – גודל השם, ts – גודל השעות
  const row = (r, ns, ts, color) => {
    ctx.font = '400 ' + ns + 'px ' + SANS;
    const lines = wrap(ctx, r.name, labelW - 10), top = y, size = Math.max(ns, ts);
    lines.forEach((line, k) => text(line, R, top + size + 12 + k * (ns + 7), '400 ' + ns + 'px ' + SANS, color, 'right'));
    r.cells.forEach((c, i) => { if (c != null) text(c, cx(i), top + size + 12, '700 ' + ts + 'px ' + SANS, color, 'center'); });
    y = top + size + 24 + (lines.length - 1) * (ns + 7);
  };
  for (const r of l.rows) { row(r, px(20, 'name'), px(20, 'time'), C.ink); rect(M, y - 1, inner, 1, C.soft); }
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

/** מצייר את הלוח ומחזיר canvas. font – מזהה הגופן של התבנית, sizes – הגדלים שלה באחוזים */
export async function luachCanvas(l, font, sizes = {}) {
  ({ title: SERIF, body: SANS } = fontFamilies(font));
  SZ = {};
  for (const k of ['title', 'name', 'time', 'zman']) SZ[k] = (Number(sizes[k]) || 100) / 100;
  await loadFonts(font);
  const canvas = document.createElement('canvas');
  let ctx = canvas.getContext('2d');
  ctx.direction = 'rtl';
  const h = Math.ceil(layout(ctx, l, false));
  canvas.width = W * SCALE; canvas.height = h * SCALE;
  ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);
  ctx.direction = 'rtl';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, h);
  layout(ctx, l, true);
  return canvas;
}

const toBlob = (canvas, type, q) => new Promise((ok, fail) =>
  canvas.toBlob(b => b ? ok(b) : fail(new Error('toBlob failed')), type, q));

export const pngBlob = canvas => toBlob(canvas, 'image/png');

/** PDF בעמוד A4 אחד, עם התמונה בראש העמוד (מוקטנת אם היא ארוכה מהעמוד) */
export async function pdfBlob(canvas) {
  const jpeg = new Uint8Array(await (await toBlob(canvas, 'image/jpeg', 0.92)).arrayBuffer());
  const PW = 595.28, PH = 841.89, iw = canvas.width, ih = canvas.height;
  let dw = PW, dh = PW * ih / iw;
  if (dh > PH) { dh = PH; dw = PH * iw / ih; }
  const x = (PW - dw) / 2, y = PH - dh;
  const f = n => n.toFixed(2);

  const enc = new TextEncoder(), parts = [], offsets = [];
  let len = 0;
  const push = p => { const b = typeof p === 'string' ? enc.encode(p) : p; parts.push(b); len += b.length; };
  const obj = (n, body) => { offsets[n] = len; push(n + ' 0 obj\n'); body(); push('\nendobj\n'); };
  const content = 'q ' + f(dw) + ' 0 0 ' + f(dh) + ' ' + f(x) + ' ' + f(y) + ' cm /Im0 Do Q';

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
  obj(3, () => push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + f(PW) + ' ' + f(PH) + '] ' +
    '/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>'));
  obj(4, () => {
    push('<< /Type /XObject /Subtype /Image /Width ' + iw + ' /Height ' + ih +
      ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.length + ' >>\nstream\n');
    push(jpeg); push('\nendstream');
  });
  obj(5, () => push('<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream'));

  const xref = len;
  push('xref\n0 6\n0000000000 65535 f \n' +
    [1, 2, 3, 4, 5].map(n => String(offsets[n]).padStart(10, '0') + ' 00000 n \n').join('') +
    'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
  return new Blob(parts, { type: 'application/pdf' });
}
