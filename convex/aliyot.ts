import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { addDays, hebrewYearOf, nextYahrzeit, todayKey } from "./hebrewDate";
import { displayName, getMembership, isManager, requireManager, requireMember } from "./roles";
import { requireFeature } from "./features";

/** סוגי חיוב לעלייה, לפי סדר הקדימות: הראשון ברשימה קודם לכל האחרים */
export const REASONS = {
  chatan: "חתן",
  barMitzvah: "בר מצווה",
  birth: "אבי הבן/הבת",
  yahrzeit: "אזכרה",
  other: "אחר",
} as const;
type Reason = keyof typeof REASONS;
const reasonValidator = v.union(...(Object.keys(REASONS) as Reason[]).map((r) => v.literal(r)));
const tribeValidator = v.union(v.literal("kohen"), v.literal("levi"), v.literal("israel"));

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
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

/** אזכרות שחלות מהתאריך עד שישה ימים אחריו: מי שיש לו אזכרה בשבוע הקרוב עולה בשבת שלפניה. */
async function yahrzeitsInWeek(ctx: QueryCtx, synagogueId: Id<"synagogues">, dateKey: string) {
  const end = addDays(dateKey, 6);
  const docs = await ctx.db
    .query("yahrzeits")
    .withIndex("by_synagogue", (q) => q.eq("synagogueId", synagogueId))
    .collect();
  const out: { doc: Doc<"yahrzeits">; dateKey: string }[] = [];
  for (const y of docs) {
    const k = nextYahrzeit(y, dateKey);
    if (k !== null && k <= end && y.hYear < hebrewYearOf(k)) {
      out.push({ doc: y, dateKey: k });
    }
  }
  return out;
}

async function allAliyot(ctx: QueryCtx, synagogueId: Id<"synagogues">) {
  return await ctx.db
    .query("aliyot")
    .withIndex("by_synagogue_date", (q) => q.eq("synagogueId", synagogueId))
    .collect();
}

const givenView = (a: Doc<"aliyot">) => ({
  _id: a._id, dateKey: a.dateKey, aliyah: a.aliyah, userId: a.userId ?? null, name: a.name,
  reason: a.reason ?? null, reasonLabel: a.reason ? (REASONS[a.reason as Reason] ?? a.reason) : null,
});

/**
 * חלוקת העליות לתאריך מסוים (בדרך כלל שבת). הגבאי והרב מקבלים את מה שכבר חולק, את החיובים
 * (שנרשמו לתאריך, ואזכרות מהשבוע שמתחיל בו), ואת חברי הקהילה לפי מי שלא עלה הכי הרבה זמן.
 * חבר קהילה מקבל רק את העליות והחיובים שלו.
 */
export const board = query({
  args: { synagogueId: v.id("synagogues"), dateKey: v.string() },
  handler: async (ctx, args) => {
    const { userId, membership } = await requireMember(ctx, args.synagogueId);
    await requireFeature(ctx, args.synagogueId, "aliyot");
    checkDateKey(args.dateKey);
    const synagogue = await ctx.db.get(args.synagogueId);
    const base = {
      role: membership.role,
      me: userId,
      myTribe: membership.tribe ?? "israel",
      synagogue: { name: synagogue?.name ?? "", city: synagogue?.city ?? "", il: synagogue?.il ?? true },
      reasons: REASONS,
    };
    const aliyot = await allAliyot(ctx, args.synagogueId);
    const claimsOfDate = await ctx.db
      .query("aliyahClaims")
      .withIndex("by_synagogue_date", (q) => q.eq("synagogueId", args.synagogueId).eq("dateKey", args.dateKey))
      .collect();

    if (!isManager(membership.role)) {
      const today = todayKey();
      const futureClaims = await ctx.db
        .query("aliyahClaims")
        .withIndex("by_synagogue_date", (q) => q.eq("synagogueId", args.synagogueId).gte("dateKey", today))
        .collect();
      return {
        ...base,
        manager: false as const,
        mine: aliyot.filter((a) => a.userId === userId).sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1)).map(givenView),
        myClaims: futureClaims
          .filter((c) => c.userId === userId)
          .map((c) => ({ _id: c._id, dateKey: c.dateKey, reason: c.reason, reasonLabel: REASONS[c.reason as Reason] ?? c.reason, note: c.note })),
      };
    }

    const given = aliyot.filter((a) => a.dateKey === args.dateKey);
    const givenUsers = new Set(given.map((a) => a.userId).filter((u) => u !== undefined));
    const givenNames = new Set(given.map((a) => a.name));
    const isGiven = (u: Id<"users"> | undefined, name: string) => (u ? givenUsers.has(u) : givenNames.has(name));

    const rank = (r: string) => {
      const i = Object.keys(REASONS).indexOf(r);
      return i < 0 ? 99 : i;
    };
    const chiyuvim = [
      ...(await Promise.all(claimsOfDate.map(async (c) => {
        const name = c.userId ? await userName(ctx, c.userId) : c.name;
        return {
          key: c._id as string, claimId: c._id, source: "claim" as const, dateKey: c.dateKey, reason: c.reason,
          reasonLabel: REASONS[c.reason as Reason] ?? c.reason, userId: c.userId ?? null, name, note: c.note,
          given: isGiven(c.userId, name),
        };
      }))),
      ...(await Promise.all((await yahrzeitsInWeek(ctx, args.synagogueId, args.dateKey)).map(async ({ doc, dateKey }) => {
        const name = await userName(ctx, doc.userId);
        return {
          key: "y:" + doc._id, claimId: null, source: "yahrzeit" as const, dateKey, reason: "yahrzeit",
          reasonLabel: REASONS.yahrzeit, userId: doc.userId, name,
          note: `${doc.relation ? doc.relation + " " : ""}${doc.name}`.trim(), given: givenUsers.has(doc.userId),
        };
      }))),
    ].sort((a, b) => rank(a.reason) - rank(b.reason) || (a.dateKey < b.dateKey ? -1 : 1));

    // חברי הקהילה לפי העלייה האחרונה שלפני התאריך: מי שלא עלה אף פעם ראשון, ואחריו מי שעלה הכי מזמן
    const since = addDays(args.dateKey, -365);
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_synagogue", (q) => q.eq("synagogueId", args.synagogueId))
      .collect();
    const members = await Promise.all(memberships.map(async (m) => {
      const mine = aliyot.filter((a) => a.userId === m.userId && a.dateKey < args.dateKey);
      const last = mine.reduce<string | null>((max, a) => (max === null || a.dateKey > max ? a.dateKey : max), null);
      return {
        userId: m.userId,
        name: await userName(ctx, m.userId),
        tribe: m.tribe ?? "israel",
        last,
        countYear: mine.filter((a) => a.dateKey >= since).length,
        given: givenUsers.has(m.userId),
      };
    }));
    members.sort((a, b) => (a.last === b.last ? a.name.localeCompare(b.name, "he") : a.last === null ? -1 : b.last === null ? 1 : a.last < b.last ? -1 : 1));

    return {
      ...base,
      manager: true as const,
      given: given.sort((a, b) => a.createdAt - b.createdAt).map(givenView),
      chiyuvim,
      members,
      // כל התאריכים שנרשמו בהם עליות, לדפדוף בין ימים גם כשאינם שבת או יום קריאה קבוע
      aliyotDates: [...new Set(aliyot.map((a) => a.dateKey))],
      recent: aliyot.sort((a, b) => (a.dateKey < b.dateKey ? 1 : a.dateKey > b.dateKey ? -1 : b.createdAt - a.createdAt)).slice(0, 150).map(givenView),
    };
  },
});

export const add = mutation({
  args: {
    synagogueId: v.id("synagogues"),
    dateKey: v.string(),
    aliyah: v.string(),
    userId: v.optional(v.id("users")),
    name: v.optional(v.string()),
    reason: v.optional(reasonValidator),
  },
  handler: async (ctx, args) => {
    const { userId: callerId } = await requireManager(ctx, args.synagogueId);
    await requireFeature(ctx, args.synagogueId, "aliyot");
    checkDateKey(args.dateKey);
    const aliyah = clip(args.aliyah, 40);
    if (!aliyah) {
      throw new ConvexError("נא לבחור עלייה");
    }
    let name = clip(args.name ?? "", 80);
    if (args.userId) {
      const membership = await getMembership(ctx, args.synagogueId, args.userId);
      if (membership === null) {
        throw new ConvexError("החבר לא נמצא בקהילה");
      }
      if ((aliyah === "כהן" || aliyah === "לוי") && (membership.tribe ?? "israel") === "israel") {
        throw new ConvexError("מי שמסומן ישראל לא יכול לעלות לעליית כהן או לוי");
      }
      name = await userName(ctx, args.userId);
    }
    if (!name) {
      throw new ConvexError("נא לבחור חבר קהילה או לכתוב שם");
    }
    return await ctx.db.insert("aliyot", {
      synagogueId: args.synagogueId,
      dateKey: args.dateKey,
      aliyah,
      ...(args.userId ? { userId: args.userId } : {}),
      name,
      ...(args.reason ? { reason: args.reason } : {}),
      createdBy: callerId,
      createdAt: Date.now(),
      hebrewYear: hebrewYearOf(args.dateKey),
    });
  },
});

export const remove = mutation({
  args: { synagogueId: v.id("synagogues"), id: v.id("aliyot") },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    await requireFeature(ctx, args.synagogueId, "aliyot");
    const aliyah = await ctx.db.get(args.id);
    if (aliyah === null || aliyah.synagogueId !== args.synagogueId) {
      throw new ConvexError("העלייה לא נמצאה");
    }
    await ctx.db.delete(args.id);
  },
});

/** רישום חיוב לתאריך. הגבאי והרב רושמים לכל אחד (גם אורח בשם בלבד); חבר קהילה רושם רק לעצמו. */
export const addClaim = mutation({
  args: {
    synagogueId: v.id("synagogues"),
    dateKey: v.string(),
    reason: reasonValidator,
    userId: v.optional(v.id("users")),
    name: v.optional(v.string()),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId: callerId, membership } = await requireMember(ctx, args.synagogueId);
    await requireFeature(ctx, args.synagogueId, "aliyot");
    checkDateKey(args.dateKey);
    const manager = isManager(membership.role);
    const target = manager ? args.userId : callerId;
    let name = manager ? clip(args.name ?? "", 80) : "";
    if (target) {
      if ((await getMembership(ctx, args.synagogueId, target)) === null) {
        throw new ConvexError("החבר לא נמצא בקהילה");
      }
      name = await userName(ctx, target);
    }
    if (!name) {
      throw new ConvexError("נא לבחור חבר קהילה או לכתוב שם");
    }
    await ctx.db.insert("aliyahClaims", {
      synagogueId: args.synagogueId,
      dateKey: args.dateKey,
      reason: args.reason,
      ...(target ? { userId: target } : {}),
      name,
      note: clip(args.note, 120),
      createdBy: callerId,
      createdAt: Date.now(),
    });
  },
});

export const removeClaim = mutation({
  args: { synagogueId: v.id("synagogues"), id: v.id("aliyahClaims") },
  handler: async (ctx, args) => {
    const { userId, membership } = await requireMember(ctx, args.synagogueId);
    await requireFeature(ctx, args.synagogueId, "aliyot");
    const claim = await ctx.db.get(args.id);
    if (claim === null || claim.synagogueId !== args.synagogueId) {
      throw new ConvexError("החיוב לא נמצא");
    }
    if (!isManager(membership.role) && claim.userId !== userId) {
      throw new ConvexError("אפשר למחוק רק חיוב שלך");
    }
    await ctx.db.delete(args.id);
  },
});

/** כהן / לוי / ישראל. הגבאי והרב מעדכנים לכל חבר, וחבר קהילה לעצמו. */
export const setTribe = mutation({
  args: { synagogueId: v.id("synagogues"), userId: v.optional(v.id("users")), tribe: tribeValidator },
  handler: async (ctx, args) => {
    const { userId: callerId, membership: callerMembership } = await requireMember(ctx, args.synagogueId);
    await requireFeature(ctx, args.synagogueId, "aliyot");
    const target = args.userId ?? callerId;
    if (target !== callerId && !isManager(callerMembership.role)) {
      throw new ConvexError("פעולה זו מותרת לגבאי או לרב בלבד");
    }
    const membership = await getMembership(ctx, args.synagogueId, target);
    if (membership === null) {
      throw new ConvexError("החבר לא נמצא בקהילה");
    }
    await ctx.db.patch(membership._id, { tribe: args.tribe === "israel" ? undefined : args.tribe });
  },
});
