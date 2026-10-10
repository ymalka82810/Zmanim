(function(){
"use strict";
// ---------- helpers ----------
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const nf=new Intl.NumberFormat("he-IL",{minimumFractionDigits:2,maximumFractionDigits:2});
const money=n=>"₪"+nf.format(Number(n)||0);
const nf0=new Intl.NumberFormat("he-IL",{maximumFractionDigits:2});
const money0=n=>"₪"+nf0.format(Number(n)||0);
const pad=n=>String(n).padStart(2,"0");
const iso=d=>d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const todayIso=()=>iso(new Date());
const parseIso=s=>{const [y,m,d]=String(s).split("-").map(Number);return new Date(y,(m||1)-1,d||1)};
const gFmt=new Intl.DateTimeFormat("he-IL",{day:"numeric",month:"numeric",year:"numeric"});
const noNiqqud=s=>String(s).replace(/[\u0591-\u05C7]/g,"").replace("שּׁ","ש");
function toast(t){const e=$("#toast");e.textContent=t;e.classList.add("on");clearTimeout(toast._t);toast._t=setTimeout(()=>e.classList.remove("on"),2200)}

const TYPE={donation:"תרומה",mitzvah:"מכירת מצווה",salary:"משכורת",expense:"הוצאה",petty:"קנייה מקופה קטנה",pettyIn:"מילוי קופה קטנה"};

// ---------- Hebrew date & parasha ----------
const hcache=new Map();
function heb(dateStr){
  if(!dateStr) return {heb:"",parsha:""};
  const key=dateStr+"|"+settings.israel;
  if(hcache.has(key)) return hcache.get(key);
  let out={heb:"",parsha:""};
  const d=parseIso(dateStr);
  try{
    const H=window.hebcal;
    if(H){
      const hd=new H.HDate(d);
      out.heb=hd.renderGematriya(true);
      const s=new H.Sedra(hd.getFullYear(),!!settings.israel);
      const p=s.lookup(hd);
      const name=p.parsha.map(x=>noNiqqud(H.Locale.gettext(x,"he"))).join("-");
      out.parsha=p.chag?("שבת "+name):("פרשת "+name);
    }else{
      out.heb=new Intl.DateTimeFormat("he-u-ca-hebrew",{day:"numeric",month:"long",year:"numeric"}).format(d);
    }
  }catch(e){}
  hcache.set(key,out);return out;
}
function dateCell(s){const h=heb(s);return `${esc(gFmt.format(parseIso(s)))}<span class="sub">${esc(h.heb)}</span><span class="sub">${esc(h.parsha)}</span>`}

// ---------- state & storage (Convex: convex/fund.ts) ----------
const Auth=window.SiteAuth;
let txs=[]; let settings={synName:"קופת בית הכנסת",openMain:0,openPetty:0,israel:1};
// הקופה נטענת מתחילת השנה הקודמת. מה שלפני כן מגיע כיתרת פתיחה נוספת (carry), ו"הצגת כל ההיסטוריה" טוענת הכול
let since=defaultSince(), carry={main:0,petty:0}, ledgerTxs=[], carryTxs=[], carryReady=true, ledgerReady=false;
let members=[], campaigns=[], role=null, sid=null, stage="loading", ledgerError="", notifications=[];
const isManager=()=>role==="gabbai"||role==="rabbi";
const LS="gabbai-fallback-v1";
function errText(e,fallback){return (e&&typeof e.data==="string")?e.data:fallback}
const call=(name,args)=>Auth.client().mutation(name,Object.assign({synagogueId:sid},args));
const TX_KEYS=["type","amount","date","name","desc","method","mitzvah","month","category","vendor","paid","paidDate","createdAt"];
async function putTx(obj){
  const body={};for(const k of TX_KEYS) if(obj[k]!==undefined) body[k]=obj[k];
  body.donorId=obj.donorId||null;
  body.campaignId=obj.campaignId||null;
  if(obj.id) body.id=obj.id;
  await call("fund:save",body);
}
async function delTx(id){await call("fund:remove",{id})}
async function markPaid(id){await call("fund:markPaid",{id,paidDate:todayIso()})}
async function putSettings(s){await call("fund:saveSettings",{openMain:s.openMain,openPetty:s.openPetty})}
async function pledgeMine(o){await call("fund:pledgeMine",o)}
async function markFundRead(){await call("fund:markNotificationsRead",{})}
const campById=id=>campaigns.find(c=>c.id===id);

function localData(){try{const j=JSON.parse(localStorage.getItem(LS)||"null");return j&&Array.isArray(j.txs)&&j.txs.length?j:null}catch(e){return null}}
async function importLocal(){
  const j=localData();if(!j)return;
  if(!await SiteDialog.confirm(`להעביר ${j.txs.length} רישומים שנשמרו בדפדפן הזה לקופה של ${settings.synName}?`,{ok:"העברה"}))return;
  const list=j.txs.map(t=>{const o={};for(const k of TX_KEYS) if(t[k]!==undefined&&t[k]!==null) o[k]=t[k]; o.amount=Number(o.amount)||0; return o}).filter(o=>o.amount>0&&o.type&&o.date);
  try{
    const n=await call("fund:importLocal",{txs:list,openMain:Number(j.settings&&j.settings.openMain)||0,openPetty:Number(j.settings&&j.settings.openPetty)||0});
    localStorage.setItem(LS+"-imported",localStorage.getItem(LS));localStorage.removeItem(LS);
    toast(`הועברו ${n} רישומים`);render();
  }catch(e){toast(errText(e,"הייבוא נכשל. נסו שוב."))}
}

// ---------- accounting ----------
const isIncome=t=>t.type==="donation"||t.type==="mitzvah"||t.type==="salary";
function label(t){
  if(t.type==="mitzvah") return "מכירת מצווה: "+(t.mitzvah||"");
  if(t.type==="donation"&&t.campaignId) return txWhat(t);
  if(t.type==="salary") return "משכורת"+(t.month?" – "+t.month:"");
  return TYPE[t.type]||"";
}
function moves(account){
  const out=[];
  for(const t of txs){
    const a=Number(t.amount)||0;
    if(account==="main"){
      if(isIncome(t)&&t.paid) out.push({date:t.paidDate||t.date,t,cr:a,dr:0});
      if(t.type==="expense") out.push({date:t.date,t,cr:0,dr:a});
      if(t.type==="pettyIn") out.push({date:t.date,t,cr:0,dr:a});
    }else{
      if(t.type==="pettyIn") out.push({date:t.date,t,cr:a,dr:0});
      if(t.type==="petty") out.push({date:t.date,t,cr:0,dr:a});
    }
  }
  out.sort((x,y)=>x.date<y.date?-1:x.date>y.date?1:(x.t.createdAt||0)-(y.t.createdAt||0));
  return out;
}
function openingOf(account){return (Number(account==="main"?settings.openMain:settings.openPetty)||0)+(account==="main"?carry.main:carry.petty)}
function balance(account,upto){
  let b=openingOf(account);
  for(const m of moves(account)){if(upto&&m.date>upto)break;b+=m.cr-m.dr}
  return b;
}
// "מה" ברשימות התרומות: המצווה, תרומה למגבית, או תרומה כללית
function txWhat(t){
  if(t.type==="mitzvah") return t.mitzvah||"מכירת מצווה";
  if(t.campaignId){const c=campById(t.campaignId);return "תרומה למגבית"+(c?": "+c.title:"")}
  return "תרומה";
}
function sum(arr,f){return arr.reduce((s,x)=>s+(Number(f(x))||0),0)}

// ---------- views ----------
let tab="home"; const ui={from:"",to:"",acct:"main",donView:"list",donFilter:"all",openCamps:new Set()};
function descOf(t){
  const bits=[];
  if(t.name) bits.push(t.name);
  if(t.vendor) bits.push(t.vendor);
  if(t.desc) bits.push(t.desc);
  return bits.join(" · ");
}
function actions(t){
  let s='<div class="rowact">';
  if(isIncome(t)&&!t.paid) s+=`<button class="lnk pay" data-pay="${esc(t.id)}">סמן כשולם</button>`;
  s+=`<button class="lnk" data-edit="${esc(t.id)}">עריכה</button><button class="lnk del" data-del="${esc(t.id)}">מחיקה</button></div>`;
  return s;
}

function viewHome(){
  const owed=txs.filter(t=>(t.type==="donation"||t.type==="mitzvah")&&!t.paid);
  const sal=txs.filter(t=>t.type==="salary"&&!t.paid);
  const recent=[...moves("main").map(m=>({...m,acc:"עו״ש"})),...moves("petty").map(m=>({...m,acc:"קופה קטנה"}))]
    .sort((a,b)=>a.date<b.date?1:a.date>b.date?-1:(b.t.createdAt||0)-(a.t.createdAt||0)).slice(0,8);
  const pending=[...owed,...sal].sort((a,b)=>a.date<b.date?-1:1);
  return `${notices()}
  <div class="balances">
    <div class="bal main"><div class="k">יתרה בעו״ש</div><div class="v">${money(balance("main"))}</div></div>
    <div class="bal petty"><div class="k">יתרה בקופה קטנה</div><div class="v">${money(balance("petty"))}</div></div>
    <div class="bal owed"><div class="k">תרומות ומצוות שטרם שולמו (${owed.length})</div><div class="v">${money(sum(owed,t=>t.amount))}</div></div>
    <div class="bal sal"><div class="k">משכורת צפויה שטרם התקבלה</div><div class="v">${money(sum(sal,t=>t.amount))}</div></div>
  </div>
  <h2>ממתינים לתשלום</h2>
  <div class="panel scroll">${pending.length?`<table><thead><tr><th>תאריך</th><th>סוג</th><th>פרטים</th><th class="num">סכום</th><th></th></tr></thead><tbody>
    ${pending.map(t=>`<tr><td>${dateCell(t.date)}</td><td>${esc(label(t))}</td><td>${esc(descOf(t))}</td><td class="num">${money(t.amount)}</td><td>${actions(t)}</td></tr>`).join("")}
  </tbody></table>`:`<div class="empty">אין חובות פתוחים. כל התרומות, המצוות והמשכורות שנרשמו שולמו.</div>`}</div>
  <h2>תנועות אחרונות</h2>
  <div class="panel scroll">${recent.length?`<table><thead><tr><th>תאריך</th><th>חשבון</th><th>תיאור</th><th class="num">זכות</th><th class="num">חובה</th></tr></thead><tbody>
    ${recent.map(m=>`<tr><td>${dateCell(m.date)}</td><td>${m.acc}</td><td>${esc(label(m.t))}<span class="sub">${esc(descOf(m.t))}</span></td><td class="num cr">${m.cr?money(m.cr):""}</td><td class="num dr">${m.dr?money(m.dr):""}</td></tr>`).join("")}
  </tbody></table>`:`<div class="empty">עדיין אין תנועות. לחצו על ״רישום חדש״ כדי לרשום תרומה, מצווה, הוצאה או משכורת.</div>`}</div>`;
}

function statement(acct,from,to){
  const all=moves(acct);
  const dayBefore=from?iso(new Date(parseIso(from).getTime()-864e5)):"";
  let bal=from?balance(acct,dayBefore):openingOf(acct);
  const opening=bal; const rows=[];
  for(const m of all){ if(from&&m.date<from)continue; if(to&&m.date>to)continue; bal+=m.cr-m.dr; rows.push({...m,bal}) }
  return {opening,rows,closing:bal,cr:sum(rows,r=>r.cr),dr:sum(rows,r=>r.dr)};
}
function viewLedger(){
  if(!ui.from){const d=new Date();ui.from=iso(new Date(d.getFullYear(),d.getMonth(),1));ui.to=todayIso()}
  const s=statement(ui.acct,ui.from,ui.to);
  return `<h2>דף חשבון ודוח תנועות</h2>
  <div class="bar">
    <div class="seg" role="group" aria-label="חשבון"><button data-acct="main" aria-pressed="${ui.acct==="main"}">עו״ש</button><button data-acct="petty" aria-pressed="${ui.acct==="petty"}">קופה קטנה</button></div>
    <label>מתאריך<input type="date" id="lf" lang="he" value="${ui.from}"></label>
    <label>עד תאריך<input type="date" id="lt" lang="he" value="${ui.to}"></label>
    <button class="btn ghost" id="csv">ייצוא ל-Excel (CSV)</button>
    <button class="btn ghost" id="pdf">ייצוא ל-PDF (הדפסה)</button>
  </div>
  <div class="status">${esc(heb(ui.from).heb)} – ${esc(heb(ui.to).heb)}</div>
  <div class="printhead"><h3>${esc(settings.synName||"")} – ${ui.acct==="main"?"דוח עו״ש":"דוח קופה קטנה"}</h3><div>${esc(gFmt.format(parseIso(ui.from)))} – ${esc(gFmt.format(parseIso(ui.to)))} (${esc(heb(ui.from).heb)} – ${esc(heb(ui.to).heb)})</div></div>
  <div class="panel scroll" style="margin-top:8px"><table><thead><tr><th>תאריך</th><th>תיאור</th><th class="num">זכות</th><th class="num">חובה</th><th class="num">יתרה</th></tr></thead><tbody>
    <tr class="total"><td colspan="4">יתרת פתיחה</td><td class="num">${money(s.opening)}</td></tr>
    ${s.rows.map(r=>`<tr><td>${dateCell(r.date)}</td><td>${esc(label(r.t))}<span class="sub">${esc(descOf(r.t))}</span></td><td class="num cr">${r.cr?money(r.cr):""}</td><td class="num dr">${r.dr?money(r.dr):""}</td><td class="num balc">${money(r.bal)}</td></tr>`).join("")}
    ${s.rows.length?"":`<tr><td colspan="5" class="empty">אין תנועות בטווח התאריכים שנבחר.</td></tr>`}
    <tr class="total"><td colspan="2">סה״כ ויתרת סגירה</td><td class="num">${money(s.cr)}</td><td class="num">${money(s.dr)}</td><td class="num">${money(s.closing)}</td></tr>
  </tbody></table></div>`;
}

function viewDonations(){
  const items=txs.filter(t=>t.type==="donation"||t.type==="mitzvah").sort((a,b)=>a.date<b.date?1:-1);
  const head=`<h2>תרומות ומכירת מצוות</h2><div class="bar">
    <div class="seg" role="group"><button data-dv="list" aria-pressed="${ui.donView==="list"}">רשימה</button><button data-dv="sum" aria-pressed="${ui.donView==="sum"}">סיכום לפי תורם</button></div>
    ${ui.donView==="list"?`<div class="seg" role="group"><button data-df="all" aria-pressed="${ui.donFilter==="all"}">הכול</button><button data-df="open" aria-pressed="${ui.donFilter==="open"}">לא שולם</button><button data-df="paid" aria-pressed="${ui.donFilter==="paid"}">שולם</button></div>`:""}
  </div>`;
  if(ui.donView==="sum"){
    const by=new Map();
    for(const t of items){const k=(t.name||"ללא שם").trim();const r=by.get(k)||{name:k,n:0,total:0,paid:0,last:""};r.n++;r.total+=+t.amount||0;if(t.paid)r.paid+=+t.amount||0;if(t.date>r.last)r.last=t.date;by.set(k,r)}
    const rows=[...by.values()].sort((a,b)=>b.total-a.total);
    return head+`<div class="panel scroll"><table><thead><tr><th>תורם</th><th class="num">פעמים</th><th class="num">סה״כ</th><th class="num">שולם</th><th class="num">יתרה לתשלום</th><th class="hide-sm">אחרון</th></tr></thead><tbody>
      ${rows.map(r=>`<tr><td><b>${esc(r.name)}</b></td><td class="num">${r.n}</td><td class="num">${money(r.total)}</td><td class="num cr">${money(r.paid)}</td><td class="num ${r.total-r.paid>0?"dr":""}">${money(r.total-r.paid)}</td><td class="hide-sm">${r.last?dateCell(r.last):""}</td></tr>`).join("")}
      ${rows.length?`<tr class="total"><td>סה״כ</td><td class="num">${sum(rows,r=>r.n)}</td><td class="num">${money(sum(rows,r=>r.total))}</td><td class="num">${money(sum(rows,r=>r.paid))}</td><td class="num">${money(sum(rows,r=>r.total-r.paid))}</td><td class="hide-sm"></td></tr>`:`<tr><td colspan="6" class="empty">עדיין לא נרשמו תרומות.</td></tr>`}
    </tbody></table></div>`;
  }
  const list=items.filter(t=>ui.donFilter==="all"||(ui.donFilter==="paid"?t.paid:!t.paid));
  return head+`<div class="panel scroll"><table><thead><tr><th>תאריך</th><th>מי</th><th>מה</th><th class="num">סכום</th><th>סטטוס</th><th></th></tr></thead><tbody>
    ${list.map(t=>`<tr><td>${dateCell(t.date)}</td><td><b>${esc(t.name||"")}</b>${t.donorId?`<span class="sub">חבר קהילה</span>`:""}</td><td>${esc(txWhat(t))}<span class="sub">${esc(t.desc||"")}</span></td><td class="num">${money(t.amount)}</td>
    <td>${t.paid?`<span class="pill ok">שולם</span><span class="sub">${t.paidDate?esc(gFmt.format(parseIso(t.paidDate))):""} ${esc(t.method||"")}</span>`:`<span class="pill no">לא שולם</span>`}</td><td>${actions(t)}</td></tr>`).join("")}
    ${list.length?"":`<tr><td colspan="6" class="empty">אין רשומות להצגה.</td></tr>`}
  </tbody></table></div>`;
}

function viewPetty(){
  const s=statement("petty","","");
  const rows=[...s.rows].reverse();
  return `<div class="balances"><div class="bal petty"><div class="k">יתרה בקופה הקטנה</div><div class="v">${money(s.closing)}</div></div>
    <div class="bal"><div class="k">סה״כ הוצאות מהקופה</div><div class="v">${money(s.dr)}</div></div></div>
  <div class="bar" style="margin-top:14px"><button class="btn" data-new="petty">רישום קנייה</button><button class="btn ghost" data-new="pettyIn">מילוי הקופה</button></div>
  <div class="panel scroll"><table><thead><tr><th>תאריך</th><th>מה נקנה / פעולה</th><th class="hide-sm">קטגוריה</th><th class="num">נכנס</th><th class="num">יצא</th><th class="num">יתרה</th><th></th></tr></thead><tbody>
    ${rows.map(r=>`<tr><td>${dateCell(r.date)}</td><td>${esc(r.t.type==="pettyIn"?"מילוי הקופה":(r.t.desc||"—"))}<span class="sub">${esc(r.t.type==="pettyIn"?(r.t.desc||""):(r.t.vendor||""))}</span></td><td class="hide-sm">${esc(r.t.category||"")}</td>
      <td class="num cr">${r.cr?money(r.cr):""}</td><td class="num dr">${r.dr?money(r.dr):""}</td><td class="num balc">${money(r.bal)}</td><td>${actions(r.t)}</td></tr>`).join("")}
    ${rows.length?"":`<tr><td colspan="7" class="empty">הקופה הקטנה ריקה מתנועות. התחילו ב״מילוי הקופה״.</td></tr>`}
  </tbody></table></div>`;
}

function viewSalary(){
  const list=txs.filter(t=>t.type==="salary").sort((a,b)=>a.date<b.date?1:-1);
  return `<h2>משכורת חודשית</h2>
  <div class="bar"><button class="btn" data-new="salary">רישום משכורת צפויה</button></div>
  <div class="panel scroll"><table><thead><tr><th>מועד צפוי</th><th>עבור חודש</th><th class="num">סכום</th><th>סטטוס</th><th></th></tr></thead><tbody>
    ${list.map(t=>`<tr><td>${dateCell(t.date)}</td><td>${esc(t.month||"")}<span class="sub">${esc(t.desc||"")}</span></td><td class="num">${money(t.amount)}</td>
      <td>${t.paid?`<span class="pill ok">התקבלה</span><span class="sub">${t.paidDate?esc(gFmt.format(parseIso(t.paidDate))):""}</span>`:`<span class="pill no">טרם התקבלה</span>`}</td><td>${actions(t)}</td></tr>`).join("")}
    ${list.length?`<tr class="total"><td colspan="2">סה״כ התקבל / צפוי</td><td class="num">${money(sum(list.filter(t=>t.paid),t=>t.amount))} / ${money(sum(list.filter(t=>!t.paid),t=>t.amount))}</td><td colspan="2"></td></tr>`:`<tr><td colspan="5" class="empty">עדיין לא נרשמה משכורת. רשמו את הסכום והמועד הצפוי.</td></tr>`}
  </tbody></table></div>`;
}

// תזכורות תשלום והודעות על מגביות חדשות
function notices(){
  const unread=notifications.filter(n=>!n.read);
  return unread.length?`<div class="panel" style="padding:12px;margin:14px 0;border-inline-start:4px solid var(--out)">
    <b>הודעות הקופה</b>
    ${unread.map(n=>`<div class="sub" style="margin-top:6px">${esc(n.text)}</div>`).join("")}
    <div style="margin-top:8px"><button class="btn ghost" id="markFundRead">סימון כנקרא</button></div>
  </div>`:"";
}

// ---------- מגביות (convex/campaigns.ts) ----------
function progress(c){
  const pct=x=>c.goal>0?Math.min(100,Math.max(0,x)/c.goal*100):0;
  return `<div class="prog" role="meter" aria-valuemin="0" aria-valuemax="${c.goal}" aria-valuenow="${c.pledged}" aria-label="נאסף למגבית">
    <div class="prog-bar"><span class="paid" style="width:${pct(c.paid).toFixed(1)}%"></span><span class="pledged" style="width:${pct(c.pledged-c.paid).toFixed(1)}%"></span></div>
    <div class="prog-txt"><b>${money0(c.pledged)}</b> נתרמו מתוך ${money0(c.goal)} <span class="pct">${Math.floor(pct(c.pledged))}%</span></div>
    <div class="sub">${c.left>0?"נותרו "+money0(c.left):"היעד הושג"} · שולם ${money0(c.paid)} · ${c.donors===1?"תורם אחד":c.donors+" תורמים"}</div>
  </div>`;
}
function campStatus(c){return c.status==="closed"?`<span class="pill no">נסגרה</span>`:c.left<=0?`<span class="pill ok">היעד הושג</span>`:""}
function campCard(c,manager){
  const img=c.imageUrl?`<img class="camp-img" src="${esc(c.imageUrl)}" alt="${esc(c.title)}" loading="lazy">`:"";
  const head=`${img}<div class="camp-b"><div class="camp-t"><h3>${esc(c.title)}</h3>${campStatus(c)}</div>
    ${c.desc?`<p class="camp-d">${esc(c.desc)}</p>`:""}${progress(c)}`;
  if(!manager){
    const mine=sum(txs.filter(t=>t.campaignId===c.id),t=>t.amount);
    return `<article class="camp">${head}
      ${mine?`<div class="sub">תרמת למגבית ${money0(mine)}</div>`:""}
      ${c.status==="open"&&c.left>0?`<div class="camp-a"><button class="btn" data-camp-donate="${esc(c.id)}">תרומה למגבית</button></div>`:""}
    </div></article>`;
  }
  const list=txs.filter(t=>t.campaignId===c.id).sort((a,b)=>a.date<b.date?1:-1);
  const open=ui.openCamps.has(c.id);
  return `<article class="camp">${head}
    <div class="camp-a rowact">
      ${c.status==="open"&&c.left>0?`<button class="lnk pay" data-camp-give="${esc(c.id)}">רישום תרומה</button>`:""}
      <button class="lnk" data-camp-edit="${esc(c.id)}">עריכה</button>
      <button class="lnk" data-camp-status="${esc(c.id)}">${c.status==="open"?"סגירת המגבית":"פתיחה מחדש"}</button>
      ${c.count?"":`<button class="lnk del" data-camp-del="${esc(c.id)}">מחיקה</button>`}
    </div>
    ${list.length?`<details class="camp-donors" data-camp="${esc(c.id)}"${open?" open":""}><summary>התרומות (${list.length})</summary>
      <div class="scroll"><table><thead><tr><th>תאריך</th><th>מי</th><th class="num">סכום</th><th>סטטוס</th><th></th></tr></thead><tbody>
      ${list.map(t=>`<tr><td>${dateCell(t.date)}</td><td><b>${esc(t.name||"")}</b><span class="sub">${esc(t.desc||"")}</span></td><td class="num">${money(t.amount)}</td>
        <td>${t.paid?'<span class="pill ok">שולם</span>':'<span class="pill no">לא שולם</span>'}</td><td>${actions(t)}</td></tr>`).join("")}
      </tbody></table></div></details>`:""}
  </div></article>`;
}
function viewCampaigns(){
  const open=campaigns.filter(c=>c.status==="open"), closed=campaigns.filter(c=>c.status!=="open");
  return `<h2>מגביות</h2>
  <div class="bar"><button class="btn" id="newCamp">מגבית חדשה</button></div>
  ${open.length?`<div class="camps">${open.map(c=>campCard(c,true)).join("")}</div>`:`<div class="panel"><div class="empty" style="padding:28px 16px">אין מגביות פתוחות. פתחו מגבית למטרה מסוימת, למשל קניית ספסלים חדשים, והמתפללים יוכלו לתרום לה עד שהעלות תתמלא.</div></div>`}
  ${closed.length?`<h2>מגביות שנסגרו</h2><div class="camps">${closed.map(c=>campCard(c,true)).join("")}</div>`:""}`;
}

function viewMine(){
  const list=[...txs].sort((a,b)=>a.date<b.date?1:-1);
  const paid=list.filter(t=>t.paid), open=list.filter(t=>!t.paid);
  const camps=campaigns.filter(c=>c.status==="open");
  return `${notices()}${camps.length?`<h2>מגביות</h2><div class="camps">${camps.map(c=>campCard(c,false)).join("")}</div>`:""}<h2>התרומות שלי</h2>
  <div class="balances">
    <div class="bal main"><div class="k">סה״כ שולם</div><div class="v">${money(sum(paid,t=>t.amount))}</div></div>
    <div class="bal owed"><div class="k">נדרים שטרם שולמו (${open.length})</div><div class="v">${money(sum(open,t=>t.amount))}</div></div>
  </div>
  <div class="bar" style="margin-top:14px"><button class="btn" id="pledgeBtn">רישום חיוב חדש</button></div>
  <div class="panel scroll" style="margin-top:14px"><table><thead><tr><th>תאריך</th><th>מה</th><th class="num">סכום</th><th>סטטוס</th></tr></thead><tbody>
    ${list.map(t=>`<tr data-tx="${esc(t.id)}"><td>${dateCell(t.date)}</td><td>${esc(t.type==="mitzvah"?"מכירת מצווה: "+t.mitzvah:txWhat(t))}<span class="sub">${esc(t.desc||"")}</span></td><td class="num">${money(t.amount)}</td>
    <td>${t.paid?`<span class="pill ok">שולם</span><span class="sub">${t.paidDate?esc(gFmt.format(parseIso(t.paidDate))):""} ${esc(t.method||"")}</span>`:`<span class="pill no">לא שולם</span>`}</td></tr>`).join("")}
    ${list.length?"":`<tr><td colspan="4" class="empty">עדיין לא נרשמו תרומות על שמך.</td></tr>`}
  </tbody></table></div>
  <div class="status">מוצגות כאן התרומות והמצוות שנרשמו על שמך, בין אם על ידי הגבאי ובין אם על ידך.</div>`;
}
function viewMessage(text,button){return `<div class="empty" style="margin-top:40px">${text}${button?`<div style="margin-top:14px">${button}</div>`:""}</div>`}

function render(){
  const ready=stage==="ready", manager=ready&&isManager();
  if(ready&&window.SiteMenu)SiteMenu.setCommunity({_id:sid,name:settings.synName,il:settings.israel});
  document.querySelector("nav.tabs").hidden=!manager;
  $("#addBtn").hidden=!manager;
  $("#addBtn").textContent=tab==="campaigns"?"+ מגבית חדשה":"+ רישום חדש";
  $("#openSettings").hidden=!manager;
  if(stage==="loading"){$("#view").innerHTML=viewMessage("טוען…");return}
  if(stage==="signedOut"){$("#view").innerHTML=viewMessage("כדי לראות את הקופה יש להתחבר עם חשבון Google.",`<button class="btn btn-google" id="signIn">כניסה עם Google</button>`);return}
  if(stage==="noCommunity"){$("#view").innerHTML=viewMessage("עדיין לא הצטרפת לקהילה.",`<a class="btn" href="../account/">לחשבון שלי</a>`);return}
  if(stage==="error"){$("#view").innerHTML=viewMessage(esc(ledgerError),`<a class="btn" href="../account/">לחשבון שלי</a>`);return}
  if(!manager){$("#view").innerHTML=viewMine();return}
  document.querySelectorAll("nav.tabs button").forEach(b=>b.setAttribute("aria-selected",b.dataset.tab===tab));
  const v={home:viewHome,ledger:viewLedger,donations:viewDonations,campaigns:viewCampaigns,petty:viewPetty,salary:viewSalary}[tab]();
  const local=localData();
  const older=since&&manager?`<div class="panel" style="padding:12px;margin-top:14px">מוצגים רישומים מ-${esc(gFmt.format(parseIso(since)))} ואילך, וכן כל חיוב שטרם שולם. היתרות כוללות את כל ההיסטוריה. <button class="btn ghost" id="allHistory">הצגת כל ההיסטוריה</button></div>`:"";
  $("#view").innerHTML=older+(local?`<div class="panel" style="padding:12px;margin-top:14px">נמצאו בדפדפן הזה ${local.txs.length} רישומי קופה מהגרסה הקודמת. <button class="btn" id="importLocal">העברה לקופת הקהילה</button></div>`:"")+v;
  const names=[...new Set(txs.filter(x=>x.name).map(x=>x.name))];
  $("#donorList").innerHTML=names.map(n=>`<option value="${esc(n)}">`).join("");
  if(!dlg.open) $("#donor").innerHTML=`<option value="">לא חבר קהילה (שם חופשי)</option>`+members.map(m=>`<option value="${esc(m.userId)}">${esc(m.name)}</option>`).join("");
}

// ---------- form ----------
const dlg=$("#dlg"), form=$("#txForm"); let curType="donation", editId=null;
function setType(t){
  curType=t;
  form.querySelectorAll("#typePick button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.t===t));
  form.querySelectorAll("[data-for]").forEach(el=>{el.hidden=!el.dataset.for.split(" ").includes(t)});
  $("#nameLbl").textContent=t==="mitzvah"?"שם הקונה":"שם התורם";
  $("#dateLbl").textContent=t==="salary"?"מועד תשלום צפוי":(t==="mitzvah"?"תאריך המכירה":"תאריך");
  $("#descLbl").textContent=t==="petty"?"מה נקנה":(t==="donation"?"ייעוד / הערה":"תיאור");
  $("#paidLbl").textContent=t==="salary"?"המשכורת התקבלה":"שולם";
  syncPaid();
}
// המגביות שאפשר לשייך אליהן תרומה: הפתוחות, וגם המגבית של הרישום הנערך אם היא כבר נסגרה
function fillCampaigns(t){
  const list=campaigns.filter(c=>c.status==="open"||(t&&c.id===t.campaignId));
  $("#campaignSel").innerHTML=`<option value="">ללא מגבית (תרומה כללית)</option>`+list.map(c=>`<option value="${esc(c.id)}">${esc(c.title)}</option>`).join("");
}
// כמה עוד אפשר לתרום למגבית שנבחרה. ברישום נערך הסכום שלו עצמו לא נספר
function campaignRoom(id){
  const c=campById(id);if(!c)return Infinity;
  const prev=editId?txs.find(x=>x.id===editId):null;
  return c.left+(prev&&prev.campaignId===id?Number(prev.amount)||0:0);
}
function campaignHint(){
  const id=form.campaign.value;
  $("#campaignHint").textContent=id?`אפשר לרשום למגבית עד ${money0(campaignRoom(id))}`:"";
}
function syncPaid(){const on=form.paid.checked&&["donation","mitzvah","salary"].includes(curType);$("#paidDateWrap").hidden=!on;if(on&&!form.paidDate.value)form.paidDate.value=form.date.value||todayIso();hint()}
function hint(){
  const a=heb(form.date.value);$("#dateHint").textContent=form.date.value?`${a.heb} · ${a.parsha}`:"";
  const b=heb(form.paidDate.value);$("#paidHint").textContent=form.paidDate.value?`${b.heb} · ${b.parsha}`:"";
}
function openForm(type,t,campaignId){
  form.reset();editId=t?t.id:null;
  $("#dlgTitle").textContent=t?"עריכת רישום":"רישום חדש";
  $("#typePick").hidden=!!t;
  fillCampaigns(t);
  if(t){for(const k of ["amount","date","name","desc","method","mitzvah","month","category","vendor","paidDate"]) if(form[k]&&t[k]!=null&&t[k]!=="") form[k].value=t[k]; form.paid.checked=!!t.paid; form.donor.value=t.donorId||""; form.campaign.value=t.campaignId||""}
  else{form.date.value=todayIso();form.campaign.value=campaignId||""}
  setType(t?t.type:(type||"donation"));
  campaignHint();
  dlg.showModal();
}
form.addEventListener("click",e=>{const b=e.target.closest("#typePick button");if(b)setType(b.dataset.t);if(e.target.closest("[data-close]"))dlg.close()});
form.paid.addEventListener("change",syncPaid);
form.campaign.addEventListener("change",campaignHint);
form.donor.addEventListener("change",()=>{const m=members.find(x=>x.userId===form.donor.value);if(m)form.name.value=m.name});
form.date.addEventListener("input",hint);form.paidDate.addEventListener("input",hint);
form.addEventListener("submit",async e=>{
  e.preventDefault();
  const amount=parseFloat(form.amount.value);
  if(!(amount>0)){form.amount.focus();toast("יש להזין סכום גדול מאפס");return}
  if(!form.date.value){form.date.focus();return}
  if(curType==="donation"&&form.campaign.value){
    const room=campaignRoom(form.campaign.value);
    if(amount>room+0.001){form.amount.focus();toast(room>0?`אפשר לרשום למגבית עד ${money0(room)}`:"המגבית כבר הגיעה ליעד");return}
  }
  const prev=editId?txs.find(x=>x.id===editId):null;
  const o={type:curType,amount,date:form.date.value,desc:form.desc.value.trim(),createdAt:prev?prev.createdAt:Date.now()};
  if(editId)o.id=editId;
  if(curType==="donation"||curType==="mitzvah"){o.name=form.name.value.trim();o.donorId=form.donor.value||null;o.method=form.method.value;if(curType==="donation")o.campaignId=form.campaign.value||null;if(curType==="mitzvah")o.mitzvah=form.mitzvah.value}
  if(curType==="salary")o.month=form.month.value.trim();
  if(curType==="expense"||curType==="petty"){o.category=form.category.value;o.vendor=form.vendor.value.trim()}
  if(isIncome(o)){o.paid=form.paid.checked;o.paidDate=o.paid?(form.paidDate.value||o.date):""}
  const btn=$("#saveBtn");btn.disabled=true;
  try{await putTx(o);dlg.close();toast("נשמר")}catch(err){toast(errText(err,"השמירה נכשלה. נסו שוב."))}
  btn.disabled=false;
});

// ---------- pledge (member self-charge) ----------
const pdlg=$("#pledgeDlg"), pform=$("#pledgeForm"); let pType="donation";
function setPledgeType(t){
  pType=t;
  pform.querySelectorAll("#pledgeTypePick button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.t===t));
  pform.querySelectorAll("[data-for]").forEach(el=>{el.hidden=!el.dataset.for.split(" ").includes(t)});
}
function openPledge(){pform.reset();pform.date.value=todayIso();setPledgeType("donation");pdlg.showModal()}
pform.addEventListener("click",e=>{const b=e.target.closest("#pledgeTypePick button");if(b)setPledgeType(b.dataset.t);if(e.target.closest("[data-close]"))pdlg.close()});
pform.addEventListener("submit",async e=>{
  e.preventDefault();
  const amount=parseFloat(pform.amount.value);
  if(!(amount>0)){pform.amount.focus();toast("יש להזין סכום גדול מאפס");return}
  if(!pform.date.value){pform.date.focus();return}
  const btn=$("#pledgeSaveBtn");btn.disabled=true;
  try{
    await pledgeMine({type:pType,amount,date:pform.date.value,desc:pform.desc.value.trim(),mitzvah:pType==="mitzvah"?pform.mitzvah.value:undefined});
    pdlg.close();toast("החיוב נרשם")
  }catch(err){toast(errText(err,"השמירה נכשלה. נסו שוב."))}
  btn.disabled=false;
});

// ---------- מגבית: פתיחה ועריכה ----------
const cdlg=$("#campDlg"), cform=$("#campForm"); let campEditId=null, campFile=null, campRemove=false, campPreviewUrl=null;
function setCampPreview(src){
  if(campPreviewUrl){URL.revokeObjectURL(campPreviewUrl);campPreviewUrl=null}
  const img=$("#campPreview");img.hidden=!src;if(src)img.src=src;else img.removeAttribute("src");
  $("#campImageRemove").hidden=!src;
  $("#campImageLbl").textContent=src?"החלפת התמונה":"בחירת תמונה";
}
function openCampaign(c){
  cform.reset();campEditId=c?c.id:null;campFile=null;campRemove=false;
  $("#campTitle").textContent=c?"עריכת מגבית":"מגבית חדשה";
  if(c){cform.title.value=c.title;cform.goal.value=c.goal;cform.desc.value=c.desc||"";cform.guests.checked=!!c.guests}
  setCampPreview(c&&c.imageUrl);
  cdlg.showModal();
}
// התמונה מוקטנת בדפדפן לפני ההעלאה, כדי שלא תתפוס מקום מיותר באחסון הקהילה ותיטען מהר אצל המתפללים
async function shrinkImage(file){
  const MAX=1600, url=URL.createObjectURL(file);
  try{
    const img=await new Promise((ok,bad)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=bad;i.src=url});
    const k=Math.min(1,MAX/Math.max(img.naturalWidth,img.naturalHeight));
    const cv=document.createElement("canvas");cv.width=Math.round(img.naturalWidth*k);cv.height=Math.round(img.naturalHeight*k);
    const g=cv.getContext("2d");g.fillStyle="#fff";g.fillRect(0,0,cv.width,cv.height);g.drawImage(img,0,0,cv.width,cv.height);
    return await new Promise((ok,bad)=>cv.toBlob(b=>b?ok(b):bad(new Error("encode")),"image/jpeg",.85));
  }finally{URL.revokeObjectURL(url)}
}
$("#campImage").addEventListener("change",async e=>{
  const f=e.target.files&&e.target.files[0];e.target.value="";if(!f)return;
  try{campFile=await shrinkImage(f)}catch(err){toast("לא ניתן לקרוא את התמונה. נסו קובץ JPG או PNG.");return}
  campRemove=false;setCampPreview(null);campPreviewUrl=URL.createObjectURL(campFile);
  const img=$("#campPreview");img.src=campPreviewUrl;img.hidden=false;$("#campImageRemove").hidden=false;$("#campImageLbl").textContent="החלפת התמונה";
});
$("#campImageRemove").onclick=()=>{campFile=null;campRemove=true;setCampPreview(null)};
cform.addEventListener("click",e=>{if(e.target.closest("[data-close]"))cdlg.close()});
cdlg.addEventListener("close",()=>setCampPreview(null));
cform.addEventListener("submit",async e=>{
  e.preventDefault();
  const title=cform.title.value.trim(), goal=parseFloat(cform.goal.value);
  if(!title){cform.title.focus();return}
  if(!(goal>0)){cform.goal.focus();toast("יש להזין עלות גדולה מאפס");return}
  const prev=campEditId?campById(campEditId):null;
  if(prev&&goal+0.001<prev.pledged){cform.goal.focus();toast(`כבר נתרמו ${money0(prev.pledged)}, ולכן העלות לא יכולה להיות נמוכה מזה`);return}
  const btn=$("#campSaveBtn");btn.disabled=true;
  try{
    const args={title,goal,desc:cform.desc.value.trim(),guests:cform.guests.checked};
    if(campEditId)args.id=campEditId;
    if(campFile){
      const url=await call("campaigns:generateUploadUrl",{});
      const res=await fetch(url,{method:"POST",headers:{"Content-Type":campFile.type},body:campFile});
      if(!res.ok)throw new Error("upload");
      args.imageId=(await res.json()).storageId;
    }else if(campRemove)args.removeImage=true;
    const r=await call("campaigns:save",args);
    if(r&&r.error)toast(r.error);
    else{cdlg.close();toast(campEditId?"המגבית עודכנה":"המגבית נפתחה");if(!campEditId){tab="campaigns";render()}}
  }catch(err){toast(errText(err,"השמירה נכשלה. נסו שוב."))}
  btn.disabled=false;
});

// ---------- תרומה של מתפלל למגבית ----------
const ddlg=$("#donateDlg"), dform=$("#donateForm"); let donateId=null;
function openDonate(c){
  dform.reset();donateId=c.id;
  $("#donateWhat").innerHTML=`<b>${esc(c.title)}</b>${progress(c)}`;
  dform.amount.max=c.left;
  $("#donateHint").textContent=`אפשר לתרום עד ${money0(c.left)}, הסכום שנותר עד השלמת העלות`;
  ddlg.showModal();
}
dform.addEventListener("click",e=>{if(e.target.closest("[data-close]"))ddlg.close()});
dform.addEventListener("submit",async e=>{
  e.preventDefault();
  const c=campById(donateId), amount=parseFloat(dform.amount.value);
  if(!c)return ddlg.close();
  if(!(amount>0)){dform.amount.focus();toast("יש להזין סכום גדול מאפס");return}
  if(amount>c.left+0.001){dform.amount.focus();toast(c.left>0?`אפשר לתרום עד ${money0(c.left)}`:"המגבית כבר הגיעה ליעד");return}
  const btn=$("#donateSaveBtn");btn.disabled=true;
  try{await call("fund:donateCampaign",{campaignId:c.id,amount,date:todayIso(),desc:dform.desc.value.trim()});ddlg.close();toast("תודה! התרומה נרשמה")}
  catch(err){toast(errText(err,"השמירה נכשלה. נסו שוב."))}
  btn.disabled=false;
});

// ---------- settings ----------
const sdlg=$("#setDlg"), sform=$("#setForm");
$("#openSettings").onclick=()=>{sform.openMain.value=settings.openMain||0;sform.openPetty.value=settings.openPetty||0;sdlg.showModal()};
sform.addEventListener("click",e=>{if(e.target.closest("[data-close]"))sdlg.close()});
sform.addEventListener("submit",async e=>{e.preventDefault();try{await putSettings({openMain:parseFloat(sform.openMain.value)||0,openPetty:parseFloat(sform.openPetty.value)||0});sdlg.close();toast("ההגדרות נשמרו")}catch(err){toast(errText(err,"השמירה נכשלה"))}});

// ---------- events ----------
document.querySelector("nav.tabs").addEventListener("click",e=>{const b=e.target.closest("button[data-tab]");if(b){tab=b.dataset.tab;render();window.scrollTo(0,0)}});
$("#addBtn").onclick=()=>tab==="campaigns"?openCampaign(null):openForm(tab==="petty"?"petty":tab==="salary"?"salary":"donation");
$("#view").addEventListener("click",async e=>{
  const b=e.target.closest("button");if(!b)return;
  if(b.dataset.new) return openForm(b.dataset.new);
  if(b.dataset.acct){ui.acct=b.dataset.acct;return render()}
  if(b.dataset.dv){ui.donView=b.dataset.dv;return render()}
  if(b.dataset.df){ui.donFilter=b.dataset.df;return render()}
  if(b.dataset.edit){const t=txs.find(x=>x.id===b.dataset.edit);if(t)openForm(null,t);return}
  if(b.dataset.del){const t=txs.find(x=>x.id===b.dataset.del);if(t&&await SiteDialog.confirm(`למחוק את הרישום "${label(t)}" על סך ${money(t.amount)}?`,{ok:"מחיקה",danger:true})){try{await delTx(t.id);toast("נמחק")}catch(err){toast(errText(err,"המחיקה נכשלה"))}}return}
  if(b.dataset.pay){const t=txs.find(x=>x.id===b.dataset.pay);if(t){try{await markPaid(t.id);toast("סומן כשולם")}catch(err){toast(errText(err,"העדכון נכשל"))}}return}
  if(b.id==="csv") return exportCsv();
  if(b.id==="pdf") return print();
  if(b.id==="importLocal") return importLocal();
  if(b.id==="allHistory") return setSince("");
  if(b.id==="signIn") return Auth.signInWithGoogle(location.href).catch(()=>toast("ההתחברות נכשלה"));
  if(b.id==="pledgeBtn") return openPledge();
  if(b.id==="markFundRead"){try{await markFundRead()}catch(err){}return}
  if(b.id==="newCamp") return openCampaign(null);
  if(b.dataset.campDonate){const c=campById(b.dataset.campDonate);if(c)openDonate(c);return}
  if(b.dataset.campGive) return openForm("donation",null,b.dataset.campGive);
  if(b.dataset.campEdit){const c=campById(b.dataset.campEdit);if(c)openCampaign(c);return}
  if(b.dataset.campStatus){const c=campById(b.dataset.campStatus);if(!c)return;
    const open=c.status!=="open";
    if(!open&&!await SiteDialog.confirm(`לסגור את המגבית "${c.title}"? היא תוסתר מהמתפללים ולא תקבל עוד תרומות. אפשר לפתוח אותה מחדש.`,{ok:"סגירה"}))return;
    try{await call("campaigns:setStatus",{id:c.id,open});toast(open?"המגבית נפתחה מחדש":"המגבית נסגרה")}catch(err){toast(errText(err,"העדכון נכשל"))}
    return}
  if(b.dataset.campDel){const c=campById(b.dataset.campDel);
    if(c&&await SiteDialog.confirm(`למחוק את המגבית "${c.title}"?`,{ok:"מחיקה",danger:true})){try{await call("campaigns:remove",{id:c.id});toast("המגבית נמחקה")}catch(err){toast(errText(err,"המחיקה נכשלה"))}}
    return}
});
// רשימת התרומות של מגבית נשארת פתוחה גם כשהנתונים מתעדכנים והדף מצויר מחדש
$("#view").addEventListener("toggle",e=>{const d=e.target;if(d.matches&&d.matches("details[data-camp]")){if(d.open)ui.openCamps.add(d.dataset.camp);else ui.openCamps.delete(d.dataset.camp)}},true);
$("#view").addEventListener("change",e=>{if(e.target.id==="lf"){ui.from=e.target.value;if(since&&(!ui.from||ui.from<since)){setSince(ui.from?ui.from.slice(0,4)+"-01-01":"")}render()}if(e.target.id==="lt"){ui.to=e.target.value;render()}});

async function exportCsv(){
  const s=statement(ui.acct,ui.from,ui.to);
  const q=v=>'"'+String(v==null?"":v).replace(/"/g,'""')+'"';
  const n=v=>v?v.toFixed(2):"";
  const lines=[[settings.synName||"",ui.acct==="main"?"דוח עו״ש":"דוח קופה קטנה"].map(q).join(",")];
  lines.push([`${gFmt.format(parseIso(ui.from))} - ${gFmt.format(parseIso(ui.to))}`].map(q).join(","));
  lines.push("");
  lines.push(["תאריך לועזי","תאריך עברי","פרשת השבוע","סוג","פרטים","זכות","חובה","יתרה"].map(q).join(","));
  lines.push([q(""),q(""),q(""),q("יתרת פתיחה"),q(""),"","",n(s.opening)].join(","));
  for(const r of s.rows){const h=heb(r.date);lines.push([q(gFmt.format(parseIso(r.date))),q(h.heb),q(h.parsha),q(label(r.t)),q(descOf(r.t)),n(r.cr),n(r.dr),n(r.bal)].join(","))}
  lines.push([q(""),q(""),q(""),q("סה״כ ויתרת סגירה"),q(""),n(s.cr),n(s.dr),n(s.closing)].join(","));
  const name=(ui.acct==="main"?"דוח-עוש":"דוח-קופה-קטנה")+`_${ui.from||"התחלה"}_${ui.to||"היום"}.csv`;
  const data="\uFEFF"+lines.join("\r\n");
  try{
    const r=await NativeFiles.save(new Blob([data],{type:"text/csv;charset=utf-8"}),name);
    if(r==="saved")toast("הדוח נשמר בהורדות");
  }catch(e){toast("שמירת הדוח נכשלה")}
}

// ---------- boot ----------
let unsubscribe=null, unsubscribeCarry=null;
function defaultSince(){return (new Date().getFullYear()-1)+"-01-01"}
function mergeTxs(){const seen=new Set(ledgerTxs.map(t=>t.id));txs=ledgerTxs.concat(carryTxs.filter(t=>!seen.has(t.id)))}
function unwatch(){if(unsubscribe){unsubscribe();unsubscribe=null}if(unsubscribeCarry){unsubscribeCarry();unsubscribeCarry=null}}
// since="" טוען את כל ההיסטוריה
function setSince(s){if(s===since||!sid)return;since=s;subscribe(sid,true)}
function subscribe(id,keepStage){
  unwatch();
  if(id!==sid){since=defaultSince();carry={main:0,petty:0};carryTxs=[]}
  sid=id;
  if(!id){stage="noCommunity";return render()}
  if(!keepStage){stage="loading";render()}
  carryReady=true;ledgerReady=false;
  if(since){
    carryReady=false;
    unsubscribeCarry=Auth.watch("fund:carry",{synagogueId:id,since},c=>{
      carry={main:c.main,petty:c.petty};carryTxs=c.txs;carryReady=true;mergeTxs();if(ledgerReady){stage="ready";render()}
    },e=>{
      // חבר קהילה רגיל אינו גבאי ולכן אינו צריך את הסיכום
      carry={main:0,petty:0};carryTxs=[];carryReady=true;mergeTxs();if(ledgerReady){stage="ready";render()}
    });
  }else{carry={main:0,petty:0};carryTxs=[]}
  unsubscribe=Auth.watch("fund:ledger",since?{synagogueId:id,since}:{synagogueId:id},d=>{
    role=d.role;ledgerTxs=d.txs;mergeTxs();members=d.members;campaigns=d.campaigns||[];notifications=d.notifications||[];
    settings=Object.assign({},settings,d.settings||{},{synName:d.synagogue.name,israel:d.synagogue.il?1:0});
    hcache.clear();ledgerReady=true;if(carryReady){stage="ready";render()}
  },e=>{console.warn(e);ledgerError=errText(e,"לא ניתן לטעון את הקופה.");stage="error";render()});
}
function signedOut(){unwatch();sid=null;stage="signedOut";render()}
async function load(){
  if(!Auth.isAuthenticated()) return signedOut();
  // הקהילות מהכניסה הקודמת מוצגות מיד, והרשימה מהשרת מחליפה אותן כשהיא מגיעה
  const saved=Auth.cached("synagogues:mine",{});
  if(saved) useSynagogues(saved);
  let synagogues=[];
  try{
    const [me,list]=await Promise.all([Auth.query("users:me",{}),Auth.query("synagogues:mine",{})]);
    if(me===null) return signedOut();
    synagogues=list;
  }catch(e){console.warn(e);if(saved) return}
  useSynagogues(synagogues);
}
function useSynagogues(synagogues){
  let id=Auth.activeSynagogueId();
  if(!synagogues.some(s=>s._id===id)){id=synagogues[0]?synagogues[0]._id:null;Auth.setActiveSynagogueId(id)}
  if(id!==sid||!unsubscribe) subscribe(id);
}
// תוצאת חיפוש (js/menu.js, SiteGo): "tx:<id>" עובר ללשונית של הרישום ומסמן את השורה שלו (עם עריכה ומחיקה).
// רישום שאין לו שורה עם פעולות (הוצאה) נפתח בחלון העריכה
if(window.SiteGo)SiteGo.on("tx",async id=>{
  await SiteGo.waitFor(()=>stage==="ready");
  const t=txs.find(x=>x.id===id);if(!t)return;
  if(!isManager()){render();const row=$("#view").querySelector(`[data-tx="${id}"]`);if(row)SiteGo.flash(row);return}
  tab={donation:"donations",mitzvah:"donations",petty:"petty",pettyIn:"petty",salary:"salary"}[t.type]||"home";
  ui.donView="list";ui.donFilter="all";render();
  const b=$("#view").querySelector(`[data-edit="${id}"]`);
  if(b)SiteGo.flash(b);else openForm(null,t);
});
render();
(async()=>{
  try{await Auth.completeSignInFromRedirect()}catch(e){console.warn(e);toast("ההתחברות נכשלה. נסו שוב.")}
  Auth.onChange(()=>load());
  await load();
})();
})();
