"use client";

/**
 * v3 Phase 5 — Invitation landing page, /invitation/{token}: shows who
 * invites and the granted permissions, then accept (requires a reserved
 * handle — link to the mentors settings when missing) or decline.
 */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import {
  CheckCircle2,
  GraduationCap,
  Loader2,
  MailQuestion,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";
import { navigate } from "@/lib/router";
import { useSession } from "@/components/app/session-context";
import type { ReceivedInvitationDTO } from "@/lib/mentor/dto";

export function InvitationView({ token }: { token: string }) {
  const t = useTranslations("invitation");
  const tMentors = useTranslations("mentors");
  const { session } = useSession();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = React.useState<"ACCEPT" | "DECLINE" | null>(null);
  const [done, setDone] = React.useState<"ACCEPT" | "DECLINE" | null>(null);

  const preview = useQuery({
    queryKey: ["invitation-preview", token],
    queryFn: () =>
      apiFetch<{ invitation: ReceivedInvitationDTO }>(
        `/api/mentor/invitations/${encodeURIComponent(token)}`
      ),
    retry: false,
    enabled: done === null,
  });

  const hasHandle = session?.profile.handle != null;

  async function act(action: "ACCEPT" | "DECLINE"): Promise<void> {
    setBusy(action);
    try {
      await apiFetch(`/api/mentor/invitations/${encodeURIComponent(token)}`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      setDone(action);
      await queryClient.invalidateQueries({ queryKey: ["mentor-space"] });
      toast({
        title: action === "ACCEPT" ? t("accepted") : t("declined"),
      });
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof ApiClientError ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="text-center">
        <MailQuestion
          className="mx-auto h-10 w-10 text-emerald-600 dark:text-emerald-400"
          aria-hidden="true"
        />
        <h2 className="mt-2 text-lg font-semibold tracking-tight">
          {t("title")}
        </h2>
      </div>

      {done === "ACCEPT" ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <CheckCircle2
              className="h-10 w-10 text-emerald-600 dark:text-emerald-400"
              aria-hidden="true"
            />
            <p className="text-sm text-muted-foreground">{t("accepted")}</p>
            <Button onClick={() => navigate("/mentor")}>
              <GraduationCap className="h-4 w-4" aria-hidden="true" />
              {t("goToMentorSpace")}
            </Button>
          </CardContent>
        </Card>
      ) : done === "DECLINE" ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <XCircle className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">{t("declined")}</p>
          </CardContent>
        </Card>
      ) : preview.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
        </div>
      ) : preview.error ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t("invalid")}
          </CardContent>
        </Card>
      ) : preview.data ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("desc", { name: preview.data.invitation.ownerDisplayName })}
            </CardTitle>
            <CardDescription>
              {t("expires", {
                date: format(
                  new Date(preview.data.invitation.expiresAt),
                  "d MMM yyyy HH:mm"
                ),
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">{t("granted")}</p>
              <div className="flex flex-wrap gap-1.5">
                <Perm on={preview.data.invitation.permissions.canViewAmounts} label={tMentors("permAmounts")} />
                <Perm on={preview.data.invitation.permissions.canViewJournal} label={tMentors("permJournal")} />
                <Perm on={preview.data.invitation.permissions.canViewScreenshots} label={tMentors("permScreenshots")} />
                <Perm on={preview.data.invitation.permissions.canViewAnalytics} label={tMentors("permAnalytics")} />
                <Perm on={preview.data.invitation.permissions.canComment} label={tMentors("permComment")} />
              </div>
            </div>

            {!hasHandle && (
              <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                {t("requiresHandle")}{" "}
                <button
                  type="button"
                  className="font-medium underline underline-offset-2"
                  onClick={() => navigate("/settings/mentors")}
                >
                  {t("goToHandle")}
                </button>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => void act("ACCEPT")}
                disabled={busy !== null || !hasHandle}
              >
                {busy === "ACCEPT" ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                )}
                {t("accept")}
              </Button>
              <Button
                variant="outline"
                onClick={() => void act("DECLINE")}
                disabled={busy !== null}
              >
                <XCircle className="h-4 w-4" aria-hidden="true" />
                {t("decline")}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Perm({ on, label }: { on: boolean; label: string }) {
  return (
    <Badge
      variant="outline"
      className={
        on
          ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
          : "text-muted-foreground line-through"
      }
    >
      {label}
    </Badge>
  );
}
