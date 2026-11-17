"use client";

/**
 * v3 — Share dialog: create a public link for a TRADE or a REPORT period.
 *
 * The raw URL is displayed exactly ONCE (server stores only the token hash).
 * Policy presets: everything / pips & R only / custom toggles — the redaction
 * is applied server-side and hidden fields never reach the visitor.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { Check, Copy, ExternalLink, Link2, Loader2, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/i18n/i18n-provider";
import { useCreateShareLink } from "@/hooks/use-sharing";
import type { SharePolicyInput } from "@/lib/sharing/types";
import type { ShareLinkInput } from "@/lib/validations/sharing";
import { EXPIRY_OPTIONS, expiryLabel } from "@/lib/sharing/status";
import { cn } from "@/lib/utils";

export interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** TRADE sharing: the trade id. */
  tradeId?: string;
  /** REPORT sharing: when provided, the dialog shares a period instead. */
  report?: {
    accounts: Array<{ id: string; name: string }>;
  };
  defaultTitle?: string;
}

type Preset = "full" | "pips" | "custom";

const FULL: SharePolicyInput = {
  hideAmounts: false,
  hideAccountInfo: false,
  hideNotes: false,
  hideScreenshots: false,
  hideStrategyName: false,
  hideExactTimes: false,
  hidePsychology: false,
};

const PIPS_R: SharePolicyInput = {
  hideAmounts: true,
  hideAccountInfo: true,
  hideNotes: false,
  hideScreenshots: true,
  hideStrategyName: false,
  hideExactTimes: false,
  hidePsychology: false,
};

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoYtdStart(): string {
  return `${new Date().getUTCFullYear()}-01-01`;
}

type ExpiryDays = (typeof EXPIRY_OPTIONS)[number];

export function ShareDialog({
  open,
  onOpenChange,
  tradeId,
  report,
  defaultTitle,
}: ShareDialogProps) {
  const t = useTranslations("shareDialog");
  const { locale } = useI18n();
  const { toast } = useToast();
  const create = useCreateShareLink();

  const [title, setTitle] = React.useState(defaultTitle ?? "");
  const [mode, setMode] = React.useState<"SNAPSHOT" | "LIVE">("SNAPSHOT");
  const [preset, setPreset] = React.useState<Preset>("pips");
  const [policy, setPolicy] = React.useState<SharePolicyInput>({ ...PIPS_R });
  const [expiry, setExpiry] = React.useState<ExpiryDays>(30);
  const [maxViews, setMaxViews] = React.useState<string>("");
  const [periodPreset, setPeriodPreset] = React.useState<"30" | "90" | "365" | "ytd" | "custom">("30");
  const [customStart, setCustomStart] = React.useState(isoDaysAgo(30));
  const [customEnd, setCustomEnd] = React.useState(isoToday());
  const [accountId, setAccountId] = React.useState<string>("all");
  const [created, setCreated] = React.useState<{ url: string } | null>(null);
  const [copied, setCopied] = React.useState(false);

  // Reset each time the dialog opens.
  React.useEffect(() => {
    if (!open) return;
    setTitle(defaultTitle ?? "");
    setMode("SNAPSHOT");
    setPreset("pips");
    setPolicy({ ...PIPS_R });
    setExpiry(30);
    setMaxViews("");
    setPeriodPreset("30");
    setCustomStart(isoDaysAgo(30));
    setCustomEnd(isoToday());
    setAccountId("all");
    setCreated(null);
    setCopied(false);
    create.reset();
     
  }, [open, defaultTitle]);

  const applyPreset = (next: Preset) => {
    setPreset(next);
    setPolicy(next === "full" ? { ...FULL } : next === "pips" ? { ...PIPS_R } : { ...policy });
  };

  const setFlag = (flag: keyof SharePolicyInput, value: boolean) => {
    setPolicy((prev) => {
      const next = { ...prev, [flag]: value };
      // Detect whether we still match a preset.
      const matches = (candidate: SharePolicyInput) =>
        (Object.keys(candidate) as Array<keyof SharePolicyInput>).every(
          (k) => next[k] === candidate[k]
        );
      if (matches(FULL)) setPreset("full");
      else if (matches(PIPS_R)) setPreset("pips");
      else setPreset("custom");
      return next;
    });
  };

  const periodRange = (): { start: string; end: string } => {
    switch (periodPreset) {
      case "30":
        return { start: isoDaysAgo(30), end: isoToday() };
      case "90":
        return { start: isoDaysAgo(90), end: isoToday() };
      case "365":
        return { start: isoDaysAgo(365), end: isoToday() };
      case "ytd":
        return { start: isoYtdStart(), end: isoToday() };
      default:
        return { start: customStart, end: customEnd };
    }
  };

  const submit = () => {
    const parsedViews = maxViews.trim() === "" ? null : Number.parseInt(maxViews, 10);
    if (parsedViews !== null && (!Number.isFinite(parsedViews) || parsedViews < 1)) {
      toast({ title: t("errorCreate"), variant: "destructive" });
      return;
    }
    const base = {
      title: title.trim() || defaultTitle?.trim() || "Promethe",
      mode,
      policy,
      expiresInDays: expiry,
      maxViews: parsedViews,
    };
    const input: ShareLinkInput = tradeId
      ? { type: "TRADE", tradeId, ...base }
      : {
          type: "REPORT",
          reportPeriod: {
            ...periodRange(),
            accountId: accountId === "all" ? null : accountId,
          },
          ...base,
        };
    create.mutate(input, {
      onSuccess: (data) => {
        setCreated({ url: `${window.location.origin}${data.urlPath}` });
      },
      onError: () => {
        toast({ title: t("errorCreate"), variant: "destructive" });
      },
    });
  };

  const copy = async () => {
    if (!created) return;
    await navigator.clipboard.writeText(created.url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const policyToggles: Array<{ flag: keyof SharePolicyInput; key: string }> = [
    { flag: "hideAmounts", key: "policyHideAmounts" },
    { flag: "hideAccountInfo", key: "policyHideAccount" },
    { flag: "hideNotes", key: "policyHideNotes" },
    { flag: "hideScreenshots", key: "policyHideScreens" },
    { flag: "hideStrategyName", key: "policyHideStrategy" },
    { flag: "hideExactTimes", key: "policyHideTimes" },
    { flag: "hidePsychology", key: "policyHidePsychology" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-4 w-4" aria-hidden="true" />
            {tradeId ? t("titleTrade") : t("title")}
          </DialogTitle>
          <DialogDescription>{t("desc")}</DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4">
              <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                {t("createdTitle")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{t("createdBody")}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="share-url">{t("createdUrlLabel")}</Label>
              <div className="flex gap-2">
                <Input
                  id="share-url"
                  readOnly
                  value={created.url}
                  className="font-mono text-xs"
                  onFocus={(e) => e.target.select()}
                />
                <Button variant="outline" size="icon" onClick={() => void copy()} aria-label={t("copy")}>
                  {copied ? (
                    <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                  ) : (
                    <Copy className="h-4 w-4" aria-hidden="true" />
                  )}
                </Button>
                <Button variant="outline" size="icon" asChild>
                  <a href={created.url} target="_blank" rel="noopener noreferrer" aria-label={t("open")}>
                    <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  </a>
                </Button>
              </div>
            </div>
            <Button className="w-full" onClick={() => onOpenChange(false)}>
              {t("done")}
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Title */}
            <div className="space-y-1.5">
              <Label htmlFor="share-title">{t("titleLabel")}</Label>
              <Input
                id="share-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("titleLabelPlaceholder")}
                maxLength={120}
              />
            </div>

            {/* Report period */}
            {!tradeId && report && (
              <>
                <div className="space-y-1.5">
                  <Label>{t("reportPeriodLabel")}</Label>
                  <Select value={periodPreset} onValueChange={(v) => setPeriodPreset(v as typeof periodPreset)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="30">{t("reportLast30")}</SelectItem>
                      <SelectItem value="90">{t("reportLast90")}</SelectItem>
                      <SelectItem value="365">{t("reportLast365")}</SelectItem>
                      <SelectItem value="ytd">{t("reportYtd")}</SelectItem>
                      <SelectItem value="custom">{t("reportCustom")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {periodPreset === "custom" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="period-start">Début</Label>
                      <Input
                        id="period-start"
                        type="date"
                        className="h-10 font-mono tabular-nums"
                        value={customStart}
                        onChange={(e) => setCustomStart(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="period-end">Fin</Label>
                      <Input
                        id="period-end"
                        type="date"
                        className="h-10 font-mono tabular-nums"
                        value={customEnd}
                        onChange={(e) => setCustomEnd(e.target.value)}
                      />
                    </div>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>{t("reportAccountLabel")}</Label>
                  <Select value={accountId} onValueChange={setAccountId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("reportAllAccounts")}</SelectItem>
                      {report.accounts.map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          {account.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {/* Mode */}
            <div className="space-y-1.5">
              <Label>{t("modeLabel")}</Label>
              <div className="grid grid-cols-2 gap-2">
                {(["SNAPSHOT", "LIVE"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    aria-pressed={mode === m}
                    className={cn(
                      "rounded-lg border p-3 text-left text-sm transition-colors",
                      mode === m
                        ? "border-emerald-500/60 bg-emerald-500/10 font-medium"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                      {m === "SNAPSHOT" ? t("modeSnapshot") : t("modeLive")}
                    </span>
                    <span className="mt-0.5 block text-[11px] font-normal opacity-80">
                      {m === "SNAPSHOT" ? t("modeSnapshotDesc") : t("modeLiveDesc")}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Policy */}
            <div className="space-y-2">
              <Label>{t("policyLabel")}</Label>
              <div className="grid grid-cols-3 gap-2">
                {(["full", "pips", "custom"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => applyPreset(p)}
                    aria-pressed={preset === p}
                    className={cn(
                      "rounded-lg border px-2 py-2 text-xs font-medium transition-colors",
                      preset === p
                        ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    {p === "full" ? t("policyPresetFull") : p === "pips" ? t("policyPresetPips") : t("policyPresetCustom")}
                  </button>
                ))}
              </div>
              {preset === "pips" && (
                <p className="text-[11px] text-muted-foreground">{t("policyPresetPipsDesc")}</p>
              )}
              <div className="space-y-2.5 rounded-lg border p-3">
                {policyToggles.map(({ flag, key }) => (
                  <div key={flag} className="flex items-center justify-between gap-3">
                    <Label htmlFor={`pol-${flag}`} className="text-xs font-normal">
                      {t(key)}
                    </Label>
                    <Switch
                      id={`pol-${flag}`}
                      checked={policy[flag]}
                      onCheckedChange={(v) => setFlag(flag, v)}
                    />
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">{t("leakNote")}</p>
            </div>

            {/* Expiry + max views */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("expiryLabel")}</Label>
                <Select
                  value={String(expiry)}
                  onValueChange={(v) => setExpiry(Number.parseInt(v, 10) as ExpiryDays)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRY_OPTIONS.map((days) => (
                      <SelectItem key={days} value={String(days)}>
                        {expiryLabel(days, locale)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="max-views">{t("maxViewsLabel")}</Label>
                <Input
                  id="max-views"
                  inputMode="numeric"
                  value={maxViews}
                  onChange={(e) => setMaxViews(e.target.value.replace(/\D/g, ""))}
                  placeholder={t("maxViewsPlaceholder")}
                />
              </div>
            </div>

            <Button className="w-full" onClick={submit} disabled={create.isPending}>
              {create.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {t("creating")}
                </>
              ) : (
                t("create")
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
