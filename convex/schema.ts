import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { roleValidator } from "./roles";
import { notificationTypeValidator } from "./notifications";

export const fundTypeValidator = v.union(
  v.literal("donation"),
  v.literal("mitzvah"),
  v.literal("salary"),
  v.literal("expense"),
  v.literal("petty"),
  v.literal("pettyIn"),
);

export default defineSchema({
  ...authTables,

  // מרחיב את טבלת המשתמשים של @convex-dev/auth בשם בעברית, שמתבקש ממשתמש שחשבון הגוגל שלו לא הביא שם בעברית
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    hebrewName: v.optional(v.string()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),

  synagogues: defineTable({
    name: v.string(),
    city: v.string(),
    il: v.boolean(),
    createdBy: v.id("users"),
    inviteCode: v.string(),
    createdAt: v.number(),
    // נוסח ההכרזה על הקידוש, שהגבאי או הרב קובעים: השורה הראשונה, והמילים שלפני שם בעל הקידוש
    kiddushHeading: v.optional(v.string()),
    kiddushBy: v.optional(v.string()),
    // כתובת בית הכנסת, לעמוד הציבורי לאורחים
    address: v.optional(v.string()),
    // קוד העמוד הציבורי לאורחים (guest/?c=...). בלי קוד העמוד כבוי
    publicCode: v.optional(v.string()),
    // פיצ'רים נוספים שכל הגבאים והרב אישרו (convex/features.ts). בלי – רק הפיצ'רים הבסיסיים
    features: v.optional(v.array(v.string())),
    // פרטי תשלום שמוצגים לאורח שתרם מעמוד האורחים: טקסט חופשי (מספר ל-Bit/PayBox, חשבון בנק) וקישור תשלום
    payText: v.optional(v.string()),
    payLink: v.optional(v.string()),
  })
    .index("by_invite", ["inviteCode"])
    .index("by_public", ["publicCode"]),

  memberships: defineTable({
    userId: v.id("users"),
    synagogueId: v.id("synagogues"),
    role: roleValidator,
    joinedAt: v.number(),
    phone: v.optional(v.string()),
    // כהן או לוי, לחלוקת עליות. בלי – ישראל
    tribe: v.optional(v.union(v.literal("kohen"), v.literal("levi"))),
  })
    .index("by_user", ["userId"])
    .index("by_synagogue", ["synagogueId"])
    .index("by_synagogue_user", ["synagogueId", "userId"]),

  invitations: defineTable({
    synagogueId: v.id("synagogues"),
    email: v.string(),
    role: roleValidator,
    invitedBy: v.id("users"),
    createdAt: v.number(),
    emailStatus: v.optional(v.union(v.literal("pending"), v.literal("sent"), v.literal("failed"))),
    emailError: v.optional(v.string()),
  })
    .index("by_email", ["email"])
    .index("by_synagogue", ["synagogueId"])
    .index("by_synagogue_email", ["synagogueId", "email"]),

  // בקשה של גבאי או רב להפעיל או לכבות פיצ'ר. מתבצעת כשכל הגבאים והרב אישרו (approvals)
  featureRequests: defineTable({
    synagogueId: v.id("synagogues"),
    feature: v.string(),
    enable: v.boolean(),
    requestedBy: v.id("users"),
    approvals: v.array(v.id("users")),
    createdAt: v.number(),
  }).index("by_synagogue", ["synagogueId"]),

  kiddushBookings: defineTable({
    synagogueId: v.id("synagogues"),
    dateKey: v.string(),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("blocked")),
    userId: v.id("users"),
    manual: v.boolean(),
    sponsorName: v.string(),
    sponsorSuffix: v.optional(v.string()),
    occasion: v.string(),
    occasionType: v.optional(v.string()),
    occasionSuffix: v.optional(v.string()),
    // סיבות נוספות לקידוש (לרגל / לזכות / לעילוי נשמת...), בנוסף לראשונה למעלה
    moreOccasions: v.optional(
      v.array(v.object({ occasionType: v.optional(v.string()), occasion: v.string(), occasionSuffix: v.optional(v.string()) })),
    ),
    phone: v.string(),
    note: v.string(),
    blockLabel: v.string(),
    termsVersion: v.number(),
    termsAckAt: v.optional(v.number()),
    createdAt: v.number(),
    decidedBy: v.optional(v.id("users")),
    decidedAt: v.optional(v.number()),
    // שנה עברית של dateKey, להכנה לטעינה עתידית של רישומים לפי תקופה
    hebrewYear: v.optional(v.number()),
    // שותפים לקידוש (מעבר לנרשם עצמו). בלי userId: שותף שהגבאי רשם ידנית, נחשב מאושר
    cosponsors: v.optional(
      v.array(
        v.object({
          userId: v.optional(v.id("users")),
          sponsorName: v.string(),
          sponsorSuffix: v.optional(v.string()),
          status: v.union(v.literal("pending"), v.literal("confirmed")),
          respondedAt: v.optional(v.number()),
        }),
      ),
    ),
  })
    .index("by_synagogue_date", ["synagogueId", "dateKey"])
    .index("by_synagogue_hebrewYear", ["synagogueId", "hebrewYear"]),

  // בקשות קידוש שנדחו על ידי גבאי/רב, כדי שהמבקש יראה מה נדחה גם אחרי שהרישום עצמו נמחק
  kiddushRejections: defineTable({
    synagogueId: v.id("synagogues"),
    userId: v.id("users"),
    dateKey: v.string(),
    sponsorLine: v.string(),
    occasionLine: v.string(),
    reason: v.string(),
    rejectedBy: v.id("users"),
    rejectedAt: v.number(),
  }).index("by_synagogue_user", ["synagogueId", "userId"]),

  kiddushTerms: defineTable({
    synagogueId: v.id("synagogues"),
    version: v.number(),
    intro: v.string(),
    items: v.array(v.string()),
    note: v.string(),
    editedBy: v.id("users"),
    editedAt: v.number(),
  }).index("by_synagogue_version", ["synagogueId", "version"]),

  fundTransactions: defineTable({
    synagogueId: v.id("synagogues"),
    type: fundTypeValidator,
    amount: v.number(),
    date: v.string(),
    donorId: v.optional(v.id("users")),
    name: v.string(),
    desc: v.string(),
    method: v.string(),
    mitzvah: v.string(),
    month: v.string(),
    category: v.string(),
    vendor: v.string(),
    paid: v.boolean(),
    paidDate: v.string(),
    createdAt: v.number(),
    createdBy: v.id("users"),
    lastReminderDate: v.optional(v.string()),
    // שנה עברית של date, להכנה לטעינה עתידית של רישומים לפי תקופה
    hebrewYear: v.optional(v.number()),
    // תרומה למגבית (fundCampaigns). רק לרישום מסוג donation
    campaignId: v.optional(v.id("fundCampaigns")),
    // תרומה לזמן מיוחד (specialDonations), כמו פדיון כפרות או מחצית השקל. רק לרישום מסוג donation
    specialId: v.optional(v.id("specialDonations")),
  })
    .index("by_synagogue", ["synagogueId"])
    .index("by_synagogue_donor", ["synagogueId", "donorId"])
    .index("by_synagogue_hebrewYear", ["synagogueId", "hebrewYear"])
    // תזכורות התשלום היומיות קוראות רק את הלא-משולמים
    .index("by_paid", ["paid"])
    .index("by_campaign", ["campaignId"])
    .index("by_special", ["specialId"]),

  // מגבית בקופה (convex/campaigns.ts): מטרה שהגבאי או הרב פתחו, עם עלות (goal) שסך התרומות אליה לא יעבור, ותמונת תיאור
  fundCampaigns: defineTable({
    synagogueId: v.id("synagogues"),
    title: v.string(),
    desc: v.string(),
    goal: v.number(),
    imageId: v.optional(v.id("_storage")),
    imageSize: v.optional(v.number()),
    // מוצגת גם בעמוד האורחים (convex/guest.ts), ואורחים יכולים להתחייב לתרום לה
    guests: v.optional(v.boolean()),
    status: v.union(v.literal("open"), v.literal("closed")),
    createdBy: v.id("users"),
    createdAt: v.number(),
    closedAt: v.optional(v.number()),
  }).index("by_synagogue", ["synagogueId"]),

  // קטלוג בית הכנסת (convex/catalog.ts): חפצים למכירה, כמו מזוזות, לולבים ואתרוגים. בלי price – "לפי פנייה לגבאי"
  catalogItems: defineTable({
    synagogueId: v.id("synagogues"),
    title: v.string(),
    desc: v.string(),
    category: v.string(),
    price: v.optional(v.number()),
    contact: v.optional(v.string()),
    imageId: v.optional(v.id("_storage")),
    imageSize: v.optional(v.number()),
    status: v.union(v.literal("available"), v.literal("sold")),
    createdBy: v.id("users"),
    createdAt: v.number(),
  }).index("by_synagogue", ["synagogueId"]),

  // תרומה לזמן מיוחד (convex/specialDonations.ts): פדיון כפרות, מחצית השקל, מתנות לאביונים, קמחא דפסחא, נדר ביזכור
  // או שם חופשי, שהגבאי או הרב פותחים וסוגרים. texts – הנוסח לכל עדה שמוצעת (ashkenaz/sefard/mizrach/chabad), אם יש.
  // amount – הסכום המוצע (במחצית השקל – לנפש; בלי סכום הוא מחושב לפי מחיר הכסף, silverPrice)
  specialDonations: defineTable({
    synagogueId: v.id("synagogues"),
    kind: v.string(),
    title: v.string(),
    desc: v.string(),
    amount: v.optional(v.number()),
    texts: v.optional(v.record(v.string(), v.string())),
    // מוצגת גם בעמוד האורחים (convex/guest.ts), ואורחים יכולים להתחייב לתרום לה
    guests: v.optional(v.boolean()),
    status: v.union(v.literal("open"), v.literal("closed")),
    createdBy: v.id("users"),
    createdAt: v.number(),
    closedAt: v.optional(v.number()),
  }).index("by_synagogue", ["synagogueId"]),

  // התחייבות לתרומה של אורח מעמוד האורחים (convex/guest.ts), בלי חשבון. ממתינה לגבאי או לרב: באישור היא נרשמת
  // בקופה כתרומה (לא שולמה או שולמה) ונמחקת מכאן; בדחייה – נמחקת. בלי specialId/campaignId – תרומה כללית
  guestPledges: defineTable({
    synagogueId: v.id("synagogues"),
    specialId: v.optional(v.id("specialDonations")),
    campaignId: v.optional(v.id("fundCampaigns")),
    // שם התרומה בזמן ההתחייבות, למקרה שהתרומה או המגבית נמחקו בינתיים
    title: v.string(),
    amount: v.number(),
    name: v.string(),
    phone: v.string(),
    forWhom: v.string(),
    at: v.number(),
  }).index("by_synagogue_at", ["synagogueId", "at"]),

  // מסך הטלוויזיה (tv/, convex/tv.ts): live – מה שמוצג עכשיו; draft – שינוי שגבאי או רב הציעו, שעולה למסך כשכל
  // הגבאים והרב אישרו (approvals). שניהם JSON באותו מבנה (שקופיות, פס רץ, מה מוצג, QR)
  tvScreens: defineTable({
    synagogueId: v.id("synagogues"),
    live: v.optional(v.string()),
    liveAt: v.optional(v.number()),
    draft: v.optional(v.string()),
    draftBy: v.optional(v.id("users")),
    draftAt: v.optional(v.number()),
    approvals: v.array(v.id("users")),
  }).index("by_synagogue", ["synagogueId"]),

  // מחיר גרם כסף טהור בשקלים, לחישוב מחצית השקל (convex/silverPrice.ts). רשומה אחת, שמתעדכנת פעם ביום
  silverPrice: defineTable({
    ilsPerGram: v.number(),
    usdPerOunce: v.number(),
    usdIls: v.number(),
    at: v.number(),
  }),

  // התראות קידוש וקופה משותפות. dateKey/by רלוונטיים לקידוש בלבד, transactionId לקופה בלבד
  notifications: defineTable({
    synagogueId: v.id("synagogues"),
    type: notificationTypeValidator,
    // משתמש מסוים, כל הגבאים והרב, או כל חברי הקהילה (קריאה למניין)
    to: v.union(v.id("users"), v.literal("managers"), v.literal("members")),
    text: v.string(),
    at: v.number(),
    readBy: v.array(v.id("users")),
    by: v.optional(v.id("users")),
    dateKey: v.optional(v.string()),
    transactionId: v.optional(v.id("fundTransactions")),
    // הודעה על פתיחת מגבית, שנמחקת יחד עם המגבית
    campaignId: v.optional(v.id("fundCampaigns")),
  })
    .index("by_synagogue_type_at", ["synagogueId", "type", "at"])
    .index("by_campaign", ["campaignId"])
    .index("by_synagogue_type_to_at", ["synagogueId", "type", "to", "at"]),

  scheduleFiles: defineTable({
    synagogueId: v.id("synagogues"),
    storageId: v.id("_storage"),
    title: v.string(),
    firstDate: v.string(),
    mode: v.union(v.literal("holy"), v.literal("days"), v.literal("events")),
    // התבנית שהלוח נוצר בה. חג שחל בשבת יכול להישלח כשני לוחות נפרדים לאותו תאריך
    kind: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("approved")),
    submittedBy: v.id("users"),
    submittedAt: v.number(),
    approvedBy: v.optional(v.id("users")),
    approvedAt: v.optional(v.number()),
    size: v.optional(v.number()),
    // מחיקה רכה: הקובץ בסל המחזור, מוסתר מהקהילה ועדיין תופס מקום עד מחיקה סופית
    deletedAt: v.optional(v.number()),
    deletedBy: v.optional(v.id("users")),
  })
    .index("by_synagogue_first", ["synagogueId", "firstDate"])
    .index("by_deletedAt", ["deletedAt"]),

  communityEvents: defineTable({
    synagogueId: v.id("synagogues"),
    dateKey: v.string(),
    title: v.string(),
    details: v.string(),
    // איך האירוע מוצג בלוח הזמנים: שורה בלוח, מודעה נפרדת, או שניהם. בלי – שורה בלוח
    show: v.optional(v.union(v.literal("board"), v.literal("poster"), v.literal("both"))),
    createdBy: v.id("users"),
    createdAt: v.number(),
    editedBy: v.optional(v.id("users")),
    editedAt: v.optional(v.number()),
  }).index("by_synagogue_date", ["synagogueId", "dateKey"]),

  // אזכרות (יום השנה לפטירה). תאריך הפטירה העברי בחודשי hebcal: 1=ניסן ... 12=אדר/אדר א׳, 13=אדר ב׳
  yahrzeits: defineTable({
    synagogueId: v.id("synagogues"),
    userId: v.id("users"),
    name: v.string(),
    relation: v.string(),
    hDay: v.number(),
    hMonth: v.number(),
    hYear: v.number(),
    // מוצג לכל חברי הקהילה ביומן. הגבאי והרב רואים תמיד, כדי לדעת למי לתת עלייה
    shared: v.boolean(),
    // התאריך (YYYY-MM-DD) של האזכרה שכבר נשלחה עליה תזכורת, כדי לא לשלוח פעמיים
    remindedFor: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_synagogue", ["synagogueId"])
    .index("by_synagogue_user", ["synagogueId", "userId"]),

  // תפילות קבועות שאפשר להירשם אליהן ("אני מגיע"). days: ימי השבוע, 0=ראשון ... 6=שבת
  minyanim: defineTable({
    synagogueId: v.id("synagogues"),
    name: v.string(),
    time: v.string(),
    days: v.array(v.number()),
    createdBy: v.id("users"),
    createdAt: v.number(),
  }).index("by_synagogue", ["synagogueId"]),

  minyanRsvps: defineTable({
    synagogueId: v.id("synagogues"),
    minyanId: v.id("minyanim"),
    dateKey: v.string(),
    userId: v.id("users"),
    at: v.number(),
  })
    .index("by_synagogue_date", ["synagogueId", "dateKey"])
    .index("by_minyan_date_user", ["minyanId", "dateKey", "userId"]),

  // עליות לתורה שחולקו. userId לחבר קהילה; אורח נרשם בשם בלבד. reason: החיוב שבגללו ניתנה העלייה, אם היה
  aliyot: defineTable({
    synagogueId: v.id("synagogues"),
    dateKey: v.string(),
    aliyah: v.string(),
    userId: v.optional(v.id("users")),
    name: v.string(),
    reason: v.optional(v.string()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    hebrewYear: v.optional(v.number()),
  })
    .index("by_synagogue_date", ["synagogueId", "dateKey"])
    .index("by_synagogue_user", ["synagogueId", "userId"]),

  // חיובים לעלייה שנרשמו מראש לתאריך מסוים: חתן, בר מצווה, אבי הבן/הבת, אזכרה שלא ברשימת האזכרות
  aliyahClaims: defineTable({
    synagogueId: v.id("synagogues"),
    dateKey: v.string(),
    reason: v.string(),
    userId: v.optional(v.id("users")),
    name: v.string(),
    note: v.string(),
    createdBy: v.id("users"),
    createdAt: v.number(),
  }).index("by_synagogue_date", ["synagogueId", "dateKey"]),

  // מכרז על עלייה או כיבוד (convex/auctions.ts). top*: ההצעה הגבוהה עד עכשיו. בסגירה נרשמים חיוב בקופה (transactionId)
  // ועלייה בחלוקת העליות (aliyahId, אם הפיצר פעיל)
  auctions: defineTable({
    synagogueId: v.id("synagogues"),
    dateKey: v.string(),
    title: v.string(),
    order: v.number(),
    opensAt: v.number(),
    closesAt: v.number(),
    minBid: v.number(),
    step: v.number(),
    status: v.union(v.literal("scheduled"), v.literal("open"), v.literal("closed")),
    bidCount: v.number(),
    topAmount: v.optional(v.number()),
    topUserId: v.optional(v.id("users")),
    topName: v.optional(v.string()),
    // "עבור": מי שהמציע ביקש שיעלה במקומו. גלוי לגבאי ולרב בלבד
    topForUserId: v.optional(v.id("users")),
    topForName: v.optional(v.string()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    finalizedAt: v.optional(v.number()),
    transactionId: v.optional(v.id("fundTransactions")),
    aliyahId: v.optional(v.id("aliyot")),
  }).index("by_synagogue_status_closes", ["synagogueId", "status", "closesAt"]),

  // הצעות במכרז. userId/name: המציע, שהוא גם המשלם. forUserId/forName: מי שהמציע ביקש שיעלה במקומו (גלוי לגבאי ולרב בלבד)
  auctionBids: defineTable({
    synagogueId: v.id("synagogues"),
    auctionId: v.id("auctions"),
    userId: v.optional(v.id("users")),
    name: v.string(),
    forUserId: v.optional(v.id("users")),
    forName: v.optional(v.string()),
    amount: v.number(),
    at: v.number(),
    by: v.id("users"),
  }).index("by_auction_amount", ["auctionId", "amount"]),

  fundSettings: defineTable({
    synagogueId: v.id("synagogues"),
    openMain: v.number(),
    openPetty: v.number(),
  }).index("by_synagogue", ["synagogueId"]),

  // הגדרות לוח הזמנים של הקהילה (js/config.js), משותפות לגבאים ולרב. עיצוב מקובץ נשמר בנפרד ב-zmanimDesigns
  zmanimSettings: defineTable({
    synagogueId: v.id("synagogues"),
    config: v.string(),
    rev: v.number(),
    updatedBy: v.id("users"),
    updatedAt: v.number(),
  }).index("by_synagogue", ["synagogueId"]),

  // הגדרות לוח ששמרו בשם, כדי לעבור ביניהן. בנויות כמו config של zmanimSettings
  zmanimProfiles: defineTable({
    synagogueId: v.id("synagogues"),
    name: v.string(),
    config: v.string(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedBy: v.id("users"),
    updatedAt: v.number(),
  }).index("by_synagogue_name", ["synagogueId", "name"]),

  // עיצוב מקובץ (תמונה וגופנים, יכול להגיע לכמה מגה) כקובץ JSON באחסון, לפי גיבוב התוכן שלו
  zmanimDesigns: defineTable({
    synagogueId: v.id("synagogues"),
    hash: v.string(),
    storageId: v.id("_storage"),
    createdAt: v.number(),
    size: v.optional(v.number()),
  }).index("by_synagogue_hash", ["synagogueId", "hash"]),

  // ה-APK האחרון של אפליקציית האנדרואיד, שה-workflow מעלה (convex/appUpdate.ts). נשמרת רק הגרסה האחרונה
  appReleases: defineTable({
    versionCode: v.number(),
    versionName: v.string(),
    storageId: v.id("_storage"),
    size: v.number(),
    uploadedAt: v.number(),
  }).index("by_versionCode", ["versionCode"]),

  // יומן כשלים כללי (שליחת מיילים, cron וכו'), גלוי לבעל האתר בלבד ב"החשבון שלי"
  errorLogs: defineTable({
    source: v.string(),
    message: v.string(),
    detail: v.optional(v.string()),
    at: v.number(),
  }).index("by_at", ["at"]),
});
