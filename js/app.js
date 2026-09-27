/** ממשק האתר: לוח, הגדרות, שיתוף וגיבוי. ההגדרות נשמרות מקומית בדפדפן, והלוחות המאושרים נשמרים בקהילה (community.js). */

import { CITIES, BASES, WHEN, APPLIES, ROUND, FONTS, THEMES, SIZE_PARTS, SIZES, DEFAULT_CONFIG, DAY_APPLIES, BUILTIN, isBuiltin, newTemplate, designOf, activeDesign,
  prayerBases, fontFamilies, fontsHref, themeColors, normalize, loadConfig, saveConfig, clearConfig } from './config.js';
import { findPeriod, stepPeriod, templateFor, nextPeriodFor, buildLuach, buildDaysLuach } from './luach.js';
import { MOADIM } from './moadim.js';
import { luachHtml, luachText, esc } from './render.js';
import { todayIn, toYmd } from './dates.js';
import { luachCanvas, pngBlob, pdfBlob } from './image.js';
import { templateCanvas } from './template-render.js';
import { editFromFile, editExisting, mergeRules } from './template-ui.js';
import { initCommunity } from './community.js';

const $ = id => document.getElementById(id);
const BASE_LABELS = Object.keys(BASES);

let { cfg, saved } = loadConfig();
let cursor = null;       // היום שממנו מחפשים את האירוע המוצג
let period = null;       // השבת/החג או ימי החול של הלוח המוצג
let current = null;      // הלוח המוצג כרגע
let sel = 'shabbat';     // התבנית שנבחרה בהגדרות
let kiddush = null;      // dateKey ← קידוש מאושר, מהקהילה (community.js)

/* סוג הלוח שמוצג: holy – שבתות וחגים, days – ימות השבוע וחול המועד. נשמר במכשיר */
const MODE_KEY = 'zmanim.mode';
let mode = 'holy';
try { if (localStorage.getItem(MODE_KEY) === 'days') mode = 'days'; } catch (e) { /* אין גישה לאחסון */ }

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
  for (const n of ['luach', 'settings']) $('tab-' + n).setAttribute('aria-selected', String(n === name));
  for (const n of ['luach', 'settings', 'template']) $('view-' + n).hidden = n !== name;
  if (name === 'luach') renderLuach();
}
$('tab-luach').onclick = () => showTab('luach');
$('tab-settings').onclick = () => showTab('settings');
$('goSettings').onclick = () => showTab('settings');

function setMode(m) {
  mode = m; cursor = null;
  try { localStorage.setItem(MODE_KEY, m); } catch (e) { /* אין גישה לאחסון */ }
  renderLuach();
}
$('modeHoly').onclick = () => setMode('holy');
$('modeDays').onclick = () => setMode('days');

/* ---------- הלוח ---------- */

/** הלוח לפי התבנית שחלה עליו. l.design – העיצוב מהקובץ הישן, רק לשבת/חג של יום אחד כמו בלוח המקורי */
function build(p) {
  const t = templateFor(cfg, p), c = { ...cfg, rules: t.rules };
  const l = p.mode === 'days' ? buildDaysLuach(c, p, kiddush) : buildLuach(c, p, kiddush);
  const d = activeDesign(cfg, t);
  l.design = d && !l.values.multiDay ? d : null;
  l.designSkipped = !!d && !l.design;
  l.tpl = t;
  return l;
}
const drawLuach = l => l.design ? templateCanvas(l.design, l.values) : luachCanvas(l, l.tpl.font, l.tpl.sizes, l.tpl.theme);

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

function renderLuach() {
  $('welcome').hidden = saved;
  $('modeHoly').setAttribute('aria-pressed', String(mode === 'holy'));
  $('modeDays').setAttribute('aria-pressed', String(mode === 'days'));
  if (cursor == null) cursor = todayIn(cfg.tz);
  const p = findPeriod(mode, cursor, cfg.il);
  if (!p || !isFinite(cfg.lat) || !isFinite(cfg.lng)) {
    current = period = null;
    $('luach').innerHTML = '<p class="luach-empty">לא ניתן לחשב לוח. בדקו את המיקום בהגדרות.</p>';
    $('luachTpl').textContent = '';
    return;
  }
  cursor = p.first; period = p;
  current = build(p);
  applyDesign($('luach'), current.tpl);
  $('luachTpl').textContent = 'תבנית: ' + current.tpl.name;
  if (current.design) {
    const l = current;
    $('luach').innerHTML = '<img class="luach-img" alt="' + esc(l.title) + '">';
    templateCanvas(l.design, l.values).then(c => {
      if (current === l) $('luach').querySelector('img').src = c.toDataURL('image/png');
    }).catch(() => { if (current === l) $('luach').innerHTML = luachHtml(l); });
  } else {
    $('luach').innerHTML = luachHtml(current) + (current.designSkipped
      ? '<p class="hint">העיצוב מהקובץ מתאים לשבת או חג של יום אחד, ולכן הלוח הזה מוצג בעיצוב הרגיל.</p>' : '');
  }
  const now = findPeriod(mode, todayIn(cfg.tz), cfg.il);
  $('todayOcc').disabled = !!now && now.first === p.first;
}

$('prevOcc').onclick = () => { const o = period && stepPeriod(period, cfg.il, -1); if (o) { cursor = o.first; renderLuach(); } };
$('nextOcc').onclick = () => { const o = period && stepPeriod(period, cfg.il, 1); if (o) { cursor = o.first; renderLuach(); } };
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
  const promise = drawLuach(l).then(async canvas => ({
    png: new File([await pngBlob(canvas)], name + '.png', { type: 'image/png' }),
    pdf: new File([await pdfBlob(canvas)], name + '.pdf', { type: 'application/pdf' })
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
  $('tplList').innerHTML = cfg.templates.map(x => '<button type="button" class="chip" data-t="' + esc(x.id) + '" aria-pressed="' + (x === t) + '">' +
    esc(x.name) + '</button>').join('') + '<button type="button" class="chip add" id="tplAdd">+ תבנית חדשה</button>';
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

/** התבניות שאפשר לייבא מהן. עיצוב מלוח ישן – רק מתבנית מאותו סוג, כי האזורים שלו בנויים לפי סוג הלוח */
function importSources(part) {
  const t = selTpl();
  return cfg.templates.filter(x => x !== t && (part !== 'design' || (x.kind === t.kind && designOf(cfg, x))));
}
function closeImport(box) {
  box.querySelector('.imp-form').hidden = true;
  box.querySelector('.imp-open').hidden = false;
  box.querySelector('.imp-hint').hidden = true;
}
function openImport(box) {
  const part = box.dataset.part, t = selTpl(), list = importSources(part), hint = box.querySelector('.imp-hint');
  if (!list.length) {
    hint.textContent = part === 'design' ? 'אין תבנית אחרת מאותו סוג (' + (t.kind === 'days' ? 'ימי חול' : 'שבת או חג') + ') שיש לה עיצוב מלוח ישן.' : 'אין תבניות אחרות.';
    hint.hidden = false;
    return;
  }
  box.querySelector('.imp-from').innerHTML = list.map(x => '<option value="' + esc(x.id) + '">מ' + esc(x.name) + '</option>').join('');
  box.querySelector('.imp-open').hidden = true;
  box.querySelector('.imp-form').hidden = false;
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

function doImport(box) {
  const part = box.dataset.part, t = selTpl();
  const src = cfg.templates.find(x => x.id === box.querySelector('.imp-from').value);
  if (!src) return;
  if (part === 'rules') {
    const list = convertRules(src.rules, t.kind);
    t.rules = box.querySelector('.imp-how').value === 'add' ? mergeRules(t.rules, list, false, t.kind) : list;
    toast('הזמנים יובאו מ' + src.name);
  } else if (part === 'design') {
    const d = designOf(cfg, src);
    if (designOf(cfg, t) && !confirm('להחליף את העיצוב של "' + t.name + '" בעיצוב של "' + src.name + '"?')) return;
    // תבניות שמשתמשות בעיצוב הקודם של התבנית הזו שומרות עליו
    if (t.design && !t.design.ref) {
      for (const x of cfg.templates) if (x.design && x.design.ref === t.id) x.design = { ...t.design, enabled: x.design.enabled !== false };
    }
    t.design = { ...JSON.parse(JSON.stringify(d)), enabled: true };   // עותק נפרד
    if (!saveConfig(cfg)) { t.design = null; toast('אין מספיק מקום במכשיר לעותק של העיצוב', true); return; }
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
  if (b.id === 'tplAdd') { openNewTemplate(); return; }
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
$('tplInfo').addEventListener('click', e => {
  if (e.target.id !== 'tplDelete') return;
  const t = selTpl();
  if (!confirm('למחוק את התבנית "' + t.name + '"?')) return;
  cfg.templates = cfg.templates.filter(x => x !== t);
  sel = 'shabbat';
  renderTemplates(); changed();
});

function fillNewFrom() {
  const kind = $('tplNewKind').value;
  $('tplNewFrom').innerHTML = cfg.templates.filter(t => t.kind === kind)
    .map(t => '<option value="' + esc(t.id) + '">העתקה מ' + esc(t.name) + '</option>').join('') + '<option value="">בלי תפילות</option>';
}
function openNewTemplate() {
  $('tplNew').hidden = false;
  $('tplNewName').value = '';
  $('tplNewKind').value = 'holy';
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
  toast('התבנית נוצרה. בחרו מתי היא חלה');
};

function renderRules() {
  const days = selTpl().kind === 'days';
  $('rules').innerHTML = rules().map((r, i) => {
    const fixed = r.base === 'שעה קבועה';
    const kiddush = BASES[r.base] === 'kiddush';
    return '<div class="rule" data-i="' + i + '"><div class="rule-top">' +
      '<input data-k="name" value="' + esc(r.name) + '" placeholder="שם התפילה או השיעור" aria-label="שם התפילה">' +
      '<button type="button" data-del="' + i + '" aria-label="מחיקת ' + esc(r.name) + '">מחיקה</button></div>' +
      '<div class="rgrid">' +
      (days ? '' : '<div><label>מתי</label><select data-k="when">' + opts(WHEN, r.when) + '</select></div>') +
      '<div><label>חל על</label><select data-k="applies">' + opts(days ? DAY_APPLIES : APPLIES, r.applies) + '</select></div>' +
      '<div><label>לפי</label><select data-k="base">' + baseOpts(r) + '</select></div>' +
      '<div><label>' + (kiddush ? 'נוסח' : fixed ? 'שעה' : 'הפרש (דקות)') + '</label><input data-k="offset" value="' + esc(r.offset) +
      '" placeholder="' + (kiddush ? '{שם}{לרגל}' : fixed ? '08:00' : '-20') + '"' +
      (kiddush ? ' dir="rtl"' : ' dir="ltr" inputmode="' + (fixed ? 'text' : 'numeric') + '"') + '></div>' +
      '<div><label>עיגול</label><select data-k="round"' + (fixed || kiddush ? ' disabled' : '') + '>' + opts(ROUND, r.round) + '</select></div>' +
      '</div>' + (kiddush ? '<p class="hint">הטקסט יתמלא לפי מי שאושר לקידוש בתאריך הזה (מלוח הקידושים של הקהילה). ' +
        'אפשר להשתמש ב-{שם} (שם התורם), ב-{סיבה} (לרגל מה נתרם) וב-{לרגל} (מוסיף "לרגל ..." רק אם יש סיבה). ' +
        'בלי תאריך מאושר, השורה לא תופיע.</p>' : '') +
      '</div>';
  }).join('');
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
  if (saveConfig(cfg)) { saved = true; toast('נשמר'); }
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
  r[k] = e.target.value;
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
  }
  changed();
});
$('rules').addEventListener('click', e => {
  const i = e.target.getAttribute('data-del');
  if (i === null) return;
  rules().splice(+i, 1); renderRules(); changed();
});
$('addRule').onclick = () => {
  rules().push({ name: '', when: 'כל יום', applies: selTpl().kind === 'days' ? 'כל הימים' : 'שבת וחג', base: 'שקיעה', offset: '0', round: 'ללא' });
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
    if (!saveConfig(cfg)) {
      Object.assign(t, prev);
      toast('הקובץ גדול מדי לשמירה במכשיר. נסו קובץ קטן יותר', true);
      showTab('settings');
      return;
    }
    saved = true;
    sel = t.id;
    fill();
    // מציגים את הלוח הקרוב שמשתמש בתבנית
    if (mode !== t.kind) setMode(t.kind);
    const p = nextPeriodFor(cfg, t, todayIn(cfg.tz));
    cursor = p ? p.first : null;
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
$('tplRemove').onclick = () => {
  const t = selTpl();
  if (!confirm('להסיר את העיצוב מהתבנית "' + t.name + '"? זמני התפילות יישארו.')) return;
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
    cfg = normalize(data); cursor = null; fill(); saveConfig(cfg); saved = true;
    toast('ההגדרות נטענו');
  } catch (e) { toast('הקובץ לא תקין', true); }
};
$('reset').onclick = () => {
  if (!confirm('למחוק את כל ההגדרות במכשיר הזה ולחזור לברירת המחדל?')) return;
  clearConfig();
  cfg = normalize(DEFAULT_CONFIG); saved = false; cursor = null; sel = 'shabbat'; fill();
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
    return { file: png, title: current.title, firstDate: toYmd(period.first), mode: period.mode === 'days' ? 'days' : 'holy' };
  },
  onKiddush(map) {
    kiddush = map;
    renderLuach();
  }
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
