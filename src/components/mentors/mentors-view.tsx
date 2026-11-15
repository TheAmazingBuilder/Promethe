"use client";

/**
 * v3 Phase 5 — Mentors management (owner side), #/reglages/mentors.
 *
 * Handle reservation, invitation creation (link shown ONCE), active accesses
 * (scope edit / pause / revoke — immediate effect), pending invitations and
 * the aggregated per-day access log (privacy transparency).
 */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import {
  Copy,
  Eye,
  Loader2,
  PauseCircle,
  PlayCircle,
  Users,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "@/components/app/session-context";
import type { SessionPayload } from "@/lib/auth/types";
import type {
  MentorAccessDTO,
  MentorAccessLogDTO,
  MentorInvitationDTO,
  MentorPermissionsDTO,
} from "@/lib/mentor/dto";
import {
  DEFAULT_PERMISSIONS,
  PermissionsEditor,
  type RefOption,
} from "./permissions-editor";

interface MentorsOverview {
  accesses: MentorAccessDTO[];
  invitations: MentorInvitationDTO[];
  logs: MentorAccessLogDTO[];
  handle: string | null;
  suggestedHandle: string;
}

export function MentorsView() {
  const t = useTranslations("mentors");
  const tCommon = useTranslations("common");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const overview = useQuery({
    queryKey: ["mentors-overview"],
    queryFn: () => apiFetch<MentorsOverview>("/api/mentors"),
  });

  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: () =>
      apiFetch<{ accounts: RefOption[] }>("/api/accounts"),
  });
  const strategies = useQuery({
    queryKey: ["strategies"],
    queryFn: () =>
      apiFetch<{ strategies: RefOption[] }>("/api/strategies"),
  });

  function refresh(): void {
    void queryClient.invalidateQueries({ queryKey: ["mentors-overview"] });
    void queryClient.invalidateQueries({ queryKey: ["mentor-space"] });
  }

  const accountOptions = accounts.data?.accounts ?? [];
  const strategyOptions = strategies.data?.strategies ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Users className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          {t("title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {overview.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
        </div>
      ) : overview.error ? (
        <p className="text-sm text-rose-600 dark:text-rose-400">
          {overview.error instanceof Error ? overview.error.message : tCommon("retry")}
        </p>
      ) : overview.data ? (
        <>
          <HandleCard overview={overview.data} onSaved={refresh} />
          <InviteCard
            hasHandle={overview.data.handle !== null}
            accounts={accountOptions}
            strategies={strategyOptions}
            onInvited={refresh}
          />
          <PendingInvitationsCard
            invitations={overview.data.invitations.filter(
              (i) => i.status === "PENDING"
            )}
            onChanged={refresh}
          />
          <AccessesCard
            accesses={overview.data.accesses}
            accounts={accountOptions}
            strategies={strategyOptions}
            onChanged={refresh}
          />
          <AccessLogCard logs={overview.data.logs} />
        </>
      ) : null}
    </div>
  );
}

// ── handle ───────────────────────────────────────────────────────────────────

function HandleCard({
  overview,
  onSaved,
}: {
  overview: MentorsOverview;
  onSaved: () => void;
}) {
  const t = useTranslations("mentors");
  const { toast } = useToast();
  const { setSession } = useSession();
  const [handle, setHandle] = React.useState("");
  const [publicName, setPublicName] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!handle && overview.suggestedHandle) {
      setHandle(overview.suggestedHandle);
    }
  }, [overview.suggestedHandle, handle]);

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const updated = await apiFetch<SessionPayload>("/api/profile/handle", {
        method: "PUT",
        body: JSON.stringify({
          handle: handle.trim().toLowerCase(),
          ...(publicName.trim() ? { publicDisplayName: publicName.trim() } : {}),
        }),
      });
      setSession(updated);
      toast({ title: t("handleSaved") });
      onSaved();
    } catch (error) {
      toast({
        title: "Erreur",
        description:
          error instanceof ApiClientError ? error.message : "Réessayez.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("handleTitle")}</CardTitle>
        <CardDescription>{t("handleDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {overview.handle && (
          <p className="text-sm">
            {t("handleCurrent")} :{" "}
            <span className="font-mono font-medium text-emerald-700 dark:text-emerald-400">
              @{overview.handle}
            </span>
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="mentor-handle">{t("handlePlaceholder")}</Label>
            <Input
              id="mentor-handle"
              value={handle}
              onChange={(e) => setHandle(e.target.value.toLowerCase())}
              placeholder="alice_fx"
              maxLength={24}
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mentor-public-name">{t("handlePublicName")}</Label>
            <Input
              id="mentor-public-name"
              value={publicName}
              onChange={(e) => setPublicName(e.target.value)}
              placeholder={t("handlePublicNamePlaceholder")}
              maxLength={60}
            />
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => void save()}
          disabled={saving || handle.trim().length < 3}
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            t("handleSave")
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

// ── invite ───────────────────────────────────────────────────────────────────

function InviteCard({
  hasHandle,
  accounts,
  strategies,
  onInvited,
}: {
  hasHandle: boolean;
  accounts: RefOption[];
  strategies: RefOption[];
  onInvited: () => void;
}) {
  const t = useTranslations("mentors");
  const { toast } = useToast();
  const [email, setEmail] = React.useState("");
  const [permissions, setPermissions] =
    React.useState<MentorPermissionsDTO>(DEFAULT_PERMISSIONS);
  const [sending, setSending] = React.useState(false);
  const [createdUrl, setCreatedUrl] = React.useState<string | null>(null);

  async function submit(): Promise<void> {
    setSending(true);
    try {
      const result = await apiFetch<{ inviteUrl: string }>("/api/mentors", {
        method: "POST",
        body: JSON.stringify({ email: email.trim().toLowerCase(), permissions }),
      });
      setCreatedUrl(result.inviteUrl);
      setEmail("");
      onInvited();
      toast({ title: t("inviteCreated") });
    } catch (error) {
      toast({
        title: "Erreur",
        description:
          error instanceof ApiClientError ? error.message : "Réessayez.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("inviteTitle")}</CardTitle>
        <CardDescription>{t("inviteDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {createdUrl && (
          <div className="space-y-2 rounded-md border border-emerald-500/50 bg-emerald-500/10 p-3">
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
              {t("inviteLinkLabel")}
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1.5 font-mono text-xs">
                {createdUrl}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(createdUrl);
                  toast({ title: t("copied") });
                }}
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                {t("copyLink")}
              </Button>
            </div>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="invite-email">{t("inviteEmail")}</Label>
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("inviteEmailPlaceholder")}
            maxLength={254}
          />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">{t("invitePermissions")}</p>
          <PermissionsEditor
            value={permissions}
            onChange={setPermissions}
            accounts={accounts}
            strategies={strategies}
          />
        </div>
        <Button
          onClick={() => void submit()}
          disabled={
            sending ||
            !hasHandle ||
            !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())
          }
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            t("inviteSubmit")
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

// ── pending invitations ──────────────────────────────────────────────────────

function PendingInvitationsCard({
  invitations,
  onChanged,
}: {
  invitations: MentorInvitationDTO[];
  onChanged: () => void;
}) {
  const t = useTranslations("mentors");
  const { toast } = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);

  async function revoke(id: string): Promise<void> {
    setBusy(id);
    try {
      await apiFetch(`/api/mentors/invitations/${id}`, { method: "DELETE" });
      onChanged();
    } catch (error) {
      toast({
        title: "Erreur",
        description:
          error instanceof ApiClientError ? error.message : "Réessayez.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("pending")}</CardTitle>
      </CardHeader>
      <CardContent>
        {invitations.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("pendingEmpty")}</p>
        ) : (
          <ul className="space-y-2">
            {invitations.map((invitation) => (
              <li
                key={invitation.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{invitation.inviteeEmail}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("expires")}{" "}
                    {format(new Date(invitation.expiresAt), "d MMM yyyy HH:mm")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{t("statusPENDING")}</Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === invitation.id}
                    onClick={() => void revoke(invitation.id)}
                  >
                    {busy === invitation.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {t("revokeInvite")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ── accesses ─────────────────────────────────────────────────────────────────

function AccessesCard({
  accesses,
  accounts,
  strategies,
  onChanged,
}: {
  accesses: MentorAccessDTO[];
  accounts: RefOption[];
  strategies: RefOption[];
  onChanged: () => void;
}) {
  const t = useTranslations("mentors");
  const [editing, setEditing] = React.useState<MentorAccessDTO | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("accesses")}</CardTitle>
      </CardHeader>
      <CardContent>
        {accesses.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("accessesEmpty")}</p>
        ) : (
          <ul className="space-y-2">
            {accesses.map((access) => (
              <li
                key={access.id}
                className="rounded-md border px-3 py-2.5"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {access.mentorDisplayName}
                      {access.mentorHandle && (
                        <span className="font-mono text-xs text-emerald-700 dark:text-emerald-400">
                          @{access.mentorHandle}
                        </span>
                      )}
                      <Badge
                        variant={
                          access.status === "ACTIVE" ? "default" : "secondary"
                        }
                        className={
                          access.status === "ACTIVE"
                            ? "bg-emerald-600 text-white"
                            : undefined
                        }
                      >
                        {t(`status${access.status}`)}
                      </Badge>
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t("lastViewed")} :{" "}
                      {access.lastViewedAt
                        ? format(new Date(access.lastViewedAt), "d MMM yyyy HH:mm")
                        : t("never")}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <PermBadge on={access.permissions.canViewAmounts} label={t("permAmounts")} />
                      <PermBadge on={access.permissions.canViewJournal} label={t("permJournal")} />
                      <PermBadge on={access.permissions.canViewScreenshots} label={t("permScreenshots")} />
                      <PermBadge on={access.permissions.canViewAnalytics} label={t("permAnalytics")} />
                      <PermBadge on={access.permissions.canComment} label={t("permComment")} />
                    </div>
                  </div>
                  <AccessActions
                    access={access}
                    onEdit={() => setEditing(access)}
                    onChanged={onChanged}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {editing && (
        <EditAccessDialog
          access={editing}
          accounts={accounts}
          strategies={strategies}
          onClose={() => setEditing(null)}
          onChanged={onChanged}
        />
      )}
    </Card>
  );
}

function PermBadge({ on, label }: { on: boolean; label: string }) {
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

function AccessActions({
  access,
  onEdit,
  onChanged,
}: {
  access: MentorAccessDTO;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations("mentors");
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);

  async function patch(body: Record<string, unknown>): Promise<void> {
    setBusy(true);
    try {
      await apiFetch(`/api/mentors/${access.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      onChanged();
    } catch (error) {
      toast({
        title: "Erreur",
        description:
          error instanceof ApiClientError ? error.message : "Réessayez.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function revoke(): Promise<void> {
    setBusy(true);
    try {
      await apiFetch(`/api/mentors/${access.id}`, { method: "DELETE" });
      onChanged();
    } catch (error) {
      toast({
        title: "Erreur",
        description:
          error instanceof ApiClientError ? error.message : "Réessayez.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" variant="outline" onClick={onEdit} disabled={busy}>
        {t("edit")}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() =>
          void patch({ status: access.status === "PAUSED" ? "ACTIVE" : "PAUSED" })
        }
      >
        {access.status === "PAUSED" ? (
          <PlayCircle className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <PauseCircle className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {access.status === "PAUSED" ? t("resume") : t("pause")}
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="text-rose-600 dark:text-rose-400"
        disabled={busy}
        onClick={() => void revoke()}
      >
        <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
        {t("revoke")}
      </Button>
    </div>
  );
}

function EditAccessDialog({
  access,
  accounts,
  strategies,
  onClose,
  onChanged,
}: {
  access: MentorAccessDTO;
  accounts: RefOption[];
  strategies: RefOption[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations("mentors");
  const tCommon = useTranslations("common");
  const { toast } = useToast();
  const [permissions, setPermissions] = React.useState<MentorPermissionsDTO>(
    access.permissions
  );
  const [saving, setSaving] = React.useState(false);

  async function save(): Promise<void> {
    setSaving(true);
    try {
      await apiFetch(`/api/mentors/${access.id}`, {
        method: "PATCH",
        body: JSON.stringify({ permissions }),
      });
      onChanged();
      onClose();
    } catch (error) {
      toast({
        title: "Erreur",
        description:
          error instanceof ApiClientError ? error.message : "Réessayez.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("edit")} — {access.mentorDisplayName}
          </DialogTitle>
          <DialogDescription>{t("invitePermissions")}</DialogDescription>
        </DialogHeader>
        <PermissionsEditor
          value={permissions}
          onChange={setPermissions}
          accounts={accounts}
          strategies={strategies}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tCommon("cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : null}
            {tCommon("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── access log ───────────────────────────────────────────────────────────────

function AccessLogCard({ logs }: { logs: MentorAccessLogDTO[] }) {
  const t = useTranslations("mentors");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Eye className="h-4 w-4" aria-hidden="true" />
          {t("logs")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("logsEmpty")}</p>
        ) : (
          <div className="max-h-72 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("logsMentor")}</TableHead>
                  <TableHead>{t("logsResource")}</TableHead>
                  <TableHead>{t("logsDay")}</TableHead>
                  <TableHead className="text-right">{t("logsViews")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log, index) => (
                  <TableRow key={`${log.mentorHandle}-${log.resourceType}-${log.day}-${index}`}>
                    <TableCell className="font-medium">
                      {log.mentorDisplayName}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {t(`resource${log.resourceType}`)}
                    </TableCell>
                    <TableCell className="tabular-nums">{log.day}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {log.viewCount}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
