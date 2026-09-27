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

export async function requireMember(ctx: QueryCtx, synagogueId: Id<"synagogues">) {
  const userId = await requireUser(ctx);
  const membership = await getMembership(ctx, synagogueId, userId);
  if (membership === null) {
    throw new Error("אינך חבר בקהילה הזו");
  }
  return { userId, membership };
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

/** יכול להיות רב אחד בלבד בקהילה. */
export async function assertRabbiAvailable(
  ctx: QueryCtx,
  synagogueId: Id<"synagogues">,
  excludeUserId?: Id<"users">,
) {
  const memberships = await ctx.db
    .query("memberships")
    .withIndex("by_synagogue", (q) => q.eq("synagogueId", synagogueId))
    .collect();
  const hasOtherRabbi = memberships.some((m) => m.role === "rabbi" && m.userId !== excludeUserId);
  if (hasOtherRabbi) {
    throw new Error("יכול להיות רב אחד בלבד בקהילה");
  }
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
