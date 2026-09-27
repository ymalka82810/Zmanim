import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { randomInviteCode } from "./inviteCode";

export async function requireGabbai(ctx: MutationCtx, synagogueId: Id<"synagogues">) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new Error("יש להתחבר");
  }
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_synagogue_user", (q) => q.eq("synagogueId", synagogueId).eq("userId", userId))
    .unique();
  if (membership === null || membership.role !== "gabbai") {
    throw new Error("פעולה זו מותרת לגבאי בלבד");
  }
  return { userId, membership };
}

export const create = mutation({
  args: {
    name: v.string(),
    city: v.string(),
    il: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("יש להתחבר");
    }
    const synagogueId = await ctx.db.insert("synagogues", {
      name: args.name,
      city: args.city,
      il: args.il,
      createdBy: userId,
      inviteCode: randomInviteCode(),
      createdAt: Date.now(),
    });
    await ctx.db.insert("memberships", {
      userId,
      synagogueId,
      role: "gabbai",
      joinedAt: Date.now(),
    });
    return synagogueId;
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return [];
    }
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const synagogues = await Promise.all(
      memberships.map(async (membership) => {
        const synagogue = await ctx.db.get(membership.synagogueId);
        if (synagogue === null) {
          return null;
        }
        return {
          _id: synagogue._id,
          name: synagogue.name,
          city: synagogue.city,
          il: synagogue.il,
          inviteCode: synagogue.inviteCode,
          role: membership.role,
        };
      }),
    );
    return synagogues.filter((synagogue) => synagogue !== null);
  },
});

export const update = mutation({
  args: {
    synagogueId: v.id("synagogues"),
    name: v.string(),
    city: v.string(),
    il: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireGabbai(ctx, args.synagogueId);
    await ctx.db.patch(args.synagogueId, {
      name: args.name,
      city: args.city,
      il: args.il,
    });
  },
});
