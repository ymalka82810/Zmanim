/* שמירת קבצים, שיתוף והדפסה שעובדים גם באפליקציית אנדרואיד, שבה הורדת blob:, navigator.share ו-window.print() לא עושים כלום.
 * NativeFiles.save(blob, name, {open}) – בדפדפן הורדה רגילה; באפליקציה שמירה בתיקיית ההורדות,
 *   או עם {open: true} פתיחה באפליקציה שמטפלת בקובץ (למשל .ics ביומן). מחזיר 'downloaded' | 'saved' | 'opened' | 'shared'.
 * NativeFiles.share({file, title, text, url}) – חלון שיתוף של קובץ או של טקסט/קישור.
 *   מחזיר 'shared' | 'cancelled' | 'unsupported' (דפדפן בלי שיתוף – המטפל מחליט מה לעשות במקום).
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

async function nativeSave(blob, name, mode, title) {
  const mime = (blob.type || 'application/octet-stream').split(';')[0];
  const r = await call('save', { name, mime, mode, title, data: await toBase64(blob) });
  return r.result;
}

async function save(blob, name, { open = false } = {}) {
  if (isApp()) return nativeSave(blob, name, open ? 'open' : 'save');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return 'downloaded';
}

async function share({ file, title = '', text = '', url = '' } = {}) {
  if (isApp()) {
    if (file) return nativeSave(file, file.name, 'share', title || file.name);
    return (await call('shareText', { title, text: [text, url].filter(Boolean).join('\n') })).result;
  }
  const data = file ? { files: [file], title } : { title, text: text || undefined, url: url || undefined };
  if (!navigator.share || (file && !(navigator.canShare && navigator.canShare(data)))) return 'unsupported';
  try { await navigator.share(data); return 'shared'; }
  catch (e) { if (e.name === 'AbortError') return 'cancelled'; throw e; }
}

async function print({ title = document.title, paper = 'A4', landscape = false } = {}) {
  if (isApp()) return call('print', { title, paper, landscape });
  const prev = document.title;
  document.title = title;   // שם קובץ ה-PDF
  window.print();
  document.title = prev;
}

window.NativeFiles = { isApp, save, share, print };
})();
