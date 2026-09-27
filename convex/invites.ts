import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireGabbai } from "./synagogues";
import { randomInviteCode } from "./inviteCode";

export const preview = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const synagogue = await ctx.db
      .query("synagogues")
      .withIndex("by_invite", (q) => q.eq("inviteCode", args.code))
      .unique();
    if (synagogue === null) {
      return null;
    }
    return { name: synagogue.name, city: synagogue.city };
  },
});

export const join = mutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("יש להתחבר");
    }
    const synagogue = await ctx.db
      .query("synagogues")
      .withIndex("by_invite", (q) => q.eq("inviteCode", args.code))
      .unique();
    if (synagogue === null) {
      throw new Error("קישור ההזמנה לא נמצא");
    }
    const existingMembership = await ctx.db
      .query("memberships")
      .withIndex("by_synagogue_user", (q) =>
        q.eq("synagogueId", synagogue._id).eq("userId", userId),
      )
      .unique();
    if (existingMembership !== null) {
      return synagogue._id;
    }
    await ctx.db.insert("memberships", {
      userId,
      synagogueId: synagogue._id,
      role: "member",
      joinedAt: Date.now(),
    });
    return synagogue._id;
  },
});

export const rotate = mutation({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, args) => {
    await requireGabbai(ctx, args.synagogueId);
    const newCode = randomInviteCode();
    await ctx.db.patch(args.synagogueId, { inviteCode: newCode });
    return newCode;
  },
});
