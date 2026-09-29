import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { randomInviteCode } from "./inviteCode";
import { isManager, requireManager } from "./roles";

export const create = mutation({
  args: {
    name: v.string(),
    city: v.string(),
    il: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new ConvexError("יש להתחבר");
    }
    const synagogueId = await ctx.db.insert("synagogues", {
      name: args.name,
      city: args.city,
      il: args.il,
      createdBy: userId,
      inviteCode: randomInviteCode(),
      createdAt: Date.now(),
    });
    await ctx.db.insert("memberships", {
      userId,
      synagogueId,
      role: "gabbai",
      joinedAt: Date.now(),
    });
    return synagogueId;
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return [];
    }
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const synagogues = await Promise.all(
      memberships.map(async (membership) => {
        const synagogue = await ctx.db.get(membership.synagogueId);
        if (synagogue === null) {
          return null;
        }
        return {
          _id: synagogue._id,
          name: synagogue.name,
          city: synagogue.city,
          il: synagogue.il,
          inviteCode: isManager(membership.role) ? synagogue.inviteCode : null,
          role: membership.role,
        };
      }),
    );
    return synagogues.filter((synagogue) => synagogue !== null);
  },
});

export const update = mutation({
  args: {
    synagogueId: v.id("synagogues"),
    name: v.string(),
    city: v.string(),
    il: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    await ctx.db.patch(args.synagogueId, {
      name: args.name,
      city: args.city,
      il: args.il,
    });
  },
});

/** גבאי או רב שנשאר לבד בקהילה יכול למחוק אותה. שאר הנתונים נמחקים ברקע, במנות. */
export const remove = mutation({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_synagogue", (q) => q.eq("synagogueId", args.synagogueId))
      .collect();
    if (memberships.length > 1) {
      throw new ConvexError("אפשר למחוק קהילה רק כשאין בה חברים נוספים");
    }
    const invitations = await ctx.db
      .query("invitations")
      .withIndex("by_synagogue", (q) => q.eq("synagogueId", args.synagogueId))
      .collect();
    for (const doc of [...memberships, ...invitations]) {
      await ctx.db.delete(doc._id);
    }
    await ctx.db.delete(args.synagogueId);
    await ctx.scheduler.runAfter(0, internal.synagogues.purgeData, { synagogueId: args.synagogueId });
  },
});

const PURGE_BATCH = 200;

/** מוחק את נתוני הקהילה שנמחקה, מנה אחר מנה, וממשיך בקריאה חדשה עד שלא נשאר כלום */
export const purgeData = internalMutation({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, args) => {
    const id = args.synagogueId;
    const docs = [
      ...(await ctx.db.query("kiddushBookings").withIndex("by_synagogue_date", (q) => q.eq("synagogueId", id)).take(PURGE_BATCH)),
      ...(await ctx.db.query("kiddushTerms").withIndex("by_synagogue_version", (q) => q.eq("synagogueId", id)).take(PURGE_BATCH)),
      ...(await ctx.db.query("fundTransactions").withIndex("by_synagogue", (q) => q.eq("synagogueId", id)).take(PURGE_BATCH)),
      ...(await ctx.db.query("fundSettings").withIndex("by_synagogue", (q) => q.eq("synagogueId", id)).take(PURGE_BATCH)),
      ...(await ctx.db.query("notifications").withIndex("by_synagogue_type_at", (q) => q.eq("synagogueId", id)).take(PURGE_BATCH)),
      ...(await ctx.db.query("communityEvents").withIndex("by_synagogue_date", (q) => q.eq("synagogueId", id)).take(PURGE_BATCH)),
      ...(await ctx.db.query("zmanimSettings").withIndex("by_synagogue", (q) => q.eq("synagogueId", id)).take(PURGE_BATCH)),
    ];
    const files = [
      ...(await ctx.db.query("scheduleFiles").withIndex("by_synagogue_first", (q) => q.eq("synagogueId", id)).take(PURGE_BATCH)),
      ...(await ctx.db.query("zmanimDesigns").withIndex("by_synagogue_hash", (q) => q.eq("synagogueId", id)).take(PURGE_BATCH)),
    ];
    for (const doc of docs) {
      await ctx.db.delete(doc._id);
    }
    for (const file of files) {
      await ctx.storage.delete(file.storageId);
      await ctx.db.delete(file._id);
    }
    if (docs.length + files.length > 0) {
      await ctx.scheduler.runAfter(0, internal.synagogues.purgeData, args);
    }
  },
});
