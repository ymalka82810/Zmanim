/**
 * זיהוי מיקום המכשיר והתאמתו להגדרות: עיר מהרשימה אם יש אחת קרובה, ואחרת קואורדינטות חופשיות.
 * עובד באתר ובאפליקציה (Capacitor מבקש את הרשאת המיקום לבד, וההרשאות מוצהרות ב-AndroidManifest).
 */

const NEAR_KM = 25;
const rad = Math.PI / 180;

function km(a, b) {
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/** קואורדינטות המכשיר. נדחה בשגיאה עם code: 'unsupported' | 'denied' | 'unavailable' | 'timeout' */
export function detectCoords() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject({ code: 'unsupported' }); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      err => reject({ code: err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'unavailable' }),
      { maximumAge: 3600000, timeout: 20000 });
  });
}

/**
 * ההגדרות שמתאימות למיקום: { city, lat, lng, candle, tz, il, name }.
 * cities – CITIES מ-config.js. מחוץ לרשימה: אזור הזמן של המכשיר, ומנהג ארץ ישראל רק באזור הזמן של ישראל.
 */
export function placeFor(coords, cities, tzFallback) {
  let best = null, bestKm = Infinity;
  for (const c of cities) {
    const d = km(coords, { lat: c[2], lng: c[3] });
    if (d < bestKm) { best = c; bestKm = d; }
  }
  if (best && bestKm <= NEAR_KM) return { city: best[0], name: best[1] };
  let tz = tzFallback;
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tzFallback; } catch (e) { /* נשארים עם ברירת המחדל */ }
  const il = tz === 'Asia/Jerusalem';
  return { city: 'custom', name: 'המיקום שלך', lat: +coords.lat.toFixed(4), lng: +coords.lng.toFixed(4), tz, il, candle: il ? 22 : 18 };
}

const ASKED_KEY = 'zmanim.geoAsked';
/** האם כבר ניסינו לזהות ונכשלנו או נדחינו (כדי לא לבקש הרשאה בכל כניסה) */
export function geoAsked() { try { return !!localStorage.getItem(ASKED_KEY); } catch (e) { return false; } }
export function markGeoAsked() { try { localStorage.setItem(ASKED_KEY, '1'); } catch (e) { /* אין גישה לאחסון */ } }

export const ERROR_TEXT = {
  denied: 'אין הרשאת מיקום. אפשר לאשר אותה בהגדרות הדפדפן או המכשיר, או לבחור עיר ידנית',
  timeout: 'זיהוי המיקום לקח יותר מדי זמן. אפשר לנסות שוב או לבחור עיר ידנית',
  unsupported: 'המכשיר לא תומך בזיהוי מיקום. אפשר לבחור עיר ידנית',
  unavailable: 'לא הצלחנו לזהות את המיקום. אפשר לנסות שוב או לבחור עיר ידנית'
};
