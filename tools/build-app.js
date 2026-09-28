// Copies only the site files into www/ for Capacitor.
import { cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = ROOT + 'www';
const FILES = [
  'index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'icons', 'vendor',
  'gabbai/index.html', 'gabbai/css', 'gabbai/js',
  'kiddush/index.html', 'kiddush/css', 'kiddush/js',
  'account/index.html', 'account/css', 'account/js',
  'community-calendar/index.html', 'community-calendar/js'
];

await rm(OUT, { recursive: true, force: true });
for (const f of FILES) await cp(ROOT + f, OUT + '/' + f, { recursive: true });
console.log('www/ ready');
