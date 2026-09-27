import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireGabbai } from "./synagogues";

export const list = query({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("יש להתחבר");
    }
    const requesterMembership = await ctx.db
      .query("memberships")
      .withIndex("by_synagogue_user", (q) =>
        q.eq("synagogueId", args.synagogueId).eq("userId", userId),
      )
      .unique();
    if (requesterMembership === null || requesterMembership.role !== "gabbai") {
      throw new Error("פעולה זו מותרת לגבאי בלבד");
    }
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_synagogue", (q) => q.eq("synagogueId", args.synagogueId))
      .collect();
    const members = await Promise.all(
      memberships.map(async (membership) => {
        const user = await ctx.db.get(membership.userId);
        return {
          userId: membership.userId,
          role: membership.role,
          joinedAt: membership.joinedAt,
          name: user?.name ?? null,
          email: user?.email ?? null,
          image: user?.image ?? null,
        };
      }),
    );
    return members;
  },
});

async function countGabbaim(ctx: MutationCtx, synagogueId: Id<"synagogues">) {
  const memberships = await ctx.db
    .query("memberships")
    .withIndex("by_synagogue", (q) => q.eq("synagogueId", synagogueId))
    .collect();
  return memberships.filter((m) => m.role === "gabbai").length;
}

export const setRole = mutation({
  args: {
    synagogueId: v.id("synagogues"),
    userId: v.id("users"),
    role: v.union(v.literal("gabbai"), v.literal("member")),
  },
  handler: async (ctx, args) => {
    await requireGabbai(ctx, args.synagogueId);
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_synagogue_user", (q) =>
        q.eq("synagogueId", args.synagogueId).eq("userId", args.userId),
      )
      .unique();
    if (membership === null) {
      throw new Error("החבר לא נמצא בבית הכנסת");
    }
    if (membership.role === "gabbai" && args.role === "member") {
      const gabbaiCount = await countGabbaim(ctx, args.synagogueId);
      if (gabbaiCount <= 1) {
        throw new Error("צריך להישאר לפחות גבאי אחד");
      }
    }
    await ctx.db.patch(membership._id, { role: args.role });
  },
});

export const remove = mutation({
  args: {
    synagogueId: v.id("synagogues"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await requireGabbai(ctx, args.synagogueId);
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_synagogue_user", (q) =>
        q.eq("synagogueId", args.synagogueId).eq("userId", args.userId),
      )
      .unique();
    if (membership === null) {
      return;
    }
    if (membership.role === "gabbai") {
      const gabbaiCount = await countGabbaim(ctx, args.synagogueId);
      if (gabbaiCount <= 1) {
        throw new Error("צריך להישאר לפחות גבאי אחד");
      }
    }
    await ctx.db.delete(membership._id);
  },
});

export const leave = mutation({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("יש להתחבר");
    }
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_synagogue_user", (q) =>
        q.eq("synagogueId", args.synagogueId).eq("userId", userId),
      )
      .unique();
    if (membership === null) {
      return;
    }
    if (membership.role === "gabbai") {
      const gabbaiCount = await countGabbaim(ctx, args.synagogueId);
      if (gabbaiCount <= 1) {
        throw new Error("גבאי אחרון לא יכול לעזוב את בית הכנסת");
      }
    }
    await ctx.db.delete(membership._id);
  },
});
