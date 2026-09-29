import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { requireManager } from "./roles";
import { checkConfig, designUrls } from "./zmanimSettings";

const MAX_NAME = 60;
const MAX_PROFILES = 30;

function cleanName(name: string) {
  const n = name.trim().replace(/\s+/g, " ");
  if (!n) throw new ConvexError("יש לתת שם להגדרות");
  if (n.length > MAX_NAME) throw new ConvexError(`השם ארוך מדי (עד ${MAX_NAME} תווים)`);
  return n;
}

async function ensureFreeName(
  ctx: QueryCtx,
  synagogueId: Id<"synagogues">,
  name: string,
  self?: Id<"zmanimProfiles">,
) {
  const same = await ctx.db
    .query("zmanimProfiles")
    .withIndex("by_synagogue_name", (q) => q.eq("synagogueId", synagogueId).eq("name", name))
    .first();
  if (same !== null && same._id !== self) throw new ConvexError(`כבר יש הגדרות שמורות בשם "${name}"`);
}

/** ההגדרות השמורות, אחרי בדיקה שהמשתמש גבאי או רב בקהילה שלהן */
async function ownProfile(ctx: QueryCtx, profileId: Id<"zmanimProfiles">) {
  const doc = await ctx.db.get(profileId);
  if (doc === null) throw new ConvexError("ההגדרות השמורות לא נמצאו. אולי גבאי אחר מחק אותן");
  const { userId } = await requireManager(ctx, doc.synagogueId);
  return { doc, userId };
}

export const list = query({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    const docs = await ctx.db
      .query("zmanimProfiles")
      .withIndex("by_synagogue_name", (q) => q.eq("synagogueId", args.synagogueId))
      .collect();
    const out = [];
    for (const d of docs) {
      const user = await ctx.db.get(d.updatedBy);
      out.push({
        _id: d._id,
        name: d.name,
        updatedAt: d.updatedAt,
        updatedBy: user?.name ?? user?.email ?? "משתמש",
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, "he"));
  },
});

/** ההגדרות עצמן, בנויות כמו zmanimSettings:get, לטעינה */
export const get = query({
  args: { profileId: v.id("zmanimProfiles") },
  handler: async (ctx, args) => {
    const { doc } = await ownProfile(ctx, args.profileId);
    return { name: doc.name, config: doc.config, designs: await designUrls(ctx, doc.synagogueId, doc.config) };
  },
});

export const create = mutation({
  args: { synagogueId: v.id("synagogues"), name: v.string(), config: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireManager(ctx, args.synagogueId);
    const name = cleanName(args.name);
    checkConfig(args.config);
    await ensureFreeName(ctx, args.synagogueId, name);
    const count = (
      await ctx.db
        .query("zmanimProfiles")
        .withIndex("by_synagogue_name", (q) => q.eq("synagogueId", args.synagogueId))
        .take(MAX_PROFILES)
    ).length;
    if (count >= MAX_PROFILES) {
      throw new ConvexError(`אפשר לשמור עד ${MAX_PROFILES} הגדרות. כדי לשמור עוד, יש למחוק הגדרות שכבר לא צריך`);
    }
    const now = Date.now();
    return await ctx.db.insert("zmanimProfiles", {
      synagogueId: args.synagogueId,
      name,
      config: args.config,
      createdBy: userId,
      createdAt: now,
      updatedBy: userId,
      updatedAt: now,
    });
  },
});

/** מחליף את התוכן בהגדרות הנוכחיות, בלי לשנות את השם */
export const overwrite = mutation({
  args: { profileId: v.id("zmanimProfiles"), config: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await ownProfile(ctx, args.profileId);
    checkConfig(args.config);
    await ctx.db.patch(args.profileId, { config: args.config, updatedBy: userId, updatedAt: Date.now() });
  },
});

export const rename = mutation({
  args: { profileId: v.id("zmanimProfiles"), name: v.string() },
  handler: async (ctx, args) => {
    const { doc } = await ownProfile(ctx, args.profileId);
    const name = cleanName(args.name);
    await ensureFreeName(ctx, doc.synagogueId, name, doc._id);
    await ctx.db.patch(args.profileId, { name });
  },
});

/** עיצוב שרק ההגדרות האלה השתמשו בו נמחק בשמירה הבאה של ההגדרות הפעילות */
export const remove = mutation({
  args: { profileId: v.id("zmanimProfiles") },
  handler: async (ctx, args) => {
    await ownProfile(ctx, args.profileId);
    await ctx.db.delete(args.profileId);
  },
});
