import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { roleValidator } from "./roles";

const ROLE_LABELS: Record<string, string> = {
  gabbai: "גבאי",
  rabbi: "רב",
  member: "חבר קהילה",
};

export const sendInvitationEmail = internalAction({
  args: {
    email: v.string(),
    role: roleValidator,
    synagogueName: v.string(),
    invitedByName: v.string(),
  },
  handler: async (_ctx, args) => {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.error("RESEND_API_KEY לא מוגדר - לא ניתן לשלוח מייל הזמנה");
      return;
    }
    const from = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";
    const siteUrl = process.env.SITE_URL ?? "";
    const accountUrl = `${siteUrl}/Zmanim/account/`;
    const roleLabel = ROLE_LABELS[args.role] ?? args.role;

    const html = `
      <div dir="rtl" style="font-family: Arial, sans-serif; font-size: 16px; color: #222;">
        <p>שלום,</p>
        <p>${escapeHtml(args.invitedByName)} הזמין אותך להצטרף לקהילת <strong>${escapeHtml(
          args.synagogueName,
        )}</strong> בתפקיד ${escapeHtml(roleLabel)}.</p>
        <p>
          <a href="${accountUrl}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;">
            לצפייה בהזמנה ואישורה
          </a>
        </p>
        <p style="color:#666;font-size:13px;">אם הקישור לא עובד, היכנס לאזור האישי באתר בכתובת: ${accountUrl}</p>
      </div>
    `;

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: args.email,
        subject: `הזמנה להצטרף לקהילת ${args.synagogueName}`,
        html,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`שליחת מייל הזמנה נכשלה (${response.status}): ${body}`);
    }
  },
});

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
