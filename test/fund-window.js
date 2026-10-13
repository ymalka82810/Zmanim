/**
 * בודק שחלון התאריכים של הקופה (convex/fundMath.ts) נותן בדיוק את אותן יתרות כמו טעינת כל ההיסטוריה.
 * הלוגיקה של moves/balance מועתקת מ-gabbai/js/app.js, ו-mergeTxs משחזר את איחוד ledger ו-carry.
 * הרצה: node test/fund-window.js
 */
import { carryOf, inLedgerWindow } from '../convex/fundMath.ts';

let failures = 0;
const fail = m => { if (++failures <= 20) console.log('  ✗ ' + m); };

const isIncome = t => ['donation', 'mitzvah', 'salary'].includes(t.type);
function moves(txs, account) {
  const out = [];
  for (const t of txs) {
    const a = t.amount;
    if (account === 'main') {
      if (isIncome(t) && t.paid) out.push({ date: t.paidDate || t.date, cr: a, dr: 0 });
      if (t.type === 'expense') out.push({ date: t.date, cr: 0, dr: a });
      if (t.type === 'pettyIn') out.push({ date: t.date, cr: 0, dr: a });
    } else {
      if (t.type === 'pettyIn') out.push({ date: t.date, cr: a, dr: 0 });
      if (t.type === 'petty') out.push({ date: t.date, cr: 0, dr: a });
    }
  }
  return out;
}
const balance = (txs, account, open = 0) => Math.round((open + moves(txs, account).reduce((s, m) => s + m.cr - m.dr, 0)) * 100) / 100;

// מחולל דטרמיניסטי
let seed = 12345;
const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pick = a => a[Math.floor(rnd() * a.length)];
const day = n => new Date(Date.UTC(2023, 0, 1) + n * 864e5).toISOString().slice(0, 10);
const TYPES = ['donation', 'mitzvah', 'salary', 'expense', 'petty', 'pettyIn'];

function makeTxs(n) {
  const txs = [];
  for (let i = 0; i < n; i++) {
    const type = pick(TYPES), d = Math.floor(rnd() * 1000), income = isIncome({ type });
    const paid = income && rnd() < 0.6;
    const paidDate = paid ? day(d + Math.floor(rnd() * 400)) : '';
    txs.push({ id: 't' + i, type, amount: Math.round(rnd() * 50000) / 100 + 1, date: day(d), paid, paidDate });
  }
  return txs;
}

let checks = 0;
for (let round = 0; round < 200; round++) {
  const all = makeTxs(300);
  const since = day(Math.floor(rnd() * 1000));
  const ledger = all.filter(t => inLedgerWindow(t, since));
  const { main, petty, later } = carryOf(all.filter(t => t.date < since), since);
  const seen = new Set(ledger.map(t => t.id));
  const merged = ledger.concat(later.filter(t => !seen.has(t.id)));
  for (const [acc, carryVal] of [['main', main], ['petty', petty]]) {
    const full = balance(all, acc, 100), win = balance(merged, acc, 100 + carryVal);
    checks++;
    if (Math.abs(full - win) > 0.011) fail(`${acc} מאז ${since}: הכול ${full}, חלון ${win}`);
  }
  // חיובים פתוחים (לא משולמים) חייבים להופיע כולם
  const open = all.filter(t => !t.paid && isIncome(t)).map(t => t.id).sort().join();
  const openWin = merged.filter(t => !t.paid && isIncome(t)).map(t => t.id).sort().join();
  checks++;
  if (open !== openWin) fail(`חיובים פתוחים חסרים מאז ${since}`);
  // הוצאות וקופה קטנה לפני since לא יוצאות פעמיים (בחלון וב-carry)
  checks++;
  if (ledger.some(t => !isIncome(t) && t.date < since)) fail('הוצאה ישנה נכנסה לחלון');
}
console.log(`fund-window: ${checks} בדיקות`);
console.log(failures ? failures + ' שגיאות' : 'הכל תקין ✓');
process.exit(failures ? 1 : 0);
