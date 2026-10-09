/** רשימת האזורים ופעולות העריכה שבה (חלק מ-js/template-ui.js שפוצל) */

import { specialHost, wordLine } from './template-render.js';
import { esc } from './render.js';
import { toggleTag } from './text-edit.js';
import { $, KINDS, zmanKey, opts, kiddush, offsetAbs, offsetDir, isDays, isChol, st, openSlots, slotTexts } from './template-state.js';
import { open } from './template-ui.js';
import { renderFontFill } from './template-fonts.js';
import { reinfer, pickRule } from './template-rules.js';
import { slotRanks, renderBoxes, readTextArea, fitKiddush, fitErase, focusSlot } from './template-boxes.js';
import { slotFields, paraFields, sizeFields, wrapLines } from './template-fields.js';
import { lineEdit, editLine, saveLine, resetWeek, slotLabel, slotSum, setLineEdit } from './template-lines.js';
import { lookOf, refreshWrapLines, schedulePreviewRefresh } from './template-build.js';

export function renderSlots() {
  // אזור שנוסף או הוסר משנה את הגופנים שכותבים בהם
  renderFontFill();
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
    '<button type="button" class="del" data-del="' + i + '">הסרה</button></div>' + slotFields(s) +
    (s.kind === 'erase' ? '' : sizeFields(s) + paraFields(s, i, order, ranks)) + '</details>'
  ).join('') + specialHint();
}

/** הודעה כשאין בקובץ אזור לשם של שבת מיוחדת (זכור, נחמו…) */
function specialHint() {
  if (isChol() || st.slots.some(s => s.kind === 'special')) return '';
  const host = specialHost(st.slots);
  return '<p class="hint">' + (host
    ? 'אין בקובץ אזור לשבת מיוחדת: בשבתות כמו זכור או נחמו השם יתווסף ל' + (host === 'title' ? 'כותרת' : 'פרשה') +
      '. אפשר גם לסמן לו אזור משלו ("סימון אזור") ולבחור "שבת מיוחדת".'
    : 'אין בקובץ אזור לשבת מיוחדת או לכותרת, ולכן בשבתות כמו זכור או נחמו השם לא יופיע. ' +
      'כדי שיופיע, לחצו "סימון אזור", גררו על מקום פנוי ובחרו "שבת מיוחדת".') + '</p>';
}
$('tplSlots').addEventListener('toggle', e => {
  const s = st.slots[+e.target.getAttribute('data-i')];
  if (s) e.target.open ? openSlots.add(s) : openSlots.delete(s);
}, true);

$('tplSlots').addEventListener('click', e => {
  const b = e.target.closest('[data-fmt]');
  if (!b) return;
  const field = b.closest('.wide').querySelector('textarea[data-k="text"]');
  if (field) { toggleTag(field, b.dataset.fmt); field.focus(); }
});

$('tplSlots').addEventListener('input', e => {
  const ed = e.target.closest('.slot-ed'), k = e.target.dataset.k;
  if (!ed || !k) return;
  const s = st.slots[+ed.dataset.i], v = e.target.value;
  if (k === 'kind') {
    const was = s.kind;
    s.kind = v;
    const when0 = isDays() ? 'd0' : 'כל יום';
    if (v === 'rule' && !s.base) { Object.assign(s, { when: s.when || when0, name: s.label || '', base: 'שקיעה', offset: '0', round: 'ללא' }); reinfer(s); }
    if (v === 'kiddush' && !s.name) Object.assign(s, { when: s.when || when0, name: s.label || 'קידוש' });
    if (v === 'kiddush') { fitKiddush(s, true); schedulePreviewRefresh(); }
    if (v === 'erase') fitErase(s);
    // אזור שנמחק או שחזר: השורות בעמוד מתרווחות מחדש
    if (v === 'erase' || was === 'erase') schedulePreviewRefresh();
    if (v === 'zman' && !s.zman) Object.assign(s, { zman: 'sunset', when: s.when || when0 });
    if (v === 'gregDate' && !s.fmt) s.fmt = { sep: '/', year: 4, pad: false };
    if (v === 'text' && s.text == null) {
      // אזור שסומן בגרירה על טקסט: הטקסט שבו, חלוקת השורות והמראה נקראים מהקובץ
      s.text = s.old ? s.old : readTextArea(s);
    }
    focusSlot(+ed.dataset.i); return;
  }
  // גופן אחר מהקובץ: גם הודעת האותיות החסרות מתעדכנת לפיו
  if (k === 'font') { s.box = { ...s.box, font: v }; renderFontFill(); schedulePreviewRefresh(); return; }
  if (k === 'sizePct' || k === 'lineHeightPct') { s[k] = Number(v); schedulePreviewRefresh(); return; }
  if (k === 'spaceBefore' || k === 'spaceAfter') { if (v === '') delete s[k]; else s[k] = Number(v); schedulePreviewRefresh(); return; }
  if (k === 'joinPrev') { if (e.target.checked) s.joinPrev = true; else delete s.joinPrev; renderSlots(); schedulePreviewRefresh(); return; }
  if (k === 'lineCount') { s.lineCount = Number(v); ed.querySelector('.wrap-lines').innerHTML = wrapLines(s); schedulePreviewRefresh(); return; }
  if (k === 'wrap') { s.wrap = e.target.checked; renderSlots(); schedulePreviewRefresh(); return; }
  if (k === 'day') {
    const keys = [...ed.querySelectorAll('input[data-k="day"]:checked')].map(x => x.value);
    // לפחות יום אחד
    if (!keys.length) { e.target.checked = true; return; }
    if (keys.length > 1) s.days = keys; else delete s.days;
    const when = keys[0];
    if (when !== s.when) { s.when = when; if (s.kind === 'rule') reinfer(s); }
    renderSlots(); return;
  }
  if (k === 'zman') s.zman = zmanKey(v);
  else if (k === 'offsetAbs' || k === 'offsetDir') {
    const abs = k === 'offsetAbs' ? v.replace(/[^0-9]/g, '') : offsetAbs(s);
    const dir = k === 'offsetDir' ? v : offsetDir(s);
    s.offset = abs === '' ? '' : String(dir === 'לפני' ? -Math.abs(+abs) : +abs);
    // המשתמש קבע הפרש בעצמו – הצעות הכללים כבר לא רלוונטיות. מסירים רק אותן, בלי לרנדר מחדש, כדי לא לאבד את המיקוד בשדה
    if (s.options) {
      delete s.options;
      const chips = ed.querySelector('.rule-opts');
      if (chips) chips.parentElement.remove();
    }
  } else s[k] = v;
  if (k === 'when' && s.kind === 'rule') { reinfer(s); renderSlots(); return; }
  if (k === 'base') {
    if (v === 'שעה קבועה' && s.offset.indexOf(':') < 0) s.offset = s.old && s.old.includes(':') ? s.old : '08:00';
    if (v !== 'שעה קבועה' && s.offset.indexOf(':') >= 0) s.offset = '0';
    renderSlots(); return;
  }
  ed.querySelector('.rule-name').textContent = slotLabel(s);
  ed.querySelector('.rule-sum').textContent = slotSum(s);
  // הטקסט השתנה – המילים בתיבות השורות מתעדכנות עם התצוגה. בקידוש רואים מיד את הנוסח החדש
  if (s.wrap || s.kind === 'kiddush' || (s.kind === 'text' && k === 'text')) schedulePreviewRefresh();
});
// בחירת השבוע בעורך הנוסח: התצוגה והשורות מתעדכנות לפי מה שיודפס באותו שבוע
$('tplSlots').addEventListener('change', e => {
  const sel = e.target.closest('[data-week]');
  if (!sel || !st.weeks) return;
  st.week = st.weeks[+sel.value];
  schedulePreviewRefresh();
});
$('tplSlots').addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !e.target.matches('[data-line-text]')) return;
  e.preventDefault();
  e.target.closest('.line-ed').querySelector('[data-line-save]').click();
});
$('tplSlots').addEventListener('click', async e => {
  const lookBtn = e.target.closest('[data-look]');
  if (lookBtn) {
    const s = st.slots[+lookBtn.closest('.slot-ed').dataset.i], k = lookBtn.dataset.look;
    s[k] = !lookOf(s)[k];
    lookBtn.setAttribute('aria-pressed', String(s[k]));
    schedulePreviewRefresh();
    return;
  }
  const word = e.target.closest('[data-word]');
  if (word) {
    const s = st.slots[+word.closest('.slot-ed').dataset.i], i = +word.dataset.word;
    const n = slotTexts.get(s).trim().split(/\s+/).length;
    const count = s.lineCount || 2;
    const lines = Array.from({ length: n }, (x, j) => wordLine(s.lines, j, count));
    lines[i] = (lines[i] + 1) % count;
    s.lines = lines;
    word.closest('.wrap-lines').innerHTML = wrapLines(s);
    schedulePreviewRefresh();
    return;
  }
  const lineEd = e.target.closest('[data-edit-line]');
  if (lineEd) {
    editLine(st.slots[+lineEd.closest('.slot-ed').dataset.i], +lineEd.dataset.editLine);
    return;
  }
  if (e.target.closest('[data-line-save]') && lineEdit) {
    const box = e.target.closest('.line-ed');
    saveLine(lineEdit.s, lineEdit.n, box.querySelector('[data-line-text]').value, box.querySelector('[name="lineScope"]:checked').value);
    return;
  }
  if (e.target.closest('[data-line-cancel]')) {
    setLineEdit(null);
    refreshWrapLines();
    return;
  }
  const weekReset = e.target.closest('[data-week-reset]');
  if (weekReset) {
    resetWeek(st.slots[+weekReset.closest('.slot-ed').dataset.i]);
    return;
  }
  const reset = e.target.closest('[data-reword-reset]');
  if (reset) {
    const s = st.slots[+reset.closest('.slot-ed').dataset.i];
    delete s.rewords; delete s.lines;
    schedulePreviewRefresh();
    return;
  }
  const opt = e.target.closest('[data-opt]');
  if (opt) {
    const s = st.slots[+opt.closest('.slot-ed').dataset.i];
    Object.assign(s, pickRule(s.options[+opt.dataset.opt]));
    renderSlots();
    return;
  }
  const i = e.target.dataset.del;
  if (i == null) return;
  if (!await SiteDialog.confirm('להסיר את האזור מהתבנית?', { ok: 'הסרה', danger: true })) return;
  const [gone] = st.slots.splice(+i, 1);
  st.sel = null;
  renderBoxes(); renderSlots();
  // טקסט שנמחק חוזר ללוח, והשורות חוזרות למקומן
  if (gone.kind === 'erase') schedulePreviewRefresh();
});

/* ---------- שמירה ---------- */

