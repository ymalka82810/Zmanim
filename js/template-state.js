/** מצב משותף ופונקציות עזר של עורך התבנית (חלק מ-js/template-ui.js שפוצל) */

import { BASES, TEXT_BASES, prayerBases } from './config.js';
import { findPeriod } from './luach.js';
import { dow } from './dates.js';
import { esc } from './render.js';

export const $ = id => document.getElementById(id);
export const KINDS = [['text', 'טקסט שכותבים כאן'], ['rule', 'תפילה או שיעור'], ['kiddush', 'קידוש (מלוח הקידושים)'], ['zman', 'זמן היום'], ['title', 'כותרת (שבת פרשת…)'], ['parasha', 'פרשת…'],
  ['parashaName', 'שם הפרשה בלבד'], ['special', 'שבת מיוחדת (נחמו, זכור…) – רק כשיש'], ['hebDate', 'תאריך עברי'], ['gregDate', 'תאריך לועזי'], ['address', 'כתובת בית הכנסת'],
  ['erase', 'מחיקת הטקסט מהלוח']];
export const KIND_LABEL = Object.fromEntries(KINDS);
const BASE_LABELS = Object.keys(BASES);
export const ZMANIM = BASE_LABELS.filter(l => BASES[l] !== 'fixed' && !TEXT_BASES.includes(BASES[l]));
const RULE_BASE_LABELS = BASE_LABELS.filter(l => BASES[l] !== 'kiddush');   // אירועים נשארים: שורת אירועים מהלוח יכולה להיות אזור בקובץ
export const KIDDUSH_LABEL = BASE_LABELS.find(l => BASES[l] === 'kiddush');
export const zmanKey = label => BASES[label];
export const zmanLabel = key => ZMANIM.find(l => BASES[l] === key) || ZMANIM[0];
export const opts = (list, v) => list.map(x => Array.isArray(x)
  ? '<option value="' + x[0] + '"' + (x[0] === v ? ' selected' : '') + '>' + esc(x[1]) + '</option>'
  : '<option' + (x === v ? ' selected' : '') + '>' + esc(x) + '</option>').join('');
/** אפשרויות "לפי": זמני היום, ואחריהם התפילות מהאזורים ומההגדרות */
export const baseOpts = s => {
  const names = prayerBases(st.slots.filter(x => x.kind === 'rule').concat(st.cfg.rules || []), s);
  if (s.base && !(s.base in BASES) && names.indexOf(s.base) < 0) names.push(s.base);
  return opts(RULE_BASE_LABELS, s.base) + (names.length ? '<optgroup label="לפי תפילה">' + opts(names, s.base) + '</optgroup>' : '');
};
export let kiddush = null;   // dateKey ← קידוש מאושר, לתצוגה המקדימה (מ-app.js)
export function setKiddush(map) { kiddush = map; }
const SAMPLE_KIDDUSH = { sponsorName: 'משפחת ישראלי שיחיו', occasion: 'לרגל בר המצווה של בנם', heading: 'קידוש לאחר התפילה', by: 'ע״י' };
export const oldMinutes = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(s.old || ''); return m ? +m[1] * 60 + +m[2] : null; };
/** ערך מוחלט (בדקות) של הפרש האזור, להצגה בשדה המספר */
export const offsetAbs = s => { const n = parseInt(s.offset, 10); return isNaN(n) ? '' : String(Math.abs(n)); };
/** כיוון הפרש האזור – "לפני" או "אחרי", להצגה בתיבת הבחירה */
export const offsetDir = s => (parseInt(s.offset, 10) < 0 ? 'לפני' : 'אחרי');

export const DOW_LABELS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'];
export const isDays = () => st.tpl.kind === 'days';
export const isChol = () => st.period ? st.period.kind === 'chol' : st.tpl.id === 'chol';
/** אפשרויות "יום" בלוח של ימי חול: לפי היום בשבוע, ובחול המועד לפי המקום בלוח */
export const dayOpts = () => DOW_LABELS.map((n, i) => ['d' + i, isChol() ? 'יום ' + (i + 1) + ' בלוח' : n]);

/*
 * st: { canvas, W, H, slots, candidates, fonts, day, cfg, name, onDone, drawing,
 *       tpl – התבנית שעורכים, cfgAll – כל ההגדרות, period – בלוח ימי חול: הלוח הישן }
 * st.cfg הוא ההגדרות עם זמני התפילות של התבנית.
 */
export let st = null;
export function setSt(v) { st = v; }
export const openSlots = new WeakSet();   // אזורים שהשורה שלהם פתוחה לעריכה
export let slotTexts = new WeakMap();     // הטקסט שנכתב בכל אזור בתצוגה האחרונה – למילים שבתיבות השורות
export let slotEdited = new WeakSet();    // אזורים שהנוסח שלהם נערך לשבוע שבתצוגה האחרונה
export function setSlotTexts(v) { slotTexts = v; }
export function setSlotEdited(v) { slotEdited = v; }

/** העמודה (יום) של מפתח d0…d5 בלוח הישן. בלי תאריך: יום בשבוע לפי המפתח */
export function colOf(key) {
  const hit = st.period && st.period.days.find(x => x.key === key);
  if (hit) return hit;
  const i = +String(key).slice(1) || 0;
  return { key, dow: i, erev: i === 5, day: st.day != null ? st.day + i : null };
}

/** הלוח הישן לפי יום: שבת/חג, או לוח ימי חול */
export function setDay(d) {
  if (d == null) { st.day = null; st.period = null; return; }
  const o = findPeriod(st.tpl.kind, d, st.cfg.il);
  st.period = o && o.mode === 'days' ? o : null;
  st.day = o ? o.first : d;
}

/* ---------- פתיחה ---------- */

