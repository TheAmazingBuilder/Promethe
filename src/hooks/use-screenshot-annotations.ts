"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { ScreenshotAnnotation } from "@/lib/validations/screenshot-annotations";

export function useScreenshotAnnotations(screenshotId: string | null) {
  return useQuery({
    queryKey: ["screenshot-annotations", screenshotId],
    queryFn: () => apiFetch<{ annotations: ScreenshotAnnotation[] }>(
      `/api/v1/uploads/${screenshotId}/annotations`
    ),
    enabled: screenshotId != null,
    staleTime: 60_000,
  });
}

export function useSaveScreenshotAnnotations() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ screenshotId, annotations }: {
      screenshotId: string;
      annotations: ScreenshotAnnotation[];
    }) => apiFetch<{ annotations: ScreenshotAnnotation[] }>(
      `/api/v1/uploads/${screenshotId}/annotations`,
      { method: "PUT", body: JSON.stringify({ annotations }) }
    ),
    onSuccess: (result, variables) => {
      queryClient.setQueryData(
        ["screenshot-annotations", variables.screenshotId],
        result
      );
    },
  });
}
