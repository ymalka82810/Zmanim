/**
 * ממשק האתר: לוח, הגדרות, שיתוף וגיבוי. ההגדרות נשמרות בקהילה ומסתנכרנות בין הגבאים והרב (settings-sync.js),
 * ועותק שלהן נשמר בדפדפן. הלוחות המאושרים נשמרים בקהילה (community.js).
 */

import { CITIES, BASES, WHEN, WHEN_LABELS, APPLIES, ROUND, FONTS, THEMES, LAYOUTS, LAYOUTS_SHOWN, SIZE_PARTS, SIZES, PAPERS, ORIENTS, COLUMNS, pageOf, DEFAULT_CONFIG, DAY_APPLIES, BUILTIN, isBuiltin, newTemplate, designOf, activeDesign,
  prayerBases, fontFamilies, fontsHref, themeColors, normalize, loadConfig, saveConfig, clearConfig, TEXT_BASES } from './config.js';
import { findOccasion, templateFor, periodFor, adjacentPeriod, joinedTemplates, occasionParts, buildLuach, buildDaysLuach, dayPages, buildPoster } from './luach.js';
import { MOADIM } from './moadim.js';
import { luachHtml, withEdits, esc, multiline } from './render.js';
import { todayIn, toYmd, toDayNum } from './dates.js';
import { luachCanvas, luachTextCanvas, pngBlob, pdfBlob, stackCanvases } from './image.js';
import { templateCanvas } from './template-render.js';
import { editFromFile, editFromBoard, editExisting, mergeRules, setKiddush } from './template-ui.js';
import { initCommunity } from './community.js';
import { startSync } from './settings-sync.js';
import { openTextEdit } from './text-edit.js';
import { openWizard, closeWizard, wizardDone } from './wizard.js';

const $ = id => document.getElementById(id);
const BASE_LABELS = Object.keys(BASES);

let { cfg, saved } = loadConfig();
let cursor = null;       // היום שממנו מחפשים את האירוע המוצג
let exact = false;       // cursor הוא היום הראשון של הלוח המוצג (ולא היום של היום, שיכול להיות באמצע לוח)
let period = null;       // השבת/החג או ימי החול של הלוח המוצג
let current = null;      // הלוח המוצג כרגע
let sel = 'shabbat';     // התבנית שנבחרה בהגדרות
let kiddush = null;      // dateKey ← קידוש מאושר, מהקהילה (community.js)
let events = null;       // האירועים מיומן הקהילה (community.js), או null עד שנטענו
let comm = null;         // הקידושים והאירועים לחישוב הלוח (communityData)
let posterId = null;     // האירוע שהמודעה שלו מוצגת, או null למודעה הקרובה
let boardEditing = false;   // מצב "עריכת טקסט" בלוח של האתר (לא זמין בעיצוב מקובץ, שהוא תמונה)

/* התבנית שהלוח מוצג לפיה (שבתות, חגים, חול המועד, ימות השבוע או תבנית של המשתמש). נשמרת במכשיר */
const MODE_KEY = 'zmanim.mode';
let board = 'shabbat';
// עד גרסה קודמת נשמר כאן סוג הלוח (holy/days), ושבתות וחגים היו כפתור אחד
try { const v = localStorage.getItem(MODE_KEY); if (v) board = v === 'days' ? 'week' : v === 'holy' ? 'shabbat' : v; }
catch (e) { /* אין גישה לאחסון */ }

/* ---------- הודעות ---------- */

let toastTimer;
function toast(text, err) {
  const t = $('status');
  t.textContent = text;
  t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 2200);
}

/* ---------- לשוניות ---------- */

function showTab(name) {
  flush();
  if (remoteLater && name !== 'template') { const [next, by] = remoteLater; applyRemote(next, by); }
  for (const n of ['luach', 'settings']) $('tab-' + n).setAttribute('aria-selected', String(n === name));
  for (const n of ['luach', 'settings', 'template']) $('view-' + n).hidden = n !== name;
  if (name === 'luach') renderLuach();
}
$('tab-luach').onclick = () => showTab('luach');
$('tab-settings').onclick = () => showTab('settings');
$('goSettings').onclick = () => showTab('settings');
// "חזרה" באפליקציה: מעורך התבנית (עם אישור לביטול), ומההגדרות ללוח
SiteBack.add(() => {
  if (!$('view-template').hidden) { $('tplCancel').click(); return true; }
  if (!$('view-settings').hidden) { showTab('luach'); return true; }
  return false;
});

/* לשוניות בתוך ההגדרות. לוח התבניות מופיע בכל לשונית שתלויה בתבנית שנבחרה */
const PANE_KEY = 'zmanim.settingsPane';
function showPane(name) {
  for (const b of $('settingsTabs').querySelectorAll('[data-pane]')) b.setAttribute('aria-selected', String(b.dataset.pane === name));
  for (const p of $('view-settings').querySelectorAll('[data-panes]')) p.hidden = !p.dataset.panes.split(' ').includes(name);
  try { localStorage.setItem(PANE_KEY, name); } catch (e) { /* אין גישה לאחסון */ }
}
$('settingsTabs').onclick = e => { const b = e.target.closest('[data-pane]'); if (b) showPane(b.dataset.pane); };
{
  let pane = 'shul';
  try { pane = localStorage.getItem(PANE_KEY) || pane; } catch (e) { /* אין גישה לאחסון */ }
  showPane($('settingsTabs').querySelector(`[data-pane="${pane}"]`) ? pane : 'shul');
}

const boardTpl = () => cfg.templates.find(t => t.id === board) || cfg.templates[0];

/*
 * אירועים מיומן הקהילה. בכל אירוע הגבאי בוחר איך הוא מוצג (show): שורה בלוח ("board") – בשורה שהבסיס שלה
 * "אירועים (מיומן הקהילה)", מודעה נפרדת ("poster") – בלשונית "אירועים" בשורת התבניות, או שניהם ("both").
 */
const EVENTS_BOARD = '_events';   // הלשונית של מודעות האירועים (לא תבנית)
const posterEvents = () => (events || []).filter(e => e.show === 'poster' || e.show === 'both');

/** הקידושים לחישוב הלוח (dateKey ← קידוש, ו-wording), ובנוסף events: dateKey ← האירועים שמוצגים כשורה בלוח */
function communityData() {
  const m = new Map(kiddush || []);
  m.wording = kiddush && kiddush.wording;
  m.events = new Map();
  for (const e of events || []) {
    if (e.show === 'poster') continue;
    if (!m.events.has(e.dateKey)) m.events.set(e.dateKey, []);
    m.events.get(e.dateKey).push(e);
  }
  return m;
}
comm = communityData();

/**
 * מעבר לתבנית אחרת בלוח. day – היום שממנו מחפשים את הלוח, או null ללוח הקרוב.
 * שורת התבניות זהה בלוח ובהגדרות, ולכן הבחירה בה מסונכרנת: מעבר כאן מעדכן גם איזו תבנית נבחרת לעריכה בהגדרות
 */
function setBoard(id, day = null) {
  board = id; cursor = day; exact = day != null;
  try { localStorage.setItem(MODE_KEY, id); } catch (e) { /* אין גישה לאחסון */ }
  if (sel !== id && cfg.templates.some(t => t.id === id)) { sel = id; renderTemplates(); }
  renderLuach();
}

/**
 * רשימת התבניות לבחירה, עם כפתור להוספת תבנית. host – 'luach' או 'settings'.
 * join – התבניות של שבת וחג שמוצגים בלוח משולב: הן מוצגות כלשונית אחת ("שבתות וחגים").
 * split – סימן להפרדה, כשהגבאי שילב חג ושבת עם פרשה (שבת שחלה בחג אי אפשר להפריד).
 */
function tplChips(el, id, host, join = null, split = false) {
  const joined = join ? cfg.templates.filter(x => join.includes(x.id)) : [];
  el.innerHTML = cfg.templates.map(x => {
    if (joined.length > 1 && joined.includes(x)) {
      if (x !== joined[0]) return '';
      return '<span class="chip-join"><button type="button" class="chip" data-t="' + esc(id) + '" aria-pressed="true">' +
        esc(joined.map(j => j.name).join(' ו')) + '</button>' + (split ? '<button type="button" class="chip-split" data-split="1" ' +
        'title="הפרדה לשני לוחות – לשבת ולחג" aria-label="הפרדה לשני לוחות – לשבת ולחג">⇆</button>' : '') + '</span>';
    }
    return '<button type="button" class="chip" data-t="' + esc(x.id) + '" aria-pressed="' +
      (x.id === id) + '">' + esc(x.name) + '</button>';
  }).join('') +
    // מודעות האירועים – בלוח בלבד, כשיש אירוע שהגבאי בחר להציג כמודעה
    (host === 'luach' && (posterEvents().length || id === EVENTS_BOARD)
      ? '<button type="button" class="chip" data-t="' + EVENTS_BOARD + '" aria-pressed="' + (id === EVENTS_BOARD) + '">אירועים</button>' : '') +
    '<button type="button" class="chip add" data-add="' + host + '">+ תבנית חדשה</button>';
}

$('luachTpls').addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.add) openNewTemplate('luach');
  else if (b.dataset.split) {
    if (!period || !cfg.merged[period.occId]) return;
    if (!await SiteDialog.confirm('להפריד את "' + period.title + '" לשני לוחות נפרדים – אחד לשבת ואחד לחג?', { ok: 'הפרדה' })) return;
    toggleMerged(period.occId);
  } else setBoard(b.dataset.t);
});

/* ---------- הלוח ---------- */

/** הטקסטים שהגבאי שינה בלוח נשמרים לפי התבנית והיום הראשון של הלוח */
const editKey = (t, p) => t.id + ':' + p.first;

/** הטקסטים שהשתנו בעמוד i של עיצוב מקובץ (המפתחות שם הם "p0|..." לפי העמוד) */
function pageEdits(e, i) {
  const pre = 'p' + i + '|', o = {};
  for (const k in e) if (k.startsWith(pre)) o[k.slice(pre.length)] = e[k];
  return o;
}

/**
 * הלוח לפי התבנית שחלה עליו, עם הטקסטים שהגבאי שינה: שינויים קבועים של התבנית (t.edits), ומעליהם
 * שינויים בלוח הזה בלבד (cfg.edits). l.base – הלוח המחושב, ו-l.fixedBase – הלוח עם השינויים הקבועים בלבד.
 * l.design – העיצוב מהקובץ הישן, ו-l.pages – הערכים לכל עמוד שלו:
 * הקובץ הוא לוח של יום אחד, ולכן בשבת/חג רב-יומי יש עמוד לכל יום.
 */
function build(p) {
  const t = templateFor(cfg, p), c = { ...cfg, rules: t.rules };
  const base = p.mode === 'days' ? buildDaysLuach(c, p, comm) : buildLuach(c, p, comm);
  const fixed = t.edits || {}, e = cfg.edits[editKey(t, p)] || {};
  const l = withEdits(base, e, fixed);
  l.base = base;
  l.fixedBase = withEdits(base, {}, fixed);
  l.edits = e;
  l.fixedEdits = fixed;
  l.design = activeDesign(cfg, t);
  l.pages = l.design ? (base.values.multiDay ? dayPages(c, p, comm) : [base.values]).map((v, i) => {
    const once = pageEdits(e, i), fx = pageEdits(fixed, i);
    return { ...v, edits: { ...fx, ...once }, once, fixed: fx };
  }) : null;
  l.tpl = t;
  return l;
}

/**
 * מודעה לאירוע ev, בעיצוב (גופן, צבעים, תבנית תצוגה ודף) של תבנית השבתות. טקסט שהגבאי שינה במודעה
 * נשמר למודעה הזאת בלבד, ב-cfg.edits לפי "ev-מזהה האירוע:היום". l.poster – סימן שזו מודעה ולא לוח.
 */
function buildPosterLuach(ev, p) {
  const shabbat = cfg.templates.find(t => t.id === 'shabbat') || cfg.templates[0];
  const t = { ...shabbat, id: 'ev-' + ev._id, edits: {}, cols: 1 };
  const base = buildPoster(cfg, ev), e = cfg.edits[editKey(t, p)] || {};
  const l = withEdits(base, e);
  Object.assign(l, { base, fixedBase: withEdits(base, {}), edits: e, fixedEdits: {}, design: null, pages: null, tpl: t, poster: true });
  return l;
}

/** המודעה הקרובה: האירוע הראשון מהיום והלאה, או האחרון כשכל האירועים עברו */
function nearestPoster() {
  const list = posterEvents(), today = toYmd(todayIn(cfg.tz));
  return list.find(e => e.dateKey >= today) || list[list.length - 1] || null;
}
/** האירוע שהמודעה שלו מוצגת: posterId, ואם אין – המודעה הקרובה */
const shownPoster = () => posterEvents().find(e => e._id === posterId) || nearestPoster();

/** לשונית "אירועים": המודעה של האירוע המוצג, עם מעבר בין האירועים ב"הקודם" ו"הבא" */
function renderPoster() {
  tplChips($('luachTpls'), EVENTS_BOARD, 'luach');
  renderMixOffer(null);
  const ev = shownPoster();
  $('luach').classList.toggle('poster', !!ev);
  if (!ev) {
    current = period = null;
    $('luachEdit').hidden = true;
    delete $('luach').dataset.layout;
    $('luach').innerHTML = '<p class="luach-empty">' + (events ? 'אין אירועים שמוצגים כמודעה. ' +
      'ביומן הקהילה, בהוספה או בעריכה של אירוע, בוחרים "מודעה נפרדת" או "גם שורה בלוח וגם מודעה".' : 'טוען את האירועים…') + '</p>';
    $('todayOcc').disabled = true;
    return;
  }
  posterId = ev._id;
  const d = toDayNum(ev.dateKey);
  period = { mode: 'poster', first: d, last: d, title: ev.title };
  current = buildPosterLuach(ev, period);
  applyDesign($('luach'), current.tpl);
  applyPage(current.tpl);
  $('luachEdit').hidden = false;
  $('luach').classList.toggle('editing', boardEditing);
  $('luach').innerHTML = luachHtml(current, boardEditing);
  $('todayOcc').disabled = nearestPoster() === ev;
}

/** מעבר למודעה הבאה (dir=1) או הקודמת (dir=-1) לפי התאריך */
function stepPoster(dir) {
  const list = posterEvents(), i = list.findIndex(e => e._id === posterId);
  const next = list[i + dir];
  if (next) { posterId = next._id; renderLuach(); }
}

/** העמודים של הלוח כקנבסים: עמוד לכל יום בעיצוב מקובץ, או עמוד אחד בעיצוב של האתר */
const drawLuach = async l => l.design ? Promise.all(l.pages.map(v => templateCanvas(l.design, v)))
  : [await luachCanvas(l, l.tpl.font, l.tpl.sizes, l.tpl.theme, l.tpl.layout, pageOf(l.tpl), l.tpl.cols)];

/**
 * החלת הגופן, ערכת הצבעים, הגדלים ותבנית התצוגה של התבנית t על el (הלוח, או הדוגמה בהגדרות).
 * הגופן נטען מ-Google Fonts, קישור לכל גופן כך שכמה תבניות יכולות להשתמש בגופנים שונים.
 * layout – תבנית תצוגה אחרת משל t (לדוגמאות בבחירת התבנית)
 */
function applyDesign(el, t, layout = t.layout) {
  el.dataset.layout = layout;
  const id = 'fontLink-' + t.font;
  if (!document.getElementById(id)) {
    const link = document.createElement('link');
    link.id = id; link.rel = 'stylesheet'; link.href = fontsHref(t.font);
    document.head.appendChild(link);
  }
  const f = fontFamilies(t.font);
  el.style.setProperty('--f-title', f.title);
  el.style.setProperty('--f-body', f.body);
  for (const [k] of SIZE_PARTS) el.style.setProperty('--s-' + k, String((t.sizes[k] || 100) / 100));
  const c = themeColors(t.theme);
  for (const k of ['ink', 'blue', 'line', 'soft', 'muted', 'note']) el.style.setProperty('--' + k, c[k]);
  el.style.setProperty('--paper', c.paper);
}

/** לוח משולב של שבת וחג (שהגבאי בחר לשלב) */
const isMerged = p => !!p && !!p.mixed && !!cfg.merged[p.occId];

/**
 * ההצעה לשלב חג ושבת עם פרשה שצמודים ללוח אחד. הבחירה נשמרת לשבת הזאת בלבד, לפי היום הראשון של האירוע.
 * לוח משולב מופרד בחזרה מהסימן שעל הלשונית המשולבת.
 */
function renderMixOffer(p) {
  const el = $('mixOffer');
  el.hidden = !p || !p.mixed || isMerged(p);
  if (el.hidden) return;
  el.innerHTML = 'השבת צמודה לחג, וכרגע יש לכל אחד לוח נפרד.' +
    '<button type="button" class="link" id="mixToggle">לשילוב השבת והחג בלוח אחד (לשבת הזאת בלבד)</button>';
}

$('mixOffer').addEventListener('click', e => {
  if (e.target.id === 'mixToggle' && period) toggleMerged(period.occId);
});

/** שילוב האירוע id ללוח אחד, או הפרדה שלו בחזרה לשני לוחות */
function toggleMerged(id) {
  if (cfg.merged[id]) delete cfg.merged[id];
  else cfg.merged[id] = true;
  changed();
  // הלוח המשולב הוא לוח של חג, ולכן אחרי השילוב עוברים לתבנית שלו; אחרי ההפרדה נשארים בתבנית הנוכחית
  const parts = occasionParts(findOccasion(id, cfg.il), cfg.merged);
  const p = parts.find(x => templateFor(cfg, x) === boardTpl()) || parts[0];
  setBoard(templateFor(cfg, p).id, p.first);
}

function renderLuach() {
  $('welcome').hidden = saved;
  if (board === EVENTS_BOARD) return renderPoster();
  $('luach').classList.remove('poster');
  const t = boardTpl();
  board = t.id;
  if (cursor == null) { cursor = todayIn(cfg.tz); exact = false; }
  // מהיום הראשון של לוח – רק לוח שמתחיל בו או אחריו, כדי שבחלק השני של חג ושבת לא נחזור לחלק הראשון
  const p = isFinite(cfg.lat) && isFinite(cfg.lng) ? periodFor(cfg, t, cursor, 1, exact) : null;
  // בלוח משולב ובשבת שחלה בחג, הלשוניות של השבת ושל החג מאוחדות ללשונית אחת
  const join = joinedTemplates(cfg, p);
  tplChips($('luachTpls'), board, 'luach', join && join.map(x => x.id), isMerged(p));
  if (!p) {
    current = period = null;
    renderMixOffer(null);
    $('luachEdit').hidden = true;
    $('luach').innerHTML = '<p class="luach-empty">' + (isFinite(cfg.lat) && isFinite(cfg.lng)
      ? 'אין לוח קרוב לתבנית "' + esc(t.name) + '".<button type="button" class="link" id="goTplSettings">לבחירת המועדים שבהם היא חלה ←</button>'
      : 'לא ניתן לחשב לוח. בדקו את המיקום בהגדרות.') + '</p>';
    $('todayOcc').disabled = true;
    return;
  }
  cursor = p.first; exact = true; period = p;
  current = build(p);
  applyDesign($('luach'), current.tpl);
  applyPage(current.tpl);
  renderMixOffer(p);
  // עריכת טקסט בלחיצה על הלוח זמינה רק בתבנית של האתר; בעיצוב מקובץ (הלוח הוא תמונה) הכפתור פותח את עריכת התבנית,
  // שם אפשר לסמן אזורים על התמונה ולכתוב בהם טקסט
  $('luachEdit').hidden = false;
  $('luachEdit').title = current.design ? 'הלוח הועלה מקובץ – לעריכת הטקסט שעליו פותחים את עריכת התבנית' : '';
  $('luachEdit').setAttribute('aria-pressed', String(boardEditing && !current.design));
  $('luach').classList.toggle('editing', boardEditing && !current.design);
  if (current.design) {
    const l = current;
    // עיצוב מלוח קיים הוא תמונה, ותבנית התצוגה (למשל מסגרת) לא חלה עליו
    delete $('luach').dataset.layout;
    $('luach').innerHTML = l.pages.map((v, i) => '<div class="lp" data-p="' + i + '"><img class="luach-img" alt="' + esc(v.title) + '"></div>').join('');
    drawLuach(l).then(pages => {
      if (current !== l) return;
      $('luach').querySelectorAll('.lp').forEach((el, i) => { el.querySelector('img').src = pages[i].toDataURL('image/png'); });
    }).catch(() => { if (current === l) $('luach').innerHTML = luachHtml(l, false, l.tpl.cols); });
  } else {
    $('luach').innerHTML = luachHtml(current, boardEditing, current.tpl.cols);
  }
  const now = periodFor(cfg, t, todayIn(cfg.tz));
  $('todayOcc').disabled = !!now && now.first === p.first;
}

/** שמירת עריכת טקסט בלוח של האתר: scope 'week' – רק ללוח הזה, 'always' – לתמיד בתבנית */
function saveBoardEdit(key, text, scope) {
  // במודעת אירוע השינוי תמיד למודעה הזאת בלבד
  if (scope === 'week' || current.poster) {
    const k = editKey(current.tpl, period);
    const store = cfg.edits[k] || (cfg.edits[k] = {});
    store[key] = text;
  } else {
    const t = current.tpl;
    (t.edits || (t.edits = {}))[key] = text;
  }
  changed();
  renderLuach();
}

/** מחיקת עריכת טקסט קיימת (חוזר לערך הרגיל): לפי היכן שהעריכה נמצאת כרגע */
function deleteBoardEdit(key) {
  if (current.edited.has(key)) {
    const k = editKey(current.tpl, period), store = cfg.edits[k];
    if (store) { delete store[key]; if (!Object.keys(store).length) delete cfg.edits[k]; }
  } else if (current.fixed.has(key)) {
    const t = current.tpl;
    if (t.edits) { delete t.edits[key]; if (!Object.keys(t.edits).length) delete t.edits; }
  }
  changed();
  renderLuach();
}

$('luachEdit').addEventListener('click', async () => {
  // בלוח שהועלה מקובץ (תמונה) אין עריכת טקסט בלחיצה על הלוח עצמו – פותחים את עריכת התבנית, ששם מסמנים אזורים על התמונה
  if (current && current.design) {
    try { await editExisting(current.tpl, cfg, templateDone); showTab('template'); }
    catch (e) { toast('לא ניתן לפתוח את התבנית לעריכה', true); }
    return;
  }
  boardEditing = !boardEditing;
  $('luachEdit').setAttribute('aria-pressed', String(boardEditing));
  renderLuach();
});

$('luach').addEventListener('click', e => {
  if (!boardEditing) return;
  const el = e.target.closest('[data-e]');
  if (!el) return;
  const key = el.dataset.e;
  openTextEdit({
    text: el.textContent,
    multiline: key === 'body' || multiline(el.textContent),
    weekLabel: current.poster ? null : current.title,
    weekFirst: !current.fixed.has(key),
    hasOverride: current.edited.has(key) || current.fixed.has(key),
    onSave: (text, scope) => saveBoardEdit(key, text, scope),
    onDelete: () => deleteBoardEdit(key)
  });
});

/**
 * הלוח הבא (dir=1) או הקודם (dir=-1) לפי הסדר בלוח השנה, בלי קשר לתבנית: שבוע, שבת, שבוע, חג, חול המועד…
 * הלשונית שנבחרת מתחלפת לתבנית של הלוח החדש (ובשבת שחלה בחג – "שבתות וחגים").
 */
function stepLuach(dir) {
  if (board === EVENTS_BOARD) return stepPoster(dir);
  if (!period) return;
  const o = adjacentPeriod(cfg, period, dir);
  if (o) setBoard(templateFor(cfg, o).id, o.first);
}
$('luach').addEventListener('click', e => {
  if (e.target.id !== 'goTplSettings') return;
  sel = board;
  renderTemplates();
  showTab('settings');
  showPane('rules');
});

$('prevOcc').onclick = () => stepLuach(-1);
$('nextOcc').onclick = () => stepLuach(1);
$('todayOcc').onclick = () => { cursor = null; posterId = null; renderLuach(); };

/*
 * קבצי תמונה ו-PDF מוכנים מראש לכל לוח שמוצג. בספארי (אייפון) השיתוף חייב לקרות
 * מיד אחרי הלחיצה, ולכן אי אפשר לחכות ליצירת הקובץ בזמן הלחיצה.
 */
let files = null;   // { luach, promise }
let prepTimer;

function makeFiles(l) {
  const name = ((l.poster ? 'מודעה - ' : 'לוח זמנים - ') + l.title).replace(/[\\/:*?"<>|]/g, '');
  const promise = drawLuach(l).then(async pages => ({
    png: new File([await pngBlob(stackCanvases(pages))], name + '.png', { type: 'image/png' }),
    pdf: new File([await pdfBlob(pages, pageOf(l.tpl))], name + '.pdf', { type: 'application/pdf' })
  }));
  promise.catch(() => {});
  files = { luach: l, promise };
}
function prepareFiles() {
  clearTimeout(prepTimer);
  const l = current;
  if (l) prepTimer = setTimeout(() => makeFiles(l), 250);
}
function getFiles() {
  if (!files || files.luach !== current) { clearTimeout(prepTimer); makeFiles(current); }
  return files.promise;
}

async function download(blob, name) {
  try {
    const r = await NativeFiles.save(blob, name);
    if (r === 'saved' || r === 'downloaded') toast('הקובץ נשמר בהורדות');
  } catch (e) { toast('שמירת הקובץ נכשלה', true); }
}

async function shareFile(kind) {
  if (!current) return;
  let file;
  try { file = (await getFiles())[kind]; }
  catch (e) { toast('יצירת הקובץ נכשלה', true); return; }
  let r;
  try { r = await NativeFiles.share({ file, title: current.title }); } catch (e) { r = 'unsupported'; }
  if (r === 'unsupported') download(file, file.name);
}
$('shareImg').onclick = () => shareFile('png');
$('sharePdf').onclick = () => shareFile('pdf');
$('downloadPdf').onclick = async () => {
  if (!current) return;
  let file;
  try { file = (await getFiles()).pdf; }
  catch (e) { toast('יצירת הקובץ נכשלה', true); return; }
  download(file, file.name);
};

$('print').onclick = async () => {
  const title = current ? (current.poster ? 'מודעה - ' : 'לוח זמנים - ') + current.title : document.title;
  if (!NativeFiles.isApp()) return NativeFiles.print({ title });
  // באפליקציה beforeprint/afterprint לא נקראים, ולכן מתאימים את הלוח לעמודים ידנית עד שחלון ההדפסה נסגר
  const p = current ? pageOf(current.tpl) : null;
  fitPrint();
  try { await NativeFiles.print({ title, paper: p ? p.size.split(' ')[0] : 'A4', landscape: !!(p && p.landscape) }); }
  catch (e) { toast('ההדפסה נכשלה', true); }
  finally { unfitPrint(); }
};

/**
 * התאמת הלוח לעמודים בהדפסה (בגודל ובכיוון של הדף בתבנית), בכל מספר של עמודים. לוח שבעמוד האחרון שלו יש עד חצי עמוד נדחס לעמוד אחד פחות:
 * קודם מצמצמים את הרווחים (עד 40% מהרגיל), ואם עדיין לא נכנס – מקטינים את כל הלוח, טקסט ורווחים, באותו יחס,
 * כך שהיחס בין הגדלים של השורות נשמר. יותר מחצי עמוד בעמוד האחרון – מדפיסים כרגיל.
 * בעיצוב מקובץ – אותו כלל לתמונה של כל יום בנפרד.
 */
const MM = 96 / 25.4;   // פיקסלים במ"מ
const PRINT_MARGIN = 14;   // השוליים של הדף בהדפסה (@page ב-app.css), במ"מ. לוח מקובץ (תמונה) מודפס בלי שוליים, על כל הדף
/** השטח להדפסה בדף p (pageOf), במ"מ. מ"מ אחד פחות בגובה, כדי שעיגול של הדפדפן לא ישבור לעמוד נוסף */
const printArea = (p, design) => { const m = design ? 0 : PRINT_MARGIN; return { w: p.w - 2 * m, h: p.h - 2 * m - 1 }; };

/**
 * גודל הדף בהדפסה (@page) והרוחב של הלוח בהדפסה, לפי התבנית t.
 * בדף גדול מ-A4 הלוח מוגדל (--zoom) כך שהוא ממלא את הדף כמו ב-A4.
 */
function applyPage(t) {
  const p = pageOf(t), el = $('luach');
  let st = $('pageStyle');
  if (!st) { st = document.createElement('style'); st.id = 'pageStyle'; document.head.appendChild(st); }
  st.textContent = '@page { size: ' + p.size + '; }';
  el.style.setProperty('--page-w', printArea(p, current && current.design).w + 'mm');
  el.style.setProperty('--zoom', String(p.k));
}

/**
 * החלוקה של הלוח לעמודים כמו בהדפסה: שוברים רק בין יחידות שלמות (שורה בטבלה, כותרת, הודעה),
 * כותרת של קטע נשארת עם השורה הראשונה שלו, וכותרת טבלת ימי החול חוזרת בראש כל עמוד.
 * H – גובה העמוד בפיקסלים. מחזיר את מספר העמודים ואת החלק (0–1) של העמוד האחרון שבשימוש.
 */
function paginate(el, H) {
  const units = [];
  const unit = (a, b, repeat = 0) => {
    const r1 = a.getBoundingClientRect(), r2 = b.getBoundingClientRect();
    if (r2.bottom > r1.top) units.push({ top: r1.top, bottom: r2.bottom, repeat });
  };
  // בלוח בעמודות כל עמודה נשברת לעמודים לחוד, ומספר העמודים נקבע לפי העמודה הארוכה
  const h = x => x.getBoundingClientRect().height;
  const kids = [...el.children].flatMap(c => c.matches('.l-cols') ? [...[...c.children].reduce((a, b) => h(b) > h(a) ? b : a).children] : [c]);
  for (const c of kids) {
    const rows = c.matches('.l-sec, .l-grid-wrap') ? [...c.querySelectorAll('tbody tr')] : [];
    if (rows.length < 2) { unit(c, c); continue; }
    const thead = c.querySelector('thead');
    // הכותרת (שורת הכותרת של הקטע, או ה-thead) יחד עם השורה הראשונה
    const repeat = thead ? thead.getBoundingClientRect().height : 0;
    unit(thead || rows[0], thead ? rows[0] : rows[1]);
    rows.slice(thead ? 1 : 2).forEach(tr => unit(tr, tr, repeat));
  }
  const top = el.getBoundingClientRect().top;
  let start = top, extra = 0, pages = 1, end = top;
  for (const u of units) {
    if (u.bottom - start + extra > H && u.top > start) { pages++; start = u.top; extra = u.repeat; }
    // יחידה ארוכה מעמוד שלם נשברת באמצע
    while (u.bottom - start + extra > H) { pages++; start += H - extra; extra = 0; }
    end = u.bottom;
  }
  return { pages, last: (end - start + extra) / H };
}

function fitPrint() {
  const el = $('luach');
  unfitPrint();
  // מצב העריכה (קווים מקווקווים סביב כל טקסט) לא נכנס להדפסה
  el.classList.remove('editing');
  if (!current || !el.offsetParent) return;
  const p = pageOf(current.tpl), area = printArea(p, current.design), H = area.h * MM;
  if (current.design) {
    for (const lp of el.querySelectorAll('.lp')) {
      const img = lp.querySelector('img');
      if (!img.naturalWidth) continue;
      const pages = area.w * img.naturalHeight / img.naturalWidth / area.h, n = Math.ceil(pages - 1e-6);
      if (n > 1 && pages - (n - 1) <= 0.5) { lp.classList.add('fit'); lp.style.setProperty('--fit-h', (n - 1) * area.h + 'mm'); }
    }
    return;
  }
  el.classList.add('fit-measure');
  const first = paginate(el, H), target = first.pages - 1;
  if (!target || first.last > 0.5) { el.classList.remove('fit-measure'); return; }
  const fits = () => paginate(el, H).pages <= target;
  for (let gap = 0.9; !fits() && gap >= 0.4; gap = Math.round((gap - 0.1) * 10) / 10) el.style.setProperty('--fit-gap', String(gap));
  // הקווים נשארים ברוחב פיקסל שלם גם בהקטנה, והשבירה היא רק בין שורות, ולכן מודדים שוב אחרי כל הקטנה עד שהלוח נכנס
  for (let zoom = 1, i = 0; i < 30; i++) {
    const r = paginate(el, H);
    if (r.pages <= target) break;
    zoom = Math.floor(zoom * Math.min(0.99, target / (r.pages - 1 + r.last)) * 1000) / 1000;
    el.style.setProperty('--zoom', String(p.k * zoom));
  }
  el.classList.replace('fit-measure', 'fit');
}
function unfitPrint() {
  const el = $('luach');
  el.classList.remove('fit', 'fit-measure');
  el.classList.toggle('editing', !!current && boardEditing && !current.design);
  el.style.removeProperty('--fit-gap');
  if (current) el.style.setProperty('--zoom', String(pageOf(current.tpl).k));
  el.querySelectorAll('.lp.fit').forEach(lp => { lp.classList.remove('fit'); lp.style.removeProperty('--fit-h'); });
}
window.addEventListener('beforeprint', fitPrint);
window.addEventListener('afterprint', unfitPrint);

/* ---------- הגדרות ---------- */

$('city').innerHTML = CITIES.map(c => '<option value="' + c[0] + '">' + esc(c[1]) + '</option>').join('') +
  '<option value="custom">מיקום אחר (קואורדינטות)</option>';

const zones = (Intl.supportedValuesOf && Intl.supportedValuesOf('timeZone')) || ['Asia/Jerusalem', 'Europe/London', 'America/New_York'];
$('tz').innerHTML = zones.map(z => '<option>' + esc(z) + '</option>').join('');

$('font').innerHTML = FONTS.map(f => '<option value="' + f[0] + '">' + esc(f[1]) + '</option>').join('');
$('theme').innerHTML = THEMES.map(x => '<option value="' + x[0] + '">' + esc(x[1]) + '</option>').join('');
$('paper').innerHTML = PAPERS.map(x => '<option>' + x[0] + '</option>').join('');
$('orient').innerHTML = ORIENTS.map(x => '<option value="' + x[0] + '">' + esc(x[1]) + '</option>').join('');
$('cols').innerHTML = COLUMNS.map(n => '<option value="' + n + '">' + (n === 1 ? 'עמודה אחת' : n + ' עמודות') + '</option>').join('');

const opts = (list, v) => list.map(x => Array.isArray(x)
  ? '<option value="' + x[0] + '"' + (x[0] === v ? ' selected' : '') + '>' + esc(x[1]) + '</option>'
  : '<option' + (x === v ? ' selected' : '') + '>' + esc(x) + '</option>').join('');
const selTpl = () => cfg.templates.find(t => t.id === sel) || cfg.templates[0];
const rules = () => selTpl().rules;

/** אפשרויות "לפי": זמני היום, ואחריהם התפילות האחרות (שעה שתלויה בתפילה) */
const baseOpts = r => {
  const names = prayerBases(rules(), r);
  if (r.base && !(r.base in BASES) && names.indexOf(r.base) < 0) names.push(r.base);
  return opts(BASE_LABELS, r.base) + (names.length ? '<optgroup label="לפי תפילה">' + opts(names, r.base) + '</optgroup>' : '');
};

function fill() {
  $('shul').value = cfg.shul || '';
  $('address').value = cfg.address || '';
  $('city').value = cfg.city || 'custom';
  $('candle').value = cfg.candle;
  $('lat').value = cfg.lat; $('lng').value = cfg.lng;
  if (zones.indexOf(cfg.tz) < 0) $('tz').insertAdjacentHTML('afterbegin', '<option>' + esc(cfg.tz) + '</option>');
  $('tz').value = cfg.tz;
  $('il').value = cfg.il ? '1' : '0';
  $('havdalah').value = String(cfg.havdalah);
  $('custom').hidden = cfg.city !== 'custom';
  renderTemplates();
}

/* ---------- תבניות ---------- */

const RULES_HINT = {
  holy: '"כניסה" הוא ערב שבת או חג, "כל יום" חל על כל יום של השבת או החג, ו"יציאה" הוא המוצאי. בשעה קבועה כותבים את השעה בשדה, למשל 08:00.',
  days: 'בלוח של ימי חול כל עמודה היא יום. ב"חל על" בוחרים באילו ימים התפילה מתקיימת. מנחה וערבית של ערב שבת או חג מופיעות בלוח השבת או החג. בשעה קבועה כותבים את השעה בשדה, למשל 06:30.'
};

function renderTemplates() {
  if (!cfg.templates.some(t => t.id === sel)) sel = cfg.templates[0].id;
  const t = selTpl();
  tplChips($('tplList'), t.id, 'settings');
  const b = BUILTIN.find(x => x.id === t.id);
  if (b) $('tplInfo').innerHTML = '<p class="hint">' + esc(b.about) + ' תבנית שתוסיפו למועד מסוים גוברת עליה.</p>';
  else {
    const groups = [...new Set(MOADIM.filter(m => m[2] === t.kind).map(m => m[3]))];
    $('tplInfo').innerHTML =
      '<div class="field"><label for="tplName">שם התבנית</label><input id="tplName" value="' + esc(t.name) + '" autocomplete="off"></div>' +
      '<label>מתי התבנית חלה</label>' +
      groups.map(g => '<fieldset class="moadim"><legend>' + esc(g) + '</legend>' +
        MOADIM.filter(m => m[3] === g).map(m => '<label class="check"><input type="checkbox" data-moed="' + m[0] + '"' +
          (t.moadim.indexOf(m[0]) >= 0 ? ' checked' : '') + '> ' + esc(m[1]) + '</label>').join('') + '</fieldset>').join('') +
      '<p class="hint" id="moadimHint"></p>' +
      '<p class="hint">' + (t.kind === 'days' ? 'לוח ימי חול (שבועי או חול המועד) שיש בו אחד המועדים יוצג בתבנית הזו.'
        : 'שבת או חג שהם אחד המועדים יוצגו בתבנית הזו.') + '</p>' +
      '<div class="actions left"><button type="button" class="danger" id="tplDelete">מחיקת התבנית</button></div>';
    renderMoadimHint();
  }
  $('rulesTplName').textContent = t.name;
  $('designTplName').textContent = t.name;
  $('rulesHint').textContent = RULES_HINT[t.kind];
  $('fontTplName').textContent = t.name;
  document.querySelectorAll('.imp').forEach(closeImport);
  renderRules();
  renderTemplateStatus();
  renderFont();
}

/* ---------- גופן וגדלים של התבנית ---------- */

function renderFont() {
  const t = selTpl();
  $('font').value = t.font;
  $('theme').value = t.theme;
  $('paper').value = t.paper;
  $('orient').value = t.orient;
  $('cols').value = String(t.cols);
  // בלוח ימי חול כל עמודה היא יום, ואין חלוקה לעמודות
  $('colsField').hidden = t.kind === 'days';
  $('sizes').innerHTML = SIZE_PARTS.map(([k, label]) => '<div><label for="size-' + k + '">גודל ' + esc(label) + '</label>' +
    '<select id="size-' + k + '" data-size="' + k + '">' +
    SIZES.map(v => '<option value="' + v + '"' + (v === t.sizes[k] ? ' selected' : '') + '>' + v + '%</option>').join('') + '</select></div>').join('');
  renderFontSample();
  renderLayouts();
}

/** לוחות לדוגמה לבחירת תבנית התצוגה, לפי סוג הלוח */
const LAYOUT_SAMPLES = {
  holy: {
    type: 'holy', shul: 'בית הכנסת', title: 'שבת פרשת בראשית', dates: 'כ״ה תשרי תשפ״ז', sections: [
      { title: 'ערב שבת', date: 'ו׳ 2.10', rows: [{ name: 'מנחה וקבלת שבת', text: '18:15' }], zmanim: [['הדלקת נרות', '17:52'], ['שקיעה', '18:12']] },
      { title: 'יום השבת', date: 'ש׳ 3.10', rows: [{ name: 'שחרית', text: '08:00' }, { name: 'מנחה', text: '17:30' }, { name: 'ערבית', text: '18:55' }], zmanim: [] }
    ]
  },
  days: {
    type: 'days', shul: 'בית הכנסת', title: 'ימות השבוע', dates: 'כ״ו תשרי – א׳ חשוון תשפ״ז',
    days: ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי'].map((name, i) => ({ name, date: (4 + i) + '.10', special: '' })),
    rows: [['שחרית', '06:30'], ['מנחה', '17:55'], ['ערבית', '18:40']].map(([name, v]) => ({ name, cells: Array(5).fill(v) })),
    zmanim: [{ name: 'שקיעה', cells: ['18:10', '18:09', '18:08', '18:07', '18:06'] }]
  }
};
/**
 * לוחות שהועלו בקהילה ושאפשר להציג בהם את התבנית t: עיצוב שנשמר בתבנית עצמה (לא שיוך),
 * רק מתבניות מאותו סוג, כי האזורים בקובץ בנויים לפי סוג הלוח
 */
const uploadedDesigns = t => cfg.templates.filter(x => x.kind === t.kind && x.design && !x.design.ref);

let moreLayouts = false;   // האם נלחץ "הצג עוד תבניות"

/** תבניות התצוגה: המוכנות של האתר, ואחריהן הלוחות שהועלו בקהילה והעלאת לוח חדש */
function renderLayouts() {
  const t = selTpl(), sample = withEdits(LAYOUT_SAMPLES[t.kind], {});
  const active = activeDesign(cfg, t) ? (t.design.ref || t.id) : null;
  const card = (attr, pressed, thumb, name, about) => '<button type="button" class="lay-card" ' + attr + ' aria-pressed="' + pressed + '">' +
    '<div class="lay-thumb" aria-hidden="true">' + thumb + '</div><b>' + esc(name) + '</b><small>' + esc(about) + '</small></button>';
  // בלי "הצג עוד" – התבניות הראשונות, ותמיד גם התבנית שנבחרה
  const shown = LAYOUTS.filter(([id], i) => moreLayouts || i < LAYOUTS_SHOWN || id === t.layout);
  $('layoutsMore').textContent = moreLayouts ? 'הצג פחות עיצובים' : 'הצג עוד עיצובים';
  $('layoutsMore').setAttribute('aria-expanded', String(moreLayouts));
  $('layouts').innerHTML =
    shown.map(([id, name, about]) => card('data-layout="' + id + '"', !active && id === t.layout, '<div class="luach"></div>', name, about)).join('') +
    uploadedDesigns(t).map(x => card('data-design="' + esc(x.id) + '"', active === x.id, '<img src="' + esc(x.design.image) + '" alt="">',
      x === t ? 'הלוח שהועלה לתבנית הזו' : 'הלוח של "' + x.name + '"', 'לוח שהועלה בקהילה: ' + x.design.name)).join('') +
    card('data-upload="1"', false, '<span class="lay-plus">+</span>', 'העלאת לוח משלכם', 'PDF או תמונה של לוח ישן. הוא יתווסף לעיצובים של הקהילה');
  paintLayoutThumbs($('layouts'), t, sample);
}

function paintLayoutThumbs(host, t, sample) {
  host.querySelectorAll('.lay-card[data-layout]').forEach(c => {
    const el = c.querySelector('.luach');
    applyDesign(el, t, c.dataset.layout);
    el.innerHTML = luachHtml(sample, false, t.cols);
  });
}

/** כל העיצובים המוכנים של המערכת (בלי לוחות שהועלו) כקלפי בחירה בתוך host, לאשף ההתחלה */
function drawSystemLayouts(host, selected) {
  const t = selTpl();
  host.innerHTML = LAYOUTS.map(([id, name, about]) => '<button type="button" class="lay-card" data-layout="' + id + '" aria-pressed="' + (id === selected) + '">' +
    '<div class="lay-thumb" aria-hidden="true"><div class="luach"></div></div><b>' + esc(name) + '</b><small>' + esc(about) + '</small></button>').join('');
  paintLayoutThumbs(host, t, withEdits(LAYOUT_SAMPLES[t.kind], {}));
}

/** הצגת התבנית t בלוח שהועלה לתבנית src (או לה עצמה). עיצוב שהועלה ל-t נשמר לתבניות שמשתמשות בו */
async function useDesign(t, src) {
  if (src === t) t.design.enabled = true;
  else {
    if (t.design && !t.design.ref) {
      if (!await SiteDialog.confirm('לתבנית "' + t.name + '" יש לוח שהועלה אליה. להחליף אותו בלוח של "' + src.name + '"?', { ok: 'החלפה' })) return;
      for (const x of cfg.templates) if (x.design && x.design.ref === t.id) x.design = { ...t.design, enabled: x.design.enabled !== false };
    }
    const prev = t.design;
    t.design = { ref: src.id, enabled: true };
    if (!store()) { t.design = prev; toast('לא ניתן לשמור במכשיר הזה', true); return; }
  }
  renderTemplateStatus(); renderLayouts(); changed();
}

$('layoutsMore').addEventListener('click', () => { moreLayouts = !moreLayouts; renderLayouts(); });

$('layouts').addEventListener('click', e => {
  const c = e.target.closest('.lay-card');
  if (!c) return;
  const t = selTpl();
  if (c.dataset.upload) { $('tplFile').click(); return; }
  if (c.dataset.design) { const src = cfg.templates.find(x => x.id === c.dataset.design); if (src) useDesign(t, src); return; }
  t.layout = c.dataset.layout;
  // הלוח שהועלה נשאר שמור, ואפשר לחזור אליו מכאן
  if (t.design) t.design.enabled = false;
  renderTemplateStatus(); renderLayouts(); changed();
});
function renderFontSample() {
  const t = selTpl(), el = $('fontSample');
  applyDesign(el, t);
  el.innerHTML = '<span style="font-family: var(--f-title); font-weight: 900; color: var(--blue); font-size: calc(1.3rem * var(--s-title))">שבת פרשת בראשית</span> · ' +
    '<span style="font-family: var(--f-body); color: var(--ink); font-size: calc(1rem * var(--s-name))">מנחה</span> ' +
    '<b style="font-family: var(--f-body); color: var(--ink); font-size: calc(1rem * var(--s-time))">17:25</b> · ' +
    '<span style="font-family: var(--f-body); color: var(--muted); font-size: calc(.8rem * var(--s-zman))">שקיעה 18:05</span>';
}
$('sizes').addEventListener('input', e => {
  const k = e.target.dataset.size;
  if (!k) return;
  selTpl().sizes[k] = Number(e.target.value);
  renderFontSample(); renderLayouts(); changed();
});

/* ---------- ייבוא מתבנית אחרת: זמנים, עיצוב, גופן וגדלים ---------- */
/* בוחרים תבנית, ההגדרות שלה נפתחות, ומסמנים מה לייבא: תפילה או שיעור מסוים, רק ערכת הצבעים, רק גודל הכותרת וכו'. */

const kindName = kind => kind === 'days' ? 'ימי חול' : 'שבת או חג';

/**
 * מה אפשר לייבא מהתבנית src לחלק part בתבנית t: [{ key, label, note, on }].
 * on – מסומן מראש (לא מסומן כשהערך כבר כמו בתבנית t).
 * לוח שהועלה – רק מתבנית מאותו סוג, כי האזורים שלו בנויים לפי סוג הלוח.
 */
function importItems(part, src, t) {
  const nameIn = (list, v) => (list.find(x => x[0] === v) || [v, v])[1];
  const item = (key, label, note, same) => ({ key, label, note: note + (same ? ' · כמו עכשיו' : ''), on: !same });
  if (part === 'rules') {
    const days = t.kind === 'days';
    return convertRules(src.rules, t.kind).map((r, i) => ({ key: String(i), label: r.name || 'תפילה בלי שם', note: ruleSum(r, days), on: true, rule: r }));
  }
  if (part === 'design') {
    const d = src.kind === t.kind && designOf(cfg, src), board = !!activeDesign(cfg, src);
    const out = [{ key: 'layout', label: 'עיצוב המערכת', note: nameIn(LAYOUTS, src.layout) + (board ? ' (התבנית משתמשת עכשיו בלוח שהועלה)' : ''),
      on: !board && (src.layout !== t.layout || !!activeDesign(cfg, t)) }];
    if (d) out.push({ key: 'board', label: 'הלוח שהועלה', note: d.name + ' – מיובא כעותק נפרד', on: board });
    return out;
  }
  return [
    item('theme', 'ערכת צבעים', nameIn(THEMES, src.theme), src.theme === t.theme),
    item('font', 'גופן הלוח', nameIn(FONTS, src.font), src.font === t.font),
    ...SIZE_PARTS.map(([k, label]) => item('size-' + k, 'גודל ' + label, src.sizes[k] + '%', src.sizes[k] === t.sizes[k])),
    item('paper', 'גודל הדף', src.paper, src.paper === t.paper),
    item('orient', 'כיוון הדף', nameIn(ORIENTS, src.orient), src.orient === t.orient),
    // בלוח ימי חול אין חלוקה לעמודות
    ...(t.kind === 'days' ? [] : [item('cols', 'חלוקה לעמודות', src.cols === 1 ? 'בלי חלוקה' : src.cols + ' עמודות', src.cols === t.cols)])
  ];
}

function closeImport(box) {
  box.querySelector('.imp-form').hidden = true;
  box.querySelector('.imp-open').hidden = false;
  box.querySelector('.imp-hint').hidden = true;
  box.querySelector('.imp-items').innerHTML = '';
  box.items = null;
}
function openImport(box) {
  const t = selTpl(), list = cfg.templates.filter(x => x !== t), hint = box.querySelector('.imp-hint');
  if (!list.length) {
    hint.textContent = 'אין תבניות אחרות.';
    hint.hidden = false;
    return;
  }
  box.querySelector('.imp-from').innerHTML = list.map(x => '<option value="' + esc(x.id) + '">מ' + esc(x.name) + '</option>').join('');
  box.querySelector('.imp-open').hidden = true;
  box.querySelector('.imp-form').hidden = false;
  renderImportItems(box);
}

/** ההגדרות של התבנית שנבחרה, עם תיבת סימון לכל אחת */
function renderImportItems(box) {
  const part = box.dataset.part, t = selTpl(), hint = box.querySelector('.imp-hint');
  const src = cfg.templates.find(x => x.id === box.querySelector('.imp-from').value);
  box.items = src ? importItems(part, src, t) : [];
  box.querySelector('.imp-items').innerHTML = !box.items.length
    ? '<p class="hint">' + (part === 'rules' && src ? 'אין זמני תפילות בתבנית "' + esc(src.name) + '".' : 'אין מה לייבא.') + '</p>'
    : (box.items.length > 2 ? '<button type="button" class="link imp-all"></button>' : '') +
      box.items.map(x => '<label class="check"><input type="checkbox" data-item="' + esc(x.key) + '"' + (x.on ? ' checked' : '') + '>' +
        '<span>' + esc(x.label) + '<small>' + esc(x.note) + '</small></span></label>').join('');
  const notes = [];
  if (part === 'rules') notes.push('בייבוא בין לוח של שבת/חג ללוח של ימי חול, "מתי" ו"חל על" מתאימים את עצמם לסוג הלוח. כדאי לעבור על הזמנים אחרי הייבוא.');
  if (part === 'design' && src && src.kind !== t.kind && designOf(cfg, src)) notes.push('את הלוח שהועלה ל"' + src.name + '" אי אפשר לייבא, כי הוא בנוי ללוח של ' + kindName(src.kind) + ' והתבנית הזו היא של ' + kindName(t.kind) + '.');
  if (part === 'font') notes.push('הגופן, הצבעים והגדלים חלים על לוחות המערכת. גודל הדף, הכיוון והעמודות – גם על לוח שהועלה.');
  hint.textContent = notes.join(' ');
  hint.hidden = !notes.length;
  updateImportPick(box);
}

/** כפתור הייבוא פעיל רק כשמשהו מסומן, וכפתור "סימון הכל" מתחלף ל"ניקוי הסימון" */
function updateImportPick(box) {
  const boxes = [...box.querySelectorAll('.imp-items input[type="checkbox"]')], n = boxes.filter(x => x.checked).length;
  box.querySelector('.imp-ok').disabled = !n;
  const all = box.querySelector('.imp-all');
  if (all) all.textContent = n === boxes.length ? 'ניקוי הסימון' : 'סימון הכל';
}

/** זמני התפילות של תבנית אחרת, מותאמים לסוג הלוח של התבנית kind */
function convertRules(list, kind) {
  const out = [];
  for (const r of list) {
    const x = { ...r }, isDay = DAY_APPLIES.indexOf(x.applies) >= 0;
    if (kind === 'days' && !isDay) Object.assign(x, { when: 'כל יום', applies: 'כל הימים' });
    if (kind === 'holy' && isDay) Object.assign(x, { when: 'כל יום', applies: 'שבת וחג' });
    if (!out.some(y => y.name === x.name && y.when === x.when && y.applies === x.applies)) out.push(x);
  }
  return out;
}

async function doImport(box) {
  const part = box.dataset.part, t = selTpl();
  const src = cfg.templates.find(x => x.id === box.querySelector('.imp-from').value);
  const checked = new Set([...box.querySelectorAll('.imp-items input:checked')].map(x => x.dataset.item));
  const picked = (box.items || []).filter(x => checked.has(x.key));
  if (!src || !picked.length) return;
  if (part === 'rules') {
    const list = picked.map(x => x.rule);
    if (box.querySelector('.imp-how').value === 'replace') t.rules = list.map(r => ({ ...r }));
    else {
      // תפילה שכבר יש בתבנית (אותו שם, ואותו "מתי" או "חל על") מתעדכנת במקומה, והשאר מתווספות בסוף
      const same = t.kind === 'days' ? (a, b) => a.name === b.name && a.applies === b.applies : (a, b) => a.name === b.name && a.when === b.when;
      const out = t.rules.map(x => ({ ...(list.find(r => same(x, r)) || x) }));
      for (const r of list) if (!out.some(x => same(x, r))) out.push({ ...r });
      t.rules = out;
    }
    toast((list.length === 1 ? '"' + (list[0].name || 'תפילה בלי שם') + '" יובא' : list.length + ' זמנים יובאו') + ' מ' + src.name);
  } else if (part === 'design') {
    const board = checked.has('board');
    if (board) {
      const d = designOf(cfg, src);
      if (designOf(cfg, t) && !await SiteDialog.confirm('להחליף את הלוח שהועלה ל"' + t.name + '" בלוח של "' + src.name + '"?', { ok: 'החלפה' })) return;
      // תבניות שמשתמשות בעיצוב הקודם של התבנית הזו שומרות עליו
      if (t.design && !t.design.ref) {
        for (const x of cfg.templates) if (x.design && x.design.ref === t.id) x.design = { ...t.design, enabled: x.design.enabled !== false };
      }
      const prev = t.design;
      t.design = { ...JSON.parse(JSON.stringify(d)), enabled: true };   // עותק נפרד
      if (!store()) { t.design = prev; toast('אין מספיק מקום במכשיר לעותק של העיצוב', true); return; }
    }
    if (checked.has('layout')) {
      t.layout = src.layout;
      // בלי הלוח שהועלה – עוברים לעיצוב המערכת. הלוח של התבנית נשאר שמור, ואפשר לחזור אליו
      if (!board && t.design) t.design.enabled = false;
    }
    toast(board ? 'הלוח יובא מ' + src.name + '. זמני התפילות בו לפי התבנית "' + t.name + '"' : 'עיצוב המערכת יובא מ' + src.name);
  } else {
    for (const { key } of picked) {
      if (key.startsWith('size-')) t.sizes[key.slice(5)] = src.sizes[key.slice(5)];
      else t[key] = src[key];
    }
    toast(picked.map(x => x.label).join(', ') + ' – יובאו מ' + src.name);
  }
  closeImport(box);
  renderRules(); renderTemplateStatus(); renderFont();
  changed();
}

document.querySelectorAll('.imp').forEach(box => {
  box.querySelector('.imp-open').onclick = () => openImport(box);
  box.querySelector('.imp-cancel').onclick = () => closeImport(box);
  box.querySelector('.imp-ok').onclick = () => doImport(box);
  box.querySelector('.imp-from').onchange = () => renderImportItems(box);
  const items = box.querySelector('.imp-items');
  items.addEventListener('change', () => updateImportPick(box));
  items.addEventListener('click', e => {
    if (!e.target.closest('.imp-all')) return;
    const boxes = [...items.querySelectorAll('input[type="checkbox"]')], all = boxes.some(x => !x.checked);
    boxes.forEach(x => { x.checked = all; });
    updateImportPick(box);
  });
});

function renderMoadimHint() {
  const t = selTpl();
  if (isBuiltin(t)) return;
  $('moadimHint').textContent = t.moadim.length ? '' : 'בחרו לפחות מועד אחד. בלי מועד התבנית לא תופעל.';
}

$('tplList').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.add) { openNewTemplate('settings'); return; }
  flush();
  $('tplNew').hidden = true;
  setBoard(b.dataset.t);
});

$('tplInfo').addEventListener('input', e => {
  const t = selTpl();
  if (e.target.id === 'tplName') {
    t.name = e.target.value.trim() || 'תבנית';
    $('tplList').querySelector('[aria-pressed="true"]').textContent = t.name;
    $('rulesTplName').textContent = t.name;
    $('designTplName').textContent = t.name;
    changed();
  }
  const id = e.target.dataset.moed;
  if (id) {
    t.moadim = t.moadim.filter(x => x !== id);
    if (e.target.checked) t.moadim.push(id);
    renderMoadimHint();
    changed();
  }
});
$('tplInfo').addEventListener('click', async e => {
  if (e.target.id !== 'tplDelete') return;
  const t = selTpl();
  if (!await SiteDialog.confirm('למחוק את התבנית "' + t.name + '"?', { ok: 'מחיקה', danger: true })) return;
  cfg.templates = cfg.templates.filter(x => x !== t);
  setBoard('shabbat'); changed();
});

function fillNewFrom() {
  const kind = $('tplNewKind').value;
  $('tplNewFrom').innerHTML = cfg.templates.filter(t => t.kind === kind)
    .map(t => '<option value="' + esc(t.id) + '">העתקה מ' + esc(t.name) + '</option>').join('') + '<option value="">בלי תפילות</option>';
}
/** טופס תבנית חדשה. הוא אחד, ועובר ללוח או להגדרות לפי המקום שממנו נפתח */
let newTplHost = 'settings';
function openNewTemplate(host) {
  newTplHost = host;
  (host === 'luach' ? $('mixOffer') : $('tplInfo')).before($('tplNew'));
  $('tplNew').hidden = false;
  $('tplNewName').value = '';
  $('tplNewKind').value = host === 'luach' ? boardTpl().kind : 'holy';
  fillNewFrom();
  $('tplNewName').focus();
}
$('tplNewKind').onchange = fillNewFrom;
$('tplNewCancel').onclick = () => { $('tplNew').hidden = true; };
$('tplNewOk').onclick = () => {
  const name = $('tplNewName').value.trim();
  if (!name) { $('tplNewName').focus(); toast('כתבו שם לתבנית', true); return; }
  const from = cfg.templates.find(t => t.id === $('tplNewFrom').value);
  const t = newTemplate(name, $('tplNewKind').value, from ? from.rules : []);
  cfg.templates.push(t);
  $('tplNew').hidden = true;
  setBoard(t.id); changed();
  toast(newTplHost === 'luach' ? 'התבנית נוצרה. בהגדרות בוחרים באילו מועדים היא חלה' : 'התבנית נוצרה. בחרו מתי היא חלה');
};

const openRules = new WeakSet();   // תפילות שהשורה שלהן פתוחה לעריכה

/** ערך מוחלט (בדקות) של הפרש הכלל, להצגה בשדה המספר */
const offsetAbs = r => { const n = parseInt(r.offset, 10); return isNaN(n) ? '' : String(Math.abs(n)); };
/** כיוון הפרש הכלל – "לפני" או "אחרי", להצגה בתיבת הבחירה */
const offsetDir = r => (parseInt(r.offset, 10) < 0 ? 'לפני' : 'אחרי');

/** תקציר לשורה הסגורה: מתי, על מה חל, ולפי מה */
function ruleSum(r, days) {
  const n = parseInt(r.offset, 10) || 0;
  const at = r.base === 'שעה קבועה' ? 'בשעה ' + (r.offset || '')
    : TEXT_BASES.includes(BASES[r.base]) ? r.base
    : n ? Math.abs(n) + ' דק׳ ' + (n < 0 ? 'לפני ' : 'אחרי ') + r.base : r.base;
  return [days ? '' : r.when, r.applies, at].filter(Boolean).join(' · ');
}

function renderRules() {
  const days = selTpl().kind === 'days';
  $('rules').innerHTML = rules().map((r, i) => {
    const fixed = r.base === 'שעה קבועה';
    const text = TEXT_BASES.includes(BASES[r.base]);   // קידוש או אירועים: טקסט מהקהילה, בלי הפרש ועיגול
    return '<details class="rule" data-i="' + i + '"' + (openRules.has(r) ? ' open' : '') + '>' +
      '<summary><b class="rule-name">' + (esc(r.name) || 'תפילה חדשה') + '</b><span class="rule-sum">' + esc(ruleSum(r, days)) + '</span></summary>' +
      '<div class="rule-top">' +
      '<input data-k="name" value="' + esc(r.name) + '" placeholder="שם התפילה או השיעור" aria-label="שם התפילה">' +
      '<button type="button" data-del="' + i + '" aria-label="מחיקת ' + esc(r.name) + '">מחיקה</button></div>' +
      '<div class="rgrid">' +
      (days ? '' : '<div><label>מתי</label><select data-k="when">' + opts(WHEN_LABELS, r.when) + '</select></div>') +
      '<div><label>חל על</label><select data-k="applies">' + opts(days ? DAY_APPLIES : APPLIES, r.applies) + '</select></div>' +
      '<div><label>לפי</label><select data-k="base">' + baseOpts(r) + '</select></div>' +
      (text ? ''
        : fixed ? '<div><label>שעה</label><input data-k="offset" value="' + esc(r.offset) +
          '" placeholder="08:00" dir="ltr" inputmode="text"></div>'
        : '<div><label>הפרש (דקות)</label><div class="offset-pair"><input data-k="offsetAbs" type="number" min="0" inputmode="numeric" dir="ltr" value="' +
          esc(offsetAbs(r)) + '" placeholder="20"><select data-k="offsetDir">' + opts(['אחרי', 'לפני'], offsetDir(r)) + '</select></div></div>') +
      '<div><label>עיגול</label><select data-k="round"' + (fixed || text ? ' disabled' : '') + '>' + opts(ROUND, r.round) + '</select></div>' +
      '</div>' + (BASES[r.base] === 'kiddush' ? '<p class="hint">השורה תתמלא בהודעה בנוסח שהגבאי קבע בלוח הקידושים של הקהילה, ' +
        'לפי מי שאושר לקידוש בתאריך הזה. בלי קידוש מאושר, השורה לא תופיע.</p>'
        : BASES[r.base] === 'events' ? '<p class="hint">השורה תתמלא באירועים מיומן הקהילה שחלים בתאריך הזה' +
          (days ? '' : ' (ב"כניסה" – ביום שלפני השבת או החג)') + ', באירועים שנבחר להציג בהם "שורה בלוח הזמנים". בלי אירוע, השורה לא תופיע.</p>' : '') +
      '</details>';
  }).join('');
}
$('rules').addEventListener('toggle', e => {
  const r = rules()[+e.target.getAttribute('data-i')];
  if (r) e.target.open ? openRules.add(r) : openRules.delete(r);
}, true);

/* ---------- שמירה וסנכרון ---------- */

let sync = null, syncSid = null;
let remoteLater = null;   // [הגדרות, מי שמר] מגבאי אחר, שממתינות לסיום עריכת תבנית מקובץ

/** שמירה במכשיר ובקהילה. false – לא נשמר בשום מקום */
let localSaved = true;   // האם השמירה האחרונה במכשיר הצליחה (בקהילה היא יכולה להצליח גם כשהמכשיר מלא)
function store() {
  const ok = localSaved = saveConfig(cfg);
  if (sync) { remoteLater = null; sync.push(cfg); }
  return ok || !!sync;
}

/** הגדרות חדשות מהקהילה. שינוי שלנו שעוד לא נשמר גובר עליהן, ובעריכת תבנית מקובץ הן ממתינות לסיום */
function applyRemote(next, by) {
  if (saveTimer) return;
  // בעריכת תבנית מקובץ ההגדרות מהקהילה ממתינות
  if (!$('view-template').hidden) { remoteLater = [next, by]; return; }
  remoteLater = null;
  closeWizard();
  cfg = next; saved = true;
  saveConfig(cfg);
  fill(); renderLuach(); renderProfiles();
  if (by) toast('ההגדרות עודכנו (' + by + ')');
}

/** sid – הקהילה שהמשתמש גבאי או רב בה, או null */
function manageSync(sid) {
  if (sid === syncSid) return;
  flush();
  if (sync) { sync.stop(); sync = null; }
  syncSid = sid; remoteLater = null;
  if (sid) sync = startSync({ client: window.SiteAuth.client(), sid, getCfg: () => cfg, hasLocal: () => saved, apply: applyRemote, toast });
  watchProfiles();
}

let saveTimer;
function changed() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 400);
}
/* שמירה מיידית של שינוי שממתין לדיבאונס – כדי שמעבר בין תבניות, לשוניות, או סגירת האתר לא יאבדו אותו */
function flush() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  if (store()) { saved = true; toast('נשמר'); }
  else toast('לא ניתן לשמור במכשיר הזה (מצב גלישה פרטית?)', true);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
addEventListener('pagehide', flush);

const nameRef = new WeakMap();   // כלל ששמו נמחק זמנית ← השם הקודם
$('rules').addEventListener('input', e => {
  const box = e.target.closest('.rule'), k = e.target.getAttribute('data-k');
  if (!box || !k) return;
  const list = rules(), r = list[+box.getAttribute('data-i')];
  const oldName = String(r.name || '').trim();
  if (k === 'offsetAbs' || k === 'offsetDir') {
    const abs = k === 'offsetAbs' ? e.target.value.replace(/[^0-9]/g, '') : offsetAbs(r);
    const dir = k === 'offsetDir' ? e.target.value : offsetDir(r);
    r.offset = abs === '' ? '' : String(dir === 'לפני' ? -Math.abs(+abs) : +abs);
  } else r[k] = e.target.value;
  if (k === 'name') {
    // תפילות שתלויות בשם הקודם עוברות לשם החדש (גם אחרי מחיקה זמנית של כל השם),
    // ורשימות "לפי" מתעדכנות בלי לאבד את הפוקוס
    const name = r.name.trim(), ref = nameRef.has(r) ? nameRef.get(r) : oldName;
    if (!name) nameRef.set(r, ref);
    else {
      nameRef.delete(r);
      if (ref && ref !== name && !list.some(x => x !== r && String(x.name || '').trim() === ref))
        list.forEach(x => { if (x.base === ref) x.base = name; });
    }
    $('rules').querySelectorAll('.rule').forEach(el => {
      el.querySelector('[data-k="base"]').innerHTML = baseOpts(list[+el.getAttribute('data-i')]);
    });
  }
  if (k === 'base') {
    const text = TEXT_BASES.includes(BASES[r.base]);
    if (r.base === 'שעה קבועה' && r.offset.indexOf(':') < 0) r.offset = '08:00';
    if (text) r.offset = '';
    if (!text && r.base !== 'שעה קבועה' && r.offset.indexOf(':') >= 0) r.offset = '0';
    renderRules();
  } else {
    box.querySelector('.rule-name').textContent = r.name || 'תפילה חדשה';
    box.querySelector('.rule-sum').textContent = ruleSum(r, selTpl().kind === 'days');
  }
  changed();
});
$('rules').addEventListener('click', async e => {
  const i = e.target.getAttribute('data-del');
  if (i === null) return;
  const r = rules()[+i];
  if (!await SiteDialog.confirm('למחוק את התפילה "' + (r.name || 'תפילה חדשה') + '"?', { ok: 'מחיקה', danger: true })) return;
  rules().splice(+i, 1); renderRules(); changed();
});
$('addRule').onclick = () => {
  const r = { name: '', when: 'כל יום', applies: selTpl().kind === 'days' ? 'כל הימים' : 'שבת וחג', base: 'שקיעה', offset: '0', round: 'ללא' };
  rules().push(r); openRules.add(r);
  renderRules(); changed();
  $('rules').lastElementChild.querySelector('input').focus();
};

function setCity(id) {
  cfg.city = id;
  const c = CITIES.find(x => x[0] === id);
  if (c) Object.assign(cfg, { lat: c[2], lng: c[3], candle: c[4], tz: 'Asia/Jerusalem', il: true });
  cursor = null;
}
$('city').onchange = () => { setCity($('city').value); fill(); changed(); };

/* ---------- אשף התחלה ---------- */

function startWizard() {
  openWizard({
    cities: CITIES, layouts: LAYOUTS,
    start: { shul: cfg.shul, city: cfg.city, layout: cfg.templates[0].layout },
    drawLayouts: drawSystemLayouts,
    async onFinish({ shul, city, layout, file }) {
      if (shul) cfg.shul = shul;
      setCity(city);
      // עיצוב מוכן חל על כל התבניות. העלאת לוח חלה על תבנית השבת
      if (!file) for (const t of cfg.templates) t.layout = layout;
      if (!store()) { toast('לא ניתן לשמור במכשיר הזה', true); return; }
      saved = true; sel = 'shabbat';
      fill(); renderProfiles();
      setBoard('shabbat');
      showTab('luach');
      if (file) await uploadBoard(file);
      else toast('ההגדרות נשמרו');
    }
  });
}
$('startWizard').onclick = startWizard;
const bind = (id, fn) => $(id).addEventListener('input', () => { fn($(id).value); changed(); });
bind('shul', v => { cfg.shul = v; });
bind('address', v => { cfg.address = v; });
bind('candle', v => { cfg.candle = Number(v) || 0; });
bind('lat', v => { cfg.lat = Number(v); });
bind('lng', v => { cfg.lng = Number(v); });
bind('tz', v => { cfg.tz = v; cursor = null; });
bind('il', v => { cfg.il = v === '1'; cursor = null; });
bind('havdalah', v => { cfg.havdalah = v; });
bind('font', v => { selTpl().font = v; renderFontSample(); renderLayouts(); });
bind('theme', v => { selTpl().theme = v; renderFontSample(); renderLayouts(); });
bind('paper', v => { selTpl().paper = v; });
bind('orient', v => { selTpl().orient = v; });
bind('cols', v => { selTpl().cols = Number(v); renderLayouts(); });

/* ---------- עיצוב מלוח קיים ---------- */

function renderTemplateStatus() {
  const t = selTpl(), d = designOf(cfg, t), shared = !!(t.design && t.design.ref);
  const src = shared ? cfg.templates.find(x => x.id === t.design.ref) : t;
  const lay = LAYOUTS.find(x => x[0] === t.layout) || LAYOUTS[0];
  $('designCurrent').textContent = 'העיצוב הנבחר: ' + (activeDesign(cfg, t)
    ? (shared ? 'הלוח של "' + src.name + '"' : 'הלוח שהועלה לתבנית הזו') + ' – לוח שהועלה בקהילה'
    : lay[1] + ' – לוח של המערכת');
  $('tplStatus').hidden = !d;
  $('tplRemove').hidden = !d;
  $('designShared').hidden = !(d && shared);
  $('tplUpload').textContent = d ? 'העלאת לוח אחר' : 'העלאת לוח ישן (PDF או תמונה)';
  if (d) {
    $('tplStatus').textContent = 'קובץ: ' + d.name + ' (' + d.slots.length + ' אזורים)';
    if (shared) {
      $('designShared').textContent = 'העיצוב משותף עם התבנית "' + src.name + '". עריכה או העלאה כאן יוצרות עיצוב נפרד לתבנית הזו.';
    }
  }
}

/** fromBoard – העיצוב נוצר מלוח של המערכת, ולוח שהועלה לתבנית קודם עובר לתבניות שמשתמשות בו */
async function templateDone(result, fromBoard) {
  if (result) {
    const t = result.tpl, prev = { design: t.design, rules: t.rules };
    if (fromBoard && t.design && !t.design.ref) {
      for (const x of cfg.templates) if (x.design && x.design.ref === t.id) x.design = { ...t.design, enabled: x.design.enabled !== false };
    }
    t.design = result.template;
    t.rules = mergeRules(t.rules, result.rules, result.replace, t.kind);
    if (!store()) {
      Object.assign(t, prev);
      toast('הקובץ גדול מדי לשמירה במכשיר. נסו קובץ קטן יותר', true);
      showTab('settings');
      return;
    }
    saved = true;
    sel = t.id;
    fill();
    if (!localSaved) toast('העיצוב נשמר בקהילה אבל לא במכשיר הזה, כי הוא גדול מדי לאחסון בדפדפן. בפתיחה הבאה ייטענו ההגדרות מהקהילה', true);
    // מציגים את הלוח הקרוב שמשתמש בתבנית
    const p = periodFor(cfg, t, todayIn(cfg.tz));
    setBoard(t.id, p ? p.first : null);
    showTab('luach');
    toast('התבנית נשמרה');
    await offerDetected(result.detected);
  } else showTab('settings');
}

/** אם זוהו בקובץ הישן שם בית הכנסת ו/או כתובת ששונים מההגדרות – מציעים לעדכן, ולא כותבים בלי אישור */
async function offerDetected(d) {
  if (!d) return;
  const wantShul = d.shul && d.shul !== (cfg.shul || '').trim(), wantAddr = d.address && d.address !== (cfg.address || '').trim();
  if (!wantShul && !wantAddr) return;
  const was = v => v ? ' (במקום "' + v + '")' : '';
  const lines = [];
  if (wantShul) lines.push('שם בית הכנסת: "' + d.shul + '"' + was(cfg.shul));
  if (wantAddr) lines.push('כתובת: "' + d.address + '"' + was(cfg.address));
  const msg = 'זוהו בקובץ הישן הפרטים האלה:\n' + lines.join('\n') + '\nלעדכן אותם בהגדרות בית הכנסת?';
  if (!await SiteDialog.confirm(msg, { ok: 'מילוי' })) return;
  if (wantShul) cfg.shul = d.shul;
  if (wantAddr) cfg.address = d.address;
  store();
  fill();
  toast('הפרטים מולאו בהגדרות');
}

$('tplUpload').onclick = () => $('tplFile').click();
$('tplFile').onchange = async () => {
  const f = $('tplFile').files[0];
  $('tplFile').value = '';
  if (f) uploadBoard(f);
};
async function uploadBoard(f) {
  toast('קורא את הקובץ…');
  try {
    await editFromFile(f, cfg, selTpl(), templateDone, toast);
    showTab('template');
  } catch (e) {
    console.error(e);
    toast(navigator.onLine ? 'לא ניתן לקרוא את הקובץ' : 'קריאת PDF דורשת חיבור לאינטרנט בפעם הראשונה', true);
  }
}
/** פתיחת לוח של המערכת בעורך, בלוח הקרוב של התבנית t. השמירה יוצרת לתבנית לוח משלה */
async function editSystemBoard(t) {
  const p = periodFor(cfg, t, todayIn(cfg.tz));
  if (!p) throw new Error('no period');
  if (t.design && !t.design.ref && !await SiteDialog.confirm('לתבנית "' + t.name + '" יש לוח שהועלה אליה. שמירה של הלוח הזה תחליף אותו. להמשיך?', { ok: 'המשך' })) return false;
  const c = { ...cfg, rules: t.rules };
  const l = withEdits(p.mode === 'days' ? buildDaysLuach(c, p, comm) : buildLuach(c, p, comm), {}, t.edits || {});
  const read = await luachTextCanvas(l, t.font, t.sizes, t.theme, t.layout, pageOf(t), t.cols);
  const lay = LAYOUTS.find(x => x[0] === t.layout) || LAYOUTS[0];
  editFromBoard(read, 'לוח המערכת – ' + lay[1], cfg, t, r => templateDone(r, true), p.first);
  return true;
}

$('tplEdit').onclick = async () => {
  const t = selTpl();
  try {
    if (activeDesign(cfg, t)) await editExisting(t, cfg, templateDone);
    else if (!await editSystemBoard(t)) return;
    showTab('template');
  } catch (e) { console.error(e); toast('לא ניתן לפתוח את הלוח לעריכה', true); }
};
$('tplRemove').onclick = async () => {
  const t = selTpl();
  if (!await SiteDialog.confirm('להסיר את העיצוב מהתבנית "' + t.name + '"? זמני התפילות יישארו.', { ok: 'הסרה', danger: true })) return;
  // תבניות שמשתמשות באותו עיצוב מקבלות עותק משלהן
  if (t.design && !t.design.ref) {
    for (const x of cfg.templates) if (x.design && x.design.ref === t.id) x.design = { ...t.design, enabled: x.design.enabled !== false };
  }
  t.design = null; fill(); changed();
};

/* ---------- גיבוי ---------- */

$('export').onclick = () => {
  const blob = new Blob([JSON.stringify({ ...cfg, profileId: undefined }, null, 2)], { type: 'application/json' });
  download(blob, 'luach-settings' + (cfg.shul ? '-' + cfg.shul.replace(/[\\/:*?"<>|]/g, '') : '') + '.json');
};
$('import').onclick = () => $('importFile').click();
$('importFile').onchange = async () => {
  const f = $('importFile').files[0];
  $('importFile').value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!data || typeof data !== 'object' || !(Array.isArray(data.rules) || Array.isArray(data.templates))) throw new Error();
    cfg = normalize(data); cursor = null; fill(); store(); saved = true; renderProfiles();
    toast('ההגדרות נטענו');
  } catch (e) { toast('הקובץ לא תקין', true); }
};
$('reset').onclick = async () => {
  if (!await SiteDialog.confirm('למחוק את כל ההגדרות ולחזור לברירת המחדל? ההגדרות יימחקו גם אצל שאר הגבאים והרב.', { ok: 'איפוס', danger: true })) return;
  clearConfig();
  cfg = normalize(DEFAULT_CONFIG); saved = false; cursor = null; sel = 'shabbat'; board = 'shabbat'; fill(); renderProfiles();
  if (sync) sync.push(cfg);
  toast('ההגדרות אופסו');
};

/* ---------- הגדרות שמורות בשם, בקהילה ---------- */

let profiles = [], unsubProfiles = null;

function watchProfiles() {
  if (unsubProfiles) { unsubProfiles(); unsubProfiles = null; }
  profiles = [];
  if (sync) unsubProfiles = window.SiteAuth.client().onUpdate('zmanimProfiles:list', { synagogueId: syncSid },
    list => { profiles = list; renderProfiles(); }, e => console.warn(e));
  renderProfiles();
}

const profileDate = t => new Date(t).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' });

function renderProfiles() {
  const on = !!sync;
  $('profileNew').hidden = !on;
  $('profiles').hidden = !on || !profiles.length;
  $('profilesHint').textContent = !on
    ? 'אפשר לשמור את ההגדרות בשם ולעבור בין כמה הגדרות שונות (למשל זמני קיץ וזמני חורף). זה זמין לגבאי או לרב שמחוברים לקהילה.'
    : profiles.length ? 'טעינה מחליפה את ההגדרות הנוכחיות אצל כל הגבאים והרב. "עדכון" שומר את ההגדרות הנוכחיות במקום מה שנשמר באותו שם.'
    : 'עוד אין הגדרות שמורות. אפשר לשמור את ההגדרות הנוכחיות בשם (למשל "זמני קיץ"), ולחזור אליהן מתי שרוצים.';
  $('profiles').innerHTML = profiles.map(p => {
    const cur = p._id === cfg.profileId;
    return '<li data-id="' + esc(p._id) + '"' + (cur ? ' class="current"' : '') + '><div class="prof-text">' +
      '<div class="prof-name">' + esc(p.name) + '</div>' +
      '<div class="prof-meta">' + (cur ? 'האחרונות שנטענו או נשמרו · ' : '') + 'עודכנו ' + profileDate(p.updatedAt) + ', ' + esc(p.updatedBy) + '</div></div>' +
      '<div class="prof-btns"><button type="button" class="primary" data-act="load">טעינה</button>' +
      '<button type="button" data-act="overwrite">עדכון</button>' +
      '<button type="button" data-act="rename">שינוי שם</button>' +
      '<button type="button" class="danger" data-act="remove">מחיקה</button></div></li>';
  }).join('');
}

const cleanProfileName = s => String(s || '').trim().replace(/\s+/g, ' ');
const profileErr = (e, fallback) => e && typeof e.data === 'string' ? e.data : e && e.userMessage ? e.userMessage : fallback;

/** פעולה על ההגדרות השמורות. שינוי שממתין לשמירה נשמר קודם, כדי שייכלל בהן */
async function profileRun(fn, done) {
  if (!sync) return;
  flush();
  try { await fn(window.SiteAuth.client(), sync); if (done) toast(done); }
  catch (e) { console.warn(e); toast(profileErr(e, 'הפעולה נכשלה'), true); }
}

/** ההגדרות הנוכחיות כטקסט לשמירה בשם, בלי הסימון של ההגדרות השמורות שנטענו */
const profileConfig = s => s.lighten({ ...cfg, profileId: undefined });

function markProfile(id) {
  cfg.profileId = id;
  store(); saved = true;
  renderProfiles();
}

async function overwriteProfile(p) {
  await profileRun(async (client, s) => {
    await client.mutation('zmanimProfiles:overwrite', { profileId: p._id, config: await profileConfig(s) });
    markProfile(p._id);
  }, 'ההגדרות נשמרו בשם "' + p.name + '"');
}

$('profileNew').onclick = async () => {
  const name = cleanProfileName(await SiteDialog.prompt('איך לקרוא להגדרות? (למשל "זמני קיץ")', { ok: 'שמירה' }));
  if (!name) return;
  const same = profiles.find(p => p.name === name);
  if (same) {
    if (await SiteDialog.confirm('כבר יש הגדרות בשם "' + name + '". להחליף אותן בהגדרות הנוכחיות?', { ok: 'החלפה', danger: true })) await overwriteProfile(same);
    return;
  }
  await profileRun(async (client, s) => {
    markProfile(await client.mutation('zmanimProfiles:create', { synagogueId: syncSid, name, config: await profileConfig(s) }));
  }, 'ההגדרות נשמרו בשם "' + name + '"');
};

$('profiles').onclick = async e => {
  const btn = e.target.closest('[data-act]'), li = e.target.closest('li[data-id]');
  const p = li && profiles.find(x => x._id === li.dataset.id);
  if (!btn || !p) return;
  const act = btn.dataset.act;
  if (act === 'load') {
    if (!await SiteDialog.confirm('לטעון את "' + p.name + '"? ההגדרות הנוכחיות יוחלפו אצל כל הגבאים והרב. ' +
      'אם תרצו לחזור אליהן, כדאי לשמור אותן קודם בשם.', { ok: 'טעינה' })) return;
    await profileRun(async (client, s) => {
      const next = await s.resolve(await client.query('zmanimProfiles:get', { profileId: p._id }));
      next.profileId = p._id;
      cfg = next; cursor = null;
      fill(); renderLuach();
      markProfile(p._id);
    }, 'נטענו ההגדרות "' + p.name + '"');
  } else if (act === 'overwrite') {
    if (!await SiteDialog.confirm('לשמור את ההגדרות הנוכחיות בשם "' + p.name + '", במקום מה שנשמר בו עד עכשיו?', { ok: 'עדכון' })) return;
    await overwriteProfile(p);
  } else if (act === 'rename') {
    const name = cleanProfileName(await SiteDialog.prompt('שם חדש להגדרות:', { value: p.name, ok: 'שמירה' }));
    if (!name || name === p.name) return;
    await profileRun(client => client.mutation('zmanimProfiles:rename', { profileId: p._id, name }), 'השם שונה ל"' + name + '"');
  } else if (act === 'remove') {
    if (!await SiteDialog.confirm('למחוק את ההגדרות השמורות "' + p.name + '"? ההגדרות הנוכחיות של הלוח לא ישתנו.', { ok: 'מחיקה', danger: true })) return;
    await profileRun(client => client.mutation('zmanimProfiles:remove', { profileId: p._id }), 'ההגדרות "' + p.name + '" נמחקו');
  }
};

/* ---------- הפעלה ---------- */

fill();
renderLuach();
renderProfiles();

initCommunity({
  toast,
  async getLuachFile() {
    if (!current || !period) return null;
    const { png } = await getFiles();
    return { file: png, title: current.title, firstDate: toYmd(period.first),
      mode: { days: 'days', poster: 'events' }[period.mode] || 'holy', kind: current.tpl.id };
  },
  onManager(sid) {
    manageSync(sid);
    // גבאי שעוד לא הגדיר כלום מקבל את האשף פעם אחת. בינתיים ייתכן שהגדרות הגיעו מהקהילה (applyRemote סוגר אותו)
    if (sid && !saved && !wizardDone()) setTimeout(() => { if (!saved && !wizardDone()) startWizard(); }, 1500);
  },
  onKiddush(map) {
    kiddush = map;
    comm = communityData();
    setKiddush(comm);
    renderLuach();
  },
  onEvents(list) {
    events = list;
    comm = communityData();
    setKiddush(comm);
    renderLuach();
  }
});
