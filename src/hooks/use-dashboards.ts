"use client";

/**
 * React Query hooks — customizable dashboards (v2.5 Module 1).
 *
 * Typed glue between the dashboard views and the dashboard APIs. Every hook
 * goes through apiFetch (envelope + ApiClientError). Invalidation targets:
 * ["dashboards"] (the widget list lives inside each dashboard DTO),
 * ["dashboard-data"], ["appearance"], ["custom-metrics"].
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type {
  DashboardDTO,
  DashboardWidgetDTO,
  PeriodPreset,
  WidgetLayouts,
} from "@/lib/dashboard/types";
import type { PeriodOverride } from "@/lib/dashboard/types";
import type {
  AppearanceInput,
  CustomMetricInput,
  DashboardCreate,
  DashboardPatch,
  WidgetPatchInput,
} from "@/lib/validations/dashboard";
import { useToast } from "@/hooks/use-toast";

// ── Payload shapes (client-side mirrors of the server DTOs) ─────────────────

/** Feature prerequisites for the widget catalog (registry "requires"). */
export interface DashboardRequirements {
  prop: boolean;
  news: boolean;
  sync: boolean;
  goals: boolean;
  metrics: boolean;
}

export interface DashboardsPayload {
  dashboards: DashboardDTO[];
  requirements: DashboardRequirements;
}

/** One widget's entry of the batched data call. */
export interface WidgetDataEntry {
  data: unknown | null;
  error: string | null;
}

export interface DashboardDataPayload {
  currency: string;
  timezone: string;
  generatedAt: string;
  requirements: DashboardRequirements;
  widgets: Record<string, WidgetDataEntry>;
}

export interface CustomMetricListDTO {
  id: string;
  name: string;
  description: string | null;
  /** Parsed MetricDefinition ({ aggregate, filterGroups, formula? }). */
  definition: unknown;
  format: string;
}

export interface AppearanceDTO {
  paletteKey: string;
  gainColor: string | null;
  lossColor: string | null;
  neutralColor: string | null;
  density: string;
  chartPaletteKey: string;
  kpiDefaults: {
    kpis?: string[];
    showDelta?: boolean;
    showSparkline?: boolean;
  };
  focusModeConfig: { hideAmounts?: boolean; blocks?: string[] } | null;
}

// ── Queries ──────────────────────────────────────────────────────────────────

export function useDashboards() {
  return useQuery({
    queryKey: ["dashboards"],
    queryFn: async () =>
      apiFetch<DashboardsPayload>("/api/dashboards"),
    staleTime: 30_000,
  });
}

export function useDashboardData(
  dashboardId: string | null,
  preset: PeriodPreset,
  accountId: string | null
) {
  return useQuery({
    queryKey: ["dashboard-data", dashboardId, preset, accountId],
    enabled: dashboardId != null,
    staleTime: 30_000,
    queryFn: async () =>
      apiFetch<DashboardDataPayload>(
        `/api/dashboards/${dashboardId}/data`,
        {
          method: "POST",
          body: JSON.stringify({ preset, accountId }),
        }
      ),
  });
}

export function useAppearance() {
  return useQuery({
    queryKey: ["appearance"],
    queryFn: async () =>
      (await apiFetch<{ appearance: AppearanceDTO }>("/api/appearance"))
        .appearance,
    staleTime: 60_000,
  });
}

export function useCustomMetrics() {
  return useQuery({
    queryKey: ["custom-metrics"],
    queryFn: async () =>
      (await apiFetch<{ metrics: CustomMetricListDTO[] }>(
        "/api/custom-metrics"
      )).metrics,
    staleTime: 60_000,
  });
}

// ── Dashboard mutations ──────────────────────────────────────────────────────

export function useCreateDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: DashboardCreate) =>
      (
        await apiFetch<{ dashboard: DashboardDTO }>("/api/dashboards", {
          method: "POST",
          body: JSON.stringify(input),
        })
      ).dashboard,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["dashboards"] }),
  });
}

export function usePatchDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; patch: DashboardPatch }) =>
      (
        await apiFetch<{ dashboard: DashboardDTO }>(`/api/dashboards/${args.id}`, {
          method: "PATCH",
          body: JSON.stringify(args.patch),
        })
      ).dashboard,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["dashboards"] }),
  });
}

export function useDeleteDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiFetch<void>(`/api/dashboards/${id}`, { method: "DELETE" });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["dashboards"] }),
  });
}

export function useReorderDashboards() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (order: string[]) =>
      (
        await apiFetch<{ dashboards: DashboardDTO[] }>(
          "/api/dashboards/reorder",
          { method: "POST", body: JSON.stringify({ order }) }
        )
      ).dashboards,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["dashboards"] }),
  });
}

// ── Widget mutations ─────────────────────────────────────────────────────────

export interface AddWidgetInput {
  type: string;
  title?: string | null;
  config?: unknown;
  layouts?: WidgetLayouts;
  periodOverride?: PeriodOverride | null;
}

export function useAddWidget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { dashboardId: string; input: AddWidgetInput }) =>
      (
        await apiFetch<{ widget: DashboardWidgetDTO }>(
          `/api/dashboards/${args.dashboardId}/widgets`,
          { method: "POST", body: JSON.stringify(args.input) }
        )
      ).widget,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["dashboards"] });
      void qc.invalidateQueries({ queryKey: ["dashboard-data"] });
    },
  });
}

/** Strips undefined values - the strict server schema rejects unknown/empty keys. */
function cleanPatch(patch: WidgetPatchInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * PATCH one widget.
 *
 * `optimistic` mode (layout autosave): the ["dashboards"] cache is patched in
 * place on mutate, rolled back + toasted on error, and NOT invalidated on
 * success — drag/resize saves must not re-render the whole grid on every drop.
 * Default mode invalidates ["dashboards"] (config / period / title changes).
 */
export function usePatchWidget(options?: { optimistic?: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const optimistic = options?.optimistic === true;

  return useMutation({
    mutationFn: async (args: {
      dashboardId: string;
      widgetId: string;
      patch: WidgetPatchInput;
    }) =>
      (
        await apiFetch<{ widget: DashboardWidgetDTO }>(
          `/api/dashboards/${args.dashboardId}/widgets/${args.widgetId}`,
          { method: "PATCH", body: JSON.stringify(cleanPatch(args.patch)) }
        )
      ).widget,

    onMutate: async ({ dashboardId, widgetId, patch }) => {
      if (!optimistic) return;
      await qc.cancelQueries({ queryKey: ["dashboards"] });
      const previous = qc.getQueryData<DashboardsPayload>(["dashboards"]);
      if (previous) {
        qc.setQueryData<DashboardsPayload>(["dashboards"], {
          ...previous,
          dashboards: previous.dashboards.map((d) =>
            d.id !== dashboardId
              ? d
              : {
                  ...d,
                  widgets: d.widgets.map((w) =>
                    w.id !== widgetId ? w : { ...w, ...patch }
                  ),
                }
          ),
        });
      }
      return { previous };
    },

    onError: (error, _args, context) => {
      if (context?.previous) {
        qc.setQueryData(["dashboards"], context.previous);
      }
      toast({
        title: String(
          (error as Error | undefined)?.message ?? "Layout save failed"
        ),
        variant: "destructive",
      });
    },

    onSuccess: () => {
      if (!optimistic) {
        void qc.invalidateQueries({ queryKey: ["dashboards"] });
      }
      void qc.invalidateQueries({ queryKey: ["dashboard-data"] });
    },
  });
}

export function useDeleteWidget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { dashboardId: string; widgetId: string }) => {
      await apiFetch<void>(
        `/api/dashboards/${args.dashboardId}/widgets/${args.widgetId}`,
        { method: "DELETE" }
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["dashboards"] });
      void qc.invalidateQueries({ queryKey: ["dashboard-data"] });
    },
  });
}

// ── Appearance mutations ─────────────────────────────────────────────────────

export function usePutAppearance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AppearanceInput) =>
      (
        await apiFetch<{ appearance: AppearanceDTO }>("/api/appearance", {
          method: "PUT",
          body: JSON.stringify(input),
        })
      ).appearance,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["appearance"] }),
  });
}

// ── Custom metric mutations ──────────────────────────────────────────────────

export function useCreateCustomMetric() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CustomMetricInput) =>
      (
        await apiFetch<{ metric: CustomMetricListDTO }>("/api/custom-metrics", {
          method: "POST",
          body: JSON.stringify(input),
        })
      ).metric,
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["custom-metrics"] }),
  });
}

export function usePatchCustomMetric() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      id: string;
      patch: Partial<CustomMetricInput>;
    }) =>
      (
        await apiFetch<{ metric: CustomMetricListDTO }>(
          `/api/custom-metrics/${args.id}`,
          { method: "PATCH", body: JSON.stringify(args.patch) }
        )
      ).metric,
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["custom-metrics"] }),
  });
}

export function useDeleteCustomMetric() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiFetch<void>(`/api/custom-metrics/${id}`, { method: "DELETE" });
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["custom-metrics"] }),
  });
}

// ── Templates / import / export (settings view, v2.5 M1) ────────────────────

/** Saved user blueprint - `definition` is the export-shaped payload. */
export interface UserTemplateDTO {
  id: string;
  name: string;
  description: string | null;
  definition: unknown;
  createdAt: string;
}

export interface DashboardImportSkipDTO {
  dashboardIndex: number;
  widgetIndex: number;
  type: string;
  reason: "UNKNOWN_WIDGET_TYPE" | "INVALID_CONFIG" | "LIMIT_REACHED";
}

export interface DashboardExportPayloadDTO {
  version: 1;
  exportedAt: string;
  dashboards: Array<{
    name: string;
    icon: string;
    widgets: Array<{
      type: string;
      title: string | null;
      config: unknown;
      layouts: WidgetLayouts;
      periodOverride: PeriodOverride | null;
    }>;
  }>;
}

export function useUserTemplates() {
  return useQuery({
    queryKey: ["user-templates"],
    queryFn: async () =>
      (await apiFetch<{ templates: UserTemplateDTO[] }>(
        "/api/user-templates"
      )).templates,
    staleTime: 30_000,
  });
}

export function useDeleteUserTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiFetch<void>(`/api/user-templates/${id}`, { method: "DELETE" });
    },
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["user-templates"] }),
  });
}

export function useSaveAsTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      dashboardId: string;
      name: string;
      description?: string | null;
    }) =>
      (
        await apiFetch<{ template: UserTemplateDTO }>(
          `/api/dashboards/${args.dashboardId}/save-template`,
          {
            method: "POST",
            body: JSON.stringify({
              name: args.name,
              ...(args.description != null ? { description: args.description } : {}),
            }),
          }
        )
      ).template,
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["user-templates"] }),
  });
}

export function useApplyTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { dashboardId: string; templateKey: string }) =>
      apiFetch<{
        dashboard: DashboardDTO;
        skipped: DashboardImportSkipDTO[];
      }>(`/api/dashboards/${args.dashboardId}/apply-template`, {
        method: "POST",
        body: JSON.stringify({ templateKey: args.templateKey }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["dashboards"] });
      void qc.invalidateQueries({ queryKey: ["dashboard-data"] });
    },
  });
}

export function useImportDashboards() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: unknown) =>
      apiFetch<{
        dashboards: DashboardDTO[];
        skipped: DashboardImportSkipDTO[];
      }>("/api/dashboards/import", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["dashboards"] });
      void qc.invalidateQueries({ queryKey: ["dashboard-data"] });
    },
  });
}

/** Raw GET of the portable export payload (no cache - one-off download). */
export async function fetchDashboardExport(
  dashboardId: string
): Promise<DashboardExportPayloadDTO> {
  return apiFetch<DashboardExportPayloadDTO>(
    `/api/dashboards/${dashboardId}/export`
  );
}
