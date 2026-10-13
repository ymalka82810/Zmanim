// חישובי חלון התאריכים של הקופה (fund:ledger ו-fund:carry), בלי תלות ב-Convex כדי שאפשר יהיה לבדוק אותם (test/fund-window.js)

export const INCOME_TYPES = new Set(["donation", "mitzvah", "salary"]);

export type MoneyTx = { type: string; amount: number; date: string; paid: boolean; paidDate: string };

/** רישום שנכנס לחלון של fund:ledger: מתאריך since ואילך, או חיוב הכנסה שטרם שולם גם אם ישן. הוצאות וקופה קטנה ישנות מסוכמות ב-carry בלבד */
export function inLedgerWindow(t: MoneyTx, since: string): boolean {
  return t.date >= since || (!t.paid && INCOME_TYPES.has(t.type));
}

/** מסכם רישומים שתאריכם לפני since ליתרת פתיחה נוספת לכל חשבון. הכנסה ששולמה מאז since חוזרת ב-later כי היא תנועה של התקופה החדשה */
export function carryOf<T extends MoneyTx>(old: T[], since: string) {
  let main = 0;
  let petty = 0;
  const later: T[] = [];
  for (const t of old) {
    if (INCOME_TYPES.has(t.type)) {
      if (!t.paid) {
        continue;
      }
      if ((t.paidDate || t.date) >= since) {
        later.push(t);
      } else {
        main += t.amount;
      }
    } else if (t.type === "expense") {
      main -= t.amount;
    } else if (t.type === "pettyIn") {
      main -= t.amount;
      petty += t.amount;
    } else if (t.type === "petty") {
      petty -= t.amount;
    }
  }
  return { main: Math.round(main * 100) / 100, petty: Math.round(petty * 100) / 100, later };
}
