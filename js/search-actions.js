/* אינדקס הפעולות וההגדרות של האתר, לחיפוש שבראש התפריט (js/search.js): לכל פעולה – איפה עושים אותה.
 * לחיצה על תוצאה פותחת את הדף, עוברת ללשוניות ולחלונות שבדרך ומסמנת את הכפתור או השדה עצמו (go, ראו SiteGo ב-js/menu.js).
 * הפעולה עצמה לא מתבצעת – רק מגיעים אליה.
 *
 * שדות: title – שם הפעולה; words – מילים נוספות שמובילות אליה; page – נתיב הדף, כמו ב-js/menu.js;
 * go – צעדים (סלקטורים מופרדים ב-|): כולם נלחצים חוץ מהאחרון, שמסומן. {sid} – הקהילה הפעילה;
 * who: 'manager' – רק לגבאי ולרב. פעולה מוצגת רק אם הדף שלה מוצג למשתמש במגירה (תפקיד ופיצ'רים).
 * כשמשנים מזהה או data-act בדף – מעדכנים גם כאן.
 */

const SETTINGS = '#tab-settings|';
const DESIGN = SETTINGS + '[data-pane=design]|';
const EDITOR = DESIGN + '#tplEdit|';

export const ACTIONS = [
  /* ---------- לוח זמנים ---------- */
  { page: '', title: 'שיתוף הלוח כתמונה', words: 'וואטסאפ שליחה', go: '#tab-luach|#shareImg' },
  { page: '', title: 'שיתוף הלוח כ-PDF', words: 'קובץ שליחה', go: '#tab-luach|#sharePdf' },
  { page: '', title: 'הורדת הלוח כ-PDF', words: 'שמירה קובץ', go: '#tab-luach|#downloadPdf' },
  { page: '', title: 'הדפסת הלוח', words: 'מדפסת', go: '#tab-luach|#print' },
  { page: '', title: 'עריכת טקסט בלוח', words: 'שינוי כתוב תיקון', go: '#tab-luach|#luachEdit' },
  { page: '', title: 'הלוח הבא / הקודם', words: 'שבת הבאה מעבר', go: '#tab-luach|#nextOcc' },
  { page: '', title: 'שליחת הלוח לאישור', words: 'פרסום לקהילה', go: '#tab-luach|#submitLuach', who: 'manager' },
  { page: '', title: 'לוחות שממתינים לאישור', words: 'אישור ופרסום דחייה', go: '#tab-luach|#communityFiles', who: 'manager' },
  { page: '', title: 'קבצים ואחסון', words: 'סל המחזור מחיקה לצמיתות שחזור מקום', go: '#tab-luach|#storagePanel > summary', who: 'manager' },
  { page: '', title: 'שם בית הכנסת', words: 'הגדרות', go: SETTINGS + '[data-pane=shul]|#shul' },
  { page: '', title: 'כתובת בית הכנסת', words: 'רחוב', go: SETTINGS + '[data-pane=shul]|#address' },
  { page: '', title: 'עיר ומיקום', words: 'קו רוחב אורך אזור זמן', go: SETTINGS + '[data-pane=shul]|#city' },
  { page: '', title: 'זמן הדלקת נרות', words: 'דקות לפני השקיעה', go: SETTINGS + '[data-pane=shul]|#candle' },
  { page: '', title: 'צאת שבת וחג', words: 'הבדלה רבנו תם מוצאי שבת', go: SETTINGS + '[data-pane=shul]|#havdalah' },
  { page: '', title: 'תבנית חדשה', words: 'הוספת תבנית יצירה', go: SETTINGS + '[data-pane=rules]|#tplList [data-add]' },
  { page: '', title: 'הוספת תפילה או שיעור', words: 'זמני התפילות כלל חדש שעה', go: SETTINGS + '[data-pane=rules]|#addRule' },
  { page: '', title: 'זמני התפילות', words: 'כללים שעות מנחה ערבית שחרית', go: SETTINGS + '[data-pane=rules]|#rules' },
  { page: '', title: 'ייבוא זמני תפילות מתבנית אחרת', words: 'העתקה', go: SETTINGS + '[data-pane=rules]|.imp[data-part=rules] .imp-open' },
  { page: '', title: 'בחירת עיצוב הלוח', words: 'עיצוב מראה סגנון', go: DESIGN + '#layouts' },
  { page: '', title: 'העלאת לוח ישן (PDF או תמונה)', words: 'עיצוב מקובץ סריקה', go: DESIGN + '#tplUpload' },
  { page: '', title: 'עריכת הלוח', words: 'עורך עיצוב', go: DESIGN + '#tplEdit' },
  { page: '', title: 'הסרת העיצוב', words: 'מחיקה', go: DESIGN + '#tplRemove' },
  { page: '', title: 'סימון אזור', words: 'אזור חדש עורך עיצוב החלפה', go: EDITOR + '#tplDraw' },
  { page: '', title: 'עריכת טקסט בעורך העיצוב', words: 'אזור', go: EDITOR + '#tplEditText' },
  { page: '', title: 'הזזת אזורים', words: 'גרירה מיקום עורך', go: EDITOR + '#tplMove' },
  { page: '', title: 'השלמת גופן חסר', words: 'העלאת קובץ גופן עורך', go: EDITOR + '#tplFontUpload' },
  { page: '', title: 'ייבוא עיצוב מתבנית אחרת', words: 'העתקה', go: DESIGN + '.imp[data-part=design] .imp-open' },
  { page: '', title: 'גופן הלוח', words: 'פונט כתב', go: SETTINGS + '[data-pane=font]|#font' },
  { page: '', title: 'ערכת צבעים', words: 'צבע', go: SETTINGS + '[data-pane=font]|#theme' },
  { page: '', title: 'גודל הכתב', words: 'גדלים הגדלה הקטנה כותרת', go: SETTINGS + '[data-pane=font]|#sizes' },
  { page: '', title: 'גודל הדף', words: 'A4 A3 נייר', go: SETTINGS + '[data-pane=font]|#paper' },
  { page: '', title: 'כיוון הדף', words: 'לאורך לרוחב', go: SETTINGS + '[data-pane=font]|#orient' },
  { page: '', title: 'חלוקה לעמודות', words: 'עמודה', go: SETTINGS + '[data-pane=font]|#cols' },
  { page: '', title: 'שמירת ההגדרות בשם', words: 'הגדרות שמורות פרופיל', go: SETTINGS + '[data-pane=backup]|#profileNew' },
  { page: '', title: 'גיבוי הגדרות לקובץ', words: 'שמירת קובץ ייצוא', go: SETTINGS + '[data-pane=backup]|#export' },
  { page: '', title: 'טעינת קובץ הגדרות', words: 'שחזור גיבוי ייבוא', go: SETTINGS + '[data-pane=backup]|#import' },
  { page: '', title: 'איפוס ההגדרות', words: 'מחיקה התחלה מחדש', go: SETTINGS + '[data-pane=backup]|#reset' },

  /* ---------- לוח קידושים ---------- */
  { page: 'kiddush/', title: 'הרשמה לקידוש', words: 'שבת פנויה רישום', go: '[data-act=view][data-v=cal]|.slot:not(.past)' },
  { page: 'kiddush/', title: 'הקידושים שלי', words: 'הרישום שלי', go: '[data-act=view][data-v=mine]|#app .sechead' },
  { page: 'kiddush/', title: 'ביטול רישום לקידוש', words: 'מחיקה הסרה', go: '[data-act=view][data-v=mine]|[data-act=cancelMine]' },
  { page: 'kiddush/', title: 'הנחיות לבעל הקידוש', words: 'תקנון כללים', go: '[data-act=view][data-v=terms]|#app .card' },
  { page: 'kiddush/', title: 'התראות קידוש', words: 'הודעות פעמון', go: '[data-act=notes]' },
  { page: 'kiddush/', title: 'בקשות קידוש לאישור', words: 'אישור דחייה ממתין', go: '[data-act=view][data-v=manage]|#app .card', who: 'manager' },
  { page: 'kiddush/', title: 'עריכת ההנחיות לקידוש', words: 'תקנון', go: '[data-act=view][data-v=manage]|[data-act=editTerms]', who: 'manager' },
  { page: 'kiddush/', title: 'נוסח ההכרזה על הקידוש', words: 'ניסוח כותרת ע״י', go: '[data-act=view][data-v=manage]|[data-act=editWording]', who: 'manager' },
  { page: 'kiddush/', title: 'רישום ידני או חסימת תאריך', words: 'קידוש קהילתי חסימה', go: '[data-act=view][data-v=manage]|.card [data-act=view][data-v=cal]', who: 'manager' },

  /* ---------- יומן קהילה ---------- */
  { page: 'community-calendar/', title: 'הוספת אירוע', words: 'אירוע חדש שיעור שבת קהילתית', go: '[data-act=addEventAny]', who: 'manager' },

  /* ---------- קופה ---------- */
  { page: 'gabbai/', title: 'רישום חדש בקופה', words: 'הוספה תרומה הוצאה', go: '#addBtn', who: 'manager' },
  { page: 'gabbai/', title: 'יתרת פתיחה', words: 'הגדרות קופה', go: '#openSettings', who: 'manager' },
  { page: 'gabbai/', title: 'דוח לאקסל (CSV)', words: 'ייצוא דף חשבון', go: '[data-tab=ledger]|#csv', who: 'manager' },
  { page: 'gabbai/', title: 'דוח PDF', words: 'הדפסה דף חשבון', go: '[data-tab=ledger]|#pdf', who: 'manager' },
  { page: 'gabbai/', title: 'דף חשבון', words: 'עו״ש תנועות יתרה', go: '[data-tab=ledger]|#view table', who: 'manager' },
  { page: 'gabbai/', title: 'תרומות ומצוות', words: 'תורמים רשימה', go: '[data-tab=donations]|#view table', who: 'manager' },
  { page: 'gabbai/', title: 'קופה קטנה', words: 'קניות מילוי', go: '[data-tab=petty]|#view table', who: 'manager' },
  { page: 'gabbai/', title: 'משכורת', words: 'שכר', go: '[data-tab=salary]|#view table', who: 'manager' },
  { page: 'gabbai/', title: 'רישום תרומה שלי', words: 'התחייבות נדר', go: '#pledgeBtn' },

  /* ---------- השבוע שלי ---------- */
  { page: 'week/', title: 'הוספת אזכרה', words: 'יארצייט חדשה', go: '[data-act=addYahrzeit]' },
  { page: 'week/', title: 'אני מגיע למניין', words: 'הרשמה תפילה', go: '[data-act=rsvp]' },
  { page: 'week/', title: 'ניהול תפילות', words: 'מניינים', go: '[data-act=manageMinyan]', who: 'manager' },
  { page: 'week/', title: 'הוספת תפילה למניין', words: 'מניין חדש', go: '[data-act=manageMinyan]|[data-act=addMinyan]', who: 'manager' },

  /* ---------- חלוקת עליות ---------- */
  { page: 'aliyot/', title: 'רישום חיוב לעלייה', words: 'חתן בר מצווה אזכרה', go: '[data-act=addClaim]' },
  { page: 'aliyot/', title: 'כהן, לוי או ישראל', words: 'שבט', go: '#myTribe' },
  { page: 'aliyot/', title: 'מתן עלייה', words: 'רישום עלייה כיבוד', go: '[data-act=view][data-v=day]|[data-act=give]', who: 'manager' },
  { page: 'aliyot/', title: 'היסטוריית עליות', words: 'מי עלה', go: '[data-act=view][data-v=history]|#app .card', who: 'manager' },
  { page: 'aliyot/', title: 'מכרז עליות', words: 'מכירה פומבית הצעת מחיר', go: '[data-act=view][data-v=auction]|#app .au-grid, #app .card' },
  { page: 'aliyot/', title: 'פתיחת מכרז על עלייה', words: 'מכירה פומבית כיבוד חדש', go: '[data-act=view][data-v=auction]|[data-act=auAdd]', who: 'manager' },
  { page: 'aliyot/', title: 'כהנים ולויים', words: 'שבט', go: '[data-act=view][data-v=tribes]|#app .card', who: 'manager' },

  /* ---------- החשבון שלי ---------- */
  { page: 'account/', title: 'יציאה מהחשבון', words: 'התנתקות', go: '#btnSignOut' },
  { page: 'account/', title: 'פתיחת קהילה חדשה', words: 'יצירה', go: '#btnNewSyn' },
  { page: 'account/', title: 'פרטי הקהילה', words: 'שם עיר', go: '[data-open="{sid}"]|#editSynForm', who: 'manager' },
  { page: 'account/', title: 'הזמנת חבר לקהילה', words: 'הזמנה מייל גוגל', go: '[data-open="{sid}"]|#inviteForm', who: 'manager' },
  { page: 'account/', title: 'קישור הזמנה לקהילה', words: 'הצטרפות שיתוף', go: '[data-open="{sid}"]|#btnCopyInvite', who: 'manager' },
  { page: 'account/', title: 'עמוד לאורחים', words: 'ציבורי קישור', go: '[data-open="{sid}"]|#btnGuestOn, #btnCopyGuest', who: 'manager' },
  { page: 'account/', title: 'הדפסת QR לכניסה', words: 'ברקוד', go: '[data-open="{sid}"]|#btnPrintQr', who: 'manager' },
  { page: 'account/', title: 'מסך טלוויזיה בבית הכנסת', words: 'תצוגה', go: '[data-open="{sid}"]|#btnCopyTv', who: 'manager' },
  { page: 'account/', title: 'פיצ׳רים בקהילה', words: 'הפעלה כיבוי עליות השבוע שלי', go: '[data-open="{sid}"]|[data-feature-on], [data-feature-off], [data-feature-approve]', who: 'manager' },
  { page: 'account/', title: 'חברי הקהילה ותפקידים', words: 'גבאי רב הסרה', go: '[data-open="{sid}"]|#btnOpenMembers|#sheet2 [data-role]', who: 'manager' },
  { page: 'account/', title: 'מחיקת הקהילה או עזיבה', words: 'יציאה מהקהילה', go: '[data-open="{sid}"]|#btnDeleteSyn, #btnLeave' },
];
