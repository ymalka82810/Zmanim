/* קטלוג בית הכנסת: חפצים שבית הכנסת מוכר (מזוזות, לולבים, אתרוגים...) עם מחיר ותמונה.
 * חבר קהילה רואה את הפריטים; גבאי ורב מוסיפים, עורכים, מסמנים "נמכר" ומוחקים.
 * הנתונים מגיעים מ-catalog:list (convex/catalog.ts). הפיצ'ר פעיל רק כשהקהילה אישרה אותו (convex/features.ts).
 */
(function(){
"use strict";
const $ = s => document.querySelector(s);
const Auth = window.SiteAuth;
const ACCOUNT_URL = '../account/';
const CATEGORIES = ['מזוזות', 'ארבעת המינים', 'תפילין וטליתות', 'ספרים', 'כלי קודש', 'אחר'];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '₪' + n.toLocaleString('he-IL');

const S = { ready: false, signedIn: false, synagogues: [], sid: null, items: null, error: null, cat: '', file: null, remove: false, preview: null };
const synagogue = () => S.synagogues.find(s => s._id === S.sid);
const featureOn = sid => !!S.synagogues.find(s => s._id === sid)?.features?.includes('catalog');
const isManager = () => { const r = synagogue()?.role; return r === 'gabbai' || r === 'rabbi'; };

/* ---------- Boot & data ---------- */
async function boot(){
  render();
  try { await Auth.completeSignInFromRedirect(); } catch(e){ console.warn(e); }
  Auth.onChange(() => { S.signedIn = Auth.isAuthenticated(); loadSynagogues(); });
  S.signedIn = Auth.isAuthenticated();
  await loadSynagogues();
}

async function loadSynagogues(){
  if (!S.signedIn){ S.ready = true; S.synagogues = []; attach(null); return render(); }
  const saved = Auth.cached('synagogues:mine', {});
  if (saved) useSynagogues(saved);
  let list = [];
  try {
    const me = await Auth.query('users:me', {});
    if (me === null) S.signedIn = false;
    list = await Auth.query('synagogues:mine', {});
  } catch(e){ console.warn(e); if (saved) return; }
  if (!S.signedIn){ S.ready = true; S.synagogues = list; attach(null); return render(); }
  useSynagogues(list);
}

function useSynagogues(list){
  S.synagogues = list;
  S.ready = true;
  let sid = Auth.activeSynagogueId();
  if (!list.some(s => s._id === sid)){ sid = list[0]?._id || null; Auth.setActiveSynagogueId(sid); }
  attach(sid);
  render();
}

let unsub = null;
function attach(sid){
  if (sid === S.sid && unsub) return;
  if (unsub) unsub();
  unsub = null;
  S.sid = sid; S.items = null; S.error = null; S.cat = '';
  if (!sid || !featureOn(sid)) return;
  unsub = Auth.watch('catalog:list', { synagogueId: sid }, d => { S.items = d; render(); },
    e => { console.warn(e); S.error = errMsg(e); render(); });
}

function errMsg(e){ return (e && typeof e.data === 'string') ? e.data : 'הפעולה לא נשמרה. נסו שוב.'; }
async function call(name, args){ return await Auth.client().mutation(name, { synagogueId: S.sid, ...args }); }
function guard(fn){ return async (...a) => { try { await fn(...a); } catch(e){ console.warn(e); toast(errMsg(e)); } }; }

/* ---------- Render ---------- */
function hero(text, button){ return `<div class="hero"><h1>קטלוג בית הכנסת</h1><p class="muted">${text}</p></div>${button || ''}`; }

function render(){
  const app = $('#app');
  if (!S.ready){ app.innerHTML = '<div class="empty">טוען…</div>'; return; }
  if (!S.signedIn){ app.innerHTML = hero('כדי לראות את הקטלוג יש להתחבר עם חשבון Google.', '<button class="btn btn-google" data-act="signIn">כניסה עם Google</button>'); return; }
  if (!S.sid){ app.innerHTML = hero('עדיין לא הצטרפת לקהילה. אפשר להצטרף דרך הזמנה מהגבאי או לפתוח קהילה חדשה.', `<a class="btn" href="${ACCOUNT_URL}">לחשבון שלי</a>`); return; }
  const s = synagogue();
  if (window.SiteMenu) SiteMenu.setCommunity({ _id: S.sid, name: s.name, il: s.il });
  if (!featureOn(S.sid)){ app.innerHTML = hero('"קטלוג בית הכנסת" אינו פעיל בקהילה זו. כדי להשתמש בו, כל הגבאים והרב צריכים לאשר אותו ב"החשבון שלי", בפרטי הקהילה.', `<a class="btn" href="${ACCOUNT_URL}">לחשבון שלי</a>`); return; }
  if (S.error){ app.innerHTML = hero(esc(S.error)); return; }
  if (!S.items){ app.innerHTML = '<div class="empty">טוען…</div>'; return; }

  const cats = [...new Set(S.items.map(i => i.category).filter(Boolean))];
  if (S.cat && !cats.includes(S.cat)) S.cat = '';
  const shown = S.items.filter(i => !S.cat || i.category === S.cat);
  const add = isManager() ? '<button class="btn" type="button" data-act="add">הוספת פריט</button>' : '';
  app.innerHTML = `<header class="top"><div class="shul"><h1>קטלוג בית הכנסת</h1><small>${esc(s.name)}</small></div>${add}</header>` +
    (cats.length > 1 ? `<div class="cats"><button type="button" data-act="cat" data-c="" aria-pressed="${!S.cat}">הכול</button>${cats.map(c => `<button type="button" data-act="cat" data-c="${esc(c)}" aria-pressed="${S.cat === c}">${esc(c)}</button>`).join('')}</div>` : '') +
    (shown.length ? `<div class="grid">${shown.map(itemHTML).join('')}</div>`
      : `<div class="empty">${isManager() ? 'הקטלוג ריק. אפשר להוסיף פריט, למשל מזוזות, לולבים או אתרוגים.' : 'אין כרגע פריטים בקטלוג.'}</div>`);
}

function itemHTML(i){
  const sold = i.status === 'sold';
  const price = i.price === null ? '<span class="muted small">המחיר לפי פנייה</span>' : `<span class="price">${money(i.price)}</span>`;
  const img = i.imageUrl ? `<img src="${esc(i.imageUrl)}" alt="${esc(i.title)}" loading="lazy">` : '<div class="noimg" aria-hidden="true">🛍</div>';
  const mgr = isManager() ? `<div class="row">
      <button class="btn sec" type="button" data-act="edit" data-id="${i.id}">עריכה</button>
      <button class="btn ghost" type="button" data-act="sold" data-id="${i.id}" data-s="${sold ? 0 : 1}">${sold ? 'החזרה לזמין' : 'סימון כנמכר'}</button></div>` : '';
  return `<article class="item${sold ? ' sold' : ''}">${img}<div class="body">
    <div class="t">${esc(i.title)}${sold ? ' <span class="chip block">נמכר</span>' : ''}</div>
    ${price}
    ${i.desc ? `<div class="desc">${esc(i.desc)}</div>` : ''}
    ${i.contact ? `<div class="meta">לפרטים: ${esc(i.contact)}</div>` : ''}
    ${mgr}</div></article>`;
}

/* ---------- Sheets ---------- */
function openSheet(html){ $('#sheet').innerHTML = html; $('#sheetWrap').hidden = false; }
function closeSheet(){ clearPreview(); $('#sheetWrap').hidden = true; $('#sheet').innerHTML = ''; }
const sheetHead = t => `<div class="sh"><div style="flex:1"><h2>${esc(t)}</h2></div><button class="x" data-act="close" aria-label="סגירה">×</button></div>`;
let toastT;
function toast(msg){ let t = document.querySelector('.toast'); if (!t){ t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); } t.textContent = msg; clearTimeout(toastT); toastT = setTimeout(() => t.remove(), 3200); }

function clearPreview(){ if (S.preview) URL.revokeObjectURL(S.preview); S.preview = null; }

function itemSheet(item){
  S.file = null; S.remove = false; clearPreview();
  const cats = [...new Set([...CATEGORIES, ...S.items.map(i => i.category).filter(Boolean)])];
  openSheet(sheetHead(item ? 'עריכת פריט' : 'פריט חדש') +
    `<label class="f" for="ciTitle">שם הפריט</label><input type="text" id="ciTitle" maxlength="80" placeholder="לדוגמה: מזוזה מהודרת" value="${esc(item?.title || '')}">
     <label class="f" for="ciPrice">מחיר בשקלים (ריק – המחיר לפי פנייה)</label><input type="text" id="ciPrice" inputmode="decimal" value="${item && item.price !== null ? item.price : ''}">
     <label class="f" for="ciCat">קטגוריה</label><input type="text" id="ciCat" maxlength="40" list="ciCats" value="${esc(item?.category || '')}">
     <datalist id="ciCats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
     <label class="f" for="ciDesc">תיאור (לא חובה)</label><textarea id="ciDesc" maxlength="1000" placeholder="גודל, כשרות, כמות...">${esc(item?.desc || '')}</textarea>
     <label class="f" for="ciContact">איך פונים (לא חובה)</label><input type="text" id="ciContact" maxlength="120" placeholder="לדוגמה: הגבאי, 050-0000000" value="${esc(item?.contact || '')}">
     <label class="f">תמונה (לא חובה)</label>
     <input type="file" id="ciFile" accept="image/*">
     <img class="prev" id="ciPrev" alt=""${item?.imageUrl ? ` src="${esc(item.imageUrl)}"` : ' hidden'}>
     <button class="btn ghost" type="button" data-act="rmImage" id="ciRm"${item?.imageUrl ? '' : ' hidden'}>הסרת התמונה</button>
     <div class="row" style="margin-top:16px"><button class="btn" type="button" data-act="save" data-id="${item?.id || ''}">שמירה</button>
     ${item ? `<button class="btn danger" type="button" data-act="del" data-id="${item.id}">מחיקה</button>` : ''}<button class="btn ghost" type="button" data-act="close">ביטול</button></div>`);
}

/* התמונה מוקטנת בדפדפן לפני ההעלאה, כדי שלא תתפוס מקום מיותר באחסון הקהילה ותיטען מהר */
async function shrinkImage(file){
  const MAX = 1200, url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    const k = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement('canvas');
    cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(img, 0, 0, cv.width, cv.height);
    return await new Promise((ok, bad) => cv.toBlob(b => b ? ok(b) : bad(new Error('encode')), 'image/jpeg', .85));
  } finally { URL.revokeObjectURL(url); }
}

/* ---------- Actions ---------- */
const byId = id => S.items.find(i => i.id === id);
const A = {
  signIn: () => Auth.signInWithGoogle(location.href).catch(() => {}),
  close: closeSheet,
  cat: d => { S.cat = d.c; render(); },
  add: () => itemSheet(null),
  edit: d => { const i = byId(d.id); if (i) itemSheet(i); },
  rmImage: () => {
    S.file = null; S.remove = true; clearPreview();
    $('#ciPrev').hidden = true; $('#ciRm').hidden = true; $('#ciFile').value = '';
  },
  sold: guard(async d => { await call('catalog:setStatus', { id: d.id, sold: d.s === '1' }); }),
  save: guard(async (d, btn) => {
    const title = $('#ciTitle').value.trim();
    if (!title) return toast('יש לתת שם לפריט');
    const priceText = $('#ciPrice').value.trim().replace(',', '.');
    const price = priceText === '' ? undefined : Number(priceText);
    if (price !== undefined && !(price >= 0)) return toast('המחיר אינו תקין');
    const args = { title, price, desc: $('#ciDesc').value, category: $('#ciCat').value, contact: $('#ciContact').value };
    if (d.id) args.id = d.id;
    btn.disabled = true;
    try {
      if (S.file){
        const url = await call('catalog:generateUploadUrl', {});
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': S.file.type }, body: S.file });
        if (!res.ok) throw new Error('upload');
        args.imageId = (await res.json()).storageId;
      } else if (S.remove) args.removeImage = true;
      const r = await call('catalog:save', args);
      if (r && r.error) return toast(r.error);
      closeSheet(); toast(d.id ? 'הפריט עודכן' : 'הפריט נוסף');
    } finally { btn.disabled = false; }
  }),
  del: guard(async d => {
    if (!await SiteDialog.confirm('למחוק את הפריט מהקטלוג?', { ok: 'מחיקה', danger: true })) return;
    await call('catalog:remove', { id: d.id }); closeSheet(); toast('הפריט נמחק');
  }),
};
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (t){ const f = A[t.dataset.act]; if (f){ e.preventDefault(); f(t.dataset, t); } return; }
  if (e.target === $('#sheetWrap')) closeSheet();
});
document.addEventListener('change', async e => {
  if (e.target.id !== 'ciFile') return;
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  try { S.file = await shrinkImage(f); } catch(err){ e.target.value = ''; return toast('לא ניתן לקרוא את התמונה. נסו קובץ JPG או PNG.'); }
  S.remove = false; clearPreview();
  S.preview = URL.createObjectURL(S.file);
  const img = $('#ciPrev'); img.src = S.preview; img.hidden = false; $('#ciRm').hidden = false;
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheetWrap').hidden) closeSheet(); });

boot();
})();
