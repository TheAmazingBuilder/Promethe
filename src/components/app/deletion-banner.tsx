"use client";

/**
 * v3 Phase 6 — App-wide banner shown while an account deletion is PENDING
 * (7-day grace). Surfaced on every view, not just the settings page: a
 * scheduled destructive action must never be out of sight. One lightweight
 * query, refetched every 5 minutes.
 */
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import { CalendarClock, Loader2, XCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";

type DeletionState = {
  status: "PENDING" | "CANCELLED" | "COMPLETED";
  requestedAt: string;
  scheduledFor: string;
} | null;

export function DeletionBanner() {
  const t = useTranslations("account");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const deletion = useQuery({
    queryKey: ["account", "deletion"],
    queryFn: () => apiFetch<{ state: DeletionState }>("/api/account/deletion"),
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const cancel = useMutation({
    mutationFn: () =>
      apiFetch<{ state: DeletionState }>("/api/account/deletion", {
        method: "DELETE",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["account", "deletion"] });
      toast({ title: t("deletionCancelledToast") });
    },
  });

  if (deletion.data?.state?.status !== "PENDING") return null;
  const scheduledFor = deletion.data.state.scheduledFor;
  const days = Math.max(
    0,
    Math.ceil((new Date(scheduledFor).getTime() - Date.now()) / 86_400_000)
  );

  return (
    <Alert variant="destructive" className="mb-6">
      <CalendarClock className="h-4 w-4" aria-hidden="true" />
      <AlertTitle>
        {t("bannerTitle", {
          date: format(new Date(scheduledFor), "PPP"),
          days,
        })}
      </AlertTitle>
      <AlertDescription className="flex flex-wrap items-center gap-3">
        <span>{t("bannerDesc")}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => cancel.mutate()}
          disabled={cancel.isPending}
        >
          {cancel.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <XCircle className="h-4 w-4" aria-hidden="true" />
          )}
          {t("cancelButton")}
        </Button>
        <Link
          href="/settings/account"
          className="text-sm font-medium underline underline-offset-4"
        >
          {t("bannerLink")}
        </Link>
      </AlertDescription>
    </Alert>
  );
}
