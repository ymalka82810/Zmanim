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

// ---------- state & storage ----------
let txs=[]; let settings={synName:"קופת בית הכנסת",openMain:0,openPetty:0,israel:1};
let db=null, downloads=null, mode="local";
const LS="gabbai-fallback-v1";
function loadLocal(){try{const j=JSON.parse(localStorage.getItem(LS)||"null");if(j){txs=j.txs||[];settings=Object.assign(settings,j.settings||{})}}catch(e){}}
function saveLocal(){try{localStorage.setItem(LS,JSON.stringify({txs,settings}))}catch(e){}}
async function putTx(obj){
  if(mode==="db"){
    const ref=obj.id?db.collection("tx").doc(obj.id):db.collection("tx").doc();
    const body=Object.assign({},obj);delete body.id;
    await ref.set(body);
  }else{
    if(!obj.id){obj.id="l"+Date.now().toString(36)+Math.random().toString(36).slice(2,6);txs.push(obj)}
    else{const i=txs.findIndex(t=>t.id===obj.id);if(i>=0)txs[i]=obj}
    saveLocal();render();
  }
}
async function delTx(id){
  if(mode==="db"){await db.collection("tx").doc(id).delete()}
  else{txs=txs.filter(t=>t.id!==id);saveLocal();render()}
}
async function putSettings(s){
  settings=Object.assign(settings,s);hcache.clear();
  if(mode==="db"){await db.doc("settings/main").set(settings)}else{saveLocal()}
  render();
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
    <button class="btn ghost" id="csv">הורדת הדוח (CSV לאקסל)</button>
  </div>
  <div class="status">${esc(heb(ui.from).heb)} – ${esc(heb(ui.to).heb)}</div>
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
    ${list.map(t=>`<tr><td>${dateCell(t.date)}</td><td><b>${esc(t.name||"")}</b></td><td>${esc(t.type==="mitzvah"?t.mitzvah:"תרומה")}<span class="sub">${esc(t.desc||"")}</span></td><td class="num">${money(t.amount)}</td>
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

function render(){
  const t=todayIso(), h=heb(t);
  $("#synName").textContent=settings.synName||"קופת בית הכנסת";
  $("#todayParsha").textContent=h.parsha||"קופת בית הכנסת";
  $("#todayDates").innerHTML=`<b>${esc(h.heb)}</b> · ${esc(gLong.format(new Date()))}`;
  document.querySelectorAll("nav.tabs button").forEach(b=>b.setAttribute("aria-selected",b.dataset.tab===tab));
  const v={home:viewHome,ledger:viewLedger,donations:viewDonations,petty:viewPetty,salary:viewSalary}[tab]();
  $("#view").innerHTML=v+(mode==="local"?`<div class="status">הנתונים נשמרים בדפדפן זה בלבד.</div>`:"");
  const names=[...new Set(txs.filter(x=>x.name).map(x=>x.name))];
  $("#donorList").innerHTML=names.map(n=>`<option value="${esc(n)}">`).join("");
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
  if(t){for(const k of ["amount","date","name","desc","method","mitzvah","month","category","vendor","paidDate"]) if(form[k]&&t[k]!=null) form[k].value=t[k]; form.paid.checked=!!t.paid}
  else form.date.value=todayIso();
  setType(t?t.type:(type||"donation"));
  dlg.showModal();
}
form.addEventListener("click",e=>{const b=e.target.closest("#typePick button");if(b)setType(b.dataset.t);if(e.target.closest("[data-close]"))dlg.close()});
form.paid.addEventListener("change",syncPaid);
form.date.addEventListener("input",hint);form.paidDate.addEventListener("input",hint);
form.addEventListener("submit",async e=>{
  e.preventDefault();
  const amount=parseFloat(form.amount.value);
  if(!(amount>0)){form.amount.focus();toast("יש להזין סכום גדול מאפס");return}
  if(!form.date.value){form.date.focus();return}
  const prev=editId?txs.find(x=>x.id===editId):null;
  const o={type:curType,amount,date:form.date.value,desc:form.desc.value.trim(),createdAt:prev?prev.createdAt:Date.now()};
  if(editId)o.id=editId;
  if(curType==="donation"||curType==="mitzvah"){o.name=form.name.value.trim();o.method=form.method.value;if(curType==="mitzvah")o.mitzvah=form.mitzvah.value}
  if(curType==="salary")o.month=form.month.value.trim();
  if(curType==="expense"||curType==="petty"){o.category=form.category.value;o.vendor=form.vendor.value.trim()}
  if(isIncome(o)){o.paid=form.paid.checked;o.paidDate=o.paid?(form.paidDate.value||o.date):""}
  const btn=$("#saveBtn");btn.disabled=true;
  try{await putTx(o);dlg.close();toast("נשמר")}catch(err){toast("השמירה נכשלה. נסו שוב.")}
  btn.disabled=false;
});

// ---------- settings ----------
const sdlg=$("#setDlg"), sform=$("#setForm");
$("#openSettings").onclick=()=>{sform.synName.value=settings.synName||"";sform.openMain.value=settings.openMain||0;sform.openPetty.value=settings.openPetty||0;sform.israel.value=settings.israel?"1":"0";sdlg.showModal()};
sform.addEventListener("click",e=>{if(e.target.closest("[data-close]"))sdlg.close()});
sform.addEventListener("submit",async e=>{e.preventDefault();try{await putSettings({synName:sform.synName.value.trim(),openMain:parseFloat(sform.openMain.value)||0,openPetty:parseFloat(sform.openPetty.value)||0,israel:sform.israel.value==="1"?1:0});sdlg.close();toast("ההגדרות נשמרו")}catch(err){toast("השמירה נכשלה")}});

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
  if(b.dataset.del){const t=txs.find(x=>x.id===b.dataset.del);if(t&&confirm(`למחוק את הרישום "${label(t)}" על סך ${money(t.amount)}?`)){try{await delTx(t.id);toast("נמחק")}catch(err){toast("המחיקה נכשלה")}}return}
  if(b.dataset.pay){const t=txs.find(x=>x.id===b.dataset.pay);if(t){try{await putTx(Object.assign({},t,{paid:true,paidDate:todayIso()}));toast("סומן כשולם")}catch(err){toast("העדכון נכשל")}}return}
  if(b.id==="csv") return exportCsv();
});
$("#view").addEventListener("change",e=>{if(e.target.id==="lf"){ui.from=e.target.value;render()}if(e.target.id==="lt"){ui.to=e.target.value;render()}});

async function exportCsv(){
  const s=statement(ui.acct,ui.from,ui.to);
  const q=v=>'"'+String(v==null?"":v).replace(/"/g,'""')+'"';
  const lines=[["תאריך לועזי","תאריך עברי","פרשת השבוע","סוג","פרטים","זכות","חובה","יתרה"].map(q).join(",")];
  lines.push(["","","","יתרת פתיחה","","","",s.opening.toFixed(2)].map(q).join(","));
  for(const r of s.rows){const h=heb(r.date);lines.push([gFmt.format(parseIso(r.date)),h.heb,h.parsha,label(r.t),descOf(r.t),r.cr?r.cr.toFixed(2):"",r.dr?r.dr.toFixed(2):"",r.bal.toFixed(2)].map(q).join(","))}
  lines.push(["","","","סה״כ","",s.cr.toFixed(2),s.dr.toFixed(2),s.closing.toFixed(2)].map(q).join(","));
  const name=(ui.acct==="main"?"דוח-עוש":"דוח-קופה-קטנה")+`_${ui.from||"התחלה"}_${ui.to||"היום"}.csv`;
  const data="\uFEFF"+lines.join("\r\n");
  if(downloads){try{await downloads.save({filename:name,data})}catch(err){if(err&&err.code!=="declined")toast("ההורדה לא זמינה כרגע")}return}
  const url=URL.createObjectURL(new Blob([data],{type:"text/csv;charset=utf-8"}));
  const a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

// ---------- boot ----------
loadLocal();render();
(async()=>{
  if(!window.claude||!window.claude.use) return;
  try{downloads=await window.claude.use("downloads")}catch(e){}
  try{db=await window.claude.use("db")}catch(e){db=null}
  if(!db){render();return}
  mode="db";txs=[];render();
  db.doc("settings/main").onSnapshot(s=>{if(s.exists){settings=Object.assign({},settings,s.data());hcache.clear();render()}},()=>{});
  db.collection("tx").onSnapshot(snap=>{txs=snap.docs.map(d=>Object.assign({id:d.id},d.data()));render()},
    err=>{if(err&&err.code==="revoked"){mode="local";loadLocal();render()}});
})();
})();
