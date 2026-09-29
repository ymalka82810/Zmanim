import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { isManager, requireMember } from "./roles";
import * as Notifications from "./notifications";

/** "השבוע שלי": התראות אזכרות ומניין. קידוש, קופה ואירועים מגיעים מהשאילתות שלהם. */

const TYPES = ["yahrzeit", "minyan"] as const;
/** התראות ישנות מזה נמחקות כשגבאי או רב מסמנים כנקרא */
const TTL_MS = 30 * 24 * 3600 * 1000;

export const notifications = query({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, args) => {
    const { userId, membership } = await requireMember(ctx, args.synagogueId);
    const manager = isManager(membership.role);
    const lists = await Promise.all(
      TYPES.map((t) => Notifications.listVisible(ctx, args.synagogueId, t, userId, manager, 30)),
    );
    return lists.flat().sort((a, b) => b.at - a.at).slice(0, 30);
  },
});

export const markRead = mutation({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, args) => {
    const { userId, membership } = await requireMember(ctx, args.synagogueId);
    const manager = isManager(membership.role);
    for (const t of TYPES) {
      await Notifications.markVisibleRead(ctx, args.synagogueId, t, userId, manager, TTL_MS);
    }
  },
});
