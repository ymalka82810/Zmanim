/**
 * עורך התבנית: מציג את העמוד מהקובץ הישן עם אזורים מסומנים, ומאפשר לקבוע
 * מה ייכתב בכל אזור (תפילה, זמן היום, כותרת, תאריך). במסמך סרוק מסמנים אזורים ידנית.
 */

import { BASES, WHEN, WHEN_LABELS, ROUND, SIZES, DAY_APPLIES, appliesOnDay, prayerBases, designOf } from './config.js';
import { readFile, tokenize, detectDate, detectHebDate, detectShulAddress, suggestSlots, textCandidates, ruleOptions, agreeRules, printedTimes, approxStart, guessOldDay } from './template-read.js';
import { analyzeSlot, refineBox, inkLines, templateCanvas, specialHost, slotText, slotLook, wordLine } from './template-render.js';
import { findOccasion, findPeriod, periodFor, buildLuach, buildDaysLuach, timesFor } from './luach.js';
import { toDayNum, toYmd, todayIn, dow } from './dates.js';
import { esc } from './render.js';
import { fontsToFill, fontLabel, isUnnamed, canReadLocalFonts, fillFromLocal, fillFromFile } from './font-fill.js';

const $ = id => document.getElementById(id);
const KINDS = [['text', 'טקסט שכותבים כאן'], ['rule', 'תפילה או שיעור'], ['kiddush', 'קידוש (מלוח הקידושים)'], ['zman', 'זמן היום'], ['title', 'כותרת (שבת פרשת…)'], ['parasha', 'פרשת…'],
  ['parashaName', 'שם הפרשה בלבד'], ['special', 'שבת מיוחדת (נחמו, זכור…) – רק כשיש'], ['hebDate', 'תאריך עברי'], ['gregDate', 'תאריך לועזי'], ['address', 'כתובת בית הכנסת']];
const KIND_LABEL = Object.fromEntries(KINDS);
const BASE_LABELS = Object.keys(BASES);
const ZMANIM = BASE_LABELS.filter(l => BASES[l] !== 'fixed' && BASES[l] !== 'kiddush');
const RULE_BASE_LABELS = BASE_LABELS.filter(l => BASES[l] !== 'kiddush');
const KIDDUSH_LABEL = BASE_LABELS.find(l => BASES[l] === 'kiddush');
const zmanKey = label => BASES[label];
const zmanLabel = key => ZMANIM.find(l => BASES[l] === key) || ZMANIM[0];
const opts = (list, v) => list.map(x => Array.isArray(x)
  ? '<option value="' + x[0] + '"' + (x[0] === v ? ' selected' : '') + '>' + esc(x[1]) + '</option>'
  : '<option' + (x === v ? ' selected' : '') + '>' + esc(x) + '</option>').join('');
/** אפשרויות "לפי": זמני היום, ואחריהם התפילות מהאזורים ומההגדרות */
const baseOpts = s => {
  const names = prayerBases(st.slots.filter(x => x.kind === 'rule').concat(st.cfg.rules || []), s);
  if (s.base && !(s.base in BASES) && names.indexOf(s.base) < 0) names.push(s.base);
  return opts(RULE_BASE_LABELS, s.base) + (names.length ? '<optgroup label="לפי תפילה">' + opts(names, s.base) + '</optgroup>' : '');
};
let kiddush = null;   // dateKey ← קידוש מאושר, לתצוגה המקדימה (מ-app.js)
export function setKiddush(map) { kiddush = map; }
const SAMPLE_KIDDUSH = { sponsorName: 'משפחת ישראלי', occasion: 'בר מצווה' };
const oldMinutes = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(s.old || ''); return m ? +m[1] * 60 + +m[2] : null; };
/** ערך מוחלט (בדקות) של הפרש האזור, להצגה בשדה המספר */
const offsetAbs = s => { const n = parseInt(s.offset, 10); return isNaN(n) ? '' : String(Math.abs(n)); };
/** כיוון הפרש האזור – "לפני" או "אחרי", להצגה בתיבת הבחירה */
const offsetDir = s => (parseInt(s.offset, 10) < 0 ? 'לפני' : 'אחרי');

const DOW_LABELS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'];
const isDays = () => st.tpl.kind === 'days';
const isChol = () => st.period ? st.period.kind === 'chol' : st.tpl.id === 'chol';
/** אפשרויות "יום" בלוח של ימי חול: לפי היום בשבוע, ובחול המועד לפי המקום בלוח */
const dayOpts = () => DOW_LABELS.map((n, i) => ['d' + i, isChol() ? 'יום ' + (i + 1) + ' בלוח' : n]);

/*
 * st: { canvas, W, H, slots, candidates, fonts, day, cfg, name, onDone, drawing,
 *       tpl – התבנית שעורכים, cfgAll – כל ההגדרות, period – בלוח ימי חול: הלוח הישן }
 * st.cfg הוא ההגדרות עם זמני התפילות של התבנית.
 */
let st = null;
const openSlots = new WeakSet();   // אזורים שהשורה שלהם פתוחה לעריכה
let slotTexts = new WeakMap();     // הטקסט שנכתב בכל אזור בתצוגה האחרונה – למילים שבתיבות השורות

/** העמודה (יום) של מפתח d0…d5 בלוח הישן. בלי תאריך: יום בשבוע לפי המפתח */
function colOf(key) {
  const hit = st.period && st.period.days.find(x => x.key === key);
  if (hit) return hit;
  const i = +String(key).slice(1) || 0;
  return { key, dow: i, erev: i === 5, day: st.day != null ? st.day + i : null };
}

/** הלוח הישן לפי יום: שבת/חג, או לוח ימי חול */
function setDay(d) {
  if (d == null) { st.day = null; st.period = null; return; }
  const o = findPeriod(st.tpl.kind, d, st.cfg.il);
  st.period = o && o.mode === 'days' ? o : null;
  st.day = o ? o.first : d;
}

/* ---------- פתיחה ---------- */

/** פתיחת העורך מקובץ חדש, לתבנית tpl */
export async function editFromFile(file, cfgAll, tpl, onDone, onStatus) {
  const { canvas, items, fonts, docDayNum } = await readFile(file, onStatus);
  const tokens = tokenize(items);
  const cfg = { ...cfgAll, rules: tpl.rules };
  const fit = x => ({ ...x, box: refineBox(canvas, x.box), ...(x.labelBox ? { labelBox: refineBox(canvas, x.labelBox) } : {}) });
  st = { canvas, W: canvas.width, H: canvas.height, cfg, cfgAll, tpl, name: file.name, onDone, fonts,
    candidates: textCandidates(tokens).map(fit), scanned: !items.length, detected: detectShulAddress(tokens) };
  setDay(detectDate(tokens, docDayNum));
  // לוח ימי חול בלי תאריך בקובץ: מזהים את הימים לפי שבוע כללי (ראשון–שישי). הכללים נשענים על זמני היום
  // שמודפסים בלוח, ובלעדיהם השעות נשמרות כשעה קבועה עד שבוחרים תאריך
  const week = { mode: 'days', days: [0, 1, 2, 3, 4, 5].map(i => colOf('d' + i)) };
  let slots = suggestSlots(tokens, cfg, st.day, st.period || (isDays() ? week : null));
  // אין תאריך מפורש בקובץ: מנסים לנחש אותו לפי שם הפרשה, התאריך העברי בלי שנה והזמנים שכבר זוהו
  if (st.day == null && !isDays()) {
    const nameSlot = slots.find(s => s.kind === 'parasha' || s.kind === 'parashaName');
    const heb = detectHebDate(tokens);
    const guessed = nameSlot || heb ? guessOldDay(nameSlot ? nameSlot.old : '', slots, cfg, docDayNum, heb) : null;
    if (guessed != null) {
      setDay(guessed);
      slots = suggestSlots(tokens, cfg, st.day, st.period);
      st.autoGuessed = true;
    }
  }
  st.slots = slots.map(fit);
  st.approx = approxStart(st.slots, cfg, isDays());
  open();
}

/** פתיחת העורך לעיצוב הקיים של התבנית tplObj */
export async function editExisting(tplObj, cfgAll, onDone) {
  const tpl = designOf(cfgAll, tplObj), cfg = { ...cfgAll, rules: tplObj.rules };
  const img = new Image();
  await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; img.src = tpl.image; });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  st = { canvas, W: canvas.width, H: canvas.height, cfg, cfgAll, tpl: tplObj, name: tpl.name, onDone, fonts: tpl.fonts || {},
    slots: JSON.parse(JSON.stringify(tpl.slots)), candidates: tpl.candidates || [], scanned: !(tpl.candidates || []).length };
  setDay(tpl.day ?? null);
  st.approx = approxStart(st.slots, cfg, isDays());
  // כללים קיימים: להציג את ההגדרה הנוכחית שלהם
  for (const s of st.slots) {
    if (s.kind !== 'rule') continue;
    const r = isDays() ? cfg.rules.find(x => x.name === s.name && appliesOnDay(x.applies, colOf(s.when)))
      : cfg.rules.find(x => x.name === s.name && x.when === s.when);
    if (r) Object.assign(s, { base: r.base, offset: r.offset, round: r.round });
    // אזור שנשמר לפני שקידוש היה סוג אזור נפרד: מעבר לסוג "קידוש"
    if (s.base && BASES[s.base] === 'kiddush') s.kind = 'kiddush';
    // החלופות לכלל, בלי לשנות את מה שכבר הוגדר
    const options = ruleOpts(s);
    if (options) s.options = options;
  }
  open();
}

function open() {
  $('tplTitle').textContent = 'עיצוב מלוח קיים – ' + st.tpl.name;
  $('tplDateLabel').textContent = isDays() ? 'תאריך מתוך הלוח הישן' : 'תאריך הלוח הישן';
  $('tplImg').src = st.canvas.toDataURL('image/png');
  $('tplImg').style.aspectRatio = st.W + ' / ' + st.H;
  $('tplDate').value = st.day != null ? toYmd(st.day) : '';
  $('tplScanHint').hidden = !st.scanned;
  $('tplPreviewWrap').hidden = true;
  st.drawing = false;
  $('tplDraw').setAttribute('aria-pressed', 'false');
  renderOcc(); renderBoxes(); renderSlots();
  window.scrollTo(0, 0);
}

/* ---------- השלמת אותיות חסרות בגופן מהקובץ ---------- */

/** הגופנים של האזורים הכחולים: בשאר הגופנים לא נכתב טקסט חדש, וגם הם לא נשמרים בתבנית */
const slotFonts = () => Object.fromEntries(st.slots.map(s => s.box.font).filter(k => st.fonts[k]).map(k => [k, st.fonts[k]]));

/** הודעה כשבגופן המוטמע חסרות אותיות, עם אפשרות להשלים אותן מהמחשב או מקובץ גופן */
function renderFontFill(done) {
  const need = fontsToFill(slotFonts());
  const box = $('tplFontFill');
  box.hidden = !need.length && !done;
  if (box.hidden) return;
  // האותיות החסרות לכל גופן בנפרד: "David: צ ץ; Arial: ף"
  const byFamily = new Map();
  for (const [, f, m] of need) byFamily.set(fontLabel(f), new Set([...(byFamily.get(fontLabel(f)) || []), ...m]));
  const list = [...byFamily].map(([name, m]) => name + ': ' + [...m].join(' ')).join('; ');
  $('tplFontMsg').textContent = (done ? done + ' ' : '') + (need.length
    ? 'בגופנים שבקובץ חסרות אותיות (' + list + '), ולכן הן ייכתבו בגופן דומה. ' +
      (need.some(([, f]) => isUnnamed(f) && !f.realName)
        ? 'כשהקובץ לא שומר את שם הגופן, האתר מזהה אותו לפי צורת האותיות. ' : '') +
      (canReadLocalFonts()
        ? 'אם הגופן מותקן במחשב שלך או שיש לך קובץ שלו, אפשר להשלים ממנו את האותיות ולשמור אותן בתבנית.'
        // בטלפון (ובדפדפנים אחרים) אין גישה לגופנים שבמכשיר, ולרוב גם אין קובץ גופן להעלות
        : 'אפשר להשלים אותן מקובץ של הגופן, או בקלות יותר ממחשב עם Chrome או Edge שהגופן מותקן בו: ' +
          'פותחים שם את "עריכת התבנית" ולוחצים "השלמה מהגופנים שבמחשב". אחרי השמירה הלוח ייראה תקין בכל מכשיר.')
    : '');
  $('tplFontLocal').hidden = !need.length || !canReadLocalFonts();
  $('tplFontUpload').hidden = !need.length;
}

$('tplFontLocal').onclick = async () => {
  const btn = $('tplFontLocal');
  let res;
  // זיהוי גופן בלי שם סורק את כל הגופנים שבמחשב, וזה לוקח כמה שניות
  btn.disabled = true;
  try { res = await fillFromLocal(slotFonts()); }
  catch (e) {
    console.warn('אין גישה לגופנים שבמחשב', e);
    SiteDialog.alert('לא התקבלה גישה לגופנים שבמחשב. אפשר לאשר את הגישה בהגדרות האתר בדפדפן, או להעלות קובץ גופן.');
    return;
  } finally { btn.disabled = false; }
  // הסבר נפרד לכל סיבה: לא נמצא, נמצא בפורמט שלא נקרא (Type 1 ב-Linux), בלי עברית, או בלי חיבור
  const WHY = {
    format: x => 'הגופן ' + x.family + ' נמצא במחשב (' + x.file + '), אבל הוא שמור בפורמט ישן שהאתר לא יודע לקרוא. אפשר להעלות קובץ ‎.ttf או ‎.otf שלו.',
    noHebrew: x => 'הגופן ' + x.file + ' שנמצא במחשב לא כולל אותיות עבריות.',
    network: () => 'לא ניתן לטעון את רכיב קריאת הגופנים. בדקו את החיבור לאינטרנט ונסו שוב.'
  };
  const problems = [...new Set([
    ...[...new Set(res.notFound)].map(n => 'הגופן ' + n + ' לא נמצא במחשב. אפשר להעלות קובץ גופן.'),
    ...[...new Set(res.unknown)].map(n => 'לא נמצא במחשב גופן שהאותיות שלו זהות ל' + n + '. אפשר להעלות קובץ גופן.'),
    ...res.failed.map(x => (WHY[x.why] || WHY.format)(x))
  ])];
  if (res.filled.length) renderFontFill('הושלמו האותיות מהגופן ' + [...new Set(res.filled)].join(', ') + '.');
  if (problems.length) SiteDialog.alert(problems.join('\n'));
};
$('tplFontUpload').onclick = () => $('tplFontFile').click();
$('tplFontFile').onchange = async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try { renderFontFill('הושלמו האותיות מהגופן ' + (await fillFromFile(slotFonts(), file)).join(', ') + '.'); }
  catch (err) { SiteDialog.alert(err.message || 'לא ניתן לקרוא את קובץ הגופן.'); }
};

function close(result) {
  const done = st.onDone;
  st = null;
  done(result);
}

/* ---------- תאריך הלוח הישן ---------- */

function renderOcc() {
  const o = st.period || (st.day != null ? findOccasion(st.day, st.cfg.il) : null);
  const byPrinted = st.slots && st.slots.some(s => s.options && s.options.some(x => x.printed || x.approx));
  $('tplOcc').textContent = !o ? (byPrinted
    ? 'הכללים זוהו לפי זמני היום שמודפסים בלוח (כלל שמסומן "משוער" – לפי זמנים קרובים לאלה שבלוח). ' +
      'בחירת התאריך של הלוח הישן תאפשר לזהות את הכללים בדיוק.'
    : 'בחרו את התאריך של הלוח הישן כדי שהאתר יזהה את הכללים.')
    : 'הלוח הישן: ' + o.title + (st.autoGuessed ? ' (זוהה אוטומטית לפי הפרשה והזמנים – אפשר לתקן)' : '');
}

$('tplDate').addEventListener('change', () => {
  if (!st) return;
  const v = $('tplDate').value;
  if (!v) return;
  let d = toDayNum(v);
  if (dow(d) === 5 && !isDays()) d++;          // יום שישי ← השבת שאחריו
  st.autoGuessed = false;
  setDay(d);
  reinferAll();
  renderOcc(); renderSlots();
});

/**
 * היום של אזור תפילה להסקת הכלל: הזמנים המחושבים (כשתאריך הלוח ידוע, ואם לא – משוערים לפי st.approx)
 * והזמנים שמודפסים בלוח לאותו יום
 */
function ruleCtx(s) {
  const printed = printedTimes(st.slots)[s.when];
  if (isDays()) {
    const c = colOf(s.when);
    const d = c.day != null ? c.day : st.approx != null ? st.approx + c.dow : null;
    return { when: 'כל יום', times: d != null ? timesFor(st.cfg, d) : null, printed, approx: c.day == null };
  }
  const at = st.day != null ? st.day : st.approx;
  return { when: s.when, times: at != null ? timesFor(st.cfg, s.when === 'כניסה' ? at - 1 : at) : null, printed, approx: st.day == null };
}

/** האפשרויות לכלל של האזור לפי השעה בקובץ, היום והמתי */
function ruleOpts(s) {
  const m = oldMinutes(s);
  return s.kind === 'rule' && m != null ? ruleOptions(m, ruleCtx(s), st.cfg.tz, s.name) : null;
}

/** חישוב מחדש של הכלל לפי השעה בקובץ, היום והמתי */
function reinfer(s) {
  const options = ruleOpts(s);
  if (!options) return;
  s.options = options;
  // בלי תאריך ובלי זמנים מודפסים יש רק "שעה קבועה" – לא דורסים כלל שהמשתמש הגדיר
  if (options.length > 1 || st.day != null) Object.assign(s, pickRule(options[0]));
}

/** כל האזורים מחדש, ובלוח ימי חול – כלל אחד לתפילה שמופיעה בכמה ימים */
function reinferAll() {
  st.slots.forEach(reinfer);
  if (!isDays()) return;
  // agreeRules בודק כל כלל מועמד מול כל אזור – היום של כל אזור מחושב פעם אחת
  const ctxs = new Map();
  agreeRules(st.slots, s => { if (!ctxs.has(s.when)) ctxs.set(s.when, ruleCtx(s)); return ctxs.get(s.when); }, st.cfg.tz);
}

const pickRule = o => ({ base: o.base, offset: o.offset, round: o.round });
const sameRule = (a, b) => a.base === b.base && String(a.offset) === String(b.offset) && a.round === b.round;

/** תיאור קצר של כלל: "15 דק׳ לפני שקיעה", "בשעה 08:00" */
function ruleText(r) {
  if (r.base === 'שעה קבועה') return 'בשעה ' + (r.offset || '');
  const n = parseInt(r.offset, 10) || 0;
  return (n ? Math.abs(n) + ' דק׳ ' + (n < 0 ? 'לפני ' : 'אחרי ') : '') + r.base + (r.round && r.round !== 'ללא' ? ', עיגול ' + r.round : '');
}

/* ---------- האזורים על העמוד ---------- */

const pct = (v, total) => (v / total * 100).toFixed(3) + '%';
function boxStyle(b) {
  return 'right:' + pct(st.W - b.x - b.w, st.W) + ';top:' + pct(b.y, st.H) + ';width:' + pct(b.w, st.W) + ';height:' + pct(b.h, st.H);
}

/** מספור האזורים לפי מיקומם בעמוד (שורה עליונה למטה, בכל שורה מימין לשמאל) ולא לפי סדר ההוספה */
function slotRanks() {
  const items = st.slots.map((s, i) => ({ i, x: s.box.x, y: s.box.y, h: s.box.h }));
  items.sort((a, b) => a.y - b.y);
  const rows = [];
  items.forEach(it => {
    const row = rows.find(r => Math.abs(r.y - it.y) <= it.h * 0.6);
    if (row) { row.items.push(it); row.y = (row.y * (row.items.length - 1) + it.y) / row.items.length; }
    else rows.push({ y: it.y, items: [it] });
  });
  rows.sort((a, b) => a.y - b.y);
  const ranks = [];
  let n = 0;
  rows.forEach(r => { r.items.sort((a, b) => b.x - a.x); r.items.forEach(it => { ranks[it.i] = ++n; }); });
  return ranks;
}

function unionBox(a, b) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

function renderBoxes() {
  const ranks = slotRanks();
  let h = '';
  const same = (a, b) => a && a.x === b.x && a.y === b.y;
  st.candidates.forEach((c, i) => {
    if (st.slots.some(s => same(s.box, c.box) || same(s.labelBox, c.box) || covers(s.box, c.box))) return;
    h += '<button type="button" class="tb cand" data-c="' + i + '" style="' + boxStyle(c.box) + '" title="' + esc(c.old) + '" aria-label="הוספת אזור: ' + esc(c.old) + '"></button>';
  });
  st.slots.forEach((s, i) => {
    // שעה עם השם שלידה: מסגרת אחת לשניהם, ובתוכה מסומן המקום שבו תיכתב השעה החדשה
    const lb = (s.kind === 'rule' || s.kind === 'zman') && s.labelBox;
    const outer = lb ? unionBox(s.box, lb) : s.box;
    h += '<button type="button" class="tb slot" data-s="' + i + '" style="' + boxStyle(outer) + '" aria-label="אזור ' + ranks[i] + '"><span>' + ranks[i] + '</span></button>';
    if (lb) h += '<div class="tb val" style="' + boxStyle(s.box) + '"></div>';
  });
  const sel = st.slots[st.sel];
  if (sel && !st.drawing) {
    // ידיות למתיחת האזור הנבחר
    const b = sel.box, at = (right, top) => 'right:' + pct(right, st.W) + ';top:' + pct(top, st.H);
    for (const [edge, r, t, label] of [['r', st.W - b.x - b.w, b.y + b.h / 2, 'שמאל'], ['l', st.W - b.x, b.y + b.h / 2, 'ימין'],
      ['t', st.W - b.x - b.w / 2, b.y, 'למעלה'], ['b', st.W - b.x - b.w / 2, b.y + b.h, 'למטה']]) {
      h += '<div class="rh rh-' + edge + '" data-edge="' + edge + '" style="' + at(r, t) + '" title="מתיחת האזור ' + label + '"></div>';
    }
  }
  $('tplBoxes').innerHTML = h;
}

/** האם מרכז התיבה b נמצא בתוך a */
const covers = (a, b) => {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  return cx > a.x && cx < a.x + a.w && cy > a.y && cy < a.y + a.h;
};

/**
 * אזור של פרשה שנמתח על טקסט שלפניו ("לשבת", "זמני התפילות לשבת"): הטקסט המכוסה נשמר
 * כטקסט שלפני הפרשה ונכתב מחדש יחד איתה. nameBox – האזור לפני המתיחה הראשונה
 */
function stretchPrefix(s) {
  const edge = s.nameBox.x + s.nameBox.w - 2;
  const words = st.candidates.filter(c => covers(s.box, c.box) && c.box.x + c.box.w / 2 > edge)
    .sort((a, b) => b.box.x - a.box.x).map(c => c.old);
  const all = [...words, (s.autoPrefix || '').trim()].filter(Boolean);
  s.prefix = all.length ? all.join(' ') + ' ' : '';
}

const isTimeOffset = v => /^[-+]?\d+(?::\d+)?$/.test(String(v ?? '').trim());

/** "הקידוש נתרם ע"י", "קידוש:" –הטקסט הקבוע שלפני שם התורם, או null אם לא נמצא */
function kiddushPrefix(text) {
  const m = /^(.*?(?:נתרמ[הו]?|ע["״]י|על[\s-]ידי|בחסות|באדיבות)(?:\s+(?:ע["״]י|על[\s-]ידי))?)\s+\S/.exec(text) ||
    /^([^:]*קידוש[^:]*:)\s*\S/.exec(text);
  return m ? m[1].trim() + ' ' : null;
}

/** שתי תיבות טקסט של אותו קטע: באותה שורה זו ליד זו, או בשורות סמוכות זו מתחת לזו */
function sameBlock(a, b) {
  const size = Math.max(a.size || a.h * 0.72, b.size || b.h * 0.72);
  if (Math.abs((a.size || a.h) - (b.size || b.h)) > size * 0.2) return false;
  const dy = Math.abs(lineBase(a) - lineBase(b));
  const gap = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w);
  if (dy < size * 0.45) return gap < size * 1.5;
  const aligned = Math.abs(a.x + a.w / 2 - (b.x + b.w / 2)) < size * 1.5 || Math.abs(a.x + a.w - b.x - b.w) < size || Math.abs(a.x - b.x) < size;
  return dy < size * 1.8 && gap < 0 && aligned;
}
const lineBase = b => b.baseline ?? (b.y + b.h * 0.78);

/**
 * קידוש כמו בקובץ הישן: האזור מתרחב לשורות הסמוכות של אותו קטע (grow), מספר השורות, קו הבסיס
 * והריווח ביניהן נלקחים מהקובץ, והטקסט שלפני שם התורם ("הקידוש נתרם ע"י") נשמר כטקסט לפני הקידוש.
 * במסמך סרוק השורות נספרות לפי הפיקסלים שבאזור
 */
function fitKiddush(s, grow) {
  // האזור מותאם מחדש לטקסט שבקובץ – גם המראה נמדד מחדש
  delete s.style;
  const taken = c => st.slots.some(o => (o !== s && covers(o.box, c.box)) || (o.labelBox && covers(o.labelBox, c.box)));
  const parts = st.candidates.filter(c => covers(s.box, c.box) && !taken(c));
  for (let added = grow && parts.length > 0; added;) {
    added = false;
    for (const c of st.candidates) {
      if (parts.includes(c) || taken(c) || !parts.some(p => sameBlock(p.box, c.box))) continue;
      parts.push(c); added = true;
    }
  }
  let lines;
  if (parts.length) {
    lines = [];
    for (const c of parts.sort((a, b) => lineBase(a.box) - lineBase(b.box))) {
      const size = c.box.size || c.box.h * 0.72;
      const ln = lines.find(l => Math.abs(l.baseline - lineBase(c.box)) < Math.max(l.size, size) * 0.45);
      if (ln) ln.parts.push(c); else lines.push({ baseline: lineBase(c.box), size, parts: [c] });
    }
    const box = parts.reduce((b, c) => unionBox(b, c.box), parts[0].box);
    s.box = { ...s.box, ...box };
    // עברית: בכל שורה מימין לשמאל
    const text = lines.map(l => l.parts.sort((a, b) => b.box.x - a.box.x).map(c => c.old).join(' ')).join(' ');
    s.old = text;
    const pre = kiddushPrefix(text);
    if (pre) s.prefix = pre;
  } else {
    lines = inkLines(st.canvas, s.box).map(b => ({ size: (b.bottom - b.top + 1) * 0.95, baseline: b.top + (b.bottom - b.top + 1) * 0.8 }));
    if (!lines.length) return;
  }
  const n = lines.length, was = s.srcLines;
  s.srcLines = n;
  // השורות נכתבות סביב קו הבסיס האמצעי
  const size = lines.reduce((t, l) => t + l.size, 0) / n;
  s.box = { ...s.box, size, baseline: lines.reduce((t, l) => t + l.baseline, 0) / n };
  if (n < 2) { if (was > 1) s.wrap = false; return; }
  const gap = (lines[n - 1].baseline - lines[0].baseline) / (n - 1);
  const pct = gap / (size * 1.15) * 100;
  Object.assign(s, { wrap: true, lineCount: n, lineHeightPct: SIZES.reduce((a, b) => Math.abs(b - pct) < Math.abs(a - pct) ? b : a) });
  delete s.lines;
}

$('tplBoxes').addEventListener('click', e => {
  if (!st || st.drawing) return;
  const b = e.target.closest('.tb');
  if (!b) return;
  if (b.dataset.s != null) { focusSlot(+b.dataset.s); return; }
  const c = st.candidates[+b.dataset.c];
  st.slots.push({ box: c.box, kind: 'text', text: c.old, old: c.old });
  renderBoxes(); focusSlot(st.slots.length - 1);
});

function focusSlot(i) {
  const s = st.slots[i];
  if (!s) return;
  openSlots.add(s);
  st.sel = i;
  renderBoxes(); renderSlots();
  const ed = document.querySelector('.slot-ed[data-i="' + i + '"]');
  if (!ed) return;
  document.querySelectorAll('.slot-ed.sel').forEach(x => x.classList.remove('sel'));
  ed.classList.add('sel');
  ed.scrollIntoView({ behavior: 'smooth', block: 'center' });
  (ed.querySelector('[data-k="text"]') || ed.querySelector('select')).focus({ preventScroll: true });
}

/* סימון אזור חדש בגרירה (למסמך סרוק, או לטקסט שלא זוהה) */
$('tplDraw').onclick = () => {
  st.drawing = !st.drawing;
  $('tplDraw').setAttribute('aria-pressed', String(st.drawing));
  $('tplPage').classList.toggle('drawing', st.drawing);
};
let drag = null;
const toImg = (e) => {
  const r = $('tplPage').getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * st.W, y: (e.clientY - r.top) / r.height * st.H };
};
let resize = null;
$('tplPage').addEventListener('pointerdown', e => {
  const h = st && !st.drawing && e.target.closest('.rh');
  if (h) {
    e.preventDefault();
    $('tplPage').setPointerCapture(e.pointerId);
    const s = st.slots[st.sel];
    slotStyle(s);   // המראה נמדד לפני המתיחה, על הטקסט המקורי
    s.box = { ...s.box };   // אזור שנוצר מטקסט בדף חולק איתו את אותה תיבה
    if (!s.nameBox) { s.nameBox = { ...s.box }; s.autoPrefix = s.prefix || ''; }
    resize = { s, edge: h.dataset.edge };
    return;
  }
  if (!st || !st.drawing) return;
  e.preventDefault();
  $('tplPage').setPointerCapture(e.pointerId);
  drag = { start: toImg(e), el: document.createElement('div') };
  drag.el.className = 'tb slot drag';
  $('tplBoxes').appendChild(drag.el);
});
$('tplPage').addEventListener('pointermove', e => {
  if (resize) {
    const p = toImg(e), b = resize.s.box, MIN = 8;
    const r = b.x + b.w, bot = b.y + b.h;
    if (resize.edge === 'l') { b.x = Math.min(p.x, r - MIN); b.w = r - b.x; }
    if (resize.edge === 'r') b.w = Math.max(MIN, p.x - b.x);
    if (resize.edge === 't') { b.y = Math.min(p.y, bot - MIN); b.h = bot - b.y; }
    if (resize.edge === 'b') b.h = Math.max(MIN, p.y - b.y);
    renderBoxes();
    return;
  }
  if (!drag) return;
  const p = toImg(e), s = drag.start;
  drag.box = { x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) };
  drag.el.setAttribute('style', boxStyle(drag.box));
});
$('tplPage').addEventListener('pointerup', () => {
  if (resize) {
    const s = resize.s, b = s.box;
    resize = null;
    // קו הבסיס של הכתיבה נשאר, אלא אם האזור זז ממנו
    if (b.baseline != null && (b.baseline < b.y || b.baseline > b.y + b.h)) b.baseline = b.y + b.h * 0.78;
    if (s.kind === 'parasha' || s.kind === 'parashaName') stretchPrefix(s);
    if (s.kind === 'kiddush') { fitKiddush(s, false); schedulePreviewRefresh(); }
    renderBoxes(); renderSlots();
    return;
  }
  if (!drag) return;
  const b = drag.box;
  drag.el.remove(); drag = null;
  if (!b || b.w < 8 || b.h < 8) return;
  st.slots.push({ box: b, kind: 'rule', when: isDays() ? 'd0' : 'כל יום', name: '', base: 'שקיעה', offset: '0', round: 'ללא', old: '' });
  st.drawing = false;
  $('tplDraw').setAttribute('aria-pressed', 'false');
  $('tplPage').classList.remove('drawing');
  renderBoxes(); focusSlot(st.slots.length - 1);
});

/* ---------- רשימת האזורים ---------- */

function slotFields(s) {
  if (s.kind === 'text') {
    return '<div class="rgrid"><div class="wide"><label>הטקסט באזור</label><input data-k="text" dir="auto" value="' + esc(s.text) +
      '" placeholder="ריק – האזור יימחק מהלוח"></div></div>';
  }
  if (s.kind === 'rule') {
    const fixed = s.base === 'שעה קבועה';
    return '<div class="rgrid">' +
      '<div class="wide"><label>שם</label><input data-k="name" value="' + esc(s.name) + '" placeholder="למשל: מנחה"></div>' +
      (isDays() ? dayChecks(s)
        : '<div><label>מתי</label><select data-k="when">' + opts(WHEN_LABELS, s.when) + '</select></div>') +
      '<div><label>לפי</label><select data-k="base">' + baseOpts(s) + '</select></div>' +
      (fixed
        ? '<div><label>שעה</label><input data-k="offset" dir="ltr" value="' + esc(s.offset) + '"></div>'
        : '<div><label>הפרש (דקות)</label><div class="offset-pair"><input data-k="offsetAbs" type="number" min="0" inputmode="numeric" dir="ltr" value="' +
          esc(offsetAbs(s)) + '" placeholder="20"><select data-k="offsetDir">' + opts(['אחרי', 'לפני'], offsetDir(s)) + '</select></div></div>') +
      '<div><label>עיגול</label><select data-k="round"' + (fixed ? ' disabled' : '') + '>' + opts(ROUND, s.round) + '</select></div>' +
      ruleChoices(s) + '</div>';
  }
  if (s.kind === 'kiddush') {
    return '<div class="rgrid">' +
      '<div class="wide"><label>שם</label><input data-k="name" value="' + esc(s.name) + '" placeholder="למשל: קידוש"></div>' +
      (isDays() ? dayChecks(s)
        : '<div><label>מתי</label><select data-k="when">' + opts(WHEN_LABELS, s.when) + '</select></div>') +
      '<div class="wide"><label>טקסט לפני הקידוש</label><input data-k="prefix" value="' + esc(s.prefix || '') +
      '" placeholder="למשל: הקידוש נתרם ע&quot;י"></div>' +
      '<div class="wide"><label>נוסח</label><input data-k="offset" dir="rtl" value="' + esc(s.offset) + '" placeholder="{שם}{לרגל}"></div></div>' +
      '<p class="hint">הטקסט יתמלא לפי מי שאושר לקידוש בתאריך הזה (מלוח הקידושים של הקהילה). ' +
      'אפשר להשתמש ב-{שם} (שם התורם), ב-{סיבה} (לרגל מה נתרם) וב-{לרגל} (מוסיף "לרגל ..." רק אם יש סיבה). ' +
      'בלי תאריך מאושר, האזור לא יתמלא. כשאין קידוש מאושר, התצוגה המקדימה כאן מציגה תורם לדוגמה ("משפחת ישראלי לרגל בר מצווה").</p>';
  }
  if (s.kind === 'parasha' || s.kind === 'parashaName') {
    return '<div class="rgrid"><div class="wide"><label>טקסט לפני הפרשה</label><input data-k="prefix" value="' + esc(s.prefix || '') +
      '" placeholder="למשל: לשבת"></div></div>';
  }
  if (s.kind === 'zman') {
    return '<div class="rgrid">' +
      '<div><label>איזה זמן</label><select data-k="zman">' + opts(ZMANIM, zmanLabel(s.zman)) + '</select></div>' +
      '<div><label>של איזה יום</label><select data-k="when">' + opts(isDays() ? dayOpts() : [['כניסה', 'ערב שבת/חג'], ['כל יום', 'שבת/חג'], ['יציאה', 'מוצאי שבת/חג']], s.when) + '</select></div></div>';
  }
  return '';
}

/**
 * הכללים שמסבירים את השעה שבקובץ (למשל "15 דק׳ לפני שקיעה" או "שעה קבועה"), לבחירה בלחיצה.
 * הכלל שנבחר ייקבע את השעה בשאר השבתות.
 */
function ruleChoices(s) {
  if (!s.options || s.options.length < 2) return '';
  return '<div class="wide"><label>כללים שמתאימים ל-' + esc(s.old) + ' בקובץ</label><div class="rule-opts">' +
    s.options.map((o, j) => '<button type="button" class="chip" data-opt="' + j + '" aria-pressed="' + sameRule(o, s) + '">' +
      esc(ruleText(o)) + (o.printed ? ' <small>(לפי הזמן שבלוח)</small>' : o.approx ? ' <small>(משוער)</small>' : '') + '</button>').join('') +
    '</div></div>';
}

/** גודל הטקסט, הדגשה, נטייה וריווח השורות באזור, בנפרד מהאזורים האחרים */
function sizeFields(s) {
  const sizeOpts = v => SIZES.map(n => '<option value="' + n + '"' + (n === (v || 100) ? ' selected' : '') + '>' + n + '%</option>').join('');
  const look = lookOf(s);
  const lookBtn = (k, text, label) => '<button type="button" class="chip look-' + k + '" data-look="' + k + '" aria-pressed="' + look[k] +
    '" title="' + label + '" aria-label="' + label + '">' + text + '</button>';
  return '<div class="rgrid"><div><label>גודל הטקסט באזור</label><select data-k="sizePct">' + sizeOpts(s.sizePct) + '</select></div>' +
    '<div><label>עיצוב הטקסט</label><div class="look-btns">' + lookBtn('bold', 'B', 'הדגשה') + lookBtn('italic', 'I', 'נטוי') + '</div></div>' +
    (s.wrap ? '<div><label>ריווח בין השורות</label><select data-k="lineHeightPct">' + sizeOpts(s.lineHeightPct) + '</select></div>' +
      '<div><label>מספר שורות</label><select data-k="lineCount">' +
      [2, 3, 4, 5, 6].map(n => '<option value="' + n + '"' + (n === (s.lineCount || 2) ? ' selected' : '') + '>' + n + '</option>').join('') +
      '</select></div>' : '') +
    '<div class="wide"><label class="check"><input type="checkbox" data-k="wrap"' + (s.wrap ? ' checked' : '') +
    '> לאפשר גלישה לכמה שורות אם הטקסט ארוך מדי</label></div>' +
    (s.wrap ? '<div class="wide wrap-lines">' + wrapLines(s) + '</div>' : '') + '</div>';
}

/**
 * תיבה לכל שורה, עם המילים של הטקסט שבתצוגה. לחיצה על מילה מעבירה אותה לשורה הבאה,
 * ומהשורה האחרונה – חזרה לראשונה. כל עוד כל המילים בשורה הראשונה, החלוקה נקבעת לפי האורך.
 */
function wrapLines(s) {
  const text = slotTexts.get(s);
  if (!text || !text.trim()) return '<p class="hint">המילים יופיעו כאן אחרי שהתצוגה תתעדכן.</p>';
  const words = text.trim().split(/\s+/), count = s.lineCount || 2;
  const box = n => '<div class="wrap-line"><span class="wrap-no">שורה ' + (n + 1) + '</span>' +
    words.map((w, i) => wordLine(s.lines, i, count) === n ? '<button type="button" class="chip" data-word="' + i + '">' + esc(w) + '</button>' : '').join('') + '</div>';
  return Array.from({ length: count }, (x, n) => box(n)).join('') + '<p class="hint">לחצו על מילה כדי להעביר אותה לשורה הבאה' +
    (words.some((w, i) => wordLine(s.lines, i, count)) ? '' : ' (כל עוד כל המילים בשורה הראשונה, הטקסט מתחלק לפי האורך)') + '.</p>';
}

/**
 * הימים שבהם שעה בלוח ימי חול חלה. s.when – היום שהערך שלו נכתב באזור;
 * s.days – כשהשעה חלה על כמה ימים ("ימים: א'-ה'"), כל הימים.
 */
const slotDays = s => (s.days && s.days.length ? s.days : [s.when]);

function dayChecks(s) {
  const on = new Set(slotDays(s));
  return '<div class="wide"><label>ימים</label><div class="day-checks">' + dayOpts().map(([k, n]) =>
    '<label class="check"><input type="checkbox" data-k="day" value="' + k + '"' + (on.has(k) ? ' checked' : '') + '> ' + esc(n) + '</label>').join('') +
    '</div></div>';
}

function daysLabel(s) {
  const d = slotDays(s);
  return d.length > 1 ? d.map(whenLabel).join(', ') : whenLabel(s.when);
}

/** תרגום "מתי" למילה בעברית: בלוח ימי חול s.when הוא מפתח (d0…d5) */
function whenLabel(w) {
  if (!isDays()) return w;
  const hit = dayOpts().find(([k]) => k === w);
  return hit ? hit[1] : w;
}

/** הכותרת לשורה הסגורה: שם התפילה, או סוג האזור לשאר הסוגים */
const slotLabel = s => (s.kind === 'rule' || s.kind === 'kiddush') ? (s.name || 'תפילה חדשה') : (KIND_LABEL[s.kind] || s.kind);

/** תקציר לשורה הסגורה: מתי ולפי מה, ומה היה בקובץ הישן */
function slotSum(s) {
  const parts = [];
  if (s.kind === 'rule') {
    parts.push(daysLabel(s), ruleText(s));
  } else if (s.kind === 'kiddush') {
    parts.push(daysLabel(s));
  } else if (s.kind === 'zman') {
    parts.push(zmanLabel(s.zman), whenLabel(s.when));
  } else if (s.kind === 'text' && s.text) {
    parts.push(s.text);
  }
  if (s.old) parts.push('בקובץ: ' + s.old + (s.label && s.kind !== 'rule' ? ' (' + s.label + ')' : ''));
  return parts.filter(Boolean).join(' · ');
}

function renderSlots() {
  // אזור שנוסף או הוסר משנה את הגופנים שכותבים בהם
  renderFontFill();
  if (!st.slots.length) {
    $('tplSlots').innerHTML = '<p class="hint">לא זוהו אזורים. ' + (st.scanned ? 'לחצו "סימון אזור" וגררו על כל שעה בדף.' : '') + '</p>';
    return;
  }
  const ranks = slotRanks();
  // מוצגים לפי המספור בעמוד; data-i שומר את האינדקס המקורי ב-st.slots
  const order = st.slots.map((s, i) => i).sort((a, b) => ranks[a] - ranks[b]);
  $('tplSlots').innerHTML = order.map(i => [st.slots[i], i]).map(([s, i]) =>
    '<details class="rule slot-ed" data-i="' + i + '"' + (openSlots.has(s) ? ' open' : '') + '>' +
    '<summary><span class="num">' + ranks[i] + '</span><b class="rule-name">' + esc(slotLabel(s)) + '</b>' +
    '<span class="rule-sum">' + esc(slotSum(s)) + '</span></summary>' +
    '<div class="slot-top"><select data-k="kind" aria-label="מה יופיע באזור ' + ranks[i] + '">' + opts(KINDS, s.kind) + '</select>' +
    '<button type="button" class="del" data-del="' + i + '">הסרה</button></div>' + slotFields(s) + sizeFields(s) + '</details>'
  ).join('') + specialHint();
}

/** הודעה כשאין בקובץ אזור לשם של שבת מיוחדת (זכור, נחמו…) */
function specialHint() {
  if (isChol() || st.slots.some(s => s.kind === 'special')) return '';
  const host = specialHost(st.slots);
  return '<p class="hint">' + (host
    ? 'אין בקובץ אזור לשבת מיוחדת: בשבתות כמו זכור או נחמו השם יתווסף ל' + (host === 'title' ? 'כותרת' : 'פרשה') +
      '. אפשר גם לסמן לו אזור משלו ("סימון אזור") ולבחור "שבת מיוחדת".'
    : 'אין בקובץ אזור לשבת מיוחדת או לכותרת, ולכן בשבתות כמו זכור או נחמו השם לא יופיע. ' +
      'כדי שיופיע, לחצו "סימון אזור", גררו על מקום פנוי ובחרו "שבת מיוחדת".') + '</p>';
}
$('tplSlots').addEventListener('toggle', e => {
  const s = st.slots[+e.target.getAttribute('data-i')];
  if (s) e.target.open ? openSlots.add(s) : openSlots.delete(s);
}, true);

$('tplSlots').addEventListener('input', e => {
  const ed = e.target.closest('.slot-ed'), k = e.target.dataset.k;
  if (!ed || !k) return;
  const s = st.slots[+ed.dataset.i], v = e.target.value;
  if (k === 'kind') {
    s.kind = v;
    const when0 = isDays() ? 'd0' : 'כל יום';
    if (v === 'rule' && !s.base) { Object.assign(s, { when: s.when || when0, name: s.label || '', base: 'שקיעה', offset: '0', round: 'ללא' }); reinfer(s); }
    if (v === 'kiddush' && !s.name) Object.assign(s, { when: s.when || when0, name: s.label || 'קידוש', offset: s.offset || '{שם}{לרגל}' });
    // הפרש או שעה שנשארו מתפילה ("0", "-20", "08:00") אינם נוסח של קידוש
    if (v === 'kiddush' && isTimeOffset(s.offset)) s.offset = '{שם}{לרגל}';
    if (v === 'kiddush') { fitKiddush(s, true); schedulePreviewRefresh(); }
    if (v === 'zman' && !s.zman) Object.assign(s, { zman: 'sunset', when: s.when || when0 });
    if (v === 'gregDate' && !s.fmt) s.fmt = { sep: '/', year: 4, pad: false };
    if (v === 'text' && s.text == null) s.text = s.old || '';
    focusSlot(+ed.dataset.i); return;
  }
  if (k === 'sizePct' || k === 'lineHeightPct') { s[k] = Number(v); schedulePreviewRefresh(); return; }
  if (k === 'lineCount') { s.lineCount = Number(v); ed.querySelector('.wrap-lines').innerHTML = wrapLines(s); schedulePreviewRefresh(); return; }
  if (k === 'wrap') { s.wrap = e.target.checked; renderSlots(); schedulePreviewRefresh(); return; }
  if (k === 'day') {
    const keys = [...ed.querySelectorAll('input[data-k="day"]:checked')].map(x => x.value);
    // לפחות יום אחד
    if (!keys.length) { e.target.checked = true; return; }
    if (keys.length > 1) s.days = keys; else delete s.days;
    const when = keys[0];
    if (when !== s.when) { s.when = when; if (s.kind === 'rule') reinfer(s); }
    renderSlots(); return;
  }
  if (k === 'zman') s.zman = zmanKey(v);
  else if (k === 'offsetAbs' || k === 'offsetDir') {
    const abs = k === 'offsetAbs' ? v.replace(/[^0-9]/g, '') : offsetAbs(s);
    const dir = k === 'offsetDir' ? v : offsetDir(s);
    s.offset = abs === '' ? '' : String(dir === 'לפני' ? -Math.abs(+abs) : +abs);
    // המשתמש קבע הפרש בעצמו – הצעות הכללים כבר לא רלוונטיות. מסירים רק אותן, בלי לרנדר מחדש, כדי לא לאבד את המיקוד בשדה
    if (s.options) {
      delete s.options;
      const chips = ed.querySelector('.rule-opts');
      if (chips) chips.parentElement.remove();
    }
  } else s[k] = v;
  if (k === 'when' && s.kind === 'rule') { reinfer(s); renderSlots(); return; }
  if (k === 'base') {
    if (v === 'שעה קבועה' && s.offset.indexOf(':') < 0) s.offset = s.old && s.old.includes(':') ? s.old : '08:00';
    if (v !== 'שעה קבועה' && s.offset.indexOf(':') >= 0) s.offset = '0';
    renderSlots(); return;
  }
  ed.querySelector('.rule-name').textContent = slotLabel(s);
  ed.querySelector('.rule-sum').textContent = slotSum(s);
  // הטקסט השתנה – המילים בתיבות השורות מתעדכנות עם התצוגה. בקידוש רואים מיד את הנוסח החדש
  if (s.wrap || s.kind === 'kiddush') schedulePreviewRefresh();
});
$('tplSlots').addEventListener('click', async e => {
  const lookBtn = e.target.closest('[data-look]');
  if (lookBtn) {
    const s = st.slots[+lookBtn.closest('.slot-ed').dataset.i], k = lookBtn.dataset.look;
    s[k] = !lookOf(s)[k];
    lookBtn.setAttribute('aria-pressed', String(s[k]));
    schedulePreviewRefresh();
    return;
  }
  const word = e.target.closest('[data-word]');
  if (word) {
    const s = st.slots[+word.closest('.slot-ed').dataset.i], i = +word.dataset.word;
    const n = slotTexts.get(s).trim().split(/\s+/).length;
    const count = s.lineCount || 2;
    const lines = Array.from({ length: n }, (x, j) => wordLine(s.lines, j, count));
    lines[i] = (lines[i] + 1) % count;
    s.lines = lines;
    word.closest('.wrap-lines').innerHTML = wrapLines(s);
    schedulePreviewRefresh();
    return;
  }
  const opt = e.target.closest('[data-opt]');
  if (opt) {
    const s = st.slots[+opt.closest('.slot-ed').dataset.i];
    Object.assign(s, pickRule(s.options[+opt.dataset.opt]));
    renderSlots();
    return;
  }
  const i = e.target.dataset.del;
  if (i == null) return;
  if (!await SiteDialog.confirm('להסיר את האזור מהתבנית?', { ok: 'הסרה', danger: true })) return;
  st.slots.splice(+i, 1);
  st.sel = null;
  renderBoxes(); renderSlots();
});

/* ---------- שמירה ---------- */

/** הכללים מהאזורים, כרשימת כללים להגדרות */
function slotRules() {
  return isDays() ? daySlotRules() : holySlotRules();
}

function holySlotRules() {
  const seen = new Set(), out = [];
  for (const s of st.slots) {
    if ((s.kind !== 'rule' && s.kind !== 'kiddush') || !String(s.name).trim()) continue;
    const key = s.when + '|' + s.name.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    const kd = s.kind === 'kiddush';
    out.push({ name: s.name.trim(), when: s.when, applies: 'שבת וחג', base: kd ? KIDDUSH_LABEL : s.base, offset: s.offset, round: kd ? 'ללא' : s.round });
  }
  return out;
}

/**
 * בלוח של ימי חול: אזורים של אותה תפילה עם אותו כלל מתאחדים לכלל אחד,
 * ו"חל על" נבחר לפי הימים שבהם הם מופיעים (כל הימים, א׳–ה׳ וכו'), או כלל לכל יום.
 */
function daySlotRules() {
  const cols = st.period ? st.period.days : [0, 1, 2, 3, 4, 5].map(i => colOf('d' + i));
  const groups = new Map();
  for (const s of st.slots) {
    const name = String(s.name || '').trim();
    if ((s.kind !== 'rule' && s.kind !== 'kiddush') || !name) continue;
    const kd = s.kind === 'kiddush';
    const base = kd ? KIDDUSH_LABEL : s.base, round = kd ? 'ללא' : s.round;
    const k = [name, base, s.offset, round].join('|');
    if (!groups.has(k)) groups.set(k, { name, base, offset: s.offset, round, keys: new Set(), byDays: false });
    for (const d of slotDays(s)) groups.get(k).keys.add(colOf(d).key);
    if (s.days) groups.get(k).byDays = true;
  }
  const out = [];
  for (const g of groups.values()) {
    const want = cols.filter(c => g.keys.has(c.key)).map(c => c.key).join();
    // ימים שנכתבו במפורש בלוח ("ימים: א'-ה'"): קודם לפי הימים בשבוע, ולא לפי ערב שבת וחג
    const order = g.byDays ? ['כל הימים', 'א׳–ה׳', 'ב׳ וה׳'] : DAY_APPLIES.slice(0, 5);
    const applies = order.find(a => cols.filter(c => appliesOnDay(a, c)).map(c => c.key).join() === want);
    const rule = a => ({ name: g.name, when: 'כל יום', applies: a, base: g.base, offset: g.offset, round: g.round });
    if (applies) out.push(rule(applies));
    else for (const key of g.keys) out.push(rule(DOW_LABELS[colOf(key).dow]));
  }
  return out;
}

/**
 * מיזוג הכללים מהתבנית עם ההגדרות: replace=true מחליף את כולם, אחרת רק מוסיף חסרים.
 * בשבת/חג תפילה מזוהה לפי שם ומתי, ובימי חול לפי שם וחל על.
 */
export function mergeRules(rules, fromTpl, replace, kind) {
  if (replace) return fromTpl.map(r => ({ ...r }));
  const same = kind === 'days' ? (a, b) => a.name === b.name && a.applies === b.applies : (a, b) => a.name === b.name && a.when === b.when;
  const out = rules.map(r => ({ ...r }));
  for (const r of fromTpl) if (!out.some(x => same(x, r))) out.push({ ...r });
  return out;
}

/** האזורים כפי שנשמרים בתבנית, באותו סדר כמו st.slots (לפני סינון תפילות בלי שם) */
function builtSlots() {
  return st.slots.map(s => {
    const c = { box: s.box, kind: s.kind, old: s.old || '' };
    if (s.labelBox) Object.assign(c, { labelBox: s.labelBox, labelStyle: analyzeSlot(st.canvas, s.labelBox), ...(s.label ? { label: s.label } : {}) });
    if ((s.kind === 'parasha' || s.kind === 'parashaName' || s.kind === 'kiddush') && s.prefix && s.prefix.trim()) c.prefix = s.prefix.trim() + ' ';
    if (s.kind === 'rule' || s.kind === 'kiddush') Object.assign(c, { name: String(s.name).trim(), when: s.when, ...(s.days ? { days: s.days } : {}) });
    if (s.kind === 'zman') Object.assign(c, { zman: s.zman, when: s.when });
    if (s.kind === 'hebDate') Object.assign(c, { ascii: !!s.ascii, noYear: !!s.noYear, ...(s.hei ? { hei: true } : {}) });
    if (s.kind === 'gregDate') c.fmt = s.fmt;
    if (s.kind === 'text') c.text = String(s.text ?? '').trim();
    c.sizePct = s.sizePct || 100;
    // הדגשה ונטייה נשמרות רק כשהגבאי בחר בהן. בלי בחירה – כמו בקובץ
    if (s.bold != null) c.bold = s.bold;
    if (s.italic != null) c.italic = s.italic;
    c.wrap = !!s.wrap;
    if (c.wrap) {
      c.lineHeightPct = s.lineHeightPct || 100;
      c.lineCount = s.lineCount || 2;
      if (s.srcLines > 1) c.srcLines = s.srcLines;
      if (s.lines && s.lines.some(Boolean)) c.lines = s.lines;
    }
    c.style = slotStyle(s);
    return c;
  });
}

/** מספר השימושים בכל גופן, והגופן הנפוץ בשעות – שבו נכתב אזור שסומן ידנית */
function fontUse(slots) {
  const count = {};
  for (const s of slots) if (s.box.font && st.fonts[s.box.font]) count[s.box.font] = (count[s.box.font] || 0) + (s.kind === 'rule' || s.kind === 'kiddush' || s.kind === 'zman' ? 2 : 1);
  return { count, mainFont: Object.keys(count).sort((a, b) => count[b] - count[a])[0] || null };
}

/** ההדגשה והנטייה שבהן האזור ייכתב, כמו בציור */
function lookOf(s) {
  const f = st.fonts[s.box.font] || st.fonts[fontUse(st.slots).mainFont];
  return slotLook(s, f, slotStyle(s));
}

/**
 * צבע הרקע, צבע הטקסט והעובי של אזור. בטקסט שזוהה בקובץ (box.size) הם נמדדים פעם אחת, על הטקסט המקורי:
 * עובי הקו נמדד ביחס לגובה האזור, וכותרת שמותחים או מכווצים לא צריכה לאבד את ההדגשה או לקבל צבע אחר
 */
function slotStyle(s) {
  if (!s.box.size) return analyzeSlot(st.canvas, s.box);
  if (!s.style) s.style = analyzeSlot(st.canvas, s.box);
  return s.style;
}

function buildTemplate(built = builtSlots()) {
  const slots = built.filter(s => (s.kind !== 'rule' && s.kind !== 'kiddush') || s.name);
  // רק הגופנים שבשימוש נשמרים – גם של השם שליד השעה, שנכתב מחדש כשמשנים את גודל האזור
  const { count, mainFont } = fontUse(slots);
  const used = new Set([...Object.keys(count), ...slots.map(s => s.labelBox && s.labelBox.font).filter(k => k && st.fonts[k])]);
  const fonts = Object.fromEntries([...used].map(k => [k, st.fonts[k]]));
  return { enabled: true, name: st.name, day: st.day, image: st.canvas.toDataURL('image/jpeg', 0.88),
    slots, candidates: st.candidates, fonts, mainFont };
}

async function renderTemplatePreview() {
  const built = builtSlots(), tpl = buildTemplate(built);
  const cfg = { ...st.cfg, rules: mergeRules(st.cfg.rules, slotRules(), $('tplRules').checked, st.tpl.kind) };
  const today = todayIn(cfg.tz);
  const occ = periodFor(st.cfgAll, st.tpl, today) || findPeriod(st.tpl.kind, today, cfg.il);
  // בעורך רואים איך הקידוש ייראה גם בלי קידוש מאושר לתאריך – עם תורם לדוגמה. בלוח עצמו אין דוגמה
  const kd = { get: k => (kiddush && kiddush.get(k)) || SAMPLE_KIDDUSH };
  const values = occ.mode === 'days' ? buildDaysLuach(cfg, occ, kd).values : buildLuach(cfg, occ, kd).values;
  const canvas = await templateCanvas(tpl, values);
  const host = specialHost(tpl.slots);
  slotTexts = new WeakMap(st.slots.map((s, i) => [s, slotText(built[i], values, host) ?? '']));
  // המילים בתיבות השורות לפי הטקסט החדש, בלי לבנות מחדש את כל הרשימה
  for (const el of $('tplSlots').querySelectorAll('.wrap-lines')) {
    const s = st.slots[+el.closest('.slot-ed').dataset.i];
    if (s) el.innerHTML = wrapLines(s);
  }
  $('tplPreviewTitle').textContent = 'תצוגה מקדימה – ' + occ.title;
  $('tplPreviewImg').src = canvas.toDataURL('image/png');
  return canvas;
}

$('tplPreview').onclick = async () => {
  await renderTemplatePreview();
  $('tplPreviewWrap').hidden = false;
  $('tplPreviewWrap').scrollIntoView({ behavior: 'smooth' });
};

/* שינוי גודל טקסט מצויר מיד על העמוד שבעורך (ובתצוגה המקדימה), בלי לחכות לשמירה */
let previewTimer, previewSeq = 0;
function schedulePreviewRefresh() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    const seq = ++previewSeq, cur = st;
    const canvas = await renderTemplatePreview();
    if (seq === previewSeq && cur === st) $('tplImg').src = canvas.toDataURL('image/png');
  }, 200);
}

$('tplSave').onclick = () => {
  const bad = st.slots.find(s => (s.kind === 'rule' || s.kind === 'kiddush') && !String(s.name).trim());
  if (bad) { focusSlot(st.slots.indexOf(bad)); SiteDialog.alert('יש אזור של תפילה בלי שם. כתבו שם או הסירו את האזור.'); return; }
  close({ tpl: st.tpl, template: buildTemplate(), rules: slotRules(), replace: $('tplRules').checked, detected: st.detected });
};
$('tplCancel').onclick = async () => {
  if (!await SiteDialog.confirm('לבטל את עיצוב התבנית? השינויים לא יישמרו.', { ok: 'ביטול העיצוב', cancel: 'המשך עריכה', danger: true })) return;
  close(null);
};
