# מבנה הנתונים

מאגר מסמכים (JSON) בסגנון Firestore. `{sid}` = מזהה בית כנסת, `{uid}` = מזהה משתמש, `{dateKey}` = `YYYY-MM-DD`.

## `synagogues/{sid}`
```json
{ "name": "אהל משה", "city": "ירושלים", "il": true, "createdAt": 0, "createdBy": "uid" }
```
`il` קובע את סדר הפרשות והחגים (ארץ ישראל / חוץ לארץ).

## `synagogues/{sid}/members/{uid}`
```json
{ "role": "member | gabbai | admin", "joinedAt": 0, "phone": "050..." }
```

## `synagogues/{sid}/bookings/{dateKey}`
מסמך אחד לכל תאריך (שבת/חג). קיום מסמך עם `status` = תאריך תפוס.
```json
{
  "status": "pending | approved | blocked",
  "uid": "uid של הנרשם (או של האחראי ברישום ידני/חסימה)",
  "sponsorName": "משפחת לוי",
  "occasion": "בר מצווה",
  "phone": "", "note": "",
  "termsVersion": 2, "termsAckAt": 0,
  "manual": false,
  "blockLabel": "קידוש קהילתי",
  "createdAt": 0, "decidedBy": "uid", "decidedAt": 0
}
```
- דחייה או ביטול = מחיקת המסמך + התראה.
- תפיסת תאריך נעשית עם נעילה קצרה (`acquire`) כדי למנוע רישום כפול.

## `synagogues/{sid}/terms/v{n}`
כל שמירה יוצרת מסמך חדש; הגרסה הנוכחית = `version` הגבוה ביותר.
```json
{ "version": 3, "intro": "טקסט פתיחה", "items": ["סעיף", "..."], "note": "מה השתנה", "editedBy": "uid", "editedAt": 0 }
```

## `synagogues/{sid}/notifications/{id}`
```json
{ "to": "uid | managers", "type": "new | cancel | approved | rejected", "dateKey": "2026-10-03",
  "text": "טקסט מוכן להצגה/למייל", "at": 0, "by": "uid", "readBy": ["uid"] }
```
התראות בנות יותר מ-120 יום נמחקות אוטומטית כשמנהל פותח את חלון ההתראות.

## `data/users/{uid}/profile` (פרטי למשתמש)
```json
{ "synagogues": ["sid1", "sid2"], "current": "sid1" }
```

## שמות משתמשים
לא נשמרים במאגר. מוצגים דרך `user.profiles(ids)`. בפרויקט אחר יש להחליף בטבלת משתמשים.
