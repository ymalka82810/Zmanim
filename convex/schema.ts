import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { roleValidator } from "./roles";

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
});
