/**
 * בניית לוח לשבת/חג: מציאת האירוע, חישוב הכללים, ומבנה נתונים לתצוגה.
 */

import { dow, hm, gDate, toYmd } from './dates.js';
import { yomTov, cholHamoed, parasha, hebDateString, toHebrew, fromHebrew, gematria, monthName, TISHREI } from './hebrew.js';
import { zmanim, roundZman } from './zmanim.js';
import { BASES, DAY_APPLIES, appliesOnDay, isBuiltin } from './config.js';
import { isMoed, specialDay } from './moadim.js';

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

  return { mode: 'holy', id: first, erev: first - 1, first, last, days, title };
}

/* ---------- ימות השבוע וחול המועד ---------- */

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'];
const dm = d => { const [, m, x] = toYmd(d).split('-'); return +x + '.' + +m; };

/** הלוח של ימי החול שהיום d (לא שבת ולא חג) שייך אליו: כל חול המועד, או ימי החול של אותו שבוע */
function daysPeriodAt(d, il) {
  let list, kind, title;
  const chol = cholHamoed(d, il);
  if (chol) {
    const { y, m } = toHebrew(d);
    const from = fromHebrew(y, m, il ? 16 : 17), to = fromHebrew(y, m, m === TISHREI ? 21 : 20);
    list = [];
    for (let x = from; x <= to; x++) if (!isHoly(x, il)) list.push(x);
    kind = 'chol'; title = 'חול המועד ' + chol;
  } else {
    const sun = d - dow(d);
    list = [];
    for (let x = sun; x <= sun + 5; x++) if (!isHoly(x, il) && !cholHamoed(x, il)) list.push(x);
    const p = parasha(sun + 6, il);
    kind = 'week'; title = p ? 'שבוע פרשת ' + p : 'ימות השבוע';
  }
  const days = list.map((x, i) => ({ day: x, dow: dow(x), erev: isHoly(x + 1, il), key: 'd' + (kind === 'week' ? dow(x) : i),
    name: DAY_NAMES[dow(x)], date: dm(x), special: specialDay(x) }));
  const first = list[0], last = list[list.length - 1];
  return { mode: 'days', kind, id: first, first, last, days, title };
}

/** לוח ימי החול שמכיל את from, או הקרוב אחריו (dir=1) או לפניו (dir=-1) */
function findDays(from, il, dir = 1) {
  let d = from;
  for (let n = 0; n < 30 && isHoly(d, il); n++) d += dir;
  return isHoly(d, il) ? null : daysPeriodAt(d, il);
}

/** הלוח שמכיל את היום from או הקרוב אליו. mode: holy – שבתות וחגים, days – ימות השבוע */
export function findPeriod(mode, from, il, dir = 1) {
  return mode === 'days' ? findDays(from, il, dir) : findOccasion(from, il, dir);
}

/** הלוח הבא (dir=1) או הקודם (dir=-1) מאותו סוג */
export function stepPeriod(p, il, dir) {
  if (p.mode !== 'days') return dir > 0 ? findOccasion(p.last + 1, il) : findOccasion(p.first - 1, il, -1);
  // ימי חול המועד לא תמיד רצופים (שבת באמצע), ולכן מחפשים לוח שמתחיל אחרי (או לפני) הלוח הנוכחי
  for (let d = p.first + dir, n = 0; n < 60; d += dir, n++) {
    if (isHoly(d, il)) continue;
    const q = daysPeriodAt(d, il);
    if (dir > 0 ? q.first > p.first : q.first < p.first) return q;
  }
  return null;
}

/* ---------- בחירת התבנית ---------- */

/**
 * התבנית של הלוח: תבנית של המשתמש שאחד המועדים שלה חל בלוח, ואם אין – התבנית הקבועה
 * (חגים / שבתות / חול המועד / ימות השבוע).
 */
export function templateFor(cfg, p) {
  const days = p.days.map(x => x.day);
  const own = cfg.templates.find(t => !isBuiltin(t) && t.kind === p.mode &&
    (t.moadim || []).some(id => days.some(d => isMoed(id, d, cfg.il))));
  if (own) return own;
  const id = p.mode === 'days' ? p.kind : p.days.some(x => x.chag) ? 'chag' : 'shabbat';
  return cfg.templates.find(t => t.id === id);
}

/** הלוח הקרוב (מהיום from והלאה) שמשתמש בתבנית t, או null אם אין בשנה הקרובה */
export function nextPeriodFor(cfg, t, from) {
  let p = findPeriod(t.kind, from, cfg.il);
  for (let n = 0; p && n < 200; n++) {
    if (templateFor(cfg, p) === t) return p;
    p = stepPeriod(p, cfg.il, 1);
  }
  return null;
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
  if (DAY_APPLIES.indexOf(rule.applies) >= 0) return day.dow != null && appliesOnDay(rule.applies, day);
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

/** "כ״ז תשרי – ב׳ חשון תשפ״ז · 18.10–23.10.2026" */
function rangeDates(first, last) {
  const a = toHebrew(first), b = toHebrew(last);
  const heb = first === last ? hebDateString(first)
    : gematria(a.d) + (a.m === b.m ? '' : ' ' + monthName(a.y, a.m)) + (a.y === b.y ? '' : ' ' + gematria(a.y)) + ' – ' + hebDateString(last);
  // LRI … PDI: הטווח הלועזי נשאר משמאל לימין בתוך טקסט עברי
  return heb + ' · ⁦' + (first === last ? '' : dm(first) + '–') + dm(last) + '.' + toYmd(last).slice(0, 4) + '⁩';
}

/**
 * לוח של ימי חול (שבועי או חול המועד): טבלה שבה כל עמודה היא יום.
 * { days, rows:[{name, cells}], zmanim:[{name, cells}] } – תא ריק (null) כשהתפילה לא חלה באותו יום.
 */
export function buildDaysLuach(cfg, p) {
  const tz = cfg.tz;
  const cols = p.days.map(x => ({ ...x, t: timesFor(cfg, x.day) }));
  const rules = (cfg.rules || []).filter(r => r && String(r.name || '').trim());
  const names = [...new Set(rules.map(r => String(r.name).trim()))];
  const rows = names.map(name => {
    let key = 9999;
    const cells = cols.map(c => {
      // כשכמה כללים של אותה תפילה חלים ביום, הספציפי גובר (למשל "ראשון" על "כל הימים")
      const r = rules.filter(x => String(x.name).trim() === name && applies(x, c))
        .sort((a, b) => DAY_APPLIES.indexOf(b.applies) - DAY_APPLIES.indexOf(a.applies))[0];
      if (!r) return null;
      const v = ruleTime(r, { cfg, when: 'כל יום', day: c, t: c.t });
      if (v) key = Math.min(key, v.key);
      return v ? v.text : '—';
    });
    return { name, cells, key };
  }).filter(r => r.cells.some(c => c != null)).sort((a, b) => a.key - b.key).map(({ key, ...r }) => r);
  const zmanim = [['הנץ', 'sunrise'], ['סו"ז ק"ש גר"א', 'sofZmanShma'], ['שקיעה', 'sunset']]
    .map(([name, k]) => ({ name, cells: cols.map(c => c.t[k] == null ? null : hm(c.t[k], tz)) }));

  // ערכים לתבנית מקובץ: לפי היום בלוח (d0…d5)
  const texts = t => { const o = {}; for (const k in t) if (t[k] != null) o[k] = hm(t[k], tz); return o; };
  const values = { zmanim: {}, rules: {} };
  cols.forEach((c, i) => {
    values.zmanim[c.key] = texts(c.t);
    rows.forEach(r => { if (r.cells[i] != null) values.rules[c.key + '|' + r.name] = r.cells[i]; });
  });
  const first = p.days[0], shabbat = p.kind === 'week' ? parasha(first.day - first.dow + 6, cfg.il) : null;
  Object.assign(values, {
    title: p.title, parasha: shabbat ? 'פרשת ' + shabbat : p.title, parashaName: shabbat || p.title,
    hebDay: first.day, firstDay: first.day, multiDay: false
  });

  return {
    type: 'days',
    shul: String(cfg.shul || '').trim(),
    title: p.title,
    dates: rangeDates(first.day, p.days[p.days.length - 1].day),
    days: p.days.map(({ name, date, special }) => ({ name, date, special })),
    rows, zmanim,
    notes: String(cfg.notes || '').trim(),
    values
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
