/* שמירת קבצים והדפסה שעובדות גם באפליקציית אנדרואיד, שבה הורדת blob: ו-window.print() לא עושות כלום.
 * NativeFiles.save(blob, name, {open}) – בדפדפן הורדה רגילה; באפליקציה שמירה בתיקיית ההורדות,
 *   או עם {open: true} פתיחה באפליקציה שמטפלת בקובץ (למשל .ics ביומן). מחזיר 'downloaded' | 'saved' | 'opened' | 'shared'.
 * NativeFiles.print({title, paper, landscape}) – באפליקציה חלון ההדפסה של אנדרואיד, ומתממש כשהוא נסגר.
 * החלק ה-native ב-android/.../NativeFilesPlugin.java.
 */
(function(){
"use strict";
const isApp = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const call = (method, opts) => window.Capacitor.nativePromise('NativeFiles', method, opts);

const toBase64 = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).slice(String(r.result).indexOf(',') + 1));
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

async function save(blob, name, { open = false } = {}) {
  if (isApp()) {
    const mime = (blob.type || 'application/octet-stream').split(';')[0];
    const r = await call('save', { name, mime, mode: open ? 'open' : 'save', data: await toBase64(blob) });
    return r.result;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return 'downloaded';
}

async function print({ title = document.title, paper = 'A4', landscape = false } = {}) {
  if (isApp()) return call('print', { title, paper, landscape });
  const prev = document.title;
  document.title = title;   // שם קובץ ה-PDF
  window.print();
  document.title = prev;
}

window.NativeFiles = { isApp, save, print };
})();
