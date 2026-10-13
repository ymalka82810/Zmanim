import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { logError } from "./errorLog";
import { isManager, requireUser } from "./roles";
import { quietUntil } from "./shabbat";
import type { Place } from "./shabbat";

/**
 * Web Push לטלפונים. כל התראה שנוצרת ב-Notifications.create עוברת כאן.
 *
 * שבת וחג: בזמן שבת או חג (מכניסתם ועד צאתם, לפי מיקום הקהילה) לא נשלח פוש.
 * התראות שאפשר לקרוא גם אחר כך (קופה ואזכרות) נדחות לצאת השבת או החג.
 * התראות שמאבדות את משמעותן (קריאה למניין, קידוש, מכרז) לא נשלחות כלל, וממשיכות להופיע באפליקציה.
 *
 * מפתחות VAPID הם סודות של Convex: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, ואופציונלית VAPID_SUBJECT.
 * בלי המפתחות לא נשלח כלום והאפליקציה ממשיכה לעבוד כרגיל.
 */

const DEFER_TYPES = new Set(["fund", "yahrzeit"]);
const MAX_DEFER_MS = 5 * 24 * 3600e3;
const BATCH = 100;
const MAX_PER_USER = 10;
const MAX_BODY = 300;

/** הדף שייפתח בלחיצה על ההתראה, יחסית לשורש האתר */
const URLS: Record<string, string> = {
  kiddush: "kiddush/",
  fund: "gabbai/",
  yahrzeit: "week/",
  minyan: "week/",
  auction: "aliyot/",
};

/** מיקום הקהילה מהגדרות לוח הזמנים שלה, ואם אין – ירושלים לקהילה בארץ. בחו"ל בלי הגדרות: null (חלון רחב) */
async function placeOf(ctx: QueryCtx, synagogueId: Id<"synagogues">, il: boolean): Promise<Place | null> {
  const doc = await ctx.db
    .query("zmanimSettings")
    .withIndex("by_synagogue", (q) => q.eq("synagogueId", synagogueId))
    .unique();
  if (doc) {
    try {
      const c = JSON.parse(doc.config) as { lat?: unknown; lng?: unknown; tz?: unknown; il?: unknown };
      if (typeof c.lat === "number" && typeof c.lng === "number" && typeof c.tz === "string") {
        return { lat: c.lat, lng: c.lng, tz: c.tz, il: typeof c.il === "boolean" ? c.il : il };
      }
    } catch {
      // הגדרות לא קריאות: ממשיכים לברירת המחדל
    }
  }
  return il ? { lat: 31.769, lng: 35.2163, tz: "Asia/Jerusalem", il: true } : null;
}

export const dispatch = internalMutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, { notificationId }) => {
    try {
      if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
        return;
      }
      const n = await ctx.db.get(notificationId);
      const synagogue = n ? await ctx.db.get(n.synagogueId) : null;
      if (!n || !synagogue) {
        return;
      }
      const now = Date.now();
      const until = quietUntil(now, await placeOf(ctx, n.synagogueId, synagogue.il), synagogue.il);
      if (until !== null) {
        if (DEFER_TYPES.has(n.type) && until - n.at < MAX_DEFER_MS) {
          await ctx.scheduler.runAfter(until - now + 60_000, internal.push.dispatch, { notificationId });
        }
        return;
      }

      let userIds: Id<"users">[];
      if (n.to === "managers" || n.to === "members") {
        const members = await ctx.db
          .query("memberships")
          .withIndex("by_synagogue", (q) => q.eq("synagogueId", n.synagogueId))
          .collect();
        userIds = members.filter((m) => n.to === "members" || isManager(m.role)).map((m) => m.userId);
      } else {
        userIds = [n.to];
      }
      userIds = [...new Set(userIds)].filter((u) => u !== n.by && !n.readBy.includes(u));

      const subs: { id: Id<"pushSubscriptions">; endpoint: string; p256dh: string; auth: string }[] = [];
      for (const userId of userIds) {
        const mine = await ctx.db
          .query("pushSubscriptions")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .take(MAX_PER_USER);
        for (const s of mine) {
          subs.push({ id: s._id, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth });
        }
      }
      const payload = JSON.stringify({
        title: synagogue.name,
        body: n.text.slice(0, MAX_BODY),
        url: URLS[n.type] ?? "./",
        tag: `${n.type}-${n._id}`,
      });
      for (let i = 0; i < subs.length; i += BATCH) {
        await ctx.scheduler.runAfter(0, internal.pushNode.send, { subs: subs.slice(i, i + BATCH), payload });
      }
    } catch (err) {
      console.error("שליחת פוש נכשלה", err);
      await logError(ctx, "push-dispatch", "שליחת פוש נכשלה", err instanceof Error ? err.message : String(err));
    }
  },
});

/** מחיקת מנוי שהשירות דחה (המכשיר ביטל או שהמנוי פג) */
export const removeSubscription = internalMutation({
  args: { id: v.id("pushSubscriptions") },
  handler: async (ctx, { id }) => {
    if (await ctx.db.get(id)) {
      await ctx.db.delete(id);
    }
  },
});

/** המפתח הציבורי שהדפדפן צריך כדי להירשם. null – הפוש עוד לא הוגדר בשרת */
export const publicKey = query({
  args: {},
  handler: async () => process.env.VAPID_PUBLIC_KEY ?? null,
});

const clipKey = (s: string) => s.trim().slice(0, 300);

export const subscribe = mutation({
  args: { endpoint: v.string(), p256dh: v.string(), auth: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const endpoint = args.endpoint.trim();
    if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000) {
      throw new ConvexError("כתובת ההתראות לא תקינה");
    }
    const p256dh = clipKey(args.p256dh);
    const auth = clipKey(args.auth);
    if (!p256dh || !auth) {
      throw new ConvexError("מפתחות ההתראות חסרים");
    }
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { userId, p256dh, auth });
      return;
    }
    const mine = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    if (mine.length >= MAX_PER_USER) {
      mine.sort((a, b) => a.createdAt - b.createdAt);
      for (const old of mine.slice(0, mine.length - MAX_PER_USER + 1)) {
        await ctx.db.delete(old._id);
      }
    }
    await ctx.db.insert("pushSubscriptions", { userId, endpoint, p256dh, auth, createdAt: Date.now() });
  },
});

export const unsubscribe = mutation({
  args: { endpoint: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", args.endpoint.trim()))
      .unique();
    if (existing && existing.userId === userId) {
      await ctx.db.delete(existing._id);
    }
  },
});
