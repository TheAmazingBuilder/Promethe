"use client";

/**
 * v3 — Share link hooks (list / create / revoke).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type {
  CreatedShareLink,
  ShareLinkDTO,
} from "@/lib/sharing/types";
import type { ShareLinkInput } from "@/lib/validations/sharing";

export type ShareLink = ShareLinkDTO;

export function useShareLinks() {
  return useQuery({
    queryKey: ["share-links"],
    queryFn: () =>
      apiFetch<{ links: ShareLink[] }>("/api/share-links").then((d) => d.links),
  });
}

export function useCreateShareLink() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ShareLinkInput) =>
      apiFetch<CreatedShareLink>("/api/share-links", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["share-links"] });
    },
  });
}

export function useRevokeShareLink() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ revoked: boolean }>(`/api/share-links/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["share-links"] });
    },
  });
}
