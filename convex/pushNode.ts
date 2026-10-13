"use node";
import { v } from "convex/values";
import webpush from "web-push";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

/** שליחת Web Push בפועל. רץ בסביבת Node כי ספריית web-push דורשת אותה. ההחלטה למי ומתי נעשית ב-push.dispatch */
export const send = internalAction({
  args: {
    subs: v.array(v.object({ id: v.id("pushSubscriptions"), endpoint: v.string(), p256dh: v.string(), auth: v.string() })),
    payload: v.string(),
  },
  handler: async (ctx, { subs, payload }) => {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    if (!publicKey || !privateKey) {
      return;
    }
    const subject = process.env.VAPID_SUBJECT ?? "https://github.com/ymalka82810/Zmanim";
    const results = await Promise.allSettled(
      subs.map((s) =>
        webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          vapidDetails: { subject, publicKey, privateKey },
          TTL: 6 * 3600,
          urgency: "normal",
        }),
      ),
    );
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === "fulfilled") {
        continue;
      }
      const status = (r.reason as { statusCode?: number } | undefined)?.statusCode;
      if (status === 404 || status === 410) {
        await ctx.runMutation(internal.push.removeSubscription, { id: subs[i].id });
      } else {
        console.error("שליחת פוש נכשלה", status, r.reason instanceof Error ? r.reason.message : r.reason);
      }
    }
  },
});
