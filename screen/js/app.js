/* עריכת מסך הטלוויזיה של בית הכנסת מהטלפון (convex/tv.ts), לגבאי ולרב: מה מוצג במסך, שקופיות הודעה (מזל טוב,
 * לעילוי נשמת, הודעות קהילה) עם תאריכי תוקף, פס רץ, ולאן מוביל ה-QR – לעמוד האורחים או ישר לתרומה.
 * השינוי נשלח כטיוטה, ועולה למסך (tv/) רק כשכל הגבאים והרב אישרו אותו. גבאי יחיד – מיד.
 */
(function(){
"use strict";
const $ = s => document.querySelector(s);
const Auth = window.SiteAuth;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const errMsg = e => (e && typeof e.data === 'string') ? e.data : 'הפעולה לא נשמרה. נסו שוב.';
const when = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const dShort = iso => { const [y, m, d] = iso.split('-'); return `${+d}.${+m}`; };
const SHOW = { zmanim: 'זמני היום', board: 'לוחות הזמנים המאושרים', qr: 'קוד QR' };

const S = { signedIn: false, sid: null, synagogue: null, data: null, error: null, form: null, base: '', dirty: false };
let toastT = null;
function toast(msg){
  let t = $('.toast');
  if (!t){ t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; clearTimeout(toastT); toastT = setTimeout(() => t.remove(), 3200);
}
const call = (name, args) => Auth.client().mutation(name, Object.assign({ synagogueId: S.sid }, args));
const clone = o => JSON.parse(JSON.stringify(o));

/* ---------- טעינה ---------- */
async function boot(){
  render();
  try { await Auth.completeSignInFromRedirect(); } catch(e){ console.warn(e); }
  Auth.onChange(() => { S.signedIn = Auth.isAuthenticated(); load(); });
  S.signedIn = Auth.isAuthenticated();
  load();
}

let unwatch = null;
async function load(){
  if (!S.signedIn){ attach(null); return render(); }
  let list = Auth.cached('synagogues:mine', {}) || [];
  try { list = await Auth.query('synagogues:mine', {}); } catch(e){ console.warn(e); }
  let sid = Auth.activeSynagogueId();
  if (!list.some(s => s._id === sid)) sid = list[0]?._id || null;
  S.synagogue = list.find(s => s._id === sid) || null;
  if (S.synagogue && window.SiteMenu) SiteMenu.setCommunity({ _id: sid, name: S.synagogue.name, il: S.synagogue.il });
  attach(sid);
  render();
}

function attach(sid){
  if (sid === S.sid && unwatch) return;
  if (unwatch){ unwatch(); unwatch = null; }
  S.sid = sid; S.data = null; S.error = null; S.form = null; S.dirty = false;
  const s = S.synagogue;
  if (!sid || !s || (s.role !== 'gabbai' && s.role !== 'rabbi')) return;
  unwatch = Auth.watch('tv:editor', { synagogueId: sid }, d => { S.data = d; S.error = null; syncForm(); render(); },
    e => { console.warn(e); S.error = errMsg(e); render(); });
}

/** הטופס מתחיל ממה שמוצג במסך, או מהטיוטה אם יש. כל עוד לא נגעו בו – הוא מתעדכן לפי השרת */
function syncForm(){
  const d = S.data;
  const src = d.draft ? d.draft.screen : d.live;
  const key = JSON.stringify(src);
  if (!S.form || (!S.dirty && key !== S.base)) { S.form = clone(src); S.base = key; S.dirty = false; }
}

/* ---------- תצוגה ---------- */
function tvUrl(){
  const url = new URL('../tv/', location.href);
  url.searchParams.set('c', S.data.publicCode);
  return Auth.publicUrl(url.toString());
}

/** מה השתנה בטיוטה לעומת המסך, במשפטים קצרים */
function changes(a, b){
  const out = [];
  for (const k of Object.keys(SHOW)) if (a.show[k] !== b.show[k]) out.push(`${SHOW[k]}: ${b.show[k] ? 'יוצגו' : 'יוסתרו'}`);
  if (a.rotateSec !== b.rotateSec) out.push(`החלפה כל ${b.rotateSec} שניות`);
  if (a.qr !== b.qr) out.push(b.qr === 'donate' ? 'ה-QR יוביל לתרומה' : 'ה-QR יוביל לעמוד האורחים');
  if (a.qrText !== b.qrText) out.push(`כיתוב ה-QR: ${b.qrText || 'ברירת המחדל'}`);
  if (a.ticker !== b.ticker) out.push(b.ticker ? `פס רץ: "${b.ticker}"` : 'בלי פס רץ');
  const sig = s => JSON.stringify([s.title, s.text, s.from, s.to]);
  const before = new Set(a.slides.map(sig)), after = new Set(b.slides.map(sig));
  for (const s of b.slides) if (!before.has(sig(s))) out.push(`שקופית חדשה או מעודכנת: ${s.title || s.text.slice(0, 40)}`);
  for (const s of a.slides) if (!after.has(sig(s))) out.push(`שקופית שהוסרה או עודכנה: ${s.title || s.text.slice(0, 40)}`);
  if (!out.length && JSON.stringify(a.slides) !== JSON.stringify(b.slides)) out.push('סדר השקופיות השתנה');
  return out;
}

function pendingCard(){
  const d = S.data, p = d.draft;
  if (!p) return '';
  const list = changes(d.live, p.screen);
  return `<section class="scr-sec scr-pending">
    <h2>שינוי שממתין לאישור</h2>
    <p class="small">הוצע על ידי ${esc(p.by)} · ${esc(when.format(p.at))}</p>
    ${list.length ? `<ul>${list.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <p class="small">אישרו: ${esc(p.approved.join(', ') || '—')}<br>ממתינים ל: ${esc(p.waiting.join(', ') || '—')}</p>
    <div class="scr-acts">
      ${p.approvedByMe ? '' : `<button class="btn" type="button" data-act="approve">אישור – להעלות למסך</button>`}
      <button class="btn ${p.mine ? 'danger' : 'ghost'}" type="button" data-act="discard">${p.mine ? 'ביטול ההצעה' : 'דחייה'}</button>
    </div>
    <p class="small muted">${p.approvedByMe ? 'אישרת את השינוי. הוא יעלה למסך כשכל הגבאים והרב יאשרו.' : 'אפשר גם לתקן את הטיוטה למטה ולשלוח מחדש. אז האישורים מתחילים מההתחלה.'}</p>
  </section>`;
}

function slideCard(s, i, n){
  return `<div class="scr-slide" data-i="${i}">
    <div class="scr-slide-h"><span>שקופית ${i + 1}</span><span class="acts">
      ${i > 0 ? `<button type="button" data-act="up" aria-label="הזזה למעלה">▲</button>` : ''}
      ${i < n - 1 ? `<button type="button" data-act="down" aria-label="הזזה למטה">▼</button>` : ''}
      <button type="button" class="del" data-act="remove">הסרה</button></span></div>
    <label class="f">כותרת</label><input type="text" data-k="title" maxlength="80" value="${esc(s.title)}" placeholder="לדוגמה: מזל טוב!">
    <label class="f">טקסט</label><textarea data-k="text" maxlength="600" rows="3" placeholder="לדוגמה: למשפחת כהן להולדת הבת">${esc(s.text)}</textarea>
    <div class="scr-dates">
      <div><label class="f">מתאריך</label><input type="date" data-k="from" value="${esc(s.from)}"></div>
      <div><label class="f">עד תאריך</label><input type="date" data-k="to" value="${esc(s.to)}"></div>
    </div>
    <div class="small muted">${s.from || s.to ? `מוצגת ${s.from ? 'מ-' + dShort(s.from) : ''} ${s.to ? 'עד ' + dShort(s.to) : ''}` : 'בלי תאריכים – מוצגת תמיד'}</div>
  </div>`;
}

function formHTML(){
  const f = S.form, single = S.data.managers <= 1;
  return `<form id="scrForm">
    <section class="scr-sec">
      <h2>מה מוצג במסך</h2>
      ${Object.entries(SHOW).map(([k, label]) => `<label class="check"><input type="checkbox" data-show="${k}" ${f.show[k] ? 'checked' : ''}> ${esc(label)}</label>`).join('')}
      <label class="f" for="scrRotate">החלפה בין לוחות ושקופיות כל (שניות)</label>
      <input type="number" id="scrRotate" min="5" max="120" step="1" value="${f.rotateSec}">
    </section>

    <section class="scr-sec">
      <h2>שקופיות הודעה</h2>
      <p class="small muted">מתחלפות עם לוחות הזמנים במרכז המסך. אפשר לקבוע מאיזה תאריך ועד איזה תאריך כל שקופית מוצגת.</p>
      <div id="scrSlides">${f.slides.map((s, i) => slideCard(s, i, f.slides.length)).join('')}</div>
      <button class="btn sec" type="button" data-act="add"${f.slides.length >= 20 ? ' disabled' : ''}>+ הוספת שקופית</button>
    </section>

    <section class="scr-sec">
      <h2>פס רץ</h2>
      <textarea id="scrTicker" maxlength="300" rows="2" placeholder="שורה שרצה בתחתית המסך. ריק – בלי פס רץ">${esc(f.ticker)}</textarea>
    </section>

    <section class="scr-sec">
      <h2>קוד QR</h2>
      <div class="scr-radio">
        <label><input type="radio" name="qr" value="guest" ${f.qr !== 'donate' ? 'checked' : ''}> לעמוד האורחים (זמנים, כתובת וניווט)</label>
        <label><input type="radio" name="qr" value="donate" ${f.qr === 'donate' ? 'checked' : ''}> ישר לתרומה – לזמנים מיוחדים</label>
      </div>
      <label class="f" for="scrQrText">כיתוב ליד ה-QR (לא חובה)</label>
      <input type="text" id="scrQrText" maxlength="60" value="${esc(f.qrText)}" placeholder="${f.qr === 'donate' ? 'סרקו לתרומה לבית הכנסת' : 'סרקו לזמני בית הכנסת בטלפון'}">
      <p class="small muted">התרומות שמופיעות לאורחים: תרומה כללית, וכל תרומה לזמן מיוחד או מגבית שסומנו בקופה "פתוחה גם לאורחים".</p>
    </section>

    <div class="scr-submit">
      <button class="btn" type="submit"${S.dirty ? '' : ' disabled'}>${single ? 'פרסום במסך' : S.data.draft ? 'שליחת התיקון לאישור' : 'שליחה לאישור הגבאים'}</button>
      ${S.dirty ? '<button class="btn sec" type="button" data-act="reset">ביטול השינויים</button>' : ''}
    </div>
  </form>`;
}

function render(){
  const app = $('#app');
  if (!S.signedIn){
    app.innerHTML = `<div class="hero"><h1>מסך בית הכנסת</h1><p class="muted">כדי לערוך את המסך יש להתחבר עם חשבון Google.</p></div>
      <button class="btn btn-google" data-act="signIn">כניסה עם Google</button>`;
    return;
  }
  const s = S.synagogue;
  if (!s){ app.innerHTML = `<div class="hero"><h1>מסך בית הכנסת</h1><p class="muted">אינך חבר בקהילה. אפשר להצטרף או ליצור קהילה בדף <a href="../account/">החשבון שלי</a>.</p></div>`; return; }
  if (s.role !== 'gabbai' && s.role !== 'rabbi'){ app.innerHTML = `<div class="hero"><h1>מסך בית הכנסת</h1><p class="muted">עריכת המסך מיועדת לגבאים ולרב.</p></div>`; return; }
  if (S.error && !S.data){ app.innerHTML = `<div class="hero"><h1>מסך בית הכנסת</h1><p class="muted">${esc(S.error)}</p></div>`; return; }
  if (!S.data){ app.innerHTML = '<div class="empty">טוען…</div>'; return; }
  const d = S.data;
  // שומרים את המיקום בדף ואת השדה שבו המשתמש מקליד, כדי שעדכון מהשרת לא יקפיץ אותו
  const focus = document.activeElement && app.contains(document.activeElement) ? focusKey(document.activeElement) : null;
  app.innerHTML = `<div class="hero"><h1>מסך בית הכנסת</h1>
    <p class="muted">${d.managers > 1 ? 'כל שינוי נשלח לאישור, ומופיע במסך רק אחרי שכל הגבאים והרב אישרו.' : 'אתה הגבאי היחיד, ולכן שינוי מופיע במסך מיד.'}</p></div>
    <div class="scr-tv">${d.publicCode ? `<a class="btn sec" href="${esc(tvUrl())}" target="_blank" rel="noopener">פתיחת המסך</a>
      <button class="btn ghost" type="button" data-act="copyTv">העתקת הקישור למסך</button>`
      : '<p class="small muted">כדי שהמסך יעבוד צריך להפעיל את עמוד האורחים בדף <a href="../account/">החשבון שלי</a> ← הקהילה.</p>'}</div>
    ${pendingCard()}
    ${formHTML()}`;
  if (focus) restoreFocus(focus);
}

const focusKey = el => ({ id: el.id, i: el.closest('[data-i]')?.dataset.i, k: el.dataset.k, start: el.selectionStart, end: el.selectionEnd });
function restoreFocus(f){
  const el = f.k != null ? $(`#scrSlides [data-i="${f.i}"] [data-k="${f.k}"]`) : f.id ? document.getElementById(f.id) : null;
  if (!el) return;
  el.focus();
  try { if (f.start != null) el.setSelectionRange(f.start, f.end); } catch(e){ /* שדה תאריך */ }
}

/* ---------- עריכה ---------- */
function touch(){ S.dirty = JSON.stringify(S.form) !== S.base; }
function refreshSubmit(){
  const bar = $('.scr-submit');
  if (!bar) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = formHTML();
  bar.replaceWith(tmp.querySelector('.scr-submit'));
}

document.addEventListener('input', e => {
  const t = e.target;
  if (!S.form || !t.closest('#scrForm')) return;
  const f = S.form;
  if (t.dataset.show) f.show[t.dataset.show] = t.checked;
  else if (t.id === 'scrRotate') f.rotateSec = Math.min(120, Math.max(5, Math.round(Number(t.value) || 20)));
  else if (t.id === 'scrTicker') f.ticker = t.value;
  else if (t.id === 'scrQrText') f.qrText = t.value;
  else if (t.name === 'qr') f.qr = t.value;
  else if (t.dataset.k) {
    const i = +t.closest('[data-i]').dataset.i;
    f.slides[i][t.dataset.k] = t.value;
  }
  touch();
  refreshSubmit();
});

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act, f = S.form;
  if (act === 'signIn') return Auth.signInWithGoogle(location.href).catch(() => {});
  if (act === 'copyTv') {
    try { await navigator.clipboard.writeText(tvUrl()); toast('הקישור למסך הועתק'); } catch(err){ toast('העתקה נכשלה'); }
    return;
  }
  if (act === 'add') { f.slides.push({ title: '', text: '', from: '', to: '' }); touch(); render(); $('#scrSlides .scr-slide:last-child input')?.focus(); return; }
  const slideEl = b.closest('[data-i]');
  if (slideEl) {
    const i = +slideEl.dataset.i;
    if (act === 'remove') f.slides.splice(i, 1);
    if (act === 'up') [f.slides[i - 1], f.slides[i]] = [f.slides[i], f.slides[i - 1]];
    if (act === 'down') [f.slides[i + 1], f.slides[i]] = [f.slides[i], f.slides[i + 1]];
    touch(); render();
    return;
  }
  if (act === 'reset') { S.form = clone(JSON.parse(S.base)); S.dirty = false; render(); return; }
  if (act === 'approve') {
    b.disabled = true;
    try { const r = await call('tv:approve', { draftAt: S.data.draft.at }); toast(r.live ? 'השינוי עלה למסך' : 'אישרת. ממתינים לשאר הגבאים'); }
    catch(err){ toast(errMsg(err)); b.disabled = false; }
    return;
  }
  if (act === 'discard') {
    const mine = S.data.draft.mine;
    if (!await SiteDialog.confirm(mine ? 'לבטל את ההצעה? המסך יישאר כמו שהוא.' : 'לדחות את השינוי? המסך יישאר כמו שהוא.', { ok: mine ? 'ביטול ההצעה' : 'דחייה', danger: true })) return;
    S.dirty = false; S.form = null;
    try { await call('tv:discard', {}); toast(mine ? 'ההצעה בוטלה' : 'השינוי נדחה'); } catch(err){ toast(errMsg(err)); }
  }
});

document.addEventListener('submit', async e => {
  if (e.target.id !== 'scrForm') return;
  e.preventDefault();
  const f = S.form;
  const bad = f.slides.find(s => s.from && s.to && s.from > s.to);
  if (bad) return toast(`בשקופית "${bad.title || bad.text.slice(0, 30)}" תאריך הסיום לפני תאריך ההתחלה`);
  const btn = e.target.querySelector('[type=submit]');
  btn.disabled = true;
  try {
    const r = await call('tv:saveDraft', { screen: f });
    S.dirty = false; S.base = '';
    toast(r.live ? 'השינוי עלה למסך' : 'נשלח לאישור שאר הגבאים והרב');
    window.scrollTo(0, 0);
  } catch(err){ toast(errMsg(err)); btn.disabled = false; }
});

boot();
})();
