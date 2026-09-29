import { HDate } from "@hebcal/core";

/** שנה עברית (למשל 5786) עבור תאריך לועזי "YYYY-MM-DD", לסינון עתידי של רישומים לפי תקופה */
export function hebrewYearOf(dateKey: string): number {
  return new HDate(new Date(dateKey)).getFullYear();
}
