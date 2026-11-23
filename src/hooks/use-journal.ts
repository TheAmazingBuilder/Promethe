"use client";

/**
 * React Query hooks — journal, calendar, PROP status and strategy versions
 * (v1 phase 5). Same conventions as use-trading.ts: apiFetch envelope,
 * silent about Prisma. Invalidation: ["journal"], ["calendar"], ["strategies"].
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type {
  CalendarDayPayload,
  CalendarPayload,
  JournalEntryDTO,
  StrategyDTO,
  StrategyStatsDTO,
  StrategyVersionDTO,
  PropStatusPayload,
} from "@/lib/trading/dto";
import type { JournalEntryInput } from "@/lib/validations/journal";

// ── Calendar ─────────────────────────────────────────────────────────────────

export function useCalendar(
  year: number,
  month: number,
  account?: string | null,
) {
  const params = new URLSearchParams({ year: String(year), month: String(month) });
  if (account) params.set("account", account);
  return useQuery({
    queryKey: ["calendar", year, month, account ?? null],
    queryFn: async () =>
      apiFetch<CalendarPayload>(`/api/v1/calendar?${params.toString()}`),
    staleTime: 60 * 1000,
  });
}

// ── Calendar day detail (MRT wave 2) ─────────────────────────────────────────

export function useCalendarDay(
  date: string | null,
  account?: string | null,
) {
  const params = new URLSearchParams();
  if (date) params.set("date", date);
  if (account) params.set("account", account);
  return useQuery({
    queryKey: ["calendar", "day", date, account ?? null],
    queryFn: async () =>
      apiFetch<CalendarDayPayload>(
        `/api/v1/calendar/day?${params.toString()}`
      ),
    enabled: date != null,
    staleTime: 60 * 1000,
  });
}

// ── Journal ──────────────────────────────────────────────────────────────────

export function useJournalEntry(date: string) {
  return useQuery({
    queryKey: ["journal", date],
    queryFn: async () =>
      (
        await apiFetch<{ entry: JournalEntryDTO | null }>(
          `/api/v1/journal?date=${encodeURIComponent(date)}`,
        )
      ).entry,
    staleTime: 30 * 1000,
  });
}

export interface JournalHistoryQuery {
  q?: string;
  from?: string;
  to?: string;
  mood?: number | null;
  discipline?: number | null;
  limit?: number;
}

export function useRecentJournal(filters: JournalHistoryQuery = {}) {
  const params = new URLSearchParams();
  if (filters.q?.trim()) params.set("q", filters.q.trim());
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.mood != null) params.set("mood", String(filters.mood));
  if (filters.discipline != null) params.set("discipline", String(filters.discipline));
  params.set("limit", String(filters.limit ?? 30));
  return useQuery({
    queryKey: ["journal", "recent", filters],
    queryFn: async () =>
      (await apiFetch<{ entries: JournalEntryDTO[] }>(`/api/v1/journal?${params.toString()}`)).entries,
    staleTime: 60 * 1000,
  });
}

export function useSaveJournalEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: JournalEntryInput) =>
      (
        await apiFetch<{ entry: JournalEntryDTO }>("/api/v1/journal", {
          method: "PUT",
          body: JSON.stringify(input),
        })
      ).entry,
    onSuccess: (entry) => {
      void qc.invalidateQueries({ queryKey: ["journal"] });
      void qc.invalidateQueries({ queryKey: ["calendar"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      return entry;
    },
  });
}

export function useDeleteJournalEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (date: string) => {
      await apiFetch<void>(
        `/api/v1/journal?date=${encodeURIComponent(date)}`,
        { method: "DELETE" },
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["journal"] });
      void qc.invalidateQueries({ queryKey: ["calendar"] });
    },
  });
}

// ── PROP status ──────────────────────────────────────────────────────────────

export function usePropStatus(account?: string | null, enabled = true) {
  const qs = account ? `?account=${encodeURIComponent(account)}` : "";
  return useQuery({
    queryKey: ["prop-status", account ?? null],
    queryFn: async () => apiFetch<PropStatusPayload>(`/api/v1/prop-status${qs}`),
    staleTime: 30 * 1000,
    enabled,
  });
}

// ── Strategy versions ────────────────────────────────────────────────────────

export function useStrategyVersions(strategyId: string | null) {
  return useQuery({
    queryKey: ["strategy-versions", strategyId],
    queryFn: async () =>
      (
        await apiFetch<{ versions: StrategyVersionDTO[] }>(
          `/api/v1/strategies/${strategyId}/versions`,
        )
      ).versions,
    enabled: strategyId != null && strategyId !== "",
    staleTime: 30 * 1000,
  });
}

export function useCreateStrategyVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { strategyId: string; note?: string | null }) =>
      (
        await apiFetch<{ version: StrategyVersionDTO }>(
          `/api/v1/strategies/${args.strategyId}/versions`,
          { method: "POST", body: JSON.stringify({ note: args.note ?? null }) },
        )
      ).version,
    onSuccess: (_v, args) => {
      void qc.invalidateQueries({
        queryKey: ["strategy-versions", args.strategyId],
      });
    },
  });
}

export function useDeleteStrategyVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { strategyId: string; versionId: string }) => {
      await apiFetch<void>(
        `/api/v1/strategies/${args.strategyId}/versions/${args.versionId}`,
        { method: "DELETE" },
      );
    },
    onSuccess: (_v, args) => {
      void qc.invalidateQueries({
        queryKey: ["strategy-versions", args.strategyId],
      });
    },
  });
}

// ── Strategy CRUD (with checklist, phase 5) ─────────────────────────────────

/** Per-strategy stats (phase 5 view) - separate query key from the selector list. */
export function useStrategiesWithStats() {
  return useQuery({
    queryKey: ["strategies", "stats"],
    queryFn: async () =>
      (
        await apiFetch<{
          stats: StrategyStatsDTO[];
        }>("/api/v1/strategies?withStats=1")
      ).stats,
    staleTime: 60 * 1000,
  });
}

export interface StrategyInputBody {
  name: string;
  description?: string | null;
  color?: string;
  status?: "ACTIVE" | "TESTING" | "ARCHIVED";
  timeframes?: string[];
  defaultRiskPercent?: string | null;
  targetRR?: string | null;
  entryRules?: string | null;
  exitRules?: string | null;
  riskRules?: string | null;
  /** Replace-all semantics - the FULL list is sent on every write. */
  checklistItems?: Array<{
    label: string;
    category: "ENTRY" | "EXIT" | "RISK" | "CONTEXT";
    order: number;
    isRequired: boolean;
  }>;
}

export function useCreateStrategy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: StrategyInputBody) =>
      (
        await apiFetch<{ strategy: StrategyDTO }>("/api/v1/strategies", {
          method: "POST",
          body: JSON.stringify(input),
        })
      ).strategy,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["strategies"] });
    },
  });
}

export function useUpdateStrategy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; patch: Partial<StrategyInputBody> }) =>
      (
        await apiFetch<{ strategy: StrategyDTO }>(`/api/v1/strategies/${args.id}`, {
          method: "PATCH",
          body: JSON.stringify(args.patch),
        })
      ).strategy,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["strategies"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useDeleteStrategy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiFetch<void>(`/api/v1/strategies/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["strategies"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
