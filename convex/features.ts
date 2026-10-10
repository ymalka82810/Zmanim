import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { displayName, isManager, requireManager, requireMember } from "./roles";

/**
 * פיצ'רים שהקהילה בוחרת אם להשתמש בהם. החשבון, לוח הקידושים, הקופה, יומן הקהילה ולוח הזמנים קיימים תמיד;
 * הפיצ'רים כאן כבויים עד שכל הגבאים והרב מאשרים אותם (גבאי יחיד – האישור שלו מספיק), וכך גם כיבוי שלהם.
 * פיצ'ר כבוי לא מוצג בתפריט, והפונקציות שלו בשרת חסומות.
 */
export const FEATURES = {
  aliyot: "חלוקת עליות",
  week: "השבוע שלי",
  auctions: "מכרז עליות",
} as const;
export type Feature = keyof typeof FEATURES;
export const featureValidator = v.union(v.literal("aliyot"), v.literal("week"), v.literal("auctions"));

export function enabledFeatures(synagogue: Doc<"synagogues"> | null): Feature[] {
  return (synagogue?.features ?? []).filter((f): f is Feature => f in FEATURES);
}

export async function hasFeature(ctx: QueryCtx, synagogueId: Id<"synagogues">, feature: Feature) {
  return enabledFeatures(await ctx.db.get(synagogueId)).includes(feature);
}

export async function requireFeature(ctx: QueryCtx, synagogueId: Id<"synagogues">, feature: Feature) {
  if (!(await hasFeature(ctx, synagogueId, feature))) {
    throw new ConvexError(`${FEATURES[feature]} אינה פעילה בקהילה זו`);
  }
}

async function managerIds(ctx: QueryCtx, synagogueId: Id<"synagogues">) {
  const memberships = await ctx.db
    .query("memberships")
    .withIndex("by_synagogue", (q) => q.eq("synagogueId", synagogueId))
    .collect();
  return memberships.filter((m) => isManager(m.role)).map((m) => m.userId);
}

async function requestsOf(ctx: QueryCtx, synagogueId: Id<"synagogues">) {
  return await ctx.db
    .query("featureRequests")
    .withIndex("by_synagogue", (q) => q.eq("synagogueId", synagogueId))
    .collect();
}

/**
 * בקשה שכל הגבאים והרב הנוכחיים אישרו מתבצעת ונמחקת. נקרא אחרי כל אישור, וגם כשגבאי או רב
 * עוזבים או יורדים מתפקידם – ואז בקשה שחיכתה רק להם מתבצעת.
 */
export async function settleFeatureRequests(ctx: MutationCtx, synagogueId: Id<"synagogues">) {
  const synagogue = await ctx.db.get(synagogueId);
  if (synagogue === null) {
    return;
  }
  const managers = await managerIds(ctx, synagogueId);
  let features = enabledFeatures(synagogue);
  let changed = false;
  for (const r of await requestsOf(ctx, synagogueId)) {
    if (!managers.every((id) => r.approvals.includes(id))) {
      continue;
    }
    const feature = r.feature as Feature;
    features = r.enable ? [...new Set([...features, feature])] : features.filter((f) => f !== feature);
    changed = true;
    await ctx.db.delete(r._id);
  }
  if (changed) {
    await ctx.db.patch(synagogueId, { features });
  }
}

/** מספר הבקשות שממתינות לאישור של המשתמש, לתג בתפריט */
export async function countAwaiting(ctx: QueryCtx, synagogueId: Id<"synagogues">, userId: Id<"users">) {
  return (await requestsOf(ctx, synagogueId)).filter((r) => !r.approvals.includes(userId)).length;
}

/**
 * מצב הפיצ'רים בקהילה. חבר קהילה מקבל רק את רשימת הפעילים; גבאי ורב מקבלים גם את הבקשות הפתוחות,
 * מי כבר אישר ומי עוד לא.
 */
export const status = query({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, args) => {
    const { userId, membership } = await requireMember(ctx, args.synagogueId);
    const enabled = enabledFeatures(await ctx.db.get(args.synagogueId));
    if (!isManager(membership.role)) {
      return { enabled, requests: [] };
    }
    const managers = await managerIds(ctx, args.synagogueId);
    const names = new Map<Id<"users">, string>();
    for (const id of managers) {
      names.set(id, displayName(await ctx.db.get(id)));
    }
    const requests = await Promise.all(
      (await requestsOf(ctx, args.synagogueId)).map(async (r) => ({
        _id: r._id,
        feature: r.feature,
        enable: r.enable,
        requestedBy: names.get(r.requestedBy) ?? displayName(await ctx.db.get(r.requestedBy)),
        approvedByMe: r.approvals.includes(userId),
        approved: managers.filter((id) => r.approvals.includes(id)).map((id) => names.get(id) ?? "משתמש"),
        waiting: managers.filter((id) => !r.approvals.includes(id)).map((id) => names.get(id) ?? "משתמש"),
        createdAt: r.createdAt,
      })),
    );
    return { enabled, requests };
  },
});

/** גבאי או רב מבקשים להפעיל או לכבות פיצ'ר. הבקשה נחשבת כמאושרת על ידו, ומחכה לשאר הגבאים והרב */
export const request = mutation({
  args: { synagogueId: v.id("synagogues"), feature: featureValidator, enable: v.boolean() },
  handler: async (ctx, args) => {
    const { userId } = await requireManager(ctx, args.synagogueId);
    if ((await hasFeature(ctx, args.synagogueId, args.feature)) === args.enable) {
      throw new ConvexError(args.enable ? "הפיצ'ר כבר פעיל" : "הפיצ'ר כבר כבוי");
    }
    const open = (await requestsOf(ctx, args.synagogueId)).find((r) => r.feature === args.feature);
    if (open !== undefined) {
      throw new ConvexError("כבר יש בקשה פתוחה לפיצ'ר הזה");
    }
    await ctx.db.insert("featureRequests", {
      synagogueId: args.synagogueId,
      feature: args.feature,
      enable: args.enable,
      requestedBy: userId,
      approvals: [userId],
      createdAt: Date.now(),
    });
    await settleFeatureRequests(ctx, args.synagogueId);
  },
});

export const approve = mutation({
  args: { synagogueId: v.id("synagogues"), requestId: v.id("featureRequests") },
  handler: async (ctx, args) => {
    const { userId } = await requireManager(ctx, args.synagogueId);
    const r = await ctx.db.get(args.requestId);
    if (r === null || r.synagogueId !== args.synagogueId) {
      throw new ConvexError("הבקשה לא נמצאה");
    }
    if (!r.approvals.includes(userId)) {
      await ctx.db.patch(r._id, { approvals: [...r.approvals, userId] });
    }
    await settleFeatureRequests(ctx, args.synagogueId);
  },
});

/** כל גבאי או הרב יכולים לדחות בקשה (גם מי שביקש אותה - ביטול), והפיצ'ר נשאר במצבו */
export const reject = mutation({
  args: { synagogueId: v.id("synagogues"), requestId: v.id("featureRequests") },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    const r = await ctx.db.get(args.requestId);
    if (r !== null && r.synagogueId === args.synagogueId) {
      await ctx.db.delete(r._id);
    }
  },
});
