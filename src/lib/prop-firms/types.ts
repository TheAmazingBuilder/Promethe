import type {
  PropPhaseRuleInput,
} from "@/lib/validations/prop-firms";

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
