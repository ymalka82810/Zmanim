/* חלונות בחירה בעיצוב האתר במקום החלונות האפורים של הדפדפן.
 * רשימות נפתחות (select) נפתחות כגיליון עם האפשרויות (ועם חיפוש כשיש הרבות), ושדות תאריך
 * (date ו-datetime-local) נפתחים כלוח שנה עברי כברירת מחדל, עם מעבר ללוח לועזי למי שלא יודע את התאריך העברי.
 * הבחירה נכתבת לשדה המקורי עם אירועי input ו-change, כך שהקוד של הדפים לא צריך להכיר אותה.
 * שדה שלא רוצים להחליף מסמנים ב-data-native. נטען מ-menu.js ולכן פועל בכל דף. */
(function () {
  "use strict";
  var BASE = document.currentScript.src;
  var H = null, D = null;
  var ready = Promise.all([import(new URL('hebrew.js', BASE).href), import(new URL('dates.js', BASE).href)])
    .then(function (m) { H = m[0]; D = m[1]; })
    .catch(function () { /* בלי הלוח העברי הבחירה נשארת לועזית */ });

  var css = '' +
    '.pk{--pk-bg:#fff;--pk-ink:#202a3f;--pk-muted:#726c59;--pk-line:#e2dcc9;--pk-soft:#f2ede0;--pk-acc:#1e3a63;--pk-on:#fff;--pk-gold:#ab7f2e;' +
    'border:0;padding:0;margin:auto auto 0;width:min(440px,100%);max-height:86vh;border-radius:18px 18px 0 0;background:var(--pk-bg);color:var(--pk-ink);' +
    'font-family:"Assistant",Arial,sans-serif;font-size:16px;direction:rtl;box-shadow:0 -10px 40px rgba(10,20,40,.3);overflow:hidden;flex-direction:column}' +
    ':root[data-theme="dark"] .pk{--pk-bg:#161d30;--pk-ink:#e9ecf5;--pk-muted:#98a2c0;--pk-line:#2a3252;--pk-soft:#202a48;--pk-acc:#8fb0ec;--pk-on:#0c1120;--pk-gold:#dfb564;box-shadow:0 -10px 40px rgba(0,0,0,.6)}' +
    '.pk[open]{display:flex}' +
    '.pk::backdrop{background:rgba(10,14,20,.5)}' +
    '@media(min-width:560px){.pk{margin:auto;border-radius:18px}}' +
    '.pk-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--pk-line);flex:none}' +
    '.pk-title{flex:1;min-width:0;font-weight:700;font-size:1.05rem;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}' +
    '.pk button{font:inherit;cursor:pointer;color:var(--pk-ink);background:none;border:0;box-shadow:none;transform:none;margin:0;width:auto;min-height:0}' +
    '.pk-x{flex:none;width:34px!important;height:34px;border-radius:50%;font-size:1.2rem;line-height:1;padding:0!important;color:var(--pk-muted)!important}' +
    '.pk-x:hover{background:var(--pk-soft)!important}' +
    '.pk-find{margin:10px 14px 0;padding:9px 12px;border:1px solid var(--pk-line);border-radius:10px;background:var(--pk-soft);color:var(--pk-ink);font:inherit;width:auto;flex:none}' +
    '.pk-find:focus{outline:0;border-color:var(--pk-acc)}' +
    '.pk-list{overflow-y:auto;overscroll-behavior:contain;padding:8px 8px calc(12px + env(safe-area-inset-bottom,0px));flex:1}' +
    '.pk-opt{display:flex!important;align-items:center;justify-content:space-between;gap:8px;width:100%!important;padding:12px 14px!important;border-radius:10px;text-align:start;font-size:1.02rem}' +
    '.pk-opt:hover:not(:disabled){background:var(--pk-soft)!important}' +
    '.pk-opt[aria-selected="true"]{background:var(--pk-soft)!important;color:var(--pk-acc);font-weight:700}' +
    '.pk-opt[aria-selected="true"]::after{content:"✓";flex:none}' +
    '.pk-opt:disabled{opacity:.4;cursor:default}' +
    '.pk-opt[hidden],.pk-grp[hidden],.pk-none[hidden]{display:none!important}' +
    '.pk-grp{padding:10px 14px 4px;font-size:.82rem;font-weight:700;color:var(--pk-muted)}' +
    '.pk-none{padding:18px;text-align:center;color:var(--pk-muted)}' +
    '.pk-cal{padding:10px 12px calc(12px + env(safe-area-inset-bottom,0px));overflow-y:auto}' +
    '.pk-nav{display:flex;align-items:center;gap:6px;margin-bottom:6px}' +
    '.pk-month{flex:1;text-align:center;font-weight:700;font-size:1.05rem}' +
    '.pk-month small{display:block;font-weight:600;font-size:.78rem;color:var(--pk-muted)}' +
    '.pk-arrow{flex:none;width:40px!important;height:40px;border-radius:50%;font-size:1.5rem;line-height:1;padding:0!important;color:var(--pk-acc)!important}' +
    '.pk-arrow:hover{background:var(--pk-soft)!important}' +
    '.pk-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center}' +
    '.pk-dow{font-size:.78rem;font-weight:700;color:var(--pk-muted);padding:4px 0}' +
    '.pk-day{display:flex!important;flex-direction:column;align-items:center;justify-content:center;aspect-ratio:1/1;padding:0!important;border-radius:10px;line-height:1.15}' +
    '.pk-day b{font-weight:700;font-size:1rem}' +
    '.pk-day i{font-style:normal;font-size:.62rem;color:var(--pk-muted)}' +
    '.pk-day:hover:not(:disabled){background:var(--pk-soft)!important}' +
    '.pk-day.pk-today{box-shadow:inset 0 0 0 1.5px var(--pk-gold)}' +
    '.pk-day.pk-sel{background:var(--pk-acc)!important;color:var(--pk-on)!important}' +
    '.pk-day.pk-sel i{color:inherit;opacity:.85}' +
    '.pk-day:disabled{opacity:.3;cursor:default}' +
    '.pk-pick{font-size:1.05rem!important;font-weight:700!important;padding:2px 8px!important;border-radius:8px}' +
    '.pk-pick:hover{background:var(--pk-soft)!important}' +
    '.pk-alt{display:block!important;width:100%!important;margin-top:10px!important;padding:8px!important;font-size:.9rem;font-weight:600;color:var(--pk-acc)!important;text-decoration:underline}' +
    '.pk-cap{display:block;font-size:.8rem;opacity:.75;margin-top:2px}' +
    '.pk-time{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:10px;padding-top:10px;border-top:1px solid var(--pk-line)}' +
    '.pk-time span{font-weight:700;color:var(--pk-muted)}' +
    '.pk-time input{width:64px;padding:8px 6px;text-align:center;font:inherit;font-size:1.1rem;border:1px solid var(--pk-line);border-radius:10px;background:var(--pk-soft);color:var(--pk-ink)}' +
    '.pk-time input:focus{outline:0;border-color:var(--pk-acc)}' +
    '.pk-foot{display:flex;gap:8px;margin-top:10px}' +
    '.pk-foot button{flex:1;padding:10px!important;border-radius:10px;border:1px solid var(--pk-line)!important;font-weight:700}' +
    '.pk-foot button:hover{background:var(--pk-soft)!important}' +
    '.pk-foot .pk-ok{background:var(--pk-acc)!important;color:var(--pk-on)!important;border-color:var(--pk-acc)!important}';
  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /* גיליון בסיסי: <dialog> מודאלי, כדי שיעלה גם מעל חלונות מודאליים שכבר פתוחים */
  function sheet(title) {
    var dlg = el('dialog', 'pk');
    var head = el('div', 'pk-head');
    var x = el('button', 'pk-x', '✕');
    x.type = 'button'; x.setAttribute('aria-label', 'סגירה');
    head.append(el('div', 'pk-title', title || ''), x);
    dlg.appendChild(head);
    function close() { if (dlg.open) dlg.close(); }
    x.addEventListener('click', close);
    dlg.addEventListener('click', function (e) { if (e.target === dlg) close(); });
    dlg.addEventListener('close', function () { dlg.remove(); });
    document.body.appendChild(dlg);
    return { dlg: dlg, close: close, show: function () { dlg.showModal(); } };
  }

  function fire(inp) {
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function labelOf(c) {
    var t = c.getAttribute('aria-label') || '';
    if (!t && c.id) { var l = document.querySelector('label[for="' + c.id + '"]'); if (l) t = l.textContent; }
    if (!t) { var p = c.closest('label'); if (p) t = Array.from(p.childNodes).filter(function (n) { return n.nodeType === 3; }).map(function (n) { return n.textContent; }).join(' '); }
    if (!t) { var f = c.closest('.field'); var fl = f && f.querySelector('label'); if (fl) t = fl.textContent; }
    return t.replace(/\s+/g, ' ').trim();
  }

  /* ---------- חיפוש ברשימה ----------
   * ההשוואה בלי גרש, גרשיים ומרכאות, כך ש"תשפז" מוצא את "תשפ״ז".
   * Enter (או "חיפוש" במקלדת) בוחר את התוצאה הראשונה; נשארה תוצאה אחת והחיפוש זהה למילה שלמה בה
   * (למשל שנה "תשפז" או "5787") – היא נבחרת מיד. */
  function norm(t) { return String(t || '').toLowerCase().replace(/[\u05F3\u05F4'"`׳״]/g, '').replace(/\s+/g, ' ').trim(); }
  function words(t) { return norm(t).split(/[\s()\[\],\-–·:]+/).filter(Boolean); }
  function searchList(find, list) {
    list.querySelectorAll('.pk-opt').forEach(function (b) { b.dataset.t = norm(b.textContent); b.dataset.w = '|' + words(b.textContent).join('|') + '|'; });
    function shown() { return Array.from(list.querySelectorAll('.pk-opt')).filter(function (b) { return !b.hidden && !b.disabled; }); }
    find.addEventListener('input', function () {
      var q = norm(find.value), any = false;
      list.querySelectorAll('.pk-opt').forEach(function (b) { var ok = !q || b.dataset.t.indexOf(q) >= 0; b.hidden = !ok; any = any || ok; });
      list.querySelectorAll('.pk-grp').forEach(function (g) {
        var n = g.nextElementSibling, vis = false;
        while (n && !n.classList.contains('pk-grp')) { if (!n.hidden) vis = true; n = n.nextElementSibling; }
        g.hidden = !vis;
      });
      var none = list.querySelector('.pk-none');
      if (!any && !none) list.appendChild(el('div', 'pk-none', 'לא נמצאו תוצאות'));
      else if (any && none) none.remove();
      var m = shown();
      if (q && m.length === 1 && m[0].dataset.w.indexOf('|' + q + '|') >= 0) m[0].click();
    });
    find.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      var m = shown(), q = norm(find.value);
      var exact = q && m.filter(function (b) { return b.dataset.w.indexOf('|' + q + '|') >= 0; })[0];
      if (exact || m.length) (exact || m[0]).click();
    });
  }

  /* ---------- רשימה נפתחת ---------- */
  function openSelect(sel) {
    if (sel.disabled) return;
    var s = sheet(labelOf(sel));
    var kids = Array.from(sel.children);
    var total = sel.options.length;
    var find = null;
    if (total > 10) {
      find = el('input', 'pk-find');
      find.type = 'search'; find.placeholder = 'חיפוש'; find.setAttribute('data-native', '');
      s.dlg.appendChild(find);
    }
    var list = el('div', 'pk-list');
    list.setAttribute('role', 'listbox');
    s.dlg.appendChild(list);

    function addOpt(o) {
      var b = el('button', 'pk-opt', o.textContent);
      b.type = 'button'; b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', String(o.selected));
      b.disabled = o.disabled;
      b.addEventListener('click', function () {
        var changed = sel.value !== o.value;
        sel.value = o.value;
        s.close();
        if (changed) fire(sel);
        sel.focus({ preventScroll: true });
      });
      list.appendChild(b);
    }
    kids.forEach(function (k) {
      if (k.tagName === 'OPTGROUP') {
        var g = el('div', 'pk-grp', k.label); g.dataset.g = '1'; list.appendChild(g);
        Array.from(k.children).forEach(addOpt);
      } else if (k.tagName === 'OPTION') addOpt(k);
    });

    if (find) searchList(find, list);

    s.show();
    var cur = list.querySelector('[aria-selected="true"]');
    if (cur) cur.scrollIntoView({ block: 'center' });
    if (find) find.focus({ preventScroll: true });
    else (cur || list.querySelector('.pk-opt:not(:disabled)') || list).focus({ preventScroll: true });
  }

  /* ---------- תאריך ----------
   * ברירת המחדל: לוח עברי (חודש עברי, ובכל יום האות העברית עם היום הלועזי קטן מתחתיה).
   * "לא יודעים מה התאריך העברי?" עובר ללוח לועזי (עם התאריך העברי מתחת לכל יום), ואפשר לחזור.
   * שדה עם data-greg נפתח ישר בלוח לועזי (למשל שדה "התאריך הלועזי" שליד בחירה עברית משלו).
   * בכל מצב הערך שנכתב לשדה הוא תאריך לועזי YYYY-MM-DD, כמו קודם. */
  var MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
  var DOWS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }
  var YMD = /^\d{4}-\d{2}-\d{2}$/;

  function hOrder(y) { return H.isLeap(y) ? [7, 8, 9, 10, 11, 12, 13, 1, 2, 3, 4, 5, 6] : [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6]; }
  function hStep(v, dir) {
    var o = hOrder(v.y), i = o.indexOf(v.m) + dir;
    if (i >= o.length) return { y: v.y + 1, m: 7 };
    if (i < 0) return { y: v.y - 1, m: 6 };
    return { y: v.y, m: o[i] };
  }
  function hFix(y, m) { return { y: y, m: (m === 13 && !H.isLeap(y)) ? 12 : m }; }

  /* רשימה קצרה לבחירת חודש או שנה עבריים */
  function chooseFrom(title, items, cur, done) {
    var s = sheet(title);
    var find = null;
    if (items.length > 10) {
      find = el('input', 'pk-find');
      find.type = 'search'; find.placeholder = 'חיפוש'; find.setAttribute('data-native', '');
      s.dlg.appendChild(find);
    }
    var list = el('div', 'pk-list');
    list.setAttribute('role', 'listbox');
    s.dlg.appendChild(list);
    items.forEach(function (it) {
      var b = el('button', 'pk-opt', it.label);
      b.type = 'button'; b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', String(it.value === cur));
      b.addEventListener('click', function () { s.close(); done(it.value); });
      list.appendChild(b);
    });
    if (find) searchList(find, list);
    s.show();
    if (find) find.focus({ preventScroll: true });
    var c = list.querySelector('[aria-selected="true"]');
    if (c) c.scrollIntoView({ block: 'center' });
  }

  function openDate(inp) {
    if (inp.disabled || inp.readOnly) return;
    var withTime = inp.type === 'datetime-local';
    var raw = inp.value || '';
    var now = new Date();
    var selStr = raw.slice(0, 10);
    var todayStr = ymd(now.getFullYear(), now.getMonth(), now.getDate());
    var base = YMD.test(selStr) ? selStr : todayStr;
    var min = inp.min ? inp.min.slice(0, 10) : '', max = inp.max ? inp.max.slice(0, 10) : '';
    var picked = YMD.test(selStr) ? selStr : '';
    var canHeb = !!(H && D) && !inp.hasAttribute('data-greg');
    var mode = canHeb ? 'heb' : 'greg';
    var vy = +base.slice(0, 4), vm = +base.slice(5, 7) - 1;   // תצוגה לועזית
    var hv = canHeb ? (function (h) { return { y: h.y, m: h.m }; })(H.toHebrew(D.toDayNum(base))) : null;   // תצוגה עברית

    var s = sheet(labelOf(inp));
    var cal = el('div', 'pk-cal');
    s.dlg.appendChild(cal);
    var nav = el('div', 'pk-nav');
    var next = el('button', 'pk-arrow', '›'), prev = el('button', 'pk-arrow', '‹');
    next.type = prev.type = 'button';
    next.setAttribute('aria-label', 'החודש הקודם'); prev.setAttribute('aria-label', 'החודש הבא');
    var mt = el('div', 'pk-month');
    nav.append(next, mt, prev);
    var grid = el('div', 'pk-grid');
    cal.append(nav, grid);

    var hh, mm;
    if (withTime) {
      var tv = /T(\d{2}):(\d{2})/.exec(raw);
      hh = el('input'); mm = el('input');
      [hh, mm].forEach(function (i) { i.type = 'text'; i.inputMode = 'numeric'; i.maxLength = 2; i.setAttribute('data-native', ''); });
      hh.value = tv ? tv[1] : pad(now.getHours()); mm.value = tv ? tv[2] : pad(now.getMinutes());
      hh.setAttribute('aria-label', 'שעה'); mm.setAttribute('aria-label', 'דקות');
      var tr = el('div', 'pk-time');
      tr.append(hh, el('span', null, ':'), mm);
      tr.style.direction = 'ltr';
      cal.appendChild(tr);
    }

    function commit() {
      if (!picked) return;
      var v = picked;
      if (withTime) {
        var h = Math.min(23, Math.max(0, parseInt(hh.value, 10) || 0)), m = Math.min(59, Math.max(0, parseInt(mm.value, 10) || 0));
        v += 'T' + pad(h) + ':' + pad(m);
      }
      var changed = inp.value !== v;
      inp.value = v;
      s.close();
      if (changed) fire(inp);
    }
    function choose(str) { picked = str; if (withTime) render(); else commit(); }

    var foot = el('div', 'pk-foot');
    var tb = el('button', null, 'היום'); tb.type = 'button';
    tb.addEventListener('click', function () {
      vy = now.getFullYear(); vm = now.getMonth();
      if (canHeb) { var h = H.toHebrew(D.toDayNum(todayStr)); hv = { y: h.y, m: h.m }; }
      choose(todayStr);
    });
    foot.appendChild(tb);
    if (withTime) {
      var ok = el('button', 'pk-ok', 'אישור'); ok.type = 'button';
      ok.addEventListener('click', commit);
      foot.appendChild(ok);
    }
    if (!inp.required && inp.value) {
      var clr = el('button', null, 'נקה'); clr.type = 'button';
      clr.addEventListener('click', function () { inp.value = ''; s.close(); fire(inp); });
      foot.appendChild(clr);
    }
    cal.appendChild(foot);

    var alt = null;
    if (canHeb) {
      alt = el('button', 'pk-alt'); alt.type = 'button';
      alt.addEventListener('click', function () {
        if (mode === 'heb') {
          var g = picked || D.toYmd(H.fromHebrew(hv.y, hv.m, 15));
          vy = +g.slice(0, 4); vm = +g.slice(5, 7) - 1;
          mode = 'greg';
        } else {
          var g2 = picked || ymd(vy, vm, 15), h = H.toHebrew(D.toDayNum(g2));
          hv = { y: h.y, m: h.m };
          mode = 'heb';
        }
        render();
      });
      cal.appendChild(alt);
    }

    function dayCell(str, big, small) {
      var b = el('button', 'pk-day');
      b.type = 'button';
      b.appendChild(el('b', null, big));
      if (small) b.appendChild(el('i', null, small));
      if (str === todayStr) b.classList.add('pk-today');
      if (str === picked) b.classList.add('pk-sel');
      b.disabled = !!((min && str < min) || (max && str > max));
      b.addEventListener('click', function () { choose(str); });
      grid.appendChild(b);
    }

    function render() {
      mt.textContent = '';
      grid.textContent = '';
      DOWS.forEach(function (d) { grid.appendChild(el('div', 'pk-dow', d)); });
      if (alt) alt.textContent = mode === 'heb' ? 'לא יודעים מה התאריך העברי?' : 'חזרה לבחירה לפי תאריך עברי';
      if (mode === 'heb') {
        var mb = el('button', 'pk-pick', H.monthName(hv.y, hv.m) + ' ▾'), yb = el('button', 'pk-pick', H.gematria(hv.y) + ' ▾');
        mb.type = yb.type = 'button';
        mb.setAttribute('aria-label', 'בחירת חודש עברי'); yb.setAttribute('aria-label', 'בחירת שנה עברית');
        mb.addEventListener('click', function () {
          chooseFrom('חודש עברי', hOrder(hv.y).map(function (m) { return { label: H.monthName(hv.y, m), value: m }; }), hv.m,
            function (m) { hv = { y: hv.y, m: m }; render(); });
        });
        yb.addEventListener('click', function () {
          var cy = H.toHebrew(D.toDayNum(todayStr)).y, from = Math.min(cy - 130, hv.y), to = Math.max(cy + 100, hv.y), items = [];
          for (var y = to; y >= from; y--) items.push({ label: H.gematria(y) + ' (' + y + ')', value: y });
          chooseFrom('שנה עברית', items, hv.y, function (y) { hv = hFix(y, hv.m); render(); });
        });
        mt.append(mb, ' ', yb);
        var len = H.monthLength(hv.y, hv.m), start = H.fromHebrew(hv.y, hv.m, 1);
        var g1 = D.toYmd(start), g2 = D.toYmd(start + len - 1);
        var m1 = +g1.slice(5, 7) - 1, m2 = +g2.slice(5, 7) - 1;
        mt.appendChild(el('small', null, m1 === m2 ? MONTHS[m1] + ' ' + g1.slice(0, 4) : MONTHS[m1] + ' – ' + MONTHS[m2] + ' ' + g2.slice(0, 4)));
        for (var i = D.dow(start); i > 0; i--) grid.appendChild(el('div'));
        for (var d = 1; d <= len; d++) {
          var str = D.toYmd(start + d - 1), gd = +str.slice(8), gm = +str.slice(5, 7);
          dayCell(str, H.gematria(d), (d === 1 || gd === 1) ? gd + '/' + gm : String(gd));
        }
      } else {
        mt.append(MONTHS[vm] + ' ' + vy);
        if (H && D) {
          var a = H.toHebrew(D.toDayNum(ymd(vy, vm, 1))), b = H.toHebrew(D.toDayNum(ymd(vy, vm, new Date(vy, vm + 1, 0).getDate())));
          var t = H.monthName(a.y, a.m) + ' ' + H.gematria(a.y);
          if (a.m !== b.m) t = H.monthName(a.y, a.m) + ' – ' + H.monthName(b.y, b.m) + ' ' + H.gematria(b.y);
          mt.appendChild(el('small', null, t));
        }
        var first = new Date(vy, vm, 1).getDay(), glen = new Date(vy, vm + 1, 0).getDate();
        for (var j = 0; j < first; j++) grid.appendChild(el('div'));
        for (var k = 1; k <= glen; k++) {
          var gs = ymd(vy, vm, k);
          dayCell(gs, String(k), (H && D) ? H.gematria(H.toHebrew(D.toDayNum(gs)).d) : '');
        }
      }
    }
    next.addEventListener('click', function () {
      if (mode === 'heb') hv = hStep(hv, -1);
      else { vm--; if (vm < 0) { vm = 11; vy--; } }
      render();
    });
    prev.addEventListener('click', function () {
      if (mode === 'heb') hv = hStep(hv, 1);
      else { vm++; if (vm > 11) { vm = 0; vy++; } }
      render();
    });
    render();
    s.show();
  }

  /* ---------- כיתוב עם התאריך העברי מתחת לשדה תאריך ----------
   * השדה עצמו מציג תאריך לועזי (כך הדפדפן מציג ערך של date), לכן מתחתיו נכתב התאריך העברי של הערך. */
  var caps = [];
  function hebText(v) {
    if (!H || !D || !YMD.test((v || '').slice(0, 10))) return '';
    var h = H.toHebrew(D.toDayNum(v.slice(0, 10)));
    return H.gematria(h.d) + ' ' + H.monthName(h.y, h.m) + ' ' + H.gematria(h.y);
  }
  function addCap(inp) {
    if (inp.dataset.pkCap || inp.hasAttribute('data-native') || inp.hasAttribute('data-greg') || inp.closest('.pk')) return;
    inp.dataset.pkCap = '1';
    var c = el('small', 'pk-cap');
    inp.insertAdjacentElement('afterend', c);
    caps.push({ inp: inp, c: c, v: null });
  }
  function refreshCaps() {
    caps = caps.filter(function (x) { return x.inp.isConnected; });
    caps.forEach(function (x) { if (x.inp.value !== x.v) { x.v = x.inp.value; x.c.textContent = hebText(x.v); } });
  }
  function scanCaps(root) {
    if (!root.querySelectorAll) return;
    if (root.matches && root.matches('input[type=date],input[type=datetime-local]')) addCap(root);
    root.querySelectorAll('input[type=date],input[type=datetime-local]').forEach(addCap);
    refreshCaps();
  }
  ready.then(function () {
    scanCaps(document);
    new MutationObserver(function (muts) {
      muts.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType === 1) scanCaps(n); }); });
    }).observe(document.body, { childList: true, subtree: true });
    document.addEventListener('input', refreshCaps, true);
    document.addEventListener('change', refreshCaps, true);
    setInterval(refreshCaps, 700);
  });

  /* ---------- חיבור לשדות ---------- */
  function isSel(t) { return t && t.tagName === 'SELECT' && !t.multiple && !(t.size > 1) && !t.hasAttribute('data-native') && !t.closest('.pk'); }
  function isDate(t) { return t && t.tagName === 'INPUT' && (t.type === 'date' || t.type === 'datetime-local') && !t.hasAttribute('data-native') && !t.closest('.pk'); }

  // מניעת החלון המובנה: בלחיצה ובמגע, ואז פתיחת החלון שלנו
  document.addEventListener('mousedown', function (e) {
    if (isSel(e.target) || isDate(e.target)) { e.preventDefault(); e.target.focus({ preventScroll: true }); }
  }, true);
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (isSel(t)) { e.preventDefault(); openSelect(t); }
    else if (isDate(t)) { e.preventDefault(); ready.then(function () { openDate(t); }); }
  }, true);
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (e.defaultPrevented || e.ctrlKey || e.metaKey) return;
    if (isSel(t) && (e.key === 'Enter' || e.key === ' ' || (e.altKey && e.key === 'ArrowDown'))) { e.preventDefault(); openSelect(t); }
    else if (isDate(t) && (e.key === 'Enter' || (e.altKey && e.key === 'ArrowDown'))) { e.preventDefault(); ready.then(function () { openDate(t); }); }
  }, true);
})();
