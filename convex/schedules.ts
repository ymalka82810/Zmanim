import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { isManager, requireManager, requireMember } from "./roles";
import { acceptUpload, MAX_SCHEDULE_BYTES, TRASH_DAYS } from "./storage";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const modeValidator = v.union(v.literal("holy"), v.literal("days"));
const fileArgs = { synagogueId: v.id("synagogues"), fileId: v.id("scheduleFiles") };

// לוחות ישנים נשמרו בלי kind, ואז סוג הלוח הוא הזהות
const keyOf = (f: { kind?: string; mode: string }) => f.kind ?? f.mode;

/** קבצים פעילים (לא בסל המחזור) של אותו לוח */
async function samePeriod(
  ctx: MutationCtx,
  file: Pick<Doc<"scheduleFiles">, "synagogueId" | "firstDate" | "kind" | "mode"> & { _id?: Id<"scheduleFiles"> },
) {
  const files = await ctx.db
    .query("scheduleFiles")
    .withIndex("by_synagogue_first", (q) => q.eq("synagogueId", file.synagogueId).eq("firstDate", file.firstDate))
    .collect();
  return files.filter((f) => keyOf(f) === keyOf(file) && f._id !== file._id && f.deletedAt === undefined);
}

async function deleteFile(ctx: MutationCtx, file: Doc<"scheduleFiles">) {
  await ctx.storage.delete(file.storageId);
  await ctx.db.delete(file._id);
}

async function requireFile(ctx: MutationCtx, synagogueId: Id<"synagogues">, fileId: Id<"scheduleFiles">) {
  const file = await ctx.db.get(fileId);
  if (file === null || file.synagogueId !== synagogueId) {
    throw new ConvexError("הקובץ לא נמצא");
  }
  return file;
}

/** חבר קהילה מקבל רק קבצים מאושרים. גבאי ורב מקבלים גם קבצים שממתינים לאישור. קבצים בסל המחזור לא מוצגים */
export const list = query({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, args) => {
    const { membership } = await requireMember(ctx, args.synagogueId);
    const manager = isManager(membership.role);
    const files = await ctx.db
      .query("scheduleFiles")
      .withIndex("by_synagogue_first", (q) => q.eq("synagogueId", args.synagogueId))
      .order("desc")
      .take(100);
    const visible = files
      .filter((f) => f.deletedAt === undefined && (manager || f.status === "approved"))
      .slice(0, 40);
    return {
      role: membership.role,
      files: await Promise.all(
        visible.map(async (f) => {
          const submitter = manager ? await ctx.db.get(f.submittedBy) : null;
          return {
            _id: f._id,
            title: f.title,
            firstDate: f.firstDate,
            mode: f.mode,
            status: f.status,
            url: await ctx.storage.getUrl(f.storageId),
            submittedAt: f.submittedAt,
            approvedAt: f.approvedAt ?? null,
            submittedBy: submitter ? submitter.name ?? submitter.email ?? "משתמש" : null,
          };
        }),
      ),
    };
  },
});

export const generateUploadUrl = mutation({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * קובץ חדש לאותו לוח מחליף קובץ קודם שעוד ממתין. הקובץ המאושר נשאר גלוי עד שהחדש מאושר.
 * מחזיר { id } או { error } (קובץ פסול, גדול מדי או שאין מקום בקהילה).
 */
export const submit = mutation({
  args: {
    synagogueId: v.id("synagogues"),
    storageId: v.id("_storage"),
    title: v.string(),
    firstDate: v.string(),
    mode: modeValidator,
    kind: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManager(ctx, args.synagogueId);
    if (!DATE_RE.test(args.firstDate)) {
      await ctx.storage.delete(args.storageId);
      return { error: "הקובץ לא תקין" };
    }
    // קובץ ממתין קודם של אותו לוח יוחלף, ולכן המקום שלו לא נספר
    const replaced = (await samePeriod(ctx, args)).filter((f) => f.status === "pending");
    const freed = replaced.reduce((sum, f) => sum + (f.size ?? 0), 0);
    const accepted = await acceptUpload(ctx, args.synagogueId, args.storageId, MAX_SCHEDULE_BYTES, "image/png", freed);
    if (accepted.error !== undefined) {
      return { error: accepted.error };
    }
    for (const other of replaced) {
      await deleteFile(ctx, other);
    }
    const id = await ctx.db.insert("scheduleFiles", {
      synagogueId: args.synagogueId,
      storageId: args.storageId,
      title: args.title.trim().slice(0, 120),
      firstDate: args.firstDate,
      mode: args.mode,
      kind: args.kind,
      status: "pending",
      submittedBy: userId,
      submittedAt: Date.now(),
      size: accepted.size,
    });
    return { id };
  },
});

export const approve = mutation({
  args: fileArgs,
  handler: async (ctx, args) => {
    const { userId } = await requireManager(ctx, args.synagogueId);
    const file = await requireFile(ctx, args.synagogueId, args.fileId);
    if (file.status === "approved" || file.deletedAt !== undefined) {
      return;
    }
    await ctx.db.patch(file._id, { status: "approved", approvedBy: userId, approvedAt: Date.now() });
    for (const other of await samePeriod(ctx, file)) {
      await deleteFile(ctx, other);
    }
  },
});

/** מחיקה רכה: דחייה של קובץ ממתין או הסרה של קובץ מאושר. הקובץ עובר לסל המחזור ואפשר לשחזר אותו */
export const remove = mutation({
  args: fileArgs,
  handler: async (ctx, args) => {
    const { userId } = await requireManager(ctx, args.synagogueId);
    const file = await requireFile(ctx, args.synagogueId, args.fileId);
    if (file.deletedAt === undefined) {
      await ctx.db.patch(file._id, { deletedAt: Date.now(), deletedBy: userId });
    }
  },
});

/** שחזור מסל המחזור. אם בינתיים נשלח לוח אחר לאותו תאריך, הקובץ חוזר כממתין לאישור */
export const restore = mutation({
  args: fileArgs,
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    const file = await requireFile(ctx, args.synagogueId, args.fileId);
    if (file.deletedAt === undefined) {
      return;
    }
    const conflict = (await samePeriod(ctx, file)).length > 0;
    await ctx.db.patch(file._id, {
      deletedAt: undefined,
      deletedBy: undefined,
      ...(conflict ? { status: "pending" as const, approvedAt: undefined, approvedBy: undefined } : {}),
    });
    return { pending: conflict && file.status === "approved" };
  },
});

/** מחיקה קשה: הקובץ נמחק לצמיתות ומפנה מקום */
export const purge = mutation({
  args: fileArgs,
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    const file = await requireFile(ctx, args.synagogueId, args.fileId);
    await deleteFile(ctx, file);
  },
});

export const emptyTrash = mutation({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    const files = await ctx.db
      .query("scheduleFiles")
      .withIndex("by_synagogue_first", (q) => q.eq("synagogueId", args.synagogueId))
      .collect();
    for (const f of files) {
      if (f.deletedAt !== undefined) await deleteFile(ctx, f);
    }
  },
});

export const purgeOldTrash = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - TRASH_DAYS * 24 * 60 * 60 * 1000;
    const old = await ctx.db
      .query("scheduleFiles")
      .withIndex("by_deletedAt", (q) => q.gt("deletedAt", 0).lt("deletedAt", cutoff))
      .take(200);
    for (const f of old) {
      await deleteFile(ctx, f);
    }
  },
});
