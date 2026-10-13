/**
 * מעדכן את sw.js לפני commit/deploy: בונה מחדש את רשימת הקבצים ב-SHELL לפי הקבצים
 * שבפועל קיימים בתיקיות האתר, ומחשב CACHE מ-hash של תוכן הקבצים (במקום מספר גרסה ידני),
 * כך שהוא משתנה אוטומטית בכל שינוי בקובץ ומכשירים ינקו את המטמון הישן.
 * הרצה: node tools/build-sw.js
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

async function listFiles(dir) {
  const entries = await readdir(ROOT + dir, { withFileTypes: true });
  return entries.filter(e => e.isFile()).map(e => e.name).sort()
    .map(name => dir + '/' + name);
}

const PAGES = ['kiddush', 'gabbai', 'aliyot', 'account', 'community-calendar', 'guest', 'week', 'catalog', 'tv', 'screen'];
/* דפים שחבר רגיל לא נכנס אליהם (קופה, מסכי תצוגה, קטלוג, אורחים): לא יורדים מראש בכל גרסה.
 * הם נכנסים לחישוב ה-hash, ולכן גרסה חדשה מנקה אותם מהמטמון, ומורידים אותם בכניסה הראשונה (sw.js שומר כל קובץ שהגיע מהרשת). */
const LAZY_PAGES = ['gabbai', 'tv', 'screen', 'catalog', 'guest'];

async function buildShell() {
  const shell = ['./', 'index.html', 'css/app.css', 'manifest.webmanifest'];
  shell.push(...await listFiles('js'));
  shell.push(...await listFiles('icons'));
  shell.push(...await listFiles('vendor/hebcal'));
  shell.push(...await listFiles('vendor/convex'));
  shell.push(...await listFiles('vendor/qrcode'));
  for (const page of PAGES) {
    shell.push(page + '/', page + '/index.html');
    for (const dir of ['css', 'js']) {
      try { shell.push(...await listFiles(page + '/' + dir)); }
      catch { /* אין לדף הזה תיקיית css או js */ }
    }
  }
  return shell;
}

const isLazy = f => LAZY_PAGES.some(page => f.startsWith(page + '/'));

async function hashShell(shell) {
  const hash = createHash('sha256');
  for (const entry of shell) {
    if (entry.endsWith('/')) continue;
    hash.update(entry);
    hash.update(await readFile(ROOT + entry));
  }
  return hash.digest('hex').slice(0, 10);
}

function formatShell(shell) {
  const lines = [
    shell.slice(0, 4),
    shell.filter(f => f.startsWith('js/')),
    shell.filter(f => f.startsWith('icons/')),
    shell.filter(f => f.startsWith('vendor/hebcal/')),
    shell.filter(f => f.startsWith('vendor/convex/')),
    shell.filter(f => f.startsWith('vendor/qrcode/')),
    ...PAGES.map(page => shell.filter(f => f.startsWith(page + '/'))),
  ].filter(group => group.length);
  return lines.map(group => '  ' + group.map(f => `'${f}'`).join(', ')).join(',\n');
}

const all = await buildShell();
const shell = all.filter(f => !isLazy(f));
const version = await hashShell(all);
const cache = `luach-${version}`;

const swPath = ROOT + 'sw.js';
let sw = await readFile(swPath, 'utf8');
const before = sw.match(/const CACHE = '([^']*)';/)?.[1];
sw = sw.replace(/const CACHE = '[^']*';/, `const CACHE = '${cache}';`);
sw = sw.replace(/const SHELL = \[[\s\S]*?\];/, `const SHELL = [\n${formatShell(shell)}\n];`);
await writeFile(swPath, sw);

console.log(`sw.js עודכן: ${shell.length} קבצים ב-SHELL (${all.length - shell.length} נוספים בהורדה לפי דרישה), CACHE ${before} ← ${cache}`);
