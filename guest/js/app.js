/* העמוד הציבורי לאורחים (guest/?c=קוד): זמני השבוע וכתובת בית הכנסת, לקריאה בלבד ובלי התחברות.
 * הגבאי או הרב מפעילים אותו ב"החשבון שלי" ← הקהילה ← עמוד לאורחים (convex/guest.ts). */
(function(){
"use strict";
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const MODE = { holy: 'שבתות וחגים', days: 'ימות השבוע', events: 'מודעת אירוע' };
const code = new URLSearchParams(location.search).get('c') || '';
const isApp = () => !!(window.NativeFiles && NativeFiles.isApp());

function toast(text){
  const t = document.createElement('div');
  t.className = 'guest-toast'; t.setAttribute('role', 'status'); t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

function message(text){
  $('app').innerHTML = `<div class="empty">${esc(text)}</div>`;
}

const mapsLinks = q => {
  const e = encodeURIComponent(q);
  return `<a class="btn sec" href="https://waze.com/ul?q=${e}&navigate=yes">ניווט ב-Waze</a>
    <a class="btn sec" href="https://www.google.com/maps/search/?api=1&query=${e}">Google Maps</a>`;
};

function render(b){
  document.title = 'זמני ' + b.name;
  const place = [b.address, b.city].filter(Boolean).join(', ');
  const target = isApp() ? '' : ' target="_blank" rel="noopener"';
  $('app').innerHTML = `
    <header class="guest-head">
      <h1>${esc(b.name)}</h1>
      <p class="where">${esc(place)}</p>
      <div class="guest-actions">
        ${b.address ? mapsLinks(place) : ''}
        <button type="button" class="btn sec" id="btnShare">שיתוף העמוד</button>
      </div>
    </header>
    ${b.files.length ? b.files.map(f => `
      <section class="guest-file">
        <h2>${esc(f.title)}</h2>
        <p class="kind">${MODE[f.mode] || ''}</p>
        ${f.url ? `<a href="${esc(f.url)}"${target}><img src="${esc(f.url)}" alt="${esc(f.title)}"></a>` : ''}
      </section>`).join('')
      : '<div class="empty">עדיין אין לוח זמנים מפורסם לשבוע הזה.</div>'}
    <p class="guest-foot">שבת שלום! העמוד מתעדכן אוטומטית כשהגבאי מפרסם לוח חדש.</p>`;
  $('btnShare').onclick = () => share(b.name);
}

async function share(name){
  const url = window.SiteAuth ? SiteAuth.publicUrl(location.href) : location.href;
  let r;
  try { r = await NativeFiles.share({ title: 'זמני ' + name, url }); } catch (e) { r = 'unsupported'; }
  if (r !== 'unsupported') return;
  try { await navigator.clipboard.writeText(url); toast('הקישור הועתק'); }
  catch (e) { toast('העתקה נכשלה'); }
}

if (!code) message('חסר קוד בקישור. בקשו מהגבאי את הקישור לעמוד האורחים.');
else {
  const client = new window.convex.ConvexClient(window.CONVEX_URL);
  client.onUpdate('guest:board', { code }, b => {
    if (b === null) message('הקישור לא תקף, או שהקהילה כיבתה את עמוד האורחים.');
    else render(b);
  }, () => message('לא ניתן לטעון את הזמנים כרגע. נסו לרענן את העמוד.'));
}
})();
