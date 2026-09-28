/**
 * השלמת אותיות לגופן שמוטמע ב-PDF. גופן מוטמע הוא חלקי – יש בו רק האותיות שהיו בקובץ,
 * ולכן אות כמו צ או ץ שלא הופיעה בלוח הישן נכתבת בגופן אחר.
 * כאן לוקחים את הגופן המלא מהמחשב (Local Font Access – Chrome ו-Edge במחשב) או מקובץ גופן שהגבאי מעלה,
 * ושומרים בתבנית רק את האותיות העבריות, הספרות והסימנים – כדי שהתבנית תישאר קטנה.
 */

const OPENTYPE = 'https://cdn.jsdelivr.net/npm/opentype.js@1.3.4/dist/opentype.module.min.js';
const HEB_LETTERS = 'אבגדהוזחטיכךלמםנןסעפףצץקרשת';

/** התווים שנשמרים מהגופן: אותיות לטיניות, ספרות וסימנים, עברית (כולל ניקוד וגרשיים), מקפים, מירכאות ו-₪ */
const RANGES = [[0x20, 0x7e], [0xa0, 0xbf], [0xd7, 0xd7], [0x0591, 0x05f4], [0x2010, 0x2027], [0x2030, 0x203a], [0x20aa, 0x20aa]];

export const canReadLocalFonts = () => typeof window.queryLocalFonts === 'function';

/** האותיות העבריות שחסרות בגופן המוטמע (ריק אם הגופן לא מוטמע או כבר הושלם) */
export function missingLetters(f) {
  if (!f || !f.data || !f.map || f.full) return '';
  return [...HEB_LETTERS].filter(ch => !(ch in f.map)).join('');
}

/** הגופנים בתבנית שחסרות בהם אותיות: [[מפתח, גופן, אותיות חסרות]] */
export function fontsToFill(fonts) {
  return Object.entries(fonts || {}).map(([k, f]) => [k, f, missingLetters(f)]).filter(([, , m]) => m);
}

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
/** השם המלא של הגופן מה-PDF, בלי קידומת החלקיות ("ABCDEF+David-Bold" ← "David-Bold") */
const psName = f => f.ps || f.family || '';

/**
 * השלמה מהגופנים שמותקנים במחשב. חייב להיקרא ישר מלחיצה (הדפדפן מבקש אישור).
 * מחזיר { filled: [שמות], notFound: [שמות], failed: [{ family, file (שם הגופן במחשב), why }] }.
 * why: 'format' – פורמט שלא ניתן לקרוא (למשל Type 1 ב-Linux), 'noHebrew' – אין בגופן עברית, 'network' – אין חיבור
 */
export async function fillFromLocal(fonts) {
  const list = await window.queryLocalFonts();
  const filled = [], notFound = [], failed = [];
  for (const [, f] of fontsToFill(fonts)) {
    const ps = norm(psName(f)), fam = norm(f.family);
    const sameFam = list.filter(d => norm(d.family) === fam);
    const d = list.find(d => norm(d.postscriptName) === ps) || list.find(d => norm(d.fullName) === ps)
      || sameFam.find(d => /bold|black|heavy/i.test(d.style) === !!f.bold) || sameFam[0];
    if (!d) { notFound.push(f.family); continue; }
    try {
      // ב-Mac גופנים רבים שמורים באוסף (‎.ttc) – לוקחים ממנו את הגופן שהמחשב מצא
      const list = await parseAll(await (await d.blob()).arrayBuffer());
      if (!list.length) throw Object.assign(new Error('פורמט גופן לא נתמך'), { code: 'format' });
      const src = list.find(x => x.ps === norm(d.postscriptName)) || pick(f, list);
      f.full = await subset(src.font);
      filled.push(f.family);
    } catch (e) {
      console.warn('לא ניתן לקרוא את הגופן ' + d.fullName, e);
      failed.push({ family: f.family, file: d.fullName, why: e.code || 'format' });
    }
  }
  return { filled, notFound, failed };
}

/**
 * השלמה מקובץ גופן (‎.ttf/‎.otf, או אוסף ‎.ttc/‎.otc) שהגבאי העלה. הקובץ משלים את הגופנים באותו שם,
 * ואם בלוח יש רק משפחת גופן אחת שחסרות בה אותיות – משלים אותה בכל מקרה.
 * מחזיר את שמות הגופנים שהושלמו, או זורק שגיאה עם הסבר
 */
export async function fillFromFile(fonts, file) {
  const list = await parseAll(await file.arrayBuffer());
  if (!list.length) throw new Error('לא ניתן לקרוא את קובץ הגופן. צריך קובץ ‎.ttf, ‎.otf או ‎.ttc.');
  const need = fontsToFill(fonts);
  const matches = f => list.some(x => x.names.includes(norm(f.family)) || x.names.includes(norm(psName(f))));
  let hit = need.filter(([, f]) => matches(f));
  if (!hit.length && new Set(need.map(([, f]) => f.family)).size === 1) hit = need;
  if (!hit.length) {
    throw new Error('הקובץ הוא הגופן ' + list.map(x => x.title).join(', ') + ', ובלוח יש את הגופנים: ' +
      [...new Set(need.map(([, f]) => f.family))].join(', ') + '.');
  }
  // כל גופן בלוח מקבל את הגופן המתאים לו מהקובץ (רגיל או מודגש, כשהקובץ הוא אוסף)
  const done = new Map();
  for (const [, f] of hit) {
    const src = pick(f, list);
    if (!done.has(src)) done.set(src, await subset(src.font));
    f.full = done.get(src);
  }
  return [...new Set(hit.map(([, f]) => f.family))];
}

/** הגופן מהרשימה שהכי מתאים לגופן מה-PDF: לפי השם המלא, אחר כך משפחה ומשקל */
function pick(f, list) {
  const ps = norm(psName(f)), fam = norm(f.family);
  const sameFam = list.filter(x => x.names.includes(fam));
  const pool = sameFam.length ? sameFam : list;
  // השם המלא מול שם ה-PostScript בלבד: "David" הוא גם שם המשפחה של David-Bold
  return list.find(x => x.ps === ps) || pool.find(x => x.bold === !!f.bold) || pool[0];
}

/** כל הגופנים בקובץ: [{ font, names (מנורמלים), ps, title, bold }]. גופן שלא ניתן לקרוא מדולג */
async function parseAll(buf) {
  const opentype = await loadOpentype();
  const out = [];
  for (const b of splitCollection(buf)) {
    let font;
    try { font = opentype.parse(b); } catch (e) { continue; }
    const n = font.names;
    const vals = k => n[k] ? Object.values(n[k]) : [];
    out.push({ font, title: vals('fullName')[0] || vals('fontFamily')[0] || '', ps: norm(vals('postScriptName')[0]),
      names: ['fontFamily', 'postScriptName', 'fullName', 'preferredFamily'].flatMap(vals).map(norm),
      bold: ((font.tables.os2 && font.tables.os2.usWeightClass) || 400) >= 600 });
  }
  return out;
}

/**
 * פירוק אוסף גופנים (‎.ttc/‎.otc – מתחיל ב-"ttcf") לקבצי גופן בודדים, כי opentype.js קורא רק גופן בודד.
 * כל גופן באוסף הוא טבלת תוכן שמצביעה על טבלאות משותפות – מעתיקים את הטבלאות שלו לקובץ חדש.
 * קובץ שאינו אוסף מוחזר כמו שהוא
 */
function splitCollection(buf) {
  const v = new DataView(buf);
  if (buf.byteLength < 12 || v.getUint32(0) !== 0x74746366) return [buf];
  const out = [];
  for (let i = 0, n = v.getUint32(8); i < n; i++) {
    try {
      const off = v.getUint32(12 + i * 4), count = v.getUint16(off + 4);
      const tables = [];
      for (let t = 0; t < count; t++) {
        const r = off + 12 + t * 16;
        tables.push({ tag: v.getUint32(r), sum: v.getUint32(r + 4), offset: v.getUint32(r + 8), length: v.getUint32(r + 12) });
      }
      const pad = n => (n + 3) & ~3;
      const head = 12 + count * 16;
      const res = new ArrayBuffer(head + tables.reduce((s, t) => s + pad(t.length), 0));
      const o = new DataView(res), bytes = new Uint8Array(res);
      bytes.set(new Uint8Array(buf, off, 12), 0);
      let pos = head;
      tables.forEach((t, j) => {
        const r = 12 + j * 16;
        o.setUint32(r, t.tag); o.setUint32(r + 4, t.sum); o.setUint32(r + 8, pos); o.setUint32(r + 12, t.length);
        bytes.set(new Uint8Array(buf, t.offset, t.length), pos);
        pos += pad(t.length);
      });
      out.push(res);
    } catch (e) { /* גופן פגום באוסף */ }
  }
  return out;
}

let opentypePromise = null;
function loadOpentype() {
  if (!opentypePromise) opentypePromise = import(OPENTYPE).then(m => m.default || m).catch(e => {
    opentypePromise = null;
    throw Object.assign(new Error('לא ניתן לטעון את רכיב קריאת הגופנים. בדקו את החיבור לאינטרנט ונסו שוב.'), { code: 'network' });
  });
  return opentypePromise;
}

/** גופן חדש (base64) רק עם התווים שב-RANGES. זורק שגיאה אם אין בגופן אותיות עבריות */
async function subset(src) {
  const opentype = await loadOpentype();
  const notdef = src.glyphs.get(0);
  const glyphs = [new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: notdef.advanceWidth || src.unitsPerEm / 2, path: new opentype.Path() })];
  let heb = 0;
  for (const [a, b] of RANGES) for (let code = a; code <= b; code++) {
    const g = src.charToGlyph(String.fromCharCode(code));
    if (!g || g.index === 0) continue;
    if (code >= 0x05d0 && code <= 0x05ea) heb++;
    glyphs.push(new opentype.Glyph({ name: 'u' + code.toString(16), unicode: code, advanceWidth: g.advanceWidth, path: g.path }));
  }
  if (heb < 20) throw Object.assign(new Error('בגופן הזה אין אותיות עבריות.'), { code: 'noHebrew' });
  const out = new opentype.Font({ familyName: 'TplFill', styleName: 'Regular', unitsPerEm: src.unitsPerEm,
    ascender: src.ascender, descender: src.descender, glyphs });
  const bytes = new Uint8Array(out.toArrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
