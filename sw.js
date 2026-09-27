/**
 * Service worker: מאפשר לאתר לעבוד בלי אינטרנט.
 * קבצי האתר: קודם מהרשת (כדי לקבל עדכונים), ואם אין חיבור – מהמטמון.
 * גופנים: מהמטמון, ואם אין – מהרשת.
 */
const CACHE = 'luach-v9';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest',
  'js/app.js', 'js/menu.js', 'js/theme.js', 'js/astro.js', 'js/config.js', 'js/dates.js', 'js/hebrew.js', 'js/image.js', 'js/luach.js', 'js/template-read.js', 'js/template-render.js', 'js/template-ui.js', 'js/render.js', 'js/zmanim.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'vendor/hebcal/hebcal-core-6.9.3.min.js',
  'kiddush/', 'kiddush/index.html', 'kiddush/css/styles.css', 'kiddush/js/local-store.js', 'kiddush/js/default-terms.js', 'kiddush/js/calendar.js', 'kiddush/js/app.js',
  'gabbai/', 'gabbai/index.html', 'gabbai/css/styles.css', 'gabbai/js/app.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
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
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true })));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy));
      return res;
    })));
  }
});
