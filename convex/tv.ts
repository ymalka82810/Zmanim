import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { displayName, requireManager } from "./roles";
import { managerIds } from "./features";

/**
 * מסך הטלוויזיה של בית הכנסת (tv/?c=קוד), שגבאי או רב עורכים מהטלפון (screen/): שקופיות הודעה, פס רץ, מה מוצג
 * במסך, ולאן מוביל ה-QR. שינוי נשמר כטיוטה ועולה למסך רק כשכל הגבאים והרב אישרו אותו (גבאי יחיד – מיד), כמו
 * הפעלת פיצ'רים (convex/features.ts). שינוי נוסף בטיוטה מאפס את האישורים
 */

const MAX_SLIDES = 20;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const clip = (s: unknown, max: number) => (typeof s === "string" ? s : "").trim().slice(0, max);

/** פריסת המסך: רשת של GRID×GRID תאים, ולכל אריח מיקום וגודל. null – הפריסה הרגילה, שמתאימה את עצמה למה שמוצג */
export const GRID = 12;
export const TILE_IDS = ["head", "board", "zmanim", "qr", "ticker"] as const;
export type Tile = { id: (typeof TILE_IDS)[number]; x: number; y: number; w: number; h: number };

export type Slide = { title: string; text: string; from: string; to: string };
export type Screen = {
  slides: Slide[];
  ticker: string;
  show: { zmanim: boolean; board: boolean; qr: boolean };
  rotateSec: number;
  qr: "guest" | "donate";
  qrText: string;
  layout: Tile[] | null;
};

export const DEFAULT_SCREEN: Screen = {
  slides: [],
  ticker: "",
  show: { zmanim: true, board: true, qr: true },
  rotateSec: 20,
  qr: "guest",
  qrText: "",
  layout: null,
};

/** פריסה תקינה: כל האריחים, בתוך הרשת ובלי חפיפה. אחרת null (הפריסה הרגילה) */
function layoutOf(raw: unknown): Tile[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Tile[] = [];
  for (const id of TILE_IDS) {
    const t = raw.find((x) => x && typeof x === "object" && (x as Record<string, unknown>).id === id) as
      | Record<string, number>
      | undefined;
    if (!t) return null;
    const { x, y, w, h } = t;
    if (![x, y, w, h].every(Number.isInteger) || x < 0 || y < 0 || w < 1 || h < 1 || x + w > GRID || y + h > GRID) return null;
    out.push({ id, x, y, w, h });
  }
  const overlap = (a: Tile, b: Tile) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) if (overlap(out[i], out[j])) return null;
  return out;
}

/** מנקה הגדרות מסך שהגיעו מהדפדפן (או מהמסד), כך שתמיד יש מבנה תקין */
export function normalize(raw: unknown): Screen {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const show = (o.show && typeof o.show === "object" ? o.show : {}) as Record<string, unknown>;
  const slides = (Array.isArray(o.slides) ? o.slides : [])
    .map((s) => {
      const x = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
      const from = clip(x.from, 10);
      const to = clip(x.to, 10);
      return {
        title: clip(x.title, 80),
        text: clip(x.text, 600),
        from: DATE_RE.test(from) ? from : "",
        to: DATE_RE.test(to) ? to : "",
      };
    })
    .filter((s) => s.title || s.text)
    .slice(0, MAX_SLIDES);
  const rotate = Math.round(Number(o.rotateSec));
  return {
    slides,
    ticker: clip(o.ticker, 300),
    show: { zmanim: show.zmanim !== false, board: show.board !== false, qr: show.qr !== false },
    rotateSec: rotate >= 5 && rotate <= 120 ? rotate : DEFAULT_SCREEN.rotateSec,
    qr: o.qr === "donate" ? "donate" : "guest",
    qrText: clip(o.qrText, 60),
    layout: layoutOf(o.layout),
  };
}

const parse = (json: string | undefined) => {
  if (!json) return null;
  try {
    return normalize(JSON.parse(json));
  } catch {
    return null;
  }
};

async function screenOf(ctx: QueryCtx, synagogueId: Id<"synagogues">) {
  return await ctx.db
    .query("tvScreens")
    .withIndex("by_synagogue", (q) => q.eq("synagogueId", synagogueId))
    .unique();
}

/** הגדרות המסך שמוצגות עכשיו, לדף המסך (בלי התחברות, לפי הקוד הציבורי). קוד לא קיים – null */
export const live = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    if (!args.code) return null;
    const synagogue = await ctx.db
      .query("synagogues")
      .withIndex("by_public", (q) => q.eq("publicCode", args.code))
      .unique();
    if (synagogue === null) return null;
    const row = await screenOf(ctx, synagogue._id);
    return parse(row?.live) ?? DEFAULT_SCREEN;
  },
});

/**
 * העליות והכיבודים שנקבעו במכרזים שנסגרו, מהיום והלאה, לשקופית במסך (בלי התחברות, לפי הקוד הציבורי).
 * מוצג מי עולה (לא מי שילם) ובלי סכומים. מקובץ לפי תאריך, בסדר המכרז
 */
export const aliyot = query({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    if (!args.code) return [];
    const synagogue = await ctx.db
      .query("synagogues")
      .withIndex("by_public", (q) => q.eq("publicCode", args.code))
      .unique();
    if (synagogue === null) return [];
    // שעון ישראל בקירוב (UTC+3), כמו ב-guest.ts
    const today = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const closed = await ctx.db
      .query("auctions")
      .withIndex("by_synagogue_status_closes", (q) => q.eq("synagogueId", synagogue._id).eq("status", "closed"))
      .order("desc")
      .take(60);
    const rows: { dateKey: string; order: number; title: string; name: string }[] = [];
    for (const a of closed) {
      if (a.dateKey < today || !a.aliyahId) continue;
      const aliyah = await ctx.db.get(a.aliyahId);
      if (aliyah === null || !aliyah.name) continue;
      rows.push({ dateKey: a.dateKey, order: a.order, title: a.title, name: aliyah.name });
    }
    rows.sort((x, y) => x.dateKey.localeCompare(y.dateKey) || x.order - y.order);
    const days: { dateKey: string; items: { title: string; name: string }[] }[] = [];
    for (const r of rows) {
      let day = days[days.length - 1];
      if (!day || day.dateKey !== r.dateKey) days.push((day = { dateKey: r.dateKey, items: [] }));
      day.items.push({ title: r.title, name: r.name });
    }
    return days.slice(0, 4);
  },
});

/** טיוטה שכל הגבאים והרב הנוכחיים אישרו עולה למסך. נקרא אחרי כל אישור, וגם כשגבאי או רב עוזבים או יורדים מתפקידם */
export async function settleTv(ctx: MutationCtx, synagogueId: Id<"synagogues">) {
  const row = await screenOf(ctx, synagogueId);
  if (!row?.draft) return;
  const managers = await managerIds(ctx, synagogueId);
  if (!managers.every((id) => row.approvals.includes(id))) return;
  await ctx.db.patch(row._id, {
    live: row.draft,
    liveAt: Date.now(),
    draft: undefined,
    draftBy: undefined,
    draftAt: undefined,
    approvals: [],
  });
}

/** 1 אם יש טיוטה שממתינה לאישור של המשתמש, לתג בתפריט */
export async function countAwaitingTv(ctx: QueryCtx, synagogueId: Id<"synagogues">, userId: Id<"users">) {
  const row = await screenOf(ctx, synagogueId);
  return row?.draft && !row.approvals.includes(userId) ? 1 : 0;
}

/** לדף העריכה: מה שמוצג עכשיו, הטיוטה (אם יש), מי אישר ומי עוד לא, והקוד הציבורי לקישור למסך */
export const editor = query({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, args) => {
    const { userId } = await requireManager(ctx, args.synagogueId);
    const synagogue = await ctx.db.get(args.synagogueId);
    const row = await screenOf(ctx, args.synagogueId);
    const managers = await managerIds(ctx, args.synagogueId);
    const name = async (id: Id<"users">) => displayName(await ctx.db.get(id));
    let draft = null;
    if (row?.draft) {
      const approvals = row.approvals;
      draft = {
        screen: parse(row.draft) ?? DEFAULT_SCREEN,
        by: row.draftBy ? await name(row.draftBy) : "",
        mine: row.draftBy === userId,
        at: row.draftAt ?? 0,
        approvedByMe: approvals.includes(userId),
        approved: await Promise.all(managers.filter((id) => approvals.includes(id)).map(name)),
        waiting: await Promise.all(managers.filter((id) => !approvals.includes(id)).map(name)),
      };
    }
    return {
      name: synagogue?.name ?? "",
      publicCode: synagogue?.publicCode ?? null,
      live: parse(row?.live) ?? DEFAULT_SCREEN,
      liveAt: row?.liveAt ?? null,
      draft,
      managers: managers.length,
    };
  },
});

async function ensureRow(ctx: MutationCtx, synagogueId: Id<"synagogues">): Promise<Doc<"tvScreens">> {
  const row = await screenOf(ctx, synagogueId);
  if (row) return row;
  const id = await ctx.db.insert("tvScreens", { synagogueId, approvals: [] });
  return (await ctx.db.get(id))!;
}

/**
 * שמירת שינוי במסך כטיוטה. מי ששמר נחשב כמי שאישר; שאר הגבאים והרב צריכים לאשר. טיוטה קיימת מוחלפת והאישורים
 * עליה מתאפסים. מחזיר live: true כשהשינוי עלה למסך מיד (גבאי יחיד)
 */
export const saveDraft = mutation({
  args: { synagogueId: v.id("synagogues"), screen: v.any() },
  handler: async (ctx, args) => {
    const { userId } = await requireManager(ctx, args.synagogueId);
    const json = JSON.stringify(normalize(args.screen));
    const row = await ensureRow(ctx, args.synagogueId);
    if (json === JSON.stringify(parse(row.live) ?? DEFAULT_SCREEN) && !row.draft) {
      throw new ConvexError("אין שינוי לעומת מה שמוצג במסך");
    }
    await ctx.db.patch(row._id, { draft: json, draftBy: userId, draftAt: Date.now(), approvals: [userId] });
    await settleTv(ctx, args.synagogueId);
    return { live: !(await screenOf(ctx, args.synagogueId))?.draft };
  },
});

export const approve = mutation({
  args: { synagogueId: v.id("synagogues"), draftAt: v.number() },
  handler: async (ctx, args) => {
    const { userId } = await requireManager(ctx, args.synagogueId);
    const row = await screenOf(ctx, args.synagogueId);
    if (!row?.draft) {
      throw new ConvexError("אין שינוי שממתין לאישור");
    }
    // מאשרים רק את הגרסה שהמשתמש ראה: אם מישהו שינה את הטיוטה בינתיים, צריך לעבור עליה שוב
    if (row.draftAt !== args.draftAt) {
      throw new ConvexError("הטיוטה השתנתה בינתיים. עברו עליה שוב ואשרו");
    }
    if (!row.approvals.includes(userId)) {
      await ctx.db.patch(row._id, { approvals: [...row.approvals, userId] });
    }
    await settleTv(ctx, args.synagogueId);
    return { live: !(await screenOf(ctx, args.synagogueId))?.draft };
  },
});

/** כל גבאי או הרב יכולים לדחות טיוטה (גם מי שהציע אותה – ביטול). המסך נשאר כמו שהוא */
export const discard = mutation({
  args: { synagogueId: v.id("synagogues") },
  handler: async (ctx, args) => {
    await requireManager(ctx, args.synagogueId);
    const row = await screenOf(ctx, args.synagogueId);
    if (row?.draft) {
      await ctx.db.patch(row._id, { draft: undefined, draftBy: undefined, draftAt: undefined, approvals: [] });
    }
  },
});
