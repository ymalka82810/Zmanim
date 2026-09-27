/**
 * ציור הלוח כתמונה (canvas) ויצירת PNG ו-PDF ממנה, בלי ספריות חיצוניות.
 * העיצוב תואם לתצוגת הלוח באתר.
 */

const C = { ink: '#1d2b45', blue: '#2c4a7c', muted: '#5d6b82', soft: '#e3e9f2', note: '#eef3fa', bg: '#ffffff' };
import { fontFamilies } from './config.js';

let SERIF, SANS;   // גופן הכותרת וגופן הטקסט, לפי הבחירה בהגדרות
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

  ctx.font = '900 50px ' + SERIF;
  for (const line of wrap(ctx, l.title, inner)) { y += 60; text(line, W / 2, y, '900 50px ' + SERIF, C.ink, 'center'); }
  y += 32; text(l.dates, W / 2, y, '400 18px ' + SANS, C.muted, 'center');

  if (l.type === 'days') y = daysGrid(ctx, l, y, text, rect);
  else for (const s of l.sections) {
    y += 52;
    text(s.title, R, y, '700 24px ' + SANS, C.ink, 'right');
    text(s.date, M, y, '400 16px ' + SANS, C.muted, 'left');
    y += 12; rect(M, y, inner, 3, C.blue); y += 3;

    for (const r of s.rows) {
      ctx.font = '400 21px ' + SANS;
      const lines = wrap(ctx, r.name, inner - 110);
      const top = y;
      lines.forEach((line, i) => text(line, R, top + 32 + i * 28, '400 21px ' + SANS, C.ink, 'right'));
      text(r.text, M, top + 32, '700 22px ' + SANS, C.ink, 'left');
      y = top + 46 + (lines.length - 1) * 28;
      rect(M, y - 1, inner, 1, C.soft);
    }

    if (s.zmanim.length) {
      // זמני היום: פריטים מימין לשמאל, עם מעבר שורה כשצריך
      ctx.font = '400 15px ' + SANS;
      const gap = 22, items = s.zmanim.map(z => ({ label: z[0] + ' ', time: z[1] }));
      const widthOf = it => {
        ctx.font = '400 15px ' + SANS; const a = ctx.measureText(it.label).width;
        ctx.font = '700 15px ' + SANS; return a + ctx.measureText(it.time).width;
      };
      y += 26;
      let x = R;
      for (const it of items) {
        const w = widthOf(it);
        if (x !== R && x - w < M) { x = R; y += 24; }
        if (draw) {
          ctx.font = '400 15px ' + SANS; const lw = ctx.measureText(it.label).width;
          text(it.label, x, y, '400 15px ' + SANS, C.muted, 'right');
          text(it.time, x - lw, y, '700 15px ' + SANS, C.muted, 'right');
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

  const row = (r, size, weight, color) => {
    ctx.font = weight + ' ' + size + 'px ' + SANS;
    const lines = wrap(ctx, r.name, labelW - 10), top = y;
    lines.forEach((line, k) => text(line, R, top + size + 12 + k * (size + 7), weight + ' ' + size + 'px ' + SANS, color, 'right'));
    r.cells.forEach((c, i) => { if (c != null) text(c, cx(i), top + size + 12, '700 ' + size + 'px ' + SANS, color, 'center'); });
    y = top + size + 24 + (lines.length - 1) * (size + 7);
  };
  for (const r of l.rows) { row(r, 20, 400, C.ink); rect(M, y - 1, inner, 1, C.soft); }
  y += 6;
  for (const r of l.zmanim) row(r, 15, 400, C.muted);
  return y;
}

async function loadFonts() {
  if (!document.fonts) return;
  // הגדרות הגופן מ-Google Fonts עוד בטעינה (למשל מיד אחרי שהגופן הוחלף)
  const link = document.getElementById('fontLink');
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

/** מצייר את הלוח ומחזיר canvas. font – מזהה הגופן מההגדרות */
export async function luachCanvas(l, font) {
  ({ title: SERIF, body: SANS } = fontFamilies(font));
  await loadFonts();
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
