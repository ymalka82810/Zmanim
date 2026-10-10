/* לוח שנה עברי: שבתות וחגים לפי מיקום (מבוסס @hebcal/core)
 * חושף window.KiddushCalendar לשימוש app.js או כל פרויקט אחר.
 */
(function(){
"use strict";
const H = window.hebcal;
const LOC = 'he-x-NoNikud';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad = n => String(n).padStart(2,'0');
const dkey = d => d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const pkey = k => { const [y,m,d]=k.split('-').map(Number); return new Date(y,m-1,d); };
/* היום לפי המנהג העברי: אחרי השקיעה כבר מתחיל היום הבא (js/theme.js) */
const today0 = () => { if (window.SiteTheme?.hebToday) return window.SiteTheme.hebToday(); const d=new Date(); d.setHours(0,0,0,0); return d; };
const gShort = d => d.getDate()+'.'+(d.getMonth()+1);
const gFull = d => d.toLocaleDateString('he-IL',{day:'numeric',month:'long',year:'numeric'});
const heMonth = hd => H.Locale.gettext(hd.getMonthName(), LOC);
const heDay = hd => H.gematriya(hd.getDate());
const heYear = y => H.gematriya(y);
const heFull = hd => heDay(hd)+' '+heMonth(hd)+' '+heYear(hd.getFullYear());
const fmtTime = t => t ? new Date(t).toLocaleString('he-IL',{day:'numeric',month:'numeric',year:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
const rid = () => Math.random().toString(36).slice(2,10);
/* ---------- Hebrew calendar: Shabbatot & Chagim ---------- */
const slotCache = new Map();
function getSlots(start, end, il){
  const ck = dkey(start)+'|'+dkey(end)+'|'+il;
  if (slotCache.has(ck)) return slotCache.get(ck);
  const evs = H.HebrewCalendar.calendar({start, end, sedrot:true, il, noMinorFast:true, noModern:true});
  const byDay = {};
  for (const e of evs){ const k = dkey(e.getDate().greg()); (byDay[k] ||= []).push(e); }
  const F = H.flags, out = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)){
    const k = dkey(d), list = byDay[k] || [], isSat = d.getDay() === 6;
    const chag = list.find(e => e.getFlags() & F.CHAG);
    if (list.some(e => e.getFlags() & F.MAJOR_FAST)) continue; // יום כיפור – אין קידוש
    if (!isSat && !chag) continue;
    const parsha = list.find(e => e.getFlags() & F.PARSHA_HASHAVUA);
    const chm = list.find(e => e.getFlags() & F.CHOL_HAMOED);
    let kind, name;
    if (chag){ kind = isSat ? 'שבת וחג' : 'חג'; name = chag.render(LOC).replace(/\s*\d{4}$/,''); }
    else if (parsha){ kind = 'שבת פרשת'; name = parsha.render(LOC).replace(/^פרשת\s+/,''); }
    else if (chm){ kind = 'שבת'; name = 'חול המועד ' + (/^Pesach/.test(chm.getDesc()) ? 'פסח' : 'סוכות'); }
    else { kind = 'שבת'; name = 'שבת'; }
    const subs = [];
    for (const e of list){
      const f = e.getFlags();
      if (e === chag || e === parsha) continue;
      if (f & (F.SPECIAL_SHABBAT | F.ROSH_CHODESH)) subs.push(e.render(LOC));
      else if (/^Chanukah/.test(e.getDesc())) subs.push('חנוכה');
      else if ((f & F.CHOL_HAMOED) && !chag && parsha) subs.push('חול המועד');
    }
    const hd = new H.HDate(new Date(d));
    out.push({ key:k, date:new Date(d), hd, kind, name, isChag:!!chag, subs:[...new Set(subs)] });
  }
  slotCache.set(ck, out);
  return out;
}
function slotFor(key, il){ const d = pkey(key); return getSlots(d, d, il)[0] || {key, date:d, hd:new H.HDate(d), kind:'', name:gFull(d), subs:[]}; }
const slotTitle = s => (s.kind === 'שבת פרשת' ? 'שבת ' : s.kind === 'שבת וחג' ? 'שבת ' : '') + s.name;

function monthRange(anchor, mode){
  if (mode === 'greg'){
    const y = anchor.getFullYear(), m = anchor.getMonth();
    return { start:new Date(y,m,1), end:new Date(y,m+1,0) };
  }
  const hd = new H.HDate(anchor), first = new H.HDate(1, hd.getMonth(), hd.getFullYear());
  return { start:first.greg(), end:new H.HDate(first.abs()+first.daysInMonth()-1).greg(), first };
}

window.KiddushCalendar = { H, LOC, esc, pad, dkey, pkey, today0, gShort, gFull, heMonth, heDay, heYear, heFull, fmtTime, rid,
  getSlots, slotFor, slotTitle, monthRange, clearCache: () => slotCache.clear() };
})();
