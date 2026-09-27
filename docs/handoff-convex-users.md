# הנחיה להמשך: ניהול משתמשים ב-Convex

מסמך העברה בין שיחות. מי שממשיך את העבודה: קרא את כל המסמך לפני שמתחילים.

## העדפות של יניב (בעל הפרויקט)
- כל התקשורת בעברית, כולל עדכוני ביניים, שאלות ואפשרויות בחירה.
- כשיש החלטת עיצוב פתוחה, **שואלים** ולא מחליטים לבד.
- מבצעים commit ו-push ישירות ל-`main`, בלי ענף ובלי PR.
- תאריכים מוצגים בפורמט `dd/mm/yyyy`.

## המטרה
להוסיף לאתר (`C:\Users\yanivm\Zmanim`, ‏GitHub: `ymalka82810/Zmanim`, ‏GitHub Pages: `https://ymalka82810.github.io/Zmanim/`)
ניהול משתמשים ב-Convex. יניב כבר פתח בלוח הבקרה של Convex פרויקט בשם **zmanim**.

## החלטות שיניב כבר קיבל (לא לשאול עליהן שוב)
| נושא | החלטה |
|---|---|
| מי המשתמשים | גבאים ומתפללים. לכל אחד יש חשבון |
| התחברות | **חשבון גוגל** (Convex Auth עם ספק Google). יניב אישר שהוא מצליח להיכנס ל-Google Cloud Console. מה שנחסם אצלו קודם היה רק Apps Script |
| מי פותח בית כנסת | כל משתמש. מי שפותח בית כנסת הופך לגבאי שלו |
| הצטרפות מתפלל | קישור הזמנה מהגבאי. מי שנכנס דרכו מצטרף כמתפלל. הגבאי יכול להסיר מתפללים ולהחליף את הקישור |
| מסך הניהול | דף חדש, "החשבון שלי", בתפריט ההמבורגר, משותף לכל האפליקציות באתר |
| מה עובר ל-Convex | **רק משתמשים בינתיים.** לוח הקידושים נשאר על גיליון גוגל, והקופה נשארת בדפדפן |

## מצב הפרויקט היום
- אתר סטטי בלי bundler ובלי React: HTML ו-JS רגיל. ספריות חיצוניות מועתקות ל-`vendor/`. `package.json` מוגדר `"type": "module"`, ו-`npm start` מריץ את `tools/serve.js` על http://localhost:8080.
- שלושה דפים: לוח הזמנים (שורש האתר), `kiddush/` ו-`gabbai/`. עוברים ביניהם דרך `js/menu.js`, שבו רשימת דפים `{ path, title }`. מצב יום/לילה מוגדר ב-`js/theme.js`.
- `sw.js` מחזיק רשימת קבצים לעבודה בלי אינטרנט (`SHELL`) ואת `CACHE = 'luach-vNN'`. כל קובץ חדש נכנס לרשימה, ובכל שינוי מעלים את מספר הגרסה.
- כל הממשק בעברית ומימין לשמאל. העיצוב: משתני צבע ב-`:root` עם גרסה כהה. אפשר להעתיק את הטוקנים ואת הרכיבים (`.card`, `.btn`, `.sheet`, `.toast`, `.hero`) מ-`kiddush/css/styles.css`.
- לוח הקידושים (`kiddush/`) קורא גיליון גוגל. ההסבר ב-`kiddush/README.md`. **לא לגעת בו במשימה הזו.**
- ב-Convex: אין תיקיית `convex/`, אין `.env.local`, והפרויקט עוד לא מקושר למחשב.

## שלבים

### 1. קישור ל-Convex
1. `npm i convex @convex-dev/auth @auth/core`. גרסת `@auth/core` צריכה להתאים למה שכתוב בתיעוד העדכני של Convex Auth.
2. להריץ את `npx convex dev` ברקע. בפעם הראשונה הפקודה מבקשת התחברות: להציג ליניב את הקישור ואת הקוד, והוא יאשר בדפדפן. לבחור בפרויקט **הקיים** `zmanim`. לפני כן לבדוק את הדגלים ב-`npx convex dev --help`, למשל `--configure existing`.
3. לוודא ש-`.env.local` נמצא ב-`.gitignore`.
4. להריץ `npx @convex-dev/auth` (אשף ההתקנה). הוא מגדיר את `JWT_PRIVATE_KEY`, ‏`JWKS` ו-`SITE_URL`.
   להגדיר `SITE_URL=https://ymalka82810.github.io`.

### 2. גוגל (יניב עושה, לפי הוראות שכותבים לו בעברית, לחיצה אחר לחיצה)
- ב-Google Cloud Console: פרויקט (אפשר `Zmanim`), ומסך הסכמה External ב-Production.
  ההרשאות הן `openid`, `email` ו-`profile`, שאינן רגישות, ולכן אין צורך באימות של גוגל.
- Clients ← Create client ← Web application:
  - **Authorized JavaScript origins**: `https://ymalka82810.github.io`, `http://localhost:8080`
  - **Authorized redirect URIs**: `https://<deployment>.convex.site/api/auth/callback/google`. את הכתובת לוקחים מ-`.env.local` או מלוח הבקרה, ומחליפים בה `.cloud` ב-`.site`.
- יניב מעביר את ה-Client ID ואת ה-Client secret. מגדירים אותם עם `npx convex env set AUTH_GOOGLE_ID ...` ו-`npx convex env set AUTH_GOOGLE_SECRET ...`.
  **את ה-secret לא שומרים בקוד ולא ב-git.**

### 3. צד השרת (`convex/`)
- `auth.ts`: להגדיר `convexAuth({ providers: [Google] })`. ב-`callbacks.redirect` לאפשר חזרה גם ל-`http://localhost:8080`, ולא רק ל-`SITE_URL`.
- `http.ts`: `auth.addHttpRoutes(http)`. ‏`auth.config.ts`: כמו בתיעוד.
- `schema.ts`: `...authTables`, ובנוסף:
  - `synagogues`: `name`, ‏`city`, ‏`il` (boolean, ארץ ישראל או חוץ לארץ), ‏`createdBy`, ‏`inviteCode`, ‏`createdAt`. אינדקס `by_invite`.
  - `memberships`: `userId`, ‏`synagogueId`, ‏`role: "gabbai" | "member"`, ‏`joinedAt`. אינדקסים `by_user`, ‏`by_synagogue`, ‏`by_synagogue_user`.
- **בעל האתר**: לפי משתנה סביבה `OWNER_EMAIL` ב-Convex, ולא בקוד, כי הקוד ציבורי בגיטהאב. הבעלים רואה ומנהל את כל בתי הכנסת.
- פונקציות. כל בדיקת הרשאה נעשית בשרת עם `getAuthUserId`:
  - `users.me`: שם, מייל, תמונה, `isOwner`.
  - `synagogues.create`: היוצר נרשם כגבאי, ונוצר קוד הזמנה אקראי.
  - `synagogues.mine`: בתי הכנסת שלי והתפקיד שלי בכל אחד.
  - `synagogues.update`: גבאי בלבד.
  - `invites.preview(code)`: פתוחה גם בלי התחברות, ומחזירה רק את שם בית הכנסת והעיר.
  - `invites.join(code)`: מי שכבר חבר נשאר בתפקיד שלו.
  - `invites.rotate`: גבאי בלבד.
  - `members.list`: גבאי בלבד.
  - `members.setRole`: גבאי בלבד. חייב להישאר לפחות גבאי אחד.
  - `members.remove`: גבאי בלבד.
  - `members.leave`: גבאי אחרון לא יכול לעזוב.

### 4. צד הלקוח, בלי React
- להעתיק את `node_modules/convex/dist/browser.bundle.js` ל-`vendor/convex/`, עם מספר הגרסה בשם הקובץ, כמו `vendor/hebcal/`. הקובץ חושף משתנה גלובלי `convex` עם `ConvexClient`.
- `js/convex-config.js`: ‏`CONVEX_URL` (ציבורי, מותר ב-git).
- `js/auth.js`: לקוח קטן לפרוטוקול של Convex Auth, משותף לכל הדפים. **לפני הכתיבה לאמת את הפרוטוקול מול הקוד של הלקוח הרשמי** ב-`node_modules/@convex-dev/auth/dist/react/`:
  - כניסה: action ‏`auth:signIn` עם `{ provider: "google", params: { redirectTo } }` מחזיר `{ redirect, verifier }`. שומרים את `verifier` ב-localStorage ועוברים לכתובת ב-`redirect`.
  - חזרה: בכתובת מופיע `?code=`. קוראים ל-`auth:signIn` עם `{ params: { code }, verifier }` ומקבלים `{ tokens: { token, refreshToken } }`. שומרים את הטוקנים ומנקים את `code` מהכתובת.
  - חידוש: `auth:signIn` עם `{ refreshToken }`, ומחברים ל-`client.setAuth(fetchToken)`.
  - יציאה: `auth:signOut` ומחיקת הטוקנים.
  - בגיטהאב פייג'ס הנתיב הוא `/Zmanim/...`, ולכן `redirectTo` צריך להיות יחסי ל-`SITE_URL`, למשל `/Zmanim/account/`.
- דף חדש `account/` (`index.html`, ‏`css/styles.css`, ‏`js/app.js`):
  - **לא מחובר**: כפתור "כניסה עם Google".
  - **מחובר**: שם, מייל וכפתור יציאה. תחת "בתי הכנסת שלי": רשימה עם התפקיד בכל אחד, וכפתור "פתיחת בית כנסת חדש" (שם, עיר, ארץ ישראל או חוץ לארץ).
  - **לגבאי**: קישור הזמנה (העתקה, שיתוף, החלפת קישור), רשימת חברים עם בחירת תפקיד והסרה, ועריכת פרטי בית הכנסת.
  - **הצטרפות**: `account/?join=<code>`. מציגים את שם בית הכנסת ואת הכפתור "הצטרפות". אם המשתמש לא מחובר, שומרים את הקוד לאורך ההתחברות וממשיכים אחריה.
- ב-`js/menu.js` להוסיף `{ path: 'account/', title: 'החשבון שלי' }`. ב-`sw.js` להוסיף את הקבצים החדשים ולהעלות את `CACHE`. לעדכן את `README.md` הראשי ולכתוב `account/README.md`.

### 5. בדיקה ומסירה
- לבדוק את הלוגיקה ב-Node עם `window` ו-`fetch` מדומים, כמו בבדיקות של `kiddush/`, ולבדוק את פונקציות השרת מול ה-deployment של הפיתוח.
- כניסה אמיתית עם גוגל בודקים יחד עם יניב ב-http://localhost:8080/account/ ואחר כך באתר החי. ב-GitHub Pages צריך לפרוס את Convex לסביבת production (`npx convex deploy`) ולהגדיר בה את אותם משתני סביבה.
- בסוף: commit ו-push ל-`main`, וסיכום קצר בעברית: מה עובד, מה נבדק ומה נשאר ליניב לעשות.

## לא במשימה הזו (אפשר להציע אחר כך)
- העברת רישומי הקידושים ל-Convex. זה יאפשר חסימה של מחיקת רישום של אחר, בלי גיליון גוגל ובלי שומר הסף של Apps Script (`kiddush/apps-script/`).
- העברת הקופה (`gabbai/`) ושל הגדרות לוח הזמנים לחשבון המשתמש.
