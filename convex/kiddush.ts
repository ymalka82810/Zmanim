import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { displayName, getMembership, isManager, requireManager, requireMember } from "./roles";
import { hebrewYearOf } from "./hebrewDate";
import * as Notifications from "./notifications";

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

// נוסח ההכרזה: שורה קבועה של הגבאי, "ע״י" + בעל הקידוש, ואז "לרגל / לזכות / לעילוי נשמת…" + שם
const DEFAULT_KIDDUSH_HEADING = "קידוש לאחר התפילה";
const DEFAULT_KIDDUSH_BY = "ע״י";
const LIVING_SUFFIXES = ["שיחי׳", "שתחי׳", "שיחיו"];
const MEMORIAL_SUFFIXES = ["ז״ל", "ע״ה"];
const MEMORIAL_TYPE = "לעילוי נשמת";
const OCCASION_TYPES = ["לרגל", "לזכות", "לרפואת", "להצלחת", MEMORIAL_TYPE];

const clip = (s: string, max: number) => s.trim().slice(0, max);

const MAX_OCCASIONS = 5;
const occasionArg = v.object({ occasionType: v.optional(v.string()), occasion: v.string(), occasionSuffix: v.optional(v.string()) });
const announceArgs = {
  sponsorName: v.string(),
  sponsorSuffix: v.optional(v.string()),
  occasion: v.string(),
  occasionType: v.optional(v.string()),
  occasionSuffix: v.optional(v.string()),
  moreOccasions: v.optional(v.array(occasionArg)),
};

type OccasionInput = { occasion: string; occasionType?: string; occasionSuffix?: string };
/** סיבה אחת מהטופס, אחרי בדיקה שהבחירות מהרשימות המותרות. סיבה ריקה: הכול ריק */
function checkOccasion(args: OccasionInput) {
  const occasion = clip(args.occasion, 80);
  const occasionType = occasion ? args.occasionType || "לרגל" : "";
  if (occasionType && !OCCASION_TYPES.includes(occasionType)) {
    throw new ConvexError("בחירה לא תקינה בשורת הסיבה");
  }
  const occasionSuffix = occasion ? args.occasionSuffix ?? "" : "";
  const suffixes = occasionType === MEMORIAL_TYPE ? MEMORIAL_SUFFIXES : LIVING_SUFFIXES;
  if (occasionSuffix && !suffixes.includes(occasionSuffix)) {
    throw new ConvexError("בחירה לא תקינה אחרי השם בשורת הסיבה");
  }
  return { occasion, occasionType, occasionSuffix };
}

/** שדות ההכרזה מהטופס, אחרי בדיקה שהבחירות מהרשימות המותרות */
function announceFields(args: { sponsorName: string; sponsorSuffix?: string; occasion: string; occasionType?: string; occasionSuffix?: string; moreOccasions?: OccasionInput[] }) {
  const sponsorName = clip(args.sponsorName, 60);
  if (!sponsorName) {
    throw new ConvexError("נא למלא את שם בעל הקידוש");
  }
  const sponsorSuffix = args.sponsorSuffix ?? "";
  if (sponsorSuffix && !LIVING_SUFFIXES.includes(sponsorSuffix)) {
    throw new ConvexError("בחירה לא תקינה אחרי השם");
  }
  if ((args.moreOccasions?.length ?? 0) + 1 > MAX_OCCASIONS) {
    throw new ConvexError(`אפשר להוסיף עד ${MAX_OCCASIONS} סיבות`);
  }
  // הסיבה הראשונה הלא-ריקה נשמרת בשדות הרגילים, והשאר ב-moreOccasions
  const all = [args, ...(args.moreOccasions ?? [])].map(checkOccasion).filter((o) => o.occasion);
  const [first, ...rest] = all;
  const { occasion, occasionType, occasionSuffix } = first ?? { occasion: "", occasionType: "", occasionSuffix: "" };
  return { sponsorName, sponsorSuffix, occasion, occasionType, occasionSuffix, ...(rest.length ? { moreOccasions: rest } : {}) };
}

const withSuffix = (name: string, suffix?: string) => (suffix ? name + " " + suffix : name);
/** "משפחת לוי שיחיו" */
function sponsorLine(b: Doc<"kiddushBookings">) {
  return withSuffix(b.sponsorName, b.sponsorSuffix);
}
/** "לזכות בנם משה שיחי׳". רישום ישן בלי סוג: "לרגל …". כמה סיבות: כל אחת בשורה משלה (ירידת שורה) */
function occasionLine(b: Doc<"kiddushBookings">) {
  const one = (type: string | undefined, occasion: string, suffix: string | undefined) =>
    occasion ? (type || "לרגל") + " " + withSuffix(occasion, suffix) : "";
  return [
    one(b.occasionType, b.occasion, b.occasionSuffix),
    ...(b.moreOccasions ?? []).map((m) => one(m.occasionType, m.occasion, m.occasionSuffix)),
  ]
    .filter(Boolean)
    .join("\n");
}

type Cosponsor = NonNullable<Doc<"kiddushBookings">["cosponsors"]>[number];
const MAX_COSPONSORS = 5;
const cosponsorLine = (c: Cosponsor) => withSuffix(c.sponsorName, c.sponsorSuffix);
const hasPendingCosponsor = (b: Doc<"kiddushBookings">) => (b.cosponsors ?? []).some((c) => c.status === "pending");

/** הנרשם והשותפים שאישרו: "משפחת לוי וע״י משפחת כהן". ה"ע״י" הראשון מתווסף בלקוח, כמו תמיד */
function fullSponsorLine(b: Doc<"kiddushBookings">, by: string) {
  const lines = [sponsorLine(b), ...(b.cosponsors ?? []).filter((c) => c.status === "confirmed").map(cosponsorLine)];
  return lines.join(by ? ` ו${by} ` : " ו");
}

const cosponsorInput = v.object({ userId: v.optional(v.id("users")), sponsorName: v.string(), sponsorSuffix: v.optional(v.string()) });
const cosponsorArgs = v.optional(v.array(cosponsorInput));

/** בדיקת השותפים מהטופס. ברישום של חבר קהילה כל שותף חייב להיות חבר קהילה (כדי שיוכל לאשר) */
async function buildCosponsors(
  ctx: QueryCtx,
  synagogueId: Id<"synagogues">,
  ownerId: Id<"users">,
  input: { userId?: Id<"users">; sponsorName: string; sponsorSuffix?: string }[] | undefined,
  requireAccount: boolean,
): Promise<Cosponsor[]> {
  const list = input ?? [];
  if (list.length > MAX_COSPONSORS) {
    throw new ConvexError(`אפשר להוסיף עד ${MAX_COSPONSORS} שותפים`);
  }
  const seen = new Set<string>();
  const out: Cosponsor[] = [];
  for (const c of list) {
    const sponsorName = clip(c.sponsorName, 60);
    if (!sponsorName) {
      throw new ConvexError("נא למלא את שם השותף");
    }
    const sponsorSuffix = c.sponsorSuffix ?? "";
    if (sponsorSuffix && !LIVING_SUFFIXES.includes(sponsorSuffix)) {
      throw new ConvexError("בחירה לא תקינה אחרי שם השותף");
    }
    if (c.userId) {
      if (c.userId === ownerId) {
        throw new ConvexError("אי אפשר להוסיף את עצמך כשותף");
      }
      if (seen.has(c.userId)) {
        throw new ConvexError("אותו שותף נוסף פעמיים");
      }
      seen.add(c.userId);
      if ((await getMembership(ctx, synagogueId, c.userId)) === null) {
        throw new ConvexError("השותף אינו חבר בקהילה");
      }
    } else if (requireAccount) {
      throw new ConvexError("יש לבחור את השותף מחברי הקהילה");
    }
    out.push({
      ...(c.userId ? { userId: c.userId } : {}),
      sponsorName,
      sponsorSuffix,
      status: c.userId ? "pending" : "confirmed",
    });
  }
  return out;
}

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
  await Notifications.create(ctx, { synagogueId, type: "kiddush", to, text, by, dateKey });
}

async function userName(ctx: QueryCtx, userId: Id<"users">) {
  const user = await ctx.db.get(userId);
  return displayName(user);
}

/** שם להצגה לחברי קהילה אחרים: בלי כתובת מייל */
async function publicName(ctx: QueryCtx, userId: Id<"users">) {
  const user = await ctx.db.get(userId);
  return user?.hebrewName?.trim() || user?.name?.trim() || "חבר קהילה";
}

async function kiddushBy(ctx: QueryCtx, synagogueId: Id<"synagogues">) {
  return (await ctx.db.get(synagogueId))?.kiddushBy ?? DEFAULT_KIDDUSH_BY;
}

/** הודעה לכל השותפים בעלי חשבון ברישום */
async function notifyCosponsors(ctx: MutationCtx, b: Doc<"kiddushBookings">, by: Id<"users">, text: string) {
  for (const c of b.cosponsors ?? []) {
    if (c.userId && c.userId !== by) {
      await notify(ctx, b.synagogueId, by, c.userId, b.dateKey, text);
    }
  }
}

/** חברי הקהילה שאפשר לבחור כשותפים. נטען רק כשפותחים את טופס ההרשמה, ולא חושף כתובות מייל */
export const memberChoices = query({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.synagogueId);
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_synagogue", (q) => q.eq("synagogueId", args.synagogueId))
      .collect();
    const choices = await Promise.all(
      memberships.filter((m) => m.userId !== userId).map(async (m) => ({ userId: m.userId, name: await publicName(ctx, m.userId) })),
    );
    return choices.sort((a, b) => a.name.localeCompare(b.name, "he"));
  },
});

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
    const by = synagogue.kiddushBy ?? DEFAULT_KIDDUSH_BY;
    const bookings = await Promise.all(
      bookingDocs.map(async (b) => {
        const mine = b.userId === userId && !b.manual;
        const showPrivate = manager || mine;
        const partnerEntry = (b.cosponsors ?? []).find((c) => c.userId === userId);
        const seeAllPartners = showPrivate || partnerEntry !== undefined;
        return {
          dateKey: b.dateKey,
          status: b.status,
          manual: b.manual,
          mine,
          sponsorName: b.sponsorName,
          sponsorSuffix: b.sponsorSuffix ?? "",
          occasion: b.occasion,
          occasionType: b.occasionType || (b.occasion ? "לרגל" : ""),
          occasionSuffix: b.occasionSuffix ?? "",
          // כולל שותפים שאישרו, כך שכל מי שמציג את הלוח (שבוע, יומן, הדפסה) מציג אותם בלי שינוי
          sponsorLine: fullSponsorLine(b, by),
          // אותם שמות, כל אחד בנפרד – ללוח הזמנים, שמציג כל בעל קידוש בשורה משלו
          sponsorLines: [sponsorLine(b), ...(b.cosponsors ?? []).filter((c) => c.status === "confirmed").map(cosponsorLine)],
          occasionLine: occasionLine(b),
          cosponsors: seeAllPartners
            ? (b.cosponsors ?? []).map((c) => ({ line: cosponsorLine(c), status: c.status, isMe: c.userId === userId }))
            : [],
          awaitingPartners: hasPendingCosponsor(b),
          partner: partnerEntry?.status ?? null,
          invitedBy: partnerEntry ? await publicName(ctx, b.userId) : null,
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

    const notifications = await Notifications.listVisible(ctx, args.synagogueId, "kiddush", userId, manager);

    const rejectionDocs = await ctx.db
      .query("kiddushRejections")
      .withIndex("by_synagogue_user", (q) => q.eq("synagogueId", args.synagogueId).eq("userId", userId))
      .order("desc")
      .take(30);
    const rejections = rejectionDocs.map((r) => ({
      _id: r._id,
      dateKey: r.dateKey,
      sponsorLine: r.sponsorLine,
      occasionLine: r.occasionLine,
      reason: r.reason,
      rejectedAt: r.rejectedAt,
    }));

    return {
      synagogue: {
        name: synagogue.name,
        city: synagogue.city,
        il: synagogue.il,
        kiddushHeading: synagogue.kiddushHeading ?? DEFAULT_KIDDUSH_HEADING,
        kiddushBy: synagogue.kiddushBy ?? DEFAULT_KIDDUSH_BY,
      },
      role: membership.role,
      myPhone: membership.phone ?? "",
      bookings,
      terms,
      notifications,
      rejections,
    };
  },
});

export const register = mutation({
  args: {
    synagogueId: v.id("synagogues"),
    dateKey: v.string(),
    label: v.string(),
    ...announceArgs,
    cosponsors: cosponsorArgs,
    phone: v.string(),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId, membership } = await requireMember(ctx, args.synagogueId);
    await requireFreeDate(ctx, args.synagogueId, args.dateKey);
    const fields = announceFields(args);
    const cosponsors = await buildCosponsors(ctx, args.synagogueId, userId, args.cosponsors, true);
    const phone = clip(args.phone, 20);
    // גבאי או רב לא צריכים לאשר רישום של עצמם
    const selfApproved = isManager(membership.role);
    await ctx.db.insert("kiddushBookings", {
      synagogueId: args.synagogueId,
      dateKey: args.dateKey,
      status: selfApproved ? "approved" : "pending",
      ...(selfApproved ? { decidedBy: userId, decidedAt: Date.now() } : {}),
      userId,
      manual: false,
      ...fields,
      phone,
      note: clip(args.note, 200),
      blockLabel: "",
      termsVersion: await currentTermsVersion(ctx, args.synagogueId),
      termsAckAt: Date.now(),
      createdAt: Date.now(),
      hebrewYear: hebrewYearOf(args.dateKey),
      ...(cosponsors.length ? { cosponsors } : {}),
    });
    if (phone && membership.phone !== phone) {
      await ctx.db.patch(membership._id, { phone });
    }
    const sponsor = withSuffix(fields.sponsorName, fields.sponsorSuffix);
    const partnersNote = cosponsors.length ? " (ממתין לאישור השותפים)" : "";
    await notify(ctx, args.synagogueId, userId, "managers", args.dateKey,
      selfApproved
        ? `${await userName(ctx, userId)} רשם קידוש ב${clip(args.label, 80)}: ${sponsor}${partnersNote}`
        : `בקשה חדשה לקידוש ב${clip(args.label, 80)}: ${sponsor}${partnersNote}`);
    const registrant = await publicName(ctx, userId);
    for (const c of cosponsors) {
      await notify(ctx, args.synagogueId, userId, c.userId!, args.dateKey,
        `${registrant} הוסיף אותך כשותף לקידוש ב${clip(args.label, 80)}. יש לאשר או לדחות בלוח הקידושים.`);
    }
    return { status: selfApproved ? "approved" : "pending" };
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
    await notifyCosponsors(ctx, booking, userId, `הקידוש ב${clip(args.label, 80)} בוטל על ידי הנרשם.`);
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
    if (hasPendingCosponsor(booking)) {
      throw new ConvexError("הבקשה ממתינה לאישור של כל השותפים");
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
    await notifyCosponsors(ctx, booking, userId, `הקידוש ב${clip(args.label, 80)} בוטל על ידי הגבאי.`);
    if (!booking.manual) {
      const reason = clip(args.reason, 160);
      await notify(ctx, args.synagogueId, userId, booking.userId, args.dateKey,
        `הרישום שלך לקידוש ב${clip(args.label, 80)} בוטל על ידי הגבאי.${reason ? " סיבה: " + reason : ""}`);
      await ctx.db.insert("kiddushRejections", {
        synagogueId: args.synagogueId,
        userId: booking.userId,
        dateKey: args.dateKey,
        sponsorLine: fullSponsorLine(booking, await kiddushBy(ctx, args.synagogueId)),
        occasionLine: occasionLine(booking),
        reason,
        rejectedBy: userId,
        rejectedAt: Date.now(),
      });
    }
  },
});

/** מחיקת בקשה שנדחתה מהרשימה של המבקש, אחרי שראה אותה */
export const dismissRejection = mutation({
  args: { synagogueId: v.id("synagogues"), rejectionId: v.id("kiddushRejections") },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.synagogueId);
    const rejection = await ctx.db.get(args.rejectionId);
    if (rejection === null || rejection.synagogueId !== args.synagogueId || rejection.userId !== userId) {
      throw new ConvexError("הבקשה לא נמצאה");
    }
    await ctx.db.delete(rejection._id);
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
      hebrewYear: hebrewYearOf(args.dateKey),
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
    ...announceArgs,
    cosponsors: cosponsorArgs,
    phone: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManager(ctx, args.synagogueId);
    await requireFreeDate(ctx, args.synagogueId, args.dateKey);
    const cosponsors = await buildCosponsors(ctx, args.synagogueId, userId, args.cosponsors, false);
    await ctx.db.insert("kiddushBookings", {
      synagogueId: args.synagogueId,
      dateKey: args.dateKey,
      status: "approved",
      userId,
      manual: true,
      ...announceFields(args),
      phone: clip(args.phone, 20),
      note: "",
      blockLabel: "",
      termsVersion: await currentTermsVersion(ctx, args.synagogueId),
      createdAt: Date.now(),
      decidedBy: userId,
      decidedAt: Date.now(),
      hebrewYear: hebrewYearOf(args.dateKey),
      ...(cosponsors.length ? { cosponsors } : {}),
    });
    const registrant = await publicName(ctx, userId);
    for (const c of cosponsors) {
      if (c.userId) {
        await notify(ctx, args.synagogueId, userId, c.userId, args.dateKey,
          `${registrant} רשם אותך כשותף לקידוש. יש לאשר או לדחות בלוח הקידושים.`);
      }
    }
  },
});

/** גבאי או רב מוסיפים בעלי קידוש לרישום קיים. שותף בלי חשבון נחשב מאושר, ושותף עם חשבון מקבל בקשה לאשר */
export const addSponsors = mutation({
  args: { synagogueId: v.id("synagogues"), dateKey: v.string(), label: v.string(), cosponsors: v.array(cosponsorInput) },
  handler: async (ctx, args) => {
    const { userId } = await requireManager(ctx, args.synagogueId);
    const booking = await requireBooking(ctx, args.synagogueId, args.dateKey);
    if (booking.status === "blocked") {
      throw new ConvexError("התאריך חסום");
    }
    const existing = booking.cosponsors ?? [];
    if (!args.cosponsors.length) {
      throw new ConvexError("נא להוסיף בעל קידוש");
    }
    if (existing.length + args.cosponsors.length > MAX_COSPONSORS) {
      throw new ConvexError(`אפשר להוסיף עד ${MAX_COSPONSORS} שותפים`);
    }
    const added = await buildCosponsors(ctx, args.synagogueId, booking.userId, args.cosponsors, false);
    const taken = new Set(existing.map((c) => c.userId).filter(Boolean));
    if (added.some((c) => c.userId && taken.has(c.userId))) {
      throw new ConvexError("אחד השותפים כבר ברישום");
    }
    await ctx.db.patch(booking._id, { cosponsors: [...existing, ...added] });
    const manager = await publicName(ctx, userId);
    const label = clip(args.label, 80);
    for (const c of added) {
      if (c.userId) {
        await notify(ctx, args.synagogueId, userId, c.userId, args.dateKey,
          `${manager} הוסיף אותך כשותף לקידוש ב${label}. יש לאשר או לדחות בלוח הקידושים.`);
      }
    }
    if (!booking.manual && booking.userId !== userId) {
      await notify(ctx, args.synagogueId, userId, booking.userId, args.dateKey,
        `${manager} הוסיף שותף לקידוש שלך ב${label}: ${added.map(cosponsorLine).join(", ")}.`);
    }
  },
});

/** גבאי או רב מסירים בעל קידוש נוסף. line: השורה כפי שמוצגת, לוודא שמסירים את מי שהתכוונו */
export const removeCosponsor = mutation({
  args: { synagogueId: v.id("synagogues"), dateKey: v.string(), label: v.string(), index: v.number(), line: v.string() },
  handler: async (ctx, args) => {
    const { userId } = await requireManager(ctx, args.synagogueId);
    const booking = await requireBooking(ctx, args.synagogueId, args.dateKey);
    const list = booking.cosponsors ?? [];
    const target = list[args.index];
    if (target === undefined || cosponsorLine(target) !== args.line) {
      throw new ConvexError("הרשימה השתנתה. נסו שוב");
    }
    await ctx.db.patch(booking._id, { cosponsors: list.filter((_, i) => i !== args.index) });
    if (target.userId) {
      await notify(ctx, args.synagogueId, userId, target.userId, args.dateKey,
        `הוסרת מהשותפות בקידוש ב${clip(args.label, 80)} על ידי הגבאי.`);
    }
  },
});

/** שותף מאשר או דוחה את ההשתתפות בקידוש. דחייה מסירה אותו מהרישום. ביטול אחרי אישור אינו נתמך כרגע */
export const respondCosponsor = mutation({
  args: { synagogueId: v.id("synagogues"), dateKey: v.string(), label: v.string(), accept: v.boolean() },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.synagogueId);
    const booking = await requireBooking(ctx, args.synagogueId, args.dateKey);
    const cosponsors = booking.cosponsors ?? [];
    const entry = cosponsors.find((c) => c.userId === userId);
    if (entry === undefined) {
      throw new ConvexError("לא הוזמנת להיות שותף בקידוש הזה");
    }
    if (entry.status !== "pending") {
      return;
    }
    const me = await publicName(ctx, userId);
    const label = clip(args.label, 80);
    if (args.accept) {
      const updated = cosponsors.map((c) => (c.userId === userId ? { ...c, status: "confirmed" as const, respondedAt: Date.now() } : c));
      await ctx.db.patch(booking._id, { cosponsors: updated });
      await notify(ctx, args.synagogueId, userId, booking.userId, args.dateKey, `${me} אישר להיות שותף בקידוש ב${label}.`);
      if (booking.status === "pending" && updated.every((c) => c.status === "confirmed")) {
        await notify(ctx, args.synagogueId, userId, "managers", args.dateKey,
          `כל השותפים אישרו את הקידוש ב${label}. הבקשה ממתינה לאישור.`);
      }
    } else {
      await ctx.db.patch(booking._id, { cosponsors: cosponsors.filter((c) => c.userId !== userId) });
      await notify(ctx, args.synagogueId, userId, booking.userId, args.dateKey, `${me} דחה את ההצעה להיות שותף בקידוש ב${label}.`);
      if (booking.status === "pending" && cosponsors.filter((c) => c.userId !== userId).every((c) => c.status === "confirmed")) {
        await notify(ctx, args.synagogueId, userId, "managers", args.dateKey,
          `שותף דחה את ההשתתפות בקידוש ב${label}. הבקשה ממתינה לאישור.`);
      }
    }
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

/** נוסח ההכרזה על הקידוש: רק גבאי או רב משנים אותו */
export const saveWording = mutation({
  args: { synagogueId: v.id("synagogues"), kiddushHeading: v.string(), kiddushBy: v.string() },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    const kiddushHeading = clip(args.kiddushHeading, 80);
    if (!kiddushHeading) {
      throw new ConvexError("נא למלא את השורה הראשונה");
    }
    await ctx.db.patch(args.synagogueId, { kiddushHeading, kiddushBy: clip(args.kiddushBy, 30) });
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
    await Notifications.markVisibleRead(ctx, args.synagogueId, "kiddush", userId, manager, NOTIFICATION_TTL_MS);
  },
});

/** מילוי חד-פעמי של hebrewYear לרישומים קיימים שנוצרו לפני הוספת השדה. אינו נוגע ברישומים שכבר מולאו */
export const backfillHebrewYear = internalMutation({
  args: {},
  handler: async (ctx) => {
    const bookings = await ctx.db.query("kiddushBookings").collect();
    let updated = 0;
    for (const b of bookings) {
      if (b.hebrewYear === undefined) {
        await ctx.db.patch(b._id, { hebrewYear: hebrewYearOf(b.dateKey) });
        updated++;
      }
    }
    return { total: bookings.length, updated };
  },
});
