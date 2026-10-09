/** בניית התבנית, התצוגה המקדימה, שמירה וביטול (חלק מ-js/template-ui.js שפוצל) */

import { DAY_APPLIES, appliesOnDay } from './config.js';
import { analyzeSlot, templateCanvas, specialHost, slotText, slotLook, slotKey } from './template-render.js';
import { findPeriod, periodFor, buildLuach, buildDaysLuach, dayPages } from './luach.js';
import { todayIn } from './dates.js';
import { $, KIDDUSH_LABEL, kiddush, DOW_LABELS, isDays, st, slotTexts, slotEdited, colOf, setSlotTexts, setSlotEdited } from './template-state.js';
import { close } from './template-ui.js';
import { renderBoxes, focusSlot } from './template-boxes.js';
import { drag, resize, move } from './template-move.js';
import { wrapLines } from './template-fields.js';
import { weekKey, weekEditsFor, slotDays } from './template-lines.js';

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
    out.push({ name: s.name.trim(), when: s.when, applies: 'שבת וחג', base: kd ? KIDDUSH_LABEL : s.base, offset: kd ? '' : s.offset, round: kd ? 'ללא' : s.round });
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
    const base = kd ? KIDDUSH_LABEL : s.base, round = kd ? 'ללא' : s.round, offset = kd ? '' : s.offset;
    const k = [name, base, offset, round].join('|');
    if (!groups.has(k)) groups.set(k, { name, base, offset, round, keys: new Set(), byDays: false });
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
export function builtSlots() {
  return st.slots.map(s => {
    const c = { box: s.box, kind: s.kind, old: s.old || '' };
    if (s.labelBox) Object.assign(c, { labelBox: s.labelBox, labelStyle: analyzeSlot(st.canvas, (s.origin && s.origin.labelBox) || s.labelBox), ...(s.label ? { label: s.label } : {}) });
    if (s.origin) c.origin = s.origin;
    if ((s.kind === 'parasha' || s.kind === 'parashaName') && s.prefix && s.prefix.trim()) c.prefix = s.prefix.trim() + ' ';
    if (s.kind === 'rule' || s.kind === 'kiddush') Object.assign(c, { name: String(s.name).trim(), when: s.when, ...(s.days ? { days: s.days } : {}) });
    if (s.kind === 'zman') Object.assign(c, { zman: s.zman, when: s.when });
    if (s.kind === 'hebDate') Object.assign(c, { ascii: !!s.ascii, noYear: !!s.noYear, ...(s.hei ? { hei: true } : {}) });
    if (s.kind === 'gregDate') c.fmt = s.fmt;
    if (s.kind === 'text') c.text = String(s.text ?? '').trim();
    c.sizePct = s.sizePct || 100;
    if (s.underline) c.underline = s.underline;
    if (s.ulDim) c.ulDim = s.ulDim;
    // הדגשה ונטייה נשמרות רק כשהגבאי בחר בהן. בלי בחירה – כמו בקובץ
    if (s.bold != null) c.bold = s.bold;
    if (s.italic != null) c.italic = s.italic;
    // ריווח הפסקה נשמר רק כשהגבאי קבע אותו. בלי – כמו בקובץ
    if (s.joinPrev) c.joinPrev = true;
    if (s.spaceBefore != null) c.spaceBefore = s.spaceBefore;
    if (s.spaceAfter != null) c.spaceAfter = s.spaceAfter;
    c.wrap = !!s.wrap;
    if (c.wrap) {
      c.lineHeightPct = s.lineHeightPct || 100;
      c.lineCount = s.lineCount || 2;
      if (s.srcLines > 1) c.srcLines = s.srcLines;
      if (s.lines && s.lines.some(Boolean)) c.lines = s.lines;
    }
    if (s.rewords && s.rewords.length) c.rewords = s.rewords;
    c.style = slotStyle(s);
    return c;
  });
}

/** מספר השימושים בכל גופן, והגופן הנפוץ בשעות – שבו נכתב אזור שסומן ידנית */
export function fontUse(slots) {
  const count = {};
  for (const s of slots) if (s.box.font && st.fonts[s.box.font]) count[s.box.font] = (count[s.box.font] || 0) + (s.kind === 'rule' || s.kind === 'kiddush' || s.kind === 'zman' ? 2 : 1);
  return { count, mainFont: Object.keys(count).sort((a, b) => count[b] - count[a])[0] || null };
}

/** ההדגשה והנטייה שבהן האזור ייכתב, כמו בציור */
export function lookOf(s) {
  const f = st.fonts[s.box.font] || st.fonts[fontUse(st.slots).mainFont];
  return slotLook(s, f, slotStyle(s));
}

/**
 * צבע הרקע, צבע הטקסט והעובי של אזור. בטקסט שזוהה בקובץ (box.size) הם נמדדים פעם אחת, על הטקסט המקורי:
 * עובי הקו נמדד ביחס לגובה האזור, וכותרת שמותחים או מכווצים לא צריכה לאבד את ההדגשה או לקבל צבע אחר
 */
export function slotStyle(s) {
  // אזור שהוזז: המראה נמדד במקום המקורי שלו בקובץ, ולא במקום החדש (שבו אין את הטקסט שלו)
  if (!s.box.size && !s.origin) return analyzeSlot(st.canvas, s.box);
  if (!s.style) s.style = analyzeSlot(st.canvas, s.origin ? s.origin.box : s.box);
  return s.style;
}

function buildTemplate(built = builtSlots()) {
  const slots = built.filter(s => (s.kind !== 'rule' && s.kind !== 'kiddush') || s.name);
  // רק הגופנים שבשימוש נשמרים – גם של השם שליד השעה, שנכתב מחדש כשמשנים את גודל האזור
  const { count, mainFont } = fontUse(slots);
  const used = new Set([...Object.keys(count), ...slots.map(s => s.labelBox && s.labelBox.font).filter(k => k && st.fonts[k])]);
  const fonts = Object.fromEntries([...used].map(k => [k, st.fonts[k]]));
  // שאר הגופנים שבקובץ לא נטענים בציור הלוח, אבל נשמרים כדי שבעריכה הבאה אפשר יהיה לבחור בהם
  const spareFonts = Object.fromEntries(Object.entries(st.fonts).filter(([k]) => !used.has(k)));
  return { enabled: true, name: st.name, day: st.day, image: st.canvas.toDataURL('image/jpeg', 0.88),
    slots, candidates: st.candidates, fonts, mainFont, ...(Object.keys(spareFonts).length ? { spareFonts } : {}) };
}

/** המילים בתיבות השורות לפי הטקסט שבתצוגה, בלי לבנות מחדש את כל הרשימה */
export function refreshWrapLines() {
  for (const el of $('tplSlots').querySelectorAll('.wrap-lines')) {
    const s = st.slots[+el.closest('.slot-ed').dataset.i];
    if (s) el.innerHTML = wrapLines(s);
  }
}

async function renderTemplatePreview() {
  const built = builtSlots(), tpl = buildTemplate(built);
  const cfg = { ...st.cfg, rules: mergeRules(st.cfg.rules, slotRules(), $('tplRules').checked, st.tpl.kind) };
  const today = todayIn(cfg.tz);
  // השבוע שנבחר בעורך הנוסח, או הלוח הקרוב
  const occ = st.week || periodFor(st.cfgAll, st.tpl, today) || findPeriod(st.tpl.kind, today, cfg.il);
  st.weekShown = occ;
  // בעורך רואים איך הקידוש ייראה גם בלי קידוש מאושר לתאריך – עם תורם לדוגמה. בלוח עצמו אין דוגמה
  const kd = { get: k => (kiddush && kiddush.get(k)) || { ...SAMPLE_KIDDUSH, ...(kiddush && kiddush.wording) } };
  const base = occ.mode === 'days' ? buildDaysLuach(cfg, occ, kd).values : buildLuach(cfg, occ, kd).values;
  const pages = base.multiDay ? dayPages(cfg, occ, kd) : [base];
  st.previewData = { values: base, pages };
  // הנוסח שנערך לשבוע הזה: מהעמוד הראשון שבו האזור נערך
  const once = weekEditsFor(weekKey()), edits = {};
  for (const key of Object.keys(once).sort()) {
    const k = key.replace(/^p\d+\|/, '');
    if (!(k in edits)) edits[k] = once[key];
  }
  const values = { ...base, edits };
  const canvas = await templateCanvas(tpl, values);
  // המקום של כל אזור בתמונה שנכתבה, לפי האזור שבעורך
  const at = canvas.layout;
  canvas.view = { ...at, slots: new Map(st.slots.map((s, i) => [s, at.slots.get(built[i])]).filter(e => e[1])) };
  const host = specialHost(tpl.slots);
  setSlotTexts(new WeakMap(st.slots.map((s, i) => [s, slotText(built[i], values, host) ?? ''])));
  setSlotEdited(new WeakSet(st.slots.filter((s, i) => slotKey(built[i]) in edits)));
  refreshWrapLines();
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
export function schedulePreviewRefresh() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    const seq = ++previewSeq, cur = st;
    const canvas = await renderTemplatePreview();
    if (seq !== previewSeq || cur !== st) return;
    $('tplImg').src = canvas.toDataURL('image/png');
    // המסגרות עוברות למקום שבו הטקסט נכתב בתמונה החדשה (לא באמצע גרירה – היא מצוירת בתוך המסגרות)
    st.view = canvas.view;
    if (!drag && !resize && !(move && move.s)) renderBoxes();
  }, 200);
}

$('tplSave').onclick = () => {
  const bad = st.slots.find(s => (s.kind === 'rule' || s.kind === 'kiddush') && !String(s.name).trim());
  if (bad) { focusSlot(st.slots.indexOf(bad)); SiteDialog.alert('יש אזור של תפילה בלי שם. כתבו שם או הסירו את האזור.'); return; }
  // הנוסח שנערך לשבועות מסוימים נשמר בשינויים של אותם לוחות
  if (st.weekEdits) {
    if (!st.cfgAll.edits) st.cfgAll.edits = {};
    for (const [key, e] of Object.entries(st.weekEdits)) {
      if (Object.keys(e).length) st.cfgAll.edits[key] = e; else delete st.cfgAll.edits[key];
    }
  }
  close({ tpl: st.tpl, template: buildTemplate(), rules: slotRules(), replace: $('tplRules').checked, detected: st.detected });
};
$('tplCancel').onclick = async () => {
  if (!await SiteDialog.confirm('לבטל את עיצוב התבנית? השינויים לא יישמרו.', { ok: 'ביטול העיצוב', cancel: 'המשך עריכה', danger: true })) return;
  close(null);
};

