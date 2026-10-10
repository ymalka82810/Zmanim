import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { randomInviteCode } from "./inviteCode";
import { requireManager } from "./roles";
import { hebrewYearOf, todayKey } from "./hebrewDate";
import { latestSilver } from "./silverPrice";
import * as Campaigns from "./campaigns";

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
      il: synagogue.il,
      address: synagogue.address ?? "",
      donate: await donateInfo(ctx, synagogue),
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

// ---------- תרומות של אורחים ----------
// אורח (בלי חשבון) מתחייב לתרום מעמוד האורחים: לתרומה לזמן מיוחד או למגבית שהגבאי סימן "פתוחה גם לאורחים",
// או תרומה כללית לבית הכנסת. ההתחייבות ממתינה בטבלת guestPledges עד שגבאי או רב מאשרים אותה, ורק אז נרשמת
// בקופה – כך שהודעות סרק מאנשים זרים לא נכנסות לקופה. לאורח מוצגים פרטי התשלום שהגבאי הגדיר

const MAX_PENDING = 200;
const MAX_PENDING_PER_PHONE = 10;
const clip = (s: string | undefined, max: number) => (s ?? "").trim().slice(0, max);
const digits = (s: string) => s.replace(/\D/g, "");

/** מה שאורח יכול לתרום לו: פרטי התשלום, התרומות לזמנים מיוחדים והמגביות הפתוחות לאורחים */
async function donateInfo(ctx: QueryCtx, synagogue: Doc<"synagogues">) {
  const specials = (
    await ctx.db
      .query("specialDonations")
      .withIndex("by_synagogue", (q) => q.eq("synagogueId", synagogue._id))
      .collect()
  )
    .filter((s) => s.status === "open" && s.guests)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((s) => ({ id: s._id, kind: s.kind, title: s.title, desc: s.desc, amount: s.amount ?? null, texts: s.texts ?? {} }));
  const campaigns = (await Campaigns.listForClient(ctx, synagogue._id))
    .filter((c) => c.status === "open" && c.guests && c.left > 0);
  return {
    payText: synagogue.payText ?? "",
    payLink: synagogue.payLink ?? "",
    specials,
    campaigns: campaigns.map((c) => ({
      id: c.id,
      title: c.title,
      desc: c.desc,
      goal: c.goal,
      pledged: c.pledged,
      left: c.left,
      imageUrl: c.imageUrl,
    })),
    silver: specials.some((s) => s.kind === "machatzit" && !s.amount) ? await latestSilver(ctx) : null,
  };
}

async function synagogueByCode(ctx: QueryCtx, code: string) {
  const synagogue = code
    ? await ctx.db
        .query("synagogues")
        .withIndex("by_public", (q) => q.eq("publicCode", code))
        .unique()
    : null;
  if (synagogue === null) {
    throw new ConvexError("הקישור לא תקף, או שהקהילה כיבתה את עמוד האורחים");
  }
  return synagogue;
}

/** התחייבות של אורח לתרומה. בלי specialId ובלי campaignId – תרומה כללית לבית הכנסת */
export const pledge = mutation({
  args: {
    code: v.string(),
    specialId: v.optional(v.id("specialDonations")),
    campaignId: v.optional(v.id("fundCampaigns")),
    amount: v.number(),
    name: v.string(),
    phone: v.string(),
    forWhom: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const synagogue = await synagogueByCode(ctx, args.code);
    const name = clip(args.name, 80);
    const phone = clip(args.phone, 30);
    if (!name) {
      throw new ConvexError("יש לכתוב שם");
    }
    if (digits(phone).length < 9) {
      throw new ConvexError("יש לכתוב מספר טלפון, כדי שהגבאי יוכל ליצור קשר");
    }
    if (!(args.amount > 0 && args.amount < 1e7)) {
      throw new ConvexError("יש להזין סכום גדול מאפס");
    }
    const amount = Math.round(args.amount * 100) / 100;
    let title = "תרומה לבית הכנסת";
    if (args.specialId) {
      const s = await ctx.db.get(args.specialId);
      if (s === null || s.synagogueId !== synagogue._id || s.status !== "open" || !s.guests) {
        throw new ConvexError("התרומה הזו כבר לא פתוחה");
      }
      title = s.title;
    } else if (args.campaignId) {
      const c = await ctx.db.get(args.campaignId);
      if (c === null || c.synagogueId !== synagogue._id || !c.guests) {
        throw new ConvexError("המגבית הזו כבר לא פתוחה");
      }
      await Campaigns.assertRoom(ctx, synagogue._id, c._id, amount);
      title = "מגבית: " + c.title;
    }
    const pending = await ctx.db
      .query("guestPledges")
      .withIndex("by_synagogue_at", (q) => q.eq("synagogueId", synagogue._id))
      .take(MAX_PENDING + 1);
    if (pending.length >= MAX_PENDING || pending.filter((p) => digits(p.phone) === digits(phone)).length >= MAX_PENDING_PER_PHONE) {
      throw new ConvexError("יש כרגע יותר מדי התחייבויות שממתינות לגבאי. נסו שוב מאוחר יותר, או פנו לגבאי ישירות");
    }
    await ctx.db.insert("guestPledges", {
      synagogueId: synagogue._id,
      specialId: args.specialId,
      campaignId: args.specialId ? undefined : args.campaignId,
      title,
      amount,
      name,
      phone,
      forWhom: clip(args.forWhom, 200),
      at: Date.now(),
    });
  },
});

export async function countPledges(ctx: QueryCtx, synagogueId: Id<"synagogues">) {
  return (
    await ctx.db
      .query("guestPledges")
      .withIndex("by_synagogue_at", (q) => q.eq("synagogueId", synagogueId))
      .take(MAX_PENDING)
  ).length;
}

/** ההתחייבויות של אורחים שממתינות לגבאי או לרב, החדשות למעלה */
export const pledges = query({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    const list = await ctx.db
      .query("guestPledges")
      .withIndex("by_synagogue_at", (q) => q.eq("synagogueId", args.synagogueId))
      .order("desc")
      .take(MAX_PENDING);
    return list.map((p) => ({
      id: p._id,
      title: p.title,
      amount: p.amount,
      name: p.name,
      phone: p.phone,
      forWhom: p.forWhom,
      at: p.at,
    }));
  },
});

async function getPledge(ctx: MutationCtx, synagogueId: Id<"synagogues">, id: Id<"guestPledges">) {
  const p = await ctx.db.get(id);
  if (p === null || p.synagogueId !== synagogueId) {
    throw new ConvexError("ההתחייבות לא נמצאה. אולי גבאי אחר כבר טיפל בה");
  }
  return p;
}

/**
 * אישור התחייבות של אורח: נרשמת בקופה כתרומה על שמו (לא שולמה, או שולמה אם paid), משויכת לתרומה המיוחדת או
 * למגבית אם הן עדיין קיימות, ונמחקת מהרשימה. מגבית שהתמלאה בינתיים – האישור נכשל, ואפשר לדחות או לפנות לאורח
 */
export const acceptPledge = mutation({
  args: {
    synagogueId: v.id("synagogues"),
    id: v.id("guestPledges"),
    paid: v.optional(v.boolean()),
    method: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManager(ctx, args.synagogueId);
    const p = await getPledge(ctx, args.synagogueId, args.id);
    const special = p.specialId ? await ctx.db.get(p.specialId) : null;
    const campaign = p.campaignId ? await ctx.db.get(p.campaignId) : null;
    if (campaign) {
      await Campaigns.assertRoom(ctx, args.synagogueId, campaign._id, p.amount);
    }
    const date = todayKey();
    const paid = !!args.paid;
    const desc = [special ? special.title : campaign ? "" : p.title, p.forWhom, "אורח, טלפון " + p.phone]
      .filter(Boolean)
      .join(" – ");
    const txId = await ctx.db.insert("fundTransactions", {
      synagogueId: args.synagogueId,
      type: "donation",
      amount: p.amount,
      date,
      hebrewYear: hebrewYearOf(date),
      name: p.name,
      desc: desc.slice(0, 500),
      method: paid ? clip(args.method, 40) : "",
      mitzvah: "",
      month: "",
      category: "",
      vendor: "",
      paid,
      paidDate: paid ? date : "",
      campaignId: campaign?._id,
      specialId: special?._id,
      createdAt: Date.now(),
      createdBy: userId,
    });
    await ctx.db.delete(p._id);
    return txId;
  },
});

export const rejectPledge = mutation({
  args: { synagogueId: v.id("synagogues"), id: v.id("guestPledges") },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    const p = await ctx.db.get(args.id);
    if (p !== null && p.synagogueId === args.synagogueId) {
      await ctx.db.delete(p._id);
    }
  },
});

/** פרטי התשלום שמוצגים לאורח: טקסט חופשי וקישור תשלום (https בלבד). ריק – מוחק */
export const setPayInfo = mutation({
  args: { synagogueId: v.id("synagogues"), payText: v.string(), payLink: v.string() },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    const payLink = clip(args.payLink, 300);
    if (payLink && !/^https:\/\/[^\s]+$/i.test(payLink)) {
      throw new ConvexError("קישור התשלום צריך להתחיל ב-https://");
    }
    await ctx.db.patch(args.synagogueId, { payText: clip(args.payText, 500) || undefined, payLink: payLink || undefined });
  },
});
