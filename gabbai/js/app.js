(function(){
"use strict";
// ---------- helpers ----------
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const nf=new Intl.NumberFormat("he-IL",{minimumFractionDigits:2,maximumFractionDigits:2});
const money=n=>"₪"+nf.format(Number(n)||0);
const pad=n=>String(n).padStart(2,"0");
const iso=d=>d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const todayIso=()=>iso(new Date());
const parseIso=s=>{const [y,m,d]=String(s).split("-").map(Number);return new Date(y,(m||1)-1,d||1)};
const gFmt=new Intl.DateTimeFormat("he-IL",{day:"numeric",month:"numeric",year:"numeric"});
const gLong=new Intl.DateTimeFormat("he-IL",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
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
let members=[], role=null, sid=null, stage="loading", ledgerError="", notifications=[];
const isManager=()=>role==="gabbai"||role==="rabbi";
const LS="gabbai-fallback-v1";
function errText(e,fallback){return (e&&typeof e.data==="string")?e.data:fallback}
const call=(name,args)=>Auth.client().mutation(name,Object.assign({synagogueId:sid},args));
const TX_KEYS=["type","amount","date","name","desc","method","mitzvah","month","category","vendor","paid","paidDate","createdAt"];
async function putTx(obj){
  const body={};for(const k of TX_KEYS) if(obj[k]!==undefined) body[k]=obj[k];
  body.donorId=obj.donorId||null;
  if(obj.id) body.id=obj.id;
  await call("fund:save",body);
}
async function delTx(id){await call("fund:remove",{id})}
async function markPaid(id){await call("fund:markPaid",{id,paidDate:todayIso()})}
async function putSettings(s){await call("fund:saveSettings",{openMain:s.openMain,openPetty:s.openPetty})}
async function pledgeMine(o){await call("fund:pledgeMine",o)}
async function markFundRead(){await call("fund:markNotificationsRead",{})}

function localData(){try{const j=JSON.parse(localStorage.getItem(LS)||"null");return j&&Array.isArray(j.txs)&&j.txs.length?j:null}catch(e){return null}}
async function importLocal(){
  const j=localData();if(!j)return;
  if(!confirm(`להעביר ${j.txs.length} רישומים שנשמרו בדפדפן הזה לקופה של ${settings.synName}?`))return;
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
function balance(account,upto){
  let b=Number(account==="main"?settings.openMain:settings.openPetty)||0;
  for(const m of moves(account)){if(upto&&m.date>upto)break;b+=m.cr-m.dr}
  return b;
}
function sum(arr,f){return arr.reduce((s,x)=>s+(Number(f(x))||0),0)}

// ---------- views ----------
let tab="home"; const ui={from:"",to:"",acct:"main",donView:"list",donFilter:"all"};
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
  return `
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
  let bal=from?balance(acct,dayBefore):(Number(acct==="main"?settings.openMain:settings.openPetty)||0);
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
    ${list.map(t=>`<tr><td>${dateCell(t.date)}</td><td><b>${esc(t.name||"")}</b>${t.donorId?`<span class="sub">חבר קהילה</span>`:""}</td><td>${esc(t.type==="mitzvah"?t.mitzvah:"תרומה")}<span class="sub">${esc(t.desc||"")}</span></td><td class="num">${money(t.amount)}</td>
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

function viewMine(){
  const list=[...txs].sort((a,b)=>a.date<b.date?1:-1);
  const paid=list.filter(t=>t.paid), open=list.filter(t=>!t.paid);
  const unread=notifications.filter(n=>!n.read);
  const reminders=unread.length?`<div class="panel" style="padding:12px;margin-bottom:14px;border-inline-start:4px solid var(--out)">
    <b>תזכורות תשלום</b>
    ${unread.map(n=>`<div class="sub" style="margin-top:6px">${esc(n.text)}</div>`).join("")}
    <div style="margin-top:8px"><button class="btn ghost" id="markFundRead">סימון כנקרא</button></div>
  </div>`:"";
  return `${reminders}<h2>התרומות שלי</h2>
  <div class="balances">
    <div class="bal main"><div class="k">סה״כ שולם</div><div class="v">${money(sum(paid,t=>t.amount))}</div></div>
    <div class="bal owed"><div class="k">נדרים שטרם שולמו (${open.length})</div><div class="v">${money(sum(open,t=>t.amount))}</div></div>
  </div>
  <div class="bar" style="margin-top:14px"><button class="btn" id="pledgeBtn">רישום חיוב חדש</button></div>
  <div class="panel scroll" style="margin-top:14px"><table><thead><tr><th>תאריך</th><th>מה</th><th class="num">סכום</th><th>סטטוס</th></tr></thead><tbody>
    ${list.map(t=>`<tr><td>${dateCell(t.date)}</td><td>${esc(t.type==="mitzvah"?"מכירת מצווה: "+t.mitzvah:"תרומה")}<span class="sub">${esc(t.desc||"")}</span></td><td class="num">${money(t.amount)}</td>
    <td>${t.paid?`<span class="pill ok">שולם</span><span class="sub">${t.paidDate?esc(gFmt.format(parseIso(t.paidDate))):""} ${esc(t.method||"")}</span>`:`<span class="pill no">לא שולם</span>`}</td></tr>`).join("")}
    ${list.length?"":`<tr><td colspan="4" class="empty">עדיין לא נרשמו תרומות על שמך.</td></tr>`}
  </tbody></table></div>
  <div class="status">מוצגות כאן התרומות והמצוות שנרשמו על שמך, בין אם על ידי הגבאי ובין אם על ידך.</div>`;
}
function viewMessage(text,button){return `<div class="empty" style="margin-top:40px">${text}${button?`<div style="margin-top:14px">${button}</div>`:""}</div>`}

function render(){
  const t=todayIso(), h=heb(t), ready=stage==="ready", manager=ready&&isManager();
  $("#synName").textContent=ready?settings.synName:"קופת בית הכנסת";
  $("#todayParsha").textContent=h.parsha||"קופת בית הכנסת";
  $("#todayDates").innerHTML=`<b>${esc(h.heb)}</b> · ${esc(gLong.format(new Date()))}`;
  document.querySelector("nav.tabs").hidden=!manager;
  $("#addBtn").hidden=!manager;
  $("#openSettings").hidden=!manager;
  if(stage==="loading"){$("#view").innerHTML=viewMessage("טוען…");return}
  if(stage==="signedOut"){$("#view").innerHTML=viewMessage("כדי לראות את הקופה יש להתחבר עם חשבון Google.",`<button class="btn" id="signIn">כניסה עם Google</button>`);return}
  if(stage==="noCommunity"){$("#view").innerHTML=viewMessage("עדיין לא הצטרפת לקהילה.",`<a class="btn" href="../account/">לחשבון שלי</a>`);return}
  if(stage==="error"){$("#view").innerHTML=viewMessage(esc(ledgerError),`<a class="btn" href="../account/">לחשבון שלי</a>`);return}
  if(!manager){$("#view").innerHTML=viewMine();return}
  document.querySelectorAll("nav.tabs button").forEach(b=>b.setAttribute("aria-selected",b.dataset.tab===tab));
  const v={home:viewHome,ledger:viewLedger,donations:viewDonations,petty:viewPetty,salary:viewSalary}[tab]();
  const local=localData();
  $("#view").innerHTML=(local?`<div class="panel" style="padding:12px;margin-top:14px">נמצאו בדפדפן הזה ${local.txs.length} רישומי קופה מהגרסה הקודמת. <button class="btn" id="importLocal">העברה לקופת הקהילה</button></div>`:"")+v;
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
function syncPaid(){const on=form.paid.checked&&["donation","mitzvah","salary"].includes(curType);$("#paidDateWrap").hidden=!on;if(on&&!form.paidDate.value)form.paidDate.value=form.date.value||todayIso();hint()}
function hint(){
  const a=heb(form.date.value);$("#dateHint").textContent=form.date.value?`${a.heb} · ${a.parsha}`:"";
  const b=heb(form.paidDate.value);$("#paidHint").textContent=form.paidDate.value?`${b.heb} · ${b.parsha}`:"";
}
function openForm(type,t){
  form.reset();editId=t?t.id:null;
  $("#dlgTitle").textContent=t?"עריכת רישום":"רישום חדש";
  $("#typePick").hidden=!!t;
  if(t){for(const k of ["amount","date","name","desc","method","mitzvah","month","category","vendor","paidDate"]) if(form[k]&&t[k]!=null&&t[k]!=="") form[k].value=t[k]; form.paid.checked=!!t.paid; form.donor.value=t.donorId||""}
  else form.date.value=todayIso();
  setType(t?t.type:(type||"donation"));
  dlg.showModal();
}
form.addEventListener("click",e=>{const b=e.target.closest("#typePick button");if(b)setType(b.dataset.t);if(e.target.closest("[data-close]"))dlg.close()});
form.paid.addEventListener("change",syncPaid);
form.donor.addEventListener("change",()=>{const m=members.find(x=>x.userId===form.donor.value);if(m)form.name.value=m.name});
form.date.addEventListener("input",hint);form.paidDate.addEventListener("input",hint);
form.addEventListener("submit",async e=>{
  e.preventDefault();
  const amount=parseFloat(form.amount.value);
  if(!(amount>0)){form.amount.focus();toast("יש להזין סכום גדול מאפס");return}
  if(!form.date.value){form.date.focus();return}
  const prev=editId?txs.find(x=>x.id===editId):null;
  const o={type:curType,amount,date:form.date.value,desc:form.desc.value.trim(),createdAt:prev?prev.createdAt:Date.now()};
  if(editId)o.id=editId;
  if(curType==="donation"||curType==="mitzvah"){o.name=form.name.value.trim();o.donorId=form.donor.value||null;o.method=form.method.value;if(curType==="mitzvah")o.mitzvah=form.mitzvah.value}
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

// ---------- settings ----------
const sdlg=$("#setDlg"), sform=$("#setForm");
$("#openSettings").onclick=()=>{sform.openMain.value=settings.openMain||0;sform.openPetty.value=settings.openPetty||0;sdlg.showModal()};
sform.addEventListener("click",e=>{if(e.target.closest("[data-close]"))sdlg.close()});
sform.addEventListener("submit",async e=>{e.preventDefault();try{await putSettings({openMain:parseFloat(sform.openMain.value)||0,openPetty:parseFloat(sform.openPetty.value)||0});sdlg.close();toast("ההגדרות נשמרו")}catch(err){toast(errText(err,"השמירה נכשלה"))}});

// ---------- events ----------
document.querySelector("nav.tabs").addEventListener("click",e=>{const b=e.target.closest("button[data-tab]");if(b){tab=b.dataset.tab;render();window.scrollTo(0,0)}});
$("#addBtn").onclick=()=>openForm(tab==="petty"?"petty":tab==="salary"?"salary":"donation");
$("#view").addEventListener("click",async e=>{
  const b=e.target.closest("button");if(!b)return;
  if(b.dataset.new) return openForm(b.dataset.new);
  if(b.dataset.acct){ui.acct=b.dataset.acct;return render()}
  if(b.dataset.dv){ui.donView=b.dataset.dv;return render()}
  if(b.dataset.df){ui.donFilter=b.dataset.df;return render()}
  if(b.dataset.edit){const t=txs.find(x=>x.id===b.dataset.edit);if(t)openForm(null,t);return}
  if(b.dataset.del){const t=txs.find(x=>x.id===b.dataset.del);if(t&&confirm(`למחוק את הרישום "${label(t)}" על סך ${money(t.amount)}?`)){try{await delTx(t.id);toast("נמחק")}catch(err){toast(errText(err,"המחיקה נכשלה"))}}return}
  if(b.dataset.pay){const t=txs.find(x=>x.id===b.dataset.pay);if(t){try{await markPaid(t.id);toast("סומן כשולם")}catch(err){toast(errText(err,"העדכון נכשל"))}}return}
  if(b.id==="csv") return exportCsv();
  if(b.id==="pdf") return print();
  if(b.id==="importLocal") return importLocal();
  if(b.id==="signIn") return Auth.signInWithGoogle(location.href).catch(()=>toast("ההתחברות נכשלה"));
  if(b.id==="pledgeBtn") return openPledge();
  if(b.id==="markFundRead"){try{await markFundRead()}catch(err){}return}
});
$("#view").addEventListener("change",e=>{if(e.target.id==="lf"){ui.from=e.target.value;render()}if(e.target.id==="lt"){ui.to=e.target.value;render()}});

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
  const url=URL.createObjectURL(new Blob([data],{type:"text/csv;charset=utf-8"}));
  const a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

// ---------- boot ----------
let unsubscribe=null;
function subscribe(id){
  if(unsubscribe){unsubscribe();unsubscribe=null}
  sid=id;
  if(!id){stage="noCommunity";return render()}
  stage="loading";render();
  unsubscribe=Auth.client().onUpdate("fund:ledger",{synagogueId:id},d=>{
    role=d.role;txs=d.txs;members=d.members;notifications=d.notifications||[];
    settings=Object.assign({},settings,d.settings||{},{synName:d.synagogue.name,israel:d.synagogue.il?1:0});
    hcache.clear();stage="ready";render();
  },e=>{console.warn(e);ledgerError=errText(e,"לא ניתן לטעון את הקופה.");stage="error";render()});
}
function signedOut(){if(unsubscribe){unsubscribe();unsubscribe=null}sid=null;stage="signedOut";render()}
async function load(){
  if(!Auth.isAuthenticated()) return signedOut();
  let synagogues=[];
  try{
    const [me,list]=await Promise.all([Auth.client().query("users:me",{}),Auth.client().query("synagogues:mine",{})]);
    if(me===null) return signedOut();
    synagogues=list;
  }catch(e){console.warn(e)}
  let id=Auth.activeSynagogueId();
  if(!synagogues.some(s=>s._id===id)){id=synagogues[0]?synagogues[0]._id:null;Auth.setActiveSynagogueId(id)}
  if(id!==sid||!unsubscribe) subscribe(id);
}
render();
(async()=>{
  try{await Auth.completeSignInFromRedirect()}catch(e){console.warn(e);toast("ההתחברות נכשלה. נסו שוב.")}
  Auth.onChange(()=>load());
  await load();
})();
})();
