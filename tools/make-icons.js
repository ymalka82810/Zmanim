/**
 * יוצר את אייקוני האפליקציה (SVG + PNG) בלי תלויות חיצוניות.
 * הרצה: node tools/make-icons.js
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BLUE = [0x2c, 0x4a, 0x7c], WHITE = [0xf6, 0xf8, 0xfb], GOLD = [0xf2, 0xc1, 0x4e];
const stripes = [[70, 16], [98, 8], [118, 16], [378, 16], [406, 8], [426, 16]];
const shapes = [
  ...stripes.map(([y, h]) => ({ rect: [0, y, 512, h], c: WHITE })),
  { rect: [196, 232, 40, 130], c: WHITE }, { rect: [276, 232, 40, 130], c: WHITE },
  { ell: [216, 198, 14, 26], c: GOLD }, { ell: [296, 198, 14, 26], c: GOLD }
];

function svg(rounded) {
  let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">';
  s += '<rect width="512" height="512"' + (rounded ? ' rx="96"' : '') + ' fill="#2c4a7c"/>';
  if (rounded) s += '<clipPath id="c"><rect width="512" height="512" rx="96"/></clipPath><g clip-path="url(#c)">';
  const hex = c => '#' + c.map(x => x.toString(16).padStart(2, '0')).join('');
  for (const sh of shapes) {
    if (sh.rect) s += '<rect x="' + sh.rect[0] + '" y="' + sh.rect[1] + '" width="' + sh.rect[2] + '" height="' + sh.rect[3] + '" fill="' + hex(sh.c) + '"/>';
    else s += '<ellipse cx="' + sh.ell[0] + '" cy="' + sh.ell[1] + '" rx="' + sh.ell[2] + '" ry="' + sh.ell[3] + '" fill="' + hex(sh.c) + '"/>';
  }
  return s + (rounded ? '</g>' : '') + '</svg>\n';
}

function colorAt(x, y, rounded) {
  if (rounded) {
    const r = 96, cx = Math.min(Math.max(x, r), 512 - r), cy = Math.min(Math.max(y, r), 512 - r);
    if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) return null;
  }
  let c = BLUE;
  for (const sh of shapes) {
    if (sh.rect) { const [rx, ry, w, h] = sh.rect; if (x >= rx && x < rx + w && y >= ry && y < ry + h) c = sh.c; }
    else { const [ex, ey, a, b] = sh.ell; if (((x - ex) / a) ** 2 + ((y - ey) / b) ** 2 <= 1) c = sh.c; }
  }
  return c;
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}

function png(size, rounded) {
  const SS = 4, raw = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const c = colorAt((px + (sx + .5) / SS) * 512 / size, (py + (sy + .5) / SS) * 512 / size, rounded);
        if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
      }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      raw[o] = a ? r / a : 0; raw[o + 1] = a ? g / a : 0; raw[o + 2] = a ? b / a : 0; raw[o + 3] = a * 255 / (SS * SS);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

writeFileSync('icons/icon.svg', svg(true));
writeFileSync('icons/icon-192.png', png(192, true));
writeFileSync('icons/icon-512.png', png(512, true));
writeFileSync('icons/maskable-512.png', png(512, false));
console.log('האייקונים נוצרו בתיקייה icons/');
