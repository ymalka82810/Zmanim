/** תאריך התצוגה והסקת כללי תפילה בעורך התבנית (חלק מ-js/template-ui.js שפוצל) */

import { ruleOptions, agreeRules, printedTimes } from './template-read.js';
import { findOccasion, timesFor } from './luach.js';
import { toDayNum, dow } from './dates.js';
import { $, oldMinutes, isDays, st, colOf, setDay } from './template-state.js';
import { renderSlots } from './template-slots.js';

export function renderOcc() {
  const o = st.period || (st.day != null ? findOccasion(st.day, st.cfg.il) : null);
  const byPrinted = st.slots && st.slots.some(s => s.options && s.options.some(x => x.printed || x.approx));
  $('tplOcc').textContent = !o ? (byPrinted
    ? 'הכללים זוהו לפי זמני היום שמודפסים בלוח (כלל שמסומן "משוער" – לפי זמנים קרובים לאלה שבלוח). ' +
      'בחירת התאריך של הלוח הישן תאפשר לזהות את הכללים בדיוק.'
    : 'בחרו את התאריך של הלוח הישן כדי שהאתר יזהה את הכללים.')
    : 'הלוח הישן: ' + o.title + (st.autoGuessed ? ' (זוהה אוטומטית לפי הפרשה והזמנים – אפשר לתקן)' : '');
}

$('tplDate').addEventListener('change', () => {
  if (!st) return;
  const v = $('tplDate').value;
  if (!v) return;
  let d = toDayNum(v);
  if (dow(d) === 5 && !isDays()) d++;          // יום שישי ← השבת שאחריו
  st.autoGuessed = false;
  setDay(d);
  reinferAll();
  renderOcc(); renderSlots();
});

/**
 * היום של אזור תפילה להסקת הכלל: הזמנים המחושבים (כשתאריך הלוח ידוע, ואם לא – משוערים לפי st.approx)
 * והזמנים שמודפסים בלוח לאותו יום
 */
function ruleCtx(s) {
  const printed = printedTimes(st.slots)[s.when];
  if (isDays()) {
    const c = colOf(s.when);
    const d = c.day != null ? c.day : st.approx != null ? st.approx + c.dow : null;
    return { when: 'כל יום', times: d != null ? timesFor(st.cfg, d) : null, printed, approx: c.day == null };
  }
  const at = st.day != null ? st.day : st.approx;
  return { when: s.when, times: at != null ? timesFor(st.cfg, s.when === 'כניסה' ? at - 1 : at) : null, printed, approx: st.day == null };
}

/** האפשרויות לכלל של האזור לפי השעה בקובץ, היום והמתי */
export function ruleOpts(s) {
  const m = oldMinutes(s);
  return s.kind === 'rule' && m != null ? ruleOptions(m, ruleCtx(s), st.cfg.tz, s.name) : null;
}

/** חישוב מחדש של הכלל לפי השעה בקובץ, היום והמתי */
export function reinfer(s) {
  const options = ruleOpts(s);
  if (!options) return;
  s.options = options;
  // בלי תאריך ובלי זמנים מודפסים יש רק "שעה קבועה" – לא דורסים כלל שהמשתמש הגדיר
  if (options.length > 1 || st.day != null) Object.assign(s, pickRule(options[0]));
}

/** כל האזורים מחדש, ובלוח ימי חול – כלל אחד לתפילה שמופיעה בכמה ימים */
function reinferAll() {
  st.slots.forEach(reinfer);
  if (!isDays()) return;
  // agreeRules בודק כל כלל מועמד מול כל אזור – היום של כל אזור מחושב פעם אחת
  const ctxs = new Map();
  agreeRules(st.slots, s => { if (!ctxs.has(s.when)) ctxs.set(s.when, ruleCtx(s)); return ctxs.get(s.when); }, st.cfg.tz);
}

export const pickRule = o => ({ base: o.base, offset: o.offset, round: o.round });
export const sameRule = (a, b) => a.base === b.base && String(a.offset) === String(b.offset) && a.round === b.round;

/** תיאור קצר של כלל: "15 דק׳ לפני שקיעה", "בשעה 08:00" */
export function ruleText(r) {
  if (r.base === 'שעה קבועה') return 'בשעה ' + (r.offset || '');
  const n = parseInt(r.offset, 10) || 0;
  return (n ? Math.abs(n) + ' דק׳ ' + (n < 0 ? 'לפני ' : 'אחרי ') : '') + r.base + (r.round && r.round !== 'ללא' ? ', עיגול ' + r.round : '');
}

/* ---------- האזורים על העמוד ---------- */

