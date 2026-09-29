/** לוח הזמנים בקהילה: חובה להתחבר. חבר קהילה רואה רק קבצים שאושרו. גבאי ורב מקבלים את כל הכלי, ושולחים ומאשרים קבצים. */

import { esc } from './render.js';

const $ = id => document.getElementById(id);
const Auth = window.SiteAuth;
const ACCOUNT_URL = 'account/';
const ROLE = { gabbai: 'גבאי', rabbi: 'רב', member: 'חבר קהילה' };
const MODE = { holy: 'שבתות וחגים', days: 'ימות השבוע', events: 'מודעת אירוע' };
const MAX_FILE_BYTES = 7 * 1024 * 1024;
const fmtDate =ymd => { const [y, m, d] = ymd.split('-'); return `${d}/${m}/${y}`; };

let sid = null, synagogue = null, role = null, files = [], unsubscribe = null, unsubscribeKiddush = null, unsubscribeEvents = null, getLuachFile = null, toast = () => {}, onKiddush = () => {}, onEvents = () => {}, onManager = () => {};

/* מצב הדגמה מקומי: כשמריצים את האתר ב-localhost בלי להתחבר, מציגים את הלוח בלי קהילה (בלי סנכרון),
 * כדי שאפשר יהיה לבדוק את הכלי בלי חשבון Google אמיתי. לא פעיל בשום כתובת אחרת */
const isLocalHost = () => location.hostname === 'localhost' || location.hostname === '127.0.0.1';
function showLocalDemo(){
  $('communityName').textContent = 'מצב הדגמה מקומי (לא מסונכרן)';
  $('memberCommunityName').textContent = 'מצב הדגמה מקומי (לא מסונכרן)';
  show('app');
}

function show(view){
  const manager = view === 'app';
  document.querySelector('header nav.tabs').hidden = !manager;
  $('view-gate').hidden = view !== 'gate';
  $('view-community').hidden = view !== 'member';
  if (manager) { if ($('view-settings').hidden && $('view-template').hidden) $('view-luach').hidden = false; }
  else for (const id of ['view-luach', 'view-settings', 'view-template']) $(id).hidden = true;
  $('communityPanel').hidden = !manager;
}

function gate(text, button){
  $('view-gate').innerHTML = `<div class="panel gate"><p>${text}</p>${button || ''}</div>`;
  show('gate');
  const b = $('gateSignIn');
  if (b) b.onclick = () => Auth.signInWithGoogle(location.href).catch(() => toast('ההתחברות נכשלה', true));
}

// באפליקציית Capacitor window.open/target="_blank" לא נתמך ב-WebView; ניווט רגיל נפתח אוטומטית בדפדפן החיצוני.
const isNativeApp = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const fileImg = f => f.url ? `<a href="${esc(f.url)}"${isNativeApp() ? '' : ' target="_blank" rel="noopener"'}><img class="luach-img" src="${esc(f.url)}" alt="${esc(f.title)}" loading="lazy"></a>` : '';

const shareBtn = f => f.url ? `<button type="button" data-share="${f._id}">שיתוף בוואטסאפ</button>` : '';
const bindShare = box => box.querySelectorAll('[data-share]').forEach(b => b.onclick = () => {
  const f = files.find(x => x._id === b.dataset.share);
  if (f) shareLuach(f, fetchImage(f));
});

function renderMember(){
  const list = files.filter(f => f.status === 'approved');
  $('communityList').innerHTML = list.length
    ? list.map(f => `<div class="panel community-file"><h2>${esc(f.title)}</h2><p class="hint">${MODE[f.mode]} · אושר ${f.approvedAt ? fmtDate(new Date(f.approvedAt).toISOString().slice(0, 10)) : ''}</p>${fileImg(f)}<div class="actions left">${shareBtn(f)}</div></div>`).join('')
    : '<div class="panel gate"><p>עדיין אין לוח זמנים מאושר. הלוח יופיע כאן אחרי שהגבאי או הרב יאשרו אותו.</p></div>';
  bindShare($('communityList'));
}

/* ---------- שיתוף לוח מאושר לקבוצת הוואטסאפ של הקהילה ----------
 * התמונה נטענת מראש (עוד לפני האישור), כדי שחלון השיתוף ייפתח מיד בלחיצה: הדפדפן מתיר שיתוף רק סמוך ללחיצה. */

function guestUrl(){
  if (!synagogue || !synagogue.publicCode) return '';
  const url = new URL('guest/', location.href);
  url.search = '?c=' + encodeURIComponent(synagogue.publicCode);
  return Auth.publicUrl(url.toString());
}

const shareText = f => [f.title, synagogue ? synagogue.name : '', guestUrl() ? 'הזמנים גם כאן: ' + guestUrl() : '']
  .filter(Boolean).join('\n');

function fetchImage(f){
  if (!f.url) return Promise.resolve(null);
  return fetch(f.url).then(r => r.ok ? r.blob() : null).catch(() => null);
}

async function shareLuach(f, imagePromise){
  const text = shareText(f);
  const blob = await imagePromise;
  const file = blob ? new File([blob], f.title.replace(/[\\/:*?"<>|]/g, '') + '.png', { type: blob.type || 'image/png' }) : null;
  let r;
  try { r = await NativeFiles.share(file ? { file, title: f.title, text } : { title: f.title, text, url: f.url }); }
  catch (e) { r = 'unsupported'; }
  if (r !== 'unsupported') return;
  // דפדפן בלי שיתוף קבצים (למשל מחשב): וואטסאפ ווב עם ההודעה וקישור לתמונה
  const link = 'https://wa.me/?text=' + encodeURIComponent(guestUrl() ? text : text + '\n' + f.url);
  window.open(link, '_blank', 'noopener');
}

async function approve(fileId){
  const f = files.find(x => x._id === fileId);
  const image = f ? fetchImage(f) : null;
  try { await Auth.client().mutation('schedules:approve', { synagogueId: sid, fileId }); }
  catch (e) { return toast(errText(e, 'הפעולה נכשלה'), true); }
  toast('הלוח אושר ופורסם לקהילה');
  if (f && f.url && await SiteDialog.confirm('הלוח אושר. לשתף אותו עכשיו בקבוצת הוואטסאפ של הקהילה?', { ok: 'שיתוף', cancel: 'לא עכשיו' }))
    shareLuach(f, image);
}

function renderManager(){
  const pending = files.filter(f => f.status === 'pending'), approved = files.filter(f => f.status === 'approved');
  const row = f => `<div class="community-file">
      <h3>${esc(f.title)}</h3>
      <p class="hint">${MODE[f.mode]} · ${f.status === 'pending' ? 'נשלח לאישור על ידי ' + esc(f.submittedBy || '') : 'מאושר וגלוי לחברי הקהילה'}</p>
      ${fileImg(f)}
      <div class="actions left">
        ${f.status === 'pending' ? `<button type="button" class="primary" data-approve="${f._id}">אישור ופרסום</button><button type="button" class="danger" data-remove="${f._id}">דחייה</button>`
          : `${shareBtn(f)}<button type="button" class="danger" data-remove="${f._id}">הסרה מהקהילה</button>`}
      </div></div>`;
  $('communityFiles').innerHTML =
    (pending.length ? '<h3>ממתינים לאישור</h3>' + pending.map(row).join('') : '<p class="hint">אין קבצים שממתינים לאישור.</p>') +
    (approved.length ? '<details><summary>קבצים מאושרים (' + approved.length + ')</summary>' + approved.map(row).join('') + '</details>' : '');
  $('communityFiles').querySelectorAll('[data-approve]').forEach(b => b.onclick = () => approve(b.dataset.approve));
  bindShare($('communityFiles'));
  $('communityFiles').querySelectorAll('[data-remove]').forEach(b => b.onclick = async () => {
    if (await SiteDialog.confirm('להעביר את הקובץ לסל המחזור? אפשר לשחזר אותו או למחוק אותו לצמיתות למטה, תחת "קבצים ואחסון".', { ok: 'העברה לסל', danger: true }))
      act('schedules:remove', b.dataset.remove, 'הקובץ הועבר לסל המחזור');
  });
}

const errText = (e, fallback) => (e && typeof e.data === 'string') ? e.data : fallback;

async function act(name, fileId, done){
  try { await Auth.client().mutation(name, { synagogueId: sid, fileId }); toast(done); }
  catch (e) { toast(errText(e, 'הפעולה נכשלה'), true); }
}

/* ---------- קבצים ואחסון: כל הקבצים של הקהילה, מחיקה רכה (סל המחזור) ומחיקה לצמיתות ---------- */

const MB = 1024 * 1024;
const fmtSize = b => b >= MB ? (b / MB).toFixed(b >= 10 * MB ? 0 : 1) + 'MB' : Math.max(1, Math.round(b / 1024)) + 'KB';
const fmtDay = t => new Date(t).toLocaleDateString('he-IL');
const openLink = url => url ? `<a class="file-open" href="${esc(url)}"${isNativeApp() ? '' : ' target="_blank" rel="noopener"'}>פתיחה</a>` : '';
let trashOpen = false;

function fileRow(f){
  let desc, actions;
  if (f.type === 'design'){
    desc = `עיצוב · ${fmtSize(f.size)} · ${fmtDay(f.uploadedAt)} · ${f.usedBy.length ? 'בשימוש בתבנית ' + esc(f.usedBy.join(', ')) : 'לא בשימוש'}`;
    actions = f.usedBy.length ? '' : `<button type="button" class="danger" data-purge-design="${f._id}">מחיקה לצמיתות</button>`;
  } else if (f.deletedAt){
    desc = `${fmtSize(f.size)} · נמחק ${fmtDay(f.deletedAt)}${f.deletedBy ? ' על ידי ' + esc(f.deletedBy) : ''}`;
    actions = `<button type="button" data-restore="${f._id}">שחזור</button><button type="button" class="danger" data-purge="${f._id}">מחיקה לצמיתות</button>`;
  } else {
    desc = `לוח ${f.status === 'approved' ? 'מאושר' : 'ממתין לאישור'} · ${fmtSize(f.size)} · ${fmtDay(f.uploadedAt)}${f.uploadedBy ? ' · ' + esc(f.uploadedBy) : ''}`;
    actions = `<button type="button" data-trash="${f._id}">לסל המחזור</button><button type="button" class="danger" data-purge="${f._id}">מחיקה לצמיתות</button>`;
  }
  return `<div class="file-row">
    <div class="info"><div class="n">${esc(f.title)}</div><div class="hint">${desc}</div></div>
    <div class="file-actions">${openLink(f.url)}${actions}</div>
  </div>`;
}

function renderStorage(st){
  const pct = Math.min(100, st.used / st.quota * 100);
  const level = pct >= 90 ? 'full' : pct >= 70 ? 'high' : '';
  const active = st.files.filter(f => !f.deletedAt), trash = st.files.filter(f => f.deletedAt);
  const trashBytes = trash.reduce((sum, f) => sum + f.size, 0);
  $('storageSummary').textContent = `· ${fmtSize(st.used)} מתוך ${fmtSize(st.quota)}`;
  let html = `<div class="usage ${level}" role="meter" aria-valuemin="0" aria-valuemax="${st.quota}" aria-valuenow="${st.used}" aria-label="אחסון הקהילה">
      <div class="usage-bar"><span style="width:${pct.toFixed(1)}%"></span></div>
      <p class="hint"><b>${fmtSize(st.used)}</b> בשימוש מתוך ${fmtSize(st.quota)} · עד ${fmtSize(st.maxSchedule)} לתמונת לוח ועד ${fmtSize(st.maxDesign)} לעיצוב</p>
    </div>`;
  if (level === 'full') html += `<p class="storage-warn">האחסון של הקהילה כמעט מלא. כדי לשלוח לוחות ועיצובים חדשים יש למחוק לצמיתות קבצים מיותרים.</p>`;
  html += active.length ? active.map(fileRow).join('') : '<p class="hint">אין קבצים.</p>';
  html += `<details class="trash" id="trashBox"${trashOpen ? ' open' : ''}><summary>סל המחזור (${trash.length}${trash.length ? ' · ' + fmtSize(trashBytes) : ''})</summary>
      <p class="hint">קבצים שהוסרו מוסתרים מהקהילה, אבל עדיין תופסים מקום עד שנמחקים לצמיתות. הם נמחקים אוטומטית ${st.trashDays} יום אחרי שהועברו לסל.</p>
      ${trash.length ? trash.map(fileRow).join('') + '<div class="actions left"><button type="button" class="danger" id="btnEmptyTrash">ריקון סל המחזור</button></div>' : '<p class="hint">סל המחזור ריק.</p>'}
    </details>`;
  const box = $('storageBox');
  box.innerHTML = html;
  const bind = (sel, handler) => box.querySelectorAll(sel).forEach(b => b.onclick = () => handler(b));
  bind('[data-trash]', b => storageAction('schedules:remove', { fileId: b.dataset.trash },
    'להעביר את הקובץ לסל המחזור? הוא יוסתר מהקהילה ואפשר יהיה לשחזר אותו. עד שיימחק לצמיתות הוא ממשיך לתפוס מקום.', 'העברה לסל', 'הקובץ הועבר לסל המחזור'));
  bind('[data-restore]', b => storageAction('schedules:restore', { fileId: b.dataset.restore }, null, null, 'הקובץ שוחזר'));
  bind('[data-purge]', b => storageAction('schedules:purge', { fileId: b.dataset.purge },
    'למחוק את הקובץ לצמיתות? אי אפשר יהיה לשחזר אותו.', 'מחיקה לצמיתות', 'הקובץ נמחק לצמיתות'));
  bind('[data-purge-design]', b => storageAction('storage:purgeDesign', { designId: b.dataset.purgeDesign },
    'למחוק את העיצוב לצמיתות? אף תבנית לא משתמשת בו.', 'מחיקה לצמיתות', 'העיצוב נמחק'));
  bind('#btnEmptyTrash', () => storageAction('schedules:emptyTrash', {},
    'למחוק לצמיתות את כל הקבצים שבסל המחזור? אי אפשר יהיה לשחזר אותם.', 'ריקון הסל', 'סל המחזור רוקן'));
  $('trashBox').ontoggle = () => { trashOpen = $('trashBox').open; };
  if (level === 'full') $('storagePanel').open = true;
}

async function storageAction(name, args, confirmText, okText, done){
  if (confirmText && !await SiteDialog.confirm(confirmText, { ok: okText, danger: true })) return;
  try {
    const result = await Auth.client().mutation(name, { synagogueId: sid, ...args });
    toast(result && result.pending ? 'הקובץ שוחזר וממתין לאישור, כי בינתיים נשלח לוח אחר לאותו תאריך' : done);
  } catch (e) { toast(errText(e, 'הפעולה נכשלה'), true); }
}

let unsubscribeStorage = null;
function watchStorage(on){
  if (!on || unsubscribeStorage){
    if (!on && unsubscribeStorage){ unsubscribeStorage(); unsubscribeStorage = null; }
    return;
  }
  unsubscribeStorage = Auth.watch('storage:overview', { synagogueId: sid }, renderStorage,
    () => { $('storageBox').innerHTML = '<p class="hint">לא ניתן לטעון את רשימת הקבצים.</p>'; });
}

async function submitCurrent(){
  const btn = $('submitLuach');
  btn.disabled = true;
  try {
    const luach = await getLuachFile();
    if (!luach) return;
    if (luach.file.size > MAX_FILE_BYTES) return toast(`קובץ הלוח שוקל ${(luach.file.size / 1048576).toFixed(1)}MB, והמקסימום לקובץ הוא 7MB`, true);
    const client = Auth.client();
    const url = await client.mutation('schedules:generateUploadUrl', { synagogueId: sid });
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: luach.file });
    if (!res.ok) throw new Error('upload');
    const { storageId } = await res.json();
    const result = await client.mutation('schedules:submit',
      { synagogueId: sid, storageId, title: luach.title, firstDate: luach.firstDate, mode: luach.mode, kind: luach.kind });
    if (result.error) toast(result.error, true);
    else toast('הלוח נשלח לאישור');
  } catch (e) { toast(errText(e, 'השליחה נכשלה. נסו שוב.'), true); }
  finally { btn.disabled = false; }
}

function subscribe(id){
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  watchStorage(false);
  if (unsubscribeKiddush) { unsubscribeKiddush(); unsubscribeKiddush = null; }
  if (unsubscribeEvents) { unsubscribeEvents(); unsubscribeEvents = null; }
  sid = id;
  unsubscribe = Auth.watch('schedules:list', { synagogueId: id }, data => {
    role = data.role; files = data.files;
    const manager = role === 'gabbai' || role === 'rabbi';
    onManager(manager ? id : null);
    show(manager ? 'app' : 'member');
    watchStorage(manager);
    if (manager) { $('communityRole').textContent = ROLE[role]; renderManager(); } else renderMember();
  }, e => { onManager(null); gate(esc(errText(e, 'לא ניתן לטעון את לוח הזמנים של הקהילה.')), `<a class="btn-link" href="${ACCOUNT_URL}">לחשבון שלי</a>`); });
  unsubscribeKiddush = Auth.watch('kiddush:board', { synagogueId: id }, data => {
    // נוסח הגבאי ("קידוש והתוועדות לאחר התפילה", "ע״י") – להודעת הקידוש בלוח המודפס
    const wording = { heading: data.synagogue.kiddushHeading || '', by: data.synagogue.kiddushBy || '' };
    const map = new Map();
    map.wording = wording;
    for (const b of data.bookings) if (b.status === 'approved') map.set(b.dateKey, { sponsorName: b.sponsorLine, occasion: b.occasionLine, ...wording });
    onKiddush(map);
  }, () => {});
  // אירועים מיומן הקהילה – לשורת "אירועים" בלוח ולמודעות האירועים
  unsubscribeEvents = Auth.watch('events:list', { synagogueId: id }, list => onEvents(list), () => onEvents([]));
}

async function load(){
  if (!Auth.isAuthenticated()) {
    onManager(null);
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (unsubscribeKiddush) { unsubscribeKiddush(); unsubscribeKiddush = null; }
    if (unsubscribeEvents) { unsubscribeEvents(); unsubscribeEvents = null; }
    onEvents([]);
    watchStorage(false);
    if (isLocalHost()) return showLocalDemo();
    return gate('כדי לראות את לוח הזמנים של הקהילה יש להתחבר עם חשבון Google.', '<button type="button" class="primary btn-google" id="gateSignIn">כניסה עם Google</button>');
  }
  // הקהילות מהכניסה הקודמת מוצגות מיד, והרשימה מהשרת מחליפה אותן כשהיא מגיעה
  const saved = Auth.cached('synagogues:mine', {});
  if (saved) useSynagogues(saved);
  let synagogues = [];
  try {
    const [me, list] = await Promise.all([Auth.query('users:me', {}), Auth.query('synagogues:mine', {})]);
    if (me === null) { Auth.clearAuth(); return load(); }
    synagogues = list;
  } catch (e) { console.warn(e); if (saved) return; }
  useSynagogues(synagogues);
}

function useSynagogues(synagogues){
  let id = Auth.activeSynagogueId();
  if (!synagogues.some(s => s._id === id)) { id = synagogues[0] ? synagogues[0]._id : null; Auth.setActiveSynagogueId(id); }
  if (!id) { onManager(null); return gate('עדיין לא הצטרפת לקהילה. אפשר להצטרף דרך הזמנה מהגבאי או לפתוח קהילה חדשה.', `<a class="btn-link" href="${ACCOUNT_URL}">לחשבון שלי</a>`); }
  const s = synagogues.find(x => x._id === id);
  synagogue = s;
  if (window.SiteMenu) SiteMenu.setCommunity(s);
  $('communityName').textContent = s.name;
  $('memberCommunityName').textContent = s.name;
  if (id !== sid || !unsubscribe) subscribe(id);
}

/**
 * getLuachFile: מחזירה { file, title, firstDate, mode, kind } של הלוח המוצג, או null.
 * onManager(sid): הקהילה שהמשתמש גבאי או רב בה, או null – לסנכרון ההגדרות.
 * onEvents(list): האירועים מיומן הקהילה, { _id, dateKey, title, details, show } ממוינים לפי תאריך.
 */
export async function initCommunity(options){
  getLuachFile = options.getLuachFile;
  toast = options.toast;
  onKiddush = options.onKiddush || (() => {});
  onEvents = options.onEvents || (() => {});
  onManager = options.onManager || (() => {});
  $('submitLuach').onclick = submitCurrent;
  try { await Auth.completeSignInFromRedirect(); } catch (e) { console.warn(e); toast('ההתחברות נכשלה. נסו שוב.', true); }
  Auth.onChange(() => load());
  await load();
}
