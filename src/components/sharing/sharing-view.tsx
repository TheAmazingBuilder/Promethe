"use client";

/**
 * v3 — Sharing management view (/settings/sharing).
 *
 * Lists every public link with its true status (owner-only), view counts,
 * expiry and one-click revocation. Report sharing is created here; trade
 * sharing is created from the trade detail sheet.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import {
  Link2,
  Loader2,
  Plus,
  ShieldCheck,
  Share2,
  BarChart3,
  Eye,
  EyeOff,
  Zap,
  Camera,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageHeader } from "@/components/ui/page-header";
import { QueryErrorState } from "@/components/ui/query-error-state";
import { useToast } from "@/hooks/use-toast";
import { useAccounts } from "@/hooks/use-trading";
import {
  useRevokeShareLink,
  useShareLinks,
  type ShareLink,
} from "@/hooks/use-sharing";
import { ShareDialog } from "@/components/sharing/share-dialog";
import { policySummary } from "@/lib/sharing/status";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<ShareLink["status"], string> = {
  ACTIVE: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  EXPIRED: "border-muted bg-muted/40 text-muted-foreground",
  REVOKED: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400",
  VIEW_LIMIT: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
};

function statusIcon(status: ShareLink["status"]) {
  switch (status) {
    case "ACTIVE":
      return <Eye className="h-3 w-3" aria-hidden="true" />;
    case "REVOKED":
      return <EyeOff className="h-3 w-3" aria-hidden="true" />;
    default:
      return null;
  }
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

function LinkRow({
  link,
  onRevoke,
  revoking,
}: {
  link: ShareLink;
  onRevoke: (id: string) => void;
  revoking: boolean;
}) {
  const t = useTranslations("sharing");
  const statusKey: Record<ShareLink["status"], string> = {
    ACTIVE: "statusActive",
    EXPIRED: "statusExpired",
    REVOKED: "statusRevoked",
    VIEW_LIMIT: "statusViewLimit",
  };
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            {link.type === "REPORT" ? (
              <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            ) : (
              <Zap className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            )}
            {link.title}
          </span>
          <Badge variant="outline" className={cn("gap-1 text-[10px]", STATUS_STYLE[link.status])}>
            {statusIcon(link.status)}
            {t(statusKey[link.status])}
          </Badge>
          <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
            {link.mode === "LIVE" ? `● ${t("modeLive")}` : `▣ ${t("modeSnapshot")}`}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {link.type === "TRADE" ? t("typeTrade") : t("typeReport")} ·{" "}
          {link.tokenPrefix}… · {policySummary(link.policy)}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {t("colViews")} : {link.viewCount}
          {link.maxViews !== null ? ` / ${link.maxViews}` : ""} ·{" "}
          {t("colExpiry")} : {fmtDateTime(link.expiresAt)} ·{" "}
          {t("colLastViewed")} :{" "}
          {link.lastViewedAt ? fmtDateTime(link.lastViewedAt) : t("neverViewed")}
        </p>
      </div>
      {link.status === "ACTIVE" && (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 text-destructive hover:text-destructive"
          onClick={() => onRevoke(link.id)}
          disabled={revoking}
        >
          {revoking ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {t("revoke")}
        </Button>
      )}
    </div>
  );
}

export function SharingView() {
  const t = useTranslations("sharing");
  const tCommon = useTranslations("common");
  const { toast } = useToast();
  const linksQuery = useShareLinks();
  const accountsQuery = useAccounts();
  const revoke = useRevokeShareLink();

  const [createOpen, setCreateOpen] = React.useState(false);
  const [revokeTarget, setRevokeTarget] = React.useState<ShareLink | null>(null);

  const links = linksQuery.data ?? [];
  const accounts = (accountsQuery.data ?? []).map((a) => ({ id: a.id, name: a.name }));

  const confirmRevoke = () => {
    if (!revokeTarget) return;
    revoke.mutate(revokeTarget.id, {
      onSuccess: () => toast({ title: t("revokeToast") }),
      onSettled: () => setRevokeTarget(null),
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        descriptionClassName="max-w-xl"
      />

      {/* Create report share */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4" aria-hidden="true" />
            {t("createCard")}
          </CardTitle>
          <CardDescription>{t("createCardDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {accountsQuery.isError ? (
            <QueryErrorState
              title="Unable to load trading accounts"
              description="Report sharing is paused until account data loads, so you do not accidentally share a broader report than intended."
              onRetry={() => void accountsQuery.refetch()}
            />
          ) : (
            <Button onClick={() => setCreateOpen(true)} disabled={accountsQuery.isLoading}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t("newLink")}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Links list */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="h-4 w-4" aria-hidden="true" />
            {t("listTitle")}
            {linksQuery.isLoading && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden="true" />
            )}
          </CardTitle>
          <CardDescription>{t("tokenNote")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {linksQuery.isError ? (
            <QueryErrorState
              title="Unable to load shared links"
              description="Your existing share links have not been changed. Retry to load them again."
              onRetry={() => void linksQuery.refetch()}
            />
          ) : linksQuery.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : links.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Share2 className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-medium">{t("listEmpty")}</p>
              <p className="max-w-sm text-xs text-muted-foreground">{t("listEmptyHint")}</p>
            </div>
          ) : (
            <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
              {links.map((link) => (
                <LinkRow
                  key={link.id}
                  link={link}
                  onRevoke={(id) => {
                    const target = links.find((l) => l.id === id) ?? null;
                    setRevokeTarget(target);
                  }}
                  revoking={revoke.isPending && revokeTarget?.id === link.id}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Security model */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            {t("securityCard")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
              {t("securityItem1")}
            </li>
            <li className="flex gap-2">
              <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
              {t("securityItem2")}
            </li>
            <li className="flex gap-2">
              <Camera className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
              {t("securityItem3")}
            </li>
            <li className="flex gap-2">
              <Eye className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
              {t("securityItem4")}
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* Report share dialog */}
      <ShareDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        report={{ accounts }}
        defaultTitle={"Performance report"}
      />

      {/* Revoke confirmation */}
      <AlertDialog open={revokeTarget !== null} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("revokeConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("revokeConfirmBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRevoke}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("revoke")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
