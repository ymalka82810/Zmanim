/* מאגר נתונים מקומי ללוח הקידושים.
 * בתוך claude.ai קיים window.claude, והאפליקציה משתמשת במאגר של הארטיפקט.
 * בכל מקום אחר (למשל באתר ב-GitHub Pages) הקובץ הזה מגדיר window.claude עם אותו ממשק,
 * והנתונים נשמרים ב-localStorage של הדפדפן הנוכחי בלבד. יש משתמש אחד, והוא בעל המערכת.
 */
(function(){
"use strict";
if (window.claude && window.claude.use) return;

const KEY = 'kiddush-local-v1';
const UID = 'local';
let store = load();
const listeners = new Set();

function load(){
  try { const j = JSON.parse(localStorage.getItem(KEY) || 'null'); if (j && j.docs) return j; } catch(e){}
  return { docs: {} };
}
function save(){
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch(e){ console.warn(e); }
  notify();
}
function notify(){ listeners.forEach(fn => { try { fn(); } catch(e){ console.warn(e); } }); }
window.addEventListener('storage', e => { if (e.key === KEY){ store = load(); notify(); } });

const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
const lastPart = p => p.slice(p.lastIndexOf('/') + 1);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
function snapOf(path){
  const d = store.docs[path];
  return { id: lastPart(path), exists: d !== undefined, data: () => clone(d) };
}
function watch(fn, cb){
  const run = () => cb(fn());
  listeners.add(run);
  setTimeout(run, 0);
  return () => listeners.delete(run);
}

function doc(path){
  return {
    id: lastPart(path),
    async get(){ return snapOf(path); },
    async set(data){ store.docs[path] = clone(data); save(); },
    async update(patch){
      if (store.docs[path] === undefined) throw new Error('המסמך לא קיים: ' + path);
      store.docs[path] = { ...store.docs[path], ...clone(patch) }; save();
    },
    async delete(){ delete store.docs[path]; save(); },
    onSnapshot(cb){ return watch(() => snapOf(path), cb); },
    async acquire(){ return { acquired: true, release: async () => {} }; }
  };
}

function query(path, order, max){
  const docs = () => {
    const pre = path + '/';
    let ids = Object.keys(store.docs).filter(p => p.startsWith(pre) && !p.slice(pre.length).includes('/'));
    let list = ids.map(snapOf);
    if (order){
      const [f, dir] = order, s = dir === 'desc' ? -1 : 1;
      list.sort((a, b) => { const x = a.data()[f], y = b.data()[f]; return x < y ? -s : x > y ? s : 0; });
    }
    if (max != null) list = list.slice(0, max);
    return { docs: list, size: list.length, empty: !list.length };
  };
  return {
    orderBy: (f, dir) => query(path, [f, dir], max),
    limit: n => query(path, order, n),
    async get(){ return docs(); },
    onSnapshot(cb){ return watch(docs, cb); }
  };
}

function collection(path){
  return {
    ...query(path),
    doc: id => doc(path + '/' + (id || newId())),
    async add(data){ const ref = doc(path + '/' + newId()); await ref.set(data); return ref; }
  };
}

const db = { doc, collection };
const user = {
  async me(){ return { id: UID, isOwner: true }; },
  async can(){ return true; },
  async profiles(ids){ const o = {}; ids.forEach(id => o[id] = { name: id === UID ? 'אני' : '', email: '' }); return o; }
};
const downloads = {
  async save({ filename, data }){
    const url = URL.createObjectURL(new Blob([data], { type: 'text/calendar;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
};

window.claude = { local: true, use: async name => ({ db, user, downloads })[name] || null };
})();
