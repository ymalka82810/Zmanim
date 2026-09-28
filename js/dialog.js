/* חלון הודעה ואישור משותף לכל דפי האתר, במקום alert ו-confirm של הדפדפן.
 * SiteDialog.confirm(text, {ok, cancel, danger}) מחזיר Promise<boolean>.
 * SiteDialog.alert(text, {ok}) מחזיר Promise שמתממש כשסוגרים את החלון.
 * החלון הוא <dialog> מודאלי, כך שהוא מופיע גם מעל חלונות אחרים שפתוחים בדף.
 */
(function(){
"use strict";
const css = `
.sd{border:0;border-radius:18px;padding:0;width:min(400px,calc(100vw - 32px));max-width:none;max-height:none;background:#fffdf9;color:#202a3f;box-shadow:0 18px 40px rgba(24,32,54,.22);font-family:"Assistant",Arial,sans-serif;direction:rtl}
.sd::backdrop{background:rgba(10,16,32,.5)}
.sd[open]{animation:sd-in .16s ease-out}
@keyframes sd-in{from{opacity:0;transform:translateY(8px) scale(.98)}}
.sd-body{padding:22px 22px 6px;font-size:1.05rem;line-height:1.6;white-space:pre-line;overflow-wrap:anywhere}
.sd-actions{display:flex;flex-wrap:wrap;justify-content:flex-start;gap:8px;padding:16px 22px 20px}
.sd-actions button{min-width:88px;padding:10px 18px;border-radius:12px;font:inherit;font-weight:700;font-size:1rem;cursor:pointer}
.sd-ok{border:1px solid #1e3a63;background:#1e3a63;color:#fff}
.sd-ok:hover{background:#35588f;border-color:#35588f}
.sd-ok.sd-danger{background:#a33a3a;border-color:#a33a3a}
.sd-ok.sd-danger:hover{background:#8c2f2f;border-color:#8c2f2f}
.sd-cancel{border:1px solid #e2dcc9;background:none;color:#3c4863}
.sd-cancel:hover{background:#efe8d6}
.sd button:focus-visible{outline:3px solid #ab7f2e;outline-offset:2px}
:root[data-theme="dark"] .sd{background:#161d30;color:#e9ecf5;box-shadow:0 18px 40px rgba(0,0,0,.5)}
:root[data-theme="dark"] .sd-ok{background:#8fb0ec;border-color:#8fb0ec;color:#0c1120}
:root[data-theme="dark"] .sd-ok:hover{background:#b6cdf5;border-color:#b6cdf5}
:root[data-theme="dark"] .sd-ok.sd-danger{background:#f08c80;border-color:#f08c80;color:#0c1120}
:root[data-theme="dark"] .sd-cancel{border-color:#2a3252;color:#c3cadf}
:root[data-theme="dark"] .sd-cancel:hover{background:#202a48}
:root[data-theme="dark"] .sd button:focus-visible{outline-color:#dfb564}
@media print{.sd{display:none!important}}
`;
let styled = false;

function open(text, opts, withCancel){
  if (!styled){
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    styled = true;
  }
  const dlg = document.createElement('dialog');
  dlg.className = 'sd';
  dlg.innerHTML = '<div class="sd-body"></div><div class="sd-actions"><button type="button" class="sd-ok"></button></div>';
  dlg.querySelector('.sd-body').textContent = text;
  const ok = dlg.querySelector('.sd-ok');
  ok.textContent = opts.ok || 'אישור';
  if (opts.danger) ok.classList.add('sd-danger');
  let cancel = null;
  if (withCancel){
    cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'sd-cancel';
    cancel.textContent = opts.cancel || 'ביטול';
    dlg.querySelector('.sd-actions').appendChild(cancel);
  }
  document.body.appendChild(dlg);

  return new Promise(resolve => {
    let result = false;
    ok.onclick = () => { result = true; dlg.close(); };
    if (cancel) cancel.onclick = () => dlg.close();
    // Escape סוגר את החלון, וזה נחשב ביטול
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    dlg.showModal();
    // בפעולה שמוחקת משהו הפוקוס על "ביטול", כדי ש-Enter לא ימחק בטעות
    (opts.danger && cancel ? cancel : ok).focus();
  });
}

window.SiteDialog = {
  confirm: (text, opts) => open(text, opts || {}, true),
  alert: (text, opts) => open(text, opts || {}, false).then(() => {})
};
})();
