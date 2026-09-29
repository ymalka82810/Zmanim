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
  }).index("by_invite", ["inviteCode"]),

  memberships: defineTable({
    userId: v.id("users"),
    synagogueId: v.id("synagogues"),
    role: roleValidator,
    joinedAt: v.number(),
    phone: v.optional(v.string()),
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
  })
    .index("by_synagogue_date", ["synagogueId", "dateKey"])
    .index("by_synagogue_hebrewYear", ["synagogueId", "hebrewYear"]),

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
  })
    .index("by_synagogue", ["synagogueId"])
    .index("by_synagogue_donor", ["synagogueId", "donorId"])
    .index("by_synagogue_hebrewYear", ["synagogueId", "hebrewYear"]),

  // התראות קידוש וקופה משותפות. dateKey/by רלוונטיים לקידוש בלבד, transactionId לקופה בלבד
  notifications: defineTable({
    synagogueId: v.id("synagogues"),
    type: notificationTypeValidator,
    to: v.union(v.id("users"), v.literal("managers")),
    text: v.string(),
    at: v.number(),
    readBy: v.array(v.id("users")),
    by: v.optional(v.id("users")),
    dateKey: v.optional(v.string()),
    transactionId: v.optional(v.id("fundTransactions")),
  })
    .index("by_synagogue_type_at", ["synagogueId", "type", "at"])
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

  // יומן כשלים כללי (שליחת מיילים, cron וכו'), גלוי לבעל האתר בלבד ב"החשבון שלי"
  errorLogs: defineTable({
    source: v.string(),
    message: v.string(),
    detail: v.optional(v.string()),
    at: v.number(),
  }).index("by_at", ["at"]),
});
