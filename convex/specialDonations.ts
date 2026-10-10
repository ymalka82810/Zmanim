import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { displayName, getMembership, isManager, requireManager, requireMember } from "./roles";
import { hebrewYearOf, todayKey } from "./hebrewDate";
import { NUSACHIM, SPECIAL_KINDS, SPECIAL_KIND_IDS } from "../js/special-donations.js";
import { latestSilver } from "./silverPrice";

/**
 * תרומות לזמנים מיוחדים (gabbai/js/special.js): גבאי או רב פותחים תרומה מסוג קבוע (פדיון כפרות, מחצית השקל,
 * מתנות לאביונים, קמחא דפסחא, נדר ביזכור – js/special-donations.js) או בשם חופשי, עם סכום מוצע והנוסח לכל עדה.
 * חבר קהילה רואה את התרומות הפתוחות, בוחר נוסח, ורושם על עצמו תרומה – רישום donation בקופה, חוב פתוח עד
 * שהגבאי מסמן אותו כשולם (ומקבל את תזכורות התשלום הרגילות של הקופה). גבאי ורב רושמים גם עבור אחרים.
 */

const MAX_TEXT = 8000;
const clip = (s: string | undefined, max: number) => (s ?? "").trim().slice(0, max);
type Kind = keyof typeof SPECIAL_KINDS;
const isKind = (k: string): k is Kind => SPECIAL_KIND_IDS.includes(k);

const fields = {
  kind: v.string(),
  title: v.optional(v.string()),
  desc: v.optional(v.string()),
  amount: v.optional(v.union(v.number(), v.null())),
  texts: v.optional(v.record(v.string(), v.string())),
};

function cleanSpecial(args: { kind: string; title?: string; desc?: string; amount?: number | null; texts?: Record<string, string> }) {
  if (!isKind(args.kind)) {
    throw new ConvexError("סוג התרומה לא מוכר");
  }
  const title = clip(args.title, 80) || SPECIAL_KINDS[args.kind].title;
  if (!title) {
    throw new ConvexError("יש לכתוב שם לתרומה");
  }
  const amount = args.amount ?? 0;
  if (!(amount >= 0 && amount < 1e7)) {
    throw new ConvexError("הסכום המוצע לא תקין");
  }
  const texts: Record<string, string> = {};
  for (const [nusach, text] of Object.entries(args.texts ?? {})) {
    const t = clip(text, MAX_TEXT);
    if (nusach in NUSACHIM && t) {
      texts[nusach] = t;
    }
  }
  return {
    kind: args.kind,
    title,
    desc: clip(args.desc, 500),
    amount: amount > 0 ? Math.round(amount * 100) / 100 : undefined,
    texts: Object.keys(texts).length ? texts : undefined,
  };
}

async function getSpecial(ctx: MutationCtx, synagogueId: Id<"synagogues">, id: Id<"specialDonations">) {
  const s = await ctx.db.get(id);
  if (s === null || s.synagogueId !== synagogueId) {
    throw new ConvexError("התרומה לא נמצאה");
  }
  return s;
}

const forClient = (s: Doc<"specialDonations">) => ({
  id: s._id,
  kind: s.kind,
  title: s.title,
  desc: s.desc,
  amount: s.amount ?? null,
  texts: s.texts ?? {},
  status: s.status,
  createdAt: s.createdAt,
  closedAt: s.closedAt ?? null,
});

/** "פדיון כפרות – עבור משפחת כהן": התיאור של הרישום בקופה */
const txDesc = (title: string, forWhom: string) => (forWhom ? `${title} – ${forWhom}` : title);
const forWhomOf = (s: Doc<"specialDonations">, t: Doc<"fundTransactions">) =>
  t.desc.startsWith(s.title + " – ") ? t.desc.slice(s.title.length + 3) : t.desc === s.title ? "" : t.desc;

/**
 * חבר קהילה מקבל את התרומות הפתוחות ואת מה שהוא עצמו רשם לכל אחת. גבאי ורב מקבלים גם תרומות סגורות, את כל
 * הרישומים לכל תרומה וסיכום, ואת רשימת החברים לרישום עבור אחרים.
 */
export const list = query({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, args) => {
    const { userId, membership } = await requireMember(ctx, args.synagogueId);
    const manager = isManager(membership.role);
    const all = await ctx.db
      .query("specialDonations")
      .withIndex("by_synagogue", (q) => q.eq("synagogueId", args.synagogueId))
      .collect();
    const specials = all
      .filter((s) => manager || s.status === "open")
      .sort((a, b) => (a.status === b.status ? b.createdAt - a.createdAt : a.status === "open" ? -1 : 1));

    const items = await Promise.all(
      specials.map(async (s) => {
        const txs = await ctx.db
          .query("fundTransactions")
          .withIndex("by_special", (q) => q.eq("specialId", s._id))
          .collect();
        const entry = (t: Doc<"fundTransactions">) => ({
          txId: t._id,
          name: t.name,
          forWhom: forWhomOf(s, t),
          amount: t.amount,
          paid: t.paid,
          date: t.date,
          mine: t.donorId === userId,
        });
        const mine = txs.filter((t) => t.donorId === userId).map(entry);
        if (!manager) {
          return { ...forClient(s), mine };
        }
        return {
          ...forClient(s),
          mine,
          entries: txs.sort((a, b) => b.createdAt - a.createdAt).map(entry),
          total: txs.reduce((sum, t) => sum + t.amount, 0),
          paidTotal: txs.filter((t) => t.paid).reduce((sum, t) => sum + t.amount, 0),
        };
      }),
    );

    let members: { userId: Id<"users">; name: string }[] = [];
    if (manager) {
      const memberships = await ctx.db
        .query("memberships")
        .withIndex("by_synagogue", (q) => q.eq("synagogueId", args.synagogueId))
        .collect();
      members = (
        await Promise.all(memberships.map(async (m) => ({ userId: m.userId, name: displayName(await ctx.db.get(m.userId)) })))
      ).sort((a, b) => a.name.localeCompare(b.name, "he"));
    }
    return { manager, items, members, silver: await latestSilver(ctx) };
  },
});

export const open = mutation({
  args: { synagogueId: v.id("synagogues"), ...fields },
  handler: async (ctx, { synagogueId, ...rest }) => {
    const { userId } = await requireManager(ctx, synagogueId);
    return await ctx.db.insert("specialDonations", {
      synagogueId,
      ...cleanSpecial(rest),
      status: "open",
      createdBy: userId,
      createdAt: Date.now(),
    });
  },
});

/** עריכת שם, הסבר, סכום מוצע ונוסחים. הסוג לא משתנה. רישומים קיימים בקופה שומרים את התיאור שנרשם בהם */
export const update = mutation({
  args: { synagogueId: v.id("synagogues"), id: v.id("specialDonations"), ...fields },
  handler: async (ctx, { synagogueId, id, ...rest }) => {
    await requireManager(ctx, synagogueId);
    const s = await getSpecial(ctx, synagogueId, id);
    await ctx.db.patch(id, cleanSpecial({ ...rest, kind: s.kind }));
  },
});

export const setOpen = mutation({
  args: { synagogueId: v.id("synagogues"), id: v.id("specialDonations"), open: v.boolean() },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    await getSpecial(ctx, args.synagogueId, args.id);
    await ctx.db.patch(args.id, args.open ? { status: "open", closedAt: undefined } : { status: "closed", closedAt: Date.now() });
  },
});

/** מחיקת התרומה מהרשימה. הרישומים בקופה נשארים (בלי הקישור לתרומה) */
export const remove = mutation({
  args: { synagogueId: v.id("synagogues"), id: v.id("specialDonations") },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    await getSpecial(ctx, args.synagogueId, args.id);
    const txs = await ctx.db
      .query("fundTransactions")
      .withIndex("by_special", (q) => q.eq("specialId", args.id))
      .collect();
    for (const t of txs) {
      await ctx.db.patch(t._id, { specialId: undefined });
    }
    await ctx.db.delete(args.id);
  },
});

/**
 * רישום תרומה לזמן מיוחד בקופה. חבר קהילה רושם רק על עצמו ורק לתרומה פתוחה, כחוב פתוח. גבאי ורב רושמים גם
 * עבור חבר אחר או שם חופשי, וגם כשולם.
 */
export const pledge = mutation({
  args: {
    synagogueId: v.id("synagogues"),
    id: v.id("specialDonations"),
    amount: v.number(),
    forWhom: v.optional(v.string()),
    donorId: v.optional(v.union(v.id("users"), v.null())),
    name: v.optional(v.string()),
    paid: v.optional(v.boolean()),
    method: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, membership } = await requireMember(ctx, args.synagogueId);
    const manager = isManager(membership.role);
    const s = await getSpecial(ctx, args.synagogueId, args.id);
    if (s.status !== "open" && !manager) {
      throw new ConvexError("התרומה הזו כבר נסגרה");
    }
    if (!(args.amount > 0 && args.amount < 1e9)) {
      throw new ConvexError("יש להזין סכום גדול מאפס");
    }
    let donorId: Id<"users"> | undefined = userId;
    let name = displayName(await ctx.db.get(userId));
    let paid = false;
    let method = "";
    if (manager) {
      donorId = args.donorId ?? undefined;
      if (donorId && (await getMembership(ctx, args.synagogueId, donorId)) === null) {
        throw new ConvexError("התורם שנבחר אינו חבר בקהילה");
      }
      name = clip(args.name, 80) || (donorId ? displayName(await ctx.db.get(donorId)) : "");
      paid = !!args.paid;
      method = paid ? clip(args.method, 40) : "";
    }
    const date = todayKey();
    return await ctx.db.insert("fundTransactions", {
      synagogueId: args.synagogueId,
      type: "donation",
      amount: Math.round(args.amount * 100) / 100,
      date,
      hebrewYear: hebrewYearOf(date),
      donorId,
      name,
      desc: txDesc(s.title, clip(args.forWhom, 200)),
      method,
      mitzvah: "",
      month: "",
      category: "",
      vendor: "",
      paid,
      paidDate: paid ? date : "",
      specialId: s._id,
      createdAt: Date.now(),
      createdBy: userId,
    });
  },
});
