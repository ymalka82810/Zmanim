/**
 * בדיקת מנוע החישוב מול ספריית @hebcal/core (תלות פיתוח בלבד, לא נכללת באתר).
 * הרצה: npm test
 */

import { HDate, Sedra, Zmanim, GeoLocation, HebrewCalendar, flags } from '@hebcal/core';
import { toHebrew, yomTov, parashaIndices } from '../js/hebrew.js';
import { zmanim } from '../js/zmanim.js';
import { toDayNum, toYmd, dow } from '../js/dates.js';
import { isMoed } from '../js/moadim.js';

let failures = 0;
const fail = (msg) => { if (++failures <= 30) console.log('  ✗ ' + msg); };
const refDate = dn => { const [y, m, d] = toYmd(dn).split('-').map(Number); return new Date(y, m - 1, d); };

const FROM = toDayNum('1990-01-01'), TO = toDayNum('2090-12-31');

// 1. המרת תאריכים
console.log('המרת תאריכים 1990–2090');
for (let dn = FROM; dn <= TO; dn++) {
  const h = toHebrew(dn), r = new HDate(refDate(dn));
  // ב-hebcal: 1=ניסן ... 12=אדר/אדר א׳, 13=אדר ב׳ — כמו אצלנו
  if (h.y !== r.getFullYear() || h.m !== r.getMonth() || h.d !== r.getDate())
    fail(toYmd(dn) + ': ' + JSON.stringify(h) + ' ≠ ' + r.toString());
}

// 2. ימים טובים
for (const il of [true, false]) {
  console.log('ימים טובים, ' + (il ? 'ארץ ישראל' : 'חו"ל'));
  const ref = new Set(HebrewCalendar.calendar({ start: refDate(FROM), end: refDate(TO), il, noMinorFast: true, noModern: true, noRoshChodesh: true, noSpecialShabbat: true })
    .filter(e => e.getFlags() & flags.CHAG).map(e => toYmd(Math.round(Date.UTC(...ymdParts(e.getDate().greg())) / 86400000))));
  for (let dn = FROM; dn <= TO; dn++) {
    const mine = !!yomTov(dn, il), theirs = ref.has(toYmd(dn));
    if (mine !== theirs) fail(toYmd(dn) + ' יום טוב: ' + mine + ' ≠ ' + theirs);
  }
}
function ymdParts(d) { return [d.getFullYear(), d.getMonth(), d.getDate()]; }

// 3. פרשות
for (const il of [true, false]) {
  console.log('פרשות השבוע, ' + (il ? 'ארץ ישראל' : 'חו"ל'));
  const sedras = {};
  for (let dn = FROM + (6 - dow(FROM)); dn <= TO; dn += 7) {
    const hd = new HDate(refDate(dn)), hy = hd.getFullYear();
    const s = sedras[hy] || (sedras[hy] = new Sedra(hy, il));
    const r = s.lookup(hd);
    const theirs = r.chag ? null : [].concat(r.num).map(n => n - 1).join(',');
    const m = parashaIndices(dn, il), mine = m ? m.join(',') : null;
    if (mine !== theirs) fail(toYmd(dn) + ' (' + hy + (il ? ' IL' : ' diaspora') + '): ' + mine + ' ≠ ' + theirs);
  }
}

// 4. מועדים לתבניות: ימי חול מיוחדים ושבתות מיוחדות
{
  console.log('מועדים לתבניות (חנוכה, פורים, צומות, ראש חודש, שבתות מיוחדות)');
  const MOADIM_FROM = toDayNum('2000-01-01'), MOADIM_TO = toDayNum('2060-12-31');
  const ids = {};
  const add = (id, dn) => (ids[id] || (ids[id] = new Set())).add(dn);
  const SPECIAL = { 'Shabbat Shuva': 'shuva', 'Shabbat Zachor': 'zachor', 'Shabbat HaGadol': 'hagadol', 'Shabbat Chazon': 'chazon', 'Shabbat Nachamu': 'nachamu' };
  const FASTS = ['Tzom Gedaliah', "Asara B'Tevet", "Ta'anit Esther", 'Tzom Tammuz'];
  for (const e of HebrewCalendar.calendar({ start: refDate(MOADIM_FROM), end: refDate(MOADIM_TO), il: true })) {
    const dn = Math.round(Date.UTC(...ymdParts(e.getDate().greg())) / 86400000), desc = e.getDesc();
    if (SPECIAL[desc]) add(SPECIAL[desc], dn);
    if (FASTS.includes(desc)) add('fast', dn);
    if (desc === "Tish'a B'Av" || desc === "Tish'a B'Av (observed)") add('tishaBav', dn);
    if (desc === 'Purim' || desc === 'Shushan Purim') add('purim', dn);
    if (e.getFlags() & flags.ROSH_CHODESH) add('rch', dn);
    // הנר הראשון נדלק בערב כ"ד בכסלו, ולכן ימי חנוכה הם הימים של נר 2–8 ו"היום השמיני"
    if (/^Chanukah: [2-8] Candles|^Chanukah: 8th Day/.test(desc)) add('chanukah', dn);
  }
  for (const id in ids) {
    for (let dn = MOADIM_FROM; dn <= MOADIM_TO; dn++) {
      const mine = isMoed(id, dn, true), theirs = ids[id].has(dn);
      if (mine !== theirs) fail(toYmd(dn) + ' ' + id + ': ' + mine + ' ≠ ' + theirs);
    }
  }
}

// 5. זמני היום (סטייה מותרת: דקה)
const PLACES = [['ירושלים', 31.769, 35.2163, 'Asia/Jerusalem'], ['חיפה', 32.8184, 34.9885, 'Asia/Jerusalem'],
  ['אילת', 29.5581, 34.9482, 'Asia/Jerusalem'], ['ניו יורק', 40.7128, -74.006, 'America/New_York'],
  ['לונדון', 51.5074, -0.1278, 'Europe/London'], ['מלבורן', -37.8136, 144.9631, 'Australia/Melbourne']];
const KEYS = { sunrise: z => z.sunrise(), sunset: z => z.sunset(), alotHaShachar: z => z.alotHaShachar(), tzeit: z => z.tzeit(8.5),
  sofZmanShma: z => z.sofZmanShma(), sofZmanShmaMGA: z => z.sofZmanShmaMGA(), chatzot: z => z.chatzot(),
  minchaGedola: z => z.minchaGedola(), minchaKetana: z => z.minchaKetana(), plagHaMincha: z => z.plagHaMincha() };
for (const [name, lat, lng, tz] of PLACES) {
  console.log('זמני היום, ' + name);
  let worst = 0;
  for (let dn = toDayNum('2020-01-01'); dn <= toDayNum('2040-12-31'); dn += 3) {
    const mine = zmanim(dn, lat, lng);
    const ref = new Zmanim(new GeoLocation(null, lat, lng, 0, tz), refDate(dn), false);
    for (const k in KEYS) {
      const r = KEYS[k](ref);
      if (!r || isNaN(r) || mine[k] == null) continue;
      const diff = Math.abs(mine[k] - r.getTime()) / 1000;
      worst = Math.max(worst, diff);
      if (diff > 60) fail(name + ' ' + toYmd(dn) + ' ' + k + ': הפרש ' + diff.toFixed(0) + ' שניות');
    }
  }
  console.log('  הפרש מקסימלי: ' + worst.toFixed(1) + ' שניות');
}

console.log(failures ? '\n' + failures + ' שגיאות' : '\nהכל תקין ✓');
process.exit(failures ? 1 : 0);
