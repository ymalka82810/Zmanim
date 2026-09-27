/* מצב יום ומצב לילה לכל דפי האתר: יום מהנץ עד השקיעה, לילה מהשקיעה עד הנץ.
 * המיקום: GPS של המכשיר (נשמר במכשיר), ואם אין – העיר מהגדרות הלוח, ואם אין – ירושלים.
 * מהתפריט אפשר לקבוע ידנית יום או לילה; הבחירה נשמרת במכשיר.
 * נטען ב-head כסקריפט רגיל, כדי שהצבעים ייקבעו לפני שהדף מוצג.
 */
(function(){
"use strict";
const PREF_KEY = 'site.theme', GEO_KEY = 'site.geo', CONFIG_KEY = 'zmanim.config';
const BAR_COLOR = { light: '#2c4a7c', dark: '#1b2d56' };
const JERUSALEM = { lat: 31.769, lng: 35.2163 };
const RAD = Math.PI / 180, DAY = 86400000;
const root = document.documentElement;

function read(key){ try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }
function write(key, v){ try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* אין גישה לאחסון */ } }
const isPlace = p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng);

function place(){
  const gps = read(GEO_KEY), cfg = read(CONFIG_KEY);
  return isPlace(gps) ? gps : isPlace(cfg) ? cfg : JERUSALEM;
}

/* זריחה או שקיעה (אלגוריתם NOAA, כמו ב-astro.js) במילישניות UTC, או null אם השמש לא זורחת/שוקעת */
function sunEvent(dayNum, lat, lng, rising){
  let t = 720 - 4 * lng;
  for (let i = 0; i < 3; i++){
    const T = (dayNum + 2440587.5 + t / 1440 - 2451545) / 36525;
    const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
    const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    const C = Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
      Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * RAD) * 0.000289;
    const omega = 125.04 - 1934.136 * T;
    const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD);
    const eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(omega * RAD);
    const dec = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) / RAD;
    const y = Math.pow(Math.tan(eps * RAD / 2), 2);
    const eqTime = 4 / RAD * (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD) +
      4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) -
      0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD));
    const cosH = (Math.cos(90.833 * RAD) - Math.sin(lat * RAD) * Math.sin(dec * RAD)) / (Math.cos(lat * RAD) * Math.cos(dec * RAD));
    if (cosH > 1 || cosH < -1) return null;
    const H = Math.acos(cosH) / RAD;
    t = 720 - 4 * (lng + (rising ? H : -H)) - eqTime;
  }
  return dayNum * DAY + t * 60000;
}

/* { dark, next } לפי הזריחה או השקיעה האחרונה שכבר עברה; next – זמן ההחלפה הבאה */
function sunState(now, p){
  const d = new Date(now), today = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
  const events = [];
  for (let k = -1; k <= 1; k++) for (const rising of [true, false]){
    const t = sunEvent(today + k, p.lat, p.lng, rising);
    if (t != null) events.push({ t, dark: !rising });
  }
  events.sort((a, b) => a.t - b.t);
  const last = events.filter(e => e.t <= now).pop(), next = events.find(e => e.t > now);
  return last ? { dark: last.dark, next: next && next.t } : null;
}

function getPref(){
  const p = read(PREF_KEY);
  return p === 'light' || p === 'dark' ? p : 'auto';
}

let timer;
function apply(){
  clearTimeout(timer);
  let mode = getPref();
  if (mode === 'auto'){
    const now = Date.now(), s = sunState(now, place());
    if (s){
      mode = s.dark ? 'dark' : 'light';
      if (s.next) timer = setTimeout(apply, Math.min(s.next - now + 1000, 6 * 3600000));
    } else {
      mode = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
  }
  root.dataset.theme = mode;
  root.style.colorScheme = mode;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = BAR_COLOR[mode];
  document.dispatchEvent(new CustomEvent('sitethemechange'));
}

function locate(){
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(pos => {
    write(GEO_KEY, { lat: pos.coords.latitude, lng: pos.coords.longitude });
    apply();
  }, () => { /* אין הרשאה – נשארים עם העיר מההגדרות */ }, { maximumAge: 3600000, timeout: 20000 });
}

window.SiteTheme = {
  get pref(){ return getPref(); },
  get mode(){ return root.dataset.theme; },
  set(pref){
    write(PREF_KEY, pref);
    apply();
    if (pref === 'auto') locate();
  }
};

apply();
if (getPref() === 'auto') locate();
// בטלפון טיימרים נעצרים כשהדף ברקע, לכן בודקים שוב כשחוזרים אליו
document.addEventListener('visibilitychange', () => { if (!document.hidden) apply(); });
addEventListener('storage', e => { if (e.key === PREF_KEY || e.key === GEO_KEY || e.key === CONFIG_KEY) apply(); });
})();
