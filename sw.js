/**
 * Service worker: מאפשר לאתר לעבוד בלי אינטרנט.
 * קבצי האתר: מהמטמון, בלי לחכות לרשת, כדי שכל דף ייפתח מיד. CACHE משתנה בכל שינוי בתוכן הקבצים
 * (tools/build-sw.js), ולכן גרסה חדשה של האתר מתקינה service worker חדש שמוריד את כל הקבצים מחדש,
 * וכשהוא נכנס לפעולה menu.js מרענן את הדף פעם אחת כדי להציג אותה. ההורדה עוקפת את המטמון של הדפדפן, כי GitHub Pages מורה לשמור קבצים 10 דקות.
 * בשרת המקומי (npm start) ובאפליקציה הקבצים נמצאים במכשיר, ולכן שם קודם מהרשת, כדי ששינוי יופיע מיד.
 * גופנים: מהמטמון, ואם אין – מהרשת.
 */
const CACHE = 'luach-502778310c';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest',
  'js/app-update.js', 'js/app.js', 'js/astro.js', 'js/auth.js', 'js/community.js', 'js/config.js', 'js/convex-config.js', 'js/dates.js', 'js/dialog.js', 'js/font-fill.js', 'js/hebrew.js', 'js/image.js', 'js/luach.js', 'js/menu.js', 'js/moadim.js', 'js/native-files.js', 'js/preload.js', 'js/render.js', 'js/search-words.js', 'js/search.js', 'js/settings-sync.js', 'js/template-boxes.js', 'js/template-build.js', 'js/template-fields.js', 'js/template-fonts.js', 'js/template-lines.js', 'js/template-move.js', 'js/template-place.js', 'js/template-read.js', 'js/template-render.js', 'js/template-rules.js', 'js/template-slots.js', 'js/template-state.js', 'js/template-ui.js', 'js/text-edit.js', 'js/theme.js', 'js/wizard.js', 'js/zmanim.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon.svg', 'icons/maskable-512.png',
  'vendor/hebcal/hebcal-core-6.9.3.min.js',
  'vendor/convex/convex-browser-1.46.0.js',
  'vendor/qrcode/qrcode-generator-1.4.4.js',
  'kiddush/', 'kiddush/index.html', 'kiddush/css/styles.css', 'kiddush/js/app.js', 'kiddush/js/calendar.js',
  'gabbai/', 'gabbai/index.html', 'gabbai/css/styles.css', 'gabbai/js/app.js',
  'aliyot/', 'aliyot/index.html', 'aliyot/js/app.js',
  'account/', 'account/index.html', 'account/css/styles.css', 'account/js/app.js',
  'community-calendar/', 'community-calendar/index.html', 'community-calendar/js/app.js',
  'guest/', 'guest/index.html', 'guest/css/styles.css', 'guest/js/app.js',
  'week/', 'week/index.html', 'week/js/app.js',
  'tv/', 'tv/index.html', 'tv/css/styles.css', 'tv/js/app.js'
];

const LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    const fromNetwork = () => fetch(req, { cache: 'no-cache' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    });
    const fromCache = () => caches.open(CACHE).then(c => c.match(req, { ignoreSearch: true }));
    e.respondWith(LOCAL
      ? fromNetwork().catch(fromCache)
      : fromCache().then(hit => hit || fromNetwork()));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy));
      return res;
    })));
  }
});
