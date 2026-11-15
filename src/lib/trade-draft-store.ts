"use client";

/**
 * Quick → full form handoff store (v2 §4.1: "expand into the full form
 * without losing data"). Zustand keeps the draft in memory only — the full
 * form seeds itself from it once, then owns the state.
 */
import { create } from "zustand";

export interface QuickFormDraft {
  accountId?: string;
  strategyId?: string | null;
  instrumentId?: string;
  direction?: string;
  orderType?: string;
  timeframe?: string | null;
  entryPrice?: string;
  exitPrice?: string | null;
  stopLossPips?: string | null;
  takeProfitPips?: string | null;
  stopLoss?: string | null;
  takeProfit?: string | null;
  lots?: string;
  riskPercent?: string | null;
  riskAmount?: string | null;
  commission?: string;
  swap?: string;
  fees?: string;
  status?: string;
  exitTime?: string | null;
  exitReason?: string | null;
  tagIds?: string[];
  emotionBefore?: string | null;
  preTradeAnalysis?: string;
  notes?: string | null;
  clientMutationId?: string | null;
  /** Pending screenshot blobs captured in the quick form. */
  pendingScreens?: Array<{
    blob: Blob;
    fileName: string;
    label: string | null;
  }>;
}

interface TradeDraftState {
  draft: QuickFormDraft | null;
  setDraft: (draft: QuickFormDraft) => void;
  clearDraft: () => void;
}

export const useTradeDraftStore = create<TradeDraftState>((set) => ({
  draft: null,
  setDraft: (draft) => set({ draft }),
  clearDraft: () => set({ draft: null }),
}));
