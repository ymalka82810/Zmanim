import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { displayName, hasHebrewLetters, isOwnerEmail, needsHebrewName, requireUser } from "./roles";

export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }
    const user = await ctx.db.get(userId);
    if (user === null) {
      return null;
    }
    return {
      userId,
      name: displayName(user),
      email: user.email ?? null,
      image: user.image ?? null,
      isOwner: isOwnerEmail(user.email),
      needsHebrewName: needsHebrewName(user),
    };
  },
});

/** משתמש שחשבון הגוגל שלו לא הביא שם בעברית ממלא שם פרטי ושם משפחה בעברית, שיהיה שם המשתמש שלו באתר. */
export const setHebrewName = mutation({
  args: { firstName: v.string(), lastName: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const firstName = args.firstName.trim();
    const lastName = args.lastName.trim();
    if (!firstName || !lastName) {
      throw new ConvexError("נא למלא שם פרטי ושם משפחה");
    }
    if (!hasHebrewLetters(firstName) || !hasHebrewLetters(lastName)) {
      throw new ConvexError("נא למלא את השם בעברית");
    }
    await ctx.db.patch(userId, { hebrewName: `${firstName} ${lastName}` });
  },
});
