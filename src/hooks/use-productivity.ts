"use client";

/**
 * React Query hooks for the v2.5 Module 4 productivity APIs: global
 * search, bulk trades + history/undo, custom fields, table columns and
 * keyboard shortcuts.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type {
  ChangeLogGroupDTO,
  CustomFieldDefinitionDTO,
  SearchPayload,
  ShortcutDTO,
  TableColumnPreferenceDTO,
} from "@/lib/trading/dto";
import type {
  BulkTradesInput,
  CustomFieldDefinitionInput,
  CustomFieldDefinitionPatch,
  TableColumnsInput,
} from "@/lib/validations/productivity";

// ── Global search ────────────────────────────────────────────────────────────

export function useGlobalSearch(query: string, limit = 8) {
  const q = query.trim();
  return useQuery({
    queryKey: ["search", q, limit],
    enabled: q.length >= 2,
    queryFn: async () =>
      apiFetch<SearchPayload>(
        `/api/search?q=${encodeURIComponent(q)}&limit=${limit}`
      ),
    staleTime: 30 * 1000,
  });
}

// ── Bulk trades + history ────────────────────────────────────────────────────

export interface BulkResult {
  groupId: string;
  count: number;
  action: "BULK_UPDATE" | "DELETE";
}

export function useBulkTrades() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: BulkTradesInput) =>
      apiFetch<BulkResult>("/api/trades/bulk", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["trades"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      void qc.invalidateQueries({ queryKey: ["history"] });
    },
  });
}

export function useHistory(limit = 50) {
  return useQuery({
    queryKey: ["history", limit],
    queryFn: async () =>
      (await apiFetch<{ groups: ChangeLogGroupDTO[] }>(`/api/history?limit=${limit}`))
        .groups,
  });
}

export function useUndoGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (groupId: string) =>
      apiFetch<{ restored: number }>(`/api/history/${groupId}/undo`, {
        method: "POST",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["trades"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      void qc.invalidateQueries({ queryKey: ["history"] });
    },
  });
}

/** Undo the latest still-undoable group (Cmd+Z). Returns null when none. */
export async function undoLatestGroup(): Promise<{ restored: number } | null> {
  const { groups } = await apiFetch<{ groups: ChangeLogGroupDTO[] }>(
    "/api/history?limit=20"
  );
  const now = new Date();
  const target = groups.find(
    (g) => !g.undoneAt && new Date(g.expiresAt) > now
  );
  if (!target) return null;
  return apiFetch<{ restored: number }>(`/api/history/${target.groupId}/undo`, {
    method: "POST",
  });
}

// ── Custom fields ────────────────────────────────────────────────────────────

export function useCustomFields(includeArchived = false) {
  return useQuery({
    queryKey: ["custom-fields", includeArchived],
    queryFn: async () =>
      (
        await apiFetch<{ definitions: CustomFieldDefinitionDTO[] }>(
          `/api/custom-fields${includeArchived ? "?archived=1" : ""}`
        )
      ).definitions,
  });
}

export function useCreateCustomField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CustomFieldDefinitionInput) =>
      (
        await apiFetch<{ definition: CustomFieldDefinitionDTO }>("/api/custom-fields", {
          method: "POST",
          body: JSON.stringify(input),
        })
      ).definition,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["custom-fields"] });
      void qc.invalidateQueries({ queryKey: ["trades"] });
    },
  });
}

export function useUpdateCustomField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: CustomFieldDefinitionPatch;
    }) =>
      (
        await apiFetch<{ definition: CustomFieldDefinitionDTO }>(
          `/api/custom-fields/${id}`,
          { method: "PATCH", body: JSON.stringify(patch) }
        )
      ).definition,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["custom-fields"] });
      void qc.invalidateQueries({ queryKey: ["trades"] });
    },
  });
}

export function useDeleteCustomField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiFetch(`/api/custom-fields/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["custom-fields"] });
      void qc.invalidateQueries({ queryKey: ["trades"] });
    },
  });
}

// ── Table columns ────────────────────────────────────────────────────────────

export function useTableColumns(tableKey: string) {
  return useQuery({
    queryKey: ["table-columns", tableKey],
    queryFn: async () =>
      (
        await apiFetch<{ preference: TableColumnPreferenceDTO | null }>(
          `/api/table-columns?tableKey=${encodeURIComponent(tableKey)}`
        )
      ).preference,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSaveTableColumns() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: TableColumnsInput) =>
      (
        await apiFetch<{ preference: TableColumnPreferenceDTO }>("/api/table-columns", {
          method: "PUT",
          body: JSON.stringify(input),
        })
      ).preference,
    onSuccess: (pref) =>
      void qc.invalidateQueries({ queryKey: ["table-columns", pref.tableKey] }),
  });
}

// ── Shortcuts ────────────────────────────────────────────────────────────────

export function useShortcuts() {
  return useQuery({
    queryKey: ["shortcuts"],
    queryFn: async () =>
      (await apiFetch<{ shortcuts: ShortcutDTO[] }>("/api/shortcuts")).shortcuts,
    staleTime: 10 * 60 * 1000,
  });
}

export function useUpsertShortcut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { actionId: string; keys: string }) =>
      (
        await apiFetch<{ shortcut: ShortcutDTO }>("/api/shortcuts", {
          method: "PUT",
          body: JSON.stringify(input),
        })
      ).shortcut,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["shortcuts"] }),
  });
}

export function useResetShortcuts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await apiFetch("/api/shortcuts", { method: "DELETE" });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["shortcuts"] }),
  });
}
