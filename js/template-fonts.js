/** השלמת גופנים חסרים בעורך התבנית (חלק מ-js/template-ui.js שפוצל) */

import { fontsToFill, fontLabel, isUnnamed, canReadLocalFonts, isPhone, localFontsPermission, fillFromLocal, fillFromFile } from './font-fill.js';
import { $, st } from './template-state.js';
import { schedulePreviewRefresh } from './template-build.js';

/**
 * כל הגופנים שבקובץ, גם אלה שאף אזור לא כתוב בהם כרגע: הגבאי יכול לבחור כל אחד מהם לאזור טקסט,
 * ולכן מציעים להשלים את האותיות בכולם
 */
const fileFonts = () => st.fonts;

/** הודעה כשבגופן המוטמע חסרות אותיות, עם אפשרות להשלים אותן מהמחשב או מקובץ גופן */
export function renderFontFill(done) {
  const need = fontsToFill(fileFonts()), phone = isPhone();
  const box = $('tplFontFill');
  box.hidden = !need.length && !done;
  if (box.hidden) return;
  // האותיות החסרות לכל גופן בנפרד: "David: צ ץ; Arial: ף"
  const byFamily = new Map();
  for (const [, f, m] of need) byFamily.set(fontLabel(f), new Set([...(byFamily.get(fontLabel(f)) || []), ...m]));
  const list = [...byFamily].map(([name, m]) => name + ': ' + [...m].join(' ')).join('; ');
  $('tplFontMsg').textContent = (done ? done + ' ' : '') + (need.length
    ? 'בגופנים שבקובץ חסרות אותיות (' + list + '), ולכן הן ייכתבו בגופן דומה. ' +
      (need.some(([, f]) => isUnnamed(f) && !f.realName)
        ? 'כשהקובץ לא שומר את שם הגופן, האתר מזהה אותו לפי צורת האותיות. ' : '') +
      // בטלפון אין גישה לגופנים שבמכשיר, ולרוב גם אין קובץ גופן להעלות – רק מפנים למחשב
      (phone
        ? 'אם הגופן מותקן במחשב, כדאי להשלים ממנו את האותיות: פותחים את "עריכת התבנית" במחשב עם Chrome או Edge ' +
          'ולוחצים "השלמה מהגופנים שבמחשב". אחרי השמירה הלוח ייראה תקין בכל מכשיר.'
        : canReadLocalFonts()
          ? 'אם הגופן מותקן במחשב שלך או שיש לך קובץ שלו, אפשר להשלים ממנו את האותיות ולשמור אותן בתבנית.'
          : 'אפשר להשלים אותן מקובץ של הגופן, או בקלות יותר בדפדפן Chrome או Edge במחשב שהגופן מותקן בו: ' +
            'פותחים שם את "עריכת התבנית" ולוחצים "השלמה מהגופנים שבמחשב".')
    : '');
  $('tplFontLocal').hidden = !need.length || phone || !canReadLocalFonts();
  $('tplFontUpload').hidden = !need.length || phone;
}

/**
 * הדפדפן מבקש אישור לגופנים שבמחשב בחלון משלו, שאי אפשר לעצב. לכן לפני הבקשה מסבירים בהודעה של האתר מה עומד לקרות,
 * וכשהגישה נחסמה – מסבירים איך לאשר אותה, בלי לפנות לדפדפן שוב. מחזיר true אם אפשר לבקש את הגופנים
 */
async function askLocalFonts() {
  const state = await localFontsPermission();
  if (state === 'granted') return true;
  if (state === 'denied') {
    await SiteDialog.alert('הגישה לגופנים שבמחשב חסומה בדפדפן. כדי לאשר אותה: לוחצים על הסמל שמשמאל לכתובת האתר, ' +
      'בוחרים "הגדרות אתר" ומאשרים "גופנים". אפשר גם להעלות קובץ גופן.');
    return false;
  }
  return SiteDialog.confirm('כדי להשלים את האותיות, האתר צריך לקרוא את הגופנים שמותקנים במחשב. ' +
    'הדפדפן יבקש עכשיו אישור – לוחצים "אישור" או "Allow". הגופנים נקראים רק במחשב שלך, ורק האותיות החסרות נשמרות בתבנית.',
  { ok: 'המשך' });
}

$('tplFontLocal').onclick = async () => {
  const btn = $('tplFontLocal');
  let res;
  if (!(await askLocalFonts())) return;
  // זיהוי גופן בלי שם סורק את כל הגופנים שבמחשב, וזה לוקח כמה שניות
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'מחפש את הגופנים במחשב…';
  try { res = await fillFromLocal(fileFonts()); }
  catch (e) {
    console.warn('אין גישה לגופנים שבמחשב', e);
    SiteDialog.alert('לא התקבלה גישה לגופנים שבמחשב. אפשר לאשר את הגישה בהגדרות האתר בדפדפן, או להעלות קובץ גופן.');
    return;
  } finally { btn.disabled = false; btn.textContent = label; }
  // הסבר נפרד לכל סיבה: לא נמצא, נמצא בפורמט שלא נקרא (Type 1 ב-Linux), בלי עברית, או בלי חיבור
  const WHY = {
    format: x => 'הגופן ' + x.family + ' נמצא במחשב (' + x.file + '), אבל הוא שמור בפורמט ישן שהאתר לא יודע לקרוא. אפשר להעלות קובץ ‎.ttf או ‎.otf שלו.',
    noHebrew: x => 'הגופן ' + x.file + ' שנמצא במחשב לא כולל אותיות עבריות.',
    network: () => 'לא ניתן לטעון את רכיב קריאת הגופנים. בדקו את החיבור לאינטרנט ונסו שוב.'
  };
  const problems = [...new Set([
    ...[...new Set(res.notFound)].map(n => 'הגופן ' + n + ' לא נמצא במחשב. אפשר להעלות קובץ גופן.'),
    ...[...new Set(res.unknown)].map(n => 'לא נמצא במחשב גופן שהאותיות שלו זהות ל' + n + '. אפשר להעלות קובץ גופן.'),
    ...res.failed.map(x => (WHY[x.why] || WHY.format)(x))
  ])];
  // העמוד בעורך מצויר מחדש, כדי שהאותיות שהושלמו ייראו מיד
  if (res.filled.length) { renderFontFill('הושלמו האותיות מהגופן ' + [...new Set(res.filled)].join(', ') + '.'); schedulePreviewRefresh(); }
  if (problems.length) SiteDialog.alert(problems.join('\n'));
};
$('tplFontUpload').onclick = () => {
  // באפליקציה ה-accept הופך לסוגי MIME, ובהרבה מכשירים קובצי גופן מסומנים application/octet-stream ולא מופיעים לבחירה.
  // סוג הקובץ נבדק ממילא בקריאת הגופן (fillFromFile).
  if (window.NativeFiles && NativeFiles.isApp()) $('tplFontFile').removeAttribute('accept');
  $('tplFontFile').click();
};
$('tplFontFile').onchange = async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    renderFontFill('הושלמו האותיות מהגופן ' + (await fillFromFile(fileFonts(), file)).join(', ') + '.');
    schedulePreviewRefresh();
  }
  catch (err) { SiteDialog.alert(err.message || 'לא ניתן לקרוא את קובץ הגופן.'); }
};

