"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { ManualEconomicEventInput, WatchlistPrefsInput } from "@/lib/validations/economic-calendar";
import type {
  EconomicCalendarSourceDTO,
  EconomicCalendarSyncReport,
  EconomicEventDTO,
  TradeEventContextDTO,
  TradeEventLinkDTO,
  WatchlistPrefsDTO,
} from "@/server/economic-calendar";

export type { EconomicCalendarSourceDTO, EconomicEventDTO, TradeEventContextDTO, WatchlistPrefsDTO };

export interface EconomicCalendarListResponse {
  events: EconomicEventDTO[];
}

export interface EconomicCalendarDetailResponse {
  event: EconomicEventDTO;
  trades: TradeEventLinkDTO[];
}

const BASE = "/api/v1/economic-calendar";

export function useEconomicCalendarEvents(filters: {
  from?: string;
  to?: string;
  currencies?: string[];
  countries?: string[];
  impacts?: string[];
  categories?: string[];
  sources?: string[];
  watchlistOnly?: boolean;
}) {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.currencies?.length) params.set("currencies", filters.currencies.join(","));
  if (filters.countries?.length) params.set("countries", filters.countries.join(","));
  if (filters.impacts?.length) params.set("impacts", filters.impacts.join(","));
  if (filters.categories?.length) params.set("categories", filters.categories.join(","));
  if (filters.sources?.length) params.set("sources", filters.sources.join(","));
  if (filters.watchlistOnly) params.set("watchlistOnly", "true");
  const query = params.toString();
  return useQuery({
    queryKey: ["economic-calendar", "events", query],
    queryFn: () => apiFetch<EconomicCalendarListResponse>(`${BASE}?${query}`),
  });
}

export function useEconomicCalendarEvent(id: string | null) {
  return useQuery({
    queryKey: ["economic-calendar", "event", id],
    queryFn: () => apiFetch<EconomicCalendarDetailResponse>(`${BASE}/${id}`),
    enabled: id != null,
  });
}

export function useEconomicCalendarSources() {
  return useQuery({
    queryKey: ["economic-calendar", "sources"],
    queryFn: () => apiFetch<{ sources: EconomicCalendarSourceDTO[] }>(`${BASE}/sync`),
  });
}

export function useSyncEconomicCalendar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (force: boolean = false) =>
      apiFetch<{ report: EconomicCalendarSyncReport }>(`${BASE}/sync`, {
        method: "POST",
        body: JSON.stringify({ force }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["economic-calendar"] });
    },
  });
}

export function useWatchlistPrefs() {
  return useQuery({
    queryKey: ["economic-calendar", "watchlist"],
    queryFn: () => apiFetch<{ prefs: WatchlistPrefsDTO }>(`${BASE}/watchlist`),
  });
}

export function useUpdateWatchlistPrefs() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: WatchlistPrefsInput) =>
      apiFetch<{ prefs: WatchlistPrefsDTO }>(`${BASE}/watchlist`, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["economic-calendar"] });
    },
  });
}

export function useCreateManualEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ManualEconomicEventInput) =>
      apiFetch<{ event: EconomicEventDTO }>(BASE, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["economic-calendar"] });
    },
  });
}

export function useUpdateManualEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ManualEconomicEventInput }) =>
      apiFetch<{ event: EconomicEventDTO }>(`${BASE}/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["economic-calendar"] });
    },
  });
}

export function useDeleteManualEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ deleted: boolean }>(`${BASE}/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["economic-calendar"] });
    },
  });
}

export function useLinkEventToTrade() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tradeId, eventId }: { tradeId: string; eventId: string }) =>
      apiFetch<{ link: TradeEventLinkDTO }>(`${BASE}/links`, {
        method: "POST",
        body: JSON.stringify({ tradeId, eventId }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["economic-calendar"] });
    },
  });
}

export function useUnlinkEventFromTrade() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tradeId, eventId }: { tradeId: string; eventId: string }) =>
      apiFetch<{ unlinked: boolean }>(
        `${BASE}/links?tradeId=${encodeURIComponent(tradeId)}&eventId=${encodeURIComponent(eventId)}`,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["economic-calendar"] });
    },
  });
}

export function useTradeEventContext(tradeId: string | null) {
  return useQuery({
    queryKey: ["economic-calendar", "trade-context", tradeId],
    queryFn: () => apiFetch<{ context: TradeEventContextDTO }>(`${BASE}/trade/${tradeId}`),
    enabled: tradeId != null,
  });
}
