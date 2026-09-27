/* גישה לגיליון הגוגל של לוח הקידושים.
 * קריאה והרשמה: דרך שומר הסף (apps-script/Code.gs), כי הגיליון משותף רק עם הגבאי ועם החשבון של השומר.
 * השומר כותב רק לשבת פנויה, כך שמתפלל אחד לא יכול למחוק רישום של אחר.
 * יצירה והוספת שנה: דרך Sheets API ו-Drive API, אחרי התחברות של הגבאי (הרשאת drive.file,
 * שנותנת לאתר גישה רק לקבצים שהוא עצמו יצר).
 * חושף window.KiddushSheets.
 */
(function(){
"use strict";
const { pad, heFull } = window.KiddushCalendar;
const cfg = window.KIDDUSH_CONFIG || {};

const TAB = 'קידושים', TAB_ID = 0, SET_TAB = 'הגדרות', SET_ID = 1;
const FIRST = 4; // שורת הנתונים הראשונה (1 = כותרת, 2 = הסבר, 3 = כותרות העמודות)
const HEAD = ['תאריך','תאריך עברי','שבת / חג','שם התורם','לע"נ / לזכות','שם (לע"נ / לזכות)','סיבה','טלפון','הערה'];
const DEDIC = ['לעילוי נשמת','לזכות'];
const COLS = HEAD.length;
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

/* ---------- קישורים ---------- */
function idFrom(text){
  const s = String(text || '').trim();
  const m = s.match(/\/spreadsheets\/d\/([\w-]{20,})/) || s.match(/[?&]sheet=([\w-]{20,})/) || s.match(/^([\w-]{20,})$/);
  return m ? m[1] : null;
}
const editUrl = (id, row) => 'https://docs.google.com/spreadsheets/d/'+id+'/edit#gid='+TAB_ID+(row ? '&range=D'+row : '');

/* ---------- שומר הסף ---------- */
const gateErr = code => Object.assign(new Error(code), { code });
async function gate(params, body){
  if (!cfg.gateUrl) throw gateErr('no-gate');
  const url = cfg.gateUrl + '?' + new URLSearchParams({ ...params, t: Date.now() });
  let res;
  // text/plain כדי שהדפדפן לא ישלח בקשה מקדימה, ש-Apps Script לא עונה עליה
  try { res = await fetch(url, body ? { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain;charset=utf-8' } } : { cache: 'no-store' }); }
  catch(e){ throw gateErr('network'); }
  let j = null; try { j = await res.json(); } catch(e){}
  if (!j) throw gateErr('error');
  if (!j.ok) throw gateErr(j.code || 'error');
  return j;
}
function dateKeyOf(s){
  s = String(s || '').trim();
  let m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
  if (m) return m[3]+'-'+pad(+m[2])+'-'+pad(+m[1]);
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return m ? m[1]+'-'+pad(+m[2])+'-'+pad(+m[3]) : null;
}
/* מחזיר { info: {name, il}, rows: { [dateKey]: {row, label, sponsor, dedic, dname, reason, note} } }. בלי טלפונים */
async function load(id){
  const { info, rows } = await gate({ sheet: id });
  return { info, rows };
}
/* רישום לשבת פנויה. אם השבת כבר תפוסה נזרקת שגיאה עם code = 'taken' */
const register = (id, date, data) => gate({}, { sheet: id, date, ...data });
const gateEmail = async () => (await gate({ who: 1 })).email;

/* ---------- התחברות לגוגל ---------- */
let gisPromise, tokenClient, waiting, token;
function loadGis(){
  if (!cfg.googleClientId) return Promise.reject(new Error('no-client-id'));
  gisPromise ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: cfg.googleClientId, scope: SCOPE,
        callback: r => { const w = waiting; waiting = null; if (!w) return; r.error ? w.rej(r) : (token = r.access_token, w.res(token)); },
        error_callback: e => { const w = waiting; waiting = null; if (w) w.rej(e); }
      });
      res();
    };
    s.onerror = () => { gisPromise = null; rej(new Error('gis-load')); };
    document.head.appendChild(s);
  });
  return gisPromise;
}
const ready = () => !!tokenClient;
/* חייב להיקרא ישירות מתוך לחיצה, אחרת הדפדפן חוסם את חלון ההתחברות */
function signIn(){
  if (!tokenClient) return Promise.reject(new Error('gis-not-ready'));
  return new Promise((res, rej) => { waiting = { res, rej }; tokenClient.requestAccessToken(); });
}
async function api(method, url, body){
  const res = await fetch(url, { method, headers: { Authorization: 'Bearer '+token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok){ const t = await res.text(); throw Object.assign(new Error(t), { status: res.status }); }
  return res.json();
}

/* ---------- בניית הגיליון ---------- */
const cell = (v, fmt) => ({ userEnteredValue: { stringValue: String(v) }, ...(fmt ? { userEnteredFormat: fmt } : {}) });
const gDate = d => pad(d.getDate())+'/'+pad(d.getMonth()+1)+'/'+d.getFullYear();
function slotLabel(sl){
  const base = sl.kind === 'חג' ? sl.name : sl.kind === 'שבת וחג' ? 'שבת, '+sl.name : sl.name === 'שבת' ? 'שבת' : sl.kind+' '+sl.name;
  return base + (sl.subs.length ? ' ('+sl.subs.join(', ')+')' : '');
}
const slotRow = sl => ({ values: [cell(gDate(sl.date)), cell(heFull(sl.hd)), cell(slotLabel(sl), sl.isChag ? { textFormat: { bold: true } } : null)] });
const rgb = h => ({ red: parseInt(h.slice(1,3),16)/255, green: parseInt(h.slice(3,5),16)/255, blue: parseInt(h.slice(5,7),16)/255 });

function formatRequests(){
  const col = (a, b) => ({ sheetId: TAB_ID, startRowIndex: FIRST-1, startColumnIndex: a, endColumnIndex: b });
  return [
    { repeatCell: { range: col(0, COLS), cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' }, verticalAlignment: 'MIDDLE' } }, fields: 'userEnteredFormat(numberFormat,verticalAlignment)' } },
    { setDataValidation: { range: col(4, 5), rule: { condition: { type: 'ONE_OF_LIST', values: DEDIC.map(v => ({ userEnteredValue: v })) }, strict: true, showCustomUi: true, inputMessage: 'בחרו מהרשימה' } } },
    { addConditionalFormatRule: { index: 0, rule: { ranges: [col(0, COLS)], booleanRule: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: '=$D'+FIRST+'<>""' }] }, format: { backgroundColor: rgb('#E1F0E8') } } } } },
    { addProtectedRange: { protectedRange: { range: { sheetId: TAB_ID, startRowIndex: 0, endRowIndex: FIRST-1 }, description: 'כותרות', warningOnly: true } } },
    { addProtectedRange: { protectedRange: { range: col(0, 3), description: 'תאריכים', warningOnly: true } } }
  ];
}

async function create({ name, il, siteBase, slots }){
  const email = await gateEmail(); // קודם כול, כדי לא ליצור גיליון שהשומר לא יוכל לגשת אליו
  const rows = [
    { values: [{ userEnteredValue: { formulaValue: '="לוח קידושים – "&\''+SET_TAB+'\'!B1' }, userEnteredFormat: { textFormat: { bold: true, fontSize: 16 }, horizontalAlignment: 'CENTER' } }] },
    { values: [cell('המתפללים נרשמים דרך הלוח באתר, והרישום נכתב כאן אוטומטית. שורה צבועה בירוק = תפוסה. הגבאי יכול לערוך ולמחוק רישומים כאן.', { wrapStrategy: 'WRAP', horizontalAlignment: 'CENTER', textFormat: { italic: true } })] },
    { values: HEAD.map(h => cell(h, { textFormat: { bold: true, foregroundColor: rgb('#FFFFFF') }, backgroundColor: rgb('#7B1E3B'), horizontalAlignment: 'CENTER', wrapStrategy: 'WRAP' })) },
    ...slots.map(slotRow)
  ];
  const widths = [95, 130, 210, 170, 115, 190, 150, 115, 200];
  const setRows = [
    ['שם בית הכנסת', name],
    ['מיקום', il ? 'ארץ ישראל' : 'חוץ לארץ'],
    ['קישור ללוח באתר', ''], // נכתב אחרי היצירה, כשמזהה הגיליון ידוע
    ['הסבר', 'אפשר לשנות כאן את שם בית הכנסת ואת המיקום. בלשונית "קידושים" אין לשנות את סדר העמודות.']
  ];
  const body = {
    properties: { title: 'לוח קידושים – '+name, timeZone: il ? 'Asia/Jerusalem' : undefined },
    sheets: [
      { properties: { sheetId: TAB_ID, title: TAB, rightToLeft: true, gridProperties: { rowCount: rows.length, columnCount: COLS, frozenRowCount: FIRST-1 } },
        merges: [0, 1].map(r => ({ sheetId: TAB_ID, startRowIndex: r, endRowIndex: r+1, startColumnIndex: 0, endColumnIndex: COLS })),
        data: [{ startRow: 0, startColumn: 0, rowData: rows, columnMetadata: widths.map(p => ({ pixelSize: p })) }] },
      { properties: { sheetId: SET_ID, title: SET_TAB, rightToLeft: true, gridProperties: { rowCount: setRows.length, columnCount: 2 } },
        data: [{ startRow: 0, startColumn: 0, rowData: setRows.map(([a, b]) => ({ values: [cell(a, { textFormat: { bold: true } }), cell(b)] })),
          columnMetadata: [{ pixelSize: 140 }, { pixelSize: 420 }] }] }
    ]
  };
  const ss = await api('POST', SHEETS, body);
  const id = ss.spreadsheetId;
  await api('POST', 'https://www.googleapis.com/drive/v3/files/'+id+'/permissions?sendNotificationEmail=false', { role: 'writer', type: 'user', emailAddress: email });
  const extra = [{ updateCells: { start: { sheetId: SET_ID, rowIndex: 2, columnIndex: 1 }, rows: [{ values: [cell(siteBase + id)] }], fields: 'userEnteredValue' } },
    { setDataValidation: { range: { sheetId: SET_ID, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 2 },
    rule: { condition: { type: 'ONE_OF_LIST', values: [{ userEnteredValue: 'ארץ ישראל' }, { userEnteredValue: 'חוץ לארץ' }] }, strict: true, showCustomUi: true } } }];
  const mark = { createDeveloperMetadata: { developerMetadata: { metadataKey: 'kiddushBoard', metadataValue: '1', location: { spreadsheet: true }, visibility: 'DOCUMENT' } } };
  await api('POST', SHEETS+'/'+id+':batchUpdate', { requests: [mark] }); // בלי הסימון הזה השומר מסרב לעבוד עם הגיליון
  let formatted = true;
  try { await api('POST', SHEETS+'/'+id+':batchUpdate', { requests: [...formatRequests(), ...extra] }); }
  catch(e){ console.warn('עיצוב הגיליון לא הושלם', e); formatted = false; }
  return { id, formatted };
}

/* מוסיף שורות אחרי התאריך האחרון בגיליון. getSlotsFrom(nextDay) מחזיר את השבתות והחגים להוספה */
async function extend(id, getSlotsFrom){
  const range = encodeURIComponent("'"+TAB+"'!A"+FIRST+':A');
  const res = await api('GET', SHEETS+'/'+id+'/values/'+range);
  const keys = (res.values || []).map(r => dateKeyOf(r[0])).filter(Boolean).sort();
  const last = keys.length ? window.KiddushCalendar.pkey(keys[keys.length-1]) : new Date();
  const next = new Date(last); next.setDate(next.getDate()+1);
  const slots = getSlotsFrom(next);
  if (!slots.length) return 0;
  await api('POST', SHEETS+'/'+id+':batchUpdate', { requests: [{ appendCells: { sheetId: TAB_ID, rows: slots.map(slotRow), fields: 'userEnteredValue,userEnteredFormat.textFormat' } }] });
  return slots.length;
}

window.KiddushSheets = { idFrom, editUrl, load, register, loadGis, ready, signIn, create, extend,
  hasClientId: () => !!cfg.googleClientId, hasGate: () => !!cfg.gateUrl, _dateKeyOf: dateKeyOf, _slotLabel: slotLabel };
})();
