import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { requireFeature } from "./features";
import { requireManager, requireMember } from "./roles";
import { acceptUpload } from "./storage";

// קטלוג בית הכנסת: חפצים שבית הכנסת מוכר (מזוזות, לולבים, אתרוגים...) עם מחיר ותמונה.
// הגבאי או הרב מנהלים, וחברי הקהילה רואים. פיצ'ר שהקהילה מפעילה (convex/features.ts, "catalog")

export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const clip = (s: string | undefined, max: number) => (s ?? "").trim().slice(0, max);

async function getOwn(ctx: QueryCtx, synagogueId: Id<"synagogues">, id: Id<"catalogItems">) {
  const item = await ctx.db.get(id);
  if (item === null || item.synagogueId !== synagogueId) {
    throw new ConvexError("הפריט לא נמצא");
  }
  return item;
}

/** כל הפריטים של הקהילה. זמינים קודם, והחדשים למעלה */
export const list = query({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.synagogueId);
    await requireFeature(ctx, args.synagogueId, "catalog");
    const items = await ctx.db
      .query("catalogItems")
      .withIndex("by_synagogue", (q) => q.eq("synagogueId", args.synagogueId))
      .collect();
    const out = await Promise.all(
      items.map(async (i) => ({
        id: i._id,
        title: i.title,
        desc: i.desc,
        category: i.category,
        price: i.price ?? null,
        contact: i.contact ?? "",
        status: i.status,
        createdAt: i.createdAt,
        imageUrl: i.imageId ? await ctx.storage.getUrl(i.imageId) : null,
      })),
    );
    return out.sort((a, b) => (a.status === b.status ? b.createdAt - a.createdAt : a.status === "available" ? -1 : 1));
  },
});

export const generateUploadUrl = mutation({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    await requireFeature(ctx, args.synagogueId, "catalog");
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * הוספת פריט או עריכתו. price ריק – "המחיר לפי פנייה". imageId: תמונה חדשה שהועלתה; removeImage: הסרת התמונה הקיימת.
 * מחזיר { id } או { error } (תמונה פסולה, גדולה מדי או שאין מקום בקהילה)
 */
export const save = mutation({
  args: {
    synagogueId: v.id("synagogues"),
    id: v.optional(v.id("catalogItems")),
    title: v.string(),
    desc: v.string(),
    category: v.string(),
    price: v.optional(v.number()),
    contact: v.optional(v.string()),
    imageId: v.optional(v.id("_storage")),
    removeImage: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManager(ctx, args.synagogueId);
    await requireFeature(ctx, args.synagogueId, "catalog");
    // שגיאה שנזרקת מבטלת גם את מחיקת התמונה שהועלתה, ולכן מחזירים { error }
    const fail = async (error: string) => {
      if (args.imageId) await ctx.storage.delete(args.imageId);
      return { error };
    };
    const title = clip(args.title, 80);
    if (!title) return await fail("יש לתת שם לפריט");
    if (args.price !== undefined && !(args.price >= 0 && args.price < 1e9)) return await fail("המחיר אינו תקין");
    const existing = args.id ? await getOwn(ctx, args.synagogueId, args.id) : null;

    let image: { imageId?: Id<"_storage">; imageSize?: number } = {
      imageId: existing?.imageId,
      imageSize: existing?.imageSize,
    };
    if (args.imageId) {
      const meta = await ctx.db.system.get(args.imageId);
      if (meta !== null && !(meta.contentType ?? "").startsWith("image/")) {
        return await fail("הקובץ שנבחר אינו תמונה");
      }
      const accepted = await acceptUpload(ctx, args.synagogueId, args.imageId, MAX_IMAGE_BYTES, undefined, existing?.imageSize ?? 0);
      if (accepted.error !== undefined) return { error: accepted.error };
      image = { imageId: args.imageId, imageSize: accepted.size };
    } else if (args.removeImage) {
      image = { imageId: undefined, imageSize: undefined };
    }
    if (existing?.imageId && existing.imageId !== image.imageId) {
      await ctx.storage.delete(existing.imageId);
    }

    const fields = {
      title,
      desc: clip(args.desc, 1000),
      category: clip(args.category, 40),
      price: args.price === undefined ? undefined : Math.round(args.price * 100) / 100,
      contact: clip(args.contact, 120) || undefined,
      ...image,
    };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return { id: existing._id };
    }
    const id = await ctx.db.insert("catalogItems", {
      synagogueId: args.synagogueId,
      ...fields,
      status: "available",
      createdBy: userId,
      createdAt: Date.now(),
    });
    return { id };
  },
});

/** סימון פריט כנמכר (או החזרתו לזמין) */
export const setStatus = mutation({
  args: { synagogueId: v.id("synagogues"), id: v.id("catalogItems"), sold: v.boolean() },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    await requireFeature(ctx, args.synagogueId, "catalog");
    const item = await getOwn(ctx, args.synagogueId, args.id);
    await ctx.db.patch(item._id, { status: args.sold ? "sold" : "available" });
  },
});

export const remove = mutation({
  args: { synagogueId: v.id("synagogues"), id: v.id("catalogItems") },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    const item = await getOwn(ctx, args.synagogueId, args.id);
    if (item.imageId) await ctx.storage.delete(item.imageId);
    await ctx.db.delete(item._id);
  },
});
