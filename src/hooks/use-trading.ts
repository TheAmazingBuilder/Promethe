"use client";

/**
 * React Query hooks — typed glue between the views and the trading APIs.
 * Every hook goes through apiFetch (envelope + ApiClientError) and stays
 * silent about Prisma internals. Invalidation targets: ["trades"],
 * ["dashboard"], ["templates"].
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { invalidateTradeDerivedQueries } from "@/lib/query/invalidation";
import type {
  AccountDTO,
  PreTradeWarningDTO,
  SavedViewDTO,
  StrategyDTO,
  TagDTO,
  TemplateDTO,
  TradeDetailDTO,
  DashboardPayload,
  AnalyticsPayload,
  AdvancedAnalyticsPayload,
  AccountsHealthPayload,
  WeeklyPlanPayload,
  PerformanceReportPayload,
  WhenYouTradePayload,
  TradesListPayload,
} from "@/lib/trading/dto";
import type {
  WeeklyPlanToggleResult,
} from "@/lib/analytics/weekly-plan";
import type {
  AdvancedModule,
  AnalyticsPeriod,
  WeeklyPlanRule,
} from "@/lib/validations/analytics";
import type {
  CloseTradeInput,
  TemplateInput,
  TemplatePatch,
  TradeInput,
  TradeListQuery,
  TradePatch,
} from "@/lib/validations/trade";
import { getBrowserStore, isOfflineQueueSupported } from "@/lib/offline/store";
import { getOfflineUserId } from "@/lib/offline/session";
import { enqueueOperation } from "@/lib/offline/queue";
import { fetchReferenceWithFallback } from "@/lib/offline/reference-data";
import { newOfflineId } from "@/lib/offline/types";

// ── Reference data ───────────────────────────────────────────────────────────

export interface InstrumentApiDTO {
  id: string;
  /** True for global presets (read-only) - customs belong to the user. */
  isPreset: boolean;
  symbol: string;
  name: string;
  assetClass: string;
  baseCurrency: string | null;
  quoteCurrency: string;
  digits: number;
  pipSize: string;
  pointSize: string;
  contractSize: string;
  tickSize: string | null;
  tickValue: string | null;
  isActive: boolean;
  marketTimezone: string | null;
}

export function useInstruments() {
  const userId = getOfflineUserId();
  return useQuery({
    queryKey: ["instruments", userId],
    queryFn: async () =>
      fetchReferenceWithFallback(
        isOfflineQueueSupported() ? getBrowserStore() : null,
        userId,
        "instruments",
        async () =>
          (await apiFetch<{ instruments: InstrumentApiDTO[] }>("/api/v1/instruments"))
            .instruments,
      ),
    staleTime: 10 * 60 * 1000,
  });
}

export function useAccounts() {
  const userId = getOfflineUserId();
  return useQuery({
    queryKey: ["accounts", userId],
    queryFn: async () =>
      fetchReferenceWithFallback(
        isOfflineQueueSupported() ? getBrowserStore() : null,
        userId,
        "accounts",
        async () =>
          (await apiFetch<{ accounts: AccountDTO[] }>("/api/v1/accounts")).accounts,
      ),
    staleTime: 60 * 1000,
  });
}

// ── Account health badges (MRT wave 2, chantier 4) ─────────────────────────

export function useAccountsHealth() {
  return useQuery({
    queryKey: ["accounts-health"],
    queryFn: async () =>
      (await apiFetch<AccountsHealthPayload>("/api/v1/accounts/health"))
        .health,
    staleTime: 60 * 1000,
  });
}

export function useStrategies() {
  const userId = getOfflineUserId();
  return useQuery({
    queryKey: ["strategies", userId],
    queryFn: async () =>
      fetchReferenceWithFallback(
        isOfflineQueueSupported() ? getBrowserStore() : null,
        userId,
        "strategies",
        async () =>
          (await apiFetch<{ strategies: StrategyDTO[] }>("/api/v1/strategies"))
            .strategies,
      ),
    staleTime: 60 * 1000,
  });
}

export function useTags() {
  const userId = getOfflineUserId();
  return useQuery({
    queryKey: ["tags", userId],
    queryFn: async () =>
      fetchReferenceWithFallback(
        isOfflineQueueSupported() ? getBrowserStore() : null,
        userId,
        "tags",
        async () =>
          (await apiFetch<{ tags: TagDTO[] }>("/api/v1/tags")).tags,
      ),
    staleTime: 60 * 1000,
  });
}

export function useSavedViews(page: string) {
  return useQuery({
    queryKey: ["saved-views", page],
    queryFn: async () =>
      (
        await apiFetch<{ views: SavedViewDTO[] }>(
          `/api/v1/saved-views?page=${encodeURIComponent(page)}`
        )
      ).views,
  });
}

// ── Templates ────────────────────────────────────────────────────────────────

export function useTemplates() {
  return useQuery({
    queryKey: ["templates"],
    queryFn: async () =>
      (await apiFetch<{ templates: TemplateDTO[] }>("/api/v1/templates")).templates,
  });
}

export function useCreateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: TemplateInput) =>
      (await apiFetch<{ template: TemplateDTO }>("/api/v1/templates", {
        method: "POST",
        body: JSON.stringify(input),
      })).template,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["templates"] }),
  });
}

export function useUpdateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: TemplatePatch }) =>
      (
        await apiFetch<{ template: TemplateDTO }>(`/api/v1/templates/${id}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        })
      ).template,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["templates"] }),
  });
}

export function useRecordTemplateUse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiFetch(`/api/v1/templates/${id}/use`, { method: "POST" });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["templates"] }),
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiFetch(`/api/v1/templates/${id}`, { method: "DELETE" });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["templates"] }),
  });
}

export function useDuplicateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      (
        await apiFetch<{ template: TemplateDTO }>(
          `/api/v1/templates/${id}/duplicate`,
          { method: "POST" }
        )
      ).template,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["templates"] }),
  });
}

// ── Trades ───────────────────────────────────────────────────────────────────

export function tradesQueryKey(query: TradeListQuery) {
  return ["trades", query] as const;
}

export function useTradesList(query: TradeListQuery) {
  return useQuery({
    queryKey: tradesQueryKey(query),
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("page", String(query.page));
      params.set("pageSize", String(query.pageSize));
      params.set("sort", query.sort);
      params.set("order", query.order);
      params.set("includeDrafts", String(query.includeDrafts));
      for (const [key, value] of Object.entries(query)) {
        if (
          ["page", "pageSize", "sort", "order", "includeDrafts"].includes(key)
        )
          continue;
        if (value !== undefined && value !== null && value !== "") {
          params.set(key, String(value));
        }
      }
      return apiFetch<TradesListPayload>(
        `/api/v1/trades?${params.toString()}`
      );
    },
  });
}

export function useTrade(id: string | null) {
  return useQuery({
    queryKey: ["trades", "detail", id],
    enabled: !!id,
    queryFn: async () =>
      (await apiFetch<{ trade: TradeDetailDTO }>(`/api/v1/trades/${id}`)).trade,
  });
}

export interface MutationResult {
  trade: TradeDetailDTO;
  deduplicated?: boolean;
  conflict?: { baseUpdatedAt: string; serverUpdatedAt: string } | null;
  /** True when the trade was queued offline instead of created (§25.5). */
  queued?: boolean;
}

function useInvalidateTrades() {
  const qc = useQueryClient();
  return () => invalidateTradeDerivedQueries(qc);
}

export function useCreateTrade() {
  const invalidate = useInvalidateTrades();
  return useMutation({
    mutationFn: async (input: TradeInput) => {
      // Offline (§25.5): queue the create instead of failing. The replay
      // sends the same payload (same clientMutationId) against the same
      // route, so a retried replay never creates a duplicate.
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        const userId = getOfflineUserId();
        if (userId && isOfflineQueueSupported()) {
          const idempotencyKey = input.clientMutationId ?? newOfflineId();
          const payload = { ...input, clientMutationId: idempotencyKey };
          await enqueueOperation(getBrowserStore(), {
            userId,
            kind: "TRADE_CREATE",
            entityKey: idempotencyKey,
            idempotencyKey,
            payload: payload as unknown as Record<string, unknown>,
          });
          return {
            trade: { id: idempotencyKey } as TradeDetailDTO,
            deduplicated: false,
            queued: true,
          } satisfies MutationResult;
        }
      }
      return apiFetch<MutationResult>("/api/v1/trades", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    onSuccess: invalidate,
  });
}

// ── Pre-trade warnings (Lot 11, roadmap §14) ──────────────────────────────

/**
 * Advisory warnings for a trade draft (unchecked required checklist
 * items, risk above the per-trade limit, planned R:R below the minimum,
 * day-trade count above the daily limit). Warnings never block the save;
 * the form shows them and the user confirms explicitly.
 */
export function usePreTradeWarnings() {
  return useMutation({
    mutationFn: async (input: {
      strategyId?: string | null;
      riskAmount?: string | null;
      plannedRR?: string | null;
      entryTime?: string | null;
      checklistResults?: Record<string, boolean> | null;
    }) =>
      apiFetch<{ warnings: PreTradeWarningDTO[] }>(
        "/api/v1/trades/pre-trade-warnings",
        { method: "POST", body: JSON.stringify(input) },
      ),
  });
}

export function useUpdateTrade() {
  const invalidate = useInvalidateTrades();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: TradePatch }) =>
      apiFetch<MutationResult>(`/api/v1/trades/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: invalidate,
  });
}

export function useCloseTrade() {
  const invalidate = useInvalidateTrades();
  return useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id: string;
      input: Omit<CloseTradeInput, "clientMutationId"> & {
        clientMutationId?: string | null;
      };
    }) =>
      apiFetch<{ trade: TradeDetailDTO }>(`/api/v1/trades/${id}/close`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteTrade() {
  const invalidate = useInvalidateTrades();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiFetch(`/api/v1/trades/${id}`, { method: "DELETE" });
    },
    onSuccess: invalidate,
  });
}

// ── Dashboard ────────────────────────────────────────────────────────────────

export function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => apiFetch<DashboardPayload>("/api/v1/dashboard"),
  });
}

// ── Analytics (v2 Phase 4) ────────────────────────────────────────────────────

export interface AnalyticsFilters {
  period: AnalyticsPeriod;
  account?: string;
}

export function useAnalytics(filters: AnalyticsFilters) {
  const params = new URLSearchParams({ period: filters.period });
  if (filters.account) params.set("account", filters.account);
  const qs = params.toString();
  return useQuery({
    queryKey: ["analytics", filters.period, filters.account ?? "all"],
    queryFn: async () => apiFetch<AnalyticsPayload>(`/api/v1/analytics?${qs}`),
    staleTime: 60 * 1000,
  });
}

// ── Advanced analytics (v2.5 Module 6) ───────────────────────────────────────

// Phase 2 perf — `module` restricts the server computation to one module
// (score covers the trader score + its history); omit it for all modules.
export function useAdvancedAnalytics(
  filters: AnalyticsFilters,
  module?: AdvancedModule
) {
  const params = new URLSearchParams({ period: filters.period });
  if (filters.account) params.set("account", filters.account);
  if (module) params.set("module", module);
  const qs = params.toString();
  return useQuery({
    queryKey: [
      "analytics-advanced",
      filters.period,
      filters.account ?? "all",
      module ?? "all",
    ],
    queryFn: async () =>
      apiFetch<AdvancedAnalyticsPayload>(`/api/v1/analytics/advanced?${qs}`),
    // Phase 2 perf (item 6) — heavy endpoint (full recompute per module
    // on the server, 45 s server cache): no refetch on tab return, 5 min
    // staleTime. Fresh data still arrives after a trade mutation via
    // useInvalidateTrades.
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

// ── When you trade (MRT wave 2) ─────────────────────────────────────────────
export function useWhenYouTrade(filters: AnalyticsFilters) {
  const params = new URLSearchParams({ period: filters.period });
  if (filters.account) params.set("account", filters.account);
  const qs = params.toString();
  return useQuery({
    queryKey: ["analytics-when-you-trade", filters.period, filters.account ?? "all"],
    queryFn: async () =>
      apiFetch<WhenYouTradePayload>(`/api/v1/analytics/when-you-trade?${qs}`),
    staleTime: 60 * 1000,
  });
}

// ── Weekly improvement plan (MRT wave 1) ───────────────────────────────────

export function useWeeklyPlan(accountId?: string) {
  const params = new URLSearchParams();
  if (accountId) params.set("account", accountId);
  const qs = params.toString();
  return useQuery({
    queryKey: ["weekly-plan", accountId ?? "all"],
    queryFn: async () =>
      apiFetch<WeeklyPlanPayload>(
        `/api/v1/weekly-plan${qs ? `?${qs}` : ""}`
      ),
    // Phase 2 perf (item 6) — heavy endpoint: no refetch on tab return,
    // 5 min staleTime. The toggle invalidates this key on success.
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useToggleWeeklyPlanAction(accountId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ rule, done }: { rule: WeeklyPlanRule; done: boolean }) => {
      const params = new URLSearchParams();
      if (accountId) params.set("account", accountId);
      const qs = params.toString();
      return apiFetch<{ action: WeeklyPlanToggleResult }>(
        `/api/v1/weekly-plan${qs ? `?${qs}` : ""}`,
        { method: "POST", body: JSON.stringify({ rule, done }) }
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["weekly-plan"] });
      // The performance report embeds the same plan.
      void qc.invalidateQueries({ queryKey: ["performance-report"] });
    },
  });
}

// ── Performance report (MRT wave 3) ──────────────────────────────────────
export function usePerformanceReport(filters: AnalyticsFilters) {
  const params = new URLSearchParams({ period: filters.period });
  if (filters.account) params.set("account", filters.account);
  const qs = params.toString();
  return useQuery({
    queryKey: [
      "performance-report",
      filters.period,
      filters.account ?? "all",
    ],
    queryFn: async () =>
      apiFetch<PerformanceReportPayload>(
        `/api/v1/performance-report?${qs}`
      ),
    // Phase 2 perf (item 6) — heavy endpoint: no refetch on tab return,
    // 5 min staleTime. The plan toggle invalidates this key on success.
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

// ── Uploads ──────────────────────────────────────────────────────────────────

export function useUploadScreenshot() {
  const invalidate = useInvalidateTrades();
  return useMutation({
    mutationFn: async ({
      tradeId,
      blob,
      label,
      caption,
    }: {
      tradeId: string;
      blob: Blob;
      label?: string | null;
      caption?: string | null;
    }) => {
      const form = new FormData();
      const ext = blob.type === "image/png" ? "png" : blob.type === "image/jpeg" ? "jpg" : "webp";
      form.append("file", blob, `screenshot.${ext}`);
      form.append("tradeId", tradeId);
      if (label) form.append("label", label);
      if (caption) form.append("caption", caption);
      // apiFetch sets JSON headers — raw fetch for multipart.
      const res = await fetch("/api/v1/uploads", { method: "POST", body: form });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { message?: string }
          | null;
        throw new Error(body?.message ?? "Upload failed");
      }
      return res.json() as Promise<{
        upload: { id: string; url: string };
      }>;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateScreenshot() {
  const invalidate = useInvalidateTrades();
  return useMutation({
    mutationFn: async (input: { id: string; label: string | null; caption: string | null }) => {
      const result = await apiFetch<{ upload: { id: string } }>(
        `/api/v1/uploads/${input.id}`,
        { method: "PATCH", body: JSON.stringify({ label: input.label, caption: input.caption }) }
      );
      return result.upload;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteScreenshot() {
  const invalidate = useInvalidateTrades();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiFetch(`/api/v1/uploads/${id}`, { method: "DELETE" });
    },
    onSuccess: invalidate,
  });
}

// ── Saved views mutations ────────────────────────────────────────────────────

export function useCreateSavedView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      page: string;
      name: string;
      filters: Record<string, unknown>;
      columns?: string[] | null;
      sort?: Array<{ id: string; desc: boolean }> | null;
      grouping?: Record<string, unknown> | null;
      isPinned?: boolean;
      isDefault?: boolean;
    }) =>
      apiFetch<{ view: SavedViewDTO }>("/api/v1/saved-views", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (_data, variables) =>
      void qc.invalidateQueries({ queryKey: ["saved-views", variables.page] }),
  });
}

export function useUpdateSavedView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: {
        name?: string;
        filters?: Record<string, unknown>;
        columns?: string[] | null;
        sort?: Array<{ id: string; desc: boolean }> | null;
        grouping?: Record<string, unknown> | null;
        isPinned?: boolean;
        isDefault?: boolean;
        order?: number;
      };
    }) =>
      (
        await apiFetch<{ view: SavedViewDTO }>(`/api/v1/saved-views/${id}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        })
      ).view,
    onSuccess: (view) =>
      void qc.invalidateQueries({ queryKey: ["saved-views", view.page] }),
  });
}

export function useDuplicateSavedView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (view: SavedViewDTO) =>
      (
        await apiFetch<{ view: SavedViewDTO }>(
          `/api/v1/saved-views/${view.id}/duplicate`,
          { method: "POST" }
        )
      ).view,
    onSuccess: (view) =>
      void qc.invalidateQueries({ queryKey: ["saved-views", view.page] }),
  });
}

export function useDeleteSavedView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (view: SavedViewDTO) => {
      await apiFetch(`/api/v1/saved-views/${view.id}`, { method: "DELETE" });
      return view;
    },
    onSuccess: (view) =>
      void qc.invalidateQueries({ queryKey: ["saved-views", view.page] }),
  });
}

// ── Accounts mutations (v1 phase 7 — /accounts) ─────────────────────────────

export interface AccountInputBody {
  name: string;
  broker?: string | null;
  type: "LIVE" | "DEMO" | "PROP" | "BACKTEST";
  currency: "USD" | "EUR" | "GBP" | "CAD" | "CHF" | "AUD" | "NZD" | "JPY";
  initialBalance: string;
  leverage?: number | null;
  isActive: boolean;
  maxDailyLossPercent?: string | null;
  maxTotalDrawdownPercent?: string | null;
  profitTarget?: string | null;
  marginCallLevel?: string | null;
  stopOutLevel?: string | null;
  drawdownType?: "STATIC" | "TRAILING" | null;
  startDate?: string | null;
  serverTimezoneMode?: "IANA" | "FIXED_OFFSET" | "NY_CLOSE" | null;
  serverTimezone?: string | null;
  serverFixedOffsetMinutes?: number | null;
}

export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AccountInputBody) =>
      (
        await apiFetch<{ account: AccountDTO }>("/api/v1/accounts", {
          method: "POST",
          body: JSON.stringify(input),
        })
      ).account,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; patch: Partial<AccountInputBody> }) =>
      (
        await apiFetch<{ account: AccountDTO }>(`/api/v1/accounts/${args.id}`, {
          method: "PATCH",
          body: JSON.stringify(args.patch),
        })
      ).account,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      void qc.invalidateQueries({ queryKey: ["prop-status"] });
    },
  });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiFetch<void>(`/api/v1/accounts/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["accounts"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

// ── Tags mutations (v1 phase 7 — /tags) ────────────────────────────────────

export interface TagInputBody {
  name: string;
  color: string;
  kind: "SETUP" | "MISTAKE" | "CONTEXT" | "CUSTOM" | "CONFLUENCE";
}

export function useCreateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: TagInputBody) =>
      (
        await apiFetch<{ tag: TagDTO }>("/api/v1/tags", {
          method: "POST",
          body: JSON.stringify(input),
        })
      ).tag,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tags"] });
    },
  });
}

export function useUpdateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; patch: Partial<TagInputBody> }) =>
      (
        await apiFetch<{ tag: TagDTO }>(`/api/v1/tags/${args.id}`, {
          method: "PATCH",
          body: JSON.stringify(args.patch),
        })
      ).tag,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tags"] });
      void qc.invalidateQueries({ queryKey: ["trades"] });
    },
  });
}

export function useDeleteTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiFetch<void>(`/api/v1/tags/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tags"] });
      void qc.invalidateQueries({ queryKey: ["trades"] });
    },
  });
}

// ── Custom instruments mutations (v1 phase 7 — /instruments) ────────────────

export interface InstrumentInputBody {
  symbol: string;
  name: string;
  assetClass: string;
  baseCurrency?: string | null;
  quoteCurrency: string;
  digits: number;
  pipSize: string;
  pointSize: string;
  contractSize: string;
  tickSize?: string | null;
  tickValue?: string | null;
  isActive: boolean;
  marketTimezone?: string | null;
}

export function useCreateInstrument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: InstrumentInputBody) =>
      (
        await apiFetch<{ instrument: InstrumentApiDTO }>(
          "/api/v1/instruments",
          { method: "POST", body: JSON.stringify(input) }
        )
      ).instrument,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["instruments"] });
    },
  });
}

export function useUpdateInstrument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      id: string;
      patch: Partial<InstrumentInputBody>;
    }) =>
      (
        await apiFetch<{ instrument: InstrumentApiDTO }>(
          `/api/v1/instruments/${args.id}`,
          { method: "PATCH", body: JSON.stringify(args.patch) }
        )
      ).instrument,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["instruments"] });
    },
  });
}

export function useDeleteInstrument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiFetch<void>(`/api/v1/instruments/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["instruments"] });
    },
  });
}
