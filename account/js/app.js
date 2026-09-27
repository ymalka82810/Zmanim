/* דף "החשבון שלי": כניסה עם Google, פתיחת קהילה, הזמנות לפי מייל או קישור, וניהול חברים לגבאי ולרב. */
(function(){
"use strict";
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const A = window.SiteAuth;
const client = A.client();

const ROLE = { gabbai: 'גבאי', rabbi: 'רב', member: 'חבר קהילה' };
const isManager = role => role === 'gabbai' || role === 'rabbi';
const roleOptions = (selected, disableRabbi) => Object.entries(ROLE)
  .filter(([v]) => v !== 'rabbi' || !disableRabbi || v === selected)
  .map(([v, t]) => `<option value="${v}" ${v === selected ? 'selected' : ''}>${t}</option>`).join('');

const S = { ready:false, isAuthenticated:false, me:null, synagogues:[], invitations:[], joinCode:null, joinInfo:undefined, detail:null, members:null, pending:null };

let toastT;
function toast(msg){ let t = $('.toast'); if (!t){ t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role','status'); document.body.appendChild(t); } t.textContent = msg; clearTimeout(toastT); toastT = setTimeout(() => t.remove(), 3600); }
function errMsg(e){ return (e && e.data && typeof e.data === 'string') ? e.data : (e && e.message) || 'משהו השתבש. נסו שוב.'; }

function openSheet(html){
  $('#sheet').innerHTML = html;
  $('#sheetWrap').hidden = false;
  requestAnimationFrame(() => $('#sheetWrap').classList.add('open'));
}
function closeSheet(){ $('#sheetWrap').hidden = true; $('#sheet').innerHTML = ''; S.detail = null; }
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
      const [me] = await Promise.all([client.query('users:me', {}), refreshSynagogues(), refreshInvitations()]);
      if (me === null){
        /* יש טוקן ב-localStorage אבל השרת לא מזהה אותו (פג תוקף/בוטל) - מתייחסים כאל מנותק */
        A.clearAuth();
        S.isAuthenticated = false; S.me = null; S.synagogues = []; S.invitations = [];
        toast('ההתחברות פגה. נא להתחבר מחדש.');
      } else {
        S.me = me;
      }
    } catch(e){ console.warn(e); }
    if (S.isAuthenticated && S.joinCode){
      try {
        const id = await client.mutation('invites:join', { code: S.joinCode });
        const joined = S.joinInfo;
        clearJoinParam();
        A.setActiveSynagogueId(id);
        await refreshSynagogues();
        toast(joined ? 'הצטרפת לקהילה ' + joined.name : 'הצטרפת לקהילה');
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
  S.isAuthenticated = false; S.me = null; S.synagogues = []; S.invitations = [];
  render();
}

async function refreshSynagogues(){
  S.synagogues = await client.query('synagogues:mine', {});
  const active = A.activeSynagogueId();
  if (!S.synagogues.some(s => s._id === active)) A.setActiveSynagogueId(S.synagogues.length ? S.synagogues[0]._id : null);
}
async function refreshInvitations(){ S.invitations = await client.query('invitations:mine', {}); }
function refreshDetail(id){ S.detail = S.synagogues.find(s => s._id === id) || null; }

function setActive(id){
  A.setActiveSynagogueId(id);
  const s = S.synagogues.find(x => x._id === id);
  toast('הקהילה הפעילה: ' + (s ? s.name : ''));
  render();
}

async function acceptInvitation(id){
  try {
    const synagogueId = await client.mutation('invitations:accept', { invitationId: id });
    A.setActiveSynagogueId(synagogueId);
    await Promise.all([refreshSynagogues(), refreshInvitations()]);
    toast('הצטרפת לקהילה'); render();
  } catch(e){ toast(errMsg(e)); }
}
async function declineInvitation(id){
  if (!confirm('לדחות את ההזמנה?')) return;
  try {
    await client.mutation('invitations:decline', { invitationId: id });
    await refreshInvitations();
    toast('ההזמנה נדחתה'); render();
  } catch(e){ toast(errMsg(e)); }
}

async function createSynagogue(form){
  const name = form.name.value.trim(), city = form.city.value.trim(), il = form.il.value === '1';
  if (!name) return toast('נא למלא את שם הקהילה');
  if (!city) return toast('נא למלא את שם העיר');
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    const id = await client.mutation('synagogues:create', { name, city, il });
    A.setActiveSynagogueId(id);
    await refreshSynagogues();
    closeSheet(); toast('הקהילה נפתחה');
    render();
  } catch(e){
    if (errMsg(e) === 'יש להתחבר'){
      A.clearAuth();
      S.isAuthenticated = false; S.me = null; S.synagogues = []; S.invitations = [];
      closeSheet(); toast('ההתחברות פגה. נא להתחבר מחדש.'); render();
      return;
    }
    toast(errMsg(e)); btn.disabled = false;
  }
}

async function loadManagerData(id){
  const [members, pending] = await Promise.all([
    client.query('members:list', { synagogueId: id }).catch(() => []),
    client.query('invitations:listForSynagogue', { synagogueId: id }).catch(() => []),
  ]);
  S.members = members; S.pending = pending;
}

async function openDetail(id){
  refreshDetail(id);
  S.members = null; S.pending = null;
  render();
  if (S.detail && isManager(S.detail.role)){
    await loadManagerData(id);
    if (S.detail) render();
  }
}

async function saveSynagogue(form, id){
  const name = form.name.value.trim(), city = form.city.value.trim(), il = form.il.value === '1';
  if (!name || !city) return toast('נא למלא שם ועיר');
  try {
    await client.mutation('synagogues:update', { synagogueId: id, name, city, il });
    await refreshSynagogues(); refreshDetail(id);
    toast('הפרטים נשמרו'); render();
  } catch(e){ toast(errMsg(e)); }
}

async function inviteByEmail(form, synagogueId){
  const email = form.email.value.trim(), role = form.role.value;
  if (!email) return toast('נא למלא כתובת מייל');
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await client.mutation('invitations:create', { synagogueId, email, role });
    await loadManagerData(synagogueId);
    toast('ההזמנה נשלחה. היא תופיע אצל ' + email + ' בכניסה הבאה לאפליקציה'); render();
  } catch(e){ toast(errMsg(e)); btn.disabled = false; }
}
async function cancelInvitation(synagogueId, invitationId){
  try {
    await client.mutation('invitations:cancel', { invitationId });
    await loadManagerData(synagogueId);
    toast('ההזמנה בוטלה'); render();
  } catch(e){ toast(errMsg(e)); }
}

function inviteUrl(code){
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('join', code);
  return url.toString();
}
async function rotateInvite(id){
  try {
    await client.mutation('invites:rotate', { synagogueId: id });
    await refreshSynagogues(); refreshDetail(id);
    toast('קישור ההזמנה הוחלף'); render();
  } catch(e){ toast(errMsg(e)); }
}
async function copyInvite(code){
  try { await navigator.clipboard.writeText(inviteUrl(code)); toast('הקישור הועתק'); }
  catch(e){ toast('העתקה נכשלה'); }
}
async function shareInvite(code, name){
  if (navigator.share){ try { await navigator.share({ title: name, url: inviteUrl(code) }); } catch(e){ /* המשתמש ביטל */ } }
  else copyInvite(code);
}

async function setRole(synagogueId, userId, role){
  const current = (S.members || []).find(m => m.userId === userId);
  const previousRole = current ? current.role : null;
  if (previousRole === role) return;
  const isSelf = S.me && S.me.userId === userId;
  if (isSelf && isManager(previousRole) && !isManager(role)){
    const warn = 'שים לב: לאחר שתרד לחבר קהילה לא תוכל להחזיר לעצמך את התפקיד. רק גבאי או רב אחר בקהילה יוכלו להחזיר לך אותו. בטוח שרוצה להמשיך?';
    if (!confirm(warn)){ render(); return; }
  } else if (isManager(role)){
    const name = current ? (current.name || current.email || 'החבר') : 'החבר';
    if (!confirm(`לתת ל${name} תפקיד ${ROLE[role]}?`)){ render(); return; }
  }
  try {
    await client.mutation('members:setRole', { synagogueId, userId, role });
    await loadManagerData(synagogueId);
    render();
  } catch(e){ toast(errMsg(e)); render(); }
}
async function removeMember(synagogueId, userId){
  if (!confirm('להסיר את החבר מהקהילה?')) return;
  try {
    await client.mutation('members:remove', { synagogueId, userId });
    await loadManagerData(synagogueId);
    toast('החבר הוסר'); render();
  } catch(e){ toast(errMsg(e)); }
}
async function leaveSynagogue(id){
  if (!confirm('לעזוב את הקהילה?')) return;
  try {
    await client.mutation('members:leave', { synagogueId: id });
    closeSheet();
    await refreshSynagogues();
    toast('עזבת את הקהילה'); render();
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
  let html = `<div class="hero"><h1>החשבון שלי</h1><p class="muted">התחברות עם חשבון Google, לפתיחת קהילה או להצטרפות אליה.</p></div>`;
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

function renderInvitations(){
  if (!S.invitations.length) return '';
  return `<div class="sechead"><h2>הזמנות שממתינות לך</h2></div>
  <div class="card">${S.invitations.map(i => `
    <div class="invite-item">
      <div class="info">
        <div class="n">${esc(i.synagogueName)}</div>
        <div class="c">${esc(i.city)} · בתפקיד ${ROLE[i.role]}${i.invitedByName ? ' · הוזמנת על ידי ' + esc(i.invitedByName) : ''}</div>
      </div>
      <div class="row">
        <button class="btn" data-accept="${i._id}">הצטרפות</button>
        <button class="btn ghost" data-decline="${i._id}">דחייה</button>
      </div>
    </div>`).join('')}</div>`;
}

function renderSignedIn(app){
  const me = S.me || {};
  const active = A.activeSynagogueId();
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
  ${renderInvitations()}
  <div class="sechead"><h2>הקהילות שלי</h2></div>
  <div class="card">`;
  if (!S.synagogues.length){
    html += `<p class="muted">עדיין לא הצטרפת לקהילה ולא פתחת אחת.</p>`;
  } else {
    if (S.synagogues.length > 1) html += `<p class="muted small">הקהילה הפעילה היא זו שלוח הזמנים, הקידושים והקופה מציגים.</p>`;
    html += S.synagogues.map(s => `
      <div class="syn-item" data-open="${s._id}" role="button" tabindex="0">
        <div class="info"><div class="n">${esc(s.name)}${s._id === active ? '<span class="active-badge">פעילה</span>' : ''}</div><div class="c">${esc(s.city)}, ${s.il ? 'ארץ ישראל' : 'חוץ לארץ'}</div></div>
        <span class="role-chip ${s.role}">${ROLE[s.role]}</span>
      </div>`).join('');
  }
  html += `</div><button class="btn sec" id="btnNewSyn">פתיחת קהילה חדשה</button>`;
  app.innerHTML = html;
  $('#btnSignOut').addEventListener('click', signOut);
  $('#btnNewSyn').addEventListener('click', sheetCreateSynagogue);
  app.querySelectorAll('[data-accept]').forEach(b => b.addEventListener('click', () => acceptInvitation(b.dataset.accept)));
  app.querySelectorAll('[data-decline]').forEach(b => b.addEventListener('click', () => declineInvitation(b.dataset.decline)));
  app.querySelectorAll('[data-open]').forEach(el => {
    el.addEventListener('click', () => openDetail(el.dataset.open));
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); openDetail(el.dataset.open); } });
  });
  if (S.detail) renderDetailSheet();
}

function sheetCreateSynagogue(){
  openSheet(`
    <div class="sh"><h2>פתיחת קהילה</h2><button class="x" data-close>✕</button></div>
    <p class="muted small">מי שפותח את הקהילה נרשם בה כגבאי.</p>
    <form id="synForm">
      <label class="f">שם הקהילה או בית הכנסת</label><input type="text" name="name" required>
      <label class="f">עיר</label><input type="text" name="city" required>
      <label class="f">לוח פרשיות</label>
      <select name="il"><option value="1">ארץ ישראל</option><option value="0">חוץ לארץ</option></select>
      <div class="row" style="margin-top:16px"><button class="btn" type="submit">פתיחה</button><button class="btn sec" type="button" data-close>ביטול</button></div>
    </form>`);
  $('#sheet').querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeSheet));
  $('#synForm').addEventListener('submit', e => { e.preventDefault(); createSynagogue(e.target); });
}

function renderDetailSheet(){
  const s = S.detail;
  const manager = isManager(s.role);
  const isActive = s._id === A.activeSynagogueId();
  let html = `<div class="sh"><h2>${esc(s.name)}</h2><button class="x" data-close>✕</button></div>
    <p class="muted">${esc(s.city)}, ${s.il ? 'ארץ ישראל' : 'חוץ לארץ'} · התפקיד שלך: ${ROLE[s.role]}</p>
    ${isActive ? '' : `<button class="btn sec" type="button" id="btnSetActive" style="margin-top:8px">הגדרה כקהילה הפעילה</button>`}`;

  if (manager){
    html += `
    <h3 style="margin-top:18px">הזמנה לפי חשבון Google</h3>
    <p class="muted small">ההזמנה תופיע אצל בעל המייל כשייכנס לאפליקציה, והוא יבחר אם להצטרף.</p>
    <form id="inviteForm">
      <label class="f">מייל</label><input type="email" name="email" dir="ltr" placeholder="name@gmail.com" required>
      <label class="f">תפקיד</label><select name="role">${roleOptions('member', (S.members || []).some(m => m.role === 'rabbi'))}</select>
      <button class="btn" type="submit" style="margin-top:12px">שליחת הזמנה</button>
    </form>
    <div id="pendingList">${S.pending ? renderPending(S.pending) : ''}</div>

    <h3 style="margin-top:18px">קישור הזמנה כללי</h3>
    <p class="muted small">מי שנכנס דרך הקישור מצטרף כחבר קהילה.</p>
    <div class="invite-box"><code>${esc(inviteUrl(s.inviteCode))}</code></div>
    <div class="row" style="margin-top:8px">
      <button class="btn sec" type="button" id="btnCopyInvite">העתקה</button>
      <button class="btn sec" type="button" id="btnShareInvite">שיתוף</button>
      <button class="btn ghost" type="button" id="btnRotateInvite">החלפת קישור</button>
    </div>

    <h3 style="margin-top:18px">חברים</h3>
    <div id="membersList">${S.members ? renderMembers(S.members) : '<p class="muted">טוען…</p>'}</div>

    <h3 style="margin-top:18px">פרטי הקהילה</h3>
    <form id="editSynForm">
      <label class="f">שם</label><input type="text" name="name" value="${esc(s.name)}" required>
      <label class="f">עיר</label><input type="text" name="city" value="${esc(s.city)}" required>
      <label class="f">לוח פרשיות</label>
      <select name="il"><option value="1" ${s.il ? 'selected' : ''}>ארץ ישראל</option><option value="0" ${!s.il ? 'selected' : ''}>חוץ לארץ</option></select>
      <button class="btn sec" type="submit" style="margin-top:12px">שמירת פרטים</button>
    </form>`;
  }
  html += `<button class="btn danger" type="button" id="btnLeave" style="margin-top:18px">עזיבת הקהילה</button>`;

  openSheet(html);
  $('#sheet [data-close]').addEventListener('click', closeSheet);
  $('#btnLeave').addEventListener('click', () => leaveSynagogue(s._id));
  if (!isActive) $('#btnSetActive').addEventListener('click', () => setActive(s._id));
  if (manager){
    $('#inviteForm').addEventListener('submit', e => { e.preventDefault(); inviteByEmail(e.target, s._id); });
    $('#btnCopyInvite').addEventListener('click', () => copyInvite(s.inviteCode));
    $('#btnShareInvite').addEventListener('click', () => shareInvite(s.inviteCode, s.name));
    $('#btnRotateInvite').addEventListener('click', () => rotateInvite(s._id));
    $('#editSynForm').addEventListener('submit', e => { e.preventDefault(); saveSynagogue(e.target, s._id); });
    $('#sheet').querySelectorAll('[data-cancel-invite]').forEach(b => b.addEventListener('click', () => cancelInvitation(s._id, b.dataset.cancelInvite)));
    $('#sheet').querySelectorAll('[data-role]').forEach(sel => sel.addEventListener('change', () => setRole(s._id, sel.dataset.role, sel.value)));
    $('#sheet').querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => removeMember(s._id, b.dataset.remove)));
  }
}

function renderPending(pending){
  if (!pending.length) return '';
  return `<p class="muted small" style="margin-top:12px">ממתינות לאישור:</p>` + pending.map(p => `
    <div class="member-row">
      <div class="info"><div class="n" dir="ltr">${esc(p.email)}</div><div class="e">${ROLE[p.role]}</div></div>
      <button class="btn ghost" data-cancel-invite="${p._id}" aria-label="ביטול הזמנה" title="ביטול הזמנה">✕</button>
    </div>`).join('');
}

function renderMembers(members){
  if (!members.length) return '<p class="muted">אין חברים עדיין.</p>';
  const hasRabbi = members.some(m => m.role === 'rabbi');
  return members.map(m => `
    <div class="member-row">
      ${m.image ? `<img src="${esc(m.image)}" alt="">` : ''}
      <div class="info"><div class="n">${esc(m.name || m.email || 'משתמש')}</div><div class="e">${esc(m.email || '')}</div></div>
      <select data-role="${m.userId}" aria-label="תפקיד">${roleOptions(m.role, hasRabbi)}</select>
      <button class="btn ghost" data-remove="${m.userId}" aria-label="הסרה" title="הסרה">✕</button>
    </div>`).join('');
}

boot();
})();
