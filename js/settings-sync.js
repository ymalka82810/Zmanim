/**
 * סנכרון הגדרות הלוח עם הקהילה, כך שכל הגבאים והרב רואים אותן בכל מכשיר ודפדפן.
 * ההגדרות נשמרות גם במכשיר (config.js), כדי שהאתר ייפתח מהר ויעבוד בלי אינטרנט.
 * עיצוב מקובץ (תמונה וגופנים) גדול מדי לרשומה, ולכן הוא עולה כקובץ נפרד פעם אחת, לפי גיבוב התוכן שלו,
 * ובהגדרות שבענן נשאר במקומו { blob: גיבוב, enabled }.
 * כששני גבאים משנים יחד, השמירה האחרונה קובעת.
 */

import { normalize } from './config.js';

const META_KEY = 'zmanim.config.cloud';   // { sid, rev } – הקהילה והגרסה שההגדרות במכשיר תואמות להן

function readMeta() { try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; } catch (e) { return {}; } }
function writeMeta(m) { try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch (e) { /* אין גישה לאחסון */ } }

const designs = new Map();   // גיבוב ← העיצוב (בלי enabled)

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** העיצוב בלי ההפעלה, שנשמרת בכל תבנית בנפרד */
function payloadOf(design) {
  const { enabled, ...rest } = design;
  return rest;
}

async function hashDesign(design) {
  const text = JSON.stringify(payloadOf(design));
  const hash = await sha256(text);
  designs.set(hash, JSON.parse(text));
  return { hash, text };
}

/**
 * client – ConvexClient. sid – הקהילה.
 * getCfg() – ההגדרות הנוכחיות. hasLocal – האם יש במכשיר הגדרות שנשמרו.
 * apply(cfg, by) – הגדרות חדשות מהענן. by – מי שמר אותן. toast(text, err).
 * מחזיר { push(cfg), stop() }.
 */
export function startSync({ client, sid, getCfg, hasLocal, apply, toast }) {
  const meta = readMeta();
  let rev = meta.sid === sid ? meta.rev || 0 : null;   // null – ההגדרות במכשיר לא מהקהילה הזו
  let known = new Set();       // עיצובים שכבר שמורים בקהילה
  let busy = false, again = null, stopped = false, failed = false;

  const setRev = r => { rev = r; writeMeta({ sid, rev }); };

  async function upload(hash, text) {
    const url = await client.mutation('zmanimSettings:generateUploadUrl', { synagogueId: sid });
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text });
    if (!res.ok) throw new Error('upload');
    const { storageId } = await res.json();
    await client.mutation('zmanimSettings:addDesign', { synagogueId: sid, hash, storageId });
    known.add(hash);
  }

  /** ההגדרות לענן: כל עיצוב מקובץ מוחלף בגיבוב שלו, ועיצוב שעוד לא בקהילה עולה קודם */
  async function send(cfg) {
    const light = JSON.parse(JSON.stringify(cfg));
    for (const t of light.templates) {
      if (!t.design || t.design.ref) continue;
      const { hash, text } = await hashDesign(t.design);
      if (!known.has(hash)) await upload(hash, text);
      t.design = { blob: hash, enabled: t.design.enabled !== false };
    }
    setRev(await client.mutation('zmanimSettings:save', { synagogueId: sid, config: JSON.stringify(light) }));
  }

  async function push(cfg) {
    if (stopped) return;
    if (busy) { again = cfg; return; }
    busy = true;
    try {
      await send(cfg);
      if (failed) { failed = false; toast('ההגדרות סונכרנו עם הקהילה'); }
    } catch (e) {
      console.warn(e);
      if (!failed) toast(navigator.onLine === false ? 'אין חיבור. ההגדרות נשמרו במכשיר ויסונכרנו בשינוי הבא'
        : 'לא ניתן לשמור את ההגדרות בקהילה. הן נשמרו במכשיר', true);
      failed = true;
    } finally {
      busy = false;
      if (again && !stopped) { const next = again; again = null; push(next); }
    }
  }

  /** ההגדרות מהענן, עם העיצובים המלאים (מהזיכרון, מההגדרות שבמכשיר או מהורדה) */
  async function resolve(data) {
    const cfg = JSON.parse(data.config);
    const local = getCfg();
    for (const t of local.templates) if (t.design && !t.design.ref) await hashDesign(t.design);
    for (const t of cfg.templates || []) {
      const blob = t.design && t.design.blob;
      if (!blob) continue;
      if (!designs.has(blob) && data.designs[blob]) {
        try {
          const res = await fetch(data.designs[blob]);
          if (res.ok) designs.set(blob, await res.json());
        } catch (e) { console.warn(e); }
      }
      const d = designs.get(blob);
      t.design = d ? { ...JSON.parse(JSON.stringify(d)), enabled: t.design.enabled !== false } : null;
    }
    return normalize(cfg);
  }

  let pending = null;   // הגרסה האחרונה מהענן, כשגרסה קודמת עוד בטעינה
  let loading = false;
  async function onData(data) {
    if (stopped) return;
    if (data === null) {
      // הקהילה עוד בלי הגדרות בענן: ההגדרות שבמכשיר עולות, אם הן לא שייכות לקהילה אחרת
      if (hasLocal() && (meta.sid == null || meta.sid === sid)) push(getCfg());
      else if (rev === null) { setRev(0); apply(normalize(null), null); }
      return;
    }
    if (data.rev === rev || busy || again) return;   // שמירה שלנו, או שמירה שלנו בדרך שתחליף אותה
    if (loading) { pending = data; return; }
    loading = true;
    try {
      const cfg = await resolve(data);
      if (!stopped && !busy && !again) { setRev(data.rev); apply(cfg, data.updatedBy); }
    } catch (e) { console.warn('לא ניתן לטעון את ההגדרות מהקהילה', e); }
    finally {
      loading = false;
      if (pending) { const next = pending; pending = null; onData(next); }
    }
  }

  const unsubDesigns = client.onUpdate('zmanimSettings:designList', { synagogueId: sid }, list => { known = new Set(list); }, () => {});
  const unsub = client.onUpdate('zmanimSettings:get', { synagogueId: sid }, onData, e => console.warn(e));

  return {
    push,
    stop() { stopped = true; unsub(); unsubDesigns(); }
  };
}
