import { HDate, HebrewCalendar } from "@hebcal/core";

/** שנה עברית (למשל 5786) עבור תאריך לועזי "YYYY-MM-DD", לסינון עתידי של רישומים לפי תקופה */
export function hebrewYearOf(dateKey: string): number {
  return new HDate(new Date(dateKey)).getFullYear();
}

const pad = (n: number) => String(n).padStart(2, "0");
/** "YYYY-MM-DD" של Date שנוצר מ-HDate.greg() (חצות לפי השעון המקומי) */
export const dateKeyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateOfKey = (k: string) => {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** תאריך עברי תקין: חודש 1–13 (13 = אדר ב׳, רק בשנה מעוברת) ויום שקיים בחודש */
export function isValidHebrewDate(day: number, month: number, year: number) {
  if (![day, month, year].every(Number.isInteger) || year < 3000 || month < 1 || month > 13 || day < 1) {
    return false;
  }
  if (month === 13 && !HDate.isLeapYear(year)) {
    return false;
  }
  return day <= HDate.daysInMonth(month, year);
}

export const hebrewDateText = (day: number, month: number, year: number) =>
  new HDate(day, month, year).renderGematriya(true);

/** התאריך הלועזי ("YYYY-MM-DD") של יום האזכרה הקרוב, מ-fromKey והלאה (כולל). לפי כללי hebcal לאדר, חשוון וכסלו */
export function nextYahrzeit(y: { hDay: number; hMonth: number; hYear: number }, fromKey: string): string | null {
  const death = new HDate(y.hDay, y.hMonth, y.hYear);
  const from = new HDate(dateOfKey(fromKey));
  for (let hy = from.getFullYear(); hy <= from.getFullYear() + 1; hy++) {
    const h = HebrewCalendar.getYahrzeit(hy, death);
    if (h && h.abs() >= from.abs()) {
      return dateKeyOf(h.greg());
    }
  }
  return null;
}

/** מספר הימים בין שני תאריכים "YYYY-MM-DD" */
export const daysBetween = (fromKey: string, toKey: string) =>
  Math.round((Date.parse(toKey) - Date.parse(fromKey)) / 864e5);

/** היום ("YYYY-MM-DD") לפי שעון ישראל */
export function todayKey() {
  try {
    const k = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
    if (/^\d{4}-\d{2}-\d{2}$/.test(k)) {
      return k;
    }
  } catch {
    // אין תמיכה באזורי זמן בסביבת הריצה
  }
  return new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
}

export function addDays(key: string, days: number) {
  const d = new Date(Date.parse(key) + days * 864e5);
  return d.toISOString().slice(0, 10);
}
