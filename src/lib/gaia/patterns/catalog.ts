/**
 * Gaia's first built-in pattern collection: Japanese candlesticks.
 *
 * Educational reference, not a signal engine. A candle pattern is a
 * context-dependent price-action observation and must not be treated as
 * a standalone trade recommendation.
 */
import {
  CANDLESTICK_PATTERN_CATEGORIES,
  type CandlestickPattern,
  type CandlestickPatternSearchOptions,
} from "./types";

export {
  CANDLESTICK_PATTERN_CATEGORIES,
  type CandlestickPattern,
  type CandlestickPatternBias,
  type CandlestickPatternCategory,
  type CandlestickPatternSearchOptions,
} from "./types";

const CANDLESTICK_PATTERNS = [
  {
    id: "doji",
    name: "Doji",
    aliases: ["doji", "indecision", "neutral candle", "égalité ouverture clôture"],
    category: "indecision",
    bias: "neutral",
    candles: 1,
    description: "The candle opens and closes at identical or very close prices: its body is almost nonexistent.",
    marketContext: "It draws more attention after a sharp directional move or near an important technical zone.",
    interpretation: "It reflects a temporary balance between buyers and sellers, or market hesitation. On its own, it gives no reliable direction.",
    confirmation: "Wait for the next candle's reaction and check the position relative to structure, support or resistance.",
    caveats: "A lone Doji in the middle of a trendless market is often uninformative. Wick size varies by sub-category.",
  },
  {
    id: "long-legged-doji",
    name: "Long-Legged Doji",
    aliases: ["long legged doji", "long-legged", "doji longues mèches", "doji à longues jambes"],
    category: "indecision",
    bias: "neutral",
    candles: 1,
    description: "A Doji with long upper and lower wicks and a very small body.",
    marketContext: "Worth watching after a price extension or around a level where the market must choose a direction.",
    interpretation: "Both sides pushed price far from the open, but neither kept the advantage at the close.",
    confirmation: "Look for a later close outside the candle's range and a coherent market context.",
    caveats: "Long wicks can also reflect high volatility or a lack of liquidity.",
  },
  {
    id: "dragonfly-doji",
    name: "Dragonfly Doji",
    aliases: ["dragonfly", "dragonfly doji", "doji libellule"],
    category: "bullish-reversal",
    bias: "bullish",
    candles: 1,
    description: "A T-shaped Doji: a long lower wick, a body near the high, and little or no upper wick.",
    marketContext: "Its bullish read is more relevant after a decline or on an identified support.",
    interpretation: "Sellers first pushed price down, then buyers brought it back near the open.",
    confirmation: "A later bullish close, ideally above the Doji's high, strengthens the reversal case.",
    caveats: "Without a prior decline or confirmation, the shape alone is not enough to call a reversal.",
  },
  {
    id: "gravestone-doji",
    name: "Gravestone Doji",
    aliases: ["gravestone", "gravestone doji", "doji pierre tombale"],
    category: "bearish-reversal",
    bias: "bearish",
    candles: 1,
    description: "An inverted T-shaped Doji: a long upper wick, a body near the low, and little or no lower wick.",
    marketContext: "Watch after a rise or at a resistance level.",
    interpretation: "Buyers tried to push price higher, but sellers brought the close back near the open.",
    confirmation: "A later bearish close, preferably below the Doji's low, strengthens the case.",
    caveats: "The pattern is not automatically bearish when it appears inside a consolidation.",
  },
  {
    id: "hammer",
    name: "Hammer",
    aliases: ["hammer", "marteau", "bullish hammer"],
    category: "bullish-reversal",
    bias: "bullish",
    candles: 1,
    description: "A small body in the upper part of the candle, with a long lower wick and a short or absent upper wick.",
    marketContext: "A potential reversal pattern after a decline, especially near support.",
    interpretation: "Selling pressure was rejected and buyers regained control before the close.",
    confirmation: "Look for a following bullish candle and a move above the Hammer's high.",
    caveats: "Body color matters less than shape, but a bullish close can strengthen the read.",
  },
  {
    id: "hanging-man",
    name: "Hanging Man",
    aliases: ["hanging man", "pendu", "bearish hammer shape"],
    category: "bearish-reversal",
    bias: "bearish",
    candles: 1,
    description: "A shape close to the Hammer: a small body at the top and a long lower wick.",
    marketContext: "It appears after a rise and can signal weakening buying momentum.",
    interpretation: "Sellers managed to push price down during the session, even though buyers partly recovered the move.",
    confirmation: "A bearish close below the Hanging Man's body or low gives stronger confirmation.",
    caveats: "The same shape after a decline is generally read as a Hammer, not a Hanging Man.",
  },
  {
    id: "inverted-hammer",
    name: "Inverted Hammer",
    aliases: ["inverted hammer", "marteau inversé"],
    category: "bullish-reversal",
    bias: "bullish",
    candles: 1,
    description: "A small body in the lower part, a long upper wick, and a short or absent lower wick.",
    marketContext: "A potential reversal pattern after a decline.",
    interpretation: "Buyers attempted a strong rally, but price closed far from the high. The attempt can signal a shift in the balance of power.",
    confirmation: "A following bullish candle that exceeds the Inverted Hammer's high is preferable.",
    caveats: "A long upper wick without confirmation can simply show seller rejection.",
  },
  {
    id: "shooting-star",
    name: "Shooting Star",
    aliases: ["shooting star", "étoile filante"],
    category: "bearish-reversal",
    bias: "bearish",
    candles: 1,
    description: "A small body near the bottom of the candle, a long upper wick, and a short or absent lower wick.",
    marketContext: "A potential reversal signal after a rise, especially near resistance.",
    interpretation: "The intra-candle rally was rejected and sellers brought price back near the open.",
    confirmation: "A following bearish close below the body or the low strengthens the scenario.",
    caveats: "Do not confuse it with the Inverted Hammer: the shape is similar, but the market context differs.",
  },
  {
    id: "bullish-engulfing",
    name: "Bullish Engulfing",
    aliases: ["bullish engulfing", "avalement haussier", "englobante haussière"],
    category: "bullish-reversal",
    bias: "bullish",
    candles: 2,
    description: "A bullish candle whose body engulfs the body of the previous bearish candle.",
    marketContext: "More meaningful after a decline or near a demand zone.",
    interpretation: "The second candle shows a sharp shift from selling pressure to buying pressure.",
    confirmation: "Continued bullish follow-through or a break of a local level can confirm the change in momentum.",
    caveats: "Engulfing refers to the bodies under the classic definition; gaps are not required on all continuous markets.",
  },
  {
    id: "bearish-engulfing",
    name: "Bearish Engulfing",
    aliases: ["bearish engulfing", "avalement baissier", "englobante baissière"],
    category: "bearish-reversal",
    bias: "bearish",
    candles: 2,
    description: "A bearish candle whose body engulfs the body of the previous bullish candle.",
    marketContext: "More relevant after a rise or near resistance.",
    interpretation: "The second candle shows sellers taking over from the buyers of the previous candle.",
    confirmation: "A later close below the pattern zone or a break of a local low strengthens the scenario.",
    caveats: "A pattern against a strong trend can fail; check the context and the relative size of the candles.",
  },
  {
    id: "piercing-line",
    name: "Piercing Line",
    aliases: ["piercing line", "ligne de pénétration", "penetrating pattern"],
    category: "bullish-reversal",
    bias: "bullish",
    candles: 2,
    description: "After a bearish candle, a bullish candle closes above the midpoint of the previous body without fully engulfing it.",
    marketContext: "A potential reversal after a decline.",
    interpretation: "Buyers recover a large part of the first candle's loss.",
    confirmation: "Bullish follow-through above the second candle's high increases the reliability of the read.",
    caveats: "Opening-gap criteria vary by market; on continuous markets the gap may be absent.",
  },
  {
    id: "dark-cloud-cover",
    name: "Dark Cloud Cover",
    aliases: ["dark cloud cover", "couverture en nuage noir"],
    category: "bearish-reversal",
    bias: "bearish",
    candles: 2,
    description: "After a bullish candle, a bearish candle opens above or near the previous high, then closes below the midpoint of its body.",
    marketContext: "A potential reversal after a rise or near resistance.",
    interpretation: "Sellers erase a large part of the previous bullish advance.",
    confirmation: "An additional bearish close or a break of a nearby support strengthens the scenario.",
    caveats: "Gaps are less common on 24/5 or continuous markets; adapt the definition to the instrument.",
  },
  {
    id: "morning-star",
    name: "Morning Star",
    aliases: ["morning star", "étoile du matin"],
    category: "bullish-reversal",
    bias: "bullish",
    candles: 3,
    description: "A three-candle sequence: a strong bearish candle, a small hesitation candle, then a strong bullish candle.",
    marketContext: "A potential reversal pattern after a prolonged decline.",
    interpretation: "Selling pressure slows, hesitation appears, then buyers take the initiative.",
    confirmation: "The third candle should ideally close well into the body of the first.",
    caveats: "The small middle candle can be a Doji (Morning Doji Star). Gaps depend on the market.",
  },
  {
    id: "evening-star",
    name: "Evening Star",
    aliases: ["evening star", "étoile du soir"],
    category: "bearish-reversal",
    bias: "bearish",
    candles: 3,
    description: "A three-candle sequence: a strong bullish candle, a small hesitation candle, then a strong bearish candle.",
    marketContext: "A potential reversal pattern after a rise.",
    interpretation: "Buying momentum slows, hesitation sets in, then sellers take control.",
    confirmation: "The third candle should ideally close deep into the body of the first.",
    caveats: "The middle candle can be a Doji (Evening Doji Star). Gaps are not always present.",
  },
  {
    id: "three-white-soldiers",
    name: "Three White Soldiers",
    aliases: ["three white soldiers", "trois soldats blancs", "trois soldats haussiers"],
    category: "bullish-reversal",
    bias: "bullish",
    candles: 3,
    description: "Three long successive bullish candles, with progressively higher closes and relatively regular bodies.",
    marketContext: "Can mark a reversal after a decline or confirm a recovery from a base.",
    interpretation: "Buyers dominate several consecutive periods and push price up in a sustained way.",
    confirmation: "Check that the candles have solid bodies, closes near their highs, and few upper wicks.",
    caveats: "After a rally that is already very extended, the sequence can signal a late move rather than an interesting entry.",
  },
  {
    id: "three-black-crows",
    name: "Three Black Crows",
    aliases: ["three black crows", "trois corbeaux noirs", "trois corbeaux baissiers"],
    category: "bearish-reversal",
    bias: "bearish",
    candles: 3,
    description: "Three long successive bearish candles, with progressively lower closes and relatively regular bodies.",
    marketContext: "Can mark a reversal after a rise or confirm deteriorating structure.",
    interpretation: "Sellers dominate several periods and impose a sustained downward move.",
    confirmation: "Look for solid bodies, closes near the lows, and opens inside the previous body.",
    caveats: "After a sharp decline that is already extended, the pattern can be late; avoid reading it out of context.",
  },
] as const satisfies readonly CandlestickPattern[];

const SEARCHABLE_PATTERNS = CANDLESTICK_PATTERNS.map((pattern) => ({
  pattern,
  text: normalizeSearchText([
    pattern.name,
    pattern.id,
    ...pattern.aliases,
    pattern.description,
    pattern.category,
  ].join(" ")),
}));

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Returns a defensive readonly view of the built-in catalog. */
export function listCandlestickPatterns(): readonly CandlestickPattern[] {
  return CANDLESTICK_PATTERNS;
}

/** Resolves only known, code-owned ids; unknown ids never become asset paths. */
export function getCandlestickPattern(
  patternId: string,
): CandlestickPattern | undefined {
  return CANDLESTICK_PATTERNS.find((pattern) => pattern.id === patternId);
}

/** Search names, stable ids, aliases and short descriptions. */
export function searchCandlestickPatterns(
  options: CandlestickPatternSearchOptions = {},
): CandlestickPattern[] {
  const queryTokens = normalizeSearchText(options.query ?? "")
    .split(" ")
    .filter(Boolean);

  return SEARCHABLE_PATTERNS
    .filter(({ pattern, text }) => {
      if (options.category && options.category !== "all" && pattern.category !== options.category) {
        return false;
      }
      if (options.bias && options.bias !== "all" && pattern.bias !== options.bias) {
        return false;
      }
      return queryTokens.every((token) => text.includes(token));
    })
    .map(({ pattern }) => pattern);
}

/** Runtime guard shared by the future Zod block schema and parser. */
export function isCandlestickPatternId(value: string): boolean {
  return CANDLESTICK_PATTERNS.some((pattern) => pattern.id === value);
}

/** Keeps category definitions discoverable without duplicating their values. */
export function isCandlestickPatternCategory(
  value: string,
): value is (typeof CANDLESTICK_PATTERN_CATEGORIES)[number] {
  return (CANDLESTICK_PATTERN_CATEGORIES as readonly string[]).includes(value);
}
