/** לוח הזמנים בקהילה: חובה להתחבר. חבר קהילה רואה רק קבצים שאושרו. גבאי ורב מקבלים את כל הכלי, ושולחים ומאשרים קבצים. */

import { esc } from './render.js';

const $ = id => document.getElementById(id);
const Auth = window.SiteAuth;
const ACCOUNT_URL = 'account/';
const ROLE = { gabbai: 'גבאי', rabbi: 'רב', member: 'חבר קהילה' };
const MODE = { holy: 'שבתות וחגים', days: 'ימות השבוע' };
const fmtDate = ymd => { const [y, m, d] = ymd.split('-'); return `${d}/${m}/${y}`; };

let sid = null, role = null, files = [], unsubscribe = null, getLuachFile = null, toast = () => {};

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

const fileImg = f => f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener"><img class="luach-img" src="${esc(f.url)}" alt="${esc(f.title)}" loading="lazy"></a>` : '';

function renderMember(){
  const list = files.filter(f => f.status === 'approved');
  $('communityList').innerHTML = list.length
    ? list.map(f => `<div class="panel community-file"><h2>${esc(f.title)}</h2><p class="hint">${MODE[f.mode]} · אושר ${f.approvedAt ? fmtDate(new Date(f.approvedAt).toISOString().slice(0, 10)) : ''}</p>${fileImg(f)}</div>`).join('')
    : '<div class="panel gate"><p>עדיין אין לוח זמנים מאושר. הלוח יופיע כאן אחרי שהגבאי או הרב יאשרו אותו.</p></div>';
}

function renderManager(){
  const pending = files.filter(f => f.status === 'pending'), approved = files.filter(f => f.status === 'approved');
  const row = f => `<div class="community-file">
      <h3>${esc(f.title)}</h3>
      <p class="hint">${MODE[f.mode]} · ${f.status === 'pending' ? 'נשלח לאישור על ידי ' + esc(f.submittedBy || '') : 'מאושר וגלוי לחברי הקהילה'}</p>
      ${fileImg(f)}
      <div class="actions left">
        ${f.status === 'pending' ? `<button type="button" class="primary" data-approve="${f._id}">אישור ופרסום</button><button type="button" class="danger" data-remove="${f._id}">דחייה</button>`
          : `<button type="button" class="danger" data-remove="${f._id}">הסרה מהקהילה</button>`}
      </div></div>`;
  $('communityFiles').innerHTML =
    (pending.length ? '<h3>ממתינים לאישור</h3>' + pending.map(row).join('') : '<p class="hint">אין קבצים שממתינים לאישור.</p>') +
    (approved.length ? '<details><summary>קבצים מאושרים (' + approved.length + ')</summary>' + approved.map(row).join('') + '</details>' : '');
  $('communityFiles').querySelectorAll('[data-approve]').forEach(b => b.onclick = () => act('schedules:approve', b.dataset.approve, 'הלוח אושר ופורסם לקהילה'));
  $('communityFiles').querySelectorAll('[data-remove]').forEach(b => b.onclick = () => {
    if (confirm('להסיר את הקובץ?')) act('schedules:remove', b.dataset.remove, 'הקובץ הוסר');
  });
}

const errText = (e, fallback) => (e && typeof e.data === 'string') ? e.data : fallback;

async function act(name, fileId, done){
  try { await Auth.client().mutation(name, { synagogueId: sid, fileId }); toast(done); }
  catch (e) { toast(errText(e, 'הפעולה נכשלה'), true); }
}

async function submitCurrent(){
  const btn = $('submitLuach');
  btn.disabled = true;
  try {
    const luach = await getLuachFile();
    if (!luach) return;
    const client = Auth.client();
    const url = await client.mutation('schedules:generateUploadUrl', { synagogueId: sid });
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: luach.file });
    if (!res.ok) throw new Error('upload');
    const { storageId } = await res.json();
    const id = await client.mutation('schedules:submit', { synagogueId: sid, storageId, title: luach.title, firstDate: luach.firstDate, mode: luach.mode });
    toast(id ? 'הלוח נשלח לאישור' : 'הקובץ לא תקין', !id);
  } catch (e) { toast(errText(e, 'השליחה נכשלה. נסו שוב.'), true); }
  finally { btn.disabled = false; }
}

function subscribe(id){
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  sid = id;
  unsubscribe = Auth.client().onUpdate('schedules:list', { synagogueId: id }, data => {
    role = data.role; files = data.files;
    const manager = role === 'gabbai' || role === 'rabbi';
    show(manager ? 'app' : 'member');
    if (manager) { $('communityRole').textContent = ROLE[role]; renderManager(); } else renderMember();
  }, e => gate(esc(errText(e, 'לא ניתן לטעון את לוח הזמנים של הקהילה.')), `<a class="btn-link" href="${ACCOUNT_URL}">לחשבון שלי</a>`));
}

async function load(){
  if (!Auth.isAuthenticated()) {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    return gate('כדי לראות את לוח הזמנים של הקהילה יש להתחבר עם חשבון Google.', '<button type="button" class="primary" id="gateSignIn">כניסה עם Google</button>');
  }
  let synagogues = [];
  try {
    const [me, list] = await Promise.all([Auth.client().query('users:me', {}), Auth.client().query('synagogues:mine', {})]);
    if (me === null) { Auth.clearAuth(); return load(); }
    synagogues = list;
  } catch (e) { console.warn(e); }
  let id = Auth.activeSynagogueId();
  if (!synagogues.some(s => s._id === id)) { id = synagogues[0] ? synagogues[0]._id : null; Auth.setActiveSynagogueId(id); }
  if (!id) return gate('עדיין לא הצטרפת לקהילה. אפשר להצטרף דרך הזמנה מהגבאי או לפתוח קהילה חדשה.', `<a class="btn-link" href="${ACCOUNT_URL}">לחשבון שלי</a>`);
  const s = synagogues.find(x => x._id === id);
  $('communityName').textContent = s.name;
  $('memberCommunityName').textContent = s.name;
  if (id !== sid || !unsubscribe) subscribe(id);
}

/** getLuachFile: מחזירה { file, title, firstDate, mode } של הלוח המוצג, או null */
export async function initCommunity(options){
  getLuachFile = options.getLuachFile;
  toast = options.toast;
  $('submitLuach').onclick = submitCurrent;
  try { await Auth.completeSignInFromRedirect(); } catch (e) { console.warn(e); toast('ההתחברות נכשלה. נסו שוב.', true); }
  Auth.onChange(() => load());
  await load();
}
