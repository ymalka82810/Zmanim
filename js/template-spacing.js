/**
 * רווח שהגבאי קבע (רווח לפני/אחרי פסקה) שצמוד לשורה שנמחקה מהלוח: בציור הרווח הקבוע נמדד מהשורה הבאה שנשארה,
 * ולכן הוא פותח מחדש את המקום שהמחיקה סגרה. כאן מזהים מקרים כאלה, כדי להציע להחזיר את הרווח לאוטומטי.
 */

import { slotRanks } from './template-render.js';

const overlapX = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0;
const inside = (a, b) => { const cx = b.x + b.w / 2, cy = b.y + b.h / 2; return cx > a.x && cx < a.x + a.w && cy > a.y && cy < a.y + a.h; };

/**
 * slots – האזורים בתבנית, candidates – הטקסט שזוהה בקובץ ({ box }).
 * מחזיר [{ slot, key: 'spaceAfter' | 'spaceBefore' }] – רווח קבוע שבינו לבין השורה הסמוכה יש רק טקסט שנמחק
 */
export function spacingConflicts(slots, candidates = []) {
  const erases = slots.filter(s => s.kind === 'erase' && s.box);
  if (!erases.length) return [];
  const live = slots.filter(s => s.kind !== 'erase' && s.box);
  // הפסקאות, כמו בציור (paraEdges): אזור שסומן joinPrev מצטרף לפסקה של האזור שלפניו בעמוד
  const ranks = slotRanks(live), groups = [];
  for (const i of live.map((s, i) => i).sort((a, b) => ranks[a] - ranks[b])) {
    if (live[i].joinPrev && groups.length) groups[groups.length - 1].push(live[i]);
    else groups.push([live[i]]);
  }
  // מה שנשאר בדף: טקסט מהקובץ שלא נמחק, והאזורים עצמם
  const rest = [...candidates.map(c => c && c.box).filter(b => b && !erases.some(e => inside(e.box, b))), ...live.map(s => s.box)];
  // המחיקה הקרובה ביותר מתחת (dir 1) או מעל (dir -1) לאזור ref, כשאין ביניהם שום טקסט שנשאר
  const erasedNext = (ref, dir, group) => {
    const from = dir > 0 ? ref.y + ref.h : ref.y;
    let best = null;
    for (const e of erases) {
      const b = e.box;
      if (!overlapX(b, ref)) continue;
      const d = dir > 0 ? b.y - from : from - (b.y + b.h);
      if (d < -ref.h * 0.3) continue;
      if (!best || d < best.d) best = { b, d };
    }
    if (!best) return false;
    const b = best.b, lo = dir > 0 ? from : b.y + b.h, hi = dir > 0 ? b.y : from;
    const span = { x: Math.min(b.x, ref.x), w: Math.max(b.x + b.w, ref.x + ref.w) - Math.min(b.x, ref.x) };
    const mine = r => group.some(s => s.box === r || inside(s.box, r));
    return !rest.some(r => !mine(r) && overlapX(r, span) && r.y + r.h / 2 > lo && r.y + r.h / 2 < hi);
  };
  const out = [];
  for (const g of groups) {
    const head = g[0], tail = g[g.length - 1];
    if (tail.spaceAfter != null && erasedNext(tail.box, 1, g)) out.push({ slot: tail, key: 'spaceAfter' });
    if (head.spaceBefore != null && erasedNext(head.box, -1, g)) out.push({ slot: head, key: 'spaceBefore' });
  }
  return out;
}
