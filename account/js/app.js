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

const S = { ready:false, isAuthenticated:false, me:null, synagogues:[], invitations:[], joinCode:null, joinInfo:undefined, detail:null, members:null, pending:null, storage:null, errorLogs:null };

let toastT;
function toast(msg){ let t = $('.toast'); if (!t){ t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role','status'); document.body.appendChild(t); } t.textContent = msg; clearTimeout(toastT); toastT = setTimeout(() => t.remove(), 3600); }
function errMsg(e){ return (e && typeof e.data === 'string') ? e.data : 'משהו השתבש. נסו שוב.'; }

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
        if (me.isOwner) refreshErrorLogs();
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
  const ok = await SiteDialog.confirm('האם אתה בטוח שברצונך להתנתק מהחשבון?', {ok: 'התנתק', cancel: 'ביטול'});
  if (!ok) return;
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
async function refreshErrorLogs(){
  try { S.errorLogs = await client.query('errorLog:recent', {}); render(); }
  catch(e){ console.warn(e); }
}
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
  if (!await SiteDialog.confirm('לדחות את ההזמנה?', { ok: 'דחייה', danger: true })) return;
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
  const [members, pending, storage] = await Promise.all([
    client.query('members:list', { synagogueId: id }).catch(() => []),
    client.query('invitations:listForSynagogue', { synagogueId: id }).catch(() => []),
    client.query('storage:overview', { synagogueId: id }).catch(() => null),
  ]);
  S.members = members; S.pending = pending; S.storage = storage;
}

async function refreshStorage(id){
  try { S.storage = await client.query('storage:overview', { synagogueId: id }); } catch(e){ console.warn(e); }
  if (S.detail && S.detail._id === id) render();
}

async function storageAction(synagogueId, name, args, confirmText, confirmOpts, done){
  if (confirmText && !await SiteDialog.confirm(confirmText, { ...confirmOpts, within: $('#sheet') })) return;
  try {
    const result = await client.mutation(name, { synagogueId, ...args });
    toast(result && result.pending ? 'הקובץ שוחזר וממתין לאישור, כי בינתיים נשלח לוח אחר לאותו תאריך' : done);
    await refreshStorage(synagogueId);
  } catch(e){ toast(errMsg(e)); }
}

const DANGER = { danger: true, cancel: 'ביטול' };
function bindStorage(s){
  const sheet = $('#sheet');
  sheet.querySelectorAll('[data-trash]').forEach(b => b.addEventListener('click', () =>
    storageAction(s._id, 'schedules:remove', { fileId: b.dataset.trash },
      'להעביר את הקובץ לסל המחזור? הוא יוסתר מהקהילה, ואפשר יהיה לשחזר אותו. עד שיימחק לצמיתות הוא ממשיך לתפוס מקום.',
      { ok: 'העברה לסל', ...DANGER }, 'הקובץ הועבר לסל המחזור')));
  sheet.querySelectorAll('[data-restore]').forEach(b => b.addEventListener('click', () =>
    storageAction(s._id, 'schedules:restore', { fileId: b.dataset.restore }, null, null, 'הקובץ שוחזר')));
  sheet.querySelectorAll('[data-purge]').forEach(b => b.addEventListener('click', () =>
    storageAction(s._id, 'schedules:purge', { fileId: b.dataset.purge },
      'למחוק את הקובץ לצמיתות? אי אפשר יהיה לשחזר אותו.', { ok: 'מחיקה לצמיתות', ...DANGER }, 'הקובץ נמחק לצמיתות')));
  sheet.querySelectorAll('[data-purge-design]').forEach(b => b.addEventListener('click', () =>
    storageAction(s._id, 'storage:purgeDesign', { designId: b.dataset.purgeDesign },
      'למחוק את העיצוב לצמיתות? אף תבנית לא משתמשת בו.', { ok: 'מחיקה לצמיתות', ...DANGER }, 'העיצוב נמחק')));
  const box = $('#trashBox');
  if (box) box.addEventListener('toggle', () => { S.trashOpen = box.open; });
  const empty = $('#btnEmptyTrash');
  if (empty) empty.addEventListener('click', () =>
    storageAction(s._id, 'schedules:emptyTrash', {},
      'למחוק לצמיתות את כל הקבצים שבסל המחזור? אי אפשר יהיה לשחזר אותם.', { ok: 'ריקון הסל', ...DANGER }, 'סל המחזור רוקן'));
}

async function openDetail(id){
  refreshDetail(id);
  S.members = null; S.pending = null; S.storage = null;
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
    toast('ההזמנה נוצרה. היא תופיע אצל ' + email + ' בכניסה הבאה לאפליקציה, ומצב שליחת המייל יוצג ברשימה למטה'); render();
    setTimeout(async () => {
      if (S.detail && S.detail._id === synagogueId){
        await loadManagerData(synagogueId);
        render();
      }
    }, 2000);
  } catch(e){ toast(errMsg(e)); btn.disabled = false; }
}
async function cancelInvitation(synagogueId, invitationId){
  if (!await SiteDialog.confirm('לבטל את ההזמנה?', { ok: 'ביטול ההזמנה', cancel: 'השארת ההזמנה', danger: true, within: $('#sheet') })) return;
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

/* הרב היחיד או הגבאי היחיד לא יכול לעזוב או לרדת מתפקידו לפני שמינה מישהו אחר במקומו. */
function isSoleInRole(role){
  return isManager(role) && (S.members || []).filter(m => m.role === role).length <= 1;
}
function soleInRoleMessage(role, action){
  const hint = role === 'rabbi'
    ? 'אפשר להעביר את התפקיד על ידי בחירת "רב" ליד אחד החברים ברשימה.'
    : 'אפשר למנות גבאי נוסף ברשימת החברים.';
  return `אתה ה${ROLE[role]} היחיד בקהילה, ולכן צריך למנות ${ROLE[role]} אחר במקומך לפני ${action}. ${hint}`;
}

async function setRole(synagogueId, userId, role){
  const current = (S.members || []).find(m => m.userId === userId);
  const previousRole = current ? current.role : null;
  if (previousRole === role) return;
  const isSelf = S.me && S.me.userId === userId;
  const myRole = S.detail ? S.detail.role : null;
  const name = current ? (current.name || current.email || 'החבר') : 'החבר';
  if (isSelf && isSoleInRole(previousRole)){
    await SiteDialog.alert(soleInRoleMessage(previousRole, 'שינוי התפקיד'), { within: $('#sheet') });
    render(); return;
  }
  const transferRabbi = role === 'rabbi' && !isSelf && myRole === 'rabbi';
  if (transferRabbi){
    if (!await SiteDialog.confirm(`להעביר את תפקיד הרב ל${name}? אתה תישאר בקהילה כגבאי.`, { within: $('#sheet') })){ render(); return; }
  } else if (isSelf && isManager(previousRole) && !isManager(role)){
    const warn = 'שים לב: לאחר שתרד לחבר קהילה לא תוכל להחזיר לעצמך את התפקיד. רק גבאי או רב אחר בקהילה יוכלו להחזיר לך אותו. בטוח שרוצה להמשיך?';
    if (!await SiteDialog.confirm(warn, { ok: 'המשך', danger: true, within: $('#sheet') })){ render(); return; }
  } else if (isManager(role)){
    if (!await SiteDialog.confirm(`לתת ל${name} תפקיד ${ROLE[role]}?`, { within: $('#sheet') })){ render(); return; }
  }
  try {
    await client.mutation('members:setRole', { synagogueId, userId, role });
    if (transferRabbi){ await refreshSynagogues(); refreshDetail(synagogueId); }
    await loadManagerData(synagogueId);
    render();
  } catch(e){ toast(errMsg(e)); render(); }
}
async function removeMember(synagogueId, userId){
  if (!await SiteDialog.confirm('להסיר את החבר מהקהילה?', { ok: 'הסרה', danger: true, within: $('#sheet') })) return;
  try {
    await client.mutation('members:remove', { synagogueId, userId });
    await loadManagerData(synagogueId);
    toast('החבר הוסר'); render();
  } catch(e){ toast(errMsg(e)); }
}
async function leaveSynagogue(id){
  const myRole = S.detail ? S.detail.role : null;
  if (isSoleInRole(myRole)) return SiteDialog.alert(soleInRoleMessage(myRole, 'עזיבת הקהילה'), { within: $('#sheet') });
  const synName = S.detail ? S.detail.name : 'הקהילה';
  const msg = `האם אתה בטוח שברצונך לעזוב את ${synName}?\nלא תראה יותר את הלוחות, הקידושים והקופה של הקהילה. כדי לחזור תצטרך הזמנה חדשה.`;
  if (!await SiteDialog.confirm(msg, { ok: 'עזיבה', cancel: 'הישארות בקהילה', danger: true, within: $('#sheet') })) return;
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
  if (window.SiteMenu) SiteMenu.setCommunity(S.isAuthenticated ? S.synagogues.find(s => s._id === A.activeSynagogueId()) : null);
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
  html += `<button class="btn btn-google" id="btnSignIn">כניסה עם Google</button>`;
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
  if (me.isOwner) html += renderErrorLogs();
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

function renderErrorLogs(){
  let html = `<div class="sechead"><h2>יומן כשלים</h2></div><div class="card">`;
  if (S.errorLogs === null){
    html += `<p class="muted">טוען…</p>`;
  } else if (!S.errorLogs.length){
    html += `<p class="muted">אין כשלים רשומים.</p>`;
  } else {
    html += S.errorLogs.map(l => `
      <div class="member-row">
        <div class="info">
          <div class="n">${esc(l.source)} · ${esc(new Date(l.at).toLocaleString('he-IL'))}</div>
          <div class="e">${esc(l.message)}${l.detail ? '<br>' + esc(l.detail) : ''}</div>
        </div>
      </div>`).join('');
  }
  html += `</div>`;
  return html;
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

    <h3 style="margin-top:18px">קבצים ואחסון</h3>
    <div id="storageBox">${S.storage ? renderStorage(S.storage) : `<p class="muted">${S.members ? 'לא ניתן לטעון את רשימת הקבצים.' : 'טוען…'}</p>`}</div>

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
    bindStorage(s);
  }
}

const MB = 1024 * 1024;
const fmtSize = b => b >= MB ? (b / MB).toFixed(b >= 10 * MB ? 0 : 1) + 'MB' : Math.max(1, Math.round(b / 1024)) + 'KB';
const fmtDay = t => new Date(t).toLocaleDateString('he-IL');
// באפליקציית Capacitor קישור רגיל נפתח בדפדפן החיצוני, ו-target="_blank" לא נתמך
const isNativeApp = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const openLink = url => url ? `<a class="btn ghost" href="${esc(url)}"${isNativeApp() ? '' : ' target="_blank" rel="noopener"'}>פתיחה</a>` : '';

function fileRow(f){
  let desc, actions;
  if (f.type === 'design'){
    desc = `עיצוב · ${fmtSize(f.size)} · ${fmtDay(f.uploadedAt)} · ${f.usedBy.length ? 'בשימוש בתבנית ' + esc(f.usedBy.join(', ')) : 'לא בשימוש'}`;
    actions = f.usedBy.length ? '' : `<button class="btn danger" data-purge-design="${f._id}">מחיקה לצמיתות</button>`;
  } else if (f.deletedAt){
    desc = `${fmtSize(f.size)} · נמחק ${fmtDay(f.deletedAt)}${f.deletedBy ? ' על ידי ' + esc(f.deletedBy) : ''}`;
    actions = `<button class="btn sec" data-restore="${f._id}">שחזור</button><button class="btn danger" data-purge="${f._id}">מחיקה לצמיתות</button>`;
  } else {
    desc = `לוח ${f.status === 'approved' ? 'מאושר' : 'ממתין לאישור'} · ${fmtSize(f.size)} · ${fmtDay(f.uploadedAt)}${f.uploadedBy ? ' · ' + esc(f.uploadedBy) : ''}`;
    actions = `<button class="btn sec" data-trash="${f._id}">לסל המחזור</button><button class="btn danger" data-purge="${f._id}">מחיקה לצמיתות</button>`;
  }
  return `<div class="file-row">
    <div class="info"><div class="n">${esc(f.title)}</div><div class="e">${desc}</div></div>
    <div class="row">${openLink(f.url)}${actions}</div>
  </div>`;
}

function renderStorage(st){
  const pct = Math.min(100, st.used / st.quota * 100);
  const level = pct >= 90 ? 'full' : pct >= 70 ? 'high' : '';
  const active = st.files.filter(f => !f.deletedAt), trash = st.files.filter(f => f.deletedAt);
  const trashBytes = trash.reduce((sum, f) => sum + f.size, 0);
  let html = `<div class="usage ${level}" role="meter" aria-valuemin="0" aria-valuemax="${st.quota}" aria-valuenow="${st.used}" aria-label="אחסון הקהילה">
      <div class="usage-bar"><span style="width:${pct.toFixed(1)}%"></span></div>
      <div class="small"><b>${fmtSize(st.used)}</b> בשימוש מתוך ${fmtSize(st.quota)} · עד ${fmtSize(st.maxSchedule)} לתמונת לוח ועד ${fmtSize(st.maxDesign)} לעיצוב</div>
    </div>`;
  if (level === 'full') html += `<div class="warn">האחסון של הקהילה כמעט מלא. כדי להעלות לוחות ועיצובים חדשים יש למחוק לצמיתות קבצים מיותרים.</div>`;
  html += active.length ? active.map(fileRow).join('') : '<p class="muted small">אין קבצים.</p>';
  if (trash.length){
    html += `<details class="trash" id="trashBox"${S.trashOpen ? ' open' : ''}><summary>סל המחזור (${trash.length} · ${fmtSize(trashBytes)})</summary>
      <p class="muted small">הקבצים כאן מוסתרים מהקהילה אבל עדיין תופסים מקום. הם נמחקים לצמיתות אוטומטית ${st.trashDays} יום אחרי שהועברו לסל.</p>
      ${trash.map(fileRow).join('')}
      <button class="btn danger" type="button" id="btnEmptyTrash" style="margin-top:8px">ריקון סל המחזור</button>
    </details>`;
  }
  return html;
}

function emailStatusBadge(p){
  if (p.emailStatus === 'sent') return '<span style="color:#16a34a">מייל נשלח</span>';
  if (p.emailStatus === 'failed') return `<span style="color:#dc2626" title="${esc(p.emailError || '')}">מייל לא נשלח${p.emailError ? ' (' + esc(p.emailError) + ')' : ''}</span>`;
  return '<span style="color:#999">שולח מייל…</span>';
}

function renderPending(pending){
  if (!pending.length) return '';
  return `<p class="muted small" style="margin-top:12px">ממתינות לאישור:</p>` + pending.map(p => `
    <div class="member-row">
      <div class="info"><div class="n" dir="ltr">${esc(p.email)}</div><div class="e">${ROLE[p.role]} · ${emailStatusBadge(p)}</div></div>
      <button class="btn ghost" data-cancel-invite="${p._id}" aria-label="ביטול הזמנה" title="ביטול הזמנה">✕</button>
    </div>`).join('');
}

function renderMembers(members){
  if (!members.length) return '<p class="muted">אין חברים עדיין.</p>';
  // הרב יכול לבחור "רב" ליד חבר אחר כדי להעביר אליו את התפקיד.
  const hasRabbi = members.some(m => m.role === 'rabbi') && !(S.detail && S.detail.role === 'rabbi');
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
