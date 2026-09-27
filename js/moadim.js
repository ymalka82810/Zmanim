/**
 * מועדים שאפשר לקשר אליהם תבנית: חגים, שבתות מיוחדות, חול המועד וימי חול מיוחדים.
 * סוג "holy" חל על לוח שבת/חג, וסוג "days" על לוח ימות השבוע או חול המועד.
 */

import { toHebrew, fromHebrew, isLeap, yomTov, cholHamoed, TISHREI, KISLEV, TEVET, ADAR, ADAR2, NISAN, TAMUZ, AV } from './hebrew.js';
import { dow } from './dates.js';

/** [מזהה, שם, סוג, קבוצה] */
export const MOADIM = [
  ['rh', 'ראש השנה', 'holy', 'חגים'], ['yk', 'יום כיפור', 'holy', 'חגים'], ['sukkot', 'סוכות', 'holy', 'חגים'],
  ['shmini', 'שמיני עצרת ושמחת תורה', 'holy', 'חגים'], ['pesach', 'פסח', 'holy', 'חגים'],
  ['pesach7', 'שביעי של פסח', 'holy', 'חגים'], ['shavuot', 'שבועות', 'holy', 'חגים'],
  ['shuva', 'שבת שובה', 'holy', 'שבתות מיוחדות'], ['shabbatChol', 'שבת חול המועד', 'holy', 'שבתות מיוחדות'],
  ['shabbatChanukah', 'שבת חנוכה', 'holy', 'שבתות מיוחדות'], ['shabbatRch', 'שבת ראש חודש', 'holy', 'שבתות מיוחדות'],
  ['zachor', 'שבת זכור', 'holy', 'שבתות מיוחדות'], ['hagadol', 'שבת הגדול', 'holy', 'שבתות מיוחדות'],
  ['chazon', 'שבת חזון', 'holy', 'שבתות מיוחדות'], ['nachamu', 'שבת נחמו', 'holy', 'שבתות מיוחדות'],
  ['cholSukkot', 'חול המועד סוכות', 'days', 'חול המועד'], ['cholPesach', 'חול המועד פסח', 'days', 'חול המועד'],
  ['chanukah', 'חנוכה', 'days', 'ימי חול מיוחדים'], ['purim', 'פורים ושושן פורים', 'days', 'ימי חול מיוחדים'],
  ['tishaBav', 'תשעה באב', 'days', 'ימי חול מיוחדים'],
  ['fast', 'צומות (גדליה, עשרה בטבת, אסתר, י״ז בתמוז)', 'days', 'ימי חול מיוחדים'],
  ['rch', 'ראש חודש', 'days', 'ימי חול מיוחדים']
];

const adar = y => isLeap(y) ? ADAR2 : ADAR;
/** צום שחל בשבת נדחה ליום ראשון */
const postpone = d => dow(d) === 6 ? d + 1 : d;
const isRoshChodesh = h => h.d === 30 || (h.d === 1 && h.m !== TISHREI);
const chanukahStart = y => fromHebrew(y, KISLEV, 25);

/** הצומות של שנה y (בלי יום כיפור ותשעה באב): [יום, שם] */
function fasts(y) {
  const esther = fromHebrew(y, adar(y), 13);
  return [
    [postpone(fromHebrew(y, TISHREI, 3)), 'צום גדליה'],
    [fromHebrew(y, TEVET, 10), 'עשרה בטבת'],
    [dow(esther) === 6 ? esther - 2 : esther, 'תענית אסתר'],
    [postpone(fromHebrew(y, TAMUZ, 17)), 'צום י״ז בתמוז']
  ];
}

/** האם היום d שייך למועד id */
export function isMoed(id, d, il) {
  const h = toHebrew(d), yt = yomTov(d, il), sh = dow(d) === 6;
  const range = (from, to) => d >= from && d <= to;
  switch (id) {
    case 'rh': return yt === 'ראש השנה';
    case 'yk': return yt === 'יום כיפור';
    case 'sukkot': return yt === 'סוכות';
    case 'shmini': return /שמיני עצרת|שמחת תורה/.test(yt || '');
    case 'pesach': return yt === 'פסח';
    case 'pesach7': return yt === 'שביעי של פסח' || yt === 'אחרון של פסח';
    case 'shavuot': return yt === 'שבועות';
    case 'shuva': return sh && h.m === TISHREI && h.d >= 3 && h.d <= 9;
    case 'shabbatChol': return sh && !yt && !!cholHamoed(d, il);
    case 'shabbatChanukah': return sh && range(chanukahStart(h.y), chanukahStart(h.y) + 7);
    case 'shabbatRch': return sh && isRoshChodesh(h);
    case 'zachor': { const p = fromHebrew(h.y, adar(h.y), 14); return sh && range(p - 7, p - 1); }
    case 'hagadol': { const p = fromHebrew(h.y, NISAN, 15); return sh && range(p - 7, p - 1); }
    case 'chazon': { const a = fromHebrew(h.y, AV, 9); return sh && range(a - 6, a); }
    case 'nachamu': { const a = fromHebrew(h.y, AV, 9); return sh && range(a + 1, a + 7); }
    case 'cholSukkot': return !sh && !yt && cholHamoed(d, il) === 'סוכות';
    case 'cholPesach': return !sh && !yt && cholHamoed(d, il) === 'פסח';
    case 'chanukah': return range(chanukahStart(h.y), chanukahStart(h.y) + 7);
    case 'purim': return h.m === adar(h.y) && (h.d === 14 || h.d === 15);
    case 'tishaBav': return d === postpone(fromHebrew(h.y, AV, 9));
    case 'fast': return fasts(h.y).some(f => f[0] === d);
    case 'rch': return isRoshChodesh(h);
    default: return false;
  }
}

/** שם מיוחד ליום חול (לכותרת העמודה בלוח השבועי), או '' */
export function specialDay(d) {
  const h = toHebrew(d), out = [];
  if (isRoshChodesh(h)) out.push('ראש חודש');
  const c = chanukahStart(h.y);
  if (d >= c && d <= c + 7) out.push('חנוכה');
  if (h.m === adar(h.y) && h.d === 14) out.push('פורים');
  if (h.m === adar(h.y) && h.d === 15) out.push('שושן פורים');
  if (d === postpone(fromHebrew(h.y, AV, 9))) out.push('תשעה באב');
  const f = fasts(h.y).find(x => x[0] === d);
  if (f) out.push(f[1]);
  return out.join(' · ');
}
