"use client";

/**
 * v3 Phase 5 — Mentor space home, /mentor: mentee cards (new trades,
 * unreviewed, unread comments badges) + received invitations
 * (accept requires a reserved handle).
 */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import {
  ArrowRight,
  CheckCircle2,
  GraduationCap,
  Inbox,
  Loader2,
  MessageSquare,
  Sparkles,
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
import { useMentorHome } from "@/components/app/nav-list";
import type { MenteeSummaryDTO, ReceivedInvitationDTO } from "@/lib/mentor/dto";

export function MentorView() {
  const t = useTranslations("mentorSpace");
  const { session } = useSession();
  const home = useMentorHome();

  const pendingInvites = (home.data?.invitations ?? []).filter(
    (i) => i.status === "PENDING"
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <GraduationCap className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          {t("title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {home.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
        </div>
      ) : home.error ? (
        <p className="text-sm text-rose-600 dark:text-rose-400">
          {home.error instanceof Error ? home.error.message : "-"}
        </p>
      ) : (
        <>
          {pendingInvites.length > 0 && (
            <InvitationsCard invitations={pendingInvites} hasHandle={session?.profile.handle != null} />
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("mentees")}</CardTitle>
              {home.data && home.data.mentees.length === 0 && (
                <CardDescription>{t("menteesEmpty")}</CardDescription>
              )}
            </CardHeader>
            <CardContent>
              {home.data && home.data.mentees.length > 0 ? (
                <ul className="space-y-2.5">
                  {home.data.mentees.map((mentee) => (
                    <li key={mentee.ownerId}>
                      <button
                        type="button"
                        onClick={() => navigate(`/mentor/${mentee.ownerId}`)}
                        className="flex w-full flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-accent"
                      >
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                            {mentee.ownerDisplayName}
                            {mentee.ownerHandle && (
                              <span className="font-mono text-xs text-emerald-700 dark:text-emerald-400">
                                @{mentee.ownerHandle}
                              </span>
                            )}
                            {!mentee.permissions.canViewAmounts && (
                              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                                {t("amountsHidden")}
                              </Badge>
                            )}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {t("lastVisit")} :{" "}
                            {mentee.lastViewedAt
                              ? format(new Date(mentee.lastViewedAt), "d MMM yyyy HH:mm")
                              : "-"}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {mentee.newTradesSince > 0 && (
                            <Badge className="bg-emerald-600 text-white">
                              <Sparkles className="mr-1 h-3 w-3" aria-hidden="true" />
                              {t("newTrades", { count: mentee.newTradesSince })}
                            </Badge>
                          )}
                          {mentee.unreviewedCount > 0 && (
                            <Badge variant="secondary">
                              {t("toReview", { count: mentee.unreviewedCount })}
                            </Badge>
                          )}
                          {mentee.unreadComments > 0 && (
                            <Badge variant="secondary">
                              <MessageSquare className="mr-1 h-3 w-3" aria-hidden="true" />
                              {t("unreadComments", { count: mentee.unreadComments })}
                            </Badge>
                          )}
                          <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                !home.data?.invitations.length && (
                  <div className="flex flex-col items-center gap-2 py-8 text-center">
                    <Inbox className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
                    <p className="text-sm text-muted-foreground">{t("menteesEmpty")}</p>
                  </div>
                )
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function InvitationsCard({
  invitations,
  hasHandle,
}: {
  invitations: ReceivedInvitationDTO[];
  hasHandle: boolean;
}) {
  const t = useTranslations("mentorSpace");
  const tMentors = useTranslations("mentors");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = React.useState<string | null>(null);

  async function act(token: string, action: "ACCEPT" | "DECLINE"): Promise<void> {
    setBusy(token);
    try {
      if (action === "ACCEPT") {
        await apiFetch(`/api/mentor/invitations/${encodeURIComponent(token)}`, {
          method: "POST",
          body: JSON.stringify({ action }),
        });
        toast({ title: t("accepted") });
      } else {
        await apiFetch(`/api/mentor/invitations/${encodeURIComponent(token)}`, {
          method: "POST",
          body: JSON.stringify({ action }),
        });
        toast({ title: t("declined") });
      }
      await queryClient.invalidateQueries({ queryKey: ["mentor-space"] });
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
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("invitations")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {invitations.map((invitation) => (
          <div
            key={invitation.id}
            className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3 py-2.5"
          >
            <p className="text-sm">
              {t("from")}{" "}
              <span className="font-medium">
                {invitation.ownerDisplayName}
                {invitation.ownerHandle && (
                  <span className="font-mono text-xs text-emerald-700 dark:text-emerald-400">
                    {" "}
                    @{invitation.ownerHandle}
                  </span>
                )}
              </span>
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
              <Perm on={invitation.permissions.canViewAmounts} label={tMentors("permAmounts")} />
              <Perm on={invitation.permissions.canViewJournal} label={tMentors("permJournal")} />
              <Perm on={invitation.permissions.canViewScreenshots} label={tMentors("permScreenshots")} />
              <Perm on={invitation.permissions.canViewAnalytics} label={tMentors("permAnalytics")} />
              <Perm on={invitation.permissions.canComment} label={tMentors("permComment")} />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {t("expires")} :{" "}
              {invitation.permissions.expiresAt
                ? format(new Date(invitation.permissions.expiresAt), "d MMM yyyy")
                : t("noExpiry")}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={busy === invitation.id || !hasHandle}
                onClick={() => void act(invitation.id, "ACCEPT")}
                title={!hasHandle ? t("requiresHandle") : undefined}
              >
                {busy === invitation.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {t("accept")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy === invitation.id}
                onClick={() => void act(invitation.id, "DECLINE")}
              >
                <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                {t("decline")}
              </Button>
              {!hasHandle && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => navigate("/settings/mentors")}
                >
                  {t("requiresHandle")}
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
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
