/**
 * בניית לוח לשבת/חג: מציאת האירוע, חישוב הכללים, ומבנה נתונים לתצוגה.
 */

import { dow, hm, gDate } from './dates.js';
import { yomTov, cholHamoed, parasha, hebDateString } from './hebrew.js';
import { zmanim, roundZman } from './zmanim.js';
import { BASES } from './config.js';

const MIN = 60000;

const isHoly = (d, il) => dow(d) === 6 || !!yomTov(d, il);

/**
 * השבת/החג הקרוב מהיום from והלאה (dir=1), או הקודם לפניו (dir=-1).
 * אם from נופל בתוך שבת/חג, מוחזר האירוע כולו מהיום הראשון שלו.
 */
export function findOccasion(from, il, dir = 1) {
  let d = from;
  for (let n = 0; n < 400 && !isHoly(d, il); n++) d += dir;
  if (!isHoly(d, il)) return null;
  let first = d, last = d;
  while (isHoly(first - 1, il)) first--;
  while (isHoly(last + 1, il)) last++;

  const days = [];
  for (let x = first; x <= last; x++) {
    const shabbat = dow(x) === 6;
    days.push({ day: x, shabbat, chag: yomTov(x, il), chol: shabbat ? cholHamoed(x, il) : null, parasha: shabbat ? parasha(x, il) : null });
  }

  const names = [];
  days.forEach(x => { if (x.chag && names.indexOf(x.chag) < 0) names.push(x.chag); });
  let title;
  if (names.length) title = names.join(' ו') + (days.some(x => x.shabbat) ? ' ושבת' : '');
  else if (days[0].chol) title = 'שבת חול המועד ' + days[0].chol;
  else title = days[0].parasha ? 'שבת פרשת ' + days[0].parasha : 'שבת';

  return { id: first, erev: first - 1, first, last, days, title };
}

/* ---------- זמנים ---------- */

function dayTimes(cfg, d) {
  const z = zmanim(d, cfg.lat, cfg.lng);
  const out = {};
  for (const k in z) out[k] = roundZman(k, z[k]);
  const hav = String(cfg.havdalah) === '8.5' ? z.tzeit
    : (z.sunset == null ? null : z.sunset + Number(cfg.havdalah) * MIN);
  out.havdalah = roundZman('havdalah', hav);
  return out;
}

/** הדלקת נרות ביום d לקראת היום הבא: לפני השקיעה, או ביציאת יום קדוש לחג שאחריו */
function candlesOn(cfg, d, t, il) {
  if (!isHoly(d + 1, il)) return null;
  if (isHoly(d, il) && dow(d + 1) !== 6) return t.havdalah;
  return t.sunset == null ? null : t.sunset - cfg.candle * MIN;
}

/**
 * שעת כלל. הבסיס הוא זמן היום, שעה קבועה, או שם של תפילה אחרת (ואז השעה נגזרת ממנה).
 * ctx: { cfg, when, day, t }. seen – הגנה מפני תלות מעגלית.
 */
function ruleTime(rule, ctx, seen = new Set()) {
  const { cfg, t } = ctx;
  const offset = String(rule.offset || '').trim();
  const base = BASES[rule.base];
  if (base === 'fixed') {
    const m = /^(\d{1,2}):(\d{2})$/.exec(offset);
    if (!m) return null;
    return { text: ('0' + m[1]).slice(-2) + ':' + m[2], key: +m[1] * 60 + +m[2] };
  }
  if (!base && String(rule.base || '').trim()) {
    const p = parentTime(rule, ctx, seen);
    if (!p) return null;
    if (p.ms != null) return fromMs(applyOffset(p.ms, offset, rule.round), cfg.tz);
    // תפילה בשעה קבועה: חישוב בדקות מתחילת היום
    const x = Math.round(applyOffset(p.key * MIN, offset, rule.round) / MIN), key = (x % 1440 + 1440) % 1440;
    return { text: ('0' + Math.floor(key / 60)).slice(-2) + ':' + ('0' + key % 60).slice(-2), key };
  }
  const k = base || 'sunset';
  const b = k === 'candles' ? (t.candles ?? (t.sunset == null ? null : t.sunset - cfg.candle * MIN)) : t[k];
  if (b == null) return null;
  return fromMs(applyOffset(b, offset, rule.round), cfg.tz);
}

function fromMs(ms, tz) {
  const text = hm(ms, tz), p = text.split(':');
  return { text, key: +p[0] * 60 + +p[1], ms };
}

/** שעת התפילה שהכלל תלוי בה: עדיפות לתפילה באותו קטע (מתי) שחלה באותו יום */
function parentTime(rule, ctx, seen) {
  if (seen.has(rule)) return null;
  seen.add(rule);
  const name = String(rule.base).trim();
  const list = (ctx.cfg.rules || []).filter(r => r && r !== rule && String(r.name || '').trim() === name);
  const parent = list.find(r => r.when === ctx.when && applies(r, ctx.day)) || list.find(r => r.when === ctx.when) || list[0];
  return parent ? ruleTime(parent, ctx, seen) : null;
}

function applies(rule, day) {
  return !rule.applies || rule.applies === 'שבת וחג' ||
    (rule.applies === 'שבת בלבד' && day.shabbat) || (rule.applies === 'חג בלבד' && !!day.chag);
}

function rowsFor(cfg, when, day, t) {
  return (cfg.rules || [])
    .filter(r => r && String(r.name || '').trim() && r.when === when && applies(r, day))
    .map(r => Object.assign({ name: String(r.name).trim() }, ruleTime(r, { cfg, when, day, t }) || { text: '—', key: 9999 }))
    .map(({ ms, ...r }) => r)
    .sort((a, b) => a.key - b.key);
}

/**
 * הלוח המלא לאירוע: כותרת ורשימת קטעים (ערב, כל יום, מוצאי).
 * כל קטע: { title, date, rows:[{name,text}], zmanim:[[תווית, 'HH:MM']] }
 */
export function buildLuach(cfg, occ) {
  const il = cfg.il, tz = cfg.tz;
  const kind = d => d.chag ? 'חג' : 'שבת';
  const first = occ.days[0], last = occ.days[occ.days.length - 1];
  const times = d => { const t = dayTimes(cfg, d); t.candles = candlesOn(cfg, d, t, il); return t; };
  const zlist = list => list.filter(x => x[1] != null).map(x => [x[0], hm(x[1], tz)]);
  const sections = [];

  const te = times(occ.erev);
  sections.push({
    title: 'ערב ' + kind(first), date: gDate(occ.erev),
    rows: rowsFor(cfg, 'כניסה', first, te),
    zmanim: zlist([['הדלקת נרות', te.candles], ['שקיעה', te.sunset]])
  });

  occ.days.forEach((d, i) => {
    const t = times(d.day);
    const label = d.chag || (d.chol ? 'שבת חול המועד' : occ.days.length > 1 ? 'שבת' : 'יום השבת');
    const z = [['סו"ז ק"ש מג"א', t.sofZmanShmaMGA], ['סו"ז ק"ש גר"א', t.sofZmanShma], ['שקיעה', t.sunset]];
    if (i < occ.days.length - 1) z.push(['הדלקת נרות', t.candles]);
    sections.push({ title: label, date: gDate(d.day), rows: rowsFor(cfg, 'כל יום', d, t), zmanim: zlist(z) });
  });

  const tl = times(last.day);
  sections.push({
    title: 'מוצאי ' + kind(last), date: gDate(last.day),
    rows: rowsFor(cfg, 'יציאה', last, tl),
    zmanim: zlist([['צאת ה' + kind(last), tl.havdalah]])
  });

  // ערכים לתבנית מקובץ: זמני היום וזמני התפילות לפי "מתי", והטקסטים של הכותרת
  const t1 = times(first.day);
  const texts = t => { const o = {}; for (const k in t) if (t[k] != null) o[k] = hm(t[k], tz); return o; };
  const rules = {};
  const addRows = (when, rows) => rows.forEach(r => { rules[when + '|' + r.name] = r.text; });
  addRows('כניסה', sections[0].rows);
  addRows('כל יום', sections[1].rows);
  addRows('יציאה', sections[sections.length - 1].rows);

  return {
    shul: String(cfg.shul || '').trim(),
    title: occ.title,
    dates: hebDateString(first.day) + ', ' + gDate(first.day, true),
    sections,
    notes: String(cfg.notes || '').trim(),
    values: {
      zmanim: { 'כניסה': texts(te), 'כל יום': texts(t1), 'יציאה': texts(tl) },
      rules,
      title: occ.title,
      parasha: first.parasha ? 'פרשת ' + first.parasha : (first.chag || occ.title),
      parashaName: first.parasha || first.chag || occ.title,
      hebDay: first.day,
      firstDay: first.day,
      multiDay: occ.days.length > 1
    }
  };
}

/** זמני היום (במילישניות) ליום נתון, כולל הדלקת נרות – לזיהוי כללים מלוח ישן */
export function timesFor(cfg, d) {
  const t = dayTimes(cfg, d);
  t.candles = candlesOn(cfg, d, t, cfg.il);
  return t;
}

/** הוספת הפרש בדקות ועיגול ל-5 לפי כלל */
export function applyOffset(ms, offset, round) {
  let x = ms + (Number(offset) || 0) * MIN;
  const r = 5 * MIN;
  if (round === 'למטה ל-5') x = Math.floor(x / r) * r;
  if (round === 'למעלה ל-5') x = Math.ceil(x / r) * r;
  if (round === 'לקרוב ל-5') x = Math.round(x / r) * r;
  return x;
}
