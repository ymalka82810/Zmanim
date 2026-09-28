import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { isManager, requireManager, requireMember } from "./roles";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BYTES = 8 * 1024 * 1024;
const modeValidator = v.union(v.literal("holy"), v.literal("days"));

async function samePeriod(ctx: MutationCtx, file: Doc<"scheduleFiles">) {
  const files = await ctx.db
    .query("scheduleFiles")
    .withIndex("by_synagogue_first", (q) => q.eq("synagogueId", file.synagogueId).eq("firstDate", file.firstDate))
    .collect();
  // לוחות ישנים נשמרו בלי kind, ואז סוג הלוח הוא הזהות
  const key = (f: Doc<"scheduleFiles">) => f.kind ?? f.mode;
  return files.filter((f) => key(f) === key(file) && f._id !== file._id);
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

/** חבר קהילה מקבל רק קבצים מאושרים. גבאי ורב מקבלים גם קבצים שממתינים לאישור. */
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
    const visible = files.filter((f) => manager || f.status === "approved").slice(0, 40);
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

/** קובץ חדש לאותו לוח מחליף קובץ קודם שעוד ממתין. הקובץ המאושר נשאר גלוי עד שהחדש מאושר. */
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
    const meta = await ctx.db.system.get(args.storageId);
    const badFile = meta === null || meta.size > MAX_BYTES || meta.contentType !== "image/png";
    // מחזירים null במקום לזרוק שגיאה, אחרת גם מחיקת הקובץ הפסול מתבטלת
    if (!DATE_RE.test(args.firstDate) || badFile) {
      if (meta !== null) {
        await ctx.storage.delete(args.storageId);
      }
      return null;
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
    });
    const file = (await ctx.db.get(id))!;
    for (const other of await samePeriod(ctx, file)) {
      if (other.status === "pending") {
        await deleteFile(ctx, other);
      }
    }
    return id;
  },
});

export const approve = mutation({
  args: { synagogueId: v.id("synagogues"), fileId: v.id("scheduleFiles") },
  handler: async (ctx, args) => {
    const { userId } = await requireManager(ctx, args.synagogueId);
    const file = await requireFile(ctx, args.synagogueId, args.fileId);
    if (file.status === "approved") {
      return;
    }
    await ctx.db.patch(file._id, { status: "approved", approvedBy: userId, approvedAt: Date.now() });
    for (const other of await samePeriod(ctx, file)) {
      await deleteFile(ctx, other);
    }
  },
});

/** דחייה של קובץ ממתין, או הסרה של קובץ מאושר. */
export const remove = mutation({
  args: { synagogueId: v.id("synagogues"), fileId: v.id("scheduleFiles") },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    const file = await requireFile(ctx, args.synagogueId, args.fileId);
    await deleteFile(ctx, file);
  },
});
