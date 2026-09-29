import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireManager } from "./roles";

// תמונת לוח נפתחת אצל כל חברי הקהילה, ולכן היא מוגבלת יותר מעיצוב שרק הגבאי מעלה
export const MAX_SCHEDULE_BYTES = 7 * 1024 * 1024;
export const MAX_DESIGN_BYTES = 12 * 1024 * 1024;
export const QUOTA_BYTES = 50 * 1024 * 1024;
export const TRASH_DAYS = 30;

const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1) + "MB";

async function sizeOf(ctx: QueryCtx, doc: { size?: number; storageId: Id<"_storage"> }) {
  if (doc.size !== undefined) return doc.size;
  const meta = await ctx.db.system.get(doc.storageId);
  return meta?.size ?? 0;
}

async function communityFiles(ctx: QueryCtx, synagogueId: Id<"synagogues">) {
  const schedules = await ctx.db
    .query("scheduleFiles")
    .withIndex("by_synagogue_first", (q) => q.eq("synagogueId", synagogueId))
    .collect();
  const designs = await ctx.db
    .query("zmanimDesigns")
    .withIndex("by_synagogue_hash", (q) => q.eq("synagogueId", synagogueId))
    .collect();
  return { schedules, designs };
}

/** קבצים בסל המחזור נספרים, כי הם עדיין שמורים */
export async function usedBytes(ctx: QueryCtx, synagogueId: Id<"synagogues">) {
  const { schedules, designs } = await communityFiles(ctx, synagogueId);
  let total = 0;
  for (const f of [...schedules, ...designs]) total += await sizeOf(ctx, f);
  return total;
}

/**
 * בודק קובץ שהועלה לפני שהוא נרשם בקהילה. קובץ שנפסל נמחק מהאחסון.
 * מחזיר את הגודל, או הודעת שגיאה. לא זורקים שגיאה, אחרת גם המחיקה מתבטלת.
 */
export async function acceptUpload(
  ctx: MutationCtx,
  synagogueId: Id<"synagogues">,
  storageId: Id<"_storage">,
  maxBytes: number,
  contentType?: string,
  freedBytes = 0,
): Promise<{ size: number; error?: undefined } | { error: string }> {
  const meta = await ctx.db.system.get(storageId);
  if (meta === null) return { error: "הקובץ לא נמצא" };
  const reject = async (error: string) => {
    await ctx.storage.delete(storageId);
    return { error };
  };
  if (contentType !== undefined && meta.contentType !== contentType) return await reject("הקובץ לא תקין");
  if (meta.size > maxBytes) {
    return await reject(`הקובץ שוקל ${mb(meta.size)}, והמקסימום לקובץ כזה הוא ${mb(maxBytes)}`);
  }
  const used = (await usedBytes(ctx, synagogueId)) - freedBytes;
  if (used + meta.size > QUOTA_BYTES) {
    return await reject(
      `אין מספיק מקום באחסון הקהילה (בשימוש ${mb(used)} מתוך ${mb(QUOTA_BYTES)}). ` +
        `אפשר לפנות מקום ב"החשבון שלי", בחלון הקהילה תחת "קבצים ואחסון".`,
    );
  }
  return { size: meta.size };
}

/** מוסיף ל-out, לכל עיצוב (design: { blob }) שבהגדרות, את label של התבנית שמשתמשת בו */
export function addDesignUsers(
  out: Map<string, string[]>,
  config: string | undefined,
  label: (templateName: string) => string = (n) => n,
) {
  try {
    const cfg = JSON.parse(config ?? "{}");
    for (const t of Array.isArray(cfg?.templates) ? cfg.templates : []) {
      const blob = t?.design?.blob;
      if (typeof blob !== "string") continue;
      out.set(blob, [...(out.get(blob) ?? []), label(String(t.name || "תבנית"))]);
    }
  } catch {
    // ההגדרות נבדקות בשמירה
  }
  return out;
}

/** לכל עיצוב: התבניות שמשתמשות בו, בהגדרות הפעילות ובהגדרות השמורות */
export async function designUsers(ctx: QueryCtx, synagogueId: Id<"synagogues">) {
  const out = new Map<string, string[]>();
  const settings = await ctx.db
    .query("zmanimSettings")
    .withIndex("by_synagogue", (q) => q.eq("synagogueId", synagogueId))
    .unique();
  addDesignUsers(out, settings?.config);
  const profiles = await ctx.db
    .query("zmanimProfiles")
    .withIndex("by_synagogue_name", (q) => q.eq("synagogueId", synagogueId))
    .collect();
  for (const p of profiles) addDesignUsers(out, p.config, (n) => `${n} (בהגדרות השמורות "${p.name}")`);
  return out;
}

/** כל הקבצים של הקהילה, כולל סל המחזור, וכמה מקום הם תופסים */
export const overview = query({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    const { schedules, designs } = await communityFiles(ctx, args.synagogueId);
    const users = await designUsers(ctx, args.synagogueId);
    const names = new Map<string, string>();
    const nameOf = async (userId: Id<"users"> | undefined) => {
      if (userId === undefined) return null;
      if (!names.has(userId)) {
        const u = await ctx.db.get(userId);
        names.set(userId, u?.name ?? u?.email ?? "משתמש");
      }
      return names.get(userId)!;
    };

    const files = [];
    for (const f of schedules) {
      files.push({
        _id: f._id as string,
        type: "schedule" as const,
        title: f.title,
        firstDate: f.firstDate,
        status: f.status,
        size: await sizeOf(ctx, f),
        uploadedAt: f.submittedAt,
        uploadedBy: await nameOf(f.submittedBy),
        deletedAt: f.deletedAt ?? null,
        deletedBy: await nameOf(f.deletedBy),
        usedBy: [] as string[],
        url: await ctx.storage.getUrl(f.storageId),
      });
    }
    for (const d of designs) {
      files.push({
        _id: d._id as string,
        type: "design" as const,
        title: "עיצוב מקובץ",
        firstDate: null,
        status: null,
        size: await sizeOf(ctx, d),
        uploadedAt: d.createdAt,
        uploadedBy: null,
        deletedAt: null,
        deletedBy: null,
        usedBy: users.get(d.hash) ?? [],
        url: await ctx.storage.getUrl(d.storageId),
      });
    }
    files.sort((a, b) => b.uploadedAt - a.uploadedAt);
    return {
      used: files.reduce((sum, f) => sum + f.size, 0),
      quota: QUOTA_BYTES,
      maxSchedule: MAX_SCHEDULE_BYTES,
      maxDesign: MAX_DESIGN_BYTES,
      trashDays: TRASH_DAYS,
      files,
    };
  },
});

/** עיצוב שאף תבנית לא משתמשת בו. עיצוב בשימוש מוסרים מהתבנית עצמה */
export const purgeDesign = mutation({
  args: { synagogueId: v.id("synagogues"), designId: v.id("zmanimDesigns") },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    const design = await ctx.db.get(args.designId);
    if (design === null || design.synagogueId !== args.synagogueId) {
      throw new ConvexError("הקובץ לא נמצא");
    }
    if ((await designUsers(ctx, args.synagogueId)).has(design.hash)) {
      throw new ConvexError(
        "העיצוב בשימוש בתבנית. כדי למחוק אותו יש להסיר אותו מהתבנית בהגדרות הלוח, או למחוק את ההגדרות השמורות שמשתמשות בו",
      );
    }
    await ctx.storage.delete(design.storageId);
    await ctx.db.delete(design._id);
  },
});
