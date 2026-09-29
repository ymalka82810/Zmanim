import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { displayName, requireManager, requireMember } from "./roles";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** איך האירוע מוצג בלוח הזמנים: שורה בלוח (board), מודעה נפרדת (poster), או שניהם (both) */
const showValidator = v.optional(v.union(v.literal("board"), v.literal("poster"), v.literal("both")));
const clip = (s: string, max: number) => s.trim().slice(0, max);

function checkDateKey(dateKey: string) {
  if (!DATE_KEY_RE.test(dateKey)) {
    throw new ConvexError("תאריך לא תקין");
  }
}

async function userName(ctx: QueryCtx, userId: Id<"users">) {
  const user = await ctx.db.get(userId);
  return displayName(user);
}

/** כל האירועים הקהילתיים של הקהילה: לא רק שבתות וחגים, אלא כל תאריך שהגבאי או הרב בחרו להוסיף לו אירוע חופשי. */
export const list = query({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.synagogueId);
    const docs = await ctx.db
      .query("communityEvents")
      .withIndex("by_synagogue_date", (q) => q.eq("synagogueId", args.synagogueId))
      .collect();
    return await Promise.all(
      docs
        .sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : a.createdAt - b.createdAt))
        .map(async (e) => ({
          _id: e._id,
          dateKey: e.dateKey,
          title: e.title,
          details: e.details,
          show: e.show ?? "board",
          createdBy: await userName(ctx, e.createdBy),
          createdAt: e.createdAt,
        })),
    );
  },
});

export const add = mutation({
  args: { synagogueId: v.id("synagogues"), dateKey: v.string(), title: v.string(), details: v.string(), show: showValidator },
  handler: async (ctx, args) => {
    const { userId } = await requireManager(ctx, args.synagogueId);
    checkDateKey(args.dateKey);
    const title = clip(args.title, 80);
    if (!title) {
      throw new ConvexError("נא למלא כותרת לאירוע");
    }
    await ctx.db.insert("communityEvents", {
      synagogueId: args.synagogueId,
      dateKey: args.dateKey,
      title,
      details: clip(args.details, 300),
      show: args.show ?? "board",
      createdBy: userId,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: { synagogueId: v.id("synagogues"), id: v.id("communityEvents"), title: v.string(), details: v.string(), show: showValidator },
  handler: async (ctx, args) => {
    const { userId } = await requireManager(ctx, args.synagogueId);
    const event = await ctx.db.get(args.id);
    if (event === null || event.synagogueId !== args.synagogueId) {
      throw new ConvexError("האירוע לא נמצא");
    }
    const title = clip(args.title, 80);
    if (!title) {
      throw new ConvexError("נא למלא כותרת לאירוע");
    }
    await ctx.db.patch(args.id, {
      title, details: clip(args.details, 300), ...(args.show ? { show: args.show } : {}), editedBy: userId, editedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { synagogueId: v.id("synagogues"), id: v.id("communityEvents") },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    const event = await ctx.db.get(args.id);
    if (event === null || event.synagogueId !== args.synagogueId) {
      throw new ConvexError("האירוע לא נמצא");
    }
    await ctx.db.delete(args.id);
  },
});
