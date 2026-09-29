import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { assertRabbiAvailable, displayName, getMembership, normalizeEmail, requireManager, requireUser, roleValidator } from "./roles";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function myEmail(ctx: QueryCtx, userId: Id<"users">) {
  const user = await ctx.db.get(userId);
  return user?.email ? normalizeEmail(user.email) : null;
}

export const create = mutation({
  args: {
    synagogueId: v.id("synagogues"),
    email: v.string(),
    role: roleValidator,
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManager(ctx, args.synagogueId);
    const email = normalizeEmail(args.email);
    if (!EMAIL_RE.test(email)) {
      throw new ConvexError("כתובת המייל לא תקינה");
    }
    const existingUser = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();
    if (existingUser !== null && (await getMembership(ctx, args.synagogueId, existingUser._id)) !== null) {
      throw new ConvexError("המשתמש כבר חבר בקהילה");
    }
    if (args.role === "rabbi") {
      await assertRabbiAvailable(ctx, args.synagogueId);
    }
    const existing = await ctx.db
      .query("invitations")
      .withIndex("by_synagogue_email", (q) => q.eq("synagogueId", args.synagogueId).eq("email", email))
      .unique();
    let invitationId: Id<"invitations">;
    if (existing !== null) {
      await ctx.db.patch(existing._id, {
        role: args.role,
        invitedBy: userId,
        createdAt: Date.now(),
        emailStatus: "pending",
        emailError: undefined,
      });
      invitationId = existing._id;
    } else {
      invitationId = await ctx.db.insert("invitations", {
        synagogueId: args.synagogueId,
        email,
        role: args.role,
        invitedBy: userId,
        createdAt: Date.now(),
        emailStatus: "pending",
      });
    }

    const synagogue = await ctx.db.get(args.synagogueId);
    const inviter = await ctx.db.get(userId);
    await ctx.scheduler.runAfter(0, internal.email.sendInvitationEmail, {
      invitationId,
      email,
      role: args.role,
      synagogueName: synagogue?.name ?? "",
      invitedByName: displayName(inviter),
    });

    return invitationId;
  },
});

export const listForSynagogue = query({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    const invitations = await ctx.db
      .query("invitations")
      .withIndex("by_synagogue", (q) => q.eq("synagogueId", args.synagogueId))
      .collect();
    return invitations.map((i) => ({
      _id: i._id,
      email: i.email,
      role: i.role,
      createdAt: i.createdAt,
      emailStatus: i.emailStatus,
      emailError: i.emailError,
    }));
  },
});

export const setEmailStatus = internalMutation({
  args: {
    invitationId: v.id("invitations"),
    status: v.union(v.literal("sent"), v.literal("failed")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const invitation = await ctx.db.get(args.invitationId);
    if (invitation === null) {
      return;
    }
    await ctx.db.patch(invitation._id, { emailStatus: args.status, emailError: args.error });
  },
});

export const cancel = mutation({
  args: { invitationId: v.id("invitations") },
  handler: async (ctx, args) => {
    const invitation = await ctx.db.get(args.invitationId);
    if (invitation === null) {
      return;
    }
    await requireManager(ctx, invitation.synagogueId);
    await ctx.db.delete(invitation._id);
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const email = await myEmail(ctx, userId);
    if (email === null) {
      return [];
    }
    const invitations = await ctx.db
      .query("invitations")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect();
    const result = await Promise.all(
      invitations.map(async (i) => {
        const synagogue = await ctx.db.get(i.synagogueId);
        if (synagogue === null) {
          return null;
        }
        const inviter = await ctx.db.get(i.invitedBy);
        return {
          _id: i._id,
          role: i.role,
          synagogueName: synagogue.name,
          city: synagogue.city,
          invitedByName: displayName(inviter),
        };
      }),
    );
    return result.filter((i) => i !== null);
  },
});

async function requireOwnInvitation(ctx: QueryCtx, invitationId: Id<"invitations">) {
  const userId = await requireUser(ctx);
  const invitation = await ctx.db.get(invitationId);
  if (invitation === null || invitation.email !== (await myEmail(ctx, userId))) {
    throw new ConvexError("ההזמנה לא נמצאה");
  }
  return { userId, invitation };
}

export const accept = mutation({
  args: { invitationId: v.id("invitations") },
  handler: async (ctx, args) => {
    const { userId, invitation } = await requireOwnInvitation(ctx, args.invitationId);
    const membership = await getMembership(ctx, invitation.synagogueId, userId);
    if (membership === null) {
      if (invitation.role === "rabbi") {
        await assertRabbiAvailable(ctx, invitation.synagogueId, userId);
      }
      await ctx.db.insert("memberships", {
        userId,
        synagogueId: invitation.synagogueId,
        role: invitation.role,
        joinedAt: Date.now(),
      });
    }
    await ctx.db.delete(invitation._id);
    return invitation.synagogueId;
  },
});

export const decline = mutation({
  args: { invitationId: v.id("invitations") },
  handler: async (ctx, args) => {
    const { invitation } = await requireOwnInvitation(ctx, args.invitationId);
    await ctx.db.delete(invitation._id);
  },
});
