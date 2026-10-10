import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { getMembership, isManager } from "./roles";
import * as Notifications from "./notifications";
import { todayKey } from "./hebrewDate";
import { countAwaiting, enabledFeatures } from "./features";

/**
 * מספר הדברים שלא טופלו בכל דף, למגירת התפריט. המפתח הוא נתיב הדף (כמו ב-js/menu.js). null – אין משתמש או חברות.
 * features – הפיצ'רים הנוספים שהקהילה הפעילה (convex/features.ts); דפים של פיצ'ר כבוי לא מוצגים בתפריט
 */
export const counts = query({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }
    const membership = await getMembership(ctx, args.synagogueId, userId);
    if (membership === null) {
      return null;
    }
    const manager = isManager(membership.role);
    const unread = (list: { read: boolean }[]) => list.filter((n) => !n.read).length;
    const visible = (type: Notifications.NotificationType) =>
      Notifications.listVisible(ctx, args.synagogueId, type, userId, manager);

    const [kiddushNotes, yahrzeitNotes, minyanNotes, fundNotes] = await Promise.all([
      visible("kiddush"),
      visible("yahrzeit"),
      visible("minyan"),
      Notifications.listForRecipient(ctx, args.synagogueId, "fund", userId),
    ]);

    let kiddush = unread(kiddushNotes);
    let schedule = 0;
    let account = 0;
    if (manager) {
      // בקשת קידוש שממתינה לאישור נספרת פעם אחת, גם אם ההתראה עליה עוד לא נקראה
      const pending = (
        await ctx.db
          .query("kiddushBookings")
          .withIndex("by_synagogue_date", (q) => q.eq("synagogueId", args.synagogueId).gte("dateKey", todayKey()))
          .collect()
      ).filter((b) => b.status === "pending" && !(b.cosponsors ?? []).some((c) => c.status === "pending"));
      const pendingDates = new Set(pending.map((b) => b.dateKey));
      kiddush = pending.length + unread(kiddushNotes.filter((n) => !(n.dateKey && pendingDates.has(n.dateKey))));

      const files = await ctx.db
        .query("scheduleFiles")
        .withIndex("by_synagogue_first", (q) => q.eq("synagogueId", args.synagogueId))
        .order("desc")
        .take(100);
      schedule = files.filter((f) => f.status === "pending" && f.deletedAt === undefined).length;
      account = await countAwaiting(ctx, args.synagogueId, userId);
    }
    const features = enabledFeatures(await ctx.db.get(args.synagogueId));
    // מכרזים פתוחים עכשיו, כדי שחברי הקהילה ישימו לב שאפשר להציע
    const openAuctions = features.includes("aliyot")
      ? (
          await ctx.db
            .query("auctions")
            .withIndex("by_synagogue_status_closes", (q) => q.eq("synagogueId", args.synagogueId).eq("status", "open"))
            .collect()
        ).length
      : 0;

    return {
      manager,
      features,
      "": schedule,
      "week/": features.includes("week") ? unread(yahrzeitNotes) + unread(minyanNotes) : 0,
      "kiddush/": kiddush,
      "gabbai/": unread(fundNotes),
      "account/": account,
      "aliyot/": openAuctions,
    };
  },
});
