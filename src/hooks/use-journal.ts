"use client";

/**
 * React Query hooks — journal, calendar, PROP status and strategy versions
 * (v1 phase 5). Same conventions as use-trading.ts: apiFetch envelope,
 * silent about Prisma. Invalidation: ["journal"], ["calendar"], ["strategies"].
 */
import {
  useInfiniteQuery,
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

interface JournalHistoryPage {
  entries: JournalEntryDTO[];
  hasMore: boolean;
}

export function useRecentJournal(filters: JournalHistoryQuery = {}) {
  const limit = filters.limit ?? 20;
  return useInfiniteQuery({
    queryKey: ["journal", "recent", filters],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(limit), offset: String(pageParam) });
      if (filters.q?.trim()) params.set("q", filters.q.trim());
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
      if (filters.mood != null) params.set("mood", String(filters.mood));
      if (filters.discipline != null) params.set("discipline", String(filters.discipline));
      return apiFetch<JournalHistoryPage>(`/api/v1/journal?${params.toString()}`);
    },
    getNextPageParam: (lastPage, allPages) =>
      lastPage.hasMore ? allPages.reduce((total, page) => total + page.entries.length, 0) : undefined,
    enabled: !filters.from || !filters.to || filters.from <= filters.to,
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


export type JournalPeriodType = "WEEKLY" | "MONTHLY";

export interface JournalPeriodReviewDTO {
  id: string;
  userId: string;
  periodType: JournalPeriodType;
  periodStart: string;
  periodEnd: string;
  whatWentWell: string | null;
  whatToImprove: string | null;
  keyLesson: string | null;
  nextCommitment: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JournalPeriodReviewInput {
  periodType: JournalPeriodType;
  periodStart: string;
  periodEnd: string;
  whatWentWell?: string | null;
  whatToImprove?: string | null;
  keyLesson?: string | null;
  nextCommitment?: string | null;
}

export function useJournalPeriodReview(periodType: JournalPeriodType, periodStart: string) {
  return useQuery({
    queryKey: ["journal", "period-review", periodType, periodStart],
    queryFn: async () => (
      await apiFetch<{ review: JournalPeriodReviewDTO | null }>(
        `/api/v1/journal/period-reviews?periodType=${periodType}&periodStart=${periodStart}`,
      )
    ).review,
    enabled: Boolean(periodStart),
    staleTime: 60 * 1000,
  });
}

export function useSaveJournalPeriodReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: JournalPeriodReviewInput) => (
      await apiFetch<{ review: JournalPeriodReviewDTO }>(
        "/api/v1/journal/period-reviews",
        { method: "PUT", body: JSON.stringify(input) },
      )
    ).review,
    onSuccess: async (review) => {
      await queryClient.invalidateQueries({
        queryKey: ["journal", "period-review", review.periodType, review.periodStart],
      });
    },
  });
}


export interface JournalTemplateDTO {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  marketBias: string | null;
  preMarketPlan: string | null;
  keyLevels: string | null;
  primaryScenario: string | null;
  alternateScenario: string | null;
  invalidationConditions: string | null;
  maxRiskPercent: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface JournalTemplateInput {
  name: string;
  description?: string | null;
  marketBias?: string | null;
  preMarketPlan?: string | null;
  keyLevels?: string | null;
  primaryScenario?: string | null;
  alternateScenario?: string | null;
  invalidationConditions?: string | null;
  maxRiskPercent?: string | null;
}

export function useJournalTemplates() {
  return useQuery({
    queryKey: ["journal", "templates"],
    queryFn: async () =>
      (await apiFetch<{ templates: JournalTemplateDTO[] }>("/api/v1/journal/templates")).templates,
    staleTime: 60 * 1000,
  });
}

export function useCreateJournalTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: JournalTemplateInput) => (
      await apiFetch<{ template: JournalTemplateDTO }>(
        "/api/v1/journal/templates",
        { method: "POST", body: JSON.stringify(input) },
      )
    ).template,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["journal", "templates"] });
    },
  });
}

export function useUpdateJournalTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; patch: Partial<JournalTemplateInput> & { isDefault?: boolean } }) =>
      (await apiFetch<{ template: JournalTemplateDTO }>(
        `/api/v1/journal/templates/${args.id}`,
        { method: "PATCH", body: JSON.stringify(args.patch) },
      )).template,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["journal", "templates"] });
    },
  });
}

export function useDeleteJournalTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      apiFetch<{ deleted: boolean }>(`/api/v1/journal/templates/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["journal", "templates"] });
    },
  });
}
