"use client";

/**
 * React Query hooks for the v2.5 Module 5 trading-tools APIs: scenarios,
 * FX rates, market session settings, exit plans and exposure thresholds.
 *
 * Same conventions as src/hooks/use-productivity.ts (apiFetch envelope,
 * query keys per entity, invalidation on mutation).
 *
 * Graceful degradation: when the tools tables do not exist yet in the
 * database (migration not run), the API answers 503 TOOLS_TABLES_MISSING.
 * `isToolsTablesMissing(error)` lets components show the
 * ToolsUnavailable state instead of crashing.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import type {
  ExitPlanDTO,
  ExposureAlertSettingDTO,
  FxRateDTO,
  MarketSessionSettingDTO,
  ToolScenarioDTO,
} from "@/lib/trading/dto";
import {
  DEFAULT_EXPOSURE_SETTINGS,
  type ExitPlanEntry,
  type ExposureSettings,
  type FxRateEntry,
  type MarketSessionSettingEntry,
  type ToolScenario,
} from "@/lib/tools/types";
import type {
  ExitPlanInput,
  ExitPlanPatch,
  ExposureSettingsInput,
  FxRateInput,
  MarketSessionSettingInput,
  MarketSessionSettingPatch,
  ToolScenarioInput,
  ToolScenarioPatch,
} from "@/lib/validations/tools";

/** True when the API reports missing tools tables (migration not run). */
export function isToolsTablesMissing(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === "TOOLS_TABLES_MISSING";
}

// ── DTO → UI entry mapping ───────────────────────────────────────────────────

function toScenario(dto: ToolScenarioDTO): ToolScenario {
  return { id: dto.id, name: dto.name, kind: dto.kind, payload: dto.payload, createdAt: dto.createdAt };
}

function toFxRate(dto: FxRateDTO): FxRateEntry {
  return {
    id: dto.id,
    base: dto.base,
    quote: dto.quote,
    rate: dto.rate,
    source: dto.source === "CSV" ? "CSV" : "MANUAL",
    date: dto.date,
  };
}

function toSession(dto: MarketSessionSettingDTO): MarketSessionSettingEntry {
  return {
    id: dto.id,
    name: dto.name,
    kind: dto.kind === "DETECTION" ? "DETECTION" : "DISPLAY",
    timezone: dto.timezone,
    openTime: dto.openTime,
    closeTime: dto.closeTime,
    activeDays: dto.activeDays,
    enabled: dto.enabled,
    sortOrder: dto.sortOrder,
  };
}

function toExitPlan(dto: ExitPlanDTO): ExitPlanEntry {
  return {
    id: dto.id,
    name: dto.name,
    tiers: dto.tiers,
    breakevenAfterTier: dto.breakevenAfterTier,
    trailingAfterTier: dto.trailingAfterTier,
    notes: dto.notes,
    createdAt: dto.createdAt,
  };
}

function toExposure(dto: ExposureAlertSettingDTO | null): ExposureSettings {
  if (!dto) return DEFAULT_EXPOSURE_SETTINGS;
  return {
    enabled: dto.enabled,
    duplicationThresholdPercent: dto.duplicationThresholdPercent,
    maxCurrencyExposurePercent: dto.maxCurrencyExposurePercent,
  };
}

// ── Tool scenarios ───────────────────────────────────────────────────────────

export function useToolScenarios(kind?: "MULTI_TP" | "MARGIN" | "RISK_REWARD") {
  return useQuery({
    queryKey: ["tool-scenarios", kind ?? "ALL"],
    queryFn: async () =>
      (
        await apiFetch<{ scenarios: ToolScenarioDTO[] }>(
          `/api/tool-scenarios${kind ? `?kind=${kind}` : ""}`
        )
      ).scenarios.map(toScenario),
  });
}

export function useCreateToolScenario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ToolScenarioInput) =>
      toScenario(
        (
          await apiFetch<{ scenario: ToolScenarioDTO }>("/api/tool-scenarios", {
            method: "POST",
            body: JSON.stringify(input),
          })
        ).scenario
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tool-scenarios"] });
    },
  });
}

export function useDeleteToolScenario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiFetch(`/api/tool-scenarios/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tool-scenarios"] });
    },
  });
}

// ── FX rates ─────────────────────────────────────────────────────────────────

export function useFxRates() {
  return useQuery({
    queryKey: ["fx-rates"],
    queryFn: async () =>
      (await apiFetch<{ rates: FxRateDTO[] }>("/api/fx-rates")).rates.map(toFxRate),
  });
}

export function useUpsertFxRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: FxRateInput) =>
      toFxRate(
        (
          await apiFetch<{ rate: FxRateDTO }>("/api/fx-rates", {
            method: "POST",
            body: JSON.stringify(input),
          })
        ).rate
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["fx-rates"] });
    },
  });
}

export function useDeleteFxRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiFetch(`/api/fx-rates/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["fx-rates"] });
    },
  });
}

export interface FxImportResult {
  imported: number;
  errors: string[];
}

export function useImportFxRates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (csv: string) =>
      apiFetch<FxImportResult>("/api/fx-rates/import", {
        method: "POST",
        body: JSON.stringify({ csv }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["fx-rates"] });
    },
  });
}

// ── Market session settings ──────────────────────────────────────────────────

export function useSessionSettings(kind?: "DISPLAY" | "DETECTION") {
  return useQuery({
    queryKey: ["market-sessions", kind ?? "ALL"],
    queryFn: async () =>
      (
        await apiFetch<{ settings: MarketSessionSettingDTO[] }>(
          `/api/market-sessions${kind ? `?kind=${kind}` : ""}`
        )
      ).settings.map(toSession),
  });
}

export function useCreateSessionSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: MarketSessionSettingInput) =>
      toSession(
        (
          await apiFetch<{ setting: MarketSessionSettingDTO }>("/api/market-sessions", {
            method: "POST",
            body: JSON.stringify(input),
          })
        ).setting
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["market-sessions"] });
    },
  });
}

export function useUpdateSessionSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: MarketSessionSettingPatch;
    }) =>
      toSession(
        (
          await apiFetch<{ setting: MarketSessionSettingDTO }>(
            `/api/market-sessions/${id}`,
            { method: "PATCH", body: JSON.stringify(patch) }
          )
        ).setting
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["market-sessions"] });
    },
  });
}

export function useResetSessionSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await apiFetch("/api/market-sessions", { method: "DELETE" });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["market-sessions"] });
    },
  });
}

// ── Exit plans ───────────────────────────────────────────────────────────────

export function useExitPlans() {
  return useQuery({
    queryKey: ["exit-plans"],
    queryFn: async () =>
      (await apiFetch<{ plans: ExitPlanDTO[] }>("/api/exit-plans")).plans.map(toExitPlan),
  });
}

export function useCreateExitPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ExitPlanInput) =>
      toExitPlan(
        (
          await apiFetch<{ plan: ExitPlanDTO }>("/api/exit-plans", {
            method: "POST",
            body: JSON.stringify(input),
          })
        ).plan
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["exit-plans"] });
    },
  });
}

export function useUpdateExitPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: ExitPlanPatch }) =>
      toExitPlan(
        (
          await apiFetch<{ plan: ExitPlanDTO }>(`/api/exit-plans/${id}`, {
            method: "PATCH",
            body: JSON.stringify(patch),
          })
        ).plan
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["exit-plans"] });
    },
  });
}

export function useDeleteExitPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiFetch(`/api/exit-plans/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["exit-plans"] });
    },
  });
}

// ── Exposure alert settings (singleton) ──────────────────────────────────────

export function useExposureSettings() {
  return useQuery({
    queryKey: ["exposure-settings"],
    queryFn: async () =>
      toExposure(
        (
          await apiFetch<{ settings: ExposureAlertSettingDTO | null }>(
            "/api/exposure-settings"
          )
        ).settings
      ),
  });
}

export function useSaveExposureSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ExposureSettingsInput) =>
      toExposure(
        (
          await apiFetch<{ settings: ExposureAlertSettingDTO }>(
            "/api/exposure-settings",
            { method: "PUT", body: JSON.stringify(input) }
          )
        ).settings
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["exposure-settings"] });
    },
  });
}
