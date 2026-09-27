/* דף "החשבון שלי": כניסה עם Google, פתיחת בית כנסת, הצטרפות דרך קישור הזמנה, וניהול חברים לגבאי. */
(function(){
"use strict";
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const A = window.SiteAuth;
const client = A.client();

const S = { ready:false, isAuthenticated:false, me:null, synagogues:[], joinCode:null, joinInfo:undefined, detail:null, members:null, busy:false };

let toastT;
function toast(msg){ let t = $('.toast'); if (!t){ t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role','status'); document.body.appendChild(t); } t.textContent = msg; clearTimeout(toastT); toastT = setTimeout(() => t.remove(), 3600); }
function errMsg(e){ return (e && e.data && typeof e.data === 'string') ? e.data : (e && e.message) || 'משהו השתבש. נסו שוב.'; }

function openSheet(html){
  $('#sheet').innerHTML = html;
  $('#sheetWrap').hidden = false;
  requestAnimationFrame(() => $('#sheetWrap').classList.add('open'));
}
function closeSheet(){ $('#sheetWrap').hidden = true; $('#sheet').innerHTML = ''; }
$('#sheetWrap').addEventListener('click', e => { if (e.target.id === 'sheetWrap') closeSheet(); });

/* ---------- Boot ---------- */
async function boot(){
  const url = new URL(location.href);
  S.joinCode = url.searchParams.get('join');
  try { await A.completeSignInFromRedirect(); } catch(e){ console.warn(e); toast('ההתחברות נכשלה. נסו שוב.'); }
  A.onChange(() => { S.isAuthenticated = A.isAuthenticated(); loadAll(); });
  S.isAuthenticated = A.isAuthenticated();
  S.ready = true;
  await loadAll();
}

async function loadAll(){
  if (S.joinCode){
    client.query('invites:preview', { code: S.joinCode }).then(info => { S.joinInfo = info; render(); }).catch(() => { S.joinInfo = null; render(); });
  }
  if (S.isAuthenticated){
    try {
      const [me, synagogues] = await Promise.all([
        client.query('users:me', {}),
        client.query('synagogues:mine', {})
      ]);
      S.me = me; S.synagogues = synagogues;
    } catch(e){ console.warn(e); }
    if (S.joinCode){
      try {
        await client.mutation('invites:join', { code: S.joinCode });
        const joined = S.joinInfo;
        clearJoinParam();
        S.synagogues = await client.query('synagogues:mine', {});
        toast(joined ? 'הצטרפת ל' + joined.name : 'הצטרפת לבית הכנסת');
      } catch(e){ toast(errMsg(e)); clearJoinParam(); }
    }
  }
  render();
}

function clearJoinParam(){
  S.joinCode = null; S.joinInfo = undefined;
  const url = new URL(location.href);
  url.searchParams.delete('join');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}

/* ---------- Actions ---------- */
async function signIn(){
  try { await A.signInWithGoogle(location.href); }
  catch(e){ toast(errMsg(e)); }
}
async function signOut(){
  await A.signOut();
  S.isAuthenticated = false; S.me = null; S.synagogues = [];
  render();
}

async function refreshSynagogues(){ S.synagogues = await client.query('synagogues:mine', {}); }

async function createSynagogue(form){
  const name = form.name.value.trim(), city = form.city.value.trim(), il = form.il.value === '1';
  if (!name) return toast('נא למלא את שם בית הכנסת');
  if (!city) return toast('נא למלא את שם העיר');
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await client.mutation('synagogues:create', { name, city, il });
    await refreshSynagogues();
    closeSheet(); toast('בית הכנסת נפתח');
    render();
  } catch(e){ toast(errMsg(e)); btn.disabled = false; }
}

async function openDetail(id){
  S.detail = S.synagogues.find(s => s._id === id) || null;
  S.members = null;
  render();
  if (S.detail && S.detail.role === 'gabbai'){
    try { S.members = await client.query('members:list', { synagogueId: id }); } catch(e){ S.members = []; }
    if (S.detail) render();
  }
}

async function saveSynagogue(form, id){
  const name = form.name.value.trim(), city = form.city.value.trim(), il = form.il.value === '1';
  if (!name || !city) return toast('נא למלא שם ועיר');
  try {
    await client.mutation('synagogues:update', { synagogueId: id, name, city, il });
    await refreshSynagogues();
    S.detail = S.synagogues.find(s => s._id === id) || null;
    toast('הפרטים נשמרו'); render();
  } catch(e){ toast(errMsg(e)); }
}

async function rotateInvite(id){
  try {
    await client.mutation('invites:rotate', { synagogueId: id });
    await refreshSynagogues();
    S.detail = S.synagogues.find(s => s._id === id) || null;
    toast('קישור ההזמנה הוחלף'); render();
  } catch(e){ toast(errMsg(e)); }
}

async function copyInvite(code){
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('join', code);
  try { await navigator.clipboard.writeText(url.toString()); toast('הקישור הועתק'); }
  catch(e){ toast('העתקה נכשלה'); }
}
async function shareInvite(code, name){
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('join', code);
  if (navigator.share){ try { await navigator.share({ title: name, url: url.toString() }); } catch(e){ /* המשתמש ביטל */ } }
  else copyInvite(code);
}

async function setRole(synagogueId, userId, role){
  try {
    await client.mutation('members:setRole', { synagogueId, userId, role });
    S.members = await client.query('members:list', { synagogueId });
    render();
  } catch(e){ toast(errMsg(e)); render(); }
}
async function removeMember(synagogueId, userId){
  if (!confirm('להסיר את החבר מבית הכנסת?')) return;
  try {
    await client.mutation('members:remove', { synagogueId, userId });
    S.members = await client.query('members:list', { synagogueId });
    toast('החבר הוסר'); render();
  } catch(e){ toast(errMsg(e)); }
}
async function leaveSynagogue(id){
  if (!confirm('לעזוב את בית הכנסת?')) return;
  try {
    await client.mutation('members:leave', { synagogueId: id });
    S.detail = null; closeSheet();
    await refreshSynagogues();
    toast('עזבת את בית הכנסת'); render();
  } catch(e){ toast(errMsg(e)); }
}

/* ---------- Render ---------- */
function render(){
  const app = $('#app');
  if (!S.ready){ app.innerHTML = '<div class="empty">טוען…</div>'; return; }
  if (!S.isAuthenticated) return renderSignedOut(app);
  renderSignedIn(app);
}

function renderSignedOut(app){
  let html = `<div class="hero"><h1>החשבון שלי</h1><p class="muted">התחברות עם חשבון Google, לפתיחת בית כנסת או להצטרפות אליו כמתפלל.</p></div>`;
  if (S.joinCode){
    if (S.joinInfo === undefined){
      html += `<div class="card"><p class="muted">בודק את קישור ההזמנה…</p></div>`;
    } else if (S.joinInfo === null){
      html += `<div class="card"><div class="warn">קישור ההזמנה לא נמצא. בדקו עם הגבאי שהקישור נכון.</div></div>`;
    } else {
      html += `<div class="card"><h3>הזמנה להצטרף</h3><p>${esc(S.joinInfo.name)}, ${esc(S.joinInfo.city)}</p><p class="muted small">התחברו עם Google כדי להצטרף.</p></div>`;
    }
  }
  html += `<button class="btn" id="btnSignIn">כניסה עם Google</button>`;
  app.innerHTML = html;
  $('#btnSignIn').addEventListener('click', signIn);
}

function renderSignedIn(app){
  const me = S.me || {};
  let html = `<div class="hero"><h1>החשבון שלי</h1></div>
  <div class="card">
    <div class="profile">
      ${me.image ? `<img src="${esc(me.image)}" alt="">` : ''}
      <div class="who">
        <div class="name">${esc(me.name || 'משתמש')}${me.isOwner ? '<span class="owner-badge">בעל האתר</span>' : ''}</div>
        <div class="email">${esc(me.email || '')}</div>
      </div>
    </div>
    <button class="btn sec" id="btnSignOut">יציאה</button>
  </div>
  <div class="sechead"><h2>בתי הכנסת שלי</h2></div>
  <div class="card">`;
  if (!S.synagogues.length){
    html += `<p class="muted">עדיין לא הצטרפת לבית כנסת ולא פתחת אחד.</p>`;
  } else {
    html += S.synagogues.map(s => `
      <div class="syn-item" data-open="${s._id}" role="button" tabindex="0">
        <div class="info"><div class="n">${esc(s.name)}</div><div class="c">${esc(s.city)}, ${s.il ? 'ארץ ישראל' : 'חוץ לארץ'}</div></div>
        <span class="role-chip ${s.role}">${s.role === 'gabbai' ? 'גבאי' : 'מתפלל'}</span>
      </div>`).join('');
  }
  html += `</div><button class="btn sec" id="btnNewSyn">פתיחת בית כנסת חדש</button>`;
  app.innerHTML = html;
  $('#btnSignOut').addEventListener('click', signOut);
  $('#btnNewSyn').addEventListener('click', sheetCreateSynagogue);
  app.querySelectorAll('[data-open]').forEach(el => {
    el.addEventListener('click', () => openDetail(el.dataset.open));
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); openDetail(el.dataset.open); } });
  });
  if (S.detail) renderDetailSheet();
}

function sheetCreateSynagogue(){
  openSheet(`
    <div class="sh"><h2>פתיחת בית כנסת</h2><button class="x" data-close>✕</button></div>
    <form id="synForm">
      <label class="f">שם בית הכנסת</label><input type="text" name="name" required>
      <label class="f">עיר</label><input type="text" name="city" required>
      <label class="f">לוח פרשיות</label>
      <select name="il"><option value="1">ארץ ישראל</option><option value="0">חוץ לארץ</option></select>
      <div class="row" style="margin-top:16px"><button class="btn" type="submit">פתיחה</button><button class="btn sec" type="button" data-close>ביטול</button></div>
    </form>`);
  $('#sheet [data-close]').addEventListener('click', closeSheet);
  $('#synForm').addEventListener('submit', e => { e.preventDefault(); createSynagogue(e.target); });
}

function renderDetailSheet(){
  const s = S.detail;
  const isGabbai = s.role === 'gabbai';
  let html = `<div class="sh"><h2>${esc(s.name)}</h2><button class="x" data-close>✕</button></div>
    <p class="muted">${esc(s.city)}, ${s.il ? 'ארץ ישראל' : 'חוץ לארץ'}</p>`;

  if (isGabbai){
    const inviteUrl = new URL(location.pathname, location.origin);
    inviteUrl.searchParams.set('join', s.inviteCode);
    html += `
    <h3 style="margin-top:18px">קישור הזמנה למתפללים</h3>
    <div class="invite-box"><code>${esc(inviteUrl.toString())}</code></div>
    <div class="row" style="margin-top:8px">
      <button class="btn sec" type="button" id="btnCopyInvite">העתקה</button>
      <button class="btn sec" type="button" id="btnShareInvite">שיתוף</button>
      <button class="btn ghost" type="button" id="btnRotateInvite">החלפת קישור</button>
    </div>
    <h3 style="margin-top:18px">פרטי בית הכנסת</h3>
    <form id="editSynForm">
      <label class="f">שם</label><input type="text" name="name" value="${esc(s.name)}" required>
      <label class="f">עיר</label><input type="text" name="city" value="${esc(s.city)}" required>
      <label class="f">לוח פרשיות</label>
      <select name="il"><option value="1" ${s.il ? 'selected' : ''}>ארץ ישראל</option><option value="0" ${!s.il ? 'selected' : ''}>חוץ לארץ</option></select>
      <button class="btn sec" type="submit" style="margin-top:12px">שמירת פרטים</button>
    </form>
    <h3 style="margin-top:18px">חברים</h3>
    <div id="membersList">${S.members ? renderMembers(s._id, S.members) : '<p class="muted">טוען…</p>'}</div>`;
  } else {
    html += `<button class="btn danger" type="button" id="btnLeave" style="margin-top:16px">עזיבת בית הכנסת</button>`;
  }

  openSheet(html);
  $('#sheet [data-close]').addEventListener('click', closeSheet);
  if (isGabbai){
    $('#btnCopyInvite').addEventListener('click', () => copyInvite(s.inviteCode));
    $('#btnShareInvite').addEventListener('click', () => shareInvite(s.inviteCode, s.name));
    $('#btnRotateInvite').addEventListener('click', () => rotateInvite(s._id));
    $('#editSynForm').addEventListener('submit', e => { e.preventDefault(); saveSynagogue(e.target, s._id); });
    bindMemberActions(s._id);
  } else {
    $('#btnLeave').addEventListener('click', () => leaveSynagogue(s._id));
  }
}

function renderMembers(synagogueId, members){
  if (!members.length) return '<p class="muted">אין חברים עדיין.</p>';
  return members.map(m => `
    <div class="member-row" data-user="${m.userId}">
      ${m.image ? `<img src="${esc(m.image)}" alt="">` : ''}
      <div class="info"><div class="n">${esc(m.name || m.email || 'משתמש')}</div><div class="e">${esc(m.email || '')}</div></div>
      <select data-role="${m.userId}">
        <option value="gabbai" ${m.role === 'gabbai' ? 'selected' : ''}>גבאי</option>
        <option value="member" ${m.role === 'member' ? 'selected' : ''}>מתפלל</option>
      </select>
      <button class="btn ghost" data-remove="${m.userId}" aria-label="הסרה" title="הסרה">✕</button>
    </div>`).join('');
}
function bindMemberActions(synagogueId){
  const box = $('#membersList');
  if (!box) return;
  box.querySelectorAll('[data-role]').forEach(sel => {
    sel.addEventListener('change', () => setRole(synagogueId, sel.dataset.role, sel.value));
  });
  box.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => removeMember(synagogueId, btn.dataset.remove));
  });
}

boot();
})();
