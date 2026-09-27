/** ממשק האתר: לוח, הגדרות, שיתוף וגיבוי. הכל נשמר מקומית בדפדפן. */

import { CITIES, BASES, WHEN, APPLIES, ROUND, FONTS, DEFAULT_CONFIG, fontFamilies, fontsHref, normalize, loadConfig, saveConfig, clearConfig } from './config.js';
import { findOccasion, buildLuach } from './luach.js';
import { luachHtml, luachText, esc } from './render.js';
import { todayIn } from './dates.js';
import { luachCanvas, pngBlob, pdfBlob } from './image.js';
import { templateCanvas } from './template-render.js';
import { editFromFile, editExisting, mergeRules } from './template-ui.js';

const $ = id => document.getElementById(id);
const BASE_LABELS = Object.keys(BASES);

let { cfg, saved } = loadConfig();
let cursor = null;       // היום שממנו מחפשים את האירוע המוצג
let current = null;      // הלוח המוצג כרגע

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
  for (const n of ['luach', 'settings']) $('tab-' + n).setAttribute('aria-selected', String(n === name));
  for (const n of ['luach', 'settings', 'template']) $('view-' + n).hidden = n !== name;
  if (name === 'luach') renderLuach();
}
$('tab-luach').onclick = () => showTab('luach');
$('tab-settings').onclick = () => showTab('settings');
$('goSettings').onclick = () => showTab('settings');

/* ---------- הלוח ---------- */

/** עיצוב מהקובץ הישן – רק לשבת/חג של יום אחד, כמו בלוח המקורי */
const useTemplate = l => !!(cfg.template && cfg.template.enabled && !l.values.multiDay);
const drawLuach = l => useTemplate(l) ? templateCanvas(cfg.template, l.values) : luachCanvas(l, cfg.font);

/** טעינת הגופן שנבחר מ-Google Fonts והחלתו על הלוח ועל הדוגמה בהגדרות */
function applyFont() {
  const href = fontsHref(cfg.font);
  let link = document.getElementById('fontLink');
  if (!link) {
    link = document.createElement('link');
    link.id = 'fontLink'; link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  if (link.getAttribute('href') !== href) link.href = href;
  const f = fontFamilies(cfg.font);
  for (const el of [$('luach'), $('fontSample')]) {
    el.style.setProperty('--f-title', f.title);
    el.style.setProperty('--f-body', f.body);
  }
  $('fontSample').style.fontFamily = f.title;
}

function renderLuach() {
  $('welcome').hidden = saved;
  if (cursor == null) cursor = todayIn(cfg.tz);
  const occ = findOccasion(cursor, cfg.il);
  if (!occ || !isFinite(cfg.lat) || !isFinite(cfg.lng)) {
    current = null;
    $('luach').innerHTML = '<p class="luach-empty">לא ניתן לחשב לוח. בדקו את המיקום בהגדרות.</p>';
    return;
  }
  cursor = occ.first;
  current = buildLuach(cfg, occ);
  if (useTemplate(current)) {
    const l = current;
    $('luach').innerHTML = '<img class="luach-img" alt="' + esc(l.title) + '">';
    templateCanvas(cfg.template, l.values).then(c => {
      if (current === l) $('luach').querySelector('img').src = c.toDataURL('image/png');
    }).catch(() => { if (current === l) $('luach').innerHTML = luachHtml(l); });
  } else {
    $('luach').innerHTML = luachHtml(current) + (cfg.template && cfg.template.enabled
      ? '<p class="hint">העיצוב מהקובץ מתאים לשבת או חג של יום אחד, ולכן הלוח הזה מוצג בעיצוב הרגיל.</p>' : '');
  }
  $('todayOcc').disabled = findOccasion(todayIn(cfg.tz), cfg.il).first === occ.first;
}

$('prevOcc').onclick = () => { const o = findOccasion(cursor - 1, cfg.il, -1); if (o) { cursor = o.first; renderLuach(); } };
$('nextOcc').onclick = () => { const o = findOccasion(cursor, cfg.il); if (o) { cursor = o.last + 1; renderLuach(); } };
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

const opts = (list, v) => list.map(x => '<option' + (x === v ? ' selected' : '') + '>' + esc(x) + '</option>').join('');

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
  $('font').value = cfg.font;
  applyFont();
  $('custom').hidden = cfg.city !== 'custom';
  renderRules();
  renderTemplateStatus();
}

function renderRules() {
  $('rules').innerHTML = cfg.rules.map((r, i) => {
    const fixed = r.base === 'שעה קבועה';
    return '<div class="rule" data-i="' + i + '"><div class="rule-top">' +
      '<input data-k="name" value="' + esc(r.name) + '" placeholder="שם התפילה או השיעור" aria-label="שם התפילה">' +
      '<button type="button" data-del="' + i + '" aria-label="מחיקת ' + esc(r.name) + '">מחיקה</button></div>' +
      '<div class="rgrid">' +
      '<div><label>מתי</label><select data-k="when">' + opts(WHEN, r.when) + '</select></div>' +
      '<div><label>חל על</label><select data-k="applies">' + opts(APPLIES, r.applies) + '</select></div>' +
      '<div><label>לפי</label><select data-k="base">' + opts(BASE_LABELS, r.base) + '</select></div>' +
      '<div><label>' + (fixed ? 'שעה' : 'הפרש (דקות)') + '</label><input data-k="offset" value="' + esc(r.offset) +
      '" placeholder="' + (fixed ? '08:00' : '-20') + '" dir="ltr" inputmode="' + (fixed ? 'text' : 'numeric') + '"></div>' +
      '<div><label>עיגול</label><select data-k="round"' + (fixed ? ' disabled' : '') + '>' + opts(ROUND, r.round) + '</select></div>' +
      '</div></div>';
  }).join('');
}

let saveTimer;
function changed() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (saveConfig(cfg)) { saved = true; toast('נשמר'); }
    else toast('לא ניתן לשמור במכשיר הזה (מצב גלישה פרטית?)', true);
  }, 400);
}

$('rules').addEventListener('input', e => {
  const box = e.target.closest('.rule'), k = e.target.getAttribute('data-k');
  if (!box || !k) return;
  const r = cfg.rules[+box.getAttribute('data-i')];
  r[k] = e.target.value;
  if (k === 'base') {
    if (r.base === 'שעה קבועה' && r.offset.indexOf(':') < 0) r.offset = '08:00';
    if (r.base !== 'שעה קבועה' && r.offset.indexOf(':') >= 0) r.offset = '0';
    renderRules();
  }
  changed();
});
$('rules').addEventListener('click', e => {
  const i = e.target.getAttribute('data-del');
  if (i === null) return;
  cfg.rules.splice(+i, 1); renderRules(); changed();
});
$('addRule').onclick = () => {
  cfg.rules.push({ name: '', when: 'כל יום', applies: 'שבת וחג', base: 'שקיעה', offset: '0', round: 'ללא' });
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
bind('font', v => { cfg.font = v; applyFont(); });

/* ---------- עיצוב מלוח קיים ---------- */

function renderTemplateStatus() {
  const t = cfg.template;
  $('tplStatus').hidden = !t;
  $('tplUseWrap').hidden = !t;
  $('tplEdit').hidden = !t;
  $('tplRemove').hidden = !t;
  $('tplUpload').textContent = t ? 'העלאת לוח אחר' : 'העלאת לוח ישן (PDF או תמונה)';
  if (t) {
    $('tplStatus').textContent = 'תבנית: ' + t.name + ' (' + t.slots.length + ' אזורים)';
    $('tplUse').checked = !!t.enabled;
  }
}

function templateDone(result) {
  if (result) {
    const prev = cfg.template;
    cfg.template = result.template;
    cfg.rules = mergeRules(cfg.rules, result.rules, result.replace);
    if (!saveConfig(cfg)) {
      cfg.template = prev;
      toast('הקובץ גדול מדי לשמירה במכשיר. נסו קובץ קטן יותר', true);
      showTab('settings');
      return;
    }
    saved = true;
    fill();
    cursor = null;
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
    await editFromFile(f, cfg, templateDone);
    showTab('template');
  } catch (e) {
    console.error(e);
    toast(navigator.onLine ? 'לא ניתן לקרוא את הקובץ' : 'קריאת PDF דורשת חיבור לאינטרנט בפעם הראשונה', true);
  }
};
$('tplEdit').onclick = async () => {
  try { await editExisting(cfg.template, cfg, templateDone); showTab('template'); }
  catch (e) { toast('לא ניתן לפתוח את התבנית', true); }
};
$('tplRemove').onclick = () => {
  if (!confirm('להסיר את התבנית? זמני התפילות בהגדרות יישארו.')) return;
  delete cfg.template; fill(); changed();
};
$('tplUse').onchange = () => { cfg.template.enabled = $('tplUse').checked; changed(); };

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
    if (!data || typeof data !== 'object' || !Array.isArray(data.rules)) throw new Error();
    cfg = normalize(data); cursor = null; fill(); saveConfig(cfg); saved = true;
    toast('ההגדרות נטענו');
  } catch (e) { toast('הקובץ לא תקין', true); }
};
$('reset').onclick = () => {
  if (!confirm('למחוק את כל ההגדרות במכשיר הזה ולחזור לברירת המחדל?')) return;
  clearConfig();
  cfg = normalize(DEFAULT_CONFIG); saved = false; cursor = null; fill();
  toast('ההגדרות אופסו');
};

/* ---------- הפעלה ---------- */

fill();
renderLuach();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
