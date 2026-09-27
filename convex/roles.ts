import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

export const roleValidator = v.union(v.literal("gabbai"), v.literal("rabbi"), v.literal("member"));
export type Role = "gabbai" | "rabbi" | "member";

export const isManager = (role: Role) => role === "gabbai" || role === "rabbi";

export async function requireUser(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new Error("יש להתחבר");
  }
  return userId;
}

export async function getMembership(ctx: QueryCtx, synagogueId: Id<"synagogues">, userId: Id<"users">) {
  return await ctx.db
    .query("memberships")
    .withIndex("by_synagogue_user", (q) => q.eq("synagogueId", synagogueId).eq("userId", userId))
    .unique();
}

/** גבאי או רב של הקהילה. */
export async function requireManager(ctx: QueryCtx, synagogueId: Id<"synagogues">) {
  const userId = await requireUser(ctx);
  const membership = await getMembership(ctx, synagogueId, userId);
  if (membership === null || !isManager(membership.role)) {
    throw new Error("פעולה זו מותרת לגבאי או לרב בלבד");
  }
  return { userId, membership };
}

export async function countManagers(ctx: QueryCtx, synagogueId: Id<"synagogues">) {
  const memberships = await ctx.db
    .query("memberships")
    .withIndex("by_synagogue", (q) => q.eq("synagogueId", synagogueId))
    .collect();
  return memberships.filter((m) => isManager(m.role)).length;
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
