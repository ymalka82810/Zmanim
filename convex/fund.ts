import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getMembership, isManager, requireManager, requireMember } from "./roles";
import { fundTypeValidator } from "./schema";
import { logError } from "./errorLog";
import * as Notifications from "./notifications";
import { hebrewYearOf } from "./hebrewDate";

const PLEDGE_TYPES = v.union(v.literal("donation"), v.literal("mitzvah"));
const REMINDER_DAYS = 5;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DONOR_TYPES = new Set(["donation", "mitzvah"]);
const INCOME_TYPES = new Set(["donation", "mitzvah", "salary"]);

const txFields = {
  type: fundTypeValidator,
  amount: v.number(),
  date: v.string(),
  donorId: v.optional(v.union(v.id("users"), v.null())),
  name: v.optional(v.string()),
  desc: v.optional(v.string()),
  method: v.optional(v.string()),
  mitzvah: v.optional(v.string()),
  month: v.optional(v.string()),
  category: v.optional(v.string()),
  vendor: v.optional(v.string()),
  paid: v.optional(v.boolean()),
  paidDate: v.optional(v.string()),
  createdAt: v.optional(v.number()),
};
type TxInput = {
  type: Doc<"fundTransactions">["type"];
  amount: number;
  date: string;
  donorId?: Id<"users"> | null;
  name?: string;
  desc?: string;
  method?: string;
  mitzvah?: string;
  month?: string;
  category?: string;
  vendor?: string;
  paid?: boolean;
  paidDate?: string;
  createdAt?: number;
};

const clip = (s: string | undefined, max: number) => (s ?? "").trim().slice(0, max);

/** מנקה ומאמת רישום. השדות שלא שייכים לסוג הרישום מתאפסים. */
async function clean(ctx: MutationCtx, synagogueId: Id<"synagogues">, tx: TxInput) {
  if (!(tx.amount > 0 && tx.amount < 1e9)) {
    throw new ConvexError("יש להזין סכום גדול מאפס");
  }
  if (!DATE_RE.test(tx.date)) {
    throw new ConvexError("תאריך לא תקין");
  }
  const withDonor = DONOR_TYPES.has(tx.type);
  const income = INCOME_TYPES.has(tx.type);
  const paid = income && !!tx.paid;
  const paidDate = paid ? (tx.paidDate && DATE_RE.test(tx.paidDate) ? tx.paidDate : tx.date) : "";
  let donorId: Id<"users"> | undefined = undefined;
  if (withDonor && tx.donorId) {
    if ((await getMembership(ctx, synagogueId, tx.donorId)) === null) {
      throw new ConvexError("התורם שנבחר אינו חבר בקהילה");
    }
    donorId = tx.donorId;
  }
  const expense = tx.type === "expense" || tx.type === "petty";
  return {
    type: tx.type,
    amount: Math.round(tx.amount * 100) / 100,
    date: tx.date,
    hebrewYear: hebrewYearOf(tx.date),
    donorId,
    name: withDonor ? clip(tx.name, 80) : "",
    desc: clip(tx.desc, 500),
    method: withDonor ? clip(tx.method, 40) : "",
    mitzvah: tx.type === "mitzvah" ? clip(tx.mitzvah, 60) : "",
    month: tx.type === "salary" ? clip(tx.month, 40) : "",
    category: expense ? clip(tx.category, 60) : "",
    vendor: expense ? clip(tx.vendor, 80) : "",
    paid,
    paidDate,
  };
}

const forClient = (t: Doc<"fundTransactions">) => ({
  id: t._id,
  type: t.type,
  amount: t.amount,
  date: t.date,
  donorId: t.donorId ?? null,
  name: t.name,
  desc: t.desc,
  method: t.method,
  mitzvah: t.mitzvah,
  month: t.month,
  category: t.category,
  vendor: t.vendor,
  paid: t.paid,
  paidDate: t.paidDate,
  createdAt: t.createdAt,
});

async function myNotifications(ctx: QueryCtx, synagogueId: Id<"synagogues">, userId: Id<"users">) {
  return await Notifications.listForRecipient(ctx, synagogueId, "fund", userId);
}

/** גבאי ורב מקבלים את כל הקופה. חבר קהילה מקבל רק תרומות ומצוות שמשויכות אליו, וכן תזכורות תשלום אישיות. */
export const ledger = query({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, args) => {
    const { userId, membership } = await requireMember(ctx, args.synagogueId);
    const synagogue = await ctx.db.get(args.synagogueId);
    if (synagogue === null) {
      throw new ConvexError("הקהילה לא נמצאה");
    }
    const base = { synagogue: { name: synagogue.name, il: synagogue.il }, role: membership.role };

    if (!isManager(membership.role)) {
      const mine = await ctx.db
        .query("fundTransactions")
        .withIndex("by_synagogue_donor", (q) => q.eq("synagogueId", args.synagogueId).eq("donorId", userId))
        .collect();
      return {
        ...base,
        txs: mine.filter((t) => DONOR_TYPES.has(t.type)).map(forClient),
        settings: null,
        members: [],
        notifications: await myNotifications(ctx, args.synagogueId, userId),
      };
    }

    const txs = await ctx.db
      .query("fundTransactions")
      .withIndex("by_synagogue", (q) => q.eq("synagogueId", args.synagogueId))
      .collect();
    const settings = await ctx.db
      .query("fundSettings")
      .withIndex("by_synagogue", (q) => q.eq("synagogueId", args.synagogueId))
      .unique();
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_synagogue", (q) => q.eq("synagogueId", args.synagogueId))
      .collect();
    const members = await Promise.all(
      memberships.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        return { userId: m.userId, name: user?.name ?? user?.email ?? "משתמש" };
      }),
    );
    return {
      ...base,
      txs: txs.map(forClient),
      settings: { openMain: settings?.openMain ?? 0, openPetty: settings?.openPetty ?? 0 },
      members: members.sort((a, b) => a.name.localeCompare(b.name, "he")),
      notifications: await myNotifications(ctx, args.synagogueId, userId),
    };
  },
});

/** חבר קהילה רושם על עצמו בלבד חיוב פתוח (תרומה או מכירת מצווה) שעליו לשלם. */
export const pledgeMine = mutation({
  args: {
    synagogueId: v.id("synagogues"),
    type: PLEDGE_TYPES,
    amount: v.number(),
    date: v.string(),
    desc: v.optional(v.string()),
    mitzvah: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.synagogueId);
    const user = await ctx.db.get(userId);
    const data = await clean(ctx, args.synagogueId, {
      type: args.type,
      amount: args.amount,
      date: args.date,
      donorId: userId,
      name: user?.name ?? user?.email ?? "חבר קהילה",
      desc: args.desc,
      mitzvah: args.mitzvah,
      paid: false,
    });
    return await ctx.db.insert("fundTransactions", {
      synagogueId: args.synagogueId,
      ...data,
      createdAt: Date.now(),
      createdBy: userId,
    });
  },
});

export const markNotificationsRead = mutation({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.synagogueId);
    await Notifications.markRecipientRead(ctx, args.synagogueId, "fund", userId);
  },
});

function pledgeText(t: Doc<"fundTransactions">) {
  const what = t.type === "mitzvah" ? "מכירת מצווה" + (t.mitzvah ? ": " + t.mitzvah : "") : "תרומה";
  return `תזכורת: נותר לך לשלם ${what} על סך ₪${t.amount}${t.desc ? " (" + t.desc + ")" : ""}.`;
}

/** תזכורת יומית: כל 5 ימים מהתזכורת האחרונה, וכן תמיד בעשירי לחודש, לכל חיוב פתוח שיש לו תורם רשום. */
export const sendDueReminders = internalMutation({
  args: {},
  handler: async (ctx) => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const isTenth = today.slice(8, 10) === "10";
      const txs = await ctx.db.query("fundTransactions").collect();
      for (const t of txs) {
        if (t.paid || !t.donorId || !DONOR_TYPES.has(t.type)) {
          continue;
        }
        const since = t.lastReminderDate ?? new Date(t.createdAt).toISOString().slice(0, 10);
        if (since === today) {
          continue;
        }
        const daysSince = Math.round((Date.parse(today) - Date.parse(since)) / 864e5);
        if (daysSince < REMINDER_DAYS && !isTenth) {
          continue;
        }
        await Notifications.create(ctx, {
          synagogueId: t.synagogueId,
          type: "fund",
          to: t.donorId,
          text: pledgeText(t),
          transactionId: t._id,
        });
        await ctx.db.patch(t._id, { lastReminderDate: today });
      }
    } catch (err) {
      console.error("שליחת תזכורות תשלום נכשלה", err);
      await logError(
        ctx,
        "fund-reminders",
        "שליחת תזכורות תשלום נכשלה",
        err instanceof Error ? err.message : String(err),
      );
    }
  },
});

export const save = mutation({
  args: { synagogueId: v.id("synagogues"), id: v.optional(v.id("fundTransactions")), ...txFields },
  handler: async (ctx, { synagogueId, id, ...tx }) => {
    const { userId } = await requireManager(ctx, synagogueId);
    const data = await clean(ctx, synagogueId, tx);
    if (id) {
      const existing = await ctx.db.get(id);
      if (existing === null || existing.synagogueId !== synagogueId) {
        throw new ConvexError("הרישום לא נמצא");
      }
      await ctx.db.patch(id, data);
      return id;
    }
    return await ctx.db.insert("fundTransactions", { synagogueId, ...data, createdAt: Date.now(), createdBy: userId });
  },
});

export const markPaid = mutation({
  args: { synagogueId: v.id("synagogues"), id: v.id("fundTransactions"), paidDate: v.string() },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    const existing = await ctx.db.get(args.id);
    if (existing === null || existing.synagogueId !== args.synagogueId || !INCOME_TYPES.has(existing.type)) {
      throw new ConvexError("הרישום לא נמצא");
    }
    await ctx.db.patch(args.id, { paid: true, paidDate: DATE_RE.test(args.paidDate) ? args.paidDate : existing.date });
  },
});

export const remove = mutation({
  args: { synagogueId: v.id("synagogues"), id: v.id("fundTransactions") },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    const existing = await ctx.db.get(args.id);
    if (existing === null || existing.synagogueId !== args.synagogueId) {
      return;
    }
    await ctx.db.delete(args.id);
  },
});

export const saveSettings = mutation({
  args: { synagogueId: v.id("synagogues"), openMain: v.number(), openPetty: v.number() },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    const existing = await ctx.db
      .query("fundSettings")
      .withIndex("by_synagogue", (q) => q.eq("synagogueId", args.synagogueId))
      .unique();
    const values = { openMain: args.openMain || 0, openPetty: args.openPetty || 0 };
    if (existing) {
      await ctx.db.patch(existing._id, values);
    } else {
      await ctx.db.insert("fundSettings", { synagogueId: args.synagogueId, ...values });
    }
  },
});

/** ייבוא חד-פעמי של קופה שנשמרה קודם בדפדפן. */
export const importLocal = mutation({
  args: {
    synagogueId: v.id("synagogues"),
    txs: v.array(v.object(txFields)),
    openMain: v.number(),
    openPetty: v.number(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManager(ctx, args.synagogueId);
    if (args.txs.length > 2000) {
      throw new ConvexError("יותר מדי רישומים לייבוא בבת אחת");
    }
    for (const tx of args.txs) {
      const data = await clean(ctx, args.synagogueId, { ...tx, donorId: null });
      await ctx.db.insert("fundTransactions", {
        synagogueId: args.synagogueId,
        ...data,
        createdAt: tx.createdAt ?? Date.now(),
        createdBy: userId,
      });
    }
    const settings = await ctx.db
      .query("fundSettings")
      .withIndex("by_synagogue", (q) => q.eq("synagogueId", args.synagogueId))
      .unique();
    if (settings === null) {
      await ctx.db.insert("fundSettings", { synagogueId: args.synagogueId, openMain: args.openMain || 0, openPetty: args.openPetty || 0 });
    }
    return args.txs.length;
  },
});

/** מילוי חד-פעמי של hebrewYear לרישומים קיימים שנוצרו לפני הוספת השדה. אינו נוגע ברישומים שכבר מולאו */
export const backfillHebrewYear = internalMutation({
  args: {},
  handler: async (ctx) => {
    const txs = await ctx.db.query("fundTransactions").collect();
    let updated = 0;
    for (const t of txs) {
      if (t.hebrewYear === undefined) {
        await ctx.db.patch(t._id, { hebrewYear: hebrewYearOf(t.date) });
        updated++;
      }
    }
    return { total: txs.length, updated };
  },
});
