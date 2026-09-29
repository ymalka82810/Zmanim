import { getAuthUserId } from "@convex-dev/auth/server";
import { query } from "./_generated/server";
import { isOwnerEmail } from "./roles";

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
      name: user.name ?? null,
      email: user.email ?? null,
      image: user.image ?? null,
      isOwner: isOwnerEmail(user.email),
    };
  },
});
