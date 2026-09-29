import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { displayName, isManager, requireManager, requireMember } from "./roles";
import { requireFeature } from "./features";
import * as Notifications from "./notifications";
import { addDays, todayKey } from "./hebrewDate";
import { checkConfig } from "./zmanimSettings";
// ההגדרות של לוח הזמנים באתר, כדי שהכללים שנוספים כאן ייבנו בדיוק כמו שם
import { BASES, DAY_APPLIES, TEXT_BASES, appliesOnDay, normalize } from "../js/config.js";

const BASE_KEYS = BASES as Record<string, string>;

/** "אני מגיע" למניין: הגבאי או הרב מגדירים תפילות קבועות (שם, שעה וימים), וחברי הקהילה נרשמים לתאריך מסוים.
 * כל תפילה נרשמת גם כתפילה בהגדרות לוח הזמנים (syncSchedule). */

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
    await requireFeature(ctx, args.synagogueId, "week");
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
    await requireFeature(ctx, args.synagogueId, "week");
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

/* ---------- התפילה בלוח הזמנים ---------- */

type Rule = { name: string; when: string; applies: string; base: string; offset: string; round: string; minyanId?: string };
type Template = { id: string; rules: Rule[] };

/**
 * השעה של התפילה ככלל בלוח הזמנים: שעה קבועה ("13:30"), או הפרש מזמן היום ("10 דקות לפני השקיעה").
 * null – השעה ריקה או לא מזוהה, ואז התפילה לא נכנסת ללוח.
 */
function ruleTiming(time: string) {
  const t = time.trim();
  const fixed = t.match(/^(\d{1,2})[:.](\d{2})$/);
  if (fixed) {
    return +fixed[1] < 24 && +fixed[2] < 60 ? { base: "שעה קבועה", offset: fixed[1].padStart(2, "0") + ":" + fixed[2] } : null;
  }
  // הזמן הארוך קודם, כדי ש"צאת הכוכבים" לא ייתפס כזמן קצר יותר שמוכל בו
  const base = Object.keys(BASE_KEYS)
    .filter((l) => l !== "שעה קבועה" && !TEXT_BASES.includes(BASE_KEYS[l]))
    .sort((a, b) => b.length - a.length)
    .find((l) => t.includes(l));
  if (!base) {
    return null;
  }
  const minutes = +(t.match(/\d+/)?.[0] ?? 0);
  return { base, offset: String(/לפני/.test(t) ? -minutes : minutes) };
}

/** הימים בשבוע (0–5) שהערך של "חל על" בלוח ימות השבוע מכסה, או null אם הוא תלוי בערב שבת וחג */
function dowsOf(applies: string) {
  const on = (erev: boolean) => [0, 1, 2, 3, 4, 5].filter((dow) => appliesOnDay(applies, { dow, erev })).join();
  return on(false) === on(true) ? on(false) : null;
}

/** ערכי "חל על" לימים (0–5): ערך אחד אם יש כזה בדיוק לימים האלה, אחרת ערך לכל יום */
function weekApplies(days: number[]): string[] {
  const exact = (key: string) => (DAY_APPLIES as string[]).find((a) => dowsOf(a) === key);
  const all = exact(days.join());
  return all ? [all] : days.map((d) => exact(String(d))!);
}

/**
 * התפילה נרשמת גם בהגדרות לוח הזמנים של הקהילה: ימי חול בתבנית "ימות השבוע" ושבת בתבנית "שבתות".
 * הכללים מסומנים ב-minyanId, כך שעריכה או מחיקה של התפילה מעדכנות אותם. m=null – מחיקה.
 * כלל ספציפי גובר בלוח על כלל כללי באותו שם, ולכן תפילה בשם קיים (למשל "מנחה") קובעת את השעה בימים שלה.
 * מחזיר האם התפילה נמצאת עכשיו בלוח.
 */
async function syncSchedule(
  ctx: MutationCtx,
  synagogueId: Id<"synagogues">,
  userId: Id<"users">,
  minyanId: Id<"minyanim">,
  m: { name: string; time: string; days: number[] } | null,
) {
  const doc = await ctx.db
    .query("zmanimSettings")
    .withIndex("by_synagogue", (q) => q.eq("synagogueId", synagogueId))
    .unique();
  const cfg = normalize(doc ? JSON.parse(doc.config) : null) as unknown as { templates: Template[] };
  let changed = false;
  for (const t of cfg.templates) {
    const rules = t.rules.filter((r) => r.minyanId !== minyanId);
    changed ||= rules.length !== t.rules.length;
    t.rules = rules;
  }
  const timing = m && ruleTiming(m.time);
  if (m && timing) {
    // בראש הרשימה, כדי שבשוויון עם כלל קיים באותו שם ובאותם ימים התפילה תגבר
    const add = (id: string, applies: string[]) => {
      const t = cfg.templates.find((x) => x.id === id);
      t?.rules.unshift(...applies.map((a) => ({ name: m.name, when: "כל יום", applies: a, ...timing, round: "ללא", minyanId })));
    };
    const week = m.days.filter((d) => d < 6);
    if (week.length) add("week", weekApplies(week));
    if (m.days.includes(6)) add("shabbat", ["שבת בלבד"]);
    changed = true;
  }
  if (!changed) {
    return !!timing;
  }
  const config = JSON.stringify(cfg);
  checkConfig(config);
  const now = Date.now();
  if (doc === null) {
    await ctx.db.insert("zmanimSettings", { synagogueId, config, rev: 1, updatedBy: userId, updatedAt: now });
  } else {
    await ctx.db.patch(doc._id, { config, rev: doc.rev + 1, updatedBy: userId, updatedAt: now });
  }
  return !!timing;
}

/** מחזירות { scheduled }: האם התפילה נכנסה גם ללוח הזמנים (לא נכנסת כשהשעה ריקה או לא מזוהה) */
export const addMinyan = mutation({
  args: { synagogueId: v.id("synagogues"), ...minyanFields },
  handler: async (ctx, { synagogueId, ...rest }) => {
    const { userId } = await requireManager(ctx, synagogueId);
    await requireFeature(ctx, synagogueId, "week");
    const m = cleanMinyan(rest);
    const id = await ctx.db.insert("minyanim", { synagogueId, ...m, createdBy: userId, createdAt: Date.now() });
    return { scheduled: await syncSchedule(ctx, synagogueId, userId, id, m) };
  },
});

export const updateMinyan = mutation({
  args: { synagogueId: v.id("synagogues"), id: v.id("minyanim"), ...minyanFields },
  handler: async (ctx, { synagogueId, id, ...rest }) => {
    const { userId } = await requireManager(ctx, synagogueId);
    await requireFeature(ctx, synagogueId, "week");
    await getMinyan(ctx, synagogueId, id);
    const m = cleanMinyan(rest);
    await ctx.db.patch(id, m);
    return { scheduled: await syncSchedule(ctx, synagogueId, userId, id, m) };
  },
});

export const removeMinyan = mutation({
  args: { synagogueId: v.id("synagogues"), id: v.id("minyanim") },
  handler: async (ctx, args) => {
    const { userId } = await requireManager(ctx, args.synagogueId);
    await requireFeature(ctx, args.synagogueId, "week");
    await syncSchedule(ctx, args.synagogueId, userId, args.id, null);
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
    await requireFeature(ctx, args.synagogueId, "week");
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
