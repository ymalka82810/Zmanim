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
});
