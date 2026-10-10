import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

export const notificationTypeValidator = v.union(
  v.literal("kiddush"),
  v.literal("fund"),
  v.literal("yahrzeit"),
  v.literal("minyan"),
  v.literal("auction"),
);
export type NotificationType = "kiddush" | "fund" | "yahrzeit" | "minyan" | "auction";
type Recipient = Id<"users"> | "managers" | "members";

/** יצירת התראה. dateKey/by לקידוש ולמניין, transactionId לקופה בלבד. to: "members" – כל חברי הקהילה */
export async function create(
  ctx: MutationCtx,
  args: {
    synagogueId: Id<"synagogues">;
    type: NotificationType;
    to: Recipient;
    text: string;
    by?: Id<"users">;
    dateKey?: string;
    transactionId?: Id<"fundTransactions">;
  },
) {
  await ctx.db.insert("notifications", {
    synagogueId: args.synagogueId,
    type: args.type,
    to: args.to,
    text: args.text,
    at: Date.now(),
    readBy: [],
    by: args.by,
    dateKey: args.dateKey,
    transactionId: args.transactionId,
  });
}

const visibleTo = (n: { by?: Id<"users">; to: Recipient }, userId: Id<"users">, manager: boolean) =>
  n.by !== userId && (n.to === userId || n.to === "members" || (n.to === "managers" && manager));

/** התראות שמיועדות למשתמש (ישירות אליו, לכל הקהילה, או "managers" אם הוא גבאי/רב), בלי אלה שהוא עצמו יצר. לשימוש קידוש, אזכרות ומניין */
export async function listVisible(
  ctx: QueryCtx,
  synagogueId: Id<"synagogues">,
  type: NotificationType,
  userId: Id<"users">,
  manager: boolean,
  limit = 80,
) {
  const notes = await ctx.db
    .query("notifications")
    .withIndex("by_synagogue_type_at", (q) => q.eq("synagogueId", synagogueId).eq("type", type))
    .order("desc")
    .take(200);
  return notes
    .filter((n) => visibleTo(n, userId, manager))
    .slice(0, limit)
    .map((n) => ({ _id: n._id, text: n.text, at: n.at, dateKey: n.dateKey, read: n.readBy.includes(userId) }));
}

/** סימון כנקרא של כל ההתראות הנראות למשתמש, ומחיקת ישנות אם הוא גבאי/רב וניתן ttlMs. לשימוש קידוש */
export async function markVisibleRead(
  ctx: MutationCtx,
  synagogueId: Id<"synagogues">,
  type: NotificationType,
  userId: Id<"users">,
  manager: boolean,
  ttlMs?: number,
) {
  const notes = await ctx.db
    .query("notifications")
    .withIndex("by_synagogue_type_at", (q) => q.eq("synagogueId", synagogueId).eq("type", type))
    .order("desc")
    .take(200);
  for (const n of notes) {
    if (visibleTo(n, userId, manager) && !n.readBy.includes(userId)) {
      await ctx.db.patch(n._id, { readBy: [...n.readBy, userId] });
    }
  }
  if (manager && ttlMs !== undefined) {
    const old = await ctx.db
      .query("notifications")
      .withIndex("by_synagogue_type_at", (q) =>
        q.eq("synagogueId", synagogueId).eq("type", type).lt("at", Date.now() - ttlMs),
      )
      .take(50);
    for (const n of old) {
      await ctx.db.delete(n._id);
    }
  }
}

/** התראות שמיועדות ישירות למשתמש נתון (to === userId), כמו תזכורות קופה. לשימוש קופה */
export async function listForRecipient(
  ctx: QueryCtx,
  synagogueId: Id<"synagogues">,
  type: NotificationType,
  userId: Id<"users">,
  limit = 50,
) {
  const notes = await ctx.db
    .query("notifications")
    .withIndex("by_synagogue_type_to_at", (q) => q.eq("synagogueId", synagogueId).eq("type", type).eq("to", userId))
    .order("desc")
    .take(limit);
  return notes.map((n) => ({ _id: n._id, text: n.text, at: n.at, read: n.readBy.includes(userId) }));
}

/** סימון כנקרא של כל ההתראות הישירות למשתמש. לשימוש קופה */
export async function markRecipientRead(
  ctx: MutationCtx,
  synagogueId: Id<"synagogues">,
  type: NotificationType,
  userId: Id<"users">,
) {
  const notes = await ctx.db
    .query("notifications")
    .withIndex("by_synagogue_type_to_at", (q) => q.eq("synagogueId", synagogueId).eq("type", type).eq("to", userId))
    .collect();
  for (const n of notes) {
    if (!n.readBy.includes(userId)) {
      await ctx.db.patch(n._id, { readBy: [userId] });
    }
  }
}
