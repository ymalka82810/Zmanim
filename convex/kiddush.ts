import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { isManager, requireManager, requireMember } from "./roles";

const DEFAULT_TERMS = {
  intro:
    "תודה שבחרתם לערוך קידוש בבית הכנסת! כדי שהקידוש יתנהל בכבוד ובסדר, נא לעבור על הדגשים הבאים ולתאם עם אחראי הקידושים עד יום חמישי.",
  items: [
    "כל המוצרים יהיו בהכשר מהודר המקובל על רב בית הכנסת. אין להביא אוכל ביתי ללא תיאום מראש.",
    "יש להכין הכול מבעוד יום. אין בישול או חימום בשבת; תבשילים חמים יונחו על פלטה או מקור חום מכוסה לפני כניסת השבת.",
    "יש להביא יין או מיץ ענבים לקידוש, כוסות וכלים חד-פעמיים.",
    "העריכה תתבצע לאחר תפילת שחרית ומוסף, בשקט וללא הפרעה למתפללים.",
    "לאחר הקידוש יש לפנות את השולחנות, לאסוף את הפסולת לשקיות ולהשאיר את האולם נקי.",
    "ביטול רישום יעשה לפחות שבוע מראש דרך המערכת, כדי שניתן יהיה לשבץ משפחה אחרת.",
  ],
};
const NOTIFICATION_TTL_MS = 120 * 864e5;
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

const clip = (s: string, max: number) => s.trim().slice(0, max);

function checkDateKey(dateKey: string) {
  if (!DATE_KEY_RE.test(dateKey)) {
    throw new ConvexError("תאריך לא תקין");
  }
}
function assertNotPast(dateKey: string) {
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  if (dateKey < yesterday) {
    throw new ConvexError("התאריך כבר עבר");
  }
}

async function getBooking(ctx: QueryCtx, synagogueId: Id<"synagogues">, dateKey: string) {
  return await ctx.db
    .query("kiddushBookings")
    .withIndex("by_synagogue_date", (q) => q.eq("synagogueId", synagogueId).eq("dateKey", dateKey))
    .unique();
}

async function requireFreeDate(ctx: QueryCtx, synagogueId: Id<"synagogues">, dateKey: string) {
  checkDateKey(dateKey);
  assertNotPast(dateKey);
  if ((await getBooking(ctx, synagogueId, dateKey)) !== null) {
    throw new ConvexError("התאריך כבר תפוס");
  }
}

async function currentTermsVersion(ctx: QueryCtx, synagogueId: Id<"synagogues">) {
  const latest = await ctx.db
    .query("kiddushTerms")
    .withIndex("by_synagogue_version", (q) => q.eq("synagogueId", synagogueId))
    .order("desc")
    .first();
  return latest?.version ?? 0;
}

async function notify(
  ctx: MutationCtx,
  synagogueId: Id<"synagogues">,
  by: Id<"users">,
  to: Id<"users"> | "managers",
  dateKey: string,
  text: string,
) {
  await ctx.db.insert("kiddushNotifications", { synagogueId, to, dateKey, text, at: Date.now(), by, readBy: [] });
}

async function userName(ctx: QueryCtx, userId: Id<"users">) {
  const user = await ctx.db.get(userId);
  return user?.name ?? user?.email ?? "משתמש";
}

/** כל מה שהלוח צריך, בשאילתה אחת שמתעדכנת בזמן אמת. פרטי קשר של אחרים חשופים לגבאי ולרב בלבד. */
export const board = query({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, args) => {
    const { userId, membership } = await requireMember(ctx, args.synagogueId);
    const manager = isManager(membership.role);
    const synagogue = await ctx.db.get(args.synagogueId);
    if (synagogue === null) {
      throw new ConvexError("הקהילה לא נמצאה");
    }

    const bookingDocs = await ctx.db
      .query("kiddushBookings")
      .withIndex("by_synagogue_date", (q) => q.eq("synagogueId", args.synagogueId))
      .collect();
    const bookings = await Promise.all(
      bookingDocs.map(async (b) => {
        const mine = b.userId === userId && !b.manual;
        const showPrivate = manager || mine;
        return {
          dateKey: b.dateKey,
          status: b.status,
          manual: b.manual,
          mine,
          sponsorName: b.sponsorName,
          occasion: b.occasion,
          blockLabel: b.blockLabel,
          termsVersion: b.termsVersion,
          phone: showPrivate ? b.phone : "",
          note: showPrivate ? b.note : "",
          registrant: manager ? await userName(ctx, b.userId) : null,
        };
      }),
    );

    const termDocs = await ctx.db
      .query("kiddushTerms")
      .withIndex("by_synagogue_version", (q) => q.eq("synagogueId", args.synagogueId))
      .order("desc")
      .collect();
    const terms = await Promise.all(
      termDocs.map(async (t) => ({
        version: t.version,
        intro: t.intro,
        items: t.items,
        note: t.note,
        editedAt: t.editedAt,
        editedBy: await userName(ctx, t.editedBy),
      })),
    );

    const noteDocs = await ctx.db
      .query("kiddushNotifications")
      .withIndex("by_synagogue_at", (q) => q.eq("synagogueId", args.synagogueId))
      .order("desc")
      .take(200);
    const notifications = noteDocs
      .filter((n) => n.by !== userId && (n.to === userId || (n.to === "managers" && manager)))
      .slice(0, 80)
      .map((n) => ({ _id: n._id, text: n.text, at: n.at, read: n.readBy.includes(userId) }));

    return {
      synagogue: { name: synagogue.name, city: synagogue.city, il: synagogue.il },
      role: membership.role,
      myPhone: membership.phone ?? "",
      bookings,
      terms,
      notifications,
    };
  },
});

export const register = mutation({
  args: {
    synagogueId: v.id("synagogues"),
    dateKey: v.string(),
    label: v.string(),
    sponsorName: v.string(),
    occasion: v.string(),
    phone: v.string(),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId, membership } = await requireMember(ctx, args.synagogueId);
    await requireFreeDate(ctx, args.synagogueId, args.dateKey);
    const sponsorName = clip(args.sponsorName, 60);
    if (!sponsorName) {
      throw new ConvexError("נא למלא שם שיוצג בלוח");
    }
    const phone = clip(args.phone, 20);
    await ctx.db.insert("kiddushBookings", {
      synagogueId: args.synagogueId,
      dateKey: args.dateKey,
      status: "pending",
      userId,
      manual: false,
      sponsorName,
      occasion: clip(args.occasion, 80),
      phone,
      note: clip(args.note, 200),
      blockLabel: "",
      termsVersion: await currentTermsVersion(ctx, args.synagogueId),
      termsAckAt: Date.now(),
      createdAt: Date.now(),
    });
    if (phone && membership.phone !== phone) {
      await ctx.db.patch(membership._id, { phone });
    }
    await notify(ctx, args.synagogueId, userId, "managers", args.dateKey,
      `בקשה חדשה לקידוש ב${clip(args.label, 80)}: ${sponsorName}`);
  },
});

/** חבר קהילה יכול לבטל רק רישום שלו. רישום של אחר מוסר רק על ידי גבאי או רב, דרך reject. */
export const cancelMine = mutation({
  args: { synagogueId: v.id("synagogues"), dateKey: v.string(), label: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.synagogueId);
    const booking = await getBooking(ctx, args.synagogueId, args.dateKey);
    if (booking === null) {
      return;
    }
    if (booking.userId !== userId || booking.manual || booking.status === "blocked") {
      throw new ConvexError("אפשר לבטל רק רישום שלך");
    }
    await ctx.db.delete(booking._id);
    await notify(ctx, args.synagogueId, userId, "managers", args.dateKey,
      `${await userName(ctx, userId)} ביטל את הקידוש ב${clip(args.label, 80)}. התאריך פנוי כעת.`);
  },
});

export const ackTerms = mutation({
  args: { synagogueId: v.id("synagogues"), dateKey: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.synagogueId);
    const booking = await getBooking(ctx, args.synagogueId, args.dateKey);
    if (booking === null || booking.userId !== userId || booking.manual) {
      throw new ConvexError("הרישום לא נמצא");
    }
    await ctx.db.patch(booking._id, {
      termsVersion: await currentTermsVersion(ctx, args.synagogueId),
      termsAckAt: Date.now(),
    });
  },
});

async function requireBooking(ctx: QueryCtx, synagogueId: Id<"synagogues">, dateKey: string): Promise<Doc<"kiddushBookings">> {
  const booking = await getBooking(ctx, synagogueId, dateKey);
  if (booking === null) {
    throw new ConvexError("הרישום לא נמצא");
  }
  return booking;
}

export const approve = mutation({
  args: { synagogueId: v.id("synagogues"), dateKey: v.string(), label: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireManager(ctx, args.synagogueId);
    const booking = await requireBooking(ctx, args.synagogueId, args.dateKey);
    if (booking.status !== "pending") {
      return;
    }
    await ctx.db.patch(booking._id, { status: "approved", decidedBy: userId, decidedAt: Date.now() });
    if (!booking.manual) {
      await notify(ctx, args.synagogueId, userId, booking.userId, args.dateKey,
        `הקידוש שלך ב${clip(args.label, 80)} אושר. תודה!`);
    }
  },
});

export const reject = mutation({
  args: { synagogueId: v.id("synagogues"), dateKey: v.string(), label: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireManager(ctx, args.synagogueId);
    const booking = await requireBooking(ctx, args.synagogueId, args.dateKey);
    if (booking.status === "blocked") {
      throw new ConvexError("התאריך חסום. יש לשחרר אותו");
    }
    await ctx.db.delete(booking._id);
    if (!booking.manual) {
      const reason = clip(args.reason, 160);
      await notify(ctx, args.synagogueId, userId, booking.userId, args.dateKey,
        `הרישום שלך לקידוש ב${clip(args.label, 80)} בוטל על ידי הגבאי.${reason ? " סיבה: " + reason : ""}`);
    }
  },
});

export const block = mutation({
  args: { synagogueId: v.id("synagogues"), dateKey: v.string(), blockLabel: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireManager(ctx, args.synagogueId);
    await requireFreeDate(ctx, args.synagogueId, args.dateKey);
    const blockLabel = clip(args.blockLabel, 40);
    if (!blockLabel) {
      throw new ConvexError("נא למלא מה יוצג בלוח");
    }
    await ctx.db.insert("kiddushBookings", {
      synagogueId: args.synagogueId,
      dateKey: args.dateKey,
      status: "blocked",
      userId,
      manual: true,
      sponsorName: "",
      occasion: "",
      phone: "",
      note: "",
      blockLabel,
      termsVersion: 0,
      createdAt: Date.now(),
    });
  },
});

export const unblock = mutation({
  args: { synagogueId: v.id("synagogues"), dateKey: v.string() },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    const booking = await requireBooking(ctx, args.synagogueId, args.dateKey);
    if (booking.status !== "blocked") {
      throw new ConvexError("התאריך לא חסום");
    }
    await ctx.db.delete(booking._id);
  },
});

export const registerManual = mutation({
  args: {
    synagogueId: v.id("synagogues"),
    dateKey: v.string(),
    sponsorName: v.string(),
    occasion: v.string(),
    phone: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManager(ctx, args.synagogueId);
    await requireFreeDate(ctx, args.synagogueId, args.dateKey);
    const sponsorName = clip(args.sponsorName, 60);
    if (!sponsorName) {
      throw new ConvexError("נא למלא שם שיוצג בלוח");
    }
    await ctx.db.insert("kiddushBookings", {
      synagogueId: args.synagogueId,
      dateKey: args.dateKey,
      status: "approved",
      userId,
      manual: true,
      sponsorName,
      occasion: clip(args.occasion, 80),
      phone: clip(args.phone, 20),
      note: "",
      blockLabel: "",
      termsVersion: await currentTermsVersion(ctx, args.synagogueId),
      createdAt: Date.now(),
      decidedBy: userId,
      decidedAt: Date.now(),
    });
  },
});

async function insertTerms(
  ctx: MutationCtx,
  synagogueId: Id<"synagogues">,
  userId: Id<"users">,
  terms: { intro: string; items: string[]; note: string },
) {
  const version = (await currentTermsVersion(ctx, synagogueId)) + 1;
  await ctx.db.insert("kiddushTerms", { synagogueId, version, ...terms, editedBy: userId, editedAt: Date.now() });
  return version;
}

export const saveTerms = mutation({
  args: { synagogueId: v.id("synagogues"), intro: v.string(), items: v.array(v.string()), note: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireManager(ctx, args.synagogueId);
    const intro = clip(args.intro, 2000);
    const items = args.items.map((i) => clip(i, 500)).filter(Boolean).slice(0, 50);
    if (!intro && !items.length) {
      throw new ConvexError("ההנחיות ריקות");
    }
    return await insertTerms(ctx, args.synagogueId, userId, { intro, items, note: clip(args.note, 120) || "עדכון הנחיות" });
  },
});

export const restoreTerms = mutation({
  args: { synagogueId: v.id("synagogues"), version: v.number() },
  handler: async (ctx, args) => {
    const { userId } = await requireManager(ctx, args.synagogueId);
    const old = await ctx.db
      .query("kiddushTerms")
      .withIndex("by_synagogue_version", (q) => q.eq("synagogueId", args.synagogueId).eq("version", args.version))
      .unique();
    if (old === null) {
      throw new ConvexError("הגרסה לא נמצאה");
    }
    return await insertTerms(ctx, args.synagogueId, userId, {
      intro: old.intro,
      items: old.items,
      note: "שוחזר מגרסה " + old.version,
    });
  },
});

/** קהילה שעוד אין לה הנחיות מקבלת את ברירת המחדל כגרסה 1. */
export const initTerms = mutation({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, args) => {
    const { userId } = await requireManager(ctx, args.synagogueId);
    if ((await currentTermsVersion(ctx, args.synagogueId)) > 0) {
      return;
    }
    await insertTerms(ctx, args.synagogueId, userId, { ...DEFAULT_TERMS, note: "גרסה ראשונה" });
  },
});

export const markRead = mutation({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, args) => {
    const { userId, membership } = await requireMember(ctx, args.synagogueId);
    const manager = isManager(membership.role);
    const notes = await ctx.db
      .query("kiddushNotifications")
      .withIndex("by_synagogue_at", (q) => q.eq("synagogueId", args.synagogueId))
      .order("desc")
      .take(200);
    for (const n of notes) {
      const visible = n.by !== userId && (n.to === userId || (n.to === "managers" && manager));
      if (visible && !n.readBy.includes(userId)) {
        await ctx.db.patch(n._id, { readBy: [...n.readBy, userId] });
      }
    }
    if (manager) {
      const old = await ctx.db
        .query("kiddushNotifications")
        .withIndex("by_synagogue_at", (q) => q.eq("synagogueId", args.synagogueId).lt("at", Date.now() - NOTIFICATION_TTL_MS))
        .take(50);
      for (const n of old) {
        await ctx.db.delete(n._id);
      }
    }
  },
});
