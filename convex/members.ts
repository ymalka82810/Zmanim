import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  assertRabbiAvailable,
  countManagers,
  countRole,
  getMembership,
  isManager,
  requireManager,
  type Role,
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
    throw new ConvexError(message);
  }
}

/** הרב היחיד או הגבאי היחיד לא יכול לוותר על תפקידו לפני שמינה מישהו אחר במקומו. */
async function assertNotSoleInRole(ctx: MutationCtx, synagogueId: Id<"synagogues">, role: Role, action: string) {
  if (!isManager(role) || (await countRole(ctx, synagogueId, role)) > 1) {
    return;
  }
  const label = role === "rabbi" ? "רב" : "גבאי";
  throw new ConvexError(`אתה ה${label} היחיד בקהילה. יש למנות ${label} אחר במקומך לפני ${action}`);
}

export const setRole = mutation({
  args: {
    synagogueId: v.id("synagogues"),
    userId: v.id("users"),
    role: roleValidator,
  },
  handler: async (ctx, args) => {
    const { userId: callerId, membership: callerMembership } = await requireManager(ctx, args.synagogueId);
    const membership = await getMembership(ctx, args.synagogueId, args.userId);
    if (membership === null) {
      throw new ConvexError("החבר לא נמצא בקהילה");
    }
    if (membership.role === args.role) {
      return;
    }
    const isSelf = args.userId === callerId;
    // הרב ממנה רב אחר במקומו: התפקיד עובר, והרב הקודם נשאר גבאי.
    if (args.role === "rabbi" && !isSelf && callerMembership.role === "rabbi") {
      await ctx.db.patch(membership._id, { role: "rabbi" });
      await ctx.db.patch(callerMembership._id, { role: "gabbai" });
      return;
    }
    if (isSelf) {
      await assertNotSoleInRole(ctx, args.synagogueId, membership.role, "שינוי התפקיד");
    } else if (isManager(membership.role) && !isManager(args.role)) {
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
    await assertNotSoleInRole(ctx, args.synagogueId, membership.role, "עזיבת הקהילה");
    await ctx.db.delete(membership._id);
  },
});
