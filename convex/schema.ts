import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

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
    role: v.union(v.literal("gabbai"), v.literal("member")),
    joinedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_synagogue", ["synagogueId"])
    .index("by_synagogue_user", ["synagogueId", "userId"]),
});
