import { v } from "convex/values";
import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { QueryCtx } from "./_generated/server";
import { logError } from "./errorLog";

/**
 * מחיר גרם כסף טהור בשקלים, לחישוב הסכום של מחצית השקל (js/special-donations.js, machatzitAmount).
 * מתעדכן פעם ביום (convex/crons.ts): מחיר אונקיית כסף בדולרים מ-gold-api.com, ושער הדולר היציג מבנק ישראל.
 */

const GRAMS_PER_OUNCE = 31.1034768;

async function getJson(url: string) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`${url}: ${res.status}`);
  }
  return await res.json();
}

export const refresh = internalAction({
  args: {},
  handler: async (ctx) => {
    try {
      const [silver, rate] = await Promise.all([
        getJson("https://api.gold-api.com/price/XAG"),
        getJson("https://boi.org.il/PublicApi/GetExchangeRate?key=USD"),
      ]);
      const usdPerOunce = Number(silver?.price);
      const usdIls = Number(rate?.currentExchangeRate) / (Number(rate?.unit) || 1);
      if (!(usdPerOunce > 1 && usdPerOunce < 1000) || !(usdIls > 1 && usdIls < 20)) {
        throw new Error(`מחיר לא סביר: כסף ${silver?.price}$, דולר ${rate?.currentExchangeRate}₪`);
      }
      await ctx.runMutation(internal.silverPrice.save, {
        ilsPerGram: Math.round((usdPerOunce / GRAMS_PER_OUNCE) * usdIls * 1000) / 1000,
        usdPerOunce,
        usdIls,
      });
    } catch (err) {
      console.error("עדכון מחיר הכסף נכשל", err);
      await ctx.runMutation(internal.silverPrice.failed, { message: err instanceof Error ? err.message : String(err) });
    }
  },
});

export const save = internalMutation({
  args: { ilsPerGram: v.number(), usdPerOunce: v.number(), usdIls: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("silverPrice").first();
    if (existing) {
      await ctx.db.patch(existing._id, { ...args, at: Date.now() });
    } else {
      await ctx.db.insert("silverPrice", { ...args, at: Date.now() });
    }
  },
});

export const failed = internalMutation({
  args: { message: v.string() },
  handler: async (ctx, args) => {
    await logError(ctx, "silver-price", "עדכון מחיר הכסף למחצית השקל נכשל", args.message);
  },
});

/** המחיר האחרון שנשמר, או null אם עוד לא נשמר מחיר */
export async function latestSilver(ctx: QueryCtx) {
  const p = await ctx.db.query("silverPrice").first();
  return p ? { ilsPerGram: p.ilsPerGram, at: p.at } : null;
}
