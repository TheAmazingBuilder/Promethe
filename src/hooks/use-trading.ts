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
import type {
  AccountDTO,
  PaginatedDTO,
  SavedViewDTO,
  StrategyDTO,
  TagDTO,
  TemplateDTO,
  TradeDetailDTO,
  TradeListItemDTO,
  DashboardPayload,
  AnalyticsPayload,
  AdvancedAnalyticsPayload,
} from "@/lib/trading/dto";
import type {
  CloseTradeInput,
  TemplateInput,
  TemplatePatch,
  TradeInput,
  TradeListQuery,
  TradePatch,
} from "@/lib/validations/trade";
import type { AnalyticsPeriod } from "@/lib/validations/analytics";

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
  return useQuery({
    queryKey: ["instruments"],
    queryFn: async () =>
      (await apiFetch<{ instruments: InstrumentApiDTO[] }>("/api/v1/instruments"))
        .instruments,
    staleTime: 10 * 60 * 1000,
  });
}

export function useAccounts() {
  return useQuery({
    queryKey: ["accounts"],
    queryFn: async () =>
      (await apiFetch<{ accounts: AccountDTO[] }>("/api/v1/accounts")).accounts,
    staleTime: 60 * 1000,
  });
}

export function useStrategies() {
  return useQuery({
    queryKey: ["strategies"],
    queryFn: async () =>
      (await apiFetch<{ strategies: StrategyDTO[] }>("/api/v1/strategies"))
        .strategies,
    staleTime: 60 * 1000,
  });
}

export function useTags() {
  return useQuery({
    queryKey: ["tags"],
    queryFn: async () => (await apiFetch<{ tags: TagDTO[] }>("/api/v1/tags")).tags,
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
      return apiFetch<PaginatedDTO<TradeListItemDTO>>(
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
}

function useInvalidateTrades() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["trades"] });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
}

export function useCreateTrade() {
  const invalidate = useInvalidateTrades();
  return useMutation({
    mutationFn: async (input: TradeInput) =>
      apiFetch<MutationResult>("/api/v1/trades", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
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

export function useAdvancedAnalytics(filters: AnalyticsFilters) {
  const params = new URLSearchParams({ period: filters.period });
  if (filters.account) params.set("account", filters.account);
  const qs = params.toString();
  return useQuery({
    queryKey: ["analytics-advanced", filters.period, filters.account ?? "all"],
    queryFn: async () =>
      apiFetch<AdvancedAnalyticsPayload>(`/api/v1/analytics/advanced?${qs}`),
    staleTime: 60 * 1000,
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
  kind: "SETUP" | "MISTAKE" | "CONTEXT" | "CUSTOM";
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
