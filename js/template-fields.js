/** שדות העריכה של כל אזור בעורך התבנית (חלק מ-js/template-ui.js שפוצל) */

import { WHEN_LABELS, ROUND, SIZES } from './config.js';
import { esc } from './render.js';
import { fontLabel } from './font-fill.js';
import { FORMAT_BTNS } from './text-edit.js';
import { ZMANIM, zmanLabel, opts, baseOpts, kiddush, offsetAbs, offsetDir, isDays, dayOpts, st, slotTexts } from './template-state.js';
import { sameRule, ruleText } from './template-rules.js';
import { lineEdit, lineWords, weekLabel, lineEditor, dayChecks } from './template-lines.js';
import { fontUse, lookOf } from './template-build.js';

/**
 * בחירת הגופן של האזור מבין הגופנים שבקובץ, כשיש בו יותר מגופן אחד.
 * ברירת המחדל – הגופן של הטקסט שהיה באזור (או הגופן הנפוץ, באזור שסומן על מקום ריק)
 */
function fontField(s) {
  const seen = new Set(), opts = [];
  for (const [k, f] of Object.entries(st.fonts || {})) {
    const label = fontLabel(f) + (f.bold ? ' (מודגש)' : '') + (f.italic ? ' (נטוי)' : '');
    if (seen.has(label) && k !== s.box.font) continue;
    seen.add(label);
    opts.push([k, label]);
  }
  if (opts.length < 2) return '';
  const cur = s.box.font && st.fonts[s.box.font] ? s.box.font : fontUse(st.slots).mainFont;
  return '<div class="wide"><label>הגופן</label><select data-k="font">' +
    opts.map(([k, label]) => '<option value="' + esc(k) + '"' + (k === cur ? ' selected' : '') + '>' + esc(label) + '</option>').join('') +
    '</select></div>';
}

export function slotFields(s) {
  if (s.kind === 'erase') {
    return '<p class="hint">הטקסט שבאזור יימחק מהלוח, והשורות שסביבו יתרווחו מחדש: המקום שהתפנה מתחלק בין הרווחים ' +
      'שבין השורות (עד הקו המפריד הקרוב, או בכל העמוד), כל רווח לפי הגודל שלו.</p>';
  }
  if (s.kind === 'text') {
    return '<div class="rgrid"><div class="wide"><label>הטקסט באזור (שורה חדשה – ירידת שורה)</label>' +
      '<div class="fmt-bar">' + FORMAT_BTNS + '<span class="muted small">סמנו מילים בטקסט ולחצו – הדגשה, נטייה או קו תחתון</span></div><textarea data-k="text" dir="auto" rows="' +
      Math.min(6, Math.max(1, String(s.text || '').split('\n').length)) + '" placeholder="ריק – האזור יימחק מהלוח">' + esc(s.text) + '</textarea></div>' +
      fontField(s) + '</div>';
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
      '</div>' +
      '<p class="hint">האזור יתמלא בהודעה בנוסח שהגבאי קבע בלוח הקידושים של הקהילה – השורה הראשונה, "ע״י", ' +
      'בעל הקידוש והסיבה – לפי מי שאושר לקידוש בתאריך הזה. בלי קידוש מאושר, האזור לא יתמלא. ' +
      'כאן בעורך, כשאין קידוש מאושר, מוצג קידוש לדוגמה.</p>';
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

/** הרווחים לפני פסקה ואחריה, באחוזים מגובה הטקסט */
const SPACES = [[0, 'ללא'], [25, 'רבע שורה'], [50, 'חצי שורה'], [75, '¾ שורה'], [100, 'שורה'], [150, 'שורה וחצי'], [200, 'שתי שורות']];

/**
 * הפסקה של האזור: צירוף לפסקה של האזור שלפניו בעמוד, והרווח לפני הפסקה ואחריה.
 * הרווח לפני נקבע באזור הראשון בפסקה, והרווח אחרי – באחרון. order – סדר האזורים בעמוד (אינדקסים ב-st.slots)
 */
export function paraFields(s, i, order, ranks) {
  const pos = order.indexOf(i), prev = order[pos - 1], next = st.slots[order[pos + 1]];
  const joined = !!s.joinPrev && prev != null;
  // האזורים שבפסקה: מהראשון (שלא מצורף לקודם) עד האחרון (שהבא אחריו לא מצורף אליו)
  let a = pos, z = pos;
  while (a > 0 && st.slots[order[a]].joinPrev) a--;
  while (z < order.length - 1 && st.slots[order[z + 1]].joinPrev) z++;
  const spaceOpts = v => '<option value=""' + (v == null ? ' selected' : '') + '>אוטומטי</option>' +
    SPACES.map(([n, t]) => '<option value="' + n + '"' + (n === v ? ' selected' : '') + '>' + t + '</option>').join('');
  const where = a === z ? '' : ' (הפסקה: אזורים ' + ranks[order[a]] + '–' + ranks[order[z]] + ')';
  return '<div class="rgrid">' +
    (prev != null ? '<div class="wide"><label class="check"><input type="checkbox" data-k="joinPrev"' + (joined ? ' checked' : '') +
      '> באותה פסקה עם האזור שלפניו (' + ranks[prev] + ')</label></div>' : '') +
    (joined ? '' : '<div><label>רווח לפני הפסקה' + where + '</label><select data-k="spaceBefore">' + spaceOpts(s.spaceBefore) + '</select></div>') +
    (next && next.joinPrev ? '' : '<div><label>רווח אחרי הפסקה' + where + '</label><select data-k="spaceAfter">' + spaceOpts(s.spaceAfter) + '</select></div>') +
    '<p class="hint wide">הרווח נמדד מהשורה הסמוכה, ביחס לגובה הטקסט. אוטומטי – כמו בקובץ (טקסט של כמה שורות מקבל רווח מעט גדול מהרווח שבין שורותיו). ' +
    'כדי לצרף לפסקה שורה שאין בה זמן, לחצו עליה בדף והיא תהפוך לאזור של טקסט קבוע.</p></div>';
}

/** גודל הטקסט, הדגשה, נטייה וריווח השורות באזור, בנפרד מהאזורים האחרים */
export function sizeFields(s) {
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
export function wrapLines(s) {
  const text = slotTexts.get(s);
  if (!text || !text.trim()) return '<p class="hint">המילים יופיעו כאן אחרי שהתצוגה תתעדכן.</p>';
  const { words, lines, own, fixed, count } = lineWords(s);
  const box = n => lineEdit && lineEdit.s === s && lineEdit.n === n ? lineEditor(s, n) :
    '<div class="wrap-line"><span class="wrap-no">שורה ' + (n + 1) + '</span>' +
    words.map((w, i) => lines[i] !== n ? '' : fixed ? '<span class="chip">' + esc(w) + '</span>'
      : '<button type="button" class="chip" data-word="' + i + '">' + esc(w) + '</button>').join('') +
    '<button type="button" class="wrap-edit" data-edit-line="' + n + '" title="עריכת הנוסח בשורה ' + (n + 1) +
    '" aria-label="עריכת הנוסח בשורה ' + (n + 1) + '">✎</button></div>';
  const week = st.weekShown ? ' (' + esc(weekLabel(st.weekShown)) + ')' : '';
  return Array.from({ length: count }, (x, n) => box(n)).join('') + '<p class="hint">' +
    (own ? 'הנוסח נערך במיוחד לשבוע שבתצוגה' + week + ', והשורות בו לפי העריכה. ' +
      '<button type="button" class="linkish" data-week-reset>ביטול העריכה לשבוע הזה</button>'
      : fixed ? 'השורות כמו בהודעה בלוח הקידושים: הכותרת, "ע״י" ובעל הקידוש, והסיבה.'
      : 'לחצו על מילה כדי להעביר אותה לשורה הבאה' +
        (lines.some(Boolean) ? '' : ' (כל עוד כל המילים בשורה הראשונה, הטקסט מתחלק לפי האורך)') + '.') +
    ' לשינוי הנוסח עצמו – לחצו על ✎ שבצד השורה.' +
    (s.rewords && s.rewords.length ? ' <button type="button" class="linkish" data-reword-reset>חזרה לנוסח המקורי בכל השבועות</button>' : '') + '</p>';
}

