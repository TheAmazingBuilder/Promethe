/**
 * Playbook hooks (Phase 2) — React Query wrappers over the /api/playbook/*
 * and /api/setups/* routes, same conventions as use-journal.ts.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type {
  ChecklistTemplateDTO,
  PlaybookOverviewDTO,
  PlaybookRuleDTO,
  PlaybookTemplateCardDTO,
  SetupDTO,
  SetupInsightDTO,
  StrategyDTO,
  StrategyStatsDTO,
} from "@/lib/trading/dto";
import type {
  ChecklistTemplateInput,
  PlaybookRuleInput,
  SetupInput,
} from "@/lib/validations/playbook";

export const PLAYBOOK_KEYS = {
  overview: ["playbook", "overview"],
  strategies: ["playbook", "strategies"],
  stats: ["playbook", "stats"],
  setups: (strategyId?: string | null) => ["playbook", "setups", strategyId ?? null],
  insights: (strategyId?: string | null) => ["playbook", "insights", strategyId ?? null],
  rules: ["playbook", "rules"],
  checklists: ["playbook", "checklists"],
  templates: ["playbook", "templates"],
} as const;

function invalidatePlaybook(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ["playbook"] });
  void qc.invalidateQueries({ queryKey: ["strategies"] });
}

// ── Overview / strategies / stats ────────────────────────────────────────────

export function usePlaybookOverview() {
  return useQuery({
    queryKey: PLAYBOOK_KEYS.overview,
    queryFn: async () =>
      (await apiFetch<{ overview: PlaybookOverviewDTO }>("/api/playbook/overview"))
        .overview,
    staleTime: 60 * 1000,
  });
}

export function usePlaybookStrategies() {
  return useQuery({
    queryKey: PLAYBOOK_KEYS.strategies,
    queryFn: async () =>
      (
        await apiFetch<{ strategies: StrategyDTO[] }>(
          "/api/playbook/strategies",
        )
      ).strategies,
    staleTime: 60 * 1000,
  });
}

export function usePlaybookStats() {
  return useQuery({
    queryKey: PLAYBOOK_KEYS.stats,
    queryFn: async () =>
      (
        await apiFetch<{ stats: StrategyStatsDTO[] }>(
          "/api/strategies/stats",
        )
      ).stats,
    staleTime: 60 * 1000,
  });
}

// ── Setups ───────────────────────────────────────────────────────────────────

export function useSetups(strategyId?: string | null) {
  const qs = strategyId ? `?strategyId=${encodeURIComponent(strategyId)}` : "";
  return useQuery({
    queryKey: PLAYBOOK_KEYS.setups(strategyId),
    queryFn: async () =>
      (await apiFetch<{ setups: SetupDTO[] }>(`/api/setups${qs}`)).setups,
    staleTime: 60 * 1000,
  });
}

export function useSetupInsights(strategyId?: string | null) {
  const qs = strategyId ? `?strategyId=${encodeURIComponent(strategyId)}` : "";
  return useQuery({
    queryKey: PLAYBOOK_KEYS.insights(strategyId),
    queryFn: async () =>
      (
        await apiFetch<{ insights: SetupInsightDTO[] }>(
          `/api/setups/insights${qs}`,
        )
      ).insights,
    staleTime: 60 * 1000,
  });
}

export function useCreateSetup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SetupInput) =>
      (
        await apiFetch<{ setup: SetupDTO }>("/api/setups", {
          method: "POST",
          body: JSON.stringify(input),
        })
      ).setup,
    onSuccess: () => invalidatePlaybook(qc),
  });
}

export function useUpdateSetup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; patch: Partial<SetupInput> }) =>
      (
        await apiFetch<{ setup: SetupDTO }>(`/api/setups/${args.id}`, {
          method: "PATCH",
          body: JSON.stringify(args.patch),
        })
      ).setup,
    onSuccess: () => invalidatePlaybook(qc),
  });
}

export function useDeleteSetup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiFetch<void>(`/api/setups/${id}`, { method: "DELETE" });
    },
    onSuccess: () => invalidatePlaybook(qc),
  });
}

// ── Playbook rules ───────────────────────────────────────────────────────────

export function usePlaybookRules() {
  return useQuery({
    queryKey: PLAYBOOK_KEYS.rules,
    queryFn: async () =>
      (
        await apiFetch<{ rules: PlaybookRuleDTO[] }>("/api/playbook/rules")
      ).rules,
    staleTime: 60 * 1000,
  });
}

export function useCreatePlaybookRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: PlaybookRuleInput) =>
      (
        await apiFetch<{ rule: PlaybookRuleDTO }>("/api/playbook/rules", {
          method: "POST",
          body: JSON.stringify(input),
        })
      ).rule,
    onSuccess: () => invalidatePlaybook(qc),
  });
}

export function useUpdatePlaybookRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; patch: Partial<PlaybookRuleInput> }) =>
      (
        await apiFetch<{ rule: PlaybookRuleDTO }>(
          `/api/playbook/rules/${args.id}`,
          { method: "PATCH", body: JSON.stringify(args.patch) },
        )
      ).rule,
    onSuccess: () => invalidatePlaybook(qc),
  });
}

export function useDeletePlaybookRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiFetch<void>(`/api/playbook/rules/${id}`, { method: "DELETE" });
    },
    onSuccess: () => invalidatePlaybook(qc),
  });
}

// ── Checklist templates ──────────────────────────────────────────────────────

export function useChecklistTemplates() {
  return useQuery({
    queryKey: PLAYBOOK_KEYS.checklists,
    queryFn: async () =>
      (
        await apiFetch<{ checklists: ChecklistTemplateDTO[] }>(
          "/api/playbook/checklists",
        )
      ).checklists,
    staleTime: 60 * 1000,
  });
}

export function useCreateChecklistTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ChecklistTemplateInput) =>
      (
        await apiFetch<{ checklist: ChecklistTemplateDTO }>(
          "/api/playbook/checklists",
          { method: "POST", body: JSON.stringify(input) },
        )
      ).checklist,
    onSuccess: () => invalidatePlaybook(qc),
  });
}

export function useUpdateChecklistTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      id: string;
      patch: Partial<ChecklistTemplateInput>;
    }) =>
      (
        await apiFetch<{ checklist: ChecklistTemplateDTO }>(
          `/api/playbook/checklists/${args.id}`,
          { method: "PATCH", body: JSON.stringify(args.patch) },
        )
      ).checklist,
    onSuccess: () => invalidatePlaybook(qc),
  });
}

export function useDeleteChecklistTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiFetch<void>(`/api/playbook/checklists/${id}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => invalidatePlaybook(qc),
  });
}

// ── Templates / duplication ──────────────────────────────────────────────────

export function usePlaybookTemplates() {
  return useQuery({
    queryKey: PLAYBOOK_KEYS.templates,
    queryFn: async () =>
      (
        await apiFetch<{ templates: PlaybookTemplateCardDTO[] }>(
          "/api/playbook/templates",
        )
      ).templates,
    staleTime: 5 * 60 * 1000,
  });
}

export function useInstantiateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { key: string; name?: string }) =>
      (
        await apiFetch<{ strategy: StrategyDTO }>(
          "/api/playbook/templates/instantiate",
          { method: "POST", body: JSON.stringify(args) },
        )
      ).strategy,
    onSuccess: () => invalidatePlaybook(qc),
  });
}

export function useDuplicateStrategy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; name?: string }) =>
      (
        await apiFetch<{ strategy: StrategyDTO }>(
          `/api/strategies/${args.id}/duplicate`,
          { method: "POST", body: JSON.stringify({ name: args.name ?? null }) },
        )
      ).strategy,
    onSuccess: () => invalidatePlaybook(qc),
  });
}

export function useInstallGlobalChecklist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (
        await apiFetch<{ checklist: ChecklistTemplateDTO }>(
          "/api/playbook/checklists/install-global",
          { method: "POST" },
        )
      ).checklist,
    onSuccess: () => invalidatePlaybook(qc),
  });
}

export function useInstallExampleRules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (
        await apiFetch<{ added: number }>(
          "/api/playbook/rules/install-examples",
          { method: "POST" },
        )
      ).added,
    onSuccess: () => invalidatePlaybook(qc),
  });
}

// ── Review: playbook match ───────────────────────────────────────────────────

export function useSetPlaybookMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      tradeId: string;
      playbookMatch: "MATCHED" | "PARTIAL" | "OFF_PLAYBOOK";
    }) =>
      await apiFetch<{ playbookMatch: string }>(
        `/api/trades/${args.tradeId}/playbook-match`,
        {
          method: "POST",
          body: JSON.stringify({ playbookMatch: args.playbookMatch }),
        },
      ),
    onSuccess: (_v, args) => {
      void qc.invalidateQueries({ queryKey: ["trade", args.tradeId] });
      void qc.invalidateQueries({ queryKey: ["trades"] });
      void qc.invalidateQueries({ queryKey: ["playbook"] });
    },
  });
}
