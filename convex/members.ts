import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  assertRabbiAvailable,
  countManagers,
  getMembership,
  isManager,
  requireManager,
  requireUser,
  roleValidator,
} from "./roles";

export const list = query({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_synagogue", (q) => q.eq("synagogueId", args.synagogueId))
      .collect();
    return await Promise.all(
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
  },
});

async function assertNotLastManager(ctx: MutationCtx, synagogueId: Id<"synagogues">, message: string) {
  if ((await countManagers(ctx, synagogueId)) <= 1) {
    throw new Error(message);
  }
}

export const setRole = mutation({
  args: {
    synagogueId: v.id("synagogues"),
    userId: v.id("users"),
    role: roleValidator,
  },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    const membership = await getMembership(ctx, args.synagogueId, args.userId);
    if (membership === null) {
      throw new Error("החבר לא נמצא בקהילה");
    }
    if (isManager(membership.role) && !isManager(args.role)) {
      await assertNotLastManager(ctx, args.synagogueId, "צריך להישאר לפחות גבאי או רב אחד");
    }
    if (args.role === "rabbi") {
      await assertRabbiAvailable(ctx, args.synagogueId, args.userId);
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
    await requireManager(ctx, args.synagogueId);
    const membership = await getMembership(ctx, args.synagogueId, args.userId);
    if (membership === null) {
      return;
    }
    if (isManager(membership.role)) {
      await assertNotLastManager(ctx, args.synagogueId, "צריך להישאר לפחות גבאי או רב אחד");
    }
    await ctx.db.delete(membership._id);
  },
});

export const leave = mutation({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const membership = await getMembership(ctx, args.synagogueId, userId);
    if (membership === null) {
      return;
    }
    if (isManager(membership.role)) {
      await assertNotLastManager(ctx, args.synagogueId, "הגבאי או הרב האחרון לא יכול לעזוב את הקהילה");
    }
    await ctx.db.delete(membership._id);
  },
});
