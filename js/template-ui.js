/** עורך התבנית: פתיחה וסגירה (חלק מ-js/template-ui.js שפוצל) */

import { BASES, appliesOnDay, designOf } from './config.js';
import { readFile, tokenize, detectDate, detectHebDate, detectShulAddress, suggestSlots, textCandidates, punctuationMarks, approxStart, guessOldDay } from './template-read.js';
import { refineBox } from './template-render.js';
import { toYmd } from './dates.js';
import { $, setSt, kiddush, isDays, st, colOf, setDay } from './template-state.js';
import { renderOcc, ruleOpts } from './template-rules.js';
import { renderBoxes } from './template-boxes.js';
import { setMoving } from './template-move.js';
import { renderSlots } from './template-slots.js';
import { schedulePreviewRefresh } from './template-build.js';

export { setKiddush } from './template-state.js';
export { mergeRules } from './template-build.js';

/** פתיחת העורך מקובץ חדש, לתבנית tpl */
export async function editFromFile(file, cfgAll, tpl, onDone, onStatus) {
  openRead(await readFile(file, onStatus), file.name, cfgAll, tpl, onDone);
}

/**
 * פתיחת העורך מלוח של המערכת (luachTextCanvas ב-image.js), כדי לערוך אותו כמו לוח שהועלה.
 * day – היום של הלוח. השעות בו מחושבות מזמני התפילות של התבנית, ולכן הכללים נשארים כמו שהם
 */
export function editFromBoard(read, name, cfgAll, tpl, onDone, day) {
  openRead(read, name, cfgAll, tpl, onDone, day);
}

function openRead({ canvas, items, fonts, docDayNum }, name, cfgAll, tpl, onDone, day = null) {
  const tokens = tokenize(items);
  const cfg = { ...cfgAll, rules: tpl.rules };
  const fit = x => ({ ...x, box: refineBox(canvas, x.box), ...(x.labelBox ? { labelBox: refineBox(canvas, x.labelBox) } : {}) });
  setSt({ canvas, W: canvas.width, H: canvas.height, cfg, cfgAll, tpl, name, onDone, fonts,
    candidates: textCandidates(tokens, items).map(fit), marks: punctuationMarks(tokens, items), scanned: !items.length, detected: detectShulAddress(tokens) });
  setDay(day ?? detectDate(tokens, docDayNum));
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
  if (day != null) keepRules();
  open();
}

/** אזורי התפילות לפי ההגדרה הנוכחית שלהן בתבנית, עם החלופות לכל כלל */
function keepRules() {
  const cfg = st.cfg;
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
}

/** פתיחת העורך לעיצוב הקיים של התבנית tplObj */
export async function editExisting(tplObj, cfgAll, onDone) {
  const tpl = designOf(cfgAll, tplObj), cfg = { ...cfgAll, rules: tplObj.rules };
  const img = new Image();
  await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; img.src = tpl.image; });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  setSt({ canvas, W: canvas.width, H: canvas.height, cfg, cfgAll, tpl: tplObj, name: tpl.name, onDone,
    // גם הגופנים שבקובץ שלא היו בשימוש בשמירה הקודמת – כדי שאפשר יהיה לבחור בהם שוב
    fonts: { ...(tpl.spareFonts || {}), ...(tpl.fonts || {}) },
    slots: JSON.parse(JSON.stringify(tpl.slots)), candidates: tpl.candidates || [], scanned: !(tpl.candidates || []).length });
  setDay(tpl.day ?? null);
  st.approx = approxStart(st.slots, cfg, isDays());
  keepRules();
  open();
}

export function open() {
  $('tplTitle').textContent = 'עריכת הלוח – ' + st.tpl.name;
  $('tplDateLabel').textContent = isDays() ? 'תאריך מתוך הלוח הישן' : 'תאריך הלוח הישן';
  $('tplImg').src = st.canvas.toDataURL('image/png');
  $('tplImg').style.aspectRatio = st.W + ' / ' + st.H;
  $('tplDate').value = st.day != null ? toYmd(st.day) : '';
  $('tplScanHint').hidden = !st.scanned;
  $('tplPreviewWrap').hidden = true;
  st.drawing = false;
  $('tplDraw').setAttribute('aria-pressed', 'false');
  setMoving(false);
  renderOcc(); renderBoxes(); renderSlots();
  // העמוד שבעורך מוצג כמו שיודפס, עם אירוע לדוגמה (קידוש וכו')
  schedulePreviewRefresh();
  window.scrollTo(0, 0);
}

/* ---------- השלמת אותיות חסרות בגופן מהקובץ ---------- */

export function close(result) {
  const done = st.onDone;
  setSt(null);
  done(result);
}

/* ---------- תאריך הלוח הישן ---------- */

