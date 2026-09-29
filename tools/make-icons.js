/**
 * יוצר את כל אייקוני האפליקציה (אתר + אנדרואיד) ומסך הפתיחה הילידי, בלי תלויות חיצוניות.
 * העיצוב: שני נרות שבת על רקע כחול-כהה חם, בצבעי האפליקציה עצמה (לא צבעי ברירת מחדל).
 * הרצה: node tools/make-icons.js
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

/* צבעי המותג (תואמים css/app.css: --blue, --gold, --paper) */
const NAVY = [0x1e, 0x3a, 0x63];
const NAVY_LIGHT = [0x35, 0x58, 0x8f];
const NAVY_DARK = [0x14, 0x28, 0x46];
const CREAM = [0xf7, 0xf4, 0xee];
const CREAM_SHADE = [0xd9, 0xd2, 0xc2];
const WICK = [0x3a, 0x2c, 0x1c];
const GOLD = [0xd9, 0xa6, 0x3e];
const GOLD_BRIGHT = [0xf6, 0xda, 0x84];
const GOLD_GLOW = [0xf2, 0xc1, 0x4e];

const CX = 256, CY = 256;

function candle(cx, top, bottom, w) {
  const shapes = [];
  const wickH = 20;
  /* זוהר רך מאחורי הלהבה (גרדיאנט רדיאלי חלק, לא טבעות) */
  shapes.push({ radial: [cx, top - wickH - 10, w * 0.5, w * 2.6], c: GOLD_GLOW, a: 0.4 });
  /* גוף הנר */
  shapes.push({ rect: [cx - w / 2, top, w, bottom - top], c: CREAM, a: 1, rx: w * 0.3 });
  /* הצללה עדינה בצד ימין */
  shapes.push({ rect: [cx + w * 0.08, top, w / 2, bottom - top], c: CREAM_SHADE, a: 0.55, rx: w * 0.2 });
  /* ברק עדין בצד שמאל */
  shapes.push({ rect: [cx - w / 2, top, w * 0.22, bottom - top], c: [255, 255, 255], a: 0.35, rx: w * 0.1 });
  /* פתיל */
  shapes.push({ rect: [cx - 2.5, top - wickH, 5, wickH + 3], c: WICK, a: 1, rx: 2 });
  /* להבה: בסיס זהוב + חוד בהיר */
  shapes.push({ ell: [cx, top - wickH - 16, w * 0.62, w * 0.78], c: GOLD, a: 1 });
  shapes.push({ ell: [cx, top - wickH - 26, w * 0.34, w * 0.5], c: GOLD_BRIGHT, a: 1 });
  return shapes;
}

const GAP = 34, CW = 48, TOP = 210, BOTTOM = 348;
const LX = CX - GAP / 2 - CW / 2, RX = CX + GAP / 2 + CW / 2;

/* מגש/בסיס דק מתחת לנרות, לתחושת "קרקוע" */
const TRAY = [
  { rect: [CX - 108, BOTTOM, 216, 7], c: GOLD, a: 0.9, rx: 3.5 },
  { rect: [CX - 108, BOTTOM, 216, 7], c: [0, 0, 0], a: 0.12, rx: 3.5 }
];

const FOREGROUND = [...candle(LX, TOP, BOTTOM, CW), ...candle(RX, TOP, BOTTOM, CW), ...TRAY];

/* זוהר רך בפינה העליונה לעומק ברקע (גרדיאנט רדיאלי חלק) */
const BG_GLOW = [
  { radial: [190, 150, 40, 460], c: NAVY_LIGHT, a: 0.5 },
  { radial: [340, 420, 40, 420], c: NAVY_DARK, a: 0.45 }
];

const BACKGROUND = [{ rect: [0, 0, 512, 512], c: NAVY, a: 1 }, ...BG_GLOW];
const FULL = [...BACKGROUND, ...FOREGROUND];

function hexColor(c) { return '#' + c.map(x => x.toString(16).padStart(2, '0')).join(''); }

function svgShapes(shapes) {
  let s = '';
  for (const sh of shapes) {
    const op = sh.a === undefined ? 1 : sh.a;
    if (sh.rect) {
      const [x, y, w, h] = sh.rect;
      s += `<rect x="${x}" y="${y}" width="${w}" height="${h}"${sh.rx ? ` rx="${sh.rx}"` : ''} fill="${hexColor(sh.c)}" fill-opacity="${op}"/>`;
    } else if (sh.radial) {
      const [cx, cy, rInner, rOuter] = sh.radial;
      const gid = 'g' + Math.round(cx) + '_' + Math.round(cy);
      s += `<radialGradient id="${gid}" cx="${cx}" cy="${cy}" r="${rOuter}" gradientUnits="userSpaceOnUse"><stop offset="${rInner / rOuter}" stop-color="${hexColor(sh.c)}" stop-opacity="${op}"/><stop offset="1" stop-color="${hexColor(sh.c)}" stop-opacity="0"/></radialGradient><circle cx="${cx}" cy="${cy}" r="${rOuter}" fill="url(#${gid})"/>`;
    } else {
      const [cx, cy, rx, ry] = sh.ell;
      s += `<ellipse cx="${cx}" cy="${cy}" rx="${rx / 2}" ry="${ry / 2}" fill="${hexColor(sh.c)}" fill-opacity="${op}"/>`;
    }
  }
  return s;
}

function svg({ shapes, rounded }) {
  let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">';
  if (rounded) s += '<clipPath id="c"><rect width="512" height="512" rx="112"/></clipPath><g clip-path="url(#c)">';
  s += svgShapes(shapes);
  if (rounded) s += '</g>';
  return s + '</svg>\n';
}

/* --- בדיקת פגיעה בצורה (rect עם פינות מעוגלות, ellipse, או radial) --- */
function hit(sh, x, y) {
  if (sh.rect) {
    const [rx, ry, w, h] = sh.rect;
    if (x < rx || x >= rx + w || y < ry || y >= ry + h) return false;
    const r = sh.rx || 0;
    if (r <= 0) return true;
    const cx = Math.min(Math.max(x, rx + r), rx + w - r);
    const cy = Math.min(Math.max(y, ry + r), ry + h - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  }
  if (sh.radial) {
    const [ex, ey, , rOuter] = sh.radial;
    return Math.hypot(x - ex, y - ey) <= rOuter;
  }
  const [ex, ey, w, h] = sh.ell;
  const a = w / 2, b = h / 2;
  return ((x - ex) / a) ** 2 + ((y - ey) / b) ** 2 <= 1;
}

/* עוצמת אלפא בנקודה עבור צורה נתונה (קבועה 1, חוץ מ-radial שדועך חלק) */
function alphaAt(sh, x, y) {
  const base = sh.a === undefined ? 1 : sh.a;
  if (!sh.radial) return base;
  const [ex, ey, rInner, rOuter] = sh.radial;
  const d = Math.hypot(x - ex, y - ey);
  if (d <= rInner) return base;
  const t = Math.min(Math.max((d - rInner) / (rOuter - rInner), 0), 1);
  const eased = 1 - t * t * (3 - 2 * t); // smoothstep
  return base * eased;
}

function mix(base, c, a) {
  return [
    base[0] + (c[0] - base[0]) * a,
    base[1] + (c[1] - base[1]) * a,
    base[2] + (c[2] - base[2]) * a
  ];
}

/* מחזיר {c:[r,g,b], a} בנקודה נתונה, לפי כל השכבות; base שקוף אם אין רקע */
function sample(shapes, x, y) {
  let c = [0, 0, 0], a = 0;
  for (const sh of shapes) {
    if (!hit(sh, x, y)) continue;
    const sa = alphaAt(sh, x, y);
    c = mix(c, sh.c, a === 0 ? 1 : sa);
    a = a + sa * (1 - a);
  }
  return { c, a };
}

/* מסכת חיתוך: null = בלי חיתוך, 'round-rect' = פינות מעוגלות, 'circle' = עיגול מלא */
function clipAt(x, y, clip) {
  if (!clip) return true;
  if (clip === 'circle') return (x - 256) ** 2 + (y - 256) ** 2 <= 256 * 256;
  const r = 112;
  const cx = Math.min(Math.max(x, r), 512 - r), cy = Math.min(Math.max(y, r), 512 - r);
  if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) {
    if (x >= r && x < 512 - r) return true;
    if (y >= r && y < 512 - r) return true;
    return false;
  }
  return true;
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}

/* דיתור מסודר (Bayer 4x4), כדי לשבור פסי-צבע (banding) על גרדיאנטים רדיאליים רכים */
const BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
const dither = (x, y) => (BAYER4[y & 3][x & 3] / 16 - 0.5) * 1.4;
const clamp255 = v => v < 0 ? 0 : v > 255 ? 255 : v;

function renderPng(size, shapes, { clip = null, canvas = 512 } = {}) {
  const SS = 3, raw = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const x = (px + (sx + .5) / SS) * canvas / size, y = (py + (sy + .5) / SS) * canvas / size;
        if (!clipAt(x, y, clip)) continue;
        const s = sample(shapes, x, y);
        r += s.c[0] * s.a; g += s.c[1] * s.a; b += s.c[2] * s.a; a += s.a;
      }
      const n = SS * SS;
      const o = py * (size * 4 + 1) + 1 + px * 4;
      const alpha = a / n, d = dither(px, py);
      raw[o] = alpha > 0 ? Math.round(clamp255(r / a + d)) : 0;
      raw[o + 1] = alpha > 0 ? Math.round(clamp255(g / a + d)) : 0;
      raw[o + 2] = alpha > 0 ? Math.round(clamp255(b / a + d)) : 0;
      raw[o + 3] = Math.round(clamp255(alpha * 255));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function write(path, buf) { mkdirSync(path.substring(0, path.lastIndexOf('/')), { recursive: true }); writeFileSync(path, buf); }

/* ---------- אייקוני האתר / PWA ---------- */
write('icons/icon.svg', Buffer.from(svg({ shapes: FULL, rounded: true })));
write('icons/icon-192.png', renderPng(192, FULL, { clip: 'round-rect' }));
write('icons/icon-512.png', renderPng(512, FULL, { clip: 'round-rect' }));
write('icons/maskable-512.png', renderPng(512, FULL)); // בלי חיתוך: המערכת מיישמת מסכה משלה, התוכן כבר בתוך אזור בטוח

/* עותקי עזר תחת assets/ לשימוש עתידי (רקע/חזית/עגול) */
write('assets/icon-only.svg', Buffer.from(svg({ shapes: FULL, rounded: true })));
write('assets/icon-round.svg', Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><clipPath id="r"><circle cx="256" cy="256" r="256"/></clipPath><g clip-path="url(#r)">${svgShapes(FULL)}</g></svg>\n`));
write('assets/icon-background.svg', Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${svgShapes(BACKGROUND)}</svg>\n`));
write('assets/icon-foreground.svg', Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${svgShapes(FOREGROUND)}</svg>\n`));

/* ---------- אנדרואיד: אייקון אדפטיבי (רקע אחיד + חזית עם שקיפות) ---------- */
const ADAPTIVE = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
for (const [d, s] of Object.entries(ADAPTIVE)) {
  write(`android/app/src/main/res/mipmap-${d}/ic_launcher_foreground.png`, renderPng(s, FOREGROUND));
}

/* ---------- אנדרואיד: אייקון קלאסי (fallback ל-API<26 ולכמה משגרים) ---------- */
const LEGACY = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [d, s] of Object.entries(LEGACY)) {
  write(`android/app/src/main/res/mipmap-${d}/ic_launcher.png`, renderPng(s, FULL, { clip: 'round-rect' }));
  write(`android/app/src/main/res/mipmap-${d}/ic_launcher_round.png`, renderPng(s, FULL, { clip: 'circle' }));
}

/* ---------- מסך פתיחה ילידי: לוגו ממורכז על רקע כחול המותג ---------- */
function splashShapes(w, h) {
  const scale = Math.min(w, h) * 0.42 / 512; // הלוגו תופס כ-42% מהצלע הקצרה
  const ox = w / 2, oy = h / 2;
  const short = Math.min(w, h);
  const bg = [{ rect: [0, 0, w, h], c: NAVY, a: 1 },
    { radial: [ox, oy, short * 0.08, short * 0.6], c: NAVY_LIGHT, a: 0.32 }];
  const logo = FOREGROUND.map(sh => {
    if (sh.rect) return { ...sh, rect: [ox + (sh.rect[0] - 256) * scale, oy + (sh.rect[1] - 256) * scale, sh.rect[2] * scale, sh.rect[3] * scale], rx: sh.rx ? sh.rx * scale : undefined };
    if (sh.radial) return { ...sh, radial: [ox + (sh.radial[0] - 256) * scale, oy + (sh.radial[1] - 256) * scale, sh.radial[2] * scale, sh.radial[3] * scale] };
    return { ...sh, ell: [ox + (sh.ell[0] - 256) * scale, oy + (sh.ell[1] - 256) * scale, sh.ell[2] * scale, sh.ell[3] * scale] };
  });
  return [...bg, ...logo];
}
function renderCustom(w, h, shapes) {
  const SS = 3, raw = Buffer.alloc(h * (w * 4 + 1));
  for (let py = 0; py < h; py++) {
    raw[py * (w * 4 + 1)] = 0;
    for (let px = 0; px < w; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const x = px + (sx + .5) / SS, y = py + (sy + .5) / SS;
        const s = sample(shapes, x, y);
        r += s.c[0] * s.a; g += s.c[1] * s.a; b += s.c[2] * s.a; a += s.a;
      }
      const n = SS * SS;
      const o = py * (w * 4 + 1) + 1 + px * 4;
      const alpha = a / n, d = dither(px, py);
      raw[o] = alpha > 0 ? Math.round(clamp255(r / a + d)) : 0;
      raw[o + 1] = alpha > 0 ? Math.round(clamp255(g / a + d)) : 0;
      raw[o + 2] = alpha > 0 ? Math.round(clamp255(b / a + d)) : 0;
      raw[o + 3] = Math.round(clamp255(alpha * 255));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const SPLASH_SIZES = {
  'drawable': [480, 320], // fallback גנרי
  'drawable-land-mdpi': [480, 320], 'drawable-land-hdpi': [800, 480], 'drawable-land-xhdpi': [1280, 720], 'drawable-land-xxhdpi': [1600, 960], 'drawable-land-xxxhdpi': [1920, 1280],
  'drawable-port-mdpi': [320, 480], 'drawable-port-hdpi': [480, 800], 'drawable-port-xhdpi': [720, 1280], 'drawable-port-xxhdpi': [960, 1600], 'drawable-port-xxxhdpi': [1280, 1920]
};
for (const [dir, [w, h]] of Object.entries(SPLASH_SIZES)) {
  write(`android/app/src/main/res/${dir}/splash.png`, renderCustom(w, h, splashShapes(w, h)));
}

console.log('האייקונים ומסך הפתיחה נוצרו: icons/, assets/, android/app/src/main/res/{mipmap-*,drawable*}');
