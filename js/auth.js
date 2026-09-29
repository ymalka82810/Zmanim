/* התחברות עם Google דרך Convex Auth, משותף לכל הדפים.
 * פרוטוקול ה-action `auth:signIn` מבוסס על node_modules/@convex-dev/auth/dist/react/client.js:
 * כניסה -> { redirect, verifier }; חזרה עם code -> { tokens }; רענון עם refreshToken -> { tokens }.
 * דורש: ../js/convex-config.js וספריית ../vendor/convex/ נטענים לפני קובץ זה.
 */
(function(){
"use strict";
const TOKEN_KEY = 'convex.auth.token', REFRESH_KEY = 'convex.auth.refreshToken', VERIFIER_KEY = 'convex.auth.verifier';

function read(key){ try { return localStorage.getItem(key); } catch(e){ return null; } }
function write(key, v){ try { v == null ? localStorage.removeItem(key) : localStorage.setItem(key, v); } catch(e){} }

let client = null;
function getClient(){
  if (!client){
    client = new window.convex.ConvexClient(window.CONVEX_URL);
    client.setAuth(fetchToken, notify);
  }
  return client;
}

/* פעולות בלי טוקן (רענון, השלמת כניסה) עוברות בחיבור HTTP נפרד, כמו ב-@convex-dev/auth.
 * ה-ConvexClient עוצר את כל הבקשות בזמן שהוא מחכה ל-fetchToken, ולכן רענון דרכו לא חוזר לעולם
 * והדפים נתקעים על "טוען…" ברגע שהטוקן פג. */
function unauthenticatedAction(name, args){
  return new window.convex.ConvexHttpClient(window.CONVEX_URL).action(name, args);
}

const listeners = new Set();
function notify(isAuthenticated){ listeners.forEach(fn => { try { fn(isAuthenticated); } catch(e){ console.error(e); } }); }

/* ---------- תשובות אחרונות מהשרת, שמורות במכשיר ----------
 * כל דף מציג מיד את מה שהשרת ענה בכניסה הקודמת, ומתעדכן כשמגיעה תשובה חדשה.
 * הן שייכות למשתמש המחובר, ולכן נמחקות ביציאה ובכניסה עם חשבון אחר. */
const CACHE_PREFIX = 'site.cache.';
const CACHE_MAX_CHARS = 500000;   // תשובה גדולה יותר לא נשמרת, כדי לא למלא את האחסון של הדפדפן
const cacheKey = (name, args) => CACHE_PREFIX + name + ':' + JSON.stringify(args || {});

function cached(name, args){
  const raw = read(cacheKey(name, args));
  if (raw == null) return undefined;
  try { return JSON.parse(raw); } catch(e){ return undefined; }
}

function remember(name, args, value){
  const text = JSON.stringify(value);
  write(cacheKey(name, args), text != null && text.length <= CACHE_MAX_CHARS ? text : null);
}

function clearCache(){
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++){ const k = localStorage.key(i); if (k && k.startsWith(CACHE_PREFIX)) keys.push(k); }
    keys.forEach(k => localStorage.removeItem(k));
    // מסך הפתיחה (index.html) יטען מחדש את הנתונים של המשתמש הנוכחי בכניסה הבאה לדף הראשי
    sessionStorage.removeItem('site.booted');
  } catch(e){ /* אין גישה לאחסון */ }
}

/* כמו client.query, ושומר את התשובה */
async function query(name, args){
  const value = await getClient().query(name, args);
  remember(name, args, value);
  return value;
}

/* כמו client.onUpdate: קודם התשובה השמורה (אם יש), ואחר כך כל תשובה מהשרת */
function watch(name, args, onData, onError){
  let live = false, stopped = false;
  const unsub = getClient().onUpdate(name, args, value => {
    live = true;
    remember(name, args, value);
    onData(value);
  }, onError);
  const hit = cached(name, args);
  if (hit !== undefined) Promise.resolve().then(() => { if (!live && !stopped) onData(hit); });
  return () => { stopped = true; unsub(); };
}

function applyTokens(tokens){
  if (tokens){
    write(TOKEN_KEY, tokens.token);
    write(REFRESH_KEY, tokens.refreshToken);
    return tokens.token;
  }
  write(TOKEN_KEY, null);
  write(REFRESH_KEY, null);
  clearCache();
  return null;
}

/* fetch נכשל ב-TypeError כשאין רשת; שגיאה מהשרת (טוקן לא תקף) מגיעה כ-Error רגיל */
const isNetworkError = e => e instanceof TypeError;
const RETRY_BACKOFF = [500, 2000, 5000];   // המתנה לפני כל ניסיון חוזר, במילישניות

let refreshingSince = 0;   // מתי התחיל הרענון שעוד לא הסתיים (0 – אין רענון)

async function fetchToken({ forceRefreshToken }){
  if (!forceRefreshToken) return read(TOKEN_KEY);
  const refreshToken = read(REFRESH_KEY);
  if (!refreshToken) return null;
  refreshingSince = Date.now();
  try {
    for (let retry = 0; ; retry++){
      try {
        const { tokens } = await unauthenticatedAction('auth:signIn', { refreshToken });
        return applyTokens(tokens ?? null);
      } catch(e){
        if (isNetworkError(e) && retry < RETRY_BACKOFF.length){
          await new Promise(r => setTimeout(r, RETRY_BACKOFF[retry] + Math.random() * 100));
          continue;
        }
        console.warn('רענון ההתחברות נכשל', e);
        // בתקלת רשת שומרים את הטוקנים, כדי שבטעינה הבאה אפשר יהיה לרענן בלי להתחבר מחדש
        if (!isNetworkError(e)) applyTokens(null);
        return null;
      }
    }
  } finally {
    refreshingSince = 0;
  }
}

/* ---------- הודעה כשאין חיבור לשרת ----------
 * בלי זה, דף שמחכה לשרת נשאר על "טוען…" בלי שום הסבר. */
const STUCK_MS = 15000;
const bannerCss = `
.sa-offline{position:fixed;top:calc(56px + env(safe-area-inset-top,0px));left:50%;transform:translateX(-50%);z-index:800;display:flex;align-items:center;gap:10px;max-width:calc(100% - 32px);padding:10px 14px;border-radius:12px;background:#fff4d6;color:#5a4300;border:1px solid #e8c96a;box-shadow:0 4px 16px rgba(10,20,40,.15);font-family:"Assistant",Arial,sans-serif;font-size:.95rem;direction:rtl}
.sa-offline button{flex:none;padding:6px 12px;border:0;border-radius:8px;background:#5a4300;color:#fff;font:inherit;font-weight:600;cursor:pointer}
:root[data-theme="dark"] .sa-offline{background:#3a3016;color:#f3dd9c;border-color:#6b5a26}
:root[data-theme="dark"] .sa-offline button{background:#f3dd9c;color:#2a220c}
@media print{.sa-offline{display:none!important}}
`;
let banner = null, badSince = 0;

function showBanner(show){
  if (!show){ if (banner) banner.hidden = true; return; }
  if (!banner){
    const style = document.createElement('style');
    style.textContent = bannerCss;
    document.head.appendChild(style);
    banner = document.createElement('div');
    banner.className = 'sa-offline';
    banner.setAttribute('role', 'status');
    banner.innerHTML = '<span></span><button type="button">טעינה מחדש</button>';
    banner.querySelector('button').onclick = () => location.reload();
    document.body.appendChild(banner);
  }
  banner.querySelector('span').textContent = navigator.onLine === false
    ? 'אין חיבור לאינטרנט. ממשיכים לנסות…'
    : 'אין חיבור לשרת. ממשיכים לנסות…';
  banner.hidden = false;
}

function checkConnection(){
  if (!client) return;
  const now = Date.now(), s = client.connectionState();
  const bad = !s.isWebSocketConnected ||
    (s.timeOfOldestInflightRequest && now - s.timeOfOldestInflightRequest.getTime() > STUCK_MS) ||
    (refreshingSince && now - refreshingSince > STUCK_MS);
  if (!bad){ badSince = 0; showBanner(false); return; }
  if (!badSince) badSince = now;
  if (now - badSince > STUCK_MS) showBanner(true);
}
setInterval(checkConnection, 2000);

/* באפליקציה הדף רץ על https://localhost, שקיים רק בתוך האפליקציה. הכניסה עצמה נפתחת בדפדפן החיצוני,
 * ולכן החזרה מגוגל עוברת בכתובת עם scheme של האפליקציה, ו-MainActivity טוען אותה בחזרה ב-WebView. */
const APP_RETURN_ORIGIN = 'com.zmanim.luach://localhost';
const isNativeApp = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

function returnUrl(redirectTo){
  const url = redirectTo || location.href;
  if (!isNativeApp() || !url.startsWith(location.origin + '/')) return url;
  return APP_RETURN_ORIGIN + url.slice(location.origin.length);
}

/* קישור שנשלח לאחרים (הזמנה, אירוע ביומן) מצביע על האתר הציבורי, כי כתובת localhost של האפליקציה לא תיפתח אצלם */
const PUBLIC_SITE = 'https://ymalka82810.github.io/Zmanim/';
function publicUrl(url){
  url = url || location.href;
  if (!isNativeApp() || !url.startsWith(location.origin + '/')) return url;
  return PUBLIC_SITE + url.slice(location.origin.length + 1);
}

async function signInWithGoogle(redirectTo){
  const result = await getClient().action('auth:signIn', {
    provider: 'google',
    params: { redirectTo: returnUrl(redirectTo) }
  });
  if (result.redirect){
    write(VERIFIER_KEY, result.verifier);
    location.href = result.redirect;
  }
}

/* אם בכתובת יש ?code=... (חזרה מגוגל) – משלים את ההתחברות ומנקה את הפרמטר מהכתובת */
async function completeSignInFromRedirect(){
  const url = new URL(location.href);
  const code = url.searchParams.get('code');
  if (!code) return false;
  url.searchParams.delete('code');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
  const verifier = read(VERIFIER_KEY);
  write(VERIFIER_KEY, null);
  const { tokens } = await unauthenticatedAction('auth:signIn', { params: { code }, verifier });
  clearCache();   // אולי נכנסו עם חשבון אחר
  applyTokens(tokens ?? null);
  /* ה-client כבר נוצר בטעינת הדף וקרא טוקן ריק; בלי זה הוא נשאר לא מחובר עד רענון הדף */
  if (client) client.setAuth(fetchToken, notify);
  return true;
}

async function signOut(){
  try { await getClient().action('auth:signOut', {}); } catch(e){ /* כנראה כבר מנותק */ }
  applyTokens(null);
  write(ACTIVE_KEY, null);
}

/* מנקה טוקן שגוי/שפג תוקפו בלי לפנות לשרת (למשל אחרי שהתברר שהשרת לא מזהה את המשתמש) */
function clearAuth(){
  applyTokens(null);
}

/* הקהילה הפעילה משותפת ללוח הזמנים, ללוח הקידושים ולקופה */
const ACTIVE_KEY = 'site.activeSynagogue';

window.SiteAuth = {
  client: getClient,
  activeSynagogueId(){ return read(ACTIVE_KEY); },
  setActiveSynagogueId(id){ write(ACTIVE_KEY, id); },
  isAuthenticated(){ return !!read(TOKEN_KEY); },
  onChange(fn){ listeners.add(fn); return () => listeners.delete(fn); },
  cached,
  query,
  watch,
  signInWithGoogle,
  completeSignInFromRedirect,
  publicUrl,
  signOut,
  clearAuth,
};
})();
