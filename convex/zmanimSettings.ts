import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { requireManager } from "./roles";
import { acceptUpload } from "./storage";

const MAX_CONFIG = 500 * 1024;
const HASH_RE = /^[0-9a-f]{64}$/;
// עיצוב שלא מופיע בהגדרות נמחק רק אחרי זמן, כי גבאי אחר אולי העלה אותו עכשיו ועוד לא שמר את ההגדרות
const ORPHAN_MS = 60 * 60 * 1000;

async function getSettings(ctx: QueryCtx, synagogueId: Id<"synagogues">) {
  return await ctx.db
    .query("zmanimSettings")
    .withIndex("by_synagogue", (q) => q.eq("synagogueId", synagogueId))
    .unique();
}

/** הגיבובים של העיצובים שההגדרות משתמשות בהם (design: { blob, enabled }) */
function designHashes(config: string) {
  const out = new Set<string>();
  try {
    const cfg = JSON.parse(config);
    for (const t of Array.isArray(cfg?.templates) ? cfg.templates : []) {
      const blob = t?.design?.blob;
      if (typeof blob === "string") out.add(blob);
    }
  } catch {
    // נבדק כבר בשמירה
  }
  return out;
}

/** ההגדרות של הקהילה, או null אם עוד לא נשמרו. designs: גיבוב ← כתובת להורדת העיצוב */
export const get = query({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    const doc = await getSettings(ctx, args.synagogueId);
    if (doc === null) {
      return null;
    }
    const designs: Record<string, string> = {};
    for (const hash of designHashes(doc.config)) {
      const d = await ctx.db
        .query("zmanimDesigns")
        .withIndex("by_synagogue_hash", (q) => q.eq("synagogueId", args.synagogueId).eq("hash", hash))
        .first();
      const url = d ? await ctx.storage.getUrl(d.storageId) : null;
      if (url) designs[hash] = url;
    }
    const user = await ctx.db.get(doc.updatedBy);
    return {
      config: doc.config,
      rev: doc.rev,
      designs,
      updatedAt: doc.updatedAt,
      updatedBy: user?.name ?? user?.email ?? "משתמש",
    };
  },
});

/** הגיבובים של העיצובים שכבר שמורים בקהילה, כדי לא להעלות אותם שוב */
export const designList = query({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    const docs = await ctx.db
      .query("zmanimDesigns")
      .withIndex("by_synagogue_hash", (q) => q.eq("synagogueId", args.synagogueId))
      .collect();
    return docs.map((d) => d.hash);
  },
});

export const generateUploadUrl = mutation({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    return await ctx.storage.generateUploadUrl();
  },
});

export const addDesign = mutation({
  args: { synagogueId: v.id("synagogues"), hash: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    // מחזירים שגיאה במקום לזרוק אותה, אחרת גם מחיקת הקובץ הפסול מתבטלת
    if (!HASH_RE.test(args.hash)) {
      await ctx.storage.delete(args.storageId);
      return { error: "קובץ העיצוב לא תקין" };
    }
    const existing = await ctx.db
      .query("zmanimDesigns")
      .withIndex("by_synagogue_hash", (q) => q.eq("synagogueId", args.synagogueId).eq("hash", args.hash))
      .first();
    if (existing !== null) {
      await ctx.storage.delete(args.storageId);
      return null;
    }
    const accepted = await acceptUpload(ctx, args.synagogueId, args.storageId);
    if (accepted.error !== undefined) {
      return { error: "לא ניתן לשמור את עיצוב הלוח בקהילה: " + accepted.error };
    }
    await ctx.db.insert("zmanimDesigns", {
      synagogueId: args.synagogueId,
      hash: args.hash,
      storageId: args.storageId,
      createdAt: Date.now(),
      size: accepted.size,
    });
    return null;
  },
});

/** שמירת ההגדרות. השמירה האחרונה קובעת. מחזירה את מספר הגרסה החדש */
export const save = mutation({
  args: { synagogueId: v.id("synagogues"), config: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireManager(ctx, args.synagogueId);
    if (args.config.length > MAX_CONFIG) {
      throw new ConvexError("ההגדרות גדולות מדי");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(args.config);
    } catch {
      parsed = null;
    }
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { templates?: unknown }).templates)) {
      throw new ConvexError("ההגדרות לא תקינות");
    }
    const now = Date.now();
    const doc = await getSettings(ctx, args.synagogueId);
    const rev = (doc?.rev ?? 0) + 1;
    if (doc === null) {
      await ctx.db.insert("zmanimSettings", {
        synagogueId: args.synagogueId,
        config: args.config,
        rev,
        updatedBy: userId,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(doc._id, { config: args.config, rev, updatedBy: userId, updatedAt: now });
    }

    const used = designHashes(args.config);
    const designs = await ctx.db
      .query("zmanimDesigns")
      .withIndex("by_synagogue_hash", (q) => q.eq("synagogueId", args.synagogueId))
      .collect();
    for (const d of designs) {
      if (!used.has(d.hash) && now - d.createdAt > ORPHAN_MS) {
        await ctx.storage.delete(d.storageId);
        await ctx.db.delete(d._id);
      }
    }
    return rev;
  },
});
