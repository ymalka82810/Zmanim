import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { httpAction, internalMutation, query } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * עדכון עצמי של אפליקציית האנדרואיד (js/app-update.js, AppUpdaterPlugin.java).
 * ה-workflow ב-GitHub מעלה כל APK חתום ל-POST /app-release עם הסוד APP_RELEASE_SECRET,
 * והקישור להורדה ניתן רק למשתמש מחובר, כך שה-APK לא מפורסם בשום מקום ציבורי.
 */

/** הגרסה האחרונה אם היא חדשה מ-versionCode של האפליקציה המותקנת. null למשתמש לא מחובר */
export const latest = query({
  args: { versionCode: v.number() },
  handler: async (ctx, args) => {
    if ((await getAuthUserId(ctx)) === null) return null;
    const release = await ctx.db.query("appReleases").withIndex("by_versionCode").order("desc").first();
    if (release === null || release.versionCode <= args.versionCode) return null;
    const url = await ctx.storage.getUrl(release.storageId);
    if (url === null) return null;
    return { versionCode: release.versionCode, version: release.versionName, size: release.size, url };
  },
});

/** רושם APK שהועלה, ומוחק את הגרסאות הקודמות (כולל הקבצים) */
export const publish = internalMutation({
  args: { versionCode: v.number(), versionName: v.string(), storageId: v.id("_storage"), size: v.number() },
  handler: async (ctx, args) => {
    for (const old of await ctx.db.query("appReleases").collect()) {
      await ctx.storage.delete(old.storageId);
      await ctx.db.delete(old._id);
    }
    await ctx.db.insert("appReleases", { ...args, uploadedAt: Date.now() });
  },
});

/** POST /app-release?versionCode=57&versionName=1.0.57 עם Authorization: Bearer <APP_RELEASE_SECRET> וה-APK בגוף הבקשה */
export const upload = httpAction(async (ctx, request) => {
  const secret = process.env.APP_RELEASE_SECRET;
  if (!secret || request.headers.get("Authorization") !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }
  const params = new URL(request.url).searchParams;
  const versionCode = Number(params.get("versionCode"));
  if (!Number.isInteger(versionCode) || versionCode <= 0) return new Response("bad versionCode", { status: 400 });
  const versionName = params.get("versionName") || `1.0.${versionCode}`;
  const apk = await request.blob();
  if (apk.size === 0) return new Response("empty body", { status: 400 });
  const storageId = await ctx.storage.store(new Blob([apk], { type: "application/vnd.android.package-archive" }));
  await ctx.runMutation(internal.appUpdate.publish, { versionCode, versionName, storageId, size: apk.size });
  return new Response(`stored ${versionName} (${apk.size} bytes)`, { status: 200 });
});
