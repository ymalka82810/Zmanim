import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { hebrewYearOf } from "./hebrewDate";
import { displayName, getMembership, isManager, requireManager, requireMember } from "./roles";
import { hasFeature, requireFeature } from "./features";
import * as Notifications from "./notifications";

/**
 * מכרז עליות, חלק מפיצר חלוקת העליות (לשונית "מכרז" ב-aliyot/): הגבאי או הרב פותחים מכירה פומבית על עלייה או כיבוד (שלישי, מפטיר, פתיחת הארון, גלילה,
 * או כל שם אחר), עם שעת פתיחה ושעת סגירה. חברי הקהילה מציעים בזמן אמת, וכל הצעה נשלחת כהתראה (type "auction")
 * לכל הקהילה, שמוצגת כהודעה צדדית בכל דף (js/menu.js, auctions:live).
 * בשעת הסגירה (ctx.scheduler) הזוכה נרשם כחוב פתוח בקופה, ובחלוקת העליות אם הפיצ'ר פעיל.
 */

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SPAN_MS = 60 * 864e5;
// התראות מכרז ישנות נמחקות בסגירת מכרז, כדי שהטבלה לא תגדל עם כל הצעה
const EVENTS_TTL_MS = 3 * 864e5;
const clip = (s: string, max: number) => s.trim().slice(0, max);
const shekel = (n: number) => "₪" + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

function checkTimes(opensAt: number, closesAt: number, now: number) {
  if (!(Number.isFinite(opensAt) && Number.isFinite(closesAt))) {
    throw new ConvexError("שעות לא תקינות");
  }
  if (closesAt <= opensAt) {
    throw new ConvexError("שעת הסגירה צריכה להיות אחרי שעת הפתיחה");
  }
  if (closesAt <= now) {
    throw new ConvexError("שעת הסגירה כבר עברה");
  }
  if (closesAt - now > MAX_SPAN_MS) {
    throw new ConvexError("אפשר לפתוח מכרז עד חודשיים מראש");
  }
}

function checkAmounts(minBid: number, step: number) {
  if (!(Number.isInteger(minBid) && minBid >= 1 && minBid < 1e7)) {
    throw new ConvexError("מחיר הפתיחה צריך להיות מספר שלם, לפחות ₪1");
  }
  if (!(Number.isInteger(step) && step >= 1 && step < 1e6)) {
    throw new ConvexError("קפיצת המחיר צריכה להיות מספר שלם, לפחות ₪1");
  }
}

async function getAuction(ctx: QueryCtx, synagogueId: Id<"synagogues">, id: Id<"auctions">) {
  const a = await ctx.db.get(id);
  if (a === null || a.synagogueId !== synagogueId) {
    throw new ConvexError("המכרז לא נמצא");
  }
  return a;
}

/** מתזמן פתיחה (אם בעתיד) וסגירה. משימה שמתוזמנת לפני שהשעות שונו לא עושה כלום, כי היא בודקת את השעה מחדש */
async function schedule(ctx: MutationCtx, a: { _id: Id<"auctions">; opensAt: number; closesAt: number }) {
  if (a.opensAt > Date.now()) {
    await ctx.scheduler.runAt(a.opensAt, internal.auctions.open, { id: a._id });
  }
  await ctx.scheduler.runAt(a.closesAt, internal.auctions.finalize, { id: a._id });
}

const minNext = (a: Doc<"auctions">) => (a.topAmount === undefined ? a.minBid : a.topAmount + a.step);

/**
 * המכרזים של הקהילה: הפתוחים ואלה שעוד לא נפתחו, ו-40 האחרונים שנסגרו. לכל מכרז 8 ההצעות הגבוהות.
 * כל חבר קהילה רואה את שמות המציעים – זו מכירה פומבית. */
export const list = query({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, args) => {
    const { userId, membership } = await requireMember(ctx, args.synagogueId);
    await requireFeature(ctx, args.synagogueId, "aliyot");
    const manager = isManager(membership.role);
    const synagogue = await ctx.db.get(args.synagogueId);
    const byStatus = (status: Doc<"auctions">["status"]) =>
      ctx.db
        .query("auctions")
        .withIndex("by_synagogue_status_closes", (q) => q.eq("synagogueId", args.synagogueId).eq("status", status));
    const active = [...(await byStatus("scheduled").collect()), ...(await byStatus("open").collect())];
    const closed = await byStatus("closed").order("desc").take(40);

    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_synagogue", (q) => q.eq("synagogueId", args.synagogueId))
      .collect();
    const members = await Promise.all(memberships.map(async (m) => ({ userId: m.userId, name: displayName(await ctx.db.get(m.userId)) })));
    members.sort((a, b) => a.name.localeCompare(b.name, "he"));

    const forNameOf = async (id: Id<"users"> | undefined, name: string | undefined) =>
      id ? displayName(await ctx.db.get(id)) : (name ?? "");

    const view = async (a: Doc<"auctions">) => {
      const bids = await ctx.db
        .query("auctionBids")
        .withIndex("by_auction_amount", (q) => q.eq("auctionId", a._id))
        .order("desc")
        .take(8);
      return {
        _id: a._id,
        dateKey: a.dateKey,
        title: a.title,
        order: a.order,
        opensAt: a.opensAt,
        closesAt: a.closesAt,
        minBid: a.minBid,
        step: a.step,
        status: a.status,
        bidCount: a.bidCount,
        top:
          a.topAmount === undefined
            ? null
            : {
                amount: a.topAmount,
                name: a.topName ?? "",
                mine: a.topUserId === userId,
                ...(manager ? { forName: await forNameOf(a.topForUserId, a.topForName) } : {}),
              },
        next: minNext(a),
        bids: await Promise.all(
          bids.map(async (b) => ({
            _id: b._id,
            amount: b.amount,
            name: b.name,
            at: b.at,
            mine: b.userId === userId,
            ...(manager ? { forName: await forNameOf(b.forUserId, b.forName) } : {}),
          })),
        ),
        recorded: a.transactionId !== undefined,
      };
    };

    return {
      role: membership.role,
      manager,
      synagogue: { name: synagogue?.name ?? "", il: synagogue?.il ?? true },
      active: await Promise.all(active.map(view)),
      closed: await Promise.all(closed.map(view)),
      members,
    };
  },
});

/**
 * להודעות הצדדיות בכל דף: מספר המכרזים הפתוחים, וההתראות האחרונות (הצעה, פתיחה, סגירה, זכייה),
 * בלי אלה שהמשתמש עצמו יצר. null כשהפיצ'ר כבוי או שהמשתמש אינו חבר בקהילה.
 */
export const live = query({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    const membership = userId === null ? null : await getMembership(ctx, args.synagogueId, userId);
    if (userId === null || membership === null || !(await hasFeature(ctx, args.synagogueId, "aliyot"))) {
      return null;
    }
    const manager = isManager(membership.role);
    const open = await ctx.db
      .query("auctions")
      .withIndex("by_synagogue_status_closes", (q) => q.eq("synagogueId", args.synagogueId).eq("status", "open"))
      .collect();
    const events = await Notifications.listVisible(ctx, args.synagogueId, "auction", userId, manager, 8);
    return { open: open.length, events: events.map((e) => ({ _id: e._id, text: e.text, at: e.at })) };
  },
});

/** פתיחת מכרז אחד או כמה (למשל כל העליות של שבת) עם אותן שעות ואותו מחיר פתיחה */
export const create = mutation({
  args: {
    synagogueId: v.id("synagogues"),
    dateKey: v.string(),
    titles: v.array(v.string()),
    opensAt: v.number(),
    closesAt: v.number(),
    minBid: v.number(),
    step: v.number(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireManager(ctx, args.synagogueId);
    await requireFeature(ctx, args.synagogueId, "aliyot");
    if (!DATE_KEY_RE.test(args.dateKey)) {
      throw new ConvexError("תאריך לא תקין");
    }
    const now = Date.now();
    checkTimes(args.opensAt, args.closesAt, now);
    checkAmounts(args.minBid, args.step);
    const titles = [...new Set(args.titles.map((t) => clip(t, 40)).filter(Boolean))];
    if (titles.length === 0) {
      throw new ConvexError("נא לבחור עלייה או כיבוד");
    }
    if (titles.length > 20) {
      throw new ConvexError("אפשר לפתוח עד 20 מכרזים בבת אחת");
    }
    const status = args.opensAt <= now ? ("open" as const) : ("scheduled" as const);
    for (const [i, title] of titles.entries()) {
      const id = await ctx.db.insert("auctions", {
        synagogueId: args.synagogueId,
        dateKey: args.dateKey,
        title,
        order: i,
        opensAt: args.opensAt,
        closesAt: args.closesAt,
        minBid: args.minBid,
        step: args.step,
        status,
        bidCount: 0,
        createdBy: userId,
        createdAt: now,
      });
      await schedule(ctx, { _id: id, opensAt: args.opensAt, closesAt: args.closesAt });
    }
    if (status === "open") {
      await Notifications.create(ctx, {
        synagogueId: args.synagogueId,
        type: "auction",
        to: "members",
        text: `נפתח מכרז: ${titles.join(", ")}`,
        by: userId,
        dateKey: args.dateKey,
      });
    }
  },
});

/** עריכה לפני הסגירה. אחרי שיש הצעות אפשר לשנות רק את השם ואת שעת הסגירה (להאריך או לקצר) */
export const update = mutation({
  args: {
    synagogueId: v.id("synagogues"),
    id: v.id("auctions"),
    title: v.string(),
    opensAt: v.number(),
    closesAt: v.number(),
    minBid: v.number(),
    step: v.number(),
  },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    await requireFeature(ctx, args.synagogueId, "aliyot");
    const a = await getAuction(ctx, args.synagogueId, args.id);
    if (a.status === "closed") {
      throw new ConvexError("המכרז כבר נסגר");
    }
    const title = clip(args.title, 40);
    if (!title) {
      throw new ConvexError("נא לכתוב שם לעלייה או לכיבוד");
    }
    const locked = a.bidCount > 0;
    const opensAt = locked ? a.opensAt : args.opensAt;
    const minBid = locked ? a.minBid : args.minBid;
    const step = locked ? a.step : args.step;
    const now = Date.now();
    checkTimes(opensAt, args.closesAt, now);
    checkAmounts(minBid, step);
    const status = a.status === "open" || opensAt <= now ? ("open" as const) : ("scheduled" as const);
    await ctx.db.patch(a._id, { title, opensAt, closesAt: args.closesAt, minBid, step, status });
    await schedule(ctx, { _id: a._id, opensAt, closesAt: args.closesAt });
  },
});

/** סגירה מיידית: הזוכה נקבע עכשיו, כמו בשעת הסגירה */
export const closeNow = mutation({
  args: { synagogueId: v.id("synagogues"), id: v.id("auctions") },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    await requireFeature(ctx, args.synagogueId, "aliyot");
    const a = await getAuction(ctx, args.synagogueId, args.id);
    if (a.status === "closed") {
      return;
    }
    await ctx.db.patch(a._id, { closesAt: Math.min(a.closesAt, Date.now()), opensAt: Math.min(a.opensAt, Date.now()) });
    await settle(ctx, a._id);
  },
});

/** מחיקת מכרז וההצעות שלו. חיוב בקופה ועלייה שכבר נרשמו בסגירה נשארים, ונמחקים שם אם צריך */
export const remove = mutation({
  args: { synagogueId: v.id("synagogues"), id: v.id("auctions") },
  handler: async (ctx, args) => {
    const { userId } = await requireManager(ctx, args.synagogueId);
    await requireFeature(ctx, args.synagogueId, "aliyot");
    const a = await getAuction(ctx, args.synagogueId, args.id);
    const bids = await ctx.db
      .query("auctionBids")
      .withIndex("by_auction_amount", (q) => q.eq("auctionId", a._id))
      .collect();
    for (const b of bids) {
      await ctx.db.delete(b._id);
    }
    await ctx.db.delete(a._id);
    if (a.status === "open" && a.bidCount > 0) {
      await Notifications.create(ctx, {
        synagogueId: args.synagogueId,
        type: "auction",
        to: "members",
        text: `המכרז על ${a.title} בוטל`,
        by: userId,
        dateKey: a.dateKey,
      });
    }
  },
});

/**
 * הצעת מחיר. ההצעה צריכה להיות לפחות ההצעה הגבוהה + קפיצת המחיר (או מחיר הפתיחה, כשאין עדיין הצעות).
 * מי שההצעה שלו כבר הגבוהה לא מתחרה בעצמו. המציע הוא תמיד המשלם, וכולם רואים את שמו.
 * אפשר לציין "עבור" (חבר קהילה או אורח): מי שהמציע מבקש שיעלה במקומו. זה גלוי לגבאי ולרב בלבד.
 */
export const bid = mutation({
  args: {
    synagogueId: v.id("synagogues"),
    id: v.id("auctions"),
    amount: v.number(),
    forUserId: v.optional(v.id("users")),
    forName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId: callerId } = await requireMember(ctx, args.synagogueId);
    await requireFeature(ctx, args.synagogueId, "aliyot");
    const a = await getAuction(ctx, args.synagogueId, args.id);
    const now = Date.now();
    if (a.status === "closed" || now >= a.closesAt) {
      throw new ConvexError("המכרז כבר נסגר");
    }
    if (now < a.opensAt) {
      throw new ConvexError("המכרז עוד לא נפתח");
    }

    const bidder = callerId;
    const name = displayName(await ctx.db.get(bidder));

    let forUserId: Id<"users"> | undefined;
    let forName = "";
    if (args.forUserId || args.forName) {
      if (args.forUserId) {
        const forMembership = await getMembership(ctx, args.synagogueId, args.forUserId);
        if (forMembership === null) {
          throw new ConvexError("החבר לא נמצא בקהילה");
        }
        if ((a.title === "כהן" || a.title === "לוי") && (forMembership.tribe ?? "israel") === "israel") {
          throw new ConvexError("מי שמסומן ישראל לא יכול לעלות לעליית כהן או לוי");
        }
        forUserId = args.forUserId;
      } else {
        forName = clip(args.forName ?? "", 80);
        if (!forName) {
          throw new ConvexError("נא לבחור חבר קהילה או לכתוב שם");
        }
      }
      if (forUserId === bidder) {
        forUserId = undefined;
      }
    }
    const hasFor = forUserId !== undefined || forName !== "";

    const amount = Math.round(args.amount);
    if (!(amount > 0 && amount < 1e8)) {
      throw new ConvexError("סכום לא תקין");
    }
    const needed = minNext(a);
    if (amount < needed) {
      throw new ConvexError(`ההצעה צריכה להיות לפחות ${shekel(needed)}`);
    }
    if (a.topAmount !== undefined && a.topUserId === bidder) {
      throw new ConvexError("ההצעה הגבוהה כבר שלך");
    }

    await ctx.db.insert("auctionBids", {
      synagogueId: args.synagogueId,
      auctionId: a._id,
      userId: bidder,
      name,
      ...(forUserId ? { forUserId } : {}),
      ...(forName ? { forName } : {}),
      amount,
      at: now,
      by: callerId,
    });
    const outbid = a.topUserId;
    await ctx.db.patch(a._id, {
      status: "open",
      topAmount: amount,
      topUserId: bidder,
      topName: name,
      topForUserId: forUserId,
      topForName: forName || undefined,
      bidCount: a.bidCount + 1,
    });
    await Notifications.create(ctx, {
      synagogueId: args.synagogueId,
      type: "auction",
      to: "members",
      text: `${name} הציע ${shekel(amount)} על ${a.title}`,
      by: bidder,
      dateKey: a.dateKey,
    });
    if (hasFor) {
      const forLabel = forUserId ? displayName(await ctx.db.get(forUserId)) : forName;
      await Notifications.create(ctx, {
        synagogueId: args.synagogueId,
        type: "auction",
        to: "managers",
        text: `${name} הציע ${shekel(amount)} על ${a.title} עבור ${forLabel}`,
        by: bidder,
        dateKey: a.dateKey,
      });
    }
    if (outbid && outbid !== bidder) {
      await Notifications.create(ctx, {
        synagogueId: args.synagogueId,
        type: "auction",
        to: outbid,
        text: `ההצעה שלך על ${a.title} נעקפה: ${shekel(amount)}`,
        by: bidder,
        dateKey: a.dateKey,
      });
    }
  },
});

/** פתיחה בשעה שנקבעה. משימה ישנה (מלפני שינוי השעה) לא עושה כלום */
export const open = internalMutation({
  args: { id: v.id("auctions") },
  handler: async (ctx, args) => {
    const a = await ctx.db.get(args.id);
    if (a === null || a.status !== "scheduled" || Date.now() < a.opensAt - 1000) {
      return;
    }
    await ctx.db.patch(a._id, { status: "open" });
    // כמה מכרזים שנפתחים יחד (כל העליות של שבת) מקבלים הודעה אחת, מהראשון בהם
    const siblings = (
      await ctx.db
        .query("auctions")
        .withIndex("by_synagogue_status_closes", (q) => q.eq("synagogueId", a.synagogueId).eq("status", "scheduled"))
        .collect()
    ).filter((s) => s.opensAt === a.opensAt && s.dateKey === a.dateKey);
    for (const s of siblings) {
      await ctx.db.patch(s._id, { status: "open" });
    }
    await Notifications.create(ctx, {
      synagogueId: a.synagogueId,
      type: "auction",
      to: "members",
      text: `נפתח מכרז: ${[a, ...siblings].sort((x, y) => x.order - y.order).map((s) => s.title).join(", ")}`,
      dateKey: a.dateKey,
    });
  },
});

/** סגירה בשעה שנקבעה. משימה ישנה (מלפני שהשעה הוארכה) לא עושה כלום */
export const finalize = internalMutation({
  args: { id: v.id("auctions") },
  handler: async (ctx, args) => {
    const a = await ctx.db.get(args.id);
    if (a === null || a.status === "closed" || Date.now() < a.closesAt - 1000) {
      return;
    }
    await settle(ctx, a._id);
  },
});

/** סגירת המכרז: רישום הזוכה כחוב פתוח בקופה ובחלוקת העליות, והודעה לקהילה ולזוכה */
async function settle(ctx: MutationCtx, id: Id<"auctions">) {
  const a = await ctx.db.get(id);
  if (a === null || a.status === "closed") {
    return;
  }
  const now = Date.now();
  const patch: Partial<Doc<"auctions">> = { status: "closed", finalizedAt: now };

  if (a.topAmount !== undefined) {
    // זוכה שעזב את הקהילה בינתיים נרשם בשמו בלבד
    const winner = a.topUserId && (await getMembership(ctx, a.synagogueId, a.topUserId)) !== null ? a.topUserId : undefined;
    const name = a.topName ?? "";
    patch.transactionId = await ctx.db.insert("fundTransactions", {
      synagogueId: a.synagogueId,
      type: "mitzvah",
      amount: a.topAmount,
      date: a.dateKey,
      hebrewYear: hebrewYearOf(a.dateKey),
      donorId: winner,
      name,
      desc: `${a.title} · מכרז`,
      method: "",
      mitzvah: a.title,
      month: "",
      category: "",
      vendor: "",
      paid: false,
      paidDate: "",
      createdAt: now,
      createdBy: a.createdBy,
    });
    // הפיצר יכול היה להיכבות בין פתיחת המכרז לסגירתו
    if (await hasFeature(ctx, a.synagogueId, "aliyot")) {
      // כשהזוכה קנה עבור מישהו אחר, זה מי שיעלה; הזוכה נשאר המשלם בקופה
      const forUser =
        a.topForUserId && (await getMembership(ctx, a.synagogueId, a.topForUserId)) !== null ? a.topForUserId : undefined;
      const caller = forUser ? displayName(await ctx.db.get(forUser)) : a.topForName || "";
      patch.aliyahId = await ctx.db.insert("aliyot", {
        synagogueId: a.synagogueId,
        dateKey: a.dateKey,
        aliyah: a.title,
        ...(forUser ? { userId: forUser } : !caller && winner ? { userId: winner } : {}),
        name: caller || name,
        createdBy: a.createdBy,
        createdAt: now,
        hebrewYear: hebrewYearOf(a.dateKey),
      });
    }
    await Notifications.create(ctx, {
      synagogueId: a.synagogueId,
      type: "auction",
      to: "members",
      text: `${name} זכה ב${a.title} ב-${shekel(a.topAmount)}`,
      by: winner,
      dateKey: a.dateKey,
    });
    if (winner) {
      await Notifications.create(ctx, {
        synagogueId: a.synagogueId,
        type: "auction",
        to: winner,
        text: `זכית ב${a.title} ב-${shekel(a.topAmount)}. הסכום נרשם בקופה לתשלום`,
        dateKey: a.dateKey,
      });
    }
  }
  await ctx.db.patch(a._id, patch);

  const old = await ctx.db
    .query("notifications")
    .withIndex("by_synagogue_type_at", (q) =>
      q.eq("synagogueId", a.synagogueId).eq("type", "auction").lt("at", now - EVENTS_TTL_MS),
    )
    .take(100);
  for (const n of old) {
    await ctx.db.delete(n._id);
  }
}
