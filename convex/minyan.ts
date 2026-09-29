import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { displayName, isManager, requireManager, requireMember } from "./roles";
import * as Notifications from "./notifications";
import { addDays, todayKey } from "./hebrewDate";

/** "אני מגיע" למניין: הגבאי או הרב מגדירים תפילות קבועות (שם, שעה וימים), וחברי הקהילה נרשמים לתאריך מסוים. */

const QUORUM = 10;
/** כמה ימים קדימה מוצגים ואפשר להירשם */
const DAYS_AHEAD = 7;
/** מרווח מינימלי בין שתי קריאות לאותה תפילה באותו יום */
const CALL_GAP_MS = 20 * 60 * 1000;
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const clip = (s: string, max: number) => s.trim().slice(0, max);
const weekday = (dateKey: string) => new Date(Date.parse(dateKey)).getUTCDay();

function checkDateKey(dateKey: string) {
  if (!DATE_KEY_RE.test(dateKey)) {
    throw new ConvexError("תאריך לא תקין");
  }
}

async function userName(ctx: QueryCtx, userId: Id<"users">) {
  const user = await ctx.db.get(userId);
  return displayName(user);
}

async function getMinyan(ctx: QueryCtx, synagogueId: Id<"synagogues">, id: Id<"minyanim">) {
  const m = await ctx.db.get(id);
  if (m === null || m.synagogueId !== synagogueId) {
    throw new ConvexError("התפילה לא נמצאה");
  }
  return m;
}

/**
 * התפילות של הקהילה והרישום אליהן בשבוע שמתחיל ב-from ("YYYY-MM-DD", מהמכשיר).
 * כולם רואים כמה נרשמו; שמות הנרשמים גלויים לגבאי ולרב בלבד.
 */
export const list = query({
  args: { synagogueId: v.id("synagogues"), from: v.string() },
  handler: async (ctx, args) => {
    const { userId, membership } = await requireMember(ctx, args.synagogueId);
    const manager = isManager(membership.role);
    const from = DATE_KEY_RE.test(args.from) ? args.from : todayKey();
    const to = addDays(from, DAYS_AHEAD - 1);
    const minyanim = await ctx.db
      .query("minyanim")
      .withIndex("by_synagogue", (q) => q.eq("synagogueId", args.synagogueId))
      .collect();
    minyanim.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : a.createdAt - b.createdAt));
    const rsvps = await ctx.db
      .query("minyanRsvps")
      .withIndex("by_synagogue_date", (q) => q.eq("synagogueId", args.synagogueId).gte("dateKey", from).lte("dateKey", to))
      .collect();

    const days = [];
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const dateKey = addDays(from, i);
      const dow = weekday(dateKey);
      const items = [];
      for (const m of minyanim.filter((x) => x.days.includes(dow))) {
        const here = rsvps.filter((r) => r.minyanId === m._id && r.dateKey === dateKey);
        items.push({
          minyanId: m._id,
          count: here.length,
          mine: here.some((r) => r.userId === userId),
          names: manager ? await Promise.all(here.map((r) => userName(ctx, r.userId))) : [],
        });
      }
      if (items.length) {
        days.push({ dateKey, items });
      }
    }
    return {
      role: membership.role,
      quorum: QUORUM,
      minyanim: minyanim.map((m) => ({ _id: m._id, name: m.name, time: m.time, days: m.days })),
      days,
    };
  },
});

export const rsvp = mutation({
  args: { synagogueId: v.id("synagogues"), minyanId: v.id("minyanim"), dateKey: v.string(), coming: v.boolean() },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.synagogueId);
    checkDateKey(args.dateKey);
    const m = await getMinyan(ctx, args.synagogueId, args.minyanId);
    const existing = await ctx.db
      .query("minyanRsvps")
      .withIndex("by_minyan_date_user", (q) => q.eq("minyanId", args.minyanId).eq("dateKey", args.dateKey).eq("userId", userId))
      .unique();
    if (!args.coming) {
      if (existing) {
        await ctx.db.delete(existing._id);
      }
      return;
    }
    if (existing) {
      return;
    }
    if (!m.days.includes(weekday(args.dateKey))) {
      throw new ConvexError(`${m.name} לא מתקיימת ביום זה`);
    }
    // יום אחד אחורה, בגלל הפרש אזורי זמן בין המכשיר לשרת
    if (args.dateKey < addDays(todayKey(), -1) || args.dateKey > addDays(todayKey(), DAYS_AHEAD + 1)) {
      throw new ConvexError("אפשר להירשם רק לתפילות של השבוע הקרוב");
    }
    await ctx.db.insert("minyanRsvps", {
      synagogueId: args.synagogueId,
      minyanId: args.minyanId,
      dateKey: args.dateKey,
      userId,
      at: Date.now(),
    });
  },
});

const minyanFields = { name: v.string(), time: v.string(), days: v.array(v.number()) };

function cleanMinyan(args: { name: string; time: string; days: number[] }) {
  const name = clip(args.name, 40);
  if (!name) {
    throw new ConvexError("נא למלא שם לתפילה");
  }
  const days = [...new Set(args.days)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
  if (!days.length) {
    throw new ConvexError("נא לבחור לפחות יום אחד");
  }
  return { name, time: clip(args.time, 20), days };
}

export const addMinyan = mutation({
  args: { synagogueId: v.id("synagogues"), ...minyanFields },
  handler: async (ctx, { synagogueId, ...rest }) => {
    const { userId } = await requireManager(ctx, synagogueId);
    await ctx.db.insert("minyanim", { synagogueId, ...cleanMinyan(rest), createdBy: userId, createdAt: Date.now() });
  },
});

export const updateMinyan = mutation({
  args: { synagogueId: v.id("synagogues"), id: v.id("minyanim"), ...minyanFields },
  handler: async (ctx, { synagogueId, id, ...rest }) => {
    await requireManager(ctx, synagogueId);
    await getMinyan(ctx, synagogueId, id);
    await ctx.db.patch(id, cleanMinyan(rest));
  },
});

export const removeMinyan = mutation({
  args: { synagogueId: v.id("synagogues"), id: v.id("minyanim") },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    await getMinyan(ctx, args.synagogueId, args.id);
    const rsvps = await ctx.db
      .query("minyanRsvps")
      .withIndex("by_synagogue_date", (q) => q.eq("synagogueId", args.synagogueId).gte("dateKey", addDays(todayKey(), -1)))
      .collect();
    for (const r of rsvps.filter((r) => r.minyanId === args.id)) {
      await ctx.db.delete(r._id);
    }
    await ctx.db.delete(args.id);
  },
});

/** קריאה לכל חברי הקהילה כשחסרים אנשים למניין ("חסרים 2 למנחה"). */
export const call = mutation({
  args: { synagogueId: v.id("synagogues"), minyanId: v.id("minyanim"), dateKey: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireManager(ctx, args.synagogueId);
    checkDateKey(args.dateKey);
    const m = await getMinyan(ctx, args.synagogueId, args.minyanId);
    const count = (
      await ctx.db
        .query("minyanRsvps")
        .withIndex("by_synagogue_date", (q) => q.eq("synagogueId", args.synagogueId).eq("dateKey", args.dateKey))
        .collect()
    ).filter((r) => r.minyanId === args.minyanId).length;
    const missing = QUORUM - count;
    if (missing <= 0) {
      throw new ConvexError("כבר יש מניין");
    }
    const recent = await ctx.db
      .query("notifications")
      .withIndex("by_synagogue_type_at", (q) =>
        q.eq("synagogueId", args.synagogueId).eq("type", "minyan").gt("at", Date.now() - CALL_GAP_MS),
      )
      .collect();
    const prefix = `${m.name} · `;
    if (recent.some((n) => n.dateKey === args.dateKey && n.text.includes(prefix))) {
      throw new ConvexError("כבר נשלחה קריאה לתפילה הזו לפני פחות מ-20 דקות");
    }
    const [, mm, dd] = args.dateKey.split("-").map(Number);
    const isToday = args.dateKey === todayKey();
    const when = isToday ? "היום" : `ביום ${DAY_NAMES[weekday(args.dateKey)]} ${dd}.${mm}`;
    const need = missing === 1 ? "חסר אחד" : `חסרים ${missing}`;
    await Notifications.create(ctx, {
      synagogueId: args.synagogueId,
      type: "minyan",
      to: "members",
      text: `${need} למניין! ${prefix}${when}${m.time ? " ב-" + m.time : ""}. מי שיכול להגיע – נא ללחוץ "אני מגיע".`,
      by: userId,
      dateKey: args.dateKey,
    });
  },
});
