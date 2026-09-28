import Google from "@auth/core/providers/google";
import { convexAuth } from "@convex-dev/auth/server";

// com.zmanim.luach://localhost – חזרה לאפליקציית האנדרואיד אחרי הכניסה בדפדפן החיצוני (ראו MainActivity).
const ALLOWED_REDIRECT_BASE_URLS = [
  process.env.SITE_URL,
  "http://localhost:8080",
  "com.zmanim.luach://localhost",
].filter(
  (url): url is string => !!url,
);

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Google],
  callbacks: {
    async redirect({ redirectTo }) {
      const allowedBaseUrl = ALLOWED_REDIRECT_BASE_URLS.find(
        (baseUrl) =>
          redirectTo === baseUrl ||
          redirectTo.startsWith(`${baseUrl}/`) ||
          redirectTo.startsWith(`${baseUrl}?`),
      );
      if (allowedBaseUrl !== undefined) {
        return redirectTo;
      }
      if (redirectTo.startsWith("/") || redirectTo.startsWith("?")) {
        return `${ALLOWED_REDIRECT_BASE_URLS[0]}${redirectTo}`;
      }
      throw new Error(`Invalid \`redirectTo\` ${redirectTo}`);
    },
  },
});
