import { GeoLocation, HDate, HebrewCalendar, Zmanim, flags } from "@hebcal/core";

/** מיקום הקהילה לחישוב זמני שבת וחג */
export type Place = { lat: number; lng: number; tz: string; il: boolean };

/** הפוש נעצר שעה לפני השקיעה (הדלקת הנרות היא עד 40 דקות לפניה) ונמשך חצי שעה אחרי צאת הכוכבים */
const BEFORE_SUNSET_MS = 60 * 60 * 1000;
const AFTER_TZEIT_MS = 30 * 60 * 1000;
const DAY_MS = 864e5;

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" של הרגע now בשעון של tz */
function localKey(now: number, tz: string) {
  try {
    const k = new Date(now).toLocaleDateString("en-CA", { timeZone: tz });
    if (/^\d{4}-\d{2}-\d{2}$/.test(k)) {
      return k;
    }
  } catch {
    // אזור זמן לא מוכר
  }
  return new Date(now).toISOString().slice(0, 10);
}

const parts = (key: string) => key.split("-").map(Number) as [number, number, number];
const shiftKey = (key: string, days: number) => new Date(Date.parse(key) + days * DAY_MS).toISOString().slice(0, 10);
/** תאריך בחצות לפי השעון של סביבת הריצה, כמו ש-HDate מצפה לו */
const dateOf = (key: string) => {
  const [y, m, d] = parts(key);
  return new Date(y, m - 1, d);
};

/** האם התאריך הוא שבת או יום טוב (לא חול המועד) */
function isHoly(key: string, il: boolean) {
  const h = new HDate(dateOf(key));
  if (h.getDay() === 6) {
    return true;
  }
  return (HebrewCalendar.getHolidaysOnDate(h, il) ?? []).some((e) => (e.getFlags() & flags.CHAG) !== 0);
}

function validTime(d: Date | null | undefined): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

/**
 * חלון של שבת או חג שרצף הימים הקדושים שלו הוא first..last (תאריכים בשעון המקום).
 * עם מיקום: משעה לפני השקיעה בערב ועד חצי שעה אחרי צאת הכוכבים ביום האחרון.
 * בלי מיקום (או אם אי אפשר לחשב זמנים): החלון הרחב ביותר שמכסה כל אזור זמן, כדי לא לטעות לכיוון חילול שבת.
 */
function windowOf(first: string, last: string, place: Place | null): [number, number] {
  if (place) {
    try {
      const geo = new GeoLocation(null, place.lat, place.lng, 0, place.tz);
      const eve = new Zmanim(geo, dateOf(shiftKey(first, -1)), false).sunset();
      const out = new Zmanim(geo, dateOf(last), false).tzeit(8.5);
      if (validTime(eve) && validTime(out)) {
        return [eve.getTime() - BEFORE_SUNSET_MS, out.getTime() + AFTER_TZEIT_MS];
      }
    } catch {
      // נופלים לחלון הרחב
    }
  }
  const [ey, em, ed] = parts(shiftKey(first, -1));
  const [ly, lm, ld] = parts(last);
  // הצהריים המוקדמים ביותר בערב (UTC+14) ועד חצות המאוחר ביותר בסוף היום האחרון (UTC-12)
  return [Date.UTC(ey, em - 1, ed) - 2 * 3600e3, Date.UTC(ly, lm - 1, ld) + DAY_MS + 12 * 3600e3];
}

/**
 * אם הרגע now הוא בתוך שבת או חג: הזמן (במילישניות) שבו הם נגמרים. אחרת null.
 * place=null: מיקום לא ידוע, ואז נבדקים תאריכי ישראל או חו"ל לפי il.
 */
export function quietUntil(now: number, place: Place | null, il: boolean): number | null {
  const tz = place?.tz ?? "UTC";
  const today = localKey(now, tz);
  const keys: string[] = [];
  for (let i = -4; i <= 2; i++) {
    keys.push(shiftKey(today, i));
  }
  const holy = keys.map((k) => isHoly(k, place?.il ?? il));
  for (let i = 0; i < keys.length; i++) {
    if (!holy[i]) {
      continue;
    }
    let j = i;
    while (j + 1 < keys.length && holy[j + 1]) {
      j++;
    }
    const [from, to] = windowOf(keys[i], keys[j], place);
    if (now >= from && now < to) {
      return to;
    }
    i = j;
  }
  return null;
}

export const _test = { isHoly, windowOf, pad };
