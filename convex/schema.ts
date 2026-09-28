import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { roleValidator } from "./roles";

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
    occasion: v.string(),
    phone: v.string(),
    note: v.string(),
    blockLabel: v.string(),
    termsVersion: v.number(),
    termsAckAt: v.optional(v.number()),
    createdAt: v.number(),
    decidedBy: v.optional(v.id("users")),
    decidedAt: v.optional(v.number()),
  }).index("by_synagogue_date", ["synagogueId", "dateKey"]),

  kiddushTerms: defineTable({
    synagogueId: v.id("synagogues"),
    version: v.number(),
    intro: v.string(),
    items: v.array(v.string()),
    note: v.string(),
    editedBy: v.id("users"),
    editedAt: v.number(),
  }).index("by_synagogue_version", ["synagogueId", "version"]),

  kiddushNotifications: defineTable({
    synagogueId: v.id("synagogues"),
    to: v.union(v.id("users"), v.literal("managers")),
    dateKey: v.string(),
    text: v.string(),
    at: v.number(),
    by: v.id("users"),
    readBy: v.array(v.id("users")),
  }).index("by_synagogue_at", ["synagogueId", "at"]),

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
  })
    .index("by_synagogue", ["synagogueId"])
    .index("by_synagogue_donor", ["synagogueId", "donorId"]),

  fundNotifications: defineTable({
    synagogueId: v.id("synagogues"),
    userId: v.id("users"),
    transactionId: v.id("fundTransactions"),
    text: v.string(),
    at: v.number(),
    read: v.boolean(),
  }).index("by_synagogue_user_at", ["synagogueId", "userId", "at"]),

  scheduleFiles: defineTable({
    synagogueId: v.id("synagogues"),
    storageId: v.id("_storage"),
    title: v.string(),
    firstDate: v.string(),
    mode: v.union(v.literal("holy"), v.literal("days")),
    // התבנית שהלוח נוצר בה. חג שחל בשבת יכול להישלח כשני לוחות נפרדים לאותו תאריך
    kind: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("approved")),
    submittedBy: v.id("users"),
    submittedAt: v.number(),
    approvedBy: v.optional(v.id("users")),
    approvedAt: v.optional(v.number()),
  }).index("by_synagogue_first", ["synagogueId", "firstDate"]),

  communityEvents: defineTable({
    synagogueId: v.id("synagogues"),
    dateKey: v.string(),
    title: v.string(),
    details: v.string(),
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
});
