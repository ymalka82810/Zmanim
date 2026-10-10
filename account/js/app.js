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
/* גבאי לא יכול לשנות תפקיד של גבאי אחר או של הרב; רק הרב יכול. */
const canManageMember = (myRole, isSelf, targetRole) => isSelf || myRole === 'rabbi' || !isManager(targetRole);

/* פיצ'רים שהקהילה בוחרת אם להפעיל (convex/features.ts). הפעלה וכיבוי דורשים אישור של כל הגבאים והרב */
const BASIC_FEATURES = ['החשבון שלי', 'לוח קידושים', 'קופת בית הכנסת', 'יומן קהילה', 'לוח זמנים (לגבאים ולרב)'];
const FEATURES = {
  aliyot: { title: 'חלוקת עליות', desc: 'רישום מי עלה לתורה, הצעה למי לתת עלייה לפי חיובים ולפי מי שלא עלה זמן רב, ומכרז עליות וכיבודים בזמן אמת.' },
  week: { title: 'השבוע שלי', desc: 'מסך אישי לכל חבר: אזכרות, הרשמה למניין, הקידוש והחוב שלו בקופה.' },
};

const S = { ready:false, isAuthenticated:false, me:null, synagogues:[], invitations:[], joinCode:null, joinInfo:undefined, detail:null, members:null, pending:null, features:null, errorLogs:null, membersSheetOpen:false, membersSearch:'' };

let toastT;
function toast(msg){ let t = $('.toast'); if (!t){ t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role','status'); document.body.appendChild(t); } t.textContent = msg; clearTimeout(toastT); toastT = setTimeout(() => t.remove(), 3600); }
function errMsg(e){ return (e && typeof e.data === 'string') ? e.data : 'משהו השתבש. נסו שוב.'; }

function openSheet(html){
  $('#sheet').innerHTML = html;
  $('#sheetWrap').hidden = false;
  requestAnimationFrame(() => $('#sheetWrap').classList.add('open'));
}
function closeSheet(){ $('#sheetWrap').hidden = true; $('#sheet').innerHTML = ''; S.detail = null; closeSheet2(); }
$('#sheetWrap').addEventListener('click', e => { if (e.target.id === 'sheetWrap') closeSheet(); });

function openSheet2(html){
  $('#sheet2').innerHTML = html;
  $('#sheetWrap2').hidden = false;
  requestAnimationFrame(() => $('#sheetWrap2').classList.add('open'));
}
function closeSheet2(){ $('#sheetWrap2').hidden = true; $('#sheet2').innerHTML = ''; S.membersSheetOpen = false; S.membersSearch = ''; }
$('#sheetWrap2').addEventListener('click', e => { if (e.target.id === 'sheetWrap2') closeSheet2(); });
function activeSheetEl(){ return S.membersSheetOpen ? $('#sheet2') : $('#sheet'); }

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
    // מה שהשרת ענה בכניסה הקודמת מוצג מיד, ומתעדכן כשמגיעה תשובה חדשה
    const me = A.cached('users:me', {}), synagogues = A.cached('synagogues:mine', {});
    if (me && synagogues){
      S.me = me; S.synagogues = synagogues; S.invitations = A.cached('invitations:mine', {}) || [];
      render();
    }
    try {
      const [me] = await Promise.all([A.query('users:me', {}), refreshSynagogues(), refreshInvitations()]);
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
  S.synagogues = await A.query('synagogues:mine', {});
  const active = A.activeSynagogueId();
  if (!S.synagogues.some(s => s._id === active)) A.setActiveSynagogueId(S.synagogues.length ? S.synagogues[0]._id : null);
}
async function refreshInvitations(){ S.invitations = await A.query('invitations:mine', {}); }
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

async function saveHebrewName(form){
  const firstName = form.firstName.value.trim(), lastName = form.lastName.value.trim();
  if (!firstName || !lastName) return toast('נא למלא שם פרטי ושם משפחה');
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await client.mutation('users:setHebrewName', { firstName, lastName });
    S.me = await A.query('users:me', {});
    toast('השם נשמר');
    render();
  } catch(e){ toast(errMsg(e)); btn.disabled = false; }
}

async function loadManagerData(id){
  const [members, pending, features] = await Promise.all([
    client.query('members:list', { synagogueId: id }).catch(() => []),
    client.query('invitations:listForSynagogue', { synagogueId: id }).catch(() => []),
    client.query('features:status', { synagogueId: id }).catch(() => null),
  ]);
  S.members = members; S.pending = pending; S.features = features;
}

async function openDetail(id){
  refreshDetail(id);
  S.members = null; S.pending = null; S.features = null;
  render();
  if (S.detail && isManager(S.detail.role)){
    await loadManagerData(id);
    if (S.detail) render();
  }
}

async function saveSynagogue(form, id){
  const name = form.name.value.trim(), city = form.city.value.trim(), il = form.il.value === '1';
  const address = form.address.value.trim();
  if (!name || !city) return toast('נא למלא שם ועיר');
  try {
    await client.mutation('synagogues:update', { synagogueId: id, name, city, il, address });
    await refreshSynagogues(); refreshDetail(id);
    toast('הפרטים נשמרו'); render();
  } catch(e){ toast(errMsg(e)); }
}

/* פרטי התשלום שמוצגים לאורח אחרי שהתחייב לתרום מעמוד האורחים (convex/guest.ts) */
async function savePayInfo(form, id){
  try {
    await client.mutation('guest:setPayInfo', { synagogueId: id, payText: form.payText.value.trim(), payLink: form.payLink.value.trim() });
    await refreshSynagogues(); refreshDetail(id);
    toast('פרטי התשלום נשמרו'); render();
  } catch(e){ toast(errMsg(e)); }
}

async function refreshFeatures(synagogueId){
  S.features = await client.query('features:status', { synagogueId }).catch(() => S.features);
  await refreshSynagogues(); refreshDetail(synagogueId);
  render();
}
async function requestFeature(synagogueId, feature, enable){
  const f = FEATURES[feature];
  const managers = (S.members || []).filter(m => isManager(m.role)).length;
  const msg = managers > 1
    ? `לבקש ${enable ? 'להפעיל' : 'לכבות'} את "${f.title}"? השינוי ייכנס לתוקף אחרי שכל הגבאים והרב יאשרו.`
    : `${enable ? 'להפעיל' : 'לכבות'} את "${f.title}" בקהילה?`;
  if (!await SiteDialog.confirm(msg, { ok: enable ? 'הפעלה' : 'כיבוי', danger: !enable, within: $('#sheet') })) return;
  try {
    await client.mutation('features:request', { synagogueId, feature, enable });
    toast(managers > 1 ? 'הבקשה נשלחה לאישור הגבאים והרב' : enable ? `"${f.title}" הופעל` : `"${f.title}" כובה`);
    await refreshFeatures(synagogueId);
  } catch(e){ toast(errMsg(e)); }
}
async function approveFeature(synagogueId, requestId){
  try {
    await client.mutation('features:approve', { synagogueId, requestId });
    toast('האישור נשמר');
    await refreshFeatures(synagogueId);
  } catch(e){ toast(errMsg(e)); }
}
async function rejectFeature(synagogueId, requestId, mine){
  const msg = mine ? 'לבטל את הבקשה?' : "לדחות את הבקשה? הפיצ'ר יישאר במצבו הנוכחי.";
  if (!await SiteDialog.confirm(msg, { ok: mine ? 'ביטול הבקשה' : 'דחייה', cancel: 'חזרה', danger: true, within: $('#sheet') })) return;
  try {
    await client.mutation('features:reject', { synagogueId, requestId });
    toast(mine ? 'הבקשה בוטלה' : 'הבקשה נדחתה');
    await refreshFeatures(synagogueId);
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
  return A.publicUrl(url.toString());
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
  let r;
  try { r = await NativeFiles.share({ title: name, url: inviteUrl(code) }); } catch(e){ r = 'unsupported'; }
  if (r === 'unsupported') copyInvite(code);
}

/* העמוד הציבורי לאורחים (guest/?c=...), בלי התחברות. בלי קוד העמוד כבוי */
function guestUrl(code){
  const url = new URL('../guest/', location.href);
  url.searchParams.set('c', code);
  return A.publicUrl(url.toString());
}
async function setGuestPage(id, on, rotate){
  if (!on && !await SiteDialog.confirm('לכבות את עמוד האורחים? הקישור יפסיק לעבוד אצל כל מי שקיבל אותו.', { ok: 'כיבוי', danger: true, within: $('#sheet') })) return;
  if (rotate && !await SiteDialog.confirm('להחליף את הקישור? הקישור הישן יפסיק לעבוד.', { ok: 'החלפה', within: $('#sheet') })) return;
  try {
    await client.mutation(on ? 'guest:enable' : 'guest:disable', on ? { synagogueId: id, rotate: !!rotate } : { synagogueId: id });
    await refreshSynagogues(); refreshDetail(id);
    toast(!on ? 'עמוד האורחים כובה' : rotate ? 'הקישור לעמוד האורחים הוחלף' : 'עמוד האורחים הופעל'); render();
  } catch(e){ toast(errMsg(e)); }
}
function tvUrl(code){
  const url = new URL('../tv/', location.href);
  url.searchParams.set('c', code);
  return A.publicUrl(url.toString());
}
async function copyTv(code){
  try { await navigator.clipboard.writeText(tvUrl(code)); toast('קישור המסך הועתק'); }
  catch(e){ toast('העתקה נכשלה'); }
}
/* דף להדפסה עם QR לעמוד האורחים, לתלייה בכניסה לבית הכנסת */
async function printGuestQr(code, name){
  if (!window.qrcode) return toast('לא ניתן ליצור QR כרגע');
  const q = window.qrcode(0, 'M');
  q.addData(guestUrl(code));
  q.make();
  const sheet = document.createElement('div');
  sheet.id = 'qrPrint';
  sheet.innerHTML = '<h1>' + esc(name) + '</h1><div class="qr">' + q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }) + '</div><p>סרקו כדי לראות את זמני התפילות, הכתובת והניווט</p>';
  document.body.appendChild(sheet);
  document.body.classList.add('printing-qr');
  try { await NativeFiles.print({ title: 'QR – ' + name }); }
  catch(e){ toast('ההדפסה נכשלה'); }
  finally { document.body.classList.remove('printing-qr'); sheet.remove(); }
}
async function copyGuest(code){
  try { await navigator.clipboard.writeText(guestUrl(code)); toast('הקישור הועתק'); }
  catch(e){ toast('העתקה נכשלה'); }
}
async function shareGuest(code, name){
  let r;
  try { r = await NativeFiles.share({ title: 'זמני ' + name, url: guestUrl(code) }); } catch(e){ r = 'unsupported'; }
  if (r === 'unsupported') copyGuest(code);
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
    await SiteDialog.alert(soleInRoleMessage(previousRole, 'שינוי התפקיד'), { within: activeSheetEl() });
    render(); return;
  }
  const transferRabbi = role === 'rabbi' && !isSelf && myRole === 'rabbi';
  if (transferRabbi){
    if (!await SiteDialog.confirm(`להעביר את תפקיד הרב ל${name}? אתה תישאר בקהילה כגבאי.`, { within: activeSheetEl() })){ render(); return; }
  } else if (isSelf && isManager(previousRole) && !isManager(role)){
    const warn = 'שים לב: לאחר שתרד לחבר קהילה לא תוכל להחזיר לעצמך את התפקיד. רק גבאי או רב אחר בקהילה יוכלו להחזיר לך אותו. בטוח שרוצה להמשיך?';
    if (!await SiteDialog.confirm(warn, { ok: 'המשך', danger: true, within: activeSheetEl() })){ render(); return; }
  } else if (isManager(role)){
    if (!await SiteDialog.confirm(`לתת ל${name} תפקיד ${ROLE[role]}?`, { within: activeSheetEl() })){ render(); return; }
  }
  try {
    await client.mutation('members:setRole', { synagogueId, userId, role });
    if (transferRabbi){ await refreshSynagogues(); refreshDetail(synagogueId); }
    await loadManagerData(synagogueId);
    render();
  } catch(e){ toast(errMsg(e)); render(); }
}
async function removeMember(synagogueId, userId){
  if (!await SiteDialog.confirm('להסיר את החבר מהקהילה?', { ok: 'הסרה', danger: true, within: activeSheetEl() })) return;
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

async function deleteSynagogue(id){
  const synName = S.detail ? S.detail.name : 'הקהילה';
  const msg = `למחוק את ${synName} לצמיתות?\nכל הנתונים של הקהילה יימחקו: הלוחות, הקבצים, הקידושים, הקופה וההגדרות. אי אפשר לבטל את המחיקה.`;
  if (!await SiteDialog.confirm(msg, { ok: 'מחיקה לצמיתות', cancel: 'ביטול', danger: true, within: $('#sheet') })) return;
  try {
    await client.mutation('synagogues:remove', { synagogueId: id });
    closeSheet();
    await refreshSynagogues();
    toast('הקהילה נמחקה'); render();
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

function renderHebrewNameCard(){
  return `<div class="card">
    <h3>מילוי שם בעברית</h3>
    <p class="muted small">חשבון הגוגל שלך לא הביא שם בעברית. נא למלא שם פרטי ושם משפחה בעברית - כך תופיע/י בקהילה.</p>
    <form id="hebrewNameForm">
      <label class="f">שם פרטי</label><input type="text" name="firstName" dir="rtl" required>
      <label class="f">שם משפחה</label><input type="text" name="lastName" dir="rtl" required>
      <button class="btn" type="submit">שמירה</button>
    </form>
  </div>`;
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
  ${me.needsHebrewName ? renderHebrewNameCard() : ''}
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
  if (me.needsHebrewName) $('#hebrewNameForm').addEventListener('submit', e => { e.preventDefault(); saveHebrewName(e.target); });
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

    <h3 style="margin-top:18px">עמוד לאורחים</h3>
    <p class="muted small">קישור קבוע לקריאה בלבד, בלי התחברות: לוחות הזמנים המאושרים של השבוע וכתובת בית הכנסת, למי שמתארח אצלכם.</p>
    ${s.publicCode ? `
    <div class="invite-box"><code>${esc(guestUrl(s.publicCode))}</code></div>
    <div class="row" style="margin-top:8px">
      <button class="btn sec" type="button" id="btnCopyGuest">העתקה</button>
      <button class="btn sec" type="button" id="btnShareGuest">שיתוף</button>
      <button class="btn sec" type="button" id="btnPrintQr">הדפסת QR לכניסה</button>
      <button class="btn sec" type="button" id="btnCopyTv" title="פתחו את הקישור בדפדפן של הטלוויזיה בבית הכנסת">קישור למסך טלוויזיה</button>
      <button class="btn ghost" type="button" id="btnRotateGuest">החלפת קישור</button>
      <button class="btn ghost" type="button" id="btnGuestOff">כיבוי</button>
    </div>
    ${s.address ? '' : '<p class="muted small">כדאי להוסיף כתובת למטה, ב"פרטי הקהילה", כדי שאורחים יוכלו לנווט.</p>'}
    <h4 style="margin:14px 0 4px">תרומות מאורחים</h4>
    <p class="muted small">אורחים יכולים להתחייב לתרום מעמוד האורחים: תרומה כללית, וכל תרומה לזמן מיוחד או מגבית שסימנתם בקופה "פתוחה גם לאורחים". ההתחייבות מגיעה לקופה לאישור שלכם, ולאורח מוצגים פרטי התשלום שכאן.</p>
    <form id="payForm">
      <label class="f">איך משלמים</label><textarea name="payText" rows="3" maxlength="500" placeholder="לדוגמה: ביט או פייבוקס למספר 050-0000000 (שם הגבאי), או העברה לחשבון ...">${esc(s.payText || '')}</textarea>
      <label class="f">קישור לתשלום (לא חובה)</label><input type="url" name="payLink" dir="ltr" maxlength="300" placeholder="https://..." value="${esc(s.payLink || '')}">
      <button class="btn sec" type="submit" style="margin-top:10px">שמירת פרטי התשלום</button>
    </form>
    <p class="muted small" style="margin-top:12px">את מה שמוצג במסך הטלוויזיה עורכים בדף <a href="../screen/">מסך בית הכנסת</a>.</p>`
    : `<button class="btn sec" type="button" id="btnGuestOn">הפעלת עמוד לאורחים</button>`}

    <h3 style="margin-top:18px">פיצ'רים בקהילה</h3>
    ${renderFeatures()}

    <h3 style="margin-top:18px">חברים</h3>
    <button class="btn sec members-btn" type="button" id="btnOpenMembers">
      <span>${S.members ? S.members.length + ' חברים בקהילה' : 'טוען…'}</span><span>‹</span>
    </button>

    <h3 style="margin-top:18px">פרטי הקהילה</h3>
    <form id="editSynForm">
      <label class="f">שם</label><input type="text" name="name" value="${esc(s.name)}" required>
      <label class="f">עיר</label><input type="text" name="city" value="${esc(s.city)}" required>
      <label class="f">כתובת בית הכנסת</label><input type="text" name="address" value="${esc(s.address || '')}" placeholder="רחוב ומספר (מוצג בעמוד לאורחים)">
      <label class="f">לוח פרשיות</label>
      <select name="il"><option value="1" ${s.il ? 'selected' : ''}>ארץ ישראל</option><option value="0" ${!s.il ? 'selected' : ''}>חוץ לארץ</option></select>
      <button class="btn sec" type="submit" style="margin-top:12px">שמירת פרטים</button>
    </form>`;
  }
  // גבאי או רב שנשאר לבד בקהילה לא יכול לעזוב, אבל יכול למחוק אותה
  const canDelete = manager && S.members && S.members.length === 1;
  html += canDelete
    ? `<button class="btn danger" type="button" id="btnDeleteSyn" style="margin-top:18px">מחיקת הקהילה</button>`
    : `<button class="btn danger" type="button" id="btnLeave" style="margin-top:18px">עזיבת הקהילה</button>`;

  openSheet(html);
  $('#sheet [data-close]').addEventListener('click', closeSheet);
  if (canDelete) $('#btnDeleteSyn').addEventListener('click', () => deleteSynagogue(s._id));
  else $('#btnLeave').addEventListener('click', () => leaveSynagogue(s._id));
  if (!isActive) $('#btnSetActive').addEventListener('click', () => setActive(s._id));
  if (manager){
    $('#inviteForm').addEventListener('submit', e => { e.preventDefault(); inviteByEmail(e.target, s._id); });
    $('#btnCopyInvite').addEventListener('click', () => copyInvite(s.inviteCode));
    $('#btnShareInvite').addEventListener('click', () => shareInvite(s.inviteCode, s.name));
    $('#btnRotateInvite').addEventListener('click', () => rotateInvite(s._id));
    if (s.publicCode){
      $('#btnCopyGuest').addEventListener('click', () => copyGuest(s.publicCode));
      $('#btnShareGuest').addEventListener('click', () => shareGuest(s.publicCode, s.name));
      $('#btnPrintQr').addEventListener('click', () => printGuestQr(s.publicCode, s.name));
      $('#btnCopyTv').addEventListener('click', () => copyTv(s.publicCode));
      $('#btnRotateGuest').addEventListener('click', () => setGuestPage(s._id, true, true));
      $('#btnGuestOff').addEventListener('click', () => setGuestPage(s._id, false));
      $('#payForm').addEventListener('submit', e => { e.preventDefault(); savePayInfo(e.target, s._id); });
    } else $('#btnGuestOn').addEventListener('click', () => setGuestPage(s._id, true));
    $('#editSynForm').addEventListener('submit', e => { e.preventDefault(); saveSynagogue(e.target, s._id); });
    $('#sheet').querySelectorAll('[data-cancel-invite]').forEach(b => b.addEventListener('click', () => cancelInvitation(s._id, b.dataset.cancelInvite)));
    $('#btnOpenMembers').addEventListener('click', () => openMembersSheet(s._id));
    $('#sheet').querySelectorAll('[data-feature-on]').forEach(b => b.addEventListener('click', () => requestFeature(s._id, b.dataset.featureOn, true)));
    $('#sheet').querySelectorAll('[data-feature-off]').forEach(b => b.addEventListener('click', () => requestFeature(s._id, b.dataset.featureOff, false)));
    $('#sheet').querySelectorAll('[data-feature-approve]').forEach(b => b.addEventListener('click', () => approveFeature(s._id, b.dataset.featureApprove)));
    $('#sheet').querySelectorAll('[data-feature-reject]').forEach(b => b.addEventListener('click', () => rejectFeature(s._id, b.dataset.featureReject, b.dataset.mine === '1')));
  }
  if (S.membersSheetOpen) renderMembersSheet(s._id);
}

function renderFeatures(){
  const st = S.features;
  if (!st) return '<p class="muted">טוען…</p>';
  let html = `<p class="muted small">פעילים תמיד: ${BASIC_FEATURES.join(', ')}.</p>
    <p class="muted small">פיצ'ר נוסף מופעל (או מכובה) רק כשכל הגבאים והרב מאשרים. עד אז הוא לא מוצג לאף אחד בקהילה.</p>`;
  for (const [key, f] of Object.entries(FEATURES)){
    const on = st.enabled.includes(key);
    const req = st.requests.find(r => r.feature === key);
    html += `<div class="feature-row">
      <div class="info">
        <div class="n">${esc(f.title)} <span class="feature-chip ${on ? 'on' : 'off'}">${on ? 'פעיל' : 'כבוי'}</span></div>
        <div class="e">${esc(f.desc)}</div>`;
    if (req){
      html += `<div class="feature-req">בקשה ${req.enable ? 'להפעלה' : 'לכיבוי'} מאת ${esc(req.requestedBy)}.
        אישרו: ${esc(req.approved.join(', ') || '—')}${req.waiting.length ? ` · ממתינים לאישור: ${esc(req.waiting.join(', '))}` : ''}</div>
        <div class="row" style="margin-top:8px">${req.approvedByMe
          ? `<button class="btn ghost" type="button" data-feature-reject="${req._id}" data-mine="1">ביטול הבקשה</button>`
          : `<button class="btn" type="button" data-feature-approve="${req._id}">אישור</button><button class="btn ghost" type="button" data-feature-reject="${req._id}">דחייה</button>`}</div>`;
    } else {
      html += `<div class="row" style="margin-top:8px">${on
        ? `<button class="btn ghost" type="button" data-feature-off="${key}">בקשה לכיבוי</button>`
        : `<button class="btn sec" type="button" data-feature-on="${key}">בקשה להפעלה</button>`}</div>`;
    }
    html += `</div></div>`;
  }
  return html;
}

function filteredMembers(){
  const q = S.membersSearch.trim().toLowerCase();
  const members = S.members || [];
  if (!q) return members;
  return members.filter(m => (m.name || '').toLowerCase().includes(q) || (m.email || '').toLowerCase().includes(q));
}

function renderMembersListInner(){
  if (!S.members) return '<p class="muted">טוען…</p>';
  const list = filteredMembers();
  if (!S.members.length) return renderMembers(S.members);
  if (!list.length) return '<p class="muted members-empty">לא נמצא חבר קהילה בשם או במייל הזה.</p>';
  return renderMembers(list);
}

function bindMembersListEvents(synagogueId){
  $('#sheet2').querySelectorAll('[data-role]').forEach(sel => sel.addEventListener('change', () => setRole(synagogueId, sel.dataset.role, sel.value)));
  $('#sheet2').querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => removeMember(synagogueId, b.dataset.remove)));
}

function updateMembersListInner(synagogueId){
  $('#membersListInner').innerHTML = renderMembersListInner();
  bindMembersListEvents(synagogueId);
}

function openMembersSheet(synagogueId){
  S.membersSheetOpen = true;
  S.membersSearch = '';
  renderMembersSheet(synagogueId);
}

function renderMembersSheet(synagogueId){
  const html = `
    <div class="sh"><h2>חברי הקהילה</h2><button class="x" data-close>✕</button></div>
    <input type="search" id="memberSearch" placeholder="חיפוש לפי שם או מייל" value="${esc(S.membersSearch)}">
    <div id="membersListInner" style="margin-top:8px">${renderMembersListInner()}</div>`;
  openSheet2(html);
  $('#sheet2 [data-close]').addEventListener('click', closeSheet2);
  $('#memberSearch').addEventListener('input', e => { S.membersSearch = e.target.value; updateMembersListInner(synagogueId); });
  bindMembersListEvents(synagogueId);
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
  const myRole = S.detail ? S.detail.role : null;
  const myUserId = S.me ? S.me.userId : null;
  const isFounder = S.detail ? !!S.detail.isFounder : false;
  return members.map(m => {
    const isSelf = myUserId === m.userId;
    const canManage = canManageMember(myRole, isSelf, m.role);
    // הרב יכול לבחור "רב" ליד חבר אחר כדי להעביר אליו את התפקיד. גבאי יכול למנות את עצמו לרב רק אם הוא הגבאי שפתח את הקהילה.
    const disableRabbi = (isSelf ? myRole === 'gabbai' && !isFounder : myRole !== 'rabbi') && m.role !== 'rabbi';
    return `
    <div class="member-row">
      ${m.image ? `<img src="${esc(m.image)}" alt="">` : ''}
      <div class="info"><div class="n">${esc(m.name || m.email || 'משתמש')}</div><div class="e">${esc(m.email || '')}</div></div>
      <select data-role="${m.userId}" aria-label="תפקיד" ${canManage ? '' : 'disabled'}>${roleOptions(m.role, disableRabbi)}</select>
      <button class="btn ghost" data-remove="${m.userId}" aria-label="הסרה" title="הסרה" ${canManage ? '' : 'disabled'}>✕</button>
    </div>`;
  }).join('');
}

boot();
})();
