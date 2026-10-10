import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { displayName, isManager, requireMember } from "./roles";
import { logError } from "./errorLog";
import { enabledFeatures, hasFeature, requireFeature } from "./features";
import * as Notifications from "./notifications";
import { addDays, daysBetween, hebrewDateText, isValidHebrewDate, nextYahrzeit, todayKey } from "./hebrewDate";

/** כמה ימים לפני האזכרה נשלחת תזכורת לחבר שהזין אותה */
const REMIND_DAYS = 7;
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const clip = (s: string, max: number) => s.trim().slice(0, max);

async function userName(ctx: QueryCtx, userId: Id<"users">) {
  const user = await ctx.db.get(userId);
  return displayName(user);
}

/**
 * אזכרות הקהילה. חבר רואה את שלו ואת אלה שסומנו כגלויות לקהילה; גבאי ורב רואים הכול.
 * today ("YYYY-MM-DD", מהמכשיר) קובע את "האזכרה הקרובה", כדי שהשאילתה לא תהיה תלויה בשעון השרת.
 */
export const list = query({
  args: { synagogueId: v.id("synagogues"), today: v.string() },
  handler: async (ctx, args) => {
    const { userId, membership } = await requireMember(ctx, args.synagogueId);
    const manager = isManager(membership.role);
    // האזכרות שייכות ל"השבוע שלי". כשהוא כבוי יומן הקהילה פשוט לא מציג אזכרות
    if (!(await hasFeature(ctx, args.synagogueId, "week"))) {
      return { role: membership.role, items: [] };
    }
    const today = DATE_KEY_RE.test(args.today) ? args.today : todayKey();
    const docs = await ctx.db
      .query("yahrzeits")
      .withIndex("by_synagogue", (q) => q.eq("synagogueId", args.synagogueId))
      .collect();
    const names = new Map<Id<"users">, string>();
    const items = [];
    for (const y of docs) {
      const mine = y.userId === userId;
      if (!mine && !y.shared && !manager) {
        continue;
      }
      if (!names.has(y.userId)) {
        names.set(y.userId, await userName(ctx, y.userId));
      }
      items.push({
        _id: y._id,
        name: y.name,
        relation: y.relation,
        hDay: y.hDay,
        hMonth: y.hMonth,
        hYear: y.hYear,
        hebrewDate: hebrewDateText(y.hDay, y.hMonth, y.hYear),
        next: nextYahrzeit(y, today),
        shared: y.shared,
        mine,
        owner: names.get(y.userId) ?? "משתמש",
      });
    }
    items.sort((a, b) => ((a.next ?? "9") < (b.next ?? "9") ? -1 : 1));
    return { role: membership.role, items };
  },
});

const fields = {
  name: v.string(),
  relation: v.string(),
  hDay: v.number(),
  hMonth: v.number(),
  hYear: v.number(),
  shared: v.boolean(),
};

function cleanFields(args: { name: string; relation: string; hDay: number; hMonth: number; hYear: number; shared: boolean }) {
  const name = clip(args.name, 80);
  if (!name) {
    throw new ConvexError("נא למלא את שם הנפטר");
  }
  if (!isValidHebrewDate(args.hDay, args.hMonth, args.hYear)) {
    throw new ConvexError("תאריך הפטירה העברי לא תקין");
  }
  if (nextYahrzeit(args, todayKey()) === null) {
    throw new ConvexError("תאריך הפטירה לא יכול להיות בעתיד");
  }
  return { name, relation: clip(args.relation, 40), hDay: args.hDay, hMonth: args.hMonth, hYear: args.hYear, shared: args.shared };
}

async function editable(ctx: QueryCtx, synagogueId: Id<"synagogues">, id: Id<"yahrzeits">) {
  const { userId, membership } = await requireMember(ctx, synagogueId);
  await requireFeature(ctx, synagogueId, "week");
  const y = await ctx.db.get(id);
  if (y === null || y.synagogueId !== synagogueId) {
    throw new ConvexError("האזכרה לא נמצאה");
  }
  if (y.userId !== userId && !isManager(membership.role)) {
    throw new ConvexError("אפשר לערוך רק אזכרות שהזנת");
  }
  return y;
}

export const add = mutation({
  args: { synagogueId: v.id("synagogues"), ...fields },
  handler: async (ctx, { synagogueId, ...rest }) => {
    const { userId } = await requireMember(ctx, synagogueId);
    await requireFeature(ctx, synagogueId, "week");
    return await ctx.db.insert("yahrzeits", { synagogueId, userId, ...cleanFields(rest), createdAt: Date.now() });
  },
});

export const update = mutation({
  args: { synagogueId: v.id("synagogues"), id: v.id("yahrzeits"), ...fields },
  handler: async (ctx, { synagogueId, id, ...rest }) => {
    const y = await editable(ctx, synagogueId, id);
    const data = cleanFields(rest);
    const dateChanged = data.hDay !== y.hDay || data.hMonth !== y.hMonth || data.hYear !== y.hYear;
    await ctx.db.patch(id, { ...data, ...(dateChanged ? { remindedFor: undefined } : {}) });
  },
});

export const remove = mutation({
  args: { synagogueId: v.id("synagogues"), id: v.id("yahrzeits") },
  handler: async (ctx, args) => {
    await editable(ctx, args.synagogueId, args.id);
    await ctx.db.delete(args.id);
  },
});

function reminderText(y: Doc<"yahrzeits">, dateKey: string, days: number) {
  const [yy, mm, dd] = dateKey.split("-").map(Number);
  const greg = `${dd}.${mm}.${yy}`;
  const who = y.relation ? `${y.name} (${y.relation})` : y.name;
  const when = days === REMIND_DAYS ? "בעוד שבוע" : days === 1 ? "מחר" : `בעוד ${days} ימים`;
  return `תזכורת: האזכרה של ${who} חלה ${when}, ב-${greg}. היארצייט מתחיל בערב שלפני.`;
}

/** תזכורת יומית: שבוע (או פחות, אם ה-cron פספס יום) לפני כל אזכרה, פעם אחת לכל שנה, לחבר שהזין אותה. */
export const sendReminders = internalMutation({
  args: {},
  handler: async (ctx) => {
    try {
      // רק קהילות שהפיצ'ר week מופעל בהן, וכל קהילה במוטציה נפרדת כדי לא לחרוג ממגבלות הקריאות
      for (const synagogue of await ctx.db.query("synagogues").collect()) {
        if (enabledFeatures(synagogue).includes("week")) {
          await ctx.scheduler.runAfter(0, internal.yahrzeits.sendForSynagogue, { synagogueId: synagogue._id });
        }
      }
    } catch (err) {
      console.error("שליחת תזכורות אזכרה נכשלה", err);
      await logError(ctx, "yahrzeit-reminders", "שליחת תזכורות אזכרה נכשלה", err instanceof Error ? err.message : String(err));
    }
  },
});

export const sendForSynagogue = internalMutation({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, { synagogueId }) => {
    try {
      const today = todayKey();
      const docs = await ctx.db
        .query("yahrzeits")
        .withIndex("by_synagogue", (q) => q.eq("synagogueId", synagogueId))
        .collect();
      for (const y of docs) {
        const next = nextYahrzeit(y, addDays(today, 1));
        const days = next === null ? Infinity : daysBetween(today, next);
        if (next === null || next === y.remindedFor || days > REMIND_DAYS) {
          continue;
        }
        await Notifications.create(ctx, {
          synagogueId: y.synagogueId,
          type: "yahrzeit",
          to: y.userId,
          text: reminderText(y, next, days),
          dateKey: next,
        });
        await ctx.db.patch(y._id, { remindedFor: next });
      }
    } catch (err) {
      console.error("שליחת תזכורות אזכרה נכשלה", err);
      await logError(ctx, "yahrzeit-reminders", "שליחת תזכורות אזכרה נכשלה", err instanceof Error ? err.message : String(err));
    }
  },
});
