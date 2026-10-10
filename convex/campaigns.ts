import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { acceptUpload } from "./storage";
import { requireManager } from "./roles";
import * as Notifications from "./notifications";

// מגביות בקופה: הגבאי או הרב פותחים מטרה (למשל קניית ספסלים) עם עלות, והמתפללים תורמים לה עד שהעלות מתמלאת.
// התרומות עצמן הן רישומי donation רגילים בקופה עם campaignId (convex/fund.ts), כך שהן נכנסות לחובות, לתזכורות ולדוחות

export const MAX_CAMPAIGN_IMAGE_BYTES = 3 * 1024 * 1024;
const EPS = 0.001;

const clip = (s: string | undefined, max: number) => (s ?? "").trim().slice(0, max);

/** כמה נתרם למגבית: pledged – כל ההתחייבויות (שולמו ולא שולמו), paid – מה שכבר שולם. without – רישום שלא נספר (בעריכה) */
export async function raised(ctx: QueryCtx, campaignId: Id<"fundCampaigns">, without?: Id<"fundTransactions">) {
  const txs = await ctx.db
    .query("fundTransactions")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .collect();
  let pledged = 0;
  let paid = 0;
  const donors = new Set<string>();
  for (const t of txs) {
    if (t._id === without || t.type !== "donation") continue;
    pledged += t.amount;
    if (t.paid) paid += t.amount;
    donors.add(t.donorId ?? "name:" + t.name);
  }
  return { pledged: Math.round(pledged * 100) / 100, paid: Math.round(paid * 100) / 100, count: txs.length, donors: donors.size };
}

const left = (goal: number, pledged: number) => Math.max(0, Math.round((goal - pledged) * 100) / 100);

/**
 * בודק שאפשר לרשום תרומה בסכום הזה למגבית: המגבית שייכת לקהילה, פתוחה (אלא אם זה רישום קיים שכבר שויך אליה),
 * והתרומה לא מעבירה את סך התרומות מעל העלות שנקבעה
 */
export async function assertRoom(
  ctx: QueryCtx,
  synagogueId: Id<"synagogues">,
  campaignId: Id<"fundCampaigns">,
  amount: number,
  existing?: Doc<"fundTransactions"> | null,
) {
  const campaign = await ctx.db.get(campaignId);
  if (campaign === null || campaign.synagogueId !== synagogueId) {
    throw new ConvexError("המגבית לא נמצאה");
  }
  const already = existing?.campaignId === campaignId;
  if (campaign.status !== "open" && !already) {
    throw new ConvexError("המגבית נסגרה ואי אפשר לתרום לה עוד");
  }
  const { pledged } = await raised(ctx, campaignId, existing?._id);
  const room = left(campaign.goal, pledged);
  if (amount > room + EPS) {
    throw new ConvexError(
      room > 0
        ? `נותרו ₪${room.toLocaleString("he-IL")} עד השלמת "${campaign.title}". אפשר לתרום עד הסכום הזה`
        : `המגבית "${campaign.title}" כבר הגיעה ליעד`,
    );
  }
  return campaign;
}

/** המגביות לדף הקופה, עם כמה נתרם לכל אחת. חבר קהילה מקבל גם את הסגורות, לשם המגבית ברשימת התרומות שלו */
export async function listForClient(ctx: QueryCtx, synagogueId: Id<"synagogues">) {
  const all = await ctx.db
    .query("fundCampaigns")
    .withIndex("by_synagogue", (q) => q.eq("synagogueId", synagogueId))
    .collect();
  const out = await Promise.all(
    all.map(async (c) => {
      const r = await raised(ctx, c._id);
      return {
        id: c._id,
        title: c.title,
        desc: c.desc,
        goal: c.goal,
        guests: !!c.guests,
        status: c.status,
        createdAt: c.createdAt,
        closedAt: c.closedAt ?? null,
        imageUrl: c.imageId ? await ctx.storage.getUrl(c.imageId) : null,
        pledged: r.pledged,
        paid: r.paid,
        donors: r.donors,
        count: r.count,
        left: left(c.goal, r.pledged),
      };
    }),
  );
  // פתוחות קודם, החדשות למעלה
  return out.sort((a, b) => (a.status === b.status ? b.createdAt - a.createdAt : a.status === "open" ? -1 : 1));
}

export const generateUploadUrl = mutation({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    return await ctx.storage.generateUploadUrl();
  },
});

async function getOwn(ctx: QueryCtx, synagogueId: Id<"synagogues">, id: Id<"fundCampaigns">) {
  const campaign = await ctx.db.get(id);
  if (campaign === null || campaign.synagogueId !== synagogueId) {
    throw new ConvexError("המגבית לא נמצאה");
  }
  return campaign;
}

/** בודק תמונה חדשה שהועלתה. תמונה שנפסלה נמחקת מהאחסון */
async function acceptImage(ctx: MutationCtx, synagogueId: Id<"synagogues">, storageId: Id<"_storage">, freed: number) {
  const meta = await ctx.db.system.get(storageId);
  if (meta === null) return { error: "התמונה לא נמצאה" };
  if (!(meta.contentType ?? "").startsWith("image/")) {
    await ctx.storage.delete(storageId);
    return { error: "הקובץ שנבחר אינו תמונה" };
  }
  return await acceptUpload(ctx, synagogueId, storageId, MAX_CAMPAIGN_IMAGE_BYTES, undefined, freed);
}

/**
 * פתיחת מגבית או עריכתה. imageId: תמונה חדשה שהועלתה; removeImage: הסרת התמונה הקיימת.
 * מחזיר { id } או { error } (תמונה פסולה, גדולה מדי או שאין מקום בקהילה)
 */
export const save = mutation({
  args: {
    synagogueId: v.id("synagogues"),
    id: v.optional(v.id("fundCampaigns")),
    title: v.string(),
    desc: v.string(),
    goal: v.number(),
    imageId: v.optional(v.id("_storage")),
    removeImage: v.optional(v.boolean()),
    guests: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManager(ctx, args.synagogueId);
    // שגיאה שנזרקת מבטלת גם את מחיקת התמונה שהועלתה, ולכן מחזירים { error }
    const fail = async (error: string) => {
      if (args.imageId) await ctx.storage.delete(args.imageId);
      return { error };
    };
    const title = clip(args.title, 80);
    if (!title) return await fail("יש לתת שם למגבית");
    if (!(args.goal > 0 && args.goal < 1e9)) return await fail("יש להזין עלות גדולה מאפס");
    const goal = Math.round(args.goal * 100) / 100;
    const existing = args.id ? await getOwn(ctx, args.synagogueId, args.id) : null;
    if (existing) {
      const { pledged } = await raised(ctx, existing._id);
      if (goal + EPS < pledged) {
        return await fail(`כבר נתרמו ₪${pledged.toLocaleString("he-IL")} למגבית, ולכן העלות לא יכולה להיות נמוכה מזה`);
      }
    }

    let image: { imageId?: Id<"_storage">; imageSize?: number } = {
      imageId: existing?.imageId,
      imageSize: existing?.imageSize,
    };
    if (args.imageId) {
      const accepted = await acceptImage(ctx, args.synagogueId, args.imageId, existing?.imageSize ?? 0);
      if (accepted.error !== undefined) return { error: accepted.error };
      image = { imageId: args.imageId, imageSize: accepted.size };
    } else if (args.removeImage) {
      image = { imageId: undefined, imageSize: undefined };
    }
    if (existing?.imageId && existing.imageId !== image.imageId) {
      await ctx.storage.delete(existing.imageId);
    }

    const fields = { title, desc: clip(args.desc, 1000), goal, ...image, guests: !!args.guests };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return { id: existing._id };
    }
    const id = await ctx.db.insert("fundCampaigns", {
      synagogueId: args.synagogueId,
      ...fields,
      status: "open",
      createdBy: userId,
      createdAt: Date.now(),
    });
    // הודעה לכל חברי הקהילה (מלבד מי שפתח), שמופיעה בדף הקופה ובתפריט
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_synagogue", (q) => q.eq("synagogueId", args.synagogueId))
      .collect();
    for (const m of memberships) {
      if (m.userId === userId) continue;
      await Notifications.create(ctx, {
        synagogueId: args.synagogueId,
        type: "fund",
        to: m.userId,
        text: `נפתחה מגבית חדשה: ${title} (עלות ₪${goal.toLocaleString("he-IL")}). אפשר לתרום לה בדף הקופה.`,
        campaignId: id,
      });
    }
    return { id };
  },
});

/** סגירת מגבית (לא מקבלת עוד תרומות) או פתיחתה מחדש */
export const setStatus = mutation({
  args: { synagogueId: v.id("synagogues"), id: v.id("fundCampaigns"), open: v.boolean() },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    const campaign = await getOwn(ctx, args.synagogueId, args.id);
    await ctx.db.patch(campaign._id, args.open ? { status: "open", closedAt: undefined } : { status: "closed", closedAt: Date.now() });
  },
});

/** מחיקת מגבית שאין בה תרומות. מגבית שיש בה תרומות סוגרים, כדי שהרישומים בקופה יישארו משויכים אליה */
export const remove = mutation({
  args: { synagogueId: v.id("synagogues"), id: v.id("fundCampaigns") },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    const campaign = await getOwn(ctx, args.synagogueId, args.id);
    const { count } = await raised(ctx, campaign._id);
    if (count > 0) {
      throw new ConvexError("יש תרומות שרשומות למגבית הזו, ולכן אפשר רק לסגור אותה. כדי למחוק יש למחוק קודם את התרומות");
    }
    if (campaign.imageId) await ctx.storage.delete(campaign.imageId);
    // ההודעות על פתיחת המגבית נמחקות איתה, גם אצל מי שעוד לא קרא אותן
    const notes = await ctx.db
      .query("notifications")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaign._id))
      .collect();
    for (const n of notes) await ctx.db.delete(n._id);
    await ctx.db.delete(campaign._id);
  },
});
