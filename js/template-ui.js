/**
 * עורך התבנית: מציג את העמוד מהקובץ הישן עם אזורים מסומנים, ומאפשר לקבוע
 * מה ייכתב בכל אזור (תפילה, זמן היום, כותרת, תאריך). במסמך סרוק מסמנים אזורים ידנית.
 */

import { BASES, WHEN, WHEN_LABELS, ROUND, DAY_APPLIES, appliesOnDay, prayerBases, designOf } from './config.js';
import { readFile, tokenize, detectDate, suggestSlots, textCandidates, inferRule } from './template-read.js';
import { analyzeSlot, refineBox, templateCanvas } from './template-render.js';
import { findOccasion, findPeriod, periodFor, buildLuach, buildDaysLuach, timesFor } from './luach.js';
import { toDayNum, toYmd, todayIn, dow } from './dates.js';
import { esc } from './render.js';

const $ = id => document.getElementById(id);
const KINDS = [['text', 'טקסט שכותבים כאן'], ['rule', 'תפילה או שיעור'], ['zman', 'זמן היום'], ['title', 'כותרת (שבת פרשת…)'], ['parasha', 'פרשת…'],
  ['parashaName', 'שם הפרשה בלבד'], ['hebDate', 'תאריך עברי'], ['gregDate', 'תאריך לועזי'], ['address', 'כתובת בית הכנסת']];
const KIND_LABEL = Object.fromEntries(KINDS);
const BASE_LABELS = Object.keys(BASES);
const ZMANIM = BASE_LABELS.filter(l => BASES[l] !== 'fixed' && BASES[l] !== 'kiddush');
const isKiddush = s => BASES[s.base] === 'kiddush';
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
let kiddush = null;   // dateKey ← קידוש מאושר, לתצוגה המקדימה (מ-app.js)
export function setKiddush(map) { kiddush = map; }
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
  const fit = x => ({ ...x, box: refineBox(canvas, x.box), ...(x.labelBox ? { labelBox: refineBox(canvas, x.labelBox) } : {}) });
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
  if (s.kind !== 'rule' || m == null || st.day == null || isKiddush(s)) return;
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
    const fixed = s.base === 'שעה קבועה', kd = isKiddush(s);
    return '<div class="rgrid">' +
      '<div class="wide"><label>שם</label><input data-k="name" value="' + esc(s.name) + '" placeholder="למשל: מנחה"></div>' +
      (isDays() ? '<div><label>יום</label><select data-k="when">' + opts(dayOpts(), s.when) + '</select></div>'
        : '<div><label>מתי</label><select data-k="when">' + opts(WHEN_LABELS, s.when) + '</select></div>') +
      '<div><label>לפי</label><select data-k="base">' + baseOpts(s) + '</select></div>' +
      (kd || fixed
        ? '<div><label>' + (kd ? 'נוסח' : 'שעה') + '</label><input data-k="offset" dir="' + (kd ? 'rtl' : 'ltr') +
          '" value="' + esc(s.offset) + '"' + (kd ? ' placeholder="{שם}{לרגל}"' : '') + '></div>'
        : '<div><label>הפרש (דקות)</label><div class="offset-pair"><input data-k="offsetAbs" type="number" min="0" inputmode="numeric" dir="ltr" value="' +
          esc(offsetAbs(s)) + '" placeholder="20"><select data-k="offsetDir">' + opts(['אחרי', 'לפני'], offsetDir(s)) + '</select></div></div>') +
      '<div><label>עיגול</label><select data-k="round"' + (fixed || kd ? ' disabled' : '') + '>' + opts(ROUND, s.round) + '</select></div></div>';
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

/** תרגום "מתי" למילה בעברית: בלוח ימי חול s.when הוא מפתח (d0…d5) */
function whenLabel(w) {
  if (!isDays()) return w;
  const hit = dayOpts().find(([k]) => k === w);
  return hit ? hit[1] : w;
}

/** הכותרת לשורה הסגורה: שם התפילה, או סוג האזור לשאר הסוגים */
const slotLabel = s => s.kind === 'rule' ? (s.name || 'תפילה חדשה') : (KIND_LABEL[s.kind] || s.kind);

/** תקציר לשורה הסגורה: מתי ולפי מה, ומה היה בקובץ הישן */
function slotSum(s) {
  const parts = [];
  if (s.kind === 'rule') {
    const fixed = s.base === 'שעה קבועה', kd = isKiddush(s);
    const n = parseInt(s.offset, 10) || 0;
    const at = fixed ? 'בשעה ' + (s.offset || '') : kd ? s.base
      : n ? Math.abs(n) + ' דק׳ ' + (n < 0 ? 'לפני ' : 'אחרי ') + s.base : s.base;
    parts.push(whenLabel(s.when), at);
  } else if (s.kind === 'zman') {
    parts.push(zmanLabel(s.zman), whenLabel(s.when));
  } else if (s.kind === 'text' && s.text) {
    parts.push(s.text);
  }
  if (s.old) parts.push('בקובץ: ' + s.old + (s.label && s.kind !== 'rule' ? ' (' + s.label + ')' : ''));
  return parts.filter(Boolean).join(' · ');
}

function renderSlots() {
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
    '<button type="button" class="del" data-del="' + i + '">הסרה</button></div>' + slotFields(s) + '</details>'
  ).join('');
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
    if (v === 'zman' && !s.zman) Object.assign(s, { zman: 'sunset', when: s.when || when0 });
    if (v === 'gregDate' && !s.fmt) s.fmt = { sep: '/', year: 4, pad: false };
    if (v === 'text' && s.text == null) s.text = s.old || '';
    focusSlot(+ed.dataset.i); return;
  }
  if (k === 'zman') s.zman = zmanKey(v);
  else if (k === 'offsetAbs' || k === 'offsetDir') {
    const abs = k === 'offsetAbs' ? v.replace(/[^0-9]/g, '') : offsetAbs(s);
    const dir = k === 'offsetDir' ? v : offsetDir(s);
    s.offset = abs === '' ? '' : String(dir === 'לפני' ? -Math.abs(+abs) : +abs);
  } else s[k] = v;
  if (k === 'when' && s.kind === 'rule') { reinfer(s); renderSlots(); return; }
  if (k === 'base') {
    const kd = isKiddush(s);
    if (v === 'שעה קבועה' && s.offset.indexOf(':') < 0) s.offset = s.old && s.old.includes(':') ? s.old : '08:00';
    if (kd && /^-?\d+$/.test(s.offset)) s.offset = '';
    if (!kd && v !== 'שעה קבועה' && s.offset.indexOf(':') >= 0) s.offset = '0';
    renderSlots(); return;
  }
  ed.querySelector('.rule-name').textContent = slotLabel(s);
  ed.querySelector('.rule-sum').textContent = slotSum(s);
});
$('tplSlots').addEventListener('click', async e => {
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
    if (s.labelBox) c.labelBox = s.labelBox;
    if ((s.kind === 'parasha' || s.kind === 'parashaName') && s.prefix && s.prefix.trim()) c.prefix = s.prefix.trim() + ' ';
    if (s.kind === 'rule') Object.assign(c, { name: String(s.name).trim(), when: s.when });
    if (s.kind === 'zman') Object.assign(c, { zman: s.zman, when: s.when });
    if (s.kind === 'hebDate') Object.assign(c, { ascii: !!s.ascii, noYear: !!s.noYear });
    if (s.kind === 'gregDate') c.fmt = s.fmt;
    if (s.kind === 'text') c.text = String(s.text ?? '').trim();
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
  const values = occ.mode === 'days' ? buildDaysLuach(cfg, occ, kiddush).values : buildLuach(cfg, occ, kiddush).values;
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
$('tplCancel').onclick = async () => {
  if (!await SiteDialog.confirm('לבטל את עיצוב התבנית? השינויים לא יישמרו.', { ok: 'ביטול העיצוב', cancel: 'המשך עריכה', danger: true })) return;
  close(null);
};
