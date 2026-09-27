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
    const { tokens } = await getClient().action('auth:signIn', { refreshToken });
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
  const { tokens } = await getClient().action('auth:signIn', { params: { code }, verifier });
  applyTokens(tokens ?? null);
  return true;
}

async function signOut(){
  try { await getClient().action('auth:signOut', {}); } catch(e){ /* כנראה כבר מנותק */ }
  applyTokens(null);
}

window.SiteAuth = {
  client: getClient,
  isAuthenticated(){ return !!read(TOKEN_KEY); },
  onChange(fn){ listeners.add(fn); return () => listeners.delete(fn); },
  signInWithGoogle,
  completeSignInFromRedirect,
  signOut,
};
})();
