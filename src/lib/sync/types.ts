/**
 * v3 — EA ↔ server payload contract (schemaVersion 1, client-safe types).
 *
 * Contract rules (v3 §4.1):
 *  - ALL numeric values travel as STRINGS to preserve decimals exactly.
 *  - Times are Unix seconds in BROKER SERVER time; the payload carries
 *    `serverGmtOffsetSeconds` so the server converts to UTC reliably.
 *  - Costs (commission / swap / fees) use the MetaTrader signing convention:
 *    NEGATIVE = cost to the trader, POSITIVE = credit. The app converts to
 *    its own convention (positive = cost) in normalize.ts.
 *  - `positionId` identifies an MT5 position or the stitched MT4 chain head.
 *  - `eventId` is the EA-side idempotency key:
 *    `{platform}:{server}:{login}:{type}:{ticket}`.
 */

export const INGEST_SCHEMA_VERSION = 1;

export type MtPlatform = "MT4" | "MT5";
export type MtDirection = "LONG" | "SHORT";

export interface SymbolSpecPayload {
  digits: string;
  point: string;
  tickSize: string;
  tickValue: string;
  contractSize: string;
}

export interface MtEventBase {
  eventId: string;
  /** Unix seconds, broker server time. */
  time: number;
}

export interface MtHeartbeatEvent extends MtEventBase {
  type: "HEARTBEAT";
  balance: string;
  equity: string;
  margin?: string | null;
  openPositions: number;
}

export interface MtPositionOpenedEvent extends MtEventBase {
  type: "POSITION_OPENED";
  symbol: string;
  symbolSpec?: SymbolSpecPayload | null;
  positionId: string;
  ticket: string;
  direction: MtDirection;
  volume: string;
  openTime: number;
  openPrice: string;
  stopLoss?: string | null;
  takeProfit?: string | null;
  magic?: string | null;
  comment?: string | null;
}

export interface MtPositionModifiedEvent extends MtEventBase {
  type: "POSITION_MODIFIED";
  positionId: string;
  symbol?: string | null;
  stopLoss?: string | null;
  takeProfit?: string | null;
  /** Netting volume increases (ADD executions). */
  volume?: string | null;
}

export interface MtPositionPartialCloseEvent extends MtEventBase {
  type: "POSITION_PARTIAL_CLOSE";
  positionId: string;
  closedVolume: string;
  closeTime: number;
  closePrice: string;
  /** Gross profit of the closed part (quote currency). */
  profit: string;
  commission?: string | null;
  swap?: string | null;
}

export interface MtPositionClosedEvent extends MtEventBase {
  type: "POSITION_CLOSED";
  symbol?: string | null;
  symbolSpec?: SymbolSpecPayload | null;
  positionId: string;
  ticket: string;
  direction?: MtDirection | null;
  /** Remaining volume closed by this event (total for backfill). */
  volume: string;
  openTime?: number | null;
  openPrice?: string | null;
  closeTime: number;
  closePrice: string;
  stopLoss?: string | null;
  takeProfit?: string | null;
  commission?: string | null;
  swap?: string | null;
  fees?: string | null;
  /** Gross profit (quote currency) — broker truth, overrides estimates. */
  profit: string;
  magic?: string | null;
  comment?: string | null;
  mfePrice?: string | null;
  maePrice?: string | null;
  mfeMaeComplete?: boolean | null;
}

export interface MtBalanceOperationEvent extends MtEventBase {
  type: "BALANCE_OPERATION";
  /** Signed: + deposit, − withdrawal (MT signing). */
  amount: string;
  kind?: "DEPOSIT" | "WITHDRAWAL" | "CREDIT" | null;
  comment?: string | null;
}

/** One closed position in a HISTORY_BATCH (backfill) page. */
export interface MtHistoryTrade {
  positionId: string;
  ticket: string;
  symbol: string;
  symbolSpec?: SymbolSpecPayload | null;
  direction: MtDirection;
  /** Total opened volume. */
  volume: string;
  openTime: number;
  openPrice: string;
  closeTime: number;
  closePrice: string;
  stopLoss?: string | null;
  takeProfit?: string | null;
  commission?: string | null;
  swap?: string | null;
  fees?: string | null;
  profit: string;
  magic?: string | null;
  comment?: string | null;
  mfePrice?: string | null;
  maePrice?: string | null;
  mfeMaeComplete?: boolean | null;
}

export interface MtHistoryBatchEvent extends MtEventBase {
  type: "HISTORY_BATCH";
  /** 1-based paging info (100 trades max per page). */
  page: number;
  totalPages: number;
  trades: MtHistoryTrade[];
}

export interface MtPendingOrderEvent extends MtEventBase {
  type: "ORDER_PLACED" | "ORDER_CANCELLED";
  ticket: string;
  symbol: string;
  direction: MtDirection;
  orderType: "LIMIT" | "STOP" | "STOP_LIMIT";
  volume: string;
  price?: string | null;
  stopLoss?: string | null;
  takeProfit?: string | null;
  /** Present on ORDER_CANCELLED. */
  cancelTime?: number | null;
}

export type MtEvent =
  | MtHeartbeatEvent
  | MtPositionOpenedEvent
  | MtPositionModifiedEvent
  | MtPositionPartialCloseEvent
  | MtPositionClosedEvent
  | MtBalanceOperationEvent
  | MtHistoryBatchEvent
  | MtPendingOrderEvent;

export interface MtIngestPayload {
  schemaVersion: typeof INGEST_SCHEMA_VERSION;
  platform: MtPlatform;
  eaVersion: string;
  server: string;
  login: string;
  currency?: string | null;
  leverage?: string | null;
  serverGmtOffsetSeconds: number;
  /** Unix seconds — replay protection (max 10 min skew). */
  sentAt: number;
  events: MtEvent[];
}

/** Per-event response of POST /api/ingest/mt. */
export type IngestEventStatus = "ACCEPTED" | "DUPLICATE" | "REJECTED";

export interface IngestEventResult {
  eventId: string;
  status: IngestEventStatus;
  reason?: string;
}

export interface IngestResponse {
  results: IngestEventResult[];
}

/** GET /api/ingest/mt/ping response (remote config for the EA). */
export interface IngestPingResponse {
  serverTime: number;
  bound: boolean;
  status: string;
  historyBackfillFrom: number | null;
  heartbeatMinutes: number;
}
