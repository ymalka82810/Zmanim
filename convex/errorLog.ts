import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireOwner } from "./roles";

const MAX_LOGS = 200;

/** נקרא ישירות מתוך mutation (יש לו כבר ctx.db). פעולות (actions) קוראות ל-internal.errorLog.log. */
export async function logError(ctx: MutationCtx, source: string, message: string, detail?: string) {
  await ctx.db.insert("errorLogs", {
    source,
    message,
    detail,
    at: Date.now(),
  });
  const all = await ctx.db.query("errorLogs").withIndex("by_at").collect();
  const excess = all.length - MAX_LOGS;
  if (excess > 0) {
    for (const log of all.slice(0, excess)) {
      await ctx.db.delete(log._id);
    }
  }
}

export const log = internalMutation({
  args: {
    source: v.string(),
    message: v.string(),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await logError(ctx, args.source, args.message, args.detail);
  },
});

export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    const limit = Math.min(args.limit ?? 50, MAX_LOGS);
    return await ctx.db.query("errorLogs").withIndex("by_at").order("desc").take(limit);
  },
});
