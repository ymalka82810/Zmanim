/** ציור, הזזה ושינוי גודל של אזורים בעורך התבנית (חלק מ-js/template-ui.js שפוצל) */

import { placer } from './template-place.js';
import { $, kiddush, isDays, st } from './template-state.js';
import { boxStyle, unionBox, renderBoxes, covers, movedFrom, stretchPrefix, fitKiddush, focusSlot } from './template-boxes.js';
import { renderSlots } from './template-slots.js';
import { slotStyle, schedulePreviewRefresh } from './template-build.js';

/* הזזת אזורים וטקסט אפור בגרירה: רק כשהכפתור לחוץ, כדי שאזורים לא יזוזו בטעות */
export function setMoving(on) {
  st.moving = on;
  $('tplMove').setAttribute('aria-pressed', String(on));
  $('tplPage').classList.toggle('moving', on);
}
$('tplMove').onclick = () => {
  setMoving(!st.moving);
  if (st.moving && st.drawing) $('tplDraw').click();
  renderBoxes();
};

/* עריכת טקסט בלחיצה: על טקסט שזוהה אוטומטית (יוצר אזור טקסט קבוע), או על אזור טקסט קיים */
$('tplEditText').onclick = () => {
  st.textEditing = !st.textEditing;
  $('tplEditText').setAttribute('aria-pressed', String(st.textEditing));
  $('tplPage').classList.toggle('text-editing', st.textEditing);
};
export let drag = null;
const toImg = (e) => {
  const r = $('tplPage').getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * st.W, y: (e.clientY - r.top) / r.height * st.H };
};
/** גובה בעמוד שבעורך ← הגובה המתאים בקובץ, לפני שהשורות זזו בכתיבה מחדש */
const toSrcY = y => st.view ? st.view.toSrc(y) : y;
export let resize = null;
$('tplPage').addEventListener('pointerdown', e => {
  const h = st && !st.drawing && e.target.closest('.rh');
  if (h) {
    e.preventDefault();
    $('tplPage').setPointerCapture(e.pointerId);
    const s = st.slots[st.sel];
    slotStyle(s);   // המראה נמדד לפני המתיחה, על הטקסט המקורי
    s.box = { ...s.box };   // אזור שנוצר מטקסט בדף חולק איתו את אותה תיבה
    if (!s.nameBox) { s.nameBox = { ...s.box }; s.autoPrefix = s.prefix || ''; }
    resize = { s, edge: h.dataset.edge };
    return;
  }
  const tb = st && st.moving && !st.drawing && e.button === 0 && e.target.closest('.tb.slot, .tb.cand');
  if (tb) { move = { i: tb.dataset.s != null ? +tb.dataset.s : null, c: tb.dataset.c, cx: e.clientX, cy: e.clientY, start: toImg(e) }; return; }
  if (!st || !st.drawing) return;
  e.preventDefault();
  $('tplPage').setPointerCapture(e.pointerId);
  drag = { start: toImg(e), el: document.createElement('div') };
  drag.el.className = 'tb slot drag';
  $('tplBoxes').appendChild(drag.el);
});
$('tplPage').addEventListener('pointermove', e => {
  if (resize) {
    const p = toImg(e), b = resize.s.box, MIN = 8;
    p.y = toSrcY(p.y);
    const r = b.x + b.w, bot = b.y + b.h;
    if (resize.edge === 'l') { b.x = Math.min(p.x, r - MIN); b.w = r - b.x; }
    if (resize.edge === 'r') b.w = Math.max(MIN, p.x - b.x);
    if (resize.edge === 't') { b.y = Math.min(p.y, bot - MIN); b.h = bot - b.y; }
    if (resize.edge === 'b') b.h = Math.max(MIN, p.y - b.y);
    renderBoxes();
    return;
  }
  if (move) {
    // תזוזה קטנה היא עדיין לחיצה על האזור
    if (!move.s && Math.hypot(e.clientX - move.cx, e.clientY - move.cy) < 6) return;
    e.preventDefault();
    if (!move.s) { $('tplPage').setPointerCapture(e.pointerId); startMove(); }
    move.p = toImg(e);
    if (!move.frame) move.frame = requestAnimationFrame(stepMove);
    return;
  }
  if (!drag) return;
  const p = toImg(e), s = drag.start;
  drag.box = { x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) };
  drag.el.setAttribute('style', boxStyle(drag.box));
});
$('tplPage').addEventListener('pointerup', () => {
  if (move) { endMove(); return; }
  if (resize) {
    const s = resize.s, b = s.box;
    resize = null;
    // קו הבסיס של הכתיבה נשאר, אלא אם האזור זז ממנו
    if (b.baseline != null && (b.baseline < b.y || b.baseline > b.y + b.h)) b.baseline = b.y + b.h * 0.78;
    if (s.kind === 'parasha' || s.kind === 'parashaName') stretchPrefix(s);
    if (s.kind === 'kiddush') fitKiddush(s, false);
    // עד שהעמוד יצויר מחדש, המסגרת נשארת כפי שנמתחה ולא חוזרת למקום הטקסט הקודם
    if (st.view) st.view.slots.delete(s);
    schedulePreviewRefresh();
    renderBoxes(); renderSlots();
    return;
  }
  if (!drag) return;
  let b = drag.box;
  drag.el.remove(); drag = null;
  if (!b || b.w < 8 || b.h < 8) return;
  // המסגרת סומנה על העמוד שבעורך – נשמרת במקום המתאים בקובץ
  const top = toSrcY(b.y);
  b = { ...b, y: top, h: Math.max(8, toSrcY(b.y + b.h) - top) };
  st.slots.push({ box: b, kind: 'rule', when: isDays() ? 'd0' : 'כל יום', name: '', base: 'שקיעה', offset: '0', round: 'ללא', old: '' });
  st.drawing = false;
  $('tplDraw').setAttribute('aria-pressed', 'false');
  $('tplPage').classList.remove('drawing');
  renderBoxes(); focusSlot(st.slots.length - 1);
});
// גלילה בטלפון שהתחילה על אזור: הגרירה מתבטלת והאזור חוזר למקומו
$('tplPage').addEventListener('pointercancel', () => {
  if (!move) return;
  const m = move;
  move = null;
  cancelAnimationFrame(m.frame);
  if (m.s) { m.s.box = m.base.box; m.s.labelBox = m.base.label; renderBoxes(); }
});

/*
 * גרירת אזור למקום אחר בעמוד. המסגרת המקווקוות עוקבת אחרי הסמן, והאזור עצמו מוצג במקום שבו יונח:
 * המקום הקרוב שבו הוא לא עולה על טקסט אחר, ועדיף מיושר לשורה או לעמודה של הטקסט שסביבו (template-place.js).
 * המקום המקורי בקובץ נשמר ב-s.origin, כדי שהטקסט הישן יימחק ממנו בציור
 */
export let move = null;   // { i, cx, cy, start, s, base, place, p, ghost, frame }
const shiftBox = (b, dx, dy) => b && { ...b, x: b.x + dx, y: b.y + dy, ...(b.baseline != null ? { baseline: b.baseline + dy } : {}) };
const toView = y => st.view ? st.view.toView(y) : y;

function startMove() {
  // טקסט מהקובץ שעוד אינו אזור: נגרר כאזור של טקסט קבוע
  if (move.i == null) {
    const c = st.candidates[+move.c];
    st.slots.push({ box: c.box, kind: 'text', text: c.old, old: c.old });
    move.i = st.slots.length - 1;
  }
  const s = move.s = st.slots[move.i];
  const bg = slotStyle(s).bg;   // המראה נמדד על הטקסט המקורי, לפני שהאזור זז ממנו
  move.base = { box: s.box, label: s.labelBox };
  const home = o => (o.origin && o.origin.box) || o.box;
  const others = st.slots.filter(o => o !== s);
  const taken = others.flatMap(o => [o.box, o.labelBox]).filter(Boolean);
  // טקסט מהקובץ שנשאר בעמוד כמו שהוא: לא מכוסה באזור, ולא במקום שממנו אזור הוזז
  const kept = st.candidates.map(c => c.box).filter(b => !st.slots.some(o => covers(o.box, b) || (o.labelBox && covers(o.labelBox, b)) || movedFrom(o, b)));
  move.place = placer(st.canvas, {
    bg,
    // הטקסט באזורים נכתב מחדש, והשם של האזור שנגרר עובר איתו – הדיו הישן שם לא תופס מקום
    erased: [...st.slots.map(home), (s.origin && s.origin.labelBox) || s.labelBox].filter(Boolean),
    taken,
    refs: [...taken, ...kept, home(s)]
  });
}

function stepMove() {
  move.frame = 0;
  const { s, base, start, p } = move;
  const g = base.label ? unionBox(base.box, base.label) : base.box;
  // הסמן זז על העמוד שבעורך; המקום בקובץ מחושב לפי השורות שנפתחו או נסגרו בו
  const vy = p.y - start.y, dx = p.x - start.x, dy = toSrcY(toView(base.box.y) + vy) - base.box.y;
  move.ghost = { ...g, x: g.x + dx, y: toView(g.y) + vy };
  const best = move.place(base.box, base.label, dx, dy);
  s.box = shiftBox(base.box, best.dx, best.dy);
  s.labelBox = shiftBox(base.label, best.dx, best.dy);
  renderBoxes();
}

function endMove() {
  const m = move;
  move = null;
  if (!m.s) return;
  cancelAnimationFrame(m.frame);
  if (m.p) { move = m; stepMove(); move = null; }
  const s = m.s, dx = s.box.x - m.base.box.x, dy = s.box.y - m.base.box.y;
  st.movedAt = Date.now();
  if (dx || dy) {
    if (!s.origin) s.origin = { box: m.base.box, ...(m.base.label ? { labelBox: m.base.label } : {}) };
    // הוחזר בדיוק למקום המקורי – אין מה למחוק
    else if (s.box.x === s.origin.box.x && s.box.y === s.origin.box.y) delete s.origin;
    if (s.nameBox) s.nameBox = shiftBox(s.nameBox, dx, dy);
    if (st.view) st.view.slots.delete(s);
    schedulePreviewRefresh();
  }
  st.sel = m.i;
  renderBoxes(); renderSlots();
}

/* ---------- רשימת האזורים ---------- */

