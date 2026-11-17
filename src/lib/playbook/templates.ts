/**
 * Playbook starter content (Phase 2) — code only, never persisted as a seed.
 *
 * The 10 strategy templates, the universal pre-trade checklist and the 6
 * example rules live here so the Templates tab can list them and the user
 * can instantiate the ones they want. Templates are starting points, not
 * profitability claims: every instantiated strategy starts as DRAFT with
 * no grade and no history.
 *
 * All content is written for XAUUSD and forex. Adapt the numbers to your
 * own risk tolerance before trading them live.
 */

export interface PlaybookTemplateSetup {
  name: string;
  context: string;
  trigger: string;
  confirmation: string;
  entryModel: string;
  stopModel: string;
  targetModel: string;
  invalidation: string;
}

export interface PlaybookStrategyTemplate {
  key: string;
  name: string;
  description: string;
  tradingStyle: string;
  marketConditions: string[];
  tags: string[];
  entryRules: string;
  exitRules: string;
  riskRules: string;
  detailedDescription: string;
  defaultRiskPercent: string;
  targetRR: string;
  timeframes: string[];
  sessions: string[];
  setups: PlaybookTemplateSetup[];
}

export const STRATEGY_TEMPLATES: PlaybookStrategyTemplate[] = [
  {
    key: "london-breakout",
    name: "London Breakout",
    description:
      "Trade the first expansion out of the Asian range when London opens. Best on XAUUSD and GBPUSD.",
    tradingStyle: "Intraday",
    marketConditions: ["EXPANSION", "HIGH_VOLATILITY"],
    tags: ["breakout", "london", "xauusd"],
    entryRules:
      "- Mark the Asian session high and low (00:00-07:00 UTC).\n- Enter on a 15-minute candle close beyond the range, in the direction of the break.\n- Skip the trade if the range is smaller than 0.3x the 14-day average range.",
    exitRules:
      "- First target: 1.5R. Move the stop to breakeven once 1R is reached.\n- Full exit at 2R or at the next H1 structure level, whichever comes first.",
    riskRules:
      "- Risk 0.5% per trade, 1% maximum per day on this strategy.\n- No trade in the 15 minutes before a red-folder USD news release.",
    detailedDescription:
      "A session-open breakout: Asia builds the range, London provides the impulse. The edge is the daily expansion, not the break itself, so the range must be worth breaking out of.",
    defaultRiskPercent: "0.5",
    targetRR: "2",
    timeframes: ["M15", "H1"],
    sessions: ["London"],
    setups: [
      {
        name: "Asian range break, long",
        context: "Asian range printed, price consolidating under its high into the London open.",
        trigger: "M15 close above the Asian high.",
        confirmation: "The breakout candle closes with a body larger than the previous three candles.",
        entryModel: "Market order on the close of the breakout candle.",
        stopModel: "Below the Asian range midpoint, at least 1x ATR(14) M15 away.",
        targetModel: "2R, or the next H1 swing high.",
        invalidation: "Price closes back inside the Asian range within two M15 candles.",
      },
    ],
  },
  {
    key: "breakout-retest",
    name: "Breakout Retest",
    description:
      "Wait for the breakout, then enter on the retest of the broken level. Fewer trades, cleaner entries.",
    tradingStyle: "Intraday",
    marketConditions: ["TRENDING", "BULLISH_STRUCTURE", "BEARISH_STRUCTURE"],
    tags: ["breakout", "retest", "pullback"],
    entryRules:
      "- A level must break with a strong impulse candle (body > 60% of the candle range).\n- Enter only on the first retest that holds the level as support or resistance.\n- No entry if the retest happens more than 6 hours after the break.",
    exitRules:
      "- Target 2R minimum. Trail the stop under each new swing after 1.5R.",
    riskRules:
      "- Risk 0.5% per trade.\n- One retest trade per level per day; a failed retest ends the idea for the day.",
    detailedDescription:
      "The patient version of the breakout: let the market prove the level flipped, then join the move with a tight stop.",
    defaultRiskPercent: "0.5",
    targetRR: "2",
    timeframes: ["M15", "H1"],
    sessions: ["London", "New York"],
    setups: [
      {
        name: "Retest of a broken H1 level",
        context: "H1 resistance broke with impulse and is now being retested from above.",
        trigger: "Price touches the broken level and prints a rejection wick on M15.",
        confirmation: "A bullish engulfing or pin bar closes on M15 at the level.",
        entryModel: "Market order on the close of the confirmation candle.",
        stopModel: "Below the wick low of the rejection candle.",
        targetModel: "2R, or the next H1 swing high.",
        invalidation: "M15 closes back below the broken level.",
      },
    ],
  },
  {
    key: "trend-following",
    name: "Trend Following (EMA)",
    description:
      "Trade with the H1/H4 trend, entering on pullbacks to the fast EMA. The workhorse trend strategy.",
    tradingStyle: "Swing",
    marketConditions: ["TRENDING", "BULLISH_STRUCTURE", "BEARISH_STRUCTURE"],
    tags: ["trend", "ema", "pullback"],
    entryRules:
      "- Trend filter: EMA 20 above EMA 50 on H4, and price above both.\n- Enter on a pullback that touches the EMA 20 on H1 without closing below it.\n- Skip when the H4 ATR is in its lowest decile (dead market).",
    exitRules:
      "- Target 2.5R. Move the stop to breakeven at 1R, trail under the EMA 20 after 2R.",
    riskRules:
      "- Risk 1% per trade, maximum 2 concurrent trend trades.\n- Stop trading this strategy after 3 consecutive losses; review before resuming.",
    detailedDescription:
      "Trend following on XAUUSD and majors: the trend is defined on H4, the entry is timed on H1. No counter-trend entries, ever.",
    defaultRiskPercent: "1",
    targetRR: "2.5",
    timeframes: ["H1", "H4"],
    sessions: ["London", "New York"],
    setups: [
      {
        name: "EMA 20 pullback, long",
        context: "H4 uptrend with EMA 20 above EMA 50, price pulling back toward the EMA 20 on H1.",
        trigger: "H1 candle touches the EMA 20 and closes back above it.",
        confirmation: "The next H1 candle makes a higher high.",
        entryModel: "Market order on the close of the confirming candle.",
        stopModel: "Below the pullback low, at least 1x ATR(14) H1 away.",
        targetModel: "2.5R, or the previous H4 swing high.",
        invalidation: "H1 closes below the EMA 20.",
      },
    ],
  },
  {
    key: "pullback-order-block",
    name: "Pullback to Order Block",
    description:
      "Enter at the last opposing candle before an impulsive move, when price returns to that zone.",
    tradingStyle: "Intraday",
    marketConditions: ["TRENDING", "EXPANSION"],
    tags: ["pullback", "order-block", "supply-demand"],
    entryRules:
      "- Mark the order block: the last down candle before a strong bullish displacement (or the reverse).\n- Enter only on the first return to the block.\n- The displacement must have moved at least 1.5x the 14-day average range.",
    exitRules:
      "- Target 2R. Take half off at 1R, move the stop to breakeven.",
    riskRules:
      "- Risk 0.5% per trade.\n- If the block is broken by a full candle close, the idea is dead for the day.",
    detailedDescription:
      "A precision entry at the origin of a move. The invalidation is structural, which keeps the stop small and the R high.",
    defaultRiskPercent: "0.5",
    targetRR: "2",
    timeframes: ["M15", "H1"],
    sessions: ["London", "New York"],
    setups: [
      {
        name: "Order block retest, long",
        context: "Bullish displacement left an order block below price; price is returning to it.",
        trigger: "Price enters the order block zone on M15.",
        confirmation: "A bullish rejection candle (wick or engulfing) prints inside the block.",
        entryModel: "Limit order at the block midpoint, or market on the confirmation close.",
        stopModel: "Below the order block low.",
        targetModel: "2R, or the displacement high.",
        invalidation: "M15 closes below the order block.",
      },
    ],
  },
  {
    key: "mean-reversion-range",
    name: "Mean Reversion Range",
    description:
      "Fade the edges of a well-defined range when volatility is low. Only in ranging markets, never in trends.",
    tradingStyle: "Intraday",
    marketConditions: ["RANGING", "LOW_VOLATILITY"],
    tags: ["range", "mean-reversion", "fade"],
    entryRules:
      "- The range must have at least two touches on each edge on H1.\n- Enter at the edge only with a rejection wick on M15.\n- Never trade the middle of the range.",
    exitRules:
      "- Target the opposite edge or 1.5R, whichever is closer.",
    riskRules:
      "- Risk 0.5% per trade.\n- Stop trading the range after one edge break; re-assess before fading again.",
    detailedDescription:
      "Buy low, sell high inside a range that has proven itself. The moment an edge breaks with conviction, this strategy stops.",
    defaultRiskPercent: "0.5",
    targetRR: "1.5",
    timeframes: ["M15", "H1"],
    sessions: ["Asian", "London"],
    setups: [
      {
        name: "Range low fade, long",
        context: "H1 range with two touches on the low, price returning to the low a third time.",
        trigger: "M15 rejection wick at the range low.",
        confirmation: "Bullish engulfing closes on M15.",
        entryModel: "Market order on the confirmation close.",
        stopModel: "Below the range low by 0.5x ATR(14) M15.",
        targetModel: "Range high, or 1.5R.",
        invalidation: "M15 closes below the range low.",
      },
    ],
  },
  {
    key: "momentum-continuation",
    name: "Momentum Continuation",
    description:
      "Join a strong move after a short pause: a flag or a tight consolidation inside an impulsive trend.",
    tradingStyle: "Intraday",
    marketConditions: ["TRENDING", "EXPANSION"],
    tags: ["momentum", "flag", "continuation"],
    entryRules:
      "- The impulse leg must be at least 2x the average M15 candle range.\n- Enter on the break of the flag in the direction of the impulse.\n- Skip if the flag lasts more than 10 candles (momentum is gone).",
    exitRules:
      "- Target 2R, measured from the flag break.",
    riskRules:
      "- Risk 0.75% per trade.\n- Maximum one continuation trade per impulse leg.",
    detailedDescription:
      "Momentum does not wait: a tight flag after a strong leg is the market catching its breath, not reversing.",
    defaultRiskPercent: "0.75",
    targetRR: "2",
    timeframes: ["M5", "M15"],
    sessions: ["London", "New York"],
    setups: [
      {
        name: "Bull flag break, long",
        context: "Strong bullish impulse, then a tight downward-sloping flag on M5.",
        trigger: "M5 close above the flag's upper trendline.",
        confirmation: "The breakout candle closes with a body larger than the flag candles.",
        entryModel: "Market order on the breakout close.",
        stopModel: "Below the flag low.",
        targetModel: "2R from the break.",
        invalidation: "Price closes back inside the flag within two M5 candles.",
      },
    ],
  },
  {
    key: "support-resistance-bounce",
    name: "Support / Resistance Bounce",
    description:
      "Trade the bounce off daily and weekly levels that the market has respected at least three times.",
    tradingStyle: "Intraday",
    marketConditions: ["RANGING", "NEUTRAL_STRUCTURE"],
    tags: ["support", "resistance", "levels"],
    entryRules:
      "- Levels come from the daily chart only, with at least three touches.\n- Enter on a rejection wick at the level on H1.\n- No entry if price arrived at the level in one straight run without a pause.",
    exitRules:
      "- Target 2R or the next daily level, whichever is closer.",
    riskRules:
      "- Risk 0.5% per trade.\n- Two failed bounces at the same level retire it for the week.",
    detailedDescription:
      "Levels that held three times earn respect. The trade is the rejection, not the level itself.",
    defaultRiskPercent: "0.5",
    targetRR: "2",
    timeframes: ["H1", "H4"],
    sessions: ["London", "New York"],
    setups: [
      {
        name: "Daily support bounce, long",
        context: "Price is testing a daily support level with three prior touches.",
        trigger: "H1 rejection wick at the level.",
        confirmation: "Bullish engulfing closes on H1.",
        entryModel: "Market order on the confirmation close.",
        stopModel: "Below the wick low by 0.5x ATR(14) H1.",
        targetModel: "2R, or the next daily resistance.",
        invalidation: "H1 closes below the support level.",
      },
    ],
  },
  {
    key: "scalping-m1-m5",
    name: "Scalping (M1/M5)",
    description:
      "Fast trades on M1/M5 during the London-New York overlap. Small targets, strict session window, no holding through news.",
    tradingStyle: "Scalping",
    marketConditions: ["HIGH_VOLATILITY", "EXPANSION"],
    tags: ["scalping", "m1", "m5", "overlap"],
    entryRules:
      "- Trade only during the London-New York overlap (12:00-16:00 UTC).\n- Enter on a break of the last 5-minute micro-range in the direction of the M15 trend.\n- Maximum 5 trades per session.",
    exitRules:
      "- Target 1R. No runners: the whole position exits at the target or the stop.",
    riskRules:
      "- Risk 0.25% per trade.\n- Stop the session after 2 consecutive losses or -0.75% on the day.",
    detailedDescription:
      "Scalping pays for speed and discipline, not for being right often. The session window is part of the strategy.",
    defaultRiskPercent: "0.25",
    targetRR: "1",
    timeframes: ["M1", "M5"],
    sessions: ["New York"],
    setups: [
      {
        name: "Micro-range break, long",
        context: "M15 trend is up, M5 is coiling in a tight range during the overlap.",
        trigger: "M1 close above the micro-range high.",
        confirmation: "The breakout candle closes above the range with momentum.",
        entryModel: "Market order on the breakout close.",
        stopModel: "Below the micro-range low.",
        targetModel: "1R.",
        invalidation: "Price closes back inside the micro-range within two M1 candles.",
      },
    ],
  },
  {
    key: "swing-h4-daily",
    name: "Swing (H4/Daily)",
    description:
      "Multi-day swing trades off the daily structure. One or two trades a week, held through sessions, sized small.",
    tradingStyle: "Swing",
    marketConditions: ["TRENDING", "BULLISH_STRUCTURE", "BEARISH_STRUCTURE"],
    tags: ["swing", "daily", "position"],
    entryRules:
      "- Direction from the daily trend (EMA 20 above EMA 50, price above both).\n- Enter on a pullback to the H4 EMA 20 or a daily level.\n- Hold overnight only if the position is at breakeven or better by the New York close.",
    exitRules:
      "- Target 3R. Trail the stop under the daily swing lows after 2R.",
    riskRules:
      "- Risk 1% per trade, maximum 2 open swing trades.\n- Reduce size by half ahead of red-folder news on the traded symbol.",
    detailedDescription:
      "Swing trading is the slow lane: fewer decisions, wider stops, and time doing the work. The daily chart decides, the H4 chart times.",
    defaultRiskPercent: "1",
    targetRR: "3",
    timeframes: ["H4", "D1"],
    sessions: ["London", "New York"],
    setups: [
      {
        name: "Daily pullback, long",
        context: "Daily uptrend, price pulling back to the H4 EMA 20.",
        trigger: "H4 candle closes back above the EMA 20 after touching it.",
        confirmation: "The next H4 candle makes a higher high.",
        entryModel: "Market order on the confirmation close.",
        stopModel: "Below the pullback low.",
        targetModel: "3R, or the previous daily swing high.",
        invalidation: "Daily close below the EMA 20.",
      },
    ],
  },
  {
    key: "new-york-open-drive",
    name: "New York Open Drive",
    description:
      "Trade the first directional drive of the New York session after the London close, in the direction of the day's trend.",
    tradingStyle: "Intraday",
    marketConditions: ["EXPANSION", "HIGH_VOLATILITY"],
    tags: ["new-york", "open", "drive"],
    entryRules:
      "- Direction from the H1 trend at 12:30 UTC; no trade against it.\n- Enter on the first 15-minute candle after 13:30 UTC that closes in the trend direction with a body larger than the average.\n- Only one trade per day on this strategy.",
    exitRules:
      "- Target 2R. Move the stop to breakeven at 1R.",
    riskRules:
      "- Risk 0.5% per trade.\n- No trade on FOMC or US CPI days.",
    detailedDescription:
      "New York brings the volume. The drive is the first real move of the session, not the noise around the open.",
    defaultRiskPercent: "0.5",
    targetRR: "2",
    timeframes: ["M15", "H1"],
    sessions: ["New York"],
    setups: [
      {
        name: "NY drive continuation, long",
        context: "H1 trend is up into the New York open, price consolidating above the London close.",
        trigger: "M15 close above the consolidation high after 13:30 UTC.",
        confirmation: "The breakout candle body is larger than the average M15 candle.",
        entryModel: "Market order on the breakout close.",
        stopModel: "Below the consolidation low.",
        targetModel: "2R.",
        invalidation: "Price closes back below the consolidation range within two M15 candles.",
      },
    ],
  },
];

export function findStrategyTemplate(
  key: string,
): PlaybookStrategyTemplate | undefined {
  return STRATEGY_TEMPLATES.find((t) => t.key === key);
}

// ── Universal pre-trade checklist (global template) ─────────────────────────

export interface GlobalChecklistItem {
  label: string;
  required: boolean;
  category: "ENTRY" | "EXIT" | "RISK" | "CONTEXT";
}

export const GLOBAL_CHECKLIST: {
  name: string;
  items: GlobalChecklistItem[];
} = {
  name: "Universal pre-trade check",
  items: [
    { label: "I know which strategy and setup this trade belongs to", required: true, category: "ENTRY" },
    { label: "The market condition matches the strategy (trend, range, volatility)", required: true, category: "CONTEXT" },
    { label: "The entry trigger printed and the confirmation is visible", required: true, category: "ENTRY" },
    { label: "The invalidation is written down and the stop is placed there", required: true, category: "RISK" },
    { label: "Position size matches the planned risk (1% or less)", required: true, category: "RISK" },
    { label: "Target is at least 1.5R away, or the plan says why not", required: true, category: "EXIT" },
    { label: "No red-folder news on this symbol in the next 30 minutes", required: true, category: "CONTEXT" },
    { label: "This is not a revenge trade after a loss", required: true, category: "RISK" },
    { label: "The trade fits the daily risk budget", required: true, category: "RISK" },
    { label: "I can walk away after placing the trade", required: false, category: "CONTEXT" },
  ],
};

// ── Example rules ────────────────────────────────────────────────────────────

export interface ExamplePlaybookRule {
  title: string;
  detail: string;
  category: "RISK" | "SESSION" | "NEWS" | "BEHAVIOR" | "EXECUTION" | "CUSTOM";
  scope: "GLOBAL" | "STRATEGY";
  evaluatable: boolean;
  evaluationHint: string | null;
}

export const EXAMPLE_RULES: ExamplePlaybookRule[] = [
  {
    title: "Never risk more than 1% on a single trade",
    detail:
      "Position size is computed from the stop distance before every entry. If the size does not fit the 1% cap, the trade is skipped, never resized to fit.",
    category: "RISK",
    scope: "GLOBAL",
    evaluatable: true,
    evaluationHint: "Check riskPercent on each closed trade",
  },
  {
    title: "Maximum 2% total risk per day",
    detail:
      "When the day's realized and open risk reaches 2% of the account, no new trades until the next trading day.",
    category: "RISK",
    scope: "GLOBAL",
    evaluatable: true,
    evaluationHint: "Sum of daily risk across trades",
  },
  {
    title: "No new trades around red-folder news",
    detail:
      "No entries in the 15 minutes before and 5 minutes after a red-folder release on the traded currency. Open trades stay managed by their stop.",
    category: "NEWS",
    scope: "GLOBAL",
    evaluatable: true,
    evaluationHint: "Economic calendar vs entry time",
  },
  {
    title: "No revenge trading after two consecutive losses",
    detail:
      "After two losses in a row, step away for at least one hour and write a short note before the next trade. The note is part of the rule.",
    category: "BEHAVIOR",
    scope: "GLOBAL",
    evaluatable: false,
    evaluationHint: null,
  },
  {
    title: "Every entry needs a written invalidation",
    detail:
      "If the invalidation cannot be written in one sentence, the setup is not clear enough to trade. The stop goes where the idea is wrong, not where it is comfortable.",
    category: "EXECUTION",
    scope: "GLOBAL",
    evaluatable: false,
    evaluationHint: null,
  },
  {
    title: "Trade only London and New York, unless it is a swing",
    detail:
      "Intraday setups are traded during London (07:00-11:00 UTC) and New York (12:30-16:00 UTC) only. Outside these windows, only swing setups may be entered.",
    category: "SESSION",
    scope: "GLOBAL",
    evaluatable: true,
    evaluationHint: "Entry session vs allowed windows",
  },
];
