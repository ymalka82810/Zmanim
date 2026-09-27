# חיבור לפרויקט אחר

## 1. שימוש בלוח העברי בלבד
`js/calendar.js` עצמאי (דורש רק את hebcal):
```html
<script src="https://cdn.jsdelivr.net/npm/@hebcal/core@6.9.3/dist/bundle.min.js"></script>
<script src="js/calendar.js"></script>
<script>
  const { getSlots, monthRange, slotTitle } = window.KiddushCalendar;
  const { start, end } = monthRange(new Date(), 'heb'); // או 'greg'
  const slots = getSlots(start, end, true); // true = ארץ ישראל
  // כל פריט: { key, date, hd, kind, name, isChag, subs }
</script>
```

## 2. החלפת מאגר הנתונים
`app.js` משתמש רק בפעולות האלה, בסגנון Firestore:

- `db.doc(path)` עם `get / set / update / delete / onSnapshot / acquire`
- `db.collection(path)` עם `orderBy / limit / add / doc / onSnapshot`
- `user.me()` מחזיר `{ id, isOwner }`, `user.can('data.write')`, `user.profiles(ids)` מחזיר `{ [id]: { name, email } }`
- `downloads.save({ filename, data })` לקובץ יומן (.ics)

בפרויקט עם Firebase: לכתוב מתאם קטן שמגדיר `window.claude = { use: async name => ({ db, user, downloads })[name] }`
ועוטף את Firestore ואת Firebase Auth בחתימות האלה. את `acquire` אפשר לממש עם טרנזקציה.
ההרשאות לפי תפקיד נאכפות כרגע בממשק בלבד; בשרת משלכם כדאי להוסיף Security Rules לפי `members/{uid}.role`.

## 3. שליחת מיילים
אוסף `notifications` מכיל טקסט מוכן לכל אירוע (`to`, `text`). שתי דרכים:
- **עדכון סטטוס**: טריגר על יצירת מסמך התראה ששולח מייל לנמען (או לכל מי שתפקידו gabbai/admin כש-`to = "managers"`).
- **תזכורות**: משימה יומית שסורקת `bookings` עם `status = approved` ותאריך בעוד 3 ימים / יום אחד, ושולחת לנרשם.

נדרשת כתובת מייל למשתמש: להוסיף שדה `email` ל-`members/{uid}` (או לקחת ממערכת ההזדהות).
