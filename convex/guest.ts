import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { randomInviteCode } from "./inviteCode";
import { requireManager } from "./roles";

const DAY = 24 * 60 * 60 * 1000;
// שעון ישראל בקירוב (UTC+3), מספיק כדי לדעת איזה יום היום
const dayKey = (t: number) => new Date(t + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

/**
 * העמוד הציבורי לאורחים (guest/?c=...), בלי התחברות: שם הקהילה, הכתובת ולוחות הזמנים המאושרים
 * של השבוע הזה והלאה. אם אין כאלה – שני הלוחות המאושרים האחרונים. קוד לא קיים או עמוד כבוי – null.
 */
export const board = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    if (!args.code) {
      return null;
    }
    const synagogue = await ctx.db
      .query("synagogues")
      .withIndex("by_public", (q) => q.eq("publicCode", args.code))
      .unique();
    if (synagogue === null) {
      return null;
    }
    const visible = (f: Doc<"scheduleFiles">) => f.status === "approved" && f.deletedAt === undefined;
    // לוח שבועי מתחיל ביום ראשון ונמשך עד שישי; לוח שבת/חג מתחיל ביום הקדוש הראשון ונמשך עד שלושה ימים
    const now = Date.now();
    const current = (f: Doc<"scheduleFiles">) =>
      f.firstDate >= dayKey(now - (f.mode === "days" ? 5 : f.mode === "holy" ? 2 : 0) * DAY);
    let files = (
      await ctx.db
        .query("scheduleFiles")
        .withIndex("by_synagogue_first", (q) => q.eq("synagogueId", synagogue._id).gte("firstDate", dayKey(now - 6 * DAY)))
        .take(40)
    )
      .filter((f) => visible(f) && current(f))
      .slice(0, 6);
    if (files.length === 0) {
      files = (
        await ctx.db
          .query("scheduleFiles")
          .withIndex("by_synagogue_first", (q) => q.eq("synagogueId", synagogue._id))
          .order("desc")
          .take(40)
      )
        .filter(visible)
        .slice(0, 2);
    }
    return {
      name: synagogue.name,
      city: synagogue.city,
      address: synagogue.address ?? "",
      files: await Promise.all(
        files.map(async (f) => ({
          _id: f._id,
          title: f.title,
          firstDate: f.firstDate,
          mode: f.mode,
          url: await ctx.storage.getUrl(f.storageId),
        })),
      ),
    };
  },
});

/** הפעלת העמוד הציבורי (אם כבר פעיל – הקוד נשאר), או החלפת הקוד כדי שהקישור הישן יפסיק לעבוד */
export const enable = mutation({
  args: { synagogueId: v.id("synagogues"), rotate: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    const synagogue = await ctx.db.get(args.synagogueId);
    if (synagogue?.publicCode && !args.rotate) {
      return synagogue.publicCode;
    }
    const publicCode = randomInviteCode() + randomInviteCode();
    await ctx.db.patch(args.synagogueId, { publicCode });
    return publicCode;
  },
});

export const disable = mutation({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    await ctx.db.patch(args.synagogueId, { publicCode: undefined });
  },
});
