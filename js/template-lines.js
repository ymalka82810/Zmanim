/** עריכת נוסח שורות ושבועות בעורך התבנית (חלק מ-js/template-ui.js שפוצל) */

import { specialHost, slotText, wordLine, slotKey } from './template-render.js';
import { findPeriod, periodFor } from './luach.js';
import { toYmd, todayIn } from './dates.js';
import { esc } from './render.js';
import { KIND_LABEL, zmanLabel, kiddush, isDays, dayOpts, st, slotTexts, slotEdited } from './template-state.js';
import { ruleText } from './template-rules.js';
import { builtSlots, refreshWrapLines, schedulePreviewRefresh } from './template-build.js';

export let lineEdit = null;   // { s, n } – השורה שהנוסח שלה נערך כרגע
export function setLineEdit(v) { lineEdit = v; }

/**
 * המילים שבתצוגה, השורה של כל אחת ומספר השורות. השורות נקבעות לפי ירידות השורה שבטקסט (fixed) כשהנוסח נערך
 * לשבוע שבתצוגה (own), ובהודעה מלוח הקידושים – הכותרת / ע״י ובעל הקידוש / הסיבה, בכל שבוע לפי אורך השמות שבו.
 * אחרת – לפי המילים שהגבאי העביר בין השורות (s.lines)
 */
export function lineWords(s) {
  const text = (slotTexts.get(s) || '').trim();
  if (text.includes('\n')) {
    const words = [], lines = [], rows = text.split('\n').filter(ln => ln.trim());
    rows.forEach((ln, n) => ln.trim().split(/\s+/).forEach(w => { words.push(w); lines.push(n); }));
    const own = slotEdited.has(s);
    return { words, lines, count: own ? Math.max(s.lineCount || 2, rows.length) : rows.length, own, fixed: true };
  }
  const words = text ? text.split(/\s+/) : [], count = s.lineCount || 2;
  return { words, lines: words.map((w, i) => wordLine(s.lines, i, count)), count, own: false, fixed: false };
}

const lineText = (s, n) => { const { words, lines } = lineWords(s); return words.filter((w, i) => lines[i] === n).join(' '); };

/** "שבת פרשת נח · 17.10" */
export const weekLabel = p => { const [, m, d] = toYmd(p.first).split('-'); return (p.title || '') + ' · ' + +d + '.' + +m; };

/** השבתות/החגים (או שבועות ימי החול) הקרובים שהלוח שלהם נבנה לפי התבנית, לבחירת השבוע בעריכת הנוסח */
function upcomingWeeks() {
  const out = [];
  let from = todayIn(st.cfgAll.tz);
  for (let k = 0; k < 16; k++) {
    const p = periodFor(st.cfgAll, st.tpl, from, 1, k > 0) || findPeriod(st.tpl.kind, from, st.cfg.il);
    if (!p || out.some(x => x.first === p.first)) break;
    out.push(p);
    from = p.last + 1;
  }
  const cur = st.weekShown;
  if (cur && !out.some(x => x.first === cur.first)) out.unshift(cur);
  return out;
}

/** עורך הנוסח של שורה n: בחירת השבוע, מה שיודפס באותו שבוע, והנוסח החדש – לשבוע הזה או לכל השבועות */
export function lineEditor(s, n) {
  const weeks = st.weeks || (st.weeks = upcomingWeeks());
  const cur = st.weekShown, own = lineWords(s).own;
  const full = lineWords(s), count = full.count;
  const shown = Array.from({ length: count }, (x, k) => full.words.filter((w, i) => full.lines[i] === k).join(' ')).filter(Boolean);
  const kd = s.kind === 'kiddush' && cur ? (hasKiddush(cur) ? 'קידוש מאושר מלוח הקידושים של הקהילה.' : 'אין קידוש מאושר לשבוע הזה – מוצג קידוש לדוגמה.') : '';
  return '<div class="wrap-line line-ed"><span class="wrap-no">שורה ' + (n + 1) + '</span><div class="line-ed-body">' +
    '<label>לאיזה שבוע?</label><select data-week>' + weeks.map((p, i) =>
      '<option value="' + i + '"' + (cur && p.first === cur.first ? ' selected' : '') + '>' + esc(weekLabel(p)) + '</option>').join('') + '</select>' +
    '<div class="line-ed-week"><b>מה יודפס באזור בשבוע הזה:</b>' + shown.map((ln, k) => '<div>' + esc(ln) + '</div>').join('') +
    (kd ? '<small>' + kd + '</small>' : '') + '</div>' +
    '<label>הנוסח בשורה ' + (n + 1) + '</label><input data-line-text value="' + esc(lineText(s, n)) + '">' +
    '<div class="line-ed-scope"><label class="check"><input type="radio" name="lineScope" value="week" checked> רק בשבוע הזה</label>' +
    '<label class="check"><input type="radio" name="lineScope" value="all"' + (own ? ' disabled' : '') + '> בכל השבועות (נוסח קבוע)</label></div>' +
    (own ? '<p class="hint">הנוסח כבר נערך לשבוע הזה. כדי לשנות לכל השבועות, בטלו קודם את העריכה לשבוע הזה.</p>' : '') +
    '<div class="line-ed-btns"><button type="button" class="primary" data-line-save>שמירה</button>' +
    '<button type="button" data-line-cancel>ביטול</button></div></div></div>';
}

const hasKiddush = p => !!kiddush && p.days.some(d => kiddush.get(toYmd(d.day)));

/** פתיחת עורך הנוסח לשורה n. התצוגה עוברת לשבוע שנבחר, כדי שהגבאי יראה את מה שיודפס בו */
export function editLine(s, n) {
  setLineEdit({ s, n });
  if (!st.previewData) schedulePreviewRefresh();
  refreshWrapLines();
  const input = document.querySelector('.line-ed [data-line-text]');
  if (input) input.focus();
}

/** שמירת הנוסח שנכתב לשורה, לפי מה שנבחר: לשבוע שבתצוגה בלבד, או לכל השבועות */
export function saveLine(s, n, typed, scope) {
  const to = typed.replace(/\s+/g, ' ').trim();
  setLineEdit(null);
  if (scope === 'all') rewordAll(s, n, to);
  else if (st.previewData) saveWeekLine(s, n, to);
  refreshWrapLines();
  schedulePreviewRefresh();
}

/** המפתח של הלוח שבתצוגה בשינויים לשבוע מסוים (כמו editKey ב-app.js) */
export const weekKey = () => st.tpl.id + ':' + st.weekShown.first;

/**
 * שינוי לשבוע שבתצוגה בלבד: הטקסט של האזור כולו, עם ירידת שורה בין השורות, נשמר בשינויים של אותו לוח
 * (cfg.edits) לכל עמוד שבו האזור נכתב באותו טקסט. עד שמירת התבנית השינויים ממתינים ב-st.weekEdits
 */
export function saveWeekLine(s, n, to) {
  const { words, lines, count } = lineWords(s);
  const rows = Array.from({ length: count }, (x, k) => words.filter((w, i) => lines[i] === k).join(' '));
  rows[n] = to;
  const text = rows.filter(Boolean).join('\n');
  const built = builtSlots(), b = built[st.slots.indexOf(s)], k = slotKey(b), host = specialHost(built);
  const { values, pages } = st.previewData;
  const plain = slotText(b, { ...values, edits: null }, host);
  const edits = weekEditsFor(weekKey());
  const hit = pages.map((v, i) => i).filter(i => { const t = slotText(b, { ...pages[i], edits: null }, host); return t != null && t === plain; });
  for (const i of hit.length ? hit : [0]) {
    if (!text || text === plain || text.replace(/\n/g, ' ') === plain) delete edits['p' + i + '|' + k];
    else edits['p' + i + '|' + k] = text;
  }
}

/** השינויים לשבוע key: מה שכבר נשמר בהגדרות, עם מה שנערך עכשיו */
export function weekEditsFor(key) {
  if (!st.weekEdits) st.weekEdits = {};
  if (!st.weekEdits[key]) st.weekEdits[key] = { ...((st.cfgAll.edits || {})[key] || {}) };
  return st.weekEdits[key];
}

/** ביטול העריכה של האזור s בשבוע שבתצוגה */
export function resetWeek(s) {
  const k = slotKey(builtSlots()[st.slots.indexOf(s)]), edits = weekEditsFor(weekKey());
  for (const key of Object.keys(edits)) if (key.replace(/^p\d+\|/, '') === k) delete edits[key];
  schedulePreviewRefresh();
}

/**
 * שינוי הנוסח של שורה n בכל השבועות: המילים שבשורה מוחלפות בטקסט שנכתב, והמילים החדשות נשארות באותה שורה.
 * נשמר כהחלפה (s.rewords), ולא כטקסט קבוע, כדי שמה שמשתנה בשאר השורות ימשיך להתעדכן
 */
function rewordAll(s, n, to) {
  const { words, lines, fixed } = lineWords(s);
  const idx = lines.map((l, i) => l === n ? i : -1).filter(i => i >= 0);
  const first = idx.length ? idx[0] : lines.filter(l => l < n).length, last = idx.length ? idx[idx.length - 1] : first - 1;
  if (idx.length && last - first + 1 !== idx.length) {
    SiteDialog.alert('המילים בשורה הזו לא רצופות בטקסט. החזירו אותן לסדר (בלחיצה על המילים) ונסו שוב.');
    return;
  }
  const from = words.slice(first, last + 1).join(' ');
  if (to === from) return;
  if (!from) {
    // שורה ריקה: המילים נוספות אחרי המילה האחרונה שבשורות שלפניה
    if (!to) return;
    const before = words.slice(0, first).join(' ');
    if (!before) { SiteDialog.alert('אפשר להוסיף מילים לשורה ריקה רק אחרי שיש מילים בשורה שלפניה.'); return; }
    addReword(s, before, before + ' ' + to);
  } else addReword(s, from, to);
  // בהודעה מלוח הקידושים השורות נקבעות לפי ההודעה עצמה, ולא לפי מספר המילים
  if (!fixed) {
    const added = to ? to.split(' ').length : 0;
    s.lines = [...lines.slice(0, first), ...Array(added).fill(n), ...lines.slice(last + 1)];
    if (!s.lines.some(Boolean)) delete s.lines;
  }
  schedulePreviewRefresh();
}

/** מוסיף החלפה. עריכה נוספת של אותן מילים מעדכנת את ההחלפה הקודמת במקום להוסיף עוד אחת */
function addReword(s, from, to) {
  const list = s.rewords || [];
  const prev = list.find(p => p[1] === from && p[1]);
  if (prev) prev[1] = to; else list.push([from, to]);
  s.rewords = list.filter(([a, b]) => a !== b);
  if (!s.rewords.length) delete s.rewords;
}

/**
 * הימים שבהם שעה בלוח ימי חול חלה. s.when – היום שהערך שלו נכתב באזור;
 * s.days – כשהשעה חלה על כמה ימים ("ימים: א'-ה'"), כל הימים.
 */
export const slotDays = s => (s.days && s.days.length ? s.days : [s.when]);

export function dayChecks(s) {
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
export const slotLabel = s => (s.kind === 'rule' || s.kind === 'kiddush') ? (s.name || 'תפילה חדשה') : (KIND_LABEL[s.kind] || s.kind);

/** תקציר לשורה הסגורה: מתי ולפי מה, ומה היה בקובץ הישן */
export function slotSum(s) {
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

