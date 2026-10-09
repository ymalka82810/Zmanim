/** מסגרות האזורים על העמוד ועריכת הטקסט שבתוכן (חלק מ-js/template-ui.js שפוצל) */

import { SIZES } from './config.js';
import { wordBoxes } from './template-read.js';
import { analyzeSlot, inkLines, specialHost, slotText, slotKey } from './template-render.js';
import { esc } from './render.js';
import { openTextEdit } from './text-edit.js';
import { $, st, openSlots } from './template-state.js';
import { setMoving, drag, resize, move } from './template-move.js';
import { weekLabel, weekKey, saveWeekLine, weekEditsFor, resetWeek } from './template-lines.js';
import { renderSlots } from './template-slots.js';
import { builtSlots, lookOf, schedulePreviewRefresh } from './template-build.js';

const pct = (v, total) => (v / total * 100).toFixed(3) + '%';
export function boxStyle(b) {
  return 'right:' + pct(st.W - b.x - b.w, st.W) + ';top:' + pct(b.y, st.H) + ';width:' + pct(b.w, st.W) + ';height:' + pct(b.h, st.H);
}

/** מספור האזורים לפי מיקומם בעמוד (שורה עליונה למטה, בכל שורה מימין לשמאל) ולא לפי סדר ההוספה */
export const slotRanks = () => pageRanks(st.slots);

export function unionBox(a, b) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/**
 * איפה האזור מוצג על העמוד שבעורך: העמוד מצויר מחדש עם הטקסט החדש, ושורות שנפתחו או נסגרו מזיזות את מה שמתחתיהן.
 * { box, label } – המקום שבו נכתב הטקסט (בגודל שלו), ושל השם שליד השעה. אזור שעוד לא צויר – רק מוזז עם השורות
 */
function shownBox(s) {
  const v = st.view, e = v && v.slots.get(s);
  const moved = b => b && v ? { ...b, y: v.toView(b.y) } : b;
  if (!e || (resize && resize.s === s) || (move && move.s === s)) return { box: moved(s.box), label: moved(s.labelBox) };
  // מסגרת קצת רחבה מהדיו, כדי שיהיה נוח ללחוץ עליה
  const pad = b => { const k = Math.max(2, Math.min(b.h, b.w) * 0.12); return { x: b.x - k, y: b.y - k, w: b.w + 2 * k, h: b.h + 2 * k }; };
  return { box: e.ink ? pad(e.ink) : e.box, label: e.labelInk ? pad(e.labelInk) : e.labelBox };
}

export function renderBoxes() {
  const ranks = slotRanks();
  let h = '';
  const same = (a, b) => a && a.x === b.x && a.y === b.y;
  st.candidates.forEach((c, i) => {
    if (st.slots.some(s => same(s.box, c.box) || same(s.labelBox, c.box) || covers(s.box, c.box) || movedFrom(s, c.box))) return;
    const b = (st.view && st.view.candidates[i]) || c.box;
    h += '<button type="button" class="tb cand" data-c="' + i + '" style="' + boxStyle(b) + '" title="' + esc(c.old) + '" aria-label="הוספת אזור: ' + esc(c.old) + '"></button>';
  });
  const shown = st.slots.map(shownBox);
  st.slots.forEach((s, i) => {
    // שעה עם השם שלידה: מסגרת אחת לשניהם, ובתוכה מסומן המקום שבו תיכתב השעה החדשה
    const { box, label } = shown[i];
    const lb = (s.kind === 'rule' || s.kind === 'zman') && label;
    const outer = lb ? unionBox(box, lb) : box;
    h += '<button type="button" class="tb slot' + (i === st.sel ? ' sel' : '') + '" data-s="' + i + '" style="' + boxStyle(outer) +
      '" aria-label="אזור ' + ranks[i] + '" title="' + (st.moving ? 'גרירה – הזזה למקום אחר בעמוד' : 'לחיצה – עריכת האזור') + '"><span>' + ranks[i] + '</span></button>';
    if (lb) h += '<div class="tb val" style="' + boxStyle(box) + '"></div>';
  });
  if (move && move.ghost) h += '<div class="tb slot drag ghost" style="' + boxStyle(move.ghost) + '"></div>';
  const sel = st.slots[st.sel];
  if (sel && !st.drawing) {
    // ידיות למתיחת האזור הנבחר
    const b = shown[st.sel].box, at = (right, top) => 'right:' + pct(right, st.W) + ';top:' + pct(top, st.H);
    for (const [edge, r, t, label] of [['r', st.W - b.x - b.w, b.y + b.h / 2, 'שמאל'], ['l', st.W - b.x, b.y + b.h / 2, 'ימין'],
      ['t', st.W - b.x - b.w / 2, b.y, 'למעלה'], ['b', st.W - b.x - b.w / 2, b.y + b.h, 'למטה']]) {
      h += '<div class="rh rh-' + edge + '" data-edge="' + edge + '" style="' + at(r, t) + '" title="מתיחת האזור ' + label + '"></div>';
    }
  }
  $('tplBoxes').innerHTML = h;
}

/** האם מרכז התיבה b נמצא בתוך a */
export const covers = (a, b) => {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  return cx > a.x && cx < a.x + a.w && cy > a.y && cy < a.y + a.h;
};
/** טקסט מהקובץ במקום שממנו האזור s הוזז – נמחק בציור */
export const movedFrom = (s, b) => !!s.origin && (covers(s.origin.box, b) || (!!s.origin.labelBox && covers(s.origin.labelBox, b)));
/** משפחת הגופן של מילה: הגרסה המודגשת או הנטויה של גופן היא אותו גופן, לא גופן אחר */
const fontFamily = c => { const f = st.fonts[c.box.font]; return (f && f.family) || c.box.font || ''; };
const fontOf = c => st.fonts[c.box.font] || {};

/**
 * אזור של פרשה שנמתח על טקסט שלפניו ("לשבת", "זמני התפילות לשבת"): הטקסט המכוסה נשמר
 * כטקסט שלפני הפרשה ונכתב מחדש יחד איתה. nameBox – האזור לפני המתיחה הראשונה
 */
export function stretchPrefix(s) {
  const edge = s.nameBox.x + s.nameBox.w - 2;
  const words = st.candidates.filter(c => covers(s.box, c.box) && c.box.x + c.box.w / 2 > edge)
    .sort((a, b) => b.box.x - a.box.x).map(c => c.old);
  const all = [...words, (s.autoPrefix || '').trim()].filter(Boolean);
  s.prefix = all.length ? all.join(' ') + ' ' : '';
}

/**
 * אזור שסומן בגרירה והפך ל"טקסט שכותבים כאן": הטקסט שמתחת למסגרת (כולל "!" ו"?"), כשכל שורה בפני עצמה,
 * והמראה של הטקסט – גופן, נטייה, הדגשה וקו תחתון. מחזיר את הטקסט, בשורות מופרדות ב-\n.
 * כשבאזור כמה גופנים (או נטייה שמשתנה) הוא מתחלק: שורות רצופות באותו גופן נשארות באזור הזה,
 * וכל קבוצה אחרת הופכת לאזור טקסט נוסף מתחתיו, כי לכל אזור גופן אחד
 */
export function readTextArea(s) {
  const drawn = s.box;
  const taken = c => st.slots.some(o => (o !== s && covers(o.box, c.box)) || (o.labelBox && covers(o.labelBox, c.box)));
  const words = st.candidates.filter(c => covers(drawn, c.box) && !taken(c));
  if (!words.length) { fitKiddush(s, false); return s.old || ''; }
  const marks = (st.marks || []).filter(c => covers(drawn, c.box) && !taken(c));
  const rows = [];
  for (const c of [...words, ...marks].sort((a, b) => lineBase(a.box) - lineBase(b.box))) {
    const size = c.box.size || c.box.h * 0.72;
    const row = rows.find(r => Math.abs(r.baseline - lineBase(c.box)) < Math.max(r.size, size) * 0.45);
    if (row) row.parts.push(c); else rows.push({ baseline: lineBase(c.box), size, parts: [c] });
  }
  // גופן השורה הוא של המילה הגדולה בה; שורות רצופות באותו גופן ובאותה נטייה הן קבוצה אחת
  const biggest = parts => parts.reduce((a, c) => (c.box.size || 0) > (a.box.size || 0) ? c : a, parts[0]);
  const lookOf = r => { const w = biggest(r.parts.filter(c => words.includes(c))); return w ? fontFamily(w) : null; };
  const groups = [];
  for (const r of rows) {
    const look = lookOf(r), g = groups[groups.length - 1];
    if (g && (look === null || g.look === look)) g.rows.push(r); else groups.push({ look, rows: [r] });
  }
  // קודם המסגרות מצטמצמות לקבוצות שלהן, כדי שכל קבוצה תקרא רק את המילים שלה
  const boxes = groups.map(g => g.rows.flatMap(r => r.parts).reduce((b, c) => unionBox(b, c.box), g.rows[0].parts[0].box));
  const areas = groups.map((g, i) => i === 0 ? s : { box: { ...boxes[i] }, kind: 'text', when: s.when, old: '' });
  s.box = { ...s.box, ...boxes[0] };
  st.slots.splice(st.slots.indexOf(s) + 1, 0, ...areas.slice(1));
  const texts = groups.map((g, i) => fillTextArea(areas[i], g.rows, words, biggest));
  areas.slice(1).forEach((o, i) => { o.text = texts[i + 1]; });
  return texts[0];
}

/** קורא לאזור אחד את הטקסט, השורות והמראה של השורות שלו (rows), כשכולן באותו גופן */
function fillTextArea(s, rows, words, biggest) {
  fitKiddush(s, false);   // מספר השורות, קו הבסיס, הריווח והגודל
  const all = rows.flatMap(r => r.parts), u = all.reduce((b, c) => unionBox(b, c.box), all[0].box);
  const first = biggest(all.filter(c => words.includes(c)));
  // האזור נכתב בגרסה הרגילה של הגופן, וההדגשה והנטייה באות מהסימון שבטקסט
  const plain = biggest(all.filter(c => words.includes(c) && !fontOf(c).bold && !fontOf(c).italic)) || first;
  // הדגשה ורקע נמדדים על שורה אחת – באזור של כמה שורות עובי הקו יחסית לגובה כולו נראה דק
  const style = analyzeSlot(st.canvas, first.box);
  // המראה של כל מילה לחוד: מה שנמצא בכולן הוא מראה האזור כולו, ומה שנמצא רק בחלקן מסומן במילים עצמן
  // כל מילה בתיבה משלה: בקובץ שורה שלמה היא לפעמים פריט אחד, ורק מילה אחת בה מודגשת או עם קו תחתון
  const pieces = new Map(all.filter(c => words.includes(c)).map(c => [c, wordBoxes(c)]));
  rows = rows.map(r => ({ ...r, parts: r.parts.flatMap(c => pieces.get(c) || [c]) }));
  const own = new Map(), ulDims = [], mine = [...pieces.values()].flat();
  // עובי הקו של כל מילה, ביחס לגובה שלה. Word מדגיש גופן עברי שאין לו גרסה מודגשת בקו מתאר עבה, באותו גופן –
  // אז ההדגשה נראית רק בתמונה: מילה שהקו שלה עבה בבירור מהרגיל באזור
  const looks = new Map(mine.map(c => [c, analyzeSlot(st.canvas, c.box)]));
  const strokes = [...looks.values()].map(l => l.stroke || 0).sort((a, b) => a - b), usual = strokes[(strokes.length - 1) >> 1];
  for (const c of mine) {
    // הקו נבדק במרכז המילה: הרוחב שלה בתוך השורה משוער, והקו של מילה סמוכה לא ייחשב שלה
    const size = c.box.size || c.box.h * 0.72, inner = { ...c.box, x: c.box.x + c.box.w * 0.15, w: c.box.w * 0.7 };
    const ul = findUnderline({ ...inner, size, baseline: lineBase(c.box) }, style.bg);
    if (ul) ulDims.push(ul);
    const lk = looks.get(c), thick = lk.bold || (usual > 0 && lk.stroke > usual * 1.3);
    // מילה מודגשת או נטויה בקובץ היא לרוב בגופן נפרד (David-Bold), או מוטה במטריצה (box.italic)
    own.set(c, { b: !!fontOf(c).bold || thick, i: !!c.box.italic || !!fontOf(c).italic, u: !!ul });
  }
  const flags = ['b', 'i', 'u'], list = [...own.values()];
  const every = f => list.every(o => o[f]), some = f => list.some(o => o[f]);
  // רק עיצוב שבחלק מהמילים מסומן בטקסט. עיצוב שבכל המילים הוא של האזור כולו (כפתורי "עיצוב הטקסט"),
  // כדי שגם טקסט שנוסף לאזור ייכתב כמו שאר הטקסט בו
  const tagged = f => some(f) && !every(f);
  // עברית: בכל שורה מימין לשמאל; סימן פיסוק נצמד למילה שלפניו
  const lines = rows.map(r => {
    const ps = r.parts.slice().sort((a, b) => b.box.x - a.box.x);
    const on = (k, f) => !!(ps[k] && own.has(ps[k]) && tagged(f) && own.get(ps[k])[f]);
    return ps.map((c, k) => flags.map(f => on(k, f) && !on(k - 1, f) ? '[' + f + ']' : '').join('') + c.old +
      flags.map(f => on(k, f) && !on(k + 1, f) ? '[/' + f + ']' : '').join('')).join(' ').replace(/\s+([!?.,:;…])/g, '$1');
  });
  s.old = lines.join(' ').replace(/\[\/?[biu]\]/g, '');
  s.box = { ...s.box, x: u.x, w: u.w, ...(plain.box.font ? { font: plain.box.font } : {}) };
  delete s.box.italic;
  s.style = style;
  // מודגש בכל המילים: גם כשהגופן עצמו רגיל וההדגשה נראית רק בעובי הקו
  if (tagged('b')) s.bold = false; else if (every('b')) s.bold = true; else delete s.bold;
  if (tagged('i')) s.italic = false; else if (every('i')) s.italic = true; else delete s.italic;
  delete s.underline; delete s.ulDim;
  if (ulDims.length) { if (every('u')) s.underline = ulDims[0]; else s.ulDim = ulDims[0]; }
  return lines.join('\n');
}

/** קו תחתון מתחת לשורה האחרונה: שורת פיקסלים רחבה ודקה מתחת לקו הבסיס. { off, th } ביחס לגודל הגופן */
function findUnderline(line, bg) {
  const size = line.size, base = line.baseline;
  const x0 = Math.max(0, Math.floor(line.x)), x1 = Math.min(st.W, Math.ceil(line.x + line.w));
  const y0 = Math.max(0, Math.floor(base + size * 0.03)), y1 = Math.min(st.H, Math.ceil(base + size * 0.6));
  if (x1 - x0 < 4 || y1 - y0 < 1) return null;
  const W = x1 - x0, data = st.canvas.getContext('2d', { willReadFrequently: true }).getImageData(x0, y0, W, y1 - y0).data;
  const c = [1, 3, 5].map(i => parseInt(bg.slice(i, i + 2), 16));
  const inked = y => { let n = 0; for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; if (Math.abs(data[i] - c[0]) + Math.abs(data[i + 1] - c[1]) + Math.abs(data[i + 2] - c[2]) > 150) n++; } return n >= W * 0.6; };
  let top = -1, bottom = -1;
  for (let y = 0; y < y1 - y0; y++) {
    if (inked(y)) { if (top < 0) top = y; bottom = y; } else if (top >= 0) break;
  }
  return top < 0 ? null : { off: +((y0 + top - base) / size).toFixed(3), th: +(Math.max(1, bottom - top + 1) / size).toFixed(3) };
}

/** שתי תיבות טקסט של אותו קטע: באותה שורה זו ליד זו, או בשורות סמוכות זו מתחת לזו */
function sameBlock(a, b) {
  const size = Math.max(a.size || a.h * 0.72, b.size || b.h * 0.72);
  if (Math.abs((a.size || a.h) - (b.size || b.h)) > size * 0.2) return false;
  const dy = Math.abs(lineBase(a) - lineBase(b));
  const gap = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w);
  if (dy < size * 0.45) return gap < size * 1.5;
  const aligned = Math.abs(a.x + a.w / 2 - (b.x + b.w / 2)) < size * 1.5 || Math.abs(a.x + a.w - b.x - b.w) < size || Math.abs(a.x - b.x) < size;
  return dy < size * 1.8 && gap < 0 && aligned;
}
const lineBase = b => b.baseline ?? (b.y + b.h * 0.78);

/**
 * קידוש כמו בקובץ הישן: האזור מתרחב לשורות הסמוכות של אותו קטע (grow), מספר השורות, קו הבסיס
 * והריווח ביניהן נלקחים מהקובץ. כל הטקסט שבאזור מוחלף בהודעה בנוסח שהגבאי קבע בלוח הקידושים.
 * במסמך סרוק השורות נספרות לפי הפיקסלים שבאזור
 */
export function fitKiddush(s, grow) {
  // האזור מותאם מחדש לטקסט שבקובץ – גם המראה נמדד מחדש
  delete s.style;
  const taken = c => st.slots.some(o => (o !== s && covers(o.box, c.box)) || (o.labelBox && covers(o.labelBox, c.box)));
  const parts = st.candidates.filter(c => covers(s.box, c.box) && !taken(c));
  for (let added = grow && parts.length > 0; added;) {
    added = false;
    for (const c of st.candidates) {
      // קישוט ("‹‹‹", "***") שליד הרשימה אינו חלק ממנה
      if (parts.includes(c) || taken(c) || !/[\p{L}\p{N}]/u.test(c.old) || !parts.some(p => sameBlock(p.box, c.box))) continue;
      parts.push(c); added = true;
    }
  }
  let lines;
  if (parts.length) {
    lines = [];
    for (const c of parts.sort((a, b) => lineBase(a.box) - lineBase(b.box))) {
      const size = c.box.size || c.box.h * 0.72;
      const ln = lines.find(l => Math.abs(l.baseline - lineBase(c.box)) < Math.max(l.size, size) * 0.45);
      if (ln) ln.parts.push(c); else lines.push({ baseline: lineBase(c.box), size, parts: [c] });
    }
    const box = parts.reduce((b, c) => unionBox(b, c.box), parts[0].box);
    s.box = { ...s.box, ...box };
    // עברית: בכל שורה מימין לשמאל
    const text = lines.map(l => l.parts.sort((a, b) => b.box.x - a.box.x).map(c => c.old).join(' ')).join(' ');
    s.old = text;
  } else {
    lines = inkLines(st.canvas, s.box).map(b => ({ size: (b.bottom - b.top + 1) * 0.95, baseline: b.top + (b.bottom - b.top + 1) * 0.8 }));
    if (!lines.length) return;
  }
  const n = lines.length, was = s.srcLines;
  s.srcLines = n;
  // השורות נכתבות סביב קו הבסיס האמצעי
  const size = lines.reduce((t, l) => t + l.size, 0) / n;
  s.box = { ...s.box, size, baseline: lines.reduce((t, l) => t + l.baseline, 0) / n };
  if (n < 2) { if (was > 1) s.wrap = false; return; }
  const gap = (lines[n - 1].baseline - lines[0].baseline) / (n - 1);
  const pct = gap / (size * 1.15) * 100;
  Object.assign(s, { wrap: true, lineCount: n, lineHeightPct: SIZES.reduce((a, b) => Math.abs(b - pct) < Math.abs(a - pct) ? b : a) });
  delete s.lines;
}

$('tplBoxes').addEventListener('click', e => {
  if (!st || st.drawing) return;
  const b = e.target.closest('.tb');
  if (!b) return;
  // סוף גרירה של אזור אינו לחיצה עליו
  if (Date.now() - (st.movedAt || 0) < 400) return;
  if (st.textEditing) {
    if (b.dataset.s != null) {
      const s = st.slots[+b.dataset.s];
      if (s.kind === 'text') { editSlotText(s); return; }
    } else { editCandidateText(+b.dataset.c); return; }
  }
  if (b.dataset.s != null) { focusSlot(+b.dataset.s); return; }
  const c = st.candidates[+b.dataset.c];
  st.slots.push({ box: c.box, kind: 'text', text: c.old, old: c.old });
  renderBoxes(); focusSlot(st.slots.length - 1);
});

/** יצירת אזור טקסט קבוע, בלחיצה על טקסט אפור שזוהה במצב "עריכת טקסט", או מחיקה שלו מהלוח */
function editCandidateText(i) {
  const c = st.candidates[i];
  openTextEdit({
    format: true,
    text: c.old,
    onSave: text => {
      if (!text) return;
      st.slots.push({ box: c.box, kind: 'text', text, old: c.old });
      renderBoxes(); renderSlots(); schedulePreviewRefresh();
    },
    onErase: () => {
      st.slots.push({ box: c.box, kind: 'erase', old: c.old });
      renderBoxes(); renderSlots(); schedulePreviewRefresh();
    }
  });
}

/**
 * אזור שהופך ל"מחיקה": המסגרת מצטמצמת לטקסט שזוהה בתוכה (עם הפיסוק), כדי שהמחיקה לא תגיע לשורות השכנות.
 * בלי טקסט שזוהה (מסמך סרוק) – נמחק כל מה שבמסגרת
 */
export function fitErase(s) {
  const taken = c => st.slots.some(o => o !== s && (covers(o.box, c.box) || (o.labelBox && covers(o.labelBox, c.box))));
  const words = st.candidates.filter(c => covers(s.box, c.box) && !taken(c));
  if (!words.length) return;
  const parts = [...words, ...(st.marks || []).filter(c => covers(s.box, c.box) && !taken(c))];
  const size = Math.max(...words.map(c => c.box.size || c.box.h * 0.72));
  s.box = { ...parts.reduce((b, c) => unionBox(b, c.box), parts[0].box), size };
  s.old = words.sort((a, b) => lineBase(a.box) - lineBase(b.box) || b.box.x - a.box.x).map(c => c.old).join(' ');
  delete s.style;
}

/** עריכת אזור טקסט קיים במצב "עריכת טקסט": לתמיד (בתבנית עצמה), או רק לשבוע שבתצוגה המקדימה */
function editSlotText(s) {
  const idx = st.slots.indexOf(s), built = builtSlots(), b = built[idx], k = slotKey(b), host = specialHost(built);
  const canWeek = !!st.previewData;
  let weekOverridden = false;
  if (canWeek) {
    const edits = weekEditsFor(weekKey());
    weekOverridden = Object.keys(edits).some(key => key.replace(/^p\d+\|/, '') === k);
  }
  openTextEdit({
    multiline: true, format: true,
    text: s.text || '',
    weekLabel: canWeek && st.weekShown ? weekLabel(st.weekShown) : null,
    hasOverride: !!s.text || weekOverridden,
    onSave: (text, scope) => {
      if (scope === 'week' && canWeek) saveWeekText(b, k, host, text);
      else {
        s.text = text;
        if (!s.text) { st.slots.splice(idx, 1); st.sel = null; }
      }
      renderSlots(); renderBoxes(); schedulePreviewRefresh();
    },
    onDelete: () => {
      if (weekOverridden) resetWeek(s);
      else { st.slots.splice(idx, 1); st.sel = null; }
      renderSlots(); renderBoxes(); schedulePreviewRefresh();
    },
    // אזור על טקסט מהקובץ: אפשר למחוק את הטקסט מהלוח
    onErase: s.old ? () => {
      if (weekOverridden) resetWeek(s);
      s.kind = 'erase';
      renderSlots(); renderBoxes(); schedulePreviewRefresh();
    } : null
  });
}

/** שמירת טקסט לשבוע שבתצוגה המקדימה בלבד, כמו saveWeekLine אבל בלי פיצול לשורות */
function saveWeekText(b, k, host, text) {
  const { values, pages } = st.previewData;
  const plain = slotText(b, { ...values, edits: null }, host);
  const edits = weekEditsFor(weekKey());
  const hit = pages.map((v, i) => i).filter(i => { const t = slotText(b, { ...pages[i], edits: null }, host); return t != null && t === plain; });
  for (const i of hit.length ? hit : [0]) {
    if (text === plain || !text) delete edits['p' + i + '|' + k];
    else edits['p' + i + '|' + k] = text;
  }
}

export function focusSlot(i) {
  const s = st.slots[i];
  if (!s) return;
  openSlots.add(s);
  st.sel = i;
  renderBoxes(); renderSlots();
  const ed = document.querySelector('.slot-ed[data-i="' + i + '"]');
  if (!ed) return;
  document.querySelectorAll('.slot-ed.sel').forEach(x => x.classList.remove('sel'));
  ed.classList.add('sel');
  ed.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  (ed.querySelector('[data-k="text"]') || ed.querySelector('select')).focus({ preventScroll: true });
}

/* סימון אזור חדש בגרירה (למסמך סרוק, או לטקסט שלא זוהה) */
$('tplDraw').onclick = () => {
  st.drawing = !st.drawing;
  $('tplDraw').setAttribute('aria-pressed', String(st.drawing));
  $('tplPage').classList.toggle('drawing', st.drawing);
  if (st.drawing) setMoving(false);
};

