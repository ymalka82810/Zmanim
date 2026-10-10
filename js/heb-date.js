/* בחירת תאריך עברי לכל שדה תאריך באתר (input type=date או datetime-local).
 * ליד כל שדה נוסף כפתור "עברי" שפותח בחירה של יום, חודש ושנה עבריים. הבחירה נכתבת לשדה המקורי
 * (ערך לועזי, וגם אירועי input ו-change), כך שהקוד של הדפים לא צריך להכיר אותה.
 * נטען מ-menu.js, ולכן פועל בכל דף; שדות שנוצרים אחר כך נתפסים ע"י MutationObserver. */
(function () {
  "use strict";
  var BASE = document.currentScript.src;
  var H = null;
  var loading = import(new URL('hebrew.js', BASE).href).then(function (m) { H = m; });
  var DATES = import(new URL('dates.js', BASE).href);

  var css = '.hd-btn{margin-inline-start:6px;padding:2px 8px;font:inherit;font-size:.8rem;cursor:pointer;border:1px solid #9aa7bd;border-radius:6px;background:#fff;color:#2c4a7c;width:auto;min-height:0;line-height:1.4}' +
    '.hd-btn[aria-expanded=true]{background:#2c4a7c;color:#fff}' +
    '.hd-panel{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:6px 0;padding:6px 8px;border:1px solid #c9d2e3;border-radius:8px;background:#f4f7fc;direction:rtl}' +
    '.hd-panel[hidden]{display:none}.hd-panel select{width:auto;min-width:0;margin:0;font:inherit}' +
    '.hd-panel .hd-txt{font-size:.85rem;color:#2c4a7c;font-weight:600}';
  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  function opt(v, t) { var o = document.createElement('option'); o.value = v; o.textContent = t; return o; }

  function attach(inp) {
    if (inp.dataset.hdDone) return;
    inp.dataset.hdDone = '1';
    var isTime = inp.type === 'datetime-local';
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'hd-btn'; btn.textContent = 'תאריך עברי';
    btn.setAttribute('aria-expanded', 'false');
    var panel = document.createElement('div');
    panel.className = 'hd-panel'; panel.hidden = true;
    var sd = document.createElement('select'), sm = document.createElement('select'), sy = document.createElement('select');
    sd.setAttribute('aria-label', 'יום בחודש העברי'); sm.setAttribute('aria-label', 'חודש עברי'); sy.setAttribute('aria-label', 'שנה עברית');
    var txt = document.createElement('span'); txt.className = 'hd-txt';
    panel.append(sd, sm, sy, txt);
    inp.insertAdjacentElement('afterend', btn);
    btn.insertAdjacentElement('afterend', panel);

    function cur() {
      var v = inp.value ? inp.value.slice(0, 10) : '';
      return v ? v : null;
    }

    // ממלא את הרשימות לפי {y,m,d}
    function fill(h) {
      var leap = H.isLeap(h.y), y0 = H.toHebrew(Math.floor(Date.now() / 86400000)).y;
      var from = Math.min(y0 - 2, h.y), to = Math.max(y0 + 10, h.y);
      sy.textContent = '';
      for (var y = from; y <= to; y++) sy.appendChild(opt(y, H.gematria(y)));
      sy.value = h.y;
      sm.textContent = '';
      var months = leap ? [7, 8, 9, 10, 11, 12, 13, 1, 2, 3, 4, 5, 6] : [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6];
      months.forEach(function (m) { sm.appendChild(opt(m, H.monthName(h.y, m))); });
      sm.value = h.m;
      sd.textContent = '';
      for (var d = 1; d <= H.monthLength(h.y, h.m); d++) sd.appendChild(opt(d, H.gematria(d)));
      sd.value = Math.min(h.d, H.monthLength(h.y, h.m));
      txt.textContent = H.gematria(+sd.value) + ' ' + H.monthName(h.y, h.m) + ' ' + H.gematria(h.y);
    }

    function sync() {
      if (!H) return;
      DATES.then(function (D) {
        var v = cur();
        var dn = v ? D.toDayNum(v) : Math.floor(Date.now() / 86400000);
        fill(H.toHebrew(dn));
      });
    }

    function fire() {
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // שינוי בחירה: כשמחליפים שנה או חודש, מתאימים את היום (ושנה מעוברת/פשוטה את החודש)
    function pick() {
      DATES.then(function (D) {
        var y = +sy.value, m = +sm.value, d = +sd.value;
        if (m === 13 && !H.isLeap(y)) m = 12;
        d = Math.min(d, H.monthLength(y, m));
        var ymd = D.toYmd(H.fromHebrew(y, m, d));
        var time = isTime ? (inp.value.slice(10) || 'T00:00') : '';
        inp.value = ymd + time;
        fill({ y: y, m: m, d: d });
        fire();
      });
    }
    [sd, sm, sy].forEach(function (s) { s.addEventListener('change', pick); });

    btn.addEventListener('click', function () {
      panel.hidden = !panel.hidden;
      btn.setAttribute('aria-expanded', String(!panel.hidden));
      if (!panel.hidden) { loading.then(sync); }
    });
    // כשהשדה המקורי משתנה (הקלדה או בחירה בלוח הלועזי), הלוח העברי מתעדכן
    inp.addEventListener('input', function () { if (!panel.hidden) sync(); });
    inp.addEventListener('change', function () { if (!panel.hidden) sync(); });
    var dis = function () { [sd, sm, sy].forEach(function (s) { s.disabled = inp.disabled; }); btn.disabled = inp.disabled; };
    dis();
    new MutationObserver(dis).observe(inp, { attributes: true, attributeFilter: ['disabled'] });
  }

  function scan(root) {
    if (!root.querySelectorAll) return;
    if (root.matches && root.matches('input[type=date],input[type=datetime-local]')) attach(root);
    root.querySelectorAll('input[type=date],input[type=datetime-local]').forEach(attach);
  }

  function start() {
    scan(document);
    new MutationObserver(function (muts) {
      muts.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType === 1) scan(n); }); });
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
