"use client";

/**
 * v3 — Broker sync hooks (connections, symbol/magic mappings, overview).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { BrokerConnectionDTO, CreatedConnection, MagicMappingDTO, SymbolMappingDTO, SyncOverviewDTO } from "@/server/broker-sync";

// DTO types are server-side interfaces — re-exported here as client-safe
// (they are plain JSON shapes; the import is type-only and erased at build).
export type BrokerConnection = BrokerConnectionDTO;
export type MagicMapping = MagicMappingDTO;
export type SymbolMapping = SymbolMappingDTO;
export type SyncOverview = SyncOverviewDTO;

export function useBrokerConnections() {
  return useQuery({
    queryKey: ["broker-sync", "connections"],
    queryFn: () =>
      apiFetch<{ connections: BrokerConnection[] }>("/api/broker-sync").then(
        (data) => data.connections
      ),
  });
}

export function useSyncOverview() {
  return useQuery({
    queryKey: ["broker-sync", "overview"],
    queryFn: () => apiFetch<SyncOverview>("/api/broker-sync/overview"),
    refetchInterval: 60_000, // live-ish status badges
  });
}

export function useCreateConnection() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { accountId: string; platform: "MT4" | "MT5"; label: string }) =>
      apiFetch<CreatedConnection>("/api/broker-sync", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["broker-sync"] });
    },
  });
}

export function useUpdateConnection() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...patch
    }: {
      id: string;
      label?: string;
      autoMergeEnabled?: boolean;
      historyBackfillFrom?: string | null;
      resetBinding?: boolean;
    }) =>
      apiFetch<{ connection: BrokerConnection }>(`/api/broker-sync/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["broker-sync"] });
    },
  });
}

export function useRotateConnection() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ connection: BrokerConnection; token: string }>(
        `/api/broker-sync/${id}/rotate`,
        { method: "POST" }
      ),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["broker-sync"] });
    },
  });
}

export function useRevokeConnection() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ connection: BrokerConnection }>(`/api/broker-sync/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["broker-sync"] });
    },
  });
}

export function useSymbolMappings() {
  return useQuery({
    queryKey: ["broker-sync", "symbols"],
    queryFn: () =>
      apiFetch<{ mappings: SymbolMapping[] }>("/api/broker-sync/symbols").then(
        (data) => data.mappings
      ),
  });
}

export function useUpsertSymbolMapping() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { brokerSymbol: string; instrumentId: string; pipSize?: string | null }) =>
      apiFetch<{ ok: true }>("/api/broker-sync/symbols", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["broker-sync", "symbols"] });
    },
  });
}

export function useMagicMappings() {
  return useQuery({
    queryKey: ["broker-sync", "magic"],
    queryFn: () =>
      apiFetch<{ mappings: MagicMapping[] }>("/api/broker-sync/magic").then(
        (data) => data.mappings
      ),
  });
}

export function useCreateMagicMapping() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { magicNumber: string; strategyId: string; connectionId?: string | null }) =>
      apiFetch<{ mapping: MagicMapping }>("/api/broker-sync/magic", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["broker-sync", "magic"] });
    },
  });
}

export function useDeleteMagicMapping() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: true }>(`/api/broker-sync/magic/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["broker-sync", "magic"] });
    },
  });
}
