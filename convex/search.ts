import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { displayName, getMembership, isManager } from "./roles";
import { enabledFeatures, type Feature } from "./features";
import { daysBetween, hebrewDateText, nextYahrzeit, todayKey } from "./hebrewDate";
import { DEFAULT_KIDDUSH_BY, fullSponsorLine, occasionLine } from "./kiddush";
import { REASONS } from "./aliyot";
import { parseQuery, score } from "../js/search-words.js";

/**
 * אינדקס החיפוש של האתר והאפליקציה (שדה החיפוש בראש תפריט ההמבורגר, js/search.js).
 *
 * כל מקור (SOURCES) בונה את הרשומות שהמשתמש רשאי לראות, לפי אותם כללים של השאילתה שמציגה אותן בדף:
 * חבר קהילה מוצא רק מה שהוא כבר רואה (הקידושים המאושרים, התרומות שלו, האזכרות שלו ואלה שגלויות לקהילה...),
 * וגבאי ורב מוצאים גם את מה שפתוח רק להם (כל הקופה, רשימת החברים, לוחות שממתינים לאישור, טלפונים והערות).
 * מקור של פיצ'ר כבוי (convex/features.ts) לא נכנס לאינדקס. מקור חדש – מוסיפים ל-SOURCES עם אותה בדיקת הרשאה של הדף שלו.
 *
 * האינדקס נבנה בכל חיפוש מהנתונים של הקהילה (קהילה אחת היא עשרות עד אלפי רשומות). ההשוואה עצמה (ניקוד,
 * כתיב מלא, מילים נרדפות, אותיות שימוש) ב-js/search-words.js, המשותף לחיפוש בדפדפן.
 * כל מילה בחיפוש צריכה להופיע (באחת מצורותיה) בטקסט של הרשומה, גם כחלק ממילה.
 */

export type SearchKind = "event" | "kiddush" | "fund" | "yahrzeit" | "member" | "schedule" | "aliyah" | "minyan";

type Entry = {
  kind: SearchKind;
  /** השורה הראשית של התוצאה */
  title: string;
  /** שורה משנית להצגה */
  sub: string;
  /** "YYYY-MM-DD" כשלרשומה יש תאריך – לתצוגה ולמיון לפי קרבה להיום */
  dateKey: string | null;
  /** נתיב הדף ביחס לשורש האתר, כמו ב-js/menu.js */
  page: string;
  /** המקום המדויק בדף שממנו עושים את הפעולה על הרשומה (#go= ב-js/menu.js): "day:<תאריך>", "tx:<id>", "ui:<צעדים>"...
   * רק מקום שהמשתמש רואה בדף לפי ההרשאה שלו – גבאי מגיע לכפתורי העריכה, חבר קהילה לשורה עצמה */
  go: string;
  /** טקסט נוסף שנכלל בחיפוש ולא מוצג (טלפון, מייל, הערה) */
  extra?: string;
};

type Viewer = {
  ctx: QueryCtx;
  synagogueId: Id<"synagogues">;
  synagogue: Doc<"synagogues">;
  userId: Id<"users">;
  manager: boolean;
  features: Feature[];
  today: string;
  name: (userId: Id<"users">) => Promise<string>;
};

type Source = { feature?: Feature; managerOnly?: boolean; build: (v: Viewer) => Promise<Entry[]> };

const FUND_TYPES: Record<string, string> = {
  donation: "תרומה",
  mitzvah: "מכירת מצווה",
  salary: "משכורת",
  expense: "הוצאה",
  petty: "קנייה מקופה קטנה",
  pettyIn: "מילוי קופה קטנה",
};
const DONOR_TYPES = new Set(["donation", "mitzvah"]);
const DAY_NAMES = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "שבת"];
const money = (n: number) => "₪" + Math.round(n).toLocaleString("en-US");
const join = (...parts: (string | null | undefined)[]) => parts.map((p) => (p ?? "").trim()).filter(Boolean).join(" · ");

const SOURCES: Record<SearchKind, Source> = {
  // events:list – כל חברי הקהילה
  event: {
    build: async ({ ctx, synagogueId, manager }) => {
      const docs = await ctx.db
        .query("communityEvents")
        .withIndex("by_synagogue_date", (q) => q.eq("synagogueId", synagogueId))
        .collect();
      return docs.map((e) => ({
        kind: "event",
        title: e.title,
        sub: e.details,
        dateKey: e.dateKey,
        page: "community-calendar/",
        go: manager ? `day:${e.dateKey};[data-act=editEvent][data-id="${e._id}"]` : `day:${e.dateKey}`,
      }));
    },
  },

  // kiddush:board – כולם רואים את הקידושים שבלוח; טלפון והערה – רק הנרשם עצמו, גבאי ורב.
  // חבר קהילה לא מוצא בקשה של אחר שעוד ממתינה לאישור, וגם לא תאריך חסום
  kiddush: {
    build: async ({ ctx, synagogueId, synagogue, userId, manager, name }) => {
      const docs = await ctx.db
        .query("kiddushBookings")
        .withIndex("by_synagogue_date", (q) => q.eq("synagogueId", synagogueId))
        .collect();
      const by = synagogue.kiddushBy ?? DEFAULT_KIDDUSH_BY;
      const entries: Entry[] = [];
      for (const b of docs) {
        const mine = b.userId === userId && !b.manual;
        const partner = (b.cosponsors ?? []).some((c) => c.userId === userId);
        if (!manager && !mine && !partner && b.status !== "approved") {
          continue;
        }
        const showPrivate = manager || mine;
        if (b.status === "blocked") {
          entries.push({ kind: "kiddush", title: b.blockLabel || "תאריך חסום", sub: "תאריך חסום לקידוש", dateKey: b.dateKey, page: "kiddush/", go: `day:${b.dateKey}` });
          continue;
        }
        entries.push({
          kind: "kiddush",
          title: `קידוש ${by} ${fullSponsorLine(b, by)}`,
          sub: join(occasionLine(b).replace(/\n/g, " · "), b.status === "pending" ? "ממתין לאישור" : ""),
          dateKey: b.dateKey,
          page: "kiddush/",
          go: `day:${b.dateKey}`,
          extra: showPrivate ? join(b.phone, b.note, manager ? await name(b.userId) : "") : "",
        });
      }
      return entries;
    },
  },

  // fund:ledger – גבאי ורב: כל הקופה. חבר קהילה: רק התרומות ומכירות המצווה שמשויכות אליו
  fund: {
    build: async ({ ctx, synagogueId, userId, manager }) => {
      const docs = manager
        ? await ctx.db
            .query("fundTransactions")
            .withIndex("by_synagogue", (q) => q.eq("synagogueId", synagogueId))
            .collect()
        : (
            await ctx.db
              .query("fundTransactions")
              .withIndex("by_synagogue_donor", (q) => q.eq("synagogueId", synagogueId).eq("donorId", userId))
              .collect()
          ).filter((t) => DONOR_TYPES.has(t.type));
      return docs.map((t) => {
        const what = t.type === "mitzvah" ? `${FUND_TYPES.mitzvah}: ${t.mitzvah}` : FUND_TYPES[t.type] ?? t.type;
        const open = DONOR_TYPES.has(t.type) && !t.paid ? "טרם שולם" : "";
        return {
          kind: "fund",
          title: manager ? join(t.name || t.vendor, what) : what,
          sub: join(money(t.amount), t.desc, open),
          dateKey: t.date || null,
          page: "gabbai/",
          go: `tx:${t._id}`,
          extra: join(t.category, t.vendor, t.method, t.month, String(t.amount)),
        };
      });
    },
  },

  // yahrzeits:list – חבר רואה את שלו ואת הגלויות לקהילה; גבאי ורב רואים הכול
  yahrzeit: {
    feature: "week",
    build: async ({ ctx, synagogueId, userId, manager, today, name }) => {
      const docs = await ctx.db
        .query("yahrzeits")
        .withIndex("by_synagogue", (q) => q.eq("synagogueId", synagogueId))
        .collect();
      const entries: Entry[] = [];
      for (const y of docs) {
        const mine = y.userId === userId;
        if (!mine && !y.shared && !manager) {
          continue;
        }
        // מי שיכול לערוך (בעל האזכרה, גבאי ורב) מגיע לחלון העריכה; חבר קהילה – ליום האזכרה ביומן הקהילה
        const next = nextYahrzeit(y, today);
        const edit = mine || manager;
        entries.push({
          kind: "yahrzeit",
          title: `אזכרה: ${[y.relation, y.name].filter(Boolean).join(" ")}`,
          sub: join(hebrewDateText(y.hDay, y.hMonth, y.hYear), mine ? "שלי" : await name(y.userId)),
          dateKey: next,
          page: edit ? "week/" : "community-calendar/",
          go: edit ? `yahrzeit:${y._id}` : next ? `day:${next}` : "",
        });
      }
      return entries;
    },
  },

  // members:list – גבאי ורב בלבד, כולל מייל וטלפון
  member: {
    managerOnly: true,
    build: async ({ ctx, synagogueId }) => {
      const memberships = await ctx.db
        .query("memberships")
        .withIndex("by_synagogue", (q) => q.eq("synagogueId", synagogueId))
        .collect();
      const ROLE = { gabbai: "גבאי", rabbi: "רב", member: "חבר קהילה" };
      return await Promise.all(
        memberships.map(async (m) => {
          const user = await ctx.db.get(m.userId);
          return {
            kind: "member" as const,
            title: displayName(user),
            sub: join(ROLE[m.role], m.tribe === "kohen" ? "כהן" : m.tribe === "levi" ? "לוי" : "", m.phone),
            dateKey: null,
            page: "account/",
            go: `ui:[data-open="${synagogueId}"]|#btnOpenMembers|#sheet2 [data-role="${m.userId}"]`,
            extra: join(user?.email, user?.name, m.phone?.replace(/\D/g, "")),
          };
        }),
      );
    },
  },

  // schedules:list – חבר קהילה: לוחות מאושרים בלבד. גבאי ורב: גם לוחות שממתינים לאישור. בלי סל המחזור
  schedule: {
    build: async ({ ctx, synagogueId, manager }) => {
      const files = await ctx.db
        .query("scheduleFiles")
        .withIndex("by_synagogue_first", (q) => q.eq("synagogueId", synagogueId))
        .order("desc")
        .take(100);
      return files
        .filter((f) => f.deletedAt === undefined && (manager || f.status === "approved"))
        .map((f) => ({
          kind: "schedule",
          title: f.title,
          sub: f.status === "pending" ? "לוח זמנים · ממתין לאישור" : "לוח זמנים",
          dateKey: f.firstDate,
          page: manager ? "" : "community-calendar/",
          go: manager ? `ui:#tab-luach|#communityFiles [data-remove="${f._id}"]` : `day:${f.firstDate}`,
        }));
    },
  },

  // aliyot:board – גבאי ורב: כל העליות והחיובים. חבר קהילה: רק העליות שלו והחיובים העתידיים שלו
  aliyah: {
    feature: "aliyot",
    build: async ({ ctx, synagogueId, userId, manager, today, name }) => {
      const reasonLabel = (r: string | undefined) => (r ? (REASONS as Record<string, string>)[r] ?? r : "");
      const aliyot = (
        await ctx.db
          .query("aliyot")
          .withIndex("by_synagogue_date", (q) => q.eq("synagogueId", synagogueId))
          .collect()
      ).filter((a) => manager || a.userId === userId);
      const claims = (
        await ctx.db
          .query("aliyahClaims")
          .withIndex("by_synagogue_date", (q) => (manager ? q.eq("synagogueId", synagogueId) : q.eq("synagogueId", synagogueId).gte("dateKey", today)))
          .collect()
      ).filter((c) => manager || c.userId === userId);
      return [
        ...aliyot.map((a) => ({
          kind: "aliyah" as const,
          title: `${a.aliyah}: ${a.name}`,
          sub: join("עלייה לתורה", reasonLabel(a.reason)),
          dateKey: a.dateKey,
          page: "aliyot/",
          go: manager ? `day:${a.dateKey};[data-act=delAliyah][data-id="${a._id}"]` : `ui:.al-row[data-id="${a._id}"]`,
        })),
        ...(await Promise.all(
          claims.map(async (c) => ({
            kind: "aliyah" as const,
            title: `חיוב לעלייה: ${c.userId ? await name(c.userId) : c.name}`,
            sub: join(reasonLabel(c.reason), c.note),
            dateKey: c.dateKey,
            page: "aliyot/",
            go: manager ? `day:${c.dateKey};[data-act=delClaim][data-id="${c._id}"]` : `ui:[data-act=delClaim][data-id="${c._id}"]`,
          })),
        )),
      ];
    },
  },

  // minyan:list – כל חברי הקהילה
  minyan: {
    feature: "week",
    build: async ({ ctx, synagogueId, manager }) => {
      const docs = await ctx.db
        .query("minyanim")
        .withIndex("by_synagogue", (q) => q.eq("synagogueId", synagogueId))
        .collect();
      return docs.map((m) => ({
        kind: "minyan",
        title: m.name,
        sub: join(m.time, m.days.length === 7 ? "כל יום" : m.days.map((d) => DAY_NAMES[d]).join(" ")),
        dateKey: null,
        page: "week/",
        go: manager
          ? `ui:[data-act=manageMinyan]|[data-act=editMinyan][data-id="${m._id}"]`
          : `ui:[data-act=rsvp][data-id="${m._id}"]`,
      }));
    },
  },
};

const entryScore = (e: Entry, query: string[][]) =>
  score(e.title, [e.sub, e.extra ?? "", e.dateKey ?? ""].join(" "), query);

const MAX_PER_KIND = 8;
const MAX_TOTAL = 40;

/**
 * חיפוש בקהילה הפעילה. null – המשתמש לא מחובר או לא חבר בקהילה (החיפוש מציג אז רק את דפי האתר).
 * בכל סוג – עד MAX_PER_KIND תוצאות, ו-more מסמן שיש עוד ושכדאי לדייק את החיפוש.
 */
export const run = query({
  args: { synagogueId: v.id("synagogues"), q: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }
    const membership = await getMembership(ctx, args.synagogueId, userId);
    const synagogue = await ctx.db.get(args.synagogueId);
    if (membership === null || synagogue === null) {
      return null;
    }
    const queryTerms = parseQuery(args.q);
    if (queryTerms.length === 0) {
      return { items: [], more: false };
    }

    const names = new Map<Id<"users">, Promise<string>>();
    const viewer: Viewer = {
      ctx,
      synagogueId: args.synagogueId,
      synagogue,
      userId,
      manager: isManager(membership.role),
      features: enabledFeatures(synagogue),
      today: todayKey(),
      name: (id) => {
        if (!names.has(id)) {
          names.set(id, ctx.db.get(id).then(displayName));
        }
        return names.get(id)!;
      },
    };

    const allowed = (Object.keys(SOURCES) as SearchKind[]).filter((kind) => {
      const source = SOURCES[kind];
      return (!source.managerOnly || viewer.manager) && (!source.feature || viewer.features.includes(source.feature));
    });
    const built = await Promise.all(allowed.map((kind) => SOURCES[kind].build(viewer)));

    // הקרוב להיום קודם (עתידי לפני עבר באותו מרחק), אחרי הציון
    const distance = (e: Entry) => {
      if (!e.dateKey) return 1e6;
      const d = daysBetween(viewer.today, e.dateKey);
      return d >= 0 ? d : -d + 0.5;
    };
    let more = false;
    const picked: (Entry & { score: number })[] = [];
    for (const entries of built) {
      const matches = entries
        .map((e) => ({ ...e, score: entryScore(e, queryTerms) }))
        .filter((e) => e.score > 0)
        .sort((a, b) => b.score - a.score || distance(a) - distance(b));
      if (matches.length > MAX_PER_KIND) {
        more = true;
      }
      picked.push(...matches.slice(0, MAX_PER_KIND));
    }
    picked.sort((a, b) => b.score - a.score || distance(a) - distance(b));
    if (picked.length > MAX_TOTAL) {
      more = true;
    }

    const items = picked
      .slice(0, MAX_TOTAL)
      .map((e) => ({ kind: e.kind, title: e.title, sub: e.sub, dateKey: e.dateKey, page: e.page, go: e.go }));
    return { items, more };
  },
});
