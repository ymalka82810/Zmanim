/**
 * עורך התבנית: מציג את העמוד מהקובץ הישן עם אזורים מסומנים, ומאפשר לקבוע
 * מה ייכתב בכל אזור (תפילה, זמן היום, כותרת, תאריך). במסמך סרוק מסמנים אזורים ידנית.
 */

import { BASES, WHEN, ROUND, DAY_APPLIES, appliesOnDay, prayerBases, designOf } from './config.js';
import { readFile, tokenize, detectDate, suggestSlots, textCandidates, inferRule } from './template-read.js';
import { analyzeSlot, refineBox, templateCanvas } from './template-render.js';
import { findOccasion, findPeriod, periodFor, buildLuach, buildDaysLuach, timesFor } from './luach.js';
import { toDayNum, toYmd, todayIn, dow } from './dates.js';
import { esc } from './render.js';

const $ = id => document.getElementById(id);
const KINDS = [['rule', 'תפילה או שיעור'], ['zman', 'זמן היום'], ['title', 'כותרת (שבת פרשת…)'], ['parasha', 'פרשת…'],
  ['parashaName', 'שם הפרשה בלבד'], ['hebDate', 'תאריך עברי'], ['gregDate', 'תאריך לועזי']];
const BASE_LABELS = Object.keys(BASES);
const ZMANIM = BASE_LABELS.filter(l => BASES[l] !== 'fixed');
const zmanKey = label => BASES[label];
const zmanLabel = key => ZMANIM.find(l => BASES[l] === key) || ZMANIM[0];
const opts = (list, v) => list.map(x => Array.isArray(x)
  ? '<option value="' + x[0] + '"' + (x[0] === v ? ' selected' : '') + '>' + esc(x[1]) + '</option>'
  : '<option' + (x === v ? ' selected' : '') + '>' + esc(x) + '</option>').join('');
/** אפשרויות "לפי": זמני היום, ואחריהם התפילות מהאזורים ומההגדרות */
const baseOpts = s => {
  const names = prayerBases(st.slots.filter(x => x.kind === 'rule').concat(st.cfg.rules || []), s);
  if (s.base && !(s.base in BASES) && names.indexOf(s.base) < 0) names.push(s.base);
  return opts(BASE_LABELS, s.base) + (names.length ? '<optgroup label="לפי תפילה">' + opts(names, s.base) + '</optgroup>' : '');
};
const oldMinutes = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(s.old || ''); return m ? +m[1] * 60 + +m[2] : null; };

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
export async function editFromFile(file, cfgAll, tpl, onDone) {
  const { canvas, items, fonts } = await readFile(file);
  const tokens = tokenize(items);
  const cfg = { ...cfgAll, rules: tpl.rules };
  const fit = x => ({ ...x, box: refineBox(canvas, x.box) });
  st = { canvas, W: canvas.width, H: canvas.height, cfg, cfgAll, tpl, name: file.name, onDone, fonts,
    candidates: textCandidates(tokens).map(fit), scanned: !items.length };
  setDay(detectDate(tokens));
  st.slots = suggestSlots(tokens, cfg, st.day, st.period).map(fit);
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
  // כללים קיימים: להציג את ההגדרה הנוכחית שלהם
  for (const s of st.slots) {
    if (s.kind !== 'rule') continue;
    const r = isDays() ? cfg.rules.find(x => x.name === s.name && appliesOnDay(x.applies, colOf(s.when)))
      : cfg.rules.find(x => x.name === s.name && x.when === s.when);
    if (r) Object.assign(s, { base: r.base, offset: r.offset, round: r.round });
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

function close(result) {
  const done = st.onDone;
  st = null;
  done(result);
}

/* ---------- תאריך הלוח הישן ---------- */

function renderOcc() {
  const o = st.period || (st.day != null ? findOccasion(st.day, st.cfg.il) : null);
  $('tplOcc').textContent = o ? 'הלוח הישן: ' + o.title : 'בחרו את התאריך של הלוח הישן כדי שהאתר יזהה את הכללים.';
}

$('tplDate').addEventListener('change', () => {
  if (!st) return;
  const v = $('tplDate').value;
  if (!v) return;
  let d = toDayNum(v);
  if (dow(d) === 5 && !isDays()) d++;          // יום שישי ← השבת שאחריו
  setDay(d);
  st.slots.forEach(reinfer);
  renderOcc(); renderSlots();
});

/** חישוב מחדש של הכלל לפי השעה בקובץ, היום והמתי */
function reinfer(s) {
  const m = oldMinutes(s);
  if (s.kind !== 'rule' || m == null || st.day == null) return;
  if (isDays()) {
    const c = colOf(s.when);
    if (c.day != null) Object.assign(s, inferRule(m, 'כל יום', timesFor(st.cfg, c.day), st.cfg.tz, s.name));
    return;
  }
  const t = timesFor(st.cfg, s.when === 'כניסה' ? st.day - 1 : st.day);
  Object.assign(s, inferRule(m, s.when, t, st.cfg.tz, s.name));
}

/* ---------- האזורים על העמוד ---------- */

const pct = (v, total) => (v / total * 100).toFixed(3) + '%';
function boxStyle(b) {
  return 'right:' + pct(st.W - b.x - b.w, st.W) + ';top:' + pct(b.y, st.H) + ';width:' + pct(b.w, st.W) + ';height:' + pct(b.h, st.H);
}

function renderBoxes() {
  let h = '';
  st.candidates.forEach((c, i) => {
    if (st.slots.some(s => s.box.x === c.box.x && s.box.y === c.box.y)) return;
    h += '<button type="button" class="tb cand" data-c="' + i + '" style="' + boxStyle(c.box) + '" title="' + esc(c.old) + '" aria-label="הוספת אזור: ' + esc(c.old) + '"></button>';
  });
  st.slots.forEach((s, i) => {
    h += '<button type="button" class="tb slot" data-s="' + i + '" style="' + boxStyle(s.box) + '" aria-label="אזור ' + (i + 1) + '"><span>' + (i + 1) + '</span></button>';
  });
  $('tplBoxes').innerHTML = h;
}

$('tplBoxes').addEventListener('click', e => {
  if (!st || st.drawing) return;
  const b = e.target.closest('.tb');
  if (!b) return;
  if (b.dataset.s != null) { focusSlot(+b.dataset.s); return; }
  const c = st.candidates[+b.dataset.c];
  st.slots.push({ box: c.box, kind: 'title', old: c.old });
  renderBoxes(); renderSlots(); focusSlot(st.slots.length - 1);
});

function focusSlot(i) {
  const ed = document.querySelector('.slot-ed[data-i="' + i + '"]');
  if (!ed) return;
  document.querySelectorAll('.slot-ed.sel').forEach(x => x.classList.remove('sel'));
  ed.classList.add('sel');
  ed.scrollIntoView({ behavior: 'smooth', block: 'center' });
  ed.querySelector('select').focus({ preventScroll: true });
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
$('tplPage').addEventListener('pointerdown', e => {
  if (!st || !st.drawing) return;
  e.preventDefault();
  $('tplPage').setPointerCapture(e.pointerId);
  drag = { start: toImg(e), el: document.createElement('div') };
  drag.el.className = 'tb slot drag';
  $('tplBoxes').appendChild(drag.el);
});
$('tplPage').addEventListener('pointermove', e => {
  if (!drag) return;
  const p = toImg(e), s = drag.start;
  drag.box = { x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) };
  drag.el.setAttribute('style', boxStyle(drag.box));
});
$('tplPage').addEventListener('pointerup', () => {
  if (!drag) return;
  const b = drag.box;
  drag.el.remove(); drag = null;
  if (!b || b.w < 8 || b.h < 8) return;
  st.slots.push({ box: b, kind: 'rule', when: isDays() ? 'd0' : 'כל יום', name: '', base: 'שקיעה', offset: '0', round: 'ללא', old: '' });
  st.drawing = false;
  $('tplDraw').setAttribute('aria-pressed', 'false');
  $('tplPage').classList.remove('drawing');
  renderBoxes(); renderSlots(); focusSlot(st.slots.length - 1);
});

/* ---------- רשימת האזורים ---------- */

function slotFields(s) {
  if (s.kind === 'rule') {
    const fixed = s.base === 'שעה קבועה';
    return '<div class="rgrid">' +
      '<div class="wide"><label>שם</label><input data-k="name" value="' + esc(s.name) + '" placeholder="למשל: מנחה"></div>' +
      (isDays() ? '<div><label>יום</label><select data-k="when">' + opts(dayOpts(), s.when) + '</select></div>'
        : '<div><label>מתי</label><select data-k="when">' + opts(WHEN, s.when) + '</select></div>') +
      '<div><label>לפי</label><select data-k="base">' + baseOpts(s) + '</select></div>' +
      '<div><label>' + (fixed ? 'שעה' : 'הפרש (דקות)') + '</label><input data-k="offset" dir="ltr" value="' + esc(s.offset) + '"></div>' +
      '<div><label>עיגול</label><select data-k="round"' + (fixed ? ' disabled' : '') + '>' + opts(ROUND, s.round) + '</select></div></div>';
  }
  if (s.kind === 'zman') {
    return '<div class="rgrid">' +
      '<div><label>איזה זמן</label><select data-k="zman">' + opts(ZMANIM, zmanLabel(s.zman)) + '</select></div>' +
      '<div><label>של איזה יום</label><select data-k="when">' + opts(isDays() ? dayOpts() : [['כניסה', 'ערב שבת/חג'], ['כל יום', 'שבת/חג'], ['יציאה', 'מוצאי שבת/חג']], s.when) + '</select></div></div>';
  }
  return '';
}

function renderSlots() {
  if (!st.slots.length) {
    $('tplSlots').innerHTML = '<p class="hint">לא זוהו אזורים. ' + (st.scanned ? 'לחצו "סימון אזור" וגררו על כל שעה בדף.' : '') + '</p>';
    return;
  }
  $('tplSlots').innerHTML = st.slots.map((s, i) =>
    '<div class="slot-ed" data-i="' + i + '"><div class="slot-top"><span class="num">' + (i + 1) + '</span>' +
    '<select data-k="kind" aria-label="מה יופיע באזור ' + (i + 1) + '">' + opts(KINDS, s.kind) + '</select>' +
    (s.old ? '<span class="old">בקובץ: <b>' + esc(s.old) + '</b>' + (s.label && s.kind !== 'rule' ? ' (' + esc(s.label) + ')' : '') + '</span>' : '') +
    '<button type="button" class="del" data-del="' + i + '">הסרה</button></div>' + slotFields(s) + '</div>'
  ).join('');
}

$('tplSlots').addEventListener('input', e => {
  const ed = e.target.closest('.slot-ed'), k = e.target.dataset.k;
  if (!ed || !k) return;
  const s = st.slots[+ed.dataset.i], v = e.target.value;
  if (k === 'kind') {
    s.kind = v;
    const when0 = isDays() ? 'd0' : 'כל יום';
    if (v === 'rule' && !s.base) { Object.assign(s, { when: s.when || when0, name: s.label || '', base: 'שקיעה', offset: '0', round: 'ללא' }); reinfer(s); }
    if (v === 'zman' && !s.zman) Object.assign(s, { zman: 'sunset', when: s.when || when0 });
    if (v === 'gregDate' && !s.fmt) s.fmt = { sep: '/', year: 4, pad: false };
    renderSlots(); focusSlot(+ed.dataset.i); return;
  }
  if (k === 'zman') s.zman = zmanKey(v);
  else s[k] = v;
  if (k === 'when' && s.kind === 'rule') { reinfer(s); renderSlots(); }
  if (k === 'base') {
    if (v === 'שעה קבועה' && s.offset.indexOf(':') < 0) s.offset = s.old && s.old.includes(':') ? s.old : '08:00';
    if (v !== 'שעה קבועה' && s.offset.indexOf(':') >= 0) s.offset = '0';
    renderSlots();
  }
});
$('tplSlots').addEventListener('click', e => {
  const i = e.target.dataset.del;
  if (i == null) return;
  st.slots.splice(+i, 1);
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
    if (s.kind !== 'rule' || !String(s.name).trim()) continue;
    const key = s.when + '|' + s.name.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: s.name.trim(), when: s.when, applies: 'שבת וחג', base: s.base, offset: s.offset, round: s.round });
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
    if (s.kind !== 'rule' || !name) continue;
    const k = [name, s.base, s.offset, s.round].join('|');
    if (!groups.has(k)) groups.set(k, { name, base: s.base, offset: s.offset, round: s.round, keys: new Set() });
    groups.get(k).keys.add(colOf(s.when).key);
  }
  const out = [];
  for (const g of groups.values()) {
    const want = cols.filter(c => g.keys.has(c.key)).map(c => c.key).join();
    const applies = DAY_APPLIES.slice(0, 5).find(a => cols.filter(c => appliesOnDay(a, c)).map(c => c.key).join() === want);
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

function buildTemplate() {
  const slots = st.slots.map(s => {
    const c = { box: s.box, kind: s.kind, old: s.old || '' };
    if (s.kind === 'rule') Object.assign(c, { name: String(s.name).trim(), when: s.when });
    if (s.kind === 'zman') Object.assign(c, { zman: s.zman, when: s.when });
    if (s.kind === 'hebDate') Object.assign(c, { ascii: !!s.ascii, noYear: !!s.noYear });
    if (s.kind === 'gregDate') c.fmt = s.fmt;
    c.style = analyzeSlot(st.canvas, s.box);
    return c;
  }).filter(s => s.kind !== 'rule' || s.name);
  // רק הגופנים שבשימוש נשמרים. אזור שסומן ידנית נכתב בגופן הנפוץ בשעות
  const count = {};
  for (const s of slots) if (s.box.font && st.fonts[s.box.font]) count[s.box.font] = (count[s.box.font] || 0) + (s.kind === 'rule' || s.kind === 'zman' ? 2 : 1);
  const mainFont = Object.keys(count).sort((a, b) => count[b] - count[a])[0] || null;
  const fonts = Object.fromEntries(Object.keys(count).map(k => [k, st.fonts[k]]));
  return { enabled: true, name: st.name, day: st.day, image: st.canvas.toDataURL('image/jpeg', 0.88),
    slots, candidates: st.candidates, fonts, mainFont };
}

$('tplPreview').onclick = async () => {
  const tpl = buildTemplate();
  const cfg = { ...st.cfg, rules: mergeRules(st.cfg.rules, slotRules(), $('tplRules').checked, st.tpl.kind) };
  const today = todayIn(cfg.tz);
  const occ = periodFor(st.cfgAll, st.tpl, today) || findPeriod(st.tpl.kind, today, cfg.il);
  const values = occ.mode === 'days' ? buildDaysLuach(cfg, occ).values : buildLuach(cfg, occ).values;
  const canvas = await templateCanvas(tpl, values);
  $('tplPreviewTitle').textContent = 'תצוגה מקדימה – ' + occ.title;
  $('tplPreviewImg').src = canvas.toDataURL('image/png');
  $('tplPreviewWrap').hidden = false;
  $('tplPreviewWrap').scrollIntoView({ behavior: 'smooth' });
};

$('tplSave').onclick = () => {
  const bad = st.slots.find(s => s.kind === 'rule' && !String(s.name).trim());
  if (bad) { focusSlot(st.slots.indexOf(bad)); SiteDialog.alert('יש אזור של תפילה בלי שם. כתבו שם או הסירו את האזור.'); return; }
  close({ tpl: st.tpl, template: buildTemplate(), rules: slotRules(), replace: $('tplRules').checked });
};
$('tplCancel').onclick = () => close(null);
