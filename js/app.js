/**
 * ממשק האתר: לוח, הגדרות, שיתוף וגיבוי. ההגדרות נשמרות בקהילה ומסתנכרנות בין הגבאים והרב (settings-sync.js),
 * ועותק שלהן נשמר בדפדפן. הלוחות המאושרים נשמרים בקהילה (community.js).
 */

import { CITIES, BASES, WHEN, APPLIES, ROUND, FONTS, THEMES, SIZE_PARTS, SIZES, DEFAULT_CONFIG, DAY_APPLIES, BUILTIN, isBuiltin, newTemplate, designOf, activeDesign,
  prayerBases, fontFamilies, fontsHref, themeColors, normalize, loadConfig, saveConfig, clearConfig } from './config.js';
import { findOccasion, templateFor, periodFor, occasionParts, buildLuach, buildDaysLuach, dayPages } from './luach.js';
import { MOADIM } from './moadim.js';
import { luachHtml, luachText, withEdits, baseText, esc } from './render.js';
import { todayIn, toYmd } from './dates.js';
import { luachCanvas, pngBlob, pdfBlob, stackCanvases } from './image.js';
import { templateCanvas, slotKey, slotText, slotValue } from './template-render.js';
import { editFromFile, editExisting, mergeRules, setKiddush } from './template-ui.js';
import { initCommunity } from './community.js';
import { startSync } from './settings-sync.js';

const $ = id => document.getElementById(id);
const BASE_LABELS = Object.keys(BASES);

let { cfg, saved } = loadConfig();
let cursor = null;       // היום שממנו מחפשים את האירוע המוצג
let period = null;       // השבת/החג או ימי החול של הלוח המוצג
let current = null;      // הלוח המוצג כרגע
let sel = 'shabbat';     // התבנית שנבחרה בהגדרות
let kiddush = null;      // dateKey ← קידוש מאושר, מהקהילה (community.js)
let editing = false;     // מצב עריכת טקסט על הלוח
let scope = 'once';      // שינוי בטקסט חל על הלוח הזה בלבד (once), או קבוע בכל הלוחות של התבנית (fixed)

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

const boardTpl = () => cfg.templates.find(t => t.id === board) || cfg.templates[0];

/** מעבר לתבנית אחרת בלוח. day – היום שממנו מחפשים את הלוח, או null ללוח הקרוב */
function setBoard(id, day = null) {
  board = id; cursor = day;
  try { localStorage.setItem(MODE_KEY, id); } catch (e) { /* אין גישה לאחסון */ }
  renderLuach();
}

/** רשימת התבניות לבחירה, עם כפתור להוספת תבנית. host – 'luach' או 'settings' */
function tplChips(el, id, host) {
  el.innerHTML = cfg.templates.map(x => '<button type="button" class="chip" data-t="' + esc(x.id) + '" aria-pressed="' +
    (x.id === id) + '">' + esc(x.name) + '</button>').join('') +
    '<button type="button" class="chip add" data-add="' + host + '">+ תבנית חדשה</button>';
}

$('luachTpls').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.add) openNewTemplate('luach');
  else setBoard(b.dataset.t);
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
  const base = p.mode === 'days' ? buildDaysLuach(c, p, kiddush) : buildLuach(c, p, kiddush);
  const fixed = t.edits || {}, e = cfg.edits[editKey(t, p)] || {};
  const l = withEdits(base, e, fixed);
  l.base = base;
  l.fixedBase = withEdits(base, {}, fixed);
  l.edits = e;
  l.fixedEdits = fixed;
  l.design = activeDesign(cfg, t);
  l.pages = l.design ? (base.values.multiDay ? dayPages(c, p, kiddush) : [base.values]).map((v, i) => {
    const once = pageEdits(e, i), fx = pageEdits(fixed, i);
    return { ...v, edits: { ...fx, ...once }, once, fixed: fx };
  }) : null;
  l.tpl = t;
  return l;
}
/** העמודים של הלוח כקנבסים: עמוד לכל יום בעיצוב מקובץ, או עמוד אחד בעיצוב של האתר */
const drawLuach = async l => l.design ? Promise.all(l.pages.map(v => templateCanvas(l.design, v)))
  : [await luachCanvas(l, l.tpl.font, l.tpl.sizes, l.tpl.theme)];

/**
 * החלת הגופן, ערכת הצבעים והגדלים של התבנית t על el (הלוח, או הדוגמה בהגדרות).
 * הגופן נטען מ-Google Fonts, קישור לכל גופן כך שכמה תבניות יכולות להשתמש בגופנים שונים.
 */
function applyDesign(el, t) {
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

/**
 * ההצעה לשלב חג ושבת שצמודים ללוח אחד, או לחזור להצגה בשני לוחות נפרדים.
 * הבחירה נשמרת לאירוע הזה בלבד, לפי היום הראשון שלו.
 */
function renderMixOffer(p) {
  const el = $('mixOffer');
  el.hidden = !p || !p.mixed;
  if (el.hidden) return;
  const on = !!cfg.merged[p.occId];
  el.innerHTML = (on ? 'החג והשבת מוצגים יחד בלוח אחד.' : 'החג והשבת צמודים, וכרגע יש לכל אחד לוח נפרד.') +
    '<button type="button" class="link" id="mixToggle">' + (on ? 'להצגה בשני לוחות נפרדים' : 'לשילוב הזמנים בלוח אחד') + '</button>';
}

$('mixOffer').addEventListener('click', e => {
  if (e.target.id !== 'mixToggle' || !period) return;
  const id = period.occId;
  if (cfg.merged[id]) delete cfg.merged[id];
  else cfg.merged[id] = true;
  changed();
  // הלוח המשולב הוא לוח של חג, ולכן אחרי השילוב עוברים לתבנית שלו
  const parts = occasionParts(findOccasion(id, cfg.il), cfg.merged);
  const p = parts.find(x => templateFor(cfg, x) === boardTpl()) || parts[0];
  setBoard(templateFor(cfg, p).id, p.first);
});

function renderLuach() {
  $('welcome').hidden = saved;
  const t = boardTpl();
  board = t.id;
  tplChips($('luachTpls'), board, 'luach');
  if (cursor == null) cursor = todayIn(cfg.tz);
  const p = isFinite(cfg.lat) && isFinite(cfg.lng) ? periodFor(cfg, t, cursor) : null;
  if (!p) {
    current = period = null;
    renderMixOffer(null);
    $('luach').innerHTML = '<p class="luach-empty">' + (isFinite(cfg.lat) && isFinite(cfg.lng)
      ? 'אין לוח קרוב לתבנית "' + esc(t.name) + '".<button type="button" class="link" id="goTplSettings">לבחירת המועדים שבהם היא חלה ←</button>'
      : 'לא ניתן לחשב לוח. בדקו את המיקום בהגדרות.') + '</p>';
    $('todayOcc').disabled = true;
    return;
  }
  cursor = p.first; period = p;
  current = build(p);
  applyDesign($('luach'), current.tpl);
  renderMixOffer(p);
  if (current.design) {
    const l = current;
    $('luach').innerHTML = l.pages.map((v, i) => '<div class="lp" data-p="' + i + '"><img class="luach-img" alt="' + esc(v.title) + '"></div>').join('');
    drawLuach(l).then(pages => {
      if (current !== l) return;
      $('luach').querySelectorAll('.lp').forEach((el, i) => {
        el.querySelector('img').src = pages[i].toDataURL('image/png');
        el.insertAdjacentHTML('beforeend', slotBoxes(l, i, pages[i]));
      });
    }).catch(() => { if (current === l) { $('luach').innerHTML = luachHtml(l, editing); makeEditable(); } });
  } else {
    $('luach').innerHTML = luachHtml(current, editing);
    makeEditable();
  }
  $('luach').classList.toggle('editing', editing);
  renderEditBar();
  const now = periodFor(cfg, t, todayIn(cfg.tz));
  $('todayOcc').disabled = !!now && now.first === p.first;
}

/** הלוח הבא (dir=1) או הקודם (dir=-1) מאותה תבנית */
function stepLuach(dir) {
  if (!period) return;
  const o = periodFor(cfg, boardTpl(), dir > 0 ? period.last + 1 : period.first - 1, dir, true);
  if (o) { cursor = o.first; renderLuach(); }
}
$('luach').addEventListener('click', e => {
  if (e.target.id !== 'goTplSettings') return;
  sel = board;
  renderTemplates();
  showTab('settings');
});

/* ---------- עריכת טקסט על הלוח ---------- */

const pct = (a, b) => (a / b * 100).toFixed(3) + '%';

/** אזורי העיצוב מקובץ בעמוד i, ככפתורים מעל התמונה. לוחצים עליהם במצב עריכה */
function slotBoxes(l, i, canvas) {
  const v = l.pages[i];
  return l.design.slots.map(s => {
    const text = slotText(s, v), k = slotKey(s), b = s.box;
    if (text == null) return '';
    return '<button type="button" class="slot' + (k in v.once ? ' ed' : k in v.fixed ? ' fx' : '') + '" data-k="' + esc(k) + '" tabindex="' + (editing ? 0 : -1) +
      '" style="left:' + pct(b.x - 2, canvas.width) + ';top:' + pct(b.y - 1, canvas.height) +
      ';width:' + pct(b.w + 4, canvas.width) + ';height:' + pct(b.h + 2, canvas.height) + '" aria-label="עריכה: ' + esc(text) + '"></button>';
  }).join('');
}

/** במצב עריכה כל טקסט בלוח של האתר נפתח להקלדה */
function makeEditable() {
  if (!editing) return;
  $('luach').querySelectorAll('[data-e]').forEach(el => {
    try { el.contentEditable = 'plaintext-only'; } catch (e) { el.contentEditable = 'true'; }
    el.spellcheck = false;
  });
}

const count = (n, one, many) => n === 1 ? one : n + ' ' + many;

function renderEditBar() {
  const n = current ? Object.keys(current.edits).length : 0, f = current ? Object.keys(current.fixedEdits).length : 0;
  const name = current ? '"' + current.tpl.name + '"' : '';
  $('editText').setAttribute('aria-pressed', String(editing));
  $('editText').textContent = editing ? 'סיום העריכה' : 'עריכת טקסט';
  $('editText').disabled = !current;
  $('editBar').hidden = !current || (!editing && !n && !f);
  $('editScope').hidden = !editing;
  $('editScope').querySelectorAll('[data-scope]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.scope === scope)));
  $('scopeFixed').textContent = 'קבוע בכל הלוחות של ' + name;
  if (editing) {
    $('editHint').textContent = (current && current.design ? 'לוחצים על אזור מסומן בלוח כדי לשנות את הטקסט שלו. ' : 'לוחצים על טקסט בלוח ומקלידים. ') +
      (scope === 'fixed' ? 'השינוי יישמר בתבנית ' + name + ' ויופיע בכל הלוחות שלה, גם בשבועות הבאים. '
        : 'השינוי יחול רק על הלוח הזה. ') +
      'בזהב – שינוי בלוח הזה בלבד, בירוק – שינוי קבוע.';
  } else {
    const parts = [];
    if (n) parts.push('בלוח הזה ' + (n === 1 ? 'שונה טקסט אחד' : 'שונו ' + n + ' טקסטים') + ' ידנית');
    if (f) parts.push('בתבנית ' + name + ' ' + count(f, 'יש שינוי קבוע אחד', 'שינויים קבועים'));
    $('editHint').textContent = parts.join('. ') + '.';
  }
  $('editReset').hidden = !n;
  $('editResetFixed').hidden = !f;
}

/** לוחות שעברו לפני יותר מחודשיים לא צריכים את השינויים שלהם */
function pruneEdits() {
  const old = todayIn(cfg.tz) - 60;
  for (const k in cfg.edits) if (+k.slice(k.lastIndexOf(':') + 1) < old) delete cfg.edits[k];
}

/**
 * שמירת טקסט ששונה בלוח המוצג, לפי מה שהגבאי בחר: בלוח הזה בלבד, או קבוע בתבנית.
 * computed – הטקסט המחושב, withFixed – הטקסט אחרי השינויים הקבועים. טקסט שחזר אליהם כבר לא נחשב שינוי.
 */
function setEdit(key, text, computed, withFixed) {
  const t = current.tpl, id = editKey(t, period), e = { ...(cfg.edits[id] || {}) };
  if (scope === 'fixed') {
    const f = { ...(t.edits || {}) };
    if (text === computed) delete f[key];
    else f[key] = text;
    t.edits = f;
    delete e[key];   // כדי שהשינוי הקבוע ייראה גם בלוח הזה
  } else if (text === withFixed) delete e[key];
  else e[key] = text;
  if (Object.keys(e).length) cfg.edits[id] = e;
  else delete cfg.edits[id];
  pruneEdits();
  changed();
  // הלוח נבנה מחדש בלי לצייר אותו שוב, כדי לא לאבד את המקום שבו מקלידים
  current = build(period);
  renderEditBar();
}

$('editText').onclick = () => {
  editing = !editing;
  scope = 'once';
  if (!editing && $('luach').contains(document.activeElement)) document.activeElement.blur();
  renderLuach();
};
$('editScope').addEventListener('click', e => {
  const b = e.target.closest('[data-scope]');
  if (!b) return;
  scope = b.dataset.scope;
  renderEditBar();
});
$('editResetFixed').onclick = async () => {
  const t = current && current.tpl;
  if (!t || !await SiteDialog.confirm('לבטל את כל השינויים הקבועים בתבנית "' + t.name + '"? הטקסט יחזור לטקסט המחושב בכל הלוחות שלה.', { ok: 'ביטול השינויים הקבועים', danger: true })) return;
  t.edits = {};
  changed();
  renderLuach();
  toast('השינויים הקבועים בוטלו');
};
$('editReset').onclick = async () => {
  if (!current || !await SiteDialog.confirm('לבטל את כל השינויים בטקסט של הלוח הזה ולחזור לטקסט המחושב?', { ok: 'ביטול השינויים', danger: true })) return;
  delete cfg.edits[editKey(current.tpl, period)];
  changed();
  renderLuach();
  toast('הלוח חזר לטקסט המחושב');
};

const editable = t => editing && t instanceof Element && t.closest('[data-e]');
$('luach').addEventListener('focusin', e => {
  const el = editable(e.target);
  if (el) el.dataset.was = el.textContent;
});
$('luach').addEventListener('keydown', e => {
  const el = editable(e.target);
  if (!el) return;
  // Enter מסיים את העריכה, חוץ מבהודעה שבתחתית שיכולה להיות בכמה שורות. Escape מבטל
  if (e.key === 'Enter' && (el.dataset.e !== 'notes' || e.ctrlKey || e.metaKey)) { e.preventDefault(); el.blur(); }
  if (e.key === 'Escape') { el.textContent = el.dataset.was ?? el.textContent; el.blur(); }
});
$('luach').addEventListener('paste', e => {
  if (!editable(e.target)) return;
  e.preventDefault();
  document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
});
$('luach').addEventListener('focusout', e => {
  const el = editable(e.target);
  if (!el || !current || el.textContent === el.dataset.was) return;
  const key = el.dataset.e;
  const text = (key === 'notes' ? el.innerText : el.textContent).replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').trim();
  setEdit(key, text, baseText(current.base, key) ?? '', baseText(current.fixedBase, key) ?? '');
  el.classList.toggle('ed', key in current.edits);
  el.classList.toggle('fx', !(key in current.edits) && key in current.fixedEdits);
  el.dataset.was = el.textContent;
});
$('luach').addEventListener('click', async e => {
  const b = e.target.closest('.slot');
  if (!b || !editing || !current || !current.design) return;
  const i = +b.closest('.lp').dataset.p, k = b.dataset.k, v = current.pages[i];
  const slot = current.design.slots.find(s => slotKey(s) === k);
  if (!slot || !v) return;
  const now = slotText(slot, v), base = slotValue(slot, v) ?? '', withFixed = k in v.fixed ? v.fixed[k] : base;
  const text = await SiteDialog.prompt('הטקסט באזור הזה' + (current.pages.length > 1 ? ' (עמוד ' + (i + 1) + ')' : '') +
    (now !== base ? '\nהטקסט המחושב: ' + (base || '(ריק)') : '') + '\nטקסט ריק מוחק את האזור מהלוח.' +
    '\nהשינוי ' + (scope === 'fixed' ? 'קבוע בכל הלוחות של "' + current.tpl.name + '"' : 'יחול רק על הלוח הזה') + '.', { value: now, ok: 'שמירה' });
  if (text === null || text.trim() === now) return;
  setEdit('p' + i + '|' + k, text.trim(), base, withFixed);
  renderLuach();
});

$('prevOcc').onclick = () => stepLuach(-1);
$('nextOcc').onclick = () => stepLuach(1);
$('todayOcc').onclick = () => { cursor = null; renderLuach(); };

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  }
}

/*
 * קבצי תמונה ו-PDF מוכנים מראש לכל לוח שמוצג. בספארי (אייפון) השיתוף חייב לקרות
 * מיד אחרי הלחיצה, ולכן אי אפשר לחכות ליצירת הקובץ בזמן הלחיצה.
 */
let files = null;   // { luach, promise }
let prepTimer;

function makeFiles(l) {
  const name = ('לוח זמנים - ' + l.title).replace(/[\\/:*?"<>|]/g, '');
  const promise = drawLuach(l).then(async pages => ({
    png: new File([await pngBlob(stackCanvases(pages))], name + '.png', { type: 'image/png' }),
    pdf: new File([await pdfBlob(pages)], name + '.pdf', { type: 'application/pdf' })
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

function download(file) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function shareFile(kind) {
  if (!current) return;
  let file;
  try { file = (await getFiles())[kind]; }
  catch (e) { toast('יצירת הקובץ נכשלה', true); return; }
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: current.title }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  download(file);
  toast('הקובץ נשמר בהורדות');
}
$('shareImg').onclick = () => shareFile('png');
$('sharePdf').onclick = () => shareFile('pdf');

$('share').onclick = async () => {
  if (!current) return;
  const text = luachText(current);
  if (navigator.share) {
    try { await navigator.share({ title: current.title, text }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  toast(await copyText(text) ? 'הלוח הועתק. אפשר להדביק בוואטסאפ או במייל' : 'ההעתקה נכשלה', false);
};
$('print').onclick = () => {
  const prev = document.title;
  if (current) document.title = 'לוח זמנים - ' + current.title;   // שם קובץ ה-PDF
  window.print();
  document.title = prev;
};

/* ---------- הגדרות ---------- */

$('city').innerHTML = CITIES.map(c => '<option value="' + c[0] + '">' + esc(c[1]) + '</option>').join('') +
  '<option value="custom">מיקום אחר (קואורדינטות)</option>';

const zones = (Intl.supportedValuesOf && Intl.supportedValuesOf('timeZone')) || ['Asia/Jerusalem', 'Europe/London', 'America/New_York'];
$('tz').innerHTML = zones.map(z => '<option>' + esc(z) + '</option>').join('');

$('font').innerHTML = FONTS.map(f => '<option value="' + f[0] + '">' + esc(f[1]) + '</option>').join('');
$('theme').innerHTML = THEMES.map(x => '<option value="' + x[0] + '">' + esc(x[1]) + '</option>').join('');

const opts = (list, v) => list.map(x => '<option' + (x === v ? ' selected' : '') + '>' + esc(x) + '</option>').join('');
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
  $('city').value = cfg.city || 'custom';
  $('candle').value = cfg.candle;
  $('lat').value = cfg.lat; $('lng').value = cfg.lng;
  if (zones.indexOf(cfg.tz) < 0) $('tz').insertAdjacentHTML('afterbegin', '<option>' + esc(cfg.tz) + '</option>');
  $('tz').value = cfg.tz;
  $('il').value = cfg.il ? '1' : '0';
  $('havdalah').value = String(cfg.havdalah);
  $('notes').value = cfg.notes || '';
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
  $('sizes').innerHTML = SIZE_PARTS.map(([k, label]) => '<div><label for="size-' + k + '">גודל ' + esc(label) + '</label>' +
    '<select id="size-' + k + '" data-size="' + k + '">' +
    SIZES.map(v => '<option value="' + v + '"' + (v === t.sizes[k] ? ' selected' : '') + '>' + v + '%</option>').join('') + '</select></div>').join('');
  renderFontSample();
}
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
  renderFontSample(); changed();
});

/* ---------- ייבוא מתבנית אחרת: זמנים, עיצוב, גופן וגדלים ---------- */

/**
 * התבניות שאפשר לייבא מהן. עיצוב מלוח ישן – רק מתבנית מאותו סוג, כי האזורים שלו בנויים לפי סוג הלוח.
 * part='ref' – שיוך לעיצוב של תבנית אחרת בלי עותק, ולכן רק תבנית שהעיצוב שמור בה עצמה.
 */
function importSources(part) {
  const t = selTpl();
  if (part === 'design') return cfg.templates.filter(x => x !== t && x.kind === t.kind && designOf(cfg, x));
  if (part === 'ref') return cfg.templates.filter(x => x !== t && x.kind === t.kind && x.design && !x.design.ref);
  return cfg.templates.filter(x => x !== t);
}
function closeImport(box) {
  box.querySelector('.imp-form').hidden = true;
  box.querySelector('.imp-open').hidden = false;
  box.querySelector('.imp-hint').hidden = true;
}
function openImport(box) {
  const part = box.dataset.part, t = selTpl(), list = importSources(part), hint = box.querySelector('.imp-hint');
  if (!list.length) {
    hint.textContent = part === 'design' || part === 'ref'
      ? 'אין תבנית אחרת מאותו סוג (' + (t.kind === 'days' ? 'ימי חול' : 'שבת או חג') + ') שיש לה עיצוב מלוח ישן.'
      : 'אין תבניות אחרות.';
    hint.hidden = false;
    return;
  }
  box.querySelector('.imp-from').innerHTML = list.map(x => '<option value="' + esc(x.id) + '">' + (part === 'ref' ? '' : 'מ') + esc(x.name) + '</option>').join('');
  box.querySelector('.imp-open').hidden = true;
  box.querySelector('.imp-form').hidden = false;
  if (part === 'ref') {
    hint.textContent = 'העיצוב לא ישוכפל: שתי התבניות ישתמשו באותו קובץ, וזמני התפילות בו יילקחו מכל תבנית בנפרד. ' +
      'אפשר לכבות אותו כאן בלי להשפיע על התבנית השנייה.';
    hint.hidden = false;
  }
  if (part === 'rules') {
    hint.textContent = 'בייבוא בין לוח של שבת/חג ללוח של ימי חול, "מתי" ו"חל על" מתאימים את עצמם לסוג הלוח. כדאי לעבור על הזמנים אחרי הייבוא.';
    hint.hidden = false;
  }
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
  if (!src) return;
  if (part === 'rules') {
    const list = convertRules(src.rules, t.kind);
    t.rules = box.querySelector('.imp-how').value === 'add' ? mergeRules(t.rules, list, false, t.kind) : list;
    toast('הזמנים יובאו מ' + src.name);
  } else if (part === 'ref') {
    // שיוך בלי עותק: התבנית מצביעה על העיצוב של src, כך שהלוח שלה נראה כמו הלוח הישן בלי להכפיל את הקובץ במכשיר
    t.design = { ref: src.id, enabled: true };
    if (!store()) { t.design = null; toast('לא ניתן לשמור במכשיר הזה', true); return; }
    toast('העיצוב של "' + src.name + '" ישמש גם ב"' + t.name + '", עם זמני התפילות של "' + t.name + '"');
  } else if (part === 'design') {
    const d = designOf(cfg, src);
    if (designOf(cfg, t) && !await SiteDialog.confirm('להחליף את העיצוב של "' + t.name + '" בעיצוב של "' + src.name + '"?', { ok: 'החלפה' })) return;
    // תבניות שמשתמשות בעיצוב הקודם של התבנית הזו שומרות עליו
    if (t.design && !t.design.ref) {
      for (const x of cfg.templates) if (x.design && x.design.ref === t.id) x.design = { ...t.design, enabled: x.design.enabled !== false };
    }
    t.design = { ...JSON.parse(JSON.stringify(d)), enabled: true };   // עותק נפרד
    if (!store()) { t.design = null; toast('אין מספיק מקום במכשיר לעותק של העיצוב', true); return; }
    toast('העיצוב יובא מ' + src.name + '. זמני התפילות בו לפי התבנית "' + t.name + '"');
  } else {
    t.font = src.font; t.theme = src.theme; t.sizes = { ...src.sizes };
    toast('הגופן, ערכת הצבעים והגדלים יובאו מ' + src.name);
  }
  closeImport(box);
  renderRules(); renderTemplateStatus(); renderFont();
  changed();
}

document.querySelectorAll('.imp').forEach(box => {
  box.querySelector('.imp-open').onclick = () => openImport(box);
  box.querySelector('.imp-cancel').onclick = () => closeImport(box);
  box.querySelector('.imp-ok').onclick = () => doImport(box);
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
  sel = b.dataset.t;
  $('tplNew').hidden = true;
  renderTemplates();
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
  sel = 'shabbat';
  renderTemplates(); changed();
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
  sel = t.id;
  $('tplNew').hidden = true;
  renderTemplates(); changed();
  if (newTplHost === 'luach') {
    setBoard(t.id);
    toast('התבנית נוצרה. בהגדרות בוחרים באילו מועדים היא חלה');
  } else toast('התבנית נוצרה. בחרו מתי היא חלה');
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
    : BASES[r.base] === 'kiddush' ? r.base
    : n ? Math.abs(n) + ' דק׳ ' + (n < 0 ? 'לפני ' : 'אחרי ') + r.base : r.base;
  return [days ? '' : r.when, r.applies, at].filter(Boolean).join(' · ');
}

function renderRules() {
  const days = selTpl().kind === 'days';
  $('rules').innerHTML = rules().map((r, i) => {
    const fixed = r.base === 'שעה קבועה';
    const kiddush = BASES[r.base] === 'kiddush';
    return '<details class="rule" data-i="' + i + '"' + (openRules.has(r) ? ' open' : '') + '>' +
      '<summary><b class="rule-name">' + (esc(r.name) || 'תפילה חדשה') + '</b><span class="rule-sum">' + esc(ruleSum(r, days)) + '</span></summary>' +
      '<div class="rule-top">' +
      '<input data-k="name" value="' + esc(r.name) + '" placeholder="שם התפילה או השיעור" aria-label="שם התפילה">' +
      '<button type="button" data-del="' + i + '" aria-label="מחיקת ' + esc(r.name) + '">מחיקה</button></div>' +
      '<div class="rgrid">' +
      (days ? '' : '<div><label>מתי</label><select data-k="when">' + opts(WHEN, r.when) + '</select></div>') +
      '<div><label>חל על</label><select data-k="applies">' + opts(days ? DAY_APPLIES : APPLIES, r.applies) + '</select></div>' +
      '<div><label>לפי</label><select data-k="base">' + baseOpts(r) + '</select></div>' +
      (kiddush || fixed
        ? '<div><label>' + (kiddush ? 'נוסח' : 'שעה') + '</label><input data-k="offset" value="' + esc(r.offset) +
          '" placeholder="' + (kiddush ? '{שם}{לרגל}' : '08:00') + '"' +
          (kiddush ? ' dir="rtl"' : ' dir="ltr" inputmode="text"') + '></div>'
        : '<div><label>הפרש (דקות)</label><div class="offset-pair"><input data-k="offsetAbs" type="number" min="0" inputmode="numeric" dir="ltr" value="' +
          esc(offsetAbs(r)) + '" placeholder="20"><select data-k="offsetDir">' + opts(['אחרי', 'לפני'], offsetDir(r)) + '</select></div></div>') +
      '<div><label>עיגול</label><select data-k="round"' + (fixed || kiddush ? ' disabled' : '') + '>' + opts(ROUND, r.round) + '</select></div>' +
      '</div>' + (kiddush ? '<p class="hint">הטקסט יתמלא לפי מי שאושר לקידוש בתאריך הזה (מלוח הקידושים של הקהילה). ' +
        'אפשר להשתמש ב-{שם} (שם התורם), ב-{סיבה} (לרגל מה נתרם) וב-{לרגל} (מוסיף "לרגל ..." רק אם יש סיבה). ' +
        'בלי תאריך מאושר, השורה לא תופיע.</p>' : '') +
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
function store() {
  const ok = saveConfig(cfg);
  if (sync) { remoteLater = null; sync.push(cfg); }
  return ok || !!sync;
}

/** הגדרות חדשות מהקהילה. שינוי שלנו שעוד לא נשמר גובר עליהן, ובעריכת תבנית מקובץ הן ממתינות לסיום */
function applyRemote(next, by) {
  if (saveTimer) return;
  // בעריכת תבנית מקובץ, או כשמקלידים על הלוח, ההגדרות מהקהילה ממתינות
  const typing = editing && $('luach').contains(document.activeElement) && document.activeElement.isContentEditable;
  if (!$('view-template').hidden || typing) { remoteLater = [next, by]; return; }
  remoteLater = null;
  cfg = next; saved = true;
  saveConfig(cfg);
  fill(); renderLuach();
  if (by) toast('ההגדרות עודכנו (' + by + ')');
}

/** sid – הקהילה שהמשתמש גבאי או רב בה, או null */
function manageSync(sid) {
  if (sid === syncSid) return;
  flush();
  if (sync) { sync.stop(); sync = null; }
  syncSid = sid; remoteLater = null;
  if (sid) sync = startSync({ client: window.SiteAuth.client(), sid, getCfg: () => cfg, hasLocal: () => saved, apply: applyRemote, toast });
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
    const kiddush = BASES[r.base] === 'kiddush';
    if (r.base === 'שעה קבועה' && r.offset.indexOf(':') < 0) r.offset = '08:00';
    if (kiddush && /^-?\d+$/.test(r.offset)) r.offset = '';
    if (!kiddush && r.base !== 'שעה קבועה' && r.offset.indexOf(':') >= 0) r.offset = '0';
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

$('city').onchange = () => {
  cfg.city = $('city').value;
  const c = CITIES.find(x => x[0] === cfg.city);
  if (c) Object.assign(cfg, { lat: c[2], lng: c[3], candle: c[4], tz: 'Asia/Jerusalem', il: true });
  cursor = null; fill(); changed();
};
const bind = (id, fn) => $(id).addEventListener('input', () => { fn($(id).value); changed(); });
bind('shul', v => { cfg.shul = v; });
bind('candle', v => { cfg.candle = Number(v) || 0; });
bind('lat', v => { cfg.lat = Number(v); });
bind('lng', v => { cfg.lng = Number(v); });
bind('tz', v => { cfg.tz = v; cursor = null; });
bind('il', v => { cfg.il = v === '1'; cursor = null; });
bind('havdalah', v => { cfg.havdalah = v; });
bind('notes', v => { cfg.notes = v; });
bind('font', v => { selTpl().font = v; renderFontSample(); });
bind('theme', v => { selTpl().theme = v; renderFontSample(); });

/* ---------- עיצוב מלוח קיים ---------- */

function renderTemplateStatus() {
  const t = selTpl(), d = designOf(cfg, t), shared = !!(t.design && t.design.ref);
  $('tplStatus').hidden = !d;
  $('tplUseWrap').hidden = !d;
  $('tplEdit').hidden = !d;
  $('tplRemove').hidden = !d;
  $('designShared').hidden = !(d && shared);
  $('tplUpload').textContent = d ? 'העלאת לוח אחר' : 'העלאת לוח ישן (PDF או תמונה)';
  // שיוך לעיצוב של תבנית אחרת מוצע רק לתבנית בלי עיצוב משלה, כשיש ממה לשייך
  document.querySelector('.imp[data-part="ref"]').hidden = !!t.design || !importSources('ref').length;
  if (d) {
    $('tplStatus').textContent = 'קובץ: ' + d.name + ' (' + d.slots.length + ' אזורים)';
    $('tplUse').checked = !!activeDesign(cfg, t);
    if (shared) {
      const src = cfg.templates.find(x => x.id === t.design.ref);
      $('designShared').textContent = 'העיצוב משותף עם התבנית "' + src.name + '". עריכה או העלאה כאן יוצרות עיצוב נפרד לתבנית הזו.';
    }
  }
}

function templateDone(result) {
  if (result) {
    const t = result.tpl, prev = { design: t.design, rules: t.rules };
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
    // מציגים את הלוח הקרוב שמשתמש בתבנית
    const p = periodFor(cfg, t, todayIn(cfg.tz));
    setBoard(t.id, p ? p.first : null);
    showTab('luach');
    toast('התבנית נשמרה');
  } else showTab('settings');
}

$('tplUpload').onclick = () => $('tplFile').click();
$('tplFile').onchange = async () => {
  const f = $('tplFile').files[0];
  $('tplFile').value = '';
  if (!f) return;
  toast('קורא את הקובץ…');
  try {
    await editFromFile(f, cfg, selTpl(), templateDone);
    showTab('template');
  } catch (e) {
    console.error(e);
    toast(navigator.onLine ? 'לא ניתן לקרוא את הקובץ' : 'קריאת PDF דורשת חיבור לאינטרנט בפעם הראשונה', true);
  }
};
$('tplEdit').onclick = async () => {
  try { await editExisting(selTpl(), cfg, templateDone); showTab('template'); }
  catch (e) { toast('לא ניתן לפתוח את התבנית', true); }
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
$('tplUse').onchange = () => {
  // בעיצוב משותף ההפעלה נשמרת בתבנית עצמה, כך שאפשר לכבות אותו רק בחגים למשל
  selTpl().design.enabled = $('tplUse').checked;
  changed();
};

/* ---------- גיבוי ---------- */

$('export').onclick = () => {
  const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'luach-settings' + (cfg.shul ? '-' + cfg.shul.replace(/[\\/:*?"<>|]/g, '') : '') + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('import').onclick = () => $('importFile').click();
$('importFile').onchange = async () => {
  const f = $('importFile').files[0];
  $('importFile').value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!data || typeof data !== 'object' || !(Array.isArray(data.rules) || Array.isArray(data.templates))) throw new Error();
    cfg = normalize(data); cursor = null; fill(); store(); saved = true;
    toast('ההגדרות נטענו');
  } catch (e) { toast('הקובץ לא תקין', true); }
};
$('reset').onclick = async () => {
  if (!await SiteDialog.confirm('למחוק את כל ההגדרות ולחזור לברירת המחדל? ההגדרות יימחקו גם אצל שאר הגבאים והרב.', { ok: 'איפוס', danger: true })) return;
  clearConfig();
  cfg = normalize(DEFAULT_CONFIG); saved = false; cursor = null; sel = 'shabbat'; board = 'shabbat'; fill();
  if (sync) sync.push(cfg);
  toast('ההגדרות אופסו');
};

/* ---------- הפעלה ---------- */

fill();
renderLuach();

initCommunity({
  toast,
  async getLuachFile() {
    if (!current || !period) return null;
    const { png } = await getFiles();
    return { file: png, title: current.title, firstDate: toYmd(period.first),
      mode: period.mode === 'days' ? 'days' : 'holy', kind: current.tpl.id };
  },
  onManager: manageSync,
  onKiddush(map) {
    kiddush = map;
    setKiddush(map);
    renderLuach();
  }
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
