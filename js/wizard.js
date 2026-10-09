/**
 * אשף התחלה לגבאי חדש, בשלושה צעדים: עיר, לוח (העלאת לוח קיים או עיצוב מוכן) ואישור.
 * האשף לא נוגע בהגדרות: הוא אוסף את הבחירות ומוסר אותן ל-onFinish, ש-app.js מחיל ושומר.
 */

const DONE_KEY = 'zmanim.wizardDone';

export function wizardDone() {
  try { return !!localStorage.getItem(DONE_KEY); } catch (e) { return false; }
}
function markDone() {
  try { localStorage.setItem(DONE_KEY, '1'); } catch (e) { /* אין גישה לאחסון */ }
}

let dlg = null;

export function closeWizard() { if (dlg) dlg.close(); }

/**
 * cities – [[מזהה, שם, ...]]; layouts – [[מזהה, שם, תיאור]];
 * start – { shul, city, layout } הערכים הנוכחיים;
 * drawLayouts(host, selected) – מציירת בתוך host את כרטיסי העיצובים המוכנים (data-layout), selected מסומן;
 * onFinish({ shul, city, layout, file }) – file הוא הלוח שהועלה, או null כשנבחר עיצוב מוכן
 */
export function openWizard({ cities, layouts, start, drawLayouts, onFinish }) {
  if (dlg) return;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const s = { step: 1, shul: start.shul || '', city: cities.some(c => c[0] === start.city) ? start.city : 'jerusalem',
    mode: 'ready', layout: start.layout, file: null };
  const TITLES = ['איפה בית הכנסת?', 'איזה לוח תרצו?', 'מוכנים?'];

  dlg = document.createElement('dialog');
  dlg.className = 'wiz';
  dlg.setAttribute('aria-labelledby', 'wizTitle');
  document.body.appendChild(dlg);

  function body() {
    if (s.step === 1) {
      return '<div class="field"><label for="wizShul">שם בית הכנסת</label><input id="wizShul" autocomplete="off" value="' + esc(s.shul) + '"></div>' +
        '<div class="field"><label for="wizCity">עיר</label><select id="wizCity">' +
        cities.map(c => '<option value="' + c[0] + '"' + (c[0] === s.city ? ' selected' : '') + '>' + esc(c[1]) + '</option>').join('') +
        '</select></div><p class="hint">העיר קובעת את זמני השקיעה והדלקת הנרות. מיקום אחר אפשר להגדיר אחר כך בהגדרות.</p>';
    }
    if (s.step === 2) {
      return '<div class="wiz-modes" role="group" aria-label="סוג הלוח">' +
        '<button type="button" data-mode="ready" aria-pressed="' + (s.mode === 'ready') + '">עיצוב מוכן</button>' +
        '<button type="button" data-mode="upload" aria-pressed="' + (s.mode === 'upload') + '">להעלות לוח קיים</button></div>' +
        (s.mode === 'ready'
          ? '<div class="lay-pick" id="wizLayouts" role="group" aria-label="עיצוב הלוח"></div>'
          : '<p class="hint">מעלים קובץ PDF או תמונה של הלוח שאתם מכירים. האתר יחליף בו רק את השעות והתאריכים, ויזהה ממנו את זמני התפילות. אחרי האישור תעברו לעריכת הלוח.</p>' +
            '<div class="actions left"><button type="button" id="wizPick">' + (s.file ? 'בחירת קובץ אחר' : 'בחירת קובץ') + '</button>' +
            '<input type="file" id="wizFile" accept="application/pdf,.pdf,image/*" hidden></div>' +
            '<p class="tpl-status" id="wizFileName"' + (s.file ? '' : ' hidden') + '>' + (s.file ? esc(s.file.name) : '') + '</p>');
    }
    const city = cities.find(c => c[0] === s.city), lay = layouts.find(l => l[0] === s.layout);
    return '<ul class="wiz-sum">' +
      (s.shul.trim() ? '<li><b>בית הכנסת:</b> ' + esc(s.shul.trim()) + '</li>' : '') +
      '<li><b>עיר:</b> ' + esc(city ? city[1] : '') + '</li>' +
      '<li><b>לוח:</b> ' + (s.mode === 'upload' ? 'הלוח שהעליתם: ' + esc(s.file.name) : 'עיצוב "' + esc(lay ? lay[1] : '') + '"') + '</li></ul>' +
      '<p class="hint">הכול ניתן לשינוי אחר כך בהגדרות.</p>';
  }

  function render() {
    const last = s.step === 3;
    dlg.innerHTML = '<form method="dialog" class="wiz-form" novalidate>' +
      '<div class="wiz-dots" aria-label="צעד ' + s.step + ' מתוך 3">' + [1, 2, 3].map(n => '<i' + (n <= s.step ? ' class="on"' : '') + '></i>').join('') + '</div>' +
      '<h2 id="wizTitle">' + TITLES[s.step - 1] + '</h2><div class="wiz-body">' + body() + '</div>' +
      '<div class="actions wiz-actions">' +
      '<button type="button" class="primary" id="wizNext"' + (s.step === 2 && s.mode === 'upload' && !s.file ? ' disabled' : '') + '>' + (last ? 'אישור והתחלה' : 'הבא') + '</button>' +
      (s.step > 1 ? '<button type="button" id="wizBack">חזרה</button>' : '') +
      '<button type="button" class="link" id="wizSkip">דלגו, אגדיר בעצמי</button></div></form>';
    if (s.step === 2 && s.mode === 'ready') drawLayouts(dlg.querySelector('#wizLayouts'), s.layout);
  }

  dlg.addEventListener('submit', e => e.preventDefault());
  dlg.addEventListener('input', e => {
    if (e.target.id === 'wizShul') s.shul = e.target.value;
  });
  dlg.addEventListener('change', e => {
    if (e.target.id === 'wizCity') s.city = e.target.value;
    if (e.target.id === 'wizFile') {
      s.file = e.target.files[0] || null;
      render();
    }
  });
  dlg.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.mode) { s.mode = t.dataset.mode; render(); }
    else if (t.dataset.layout) { s.layout = t.dataset.layout; render(); }
    else if (t.id === 'wizPick') dlg.querySelector('#wizFile').click();
    else if (t.id === 'wizBack') { s.step--; render(); }
    else if (t.id === 'wizSkip') { markDone(); dlg.close(); }
    else if (t.id === 'wizNext') {
      if (s.step < 3) { s.step++; render(); return; }
      markDone();
      const out = { shul: s.shul.trim(), city: s.city, layout: s.layout, file: s.mode === 'upload' ? s.file : null };
      dlg.close();
      onFinish(out);
    }
  });
  dlg.addEventListener('close', () => { dlg.remove(); dlg = null; });
  render();
  dlg.showModal();
}
