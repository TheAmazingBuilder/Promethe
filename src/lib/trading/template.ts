/**
 * Trade templates — pure application logic (v2 §4.1).
 *
 * A template pre-fills the quick/full trade form: instrument, direction,
 * timeframe, session, order type, risk (% or amount), lots, SL/TP distances in
 * PIPS (converted to prices from the entered entry price), tags, checklist
 * items and notes. Everything here is client-safe (no Prisma) and decimal-exact.
 */
import { D0, toD, type DecimalInput } from "./dec";
import { pipsToPrice } from "./calculate";
import type {
  Direction,
  InstrumentSpec,
  OrderType,
  TradingSession,
} from "./types";

/** Client-safe template shape (API JSON - decimals as strings). */
export interface TradeTemplateData {
  id: string;
  name: string;
  strategyId: string | null;
  instrumentId: string | null;
  direction: Direction | null;
  timeframe: string | null;
  session: TradingSession | null;
  orderType: OrderType | null;
  defaultRiskPercent: string | null;
  defaultRiskAmount: string | null;
  defaultLots: string | null;
  defaultStopLossPips: string | null;
  defaultTakeProfitPips: string | null;
  defaultTagIds: string[];
  defaultChecklistItemIds: string[];
  prefilledNotes: string | null;
  usageCount: number;
  lastUsedAt: string | null;
}

export interface TemplateApplyContext {
  /** Lookup list (global presets + user instruments). */
  instruments: Array<InstrumentSpec & { id?: string }>;
  /** Entry price already typed (optional - pips stay pips until a price exists). */
  entryPrice?: DecimalInput | null;
  /** Direction already chosen by the user - template's own is then ignored. */
  direction?: Direction | null;
  /** Default risk % from the template's strategy (fallback when the template has none). */
  strategyDefaultRiskPercent?: DecimalInput | null;
}

/** Result: values to merge into the trade form. `null` = "leave as is". */
export interface TradePrefill {
  strategyId: string | null;
  instrumentId: string | null;
  direction: Direction | null;
  timeframe: string | null;
  session: TradingSession | null;
  orderType: OrderType | null;
  riskPercent: string | null;
  riskAmount: string | null;
  lots: string | null;
  stopLossPips: string | null;
  takeProfitPips: string | null;
  /** Prices derived from pips + entry (null when no entry price is known yet). */
  stopLossPrice: string | null;
  takeProfitPrice: string | null;
  tagIds: string[];
  checklistItemIds: string[];
  notes: string | null;
}

/**
 * SL price from a pip distance: LONG → entry − pips, SHORT → entry + pips.
 * Direction defaults to LONG when unknown (form re-derives on toggle).
 */
export function stopPriceFromPips(
  direction: Direction | null | undefined,
  entry: DecimalInput,
  pips: DecimalInput,
  instrument: InstrumentSpec
): string {
  const dist = pipsToPrice(instrument, pips);
  const e = toD(entry);
  return (direction === "SHORT" ? e.plus(dist) : e.minus(dist)).toString();
}

/** TP price from a pip distance: LONG → entry + pips, SHORT → entry − pips. */
export function takeProfitPriceFromPips(
  direction: Direction | null | undefined,
  entry: DecimalInput,
  pips: DecimalInput,
  instrument: InstrumentSpec
): string {
  const dist = pipsToPrice(instrument, pips);
  const e = toD(entry);
  return (direction === "SHORT" ? e.minus(dist) : e.plus(dist)).toString();
}

/** Pip distance between entry and a stop price (absolute, direction-aware sign ignored). */
export function pipsFromPrices(
  entry: DecimalInput,
  price: DecimalInput,
  instrument: InstrumentSpec
): string {
  const pip = toD(instrument.pipSize);
  if (pip.lte(0)) return D0.toString();
  return toD(price).minus(toD(entry)).abs().div(pip).toString();
}

function findInstrument(
  ctx: TemplateApplyContext,
  instrumentId: string | null
): (InstrumentSpec & { id?: string }) | null {
  if (!instrumentId) return null;
  return ctx.instruments.find((i) => i.id === instrumentId) ?? null;
}

/**
 * Apply a template to a form context — pure, total (never throws).
 * Rule: an explicit user choice (direction) always wins over the template.
 */
export function applyTradeTemplate(
  template: TradeTemplateData,
  ctx: TemplateApplyContext
): TradePrefill {
  const instrument = findInstrument(ctx, template.instrumentId);
  const direction =
    ctx.direction ?? template.direction ?? null;

  const slPips = template.defaultStopLossPips;
  const tpPips = template.defaultTakeProfitPips;
  const entry = ctx.entryPrice != null ? toD(ctx.entryPrice) : null;

  let stopLossPrice: string | null = null;
  let takeProfitPrice: string | null = null;
  if (instrument && entry && slPips != null && toD(slPips).gt(0)) {
    stopLossPrice = stopPriceFromPips(direction, entry, slPips, instrument);
  }
  if (instrument && entry && tpPips != null && toD(tpPips).gt(0)) {
    takeProfitPrice = takeProfitPriceFromPips(direction, entry, tpPips, instrument);
  }

  // Risk: template's own value first, strategy default as fallback.
  const riskPercent =
    template.defaultRiskPercent ??
    (template.defaultRiskAmount == null && ctx.strategyDefaultRiskPercent != null
      ? toD(ctx.strategyDefaultRiskPercent).toString()
      : null);

  return {
    strategyId: template.strategyId,
    instrumentId: template.instrumentId,
    direction,
    timeframe: template.timeframe,
    session: template.session,
    orderType: template.orderType,
    riskPercent,
    riskAmount: template.defaultRiskAmount,
    lots: template.defaultLots,
    stopLossPips: slPips,
    takeProfitPips: tpPips,
    stopLossPrice,
    takeProfitPrice,
    tagIds: template.defaultTagIds,
    checklistItemIds: template.defaultChecklistItemIds,
    notes: template.prefilledNotes,
  };
}

/** Reverse operation: build template defaults from a (quick or full) form state. */
export function buildTemplateFromForm(
  name: string,
  form: {
    strategyId?: string | null;
    instrumentId?: string | null;
    direction?: Direction | null;
    timeframe?: string | null;
    session?: TradingSession | null;
    orderType?: OrderType | null;
    riskPercent?: string | null;
    riskAmount?: string | null;
    lots?: string | null;
    stopLossPips?: string | null;
    takeProfitPips?: string | null;
    tagIds?: string[];
    checklistItemIds?: string[];
    notes?: string | null;
  }
): Omit<TradeTemplateData, "id" | "usageCount" | "lastUsedAt"> {
  return {
    name: name.trim(),
    strategyId: form.strategyId ?? null,
    instrumentId: form.instrumentId ?? null,
    direction: form.direction ?? null,
    timeframe: form.timeframe ?? null,
    session: form.session ?? null,
    orderType: form.orderType ?? null,
    defaultRiskPercent: form.riskPercent ?? null,
    defaultRiskAmount: form.riskAmount ?? null,
    defaultLots: form.lots ?? null,
    defaultStopLossPips: form.stopLossPips ?? null,
    defaultTakeProfitPips: form.takeProfitPips ?? null,
    defaultTagIds: form.tagIds ?? [],
    defaultChecklistItemIds: form.checklistItemIds ?? [],
    prefilledNotes: form.notes ?? null,
  };
}
