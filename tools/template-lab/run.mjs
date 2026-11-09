// מעבדת תבניות: מחולל תבניות סינתטיות של בתי כנסת (layouts.mjs) ומריץ כל אחת במצבים חריגים, לבדיקה בעין.
// הרצה: npm i --no-save @napi-rs/canvas && node tools/template-lab/run.mjs [שם תבנית...]  (התמונות ב-template-lab-out, או OUT=...)
// הגופנים: DejaVu מ-/usr/share/fonts (לינוקס) רשומים בשמות של הגופנים החלופיים
import { createCanvas, Image, GlobalFonts, ImageData } from '@napi-rs/canvas';
import fs from 'fs';
import { layouts } from './layouts.mjs';
globalThis.ImageData = ImageData;
globalThis.atob = s => Buffer.from(s, 'base64').toString('binary');
globalThis.document = { createElement: () => createCanvas(1, 1), fonts: { add() {}, load: async () => [] } };
globalThis.Image = class { set src(v) { const i = new Image(); i.onload = () => { this.naturalWidth = i.width; this.naturalHeight = i.height; this._i = i; this.onload(); }; i.src = Buffer.from(v.split(',')[1], 'base64'); } };
const proto = Object.getPrototypeOf(createCanvas(1,1).getContext('2d'));
const di = proto.drawImage;
proto.drawImage = function (img, ...a) { return di.call(this, img && img._i ? img._i : img, ...a); };
const { templateCanvas } = await import(new URL('../../js/template-render.js', import.meta.url).href);
// ערכים: כל שעה שבתבנית מקבלת שעה חדשה
const base = tpl => {
  const v = { rules: {}, zmanim: {}, parashaName: 'וישלח', parasha: 'פרשת וישלח', special: '', address: 'רחוב הרצל 12, רמת גן', edits: {}, hebDay: 20766, firstDay: 20766 };
  let h = 5;
  for (const s of tpl.slots) {
    const t = (h++ % 24) + ':' + String((h * 7) % 60).padStart(2, '0');
    if (s.kind === 'rule') v.rules[s.when + '|' + s.name] = t;
    if (s.kind === 'zman') (v.zmanim[s.when] ||= {})[s.zman] = t;
    if (s.kind === 'kiddush') v.rules[s.when + '|' + s.name] = 'קידוש לאחר התפילה';
  }
  return v;
};
const firstRule = tpl => tpl.slots.find(s => s.kind === 'rule' && s.when === 'כל יום');
const S = {
  plain: v => v,
  wide: v => { for (const k in v.rules) if (!/קידוש/.test(k)) v.rules[k] = '10:45'; return v; },
  missing: (v, t) => { const s = firstRule(t); delete v.rules[s.when + '|' + s.name]; return v; },
  kidFull: (v, t) => { const s = t.slots.find(s => s.kind === 'kiddush'); if (s) v.rules[s.when + '|' + s.name] = 'קידוש והתוועדות לאחר התפילה\nע"י משפחת אברהמי ומשפחת יצחקי\nלרגל בר המצווה של נכדם\nולרגל הולדת הנכדה'; return v; },
  special: v => (v.special = 'שבת מברכים חודש כסלו', v.parashaName = 'אחרי מות-קדושים', v.parasha = 'פרשת אחרי מות-קדושים', v),
  missingRight: v => { delete v.rules['כניסה|מנחה ערב שבת']; return v; },
  emptyText: (v, t) => { for (const s of t.slots) if (s.kind === 'text') v.edits['text|' + Math.round(s.box.x) + ',' + Math.round(s.box.y)] = ''; return v; },
};
const only = process.argv.slice(2);
const OUT = process.env.OUT || 'template-lab-out';
fs.mkdirSync(OUT, { recursive: true });
for (const [ln, mk] of Object.entries(layouts)) {
  if (only.length && !only.includes(ln)) continue;
  const tpl = mk();
  fs.writeFileSync(OUT + '/' + ln + '-src.jpg', Buffer.from(tpl.image.split(',')[1], 'base64'));
  for (const [sn, fn] of Object.entries(S)) {
    try {
      const c = await templateCanvas(tpl, fn(base(tpl), tpl));
      const o = createCanvas(c.width / 2, c.height / 2); o.getContext('2d').drawImage(c, 0, 0, c.width / 2, c.height / 2);
      fs.writeFileSync(OUT + '/' + ln + '-' + sn + '.jpg', o.toBuffer('image/jpeg'));
    } catch (e) { console.log('ERR', ln, sn, e.stack.split('\n').slice(0, 3).join(' | ')); }
  }
  console.log('done', ln);
}
