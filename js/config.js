/** הגדרות: ברירות מחדל, ערים, ושמירה מקומית בדפדפן. */

export const CITIES = [
  // [מזהה, שם, קו רוחב, קו אורך, דקות הדלקת נרות]
  ['jerusalem', 'ירושלים', 31.7690, 35.2163, 40], ['bneibrak', 'בני ברק', 32.0840, 34.8340, 22],
  ['telaviv', 'תל אביב', 32.0809, 34.7806, 22], ['petach', 'פתח תקווה', 32.0871, 34.8875, 22],
  ['haifa', 'חיפה', 32.8184, 34.9885, 30], ['beitshemesh', 'בית שמש', 31.7470, 34.9881, 30],
  ['modiin', 'מודיעין', 31.8969, 35.0095, 22], ['elad', 'אלעד', 32.0523, 34.9513, 22],
  ['ashdod', 'אשדוד', 31.7921, 34.6497, 22], ['ashkelon', 'אשקלון', 31.6688, 34.5743, 22],
  ['beersheva', 'באר שבע', 31.2518, 34.7913, 22], ['netanya', 'נתניה', 32.3215, 34.8532, 22],
  ['rehovot', 'רחובות', 31.8928, 34.8113, 22], ['rishon', 'ראשון לציון', 31.9730, 34.7925, 22],
  ['safed', 'צפת', 32.9646, 35.4960, 30], ['tiberias', 'טבריה', 32.7922, 35.5312, 22],
  ['eilat', 'אילת', 29.5581, 34.9482, 22]
];

/** זמן בסיס לכלל: תווית בטופס ← מפתח פנימי */
export const BASES = {
  'הדלקת נרות': 'candles', 'שקיעה': 'sunset', 'צאת הכוכבים': 'tzeit',
  'צאת שבת/חג': 'havdalah', 'עלות השחר': 'alotHaShachar', 'הנץ': 'sunrise',
  'סו"ז ק"ש מג"א': 'sofZmanShmaMGA', 'סו"ז ק"ש גר"א': 'sofZmanShma',
  'חצות': 'chatzot', 'מנחה גדולה': 'minchaGedola', 'מנחה קטנה': 'minchaKetana',
  'פלג המנחה': 'plagHaMincha', 'שעה קבועה': 'fixed'
};
export const WHEN = ['כניסה', 'כל יום', 'יציאה'];
export const APPLIES = ['שבת וחג', 'שבת בלבד', 'חג בלבד'];
export const ROUND = ['ללא', 'למטה ל-5', 'למעלה ל-5', 'לקרוב ל-5'];

export const DEFAULT_CONFIG = {
  version: 1,
  shul: '', city: 'jerusalem', lat: 31.769, lng: 35.2163, tz: 'Asia/Jerusalem', il: true,
  candle: 40, havdalah: '8.5', notes: '',
  rules: [
    { name: 'מנחה וקבלת שבת', when: 'כניסה', applies: 'שבת וחג', base: 'הדלקת נרות', offset: '15', round: 'ללא' },
    { name: 'שחרית', when: 'כל יום', applies: 'שבת וחג', base: 'שעה קבועה', offset: '08:00', round: 'ללא' },
    { name: 'מנחה', when: 'כל יום', applies: 'שבת וחג', base: 'שקיעה', offset: '-40', round: 'למטה ל-5' },
    { name: 'ערבית', when: 'יציאה', applies: 'שבת וחג', base: 'צאת שבת/חג', offset: '0', round: 'ללא' }
  ]
};

const KEY = 'zmanim.config';
const clone = o => JSON.parse(JSON.stringify(o));

/** משלים שדות חסרים (הגדרות ישנות או קובץ מיובא) */
export function normalize(c) {
  const cfg = Object.assign(clone(DEFAULT_CONFIG), c || {});
  if (!Array.isArray(cfg.rules)) cfg.rules = [];
  cfg.lat = Number(cfg.lat); cfg.lng = Number(cfg.lng);
  cfg.candle = Number(cfg.candle) || 0;
  cfg.havdalah = String(cfg.havdalah || '8.5');
  cfg.il = cfg.il !== false;
  return cfg;
}

export function loadConfig() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { cfg: normalize(JSON.parse(raw)), saved: true };
  } catch (e) { /* אין גישה לאחסון, או נתונים פגומים */ }
  return { cfg: normalize(null), saved: false };
}

export function saveConfig(cfg) {
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); return true; }
  catch (e) { return false; }
}

export function clearConfig() {
  try { localStorage.removeItem(KEY); } catch (e) { /* אין גישה לאחסון */ }
}
