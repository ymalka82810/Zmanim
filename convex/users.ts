import { getAuthUserId } from "@convex-dev/auth/server";
import { query } from "./_generated/server";

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
    const ownerEmails = (process.env.OWNER_EMAIL ?? "")
      .split(",")
      .map((email) => email.trim())
      .filter((email) => email.length > 0);
    return {
      userId,
      name: user.name ?? null,
      email: user.email ?? null,
      image: user.image ?? null,
      isOwner: user.email !== undefined && ownerEmails.includes(user.email),
    };
  },
});
