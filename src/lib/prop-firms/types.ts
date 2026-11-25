import type {
  PropPhaseRuleInput,
} from "@/lib/validations/prop-firms";
import type {
  PropEvaluationDay,
  PropPhaseOutcome,
  PropRuleEvaluation,
} from "@/lib/prop/engine";

export type PropPhaseRuleDTO = PropPhaseRuleInput;

export interface PropFirmRuleSetDTO {
  id: string;
  name: string;
  firm: string;
  phases: PropPhaseRuleDTO[];
  resetTimeLocal: string;
  timezone: string;
  notes: string | null;
  isGlobal: boolean;
  updatedAt: string;
}

export interface PropPhaseResultDTO {
  id: string;
  phase: string;
  startDate: string | null;
  endDate: string | null;
  startingBalance: string | null;
  endingBalance: string | null;
  result: string;
  failReason: string | null;
  tradingDaysCount: number;
}

export interface PropPayoutDTO {
  id: string;
  requestedAt: string;
  receivedAt: string | null;
  grossAmount: string;
  profitSplitPercent: string;
  netAmount: string;
  currency: string;
  method: string | null;
  status: string;
  note: string | null;
}

export interface PropExpenseDTO {
  id: string;
  challengeId: string | null;
  type: string;
  amount: string;
  currency: string;
  date: string;
  note: string | null;
}

export interface PropChallengeDTO {
  id: string;
  accountId: string;
  accountName: string;
  accountCurrency: string;
  ruleSetId: string | null;
  name: string;
  firm: string;
  currentPhase: string;
  accountSize: string;
  challengeFee: string;
  feeCurrency: string;
  purchaseDate: string | null;
  startDate: string;
  endDate: string | null;
  status: string;
  notes: string | null;
  /** Frozen timezone / reset time (null on legacy rows: see evaluation fallback). */
  ruleTimezone: string | null;
  ruleResetTimeLocal: string | null;
  rulesSnapshot: PropPhaseRuleDTO[];
  phaseResults: PropPhaseResultDTO[];
  payouts: PropPayoutDTO[];
  expenses: PropExpenseDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface PropFirmWorkspacePayload {
  ruleSets: PropFirmRuleSetDTO[];
  challenges: PropChallengeDTO[];
}

/** One phase of one challenge, evaluated by the Lot 5 engine. */
export interface PropChallengeEvaluationDTO {
  challengeId: string;
  /** The phase actually evaluated (currentPhase, or the last recorded phase when the challenge is closed). */
  phase: string;
  /** ISO date (YYYY-MM-DD) of the phase start. */
  phaseStart: string;
  phaseStartingBalance: string;
  currency: string;
  /** Frozen challenge timezone (falls back to the rule set, then UTC). */
  timezone: string;
  /** Frozen daily reset time "HH:MM" (falls back to the rule set, then "00:00"). */
  resetTimeLocal: string;
  accountSize: string;
  currentBalance: string;
  currentEquity: string;
  peakEquity: string;
  todayPnl: string;
  todayDayKey: string;
  tradingDays: number;
  /** SNAPSHOTS when at least one equity snapshot exists in the phase. */
  equityData: "SNAPSHOTS" | "CLOSED_ONLY";
  equityDataNote: string | null;
  timezoneFallback: boolean;
  /** The frozen phase rule this evaluation ran against. */
  rule: PropPhaseRuleInput;
  rules: PropRuleEvaluation[];
  phaseOutcome: PropPhaseOutcome;
  /** Day-by-day history of the phase (firm days). */
  days: PropEvaluationDay[];
  phaseHistory: PropPhaseResultDTO[];
  fees: {
    challengeFee: string;
    feeCurrency: string;
    totalExpenses: string;
    totalPayoutsGross: string;
    totalPayoutsNet: string;
    /** True when some payout or expense uses another currency than the fee currency. */
    mixedCurrencies: boolean;
  };
  evaluatedAt: string;
}
