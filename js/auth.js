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

function applyTokens(tokens){
  if (tokens){
    write(TOKEN_KEY, tokens.token);
    write(REFRESH_KEY, tokens.refreshToken);
    return tokens.token;
  }
  write(TOKEN_KEY, null);
  write(REFRESH_KEY, null);
  return null;
}

async function fetchToken({ forceRefreshToken }){
  if (!forceRefreshToken) return read(TOKEN_KEY);
  const refreshToken = read(REFRESH_KEY);
  if (!refreshToken) return null;
  try {
    const { tokens } = await unauthenticatedAction('auth:signIn', { refreshToken });
    return applyTokens(tokens ?? null);
  } catch(e){
    console.warn('רענון ההתחברות נכשל', e);
    applyTokens(null);
    return null;
  }
}

async function signInWithGoogle(redirectTo){
  const result = await getClient().action('auth:signIn', {
    provider: 'google',
    params: { redirectTo: redirectTo || location.href }
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
  applyTokens(tokens ?? null);
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
  signInWithGoogle,
  completeSignInFromRedirect,
  signOut,
  clearAuth,
};
})();
