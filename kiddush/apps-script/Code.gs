/* שומר הסף של לוח הקידושים (Google Apps Script).
 * סקריפט אחד משרת את כל בתי הכנסת. הוא רץ בחשבון של בעל האתר, וכל גיליון שגבאי יוצר משותף עם החשבון הזה.
 *   GET  ?who=1          מחזיר את כתובת החשבון, כדי שהאתר ישתף איתו גיליון חדש
 *   GET  ?sheet=<id>     מחזיר את הלוח, בלי מספרי טלפון
 *   POST {sheet, date, sponsor, dedic, dname, reason, phone, note}
 *                        כותב רישום, ורק לשבת שעדיין פנויה
 * הסקריפט עובד רק על גיליונות שהלוח יצר (מסומנים ב-kiddushBoard), גם אם לחשבון יש גישה לגיליונות אחרים.
 * הוראות העלאה: ../docs/google-setup.md
 */
var TAB = 'קידושים', SET_TAB = 'הגדרות', FIRST = 4, COLS = 9, MARK = 'kiddushBoard';
var DEDIC = ['לעילוי נשמת', 'לזכות'];
var MAX = { sponsor: 60, dname: 80, reason: 80, phone: 20, note: 200 };

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.who) return out({ ok: true, email: Session.getEffectiveUser().getEmail() });
  try {
    var cached = CacheService.getScriptCache().get('b:' + p.sheet);
    if (cached) return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);
    return out(readBoard(open(p.sheet)), p.sheet);
  } catch (err) { return fail(err); }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var d = JSON.parse(e.postData.contents);
    var sponsor = clean(d.sponsor, MAX.sponsor);
    if (!sponsor) return out({ ok: false, code: 'missing' });
    var dedic = DEDIC.indexOf(d.dedic) >= 0 ? d.dedic : '';
    var row = [sponsor, dedic, clean(d.dname, MAX.dname), clean(d.reason, MAX.reason), clean(d.phone, MAX.phone), clean(d.note, MAX.note)];
    lock.waitLock(15000);
    var ss = open(d.sheet), sh = ss.getSheetByName(TAB);
    var n = sh.getLastRow() - FIRST + 1;
    if (n < 1) return out({ ok: false, code: 'no-date' });
    var vals = sh.getRange(FIRST, 1, n, 4).getDisplayValues();
    for (var i = 0; i < n; i++) {
      if (dateKey(vals[i][0]) !== d.date) continue;
      if (String(vals[i][3]).trim()) return out({ ok: false, code: 'taken' });
      sh.getRange(FIRST + i, 4, 1, row.length).setValues([row]);
      SpreadsheetApp.flush();
      CacheService.getScriptCache().remove('b:' + d.sheet);
      return out({ ok: true });
    }
    return out({ ok: false, code: 'no-date' });
  } catch (err) { return fail(err); }
  finally { try { lock.releaseLock(); } catch (x) {} }
}

function open(id) {
  if (!/^[\w-]{20,}$/.test(String(id || ''))) throw codeErr('bad-sheet');
  var ss;
  try { ss = SpreadsheetApp.openById(id); } catch (x) { throw codeErr('no-access'); }
  var marked = ss.getDeveloperMetadata().some(function (m) { return m.getKey() === MARK; });
  if (!marked || !ss.getSheetByName(TAB)) throw codeErr('not-board');
  return ss;
}

function readBoard(ss) {
  var info = { name: '', il: true };
  var set = ss.getSheetByName(SET_TAB);
  if (set && set.getLastRow()) set.getRange(1, 1, set.getLastRow(), 2).getDisplayValues().forEach(function (r) {
    if (r[0] === 'שם בית הכנסת') info.name = String(r[1]).trim();
    if (r[0] === 'מיקום') info.il = String(r[1]).trim() !== 'חוץ לארץ';
  });
  var sh = ss.getSheetByName(TAB), n = sh.getLastRow() - FIRST + 1, rows = {};
  if (n > 0) sh.getRange(FIRST, 1, n, COLS).getDisplayValues().forEach(function (r, i) {
    var k = dateKey(r[0]);
    if (!k || rows[k]) return;
    // עמודה H (טלפון) לא נשלחת לאתר: רק הגבאי רואה אותה בגיליון
    rows[k] = { row: FIRST + i, label: t(r[2]), sponsor: t(r[3]), dedic: t(r[4]), dname: t(r[5]), reason: t(r[6]), note: t(r[8]) };
  });
  return { ok: true, info: info, rows: rows };
}

function dateKey(s) {
  s = String(s || '').trim();
  var m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
  if (m) return m[3] + '-' + pad(m[2]) + '-' + pad(m[1]);
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return m ? m[1] + '-' + pad(m[2]) + '-' + pad(m[3]) : null;
}
function pad(x) { return ('0' + Number(x)).slice(-2); }
function t(v) { return String(v || '').trim(); }
/* טקסט בלבד, בלי שורות חדשות. גרש בהתחלה מונע מגוגל לפרש ערך כמו "=..." או "+972..." כנוסחה, ולא מוצג בתא */
function clean(v, max) {
  var s = String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
function codeErr(code) { var e = new Error(code); e.code = code; return e; }
function fail(err) { return out({ ok: false, code: err.code || 'error' }); }
function out(obj, cacheKey) {
  var s = JSON.stringify(obj);
  if (cacheKey) CacheService.getScriptCache().put('b:' + cacheKey, s, 20);
  return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.JSON);
}
