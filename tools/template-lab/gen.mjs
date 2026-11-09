// מחולל תבניות סינתטיות: מצייר עמוד, ומחזיר { image, slots, fonts, mainFont, candidates }
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
GlobalFonts.registerFromPath('/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf', 'Frank Ruhl Libre');
GlobalFonts.registerFromPath('/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf', 'Frank Ruhl Libre');
GlobalFonts.registerFromPath('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 'Assistant');
GlobalFonts.registerFromPath('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 'Assistant');
const W = 1600, H = 2263;
export function page({ bg = '#ffffff', family = 'Frank Ruhl Libre', serif = true } = {}) {
  const c = createCanvas(W, H), x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  x.direction = 'rtl'; x.textAlign = 'center';
  const slots = [], cands = [];
  const fonts = { f1: { family, serif, bold: false }, f2: { family, serif, bold: true } };
  const font = (sz, bold) => (bold ? '700 ' : '400 ') + sz + 'px "' + family + '"';
  // כותב טקסט ממורכז ב-cx; מחזיר תיבה כמו מה-PDF
  const text = (str, cx, base, sz, { bold = false, fg = '#000', align = 'center' } = {}) => {
    x.font = font(sz, bold); x.fillStyle = fg; x.textAlign = align;
    x.fillText(str, cx, base);
    const m = x.measureText(str), w = m.width;
    const left = align === 'center' ? cx - w / 2 : align === 'right' ? cx - w : cx;
    x.textAlign = 'center';
    return { x: left, y: base - m.actualBoundingBoxAscent, w, h: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent, baseline: base, size: sz, font: bold ? 'f2' : 'f1' };
  };
  const st = (fg = '#000', b = bg, bold = false) => ({ bg: b, fg, bold, stroke: 0.06 });
  const api = {
    W, H, x, text,
    // שורת "שם – שעה" ממורכזת; שעה משמאל לשם
    timeLine(label, time, base, sz, slot, o = {}) {
      x.font = font(sz, o.bold);
      const full = label + ' – ' + time, w = x.measureText(full).width, cx = o.cx ?? W / 2;
      const lw = x.measureText(label).width, tw = x.measureText(time).width;
      const right = cx + w / 2;
      const lb = text(label, right - lw / 2, base, sz, { fg: o.fg, bold: o.bold });
      text('–', right - lw - (w - lw - tw) / 2, base, sz, { fg: o.fg });
      const tb = text(time, right - w + tw / 2, base, sz, { fg: o.fg });
      slots.push({ ...slot, box: tb, labelBox: o.noLabel ? undefined : lb, label, old: time, sizePct: 100, wrap: false, style: st(o.fg, o.bg), labelStyle: st(o.fg, o.bg) });
    },
    // שורה בטבלה: שם בימין, שעה בשמאל
    row(label, time, base, sz, slot, o = {}) {
      const lb = text(label, o.rx ?? W - 300, base, sz, { align: 'right', fg: o.fg, bold: o.bold });
      const tb = text(time, o.lx ?? 300, base, sz, { align: 'left', fg: o.fg });
      slots.push({ ...slot, box: tb, labelBox: lb, label, old: time, sizePct: 100, wrap: false, style: st(o.fg, o.bg), labelStyle: st(o.fg, o.bg) });
    },
    slot(kind, str, base, sz, extra = {}, o = {}) {
      const b = text(str, o.cx ?? W / 2, base, sz, { bold: o.bold, fg: o.fg });
      slots.push({ kind, box: b, old: str, sizePct: 100, wrap: false, style: st(o.fg, o.bg, o.bold), ...extra });
      return b;
    },
    // טקסט רב-שורתי (קידוש / הודעה): תיבה אחת על כל השורות
    multi(kind, lines, base, sz, gap, extra = {}, o = {}) {
      const bs = lines.map((ln, i) => text(ln, o.cx ?? W / 2, base + i * gap, sz, { bold: o.bold, fg: o.fg }));
      const x0 = Math.min(...bs.map(b => b.x)), x1 = Math.max(...bs.map(b => b.x + b.w));
      const y0 = bs[0].y, y1 = Math.max(...bs.map(b => b.y + b.h));
      slots.push({ kind, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0, baseline: base + (lines.length - 1) * gap / 2, size: sz, font: o.bold ? 'f2' : 'f1' }, old: lines.join(' '),
        sizePct: 100, wrap: true, lineCount: lines.length, srcLines: lines.length, lineHeightPct: 100, style: st(o.fg, o.bg, o.bold), ...extra });
    },
    plain: (str, cx, base, sz, o = {}) => { const b = text(str, cx, base, sz, o); cands.push({ box: b, old: str }); return b; },
    rule: (y, th = 3, x0 = 80, x1 = W - 80, col = '#000') => { x.fillStyle = col; x.fillRect(x0, y, x1 - x0, th); },
    frame: (m = 50, th = 6, col = '#000') => { x.strokeStyle = col; x.lineWidth = th; x.strokeRect(m, m, W - 2 * m, H - 2 * m); },
    bubble(bx, by, bw, bh, tipX, tipY, lines, sz) {
      x.strokeStyle = '#000'; x.lineWidth = 3; x.beginPath();
      x.roundRect(bx, by, bw, bh, 30); x.stroke();
      const side = tipX > bx + bw ? bx + bw : bx;
      x.beginPath(); x.moveTo(side - 1, by + 25); x.lineTo(tipX, tipY); x.lineTo(side - 1, by + 60); x.stroke();
      x.fillStyle = bg; x.fillRect(side - 3, by + 27, 4, 31);
      lines.forEach((ln, i) => api.plain(ln, bx + bw / 2, by + 50 + i * sz * 1.25, sz));
    },
    done() {
      return { image: c.toDataURL('image/jpeg', 0.92), slots, candidates: cands, fonts, mainFont: 'f1', enabled: true };
    }
  };
  return api;
}
