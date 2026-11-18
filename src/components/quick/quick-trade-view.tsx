"use client";

/**
 * Quick trade (~20 s) — v2 §4.1.
 *
 * One compact card: account / instrument / direction / timeframe remembered
 * from Profile.preferences, SL/TP entered in PIPS (prices derived live),
 * position size computed from risk % / risk amount via calcPositionSize.
 * After saving, the preferences are patched (fire-and-forget) and the form
 * resets for the next trade ("Enregistrer un autre").
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Loader2,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  AccountSelect,
  Field,
  InstrumentSelect,
  TimeframeSelect,
  toSpec,
  useTradingLabels,
} from "@/components/trades/trade-bits";
import { Money, Sensitive } from "@/components/privacy/money";
import {
  useAccounts,
  useCreateTrade,
  useInstruments,
  useRecordTemplateUse,
  useStrategies,
  useTemplates,
  type MutationResult,
} from "@/hooks/use-trading";
import type { TemplateDTO } from "@/lib/trading/dto";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "@/components/app/session-context";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import { apiErrorMessage, sizingErrorMessage } from "@/lib/i18n-errors";
import { tradeInputSchema, type TradeInput } from "@/lib/validations/trade";
import {
  applyTradeTemplate,
  stopPriceFromPips,
  takeProfitPriceFromPips,
  type TradeTemplateData,
} from "@/lib/trading/template";
import {
  calcPositionSize,
  previewTrade,
  type PositionSizeResult,
} from "@/lib/trading/calculate";
import {
  EXIT_REASONS,
  type Direction,
  type ExitReason,
  type Timeframe,
} from "@/lib/trading/types";
import {
  fmtNum,
  fmtPrice,
  isoToLocalInput,
  localInputToIso,
} from "@/lib/format";

// ── Helpers ──────────────────────────────────────────────────────────────────

function nowIso(): string {
  return (
    localInputToIso(isoToLocalInput(new Date().toISOString())) ??
    new Date().toISOString()
  );
}

function asTemplateData(tpl: TemplateDTO): TradeTemplateData {
  return {
    ...tpl,
    direction: tpl.direction as TradeTemplateData["direction"],
    timeframe: tpl.timeframe as TradeTemplateData["timeframe"],
    session: tpl.session as TradeTemplateData["session"],
    orderType: tpl.orderType as TradeTemplateData["orderType"],
  };
}

type RiskMode = "percent" | "amount" | "lots";

interface QuickFormState {
  accountId: string;
  instrumentId: string;
  direction: Direction;
  timeframe: string;
  strategyId: string;
  entryTime: string; // ISO
  entryPrice: string;
  stopPips: string;
  tpPips: string;
  riskMode: RiskMode;
  riskPercent: string;
  riskAmount: string;
  lots: string;
  notes: string;
  closed: boolean;
  exitPrice: string;
  exitReason: string;
  tagIds: string[];
}

function emptyForm(): QuickFormState {
  return {
    accountId: "",
    instrumentId: "",
    direction: "LONG",
    timeframe: "",
    strategyId: "",
    entryTime: nowIso(),
    entryPrice: "",
    stopPips: "",
    tpPips: "",
    riskMode: "percent",
    riskPercent: "1",
    riskAmount: "",
    lots: "",
    notes: "",
    closed: false,
    exitPrice: "",
    exitReason: "",
    tagIds: [],
  };
}

// ── Component ────────────────────────────────────────────────────────────────

export function QuickTradeView() {
  const t = useTranslations("quick");
  const tc = useTranslations("common");
  const tRoot = useTranslations();
  const labels = useTradingLabels();
  const { toast } = useToast();
  const { session } = useSession();

  const [form, setForm] = React.useState<QuickFormState>(emptyForm);
  const [templateId, setTemplateId] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [saved, setSaved] = React.useState<{ symbol: string; closed: boolean } | null>(
    null
  );

  const entryPriceRef = React.useRef<HTMLInputElement>(null);
  const baseInitRef = React.useRef(false);
  const riskInitRef = React.useRef(false);
  const autoTemplateRef = React.useRef(false);
  const directionTouchedRef = React.useRef(false);
  const mutationIdRef = React.useRef<string>(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `qt-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

  const accountsQuery = useAccounts();
  const accounts = accountsQuery.data;
  const { data: instruments } = useInstruments();
  const { data: strategies } = useStrategies();
  const { data: templates } = useTemplates();

  const createTrade = useCreateTrade();
  const recordTemplateUse = useRecordTemplateUse();

  // ── Defaults on mount: remembered account / instrument / timeframe ──
  React.useEffect(() => {
    if (baseInitRef.current || !accounts) return;
    baseInitRef.current = true;
    const prefs = session?.profile.preferences ?? {};
    const valid = (id: string | null | undefined): string | null =>
      id && accounts.some((a) => a.id === id) ? id : null;
    const accountId =
      valid(prefs.lastAccountId) ??
      valid(session?.profile.defaultAccountId) ??
      accounts.find((a) => a.isActive)?.id ??
      "";
    setForm((f) => ({
      ...f,
      accountId: f.accountId || accountId,
      instrumentId: f.instrumentId || prefs.lastInstrumentId || "",
      timeframe: f.timeframe || prefs.lastTimeframe || "",
    }));
  }, [accounts, session]);

  // ── Remembered lot size for the pre-selected instrument ──
  React.useEffect(() => {
    if (riskInitRef.current || !instruments || !form.instrumentId) return;
    riskInitRef.current = true;
    const symbol = instruments.find((i) => i.id === form.instrumentId)?.symbol;
    const remembered = symbol
      ? session?.profile.preferences?.rememberedLots?.[symbol]
      : undefined;
    if (remembered != null && remembered !== "") {
      setForm((f) => ({ ...f, riskMode: "lots", lots: remembered }));
    }
  }, [instruments, form.instrumentId, session]);

  // ── Derived data ──
  const spec = React.useMemo(
    () => (instruments ?? []).find((i) => i.id === form.instrumentId) ?? null,
    [instruments, form.instrumentId]
  );
  const account = React.useMemo(
    () => (accounts ?? []).find((a) => a.id === form.accountId) ?? null,
    [accounts, form.accountId]
  );
  const accountCurrency = account?.currency ?? "";
  const symbol = spec?.symbol ?? "";

  const entry = form.entryPrice.trim();
  const stop = form.stopPips.trim();

  /** SL/TP prices + position size derived from the current inputs. */
  const derived = React.useMemo(() => {
    if (!spec || !entry || !stop) return null;
    const s = toSpec(spec);
    const stopLoss = stopPriceFromPips(form.direction, entry, stop, s);
    const takeProfit = form.tpPips.trim()
      ? takeProfitPriceFromPips(form.direction, entry, form.tpPips.trim(), s)
      : null;

    let sizing: PositionSizeResult | null = null;
    if (form.riskMode !== "lots" && account) {
      sizing = calcPositionSize({
        accountBalance: account.initialBalance,
        riskPercent: form.riskMode === "percent" ? form.riskPercent.trim() || null : null,
        riskAmount: form.riskMode === "amount" ? form.riskAmount.trim() || null : null,
        entry,
        stopLoss,
        instrument: s,
        direction: form.direction,
      });
    }
    const lots =
      form.riskMode === "lots"
        ? form.lots.trim()
        : sizing?.valid
          ? sizing.lots.toString()
          : "";
    return { spec: s, stopLoss, takeProfit, sizing, lots };
  }, [spec, entry, stop, form.tpPips, form.direction, form.riskMode, form.riskPercent, form.riskAmount, form.lots, account]);

  const effectiveLots = derived?.lots ?? "";
  const sizingError =
    derived?.sizing && !derived.sizing.valid
      ? sizingErrorMessage(
          tRoot,
          derived.sizing.reason,
          derived.sizing.minLots.toString()
        )
      : null;

  const previewReady = Boolean(spec && entry && stop && effectiveLots);
  const preview = React.useMemo(() => {
    if (!previewReady || !derived) return null;
    try {
      return previewTrade({
        instrument: derived.spec,
        direction: form.direction,
        lots: effectiveLots,
        entry,
        exit:
          (form.closed && form.exitPrice.trim()) ||
          derived.takeProfit ||
          entry,
        stopLoss: derived.stopLoss,
        takeProfit: derived.takeProfit,
        accountCurrency: accountCurrency || null,
        accountBalance: account?.initialBalance ?? null,
      });
    } catch {
      return null;
    }
  }, [previewReady, derived, form.direction, effectiveLots, entry, form.closed, form.exitPrice, accountCurrency, account]);

  // ── Handlers ──
  const set = <K extends keyof QuickFormState>(key: K, value: QuickFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const setDirection = (value: string) => {
    if (value !== "LONG" && value !== "SHORT") return;
    directionTouchedRef.current = true;
    set("direction", value);
  };

  const riskValue =
    form.riskMode === "percent"
      ? form.riskPercent
      : form.riskMode === "amount"
        ? form.riskAmount
        : form.lots;
  const setRiskValue = (value: string) => {
    if (form.riskMode === "percent") set("riskPercent", value);
    else if (form.riskMode === "amount") set("riskAmount", value);
    else set("lots", value);
  };

  function applyTemplate(tpl: TemplateDTO) {
    setTemplateId(tpl.id);
    const strategyRisk =
      strategies?.find((s) => s.id === tpl.strategyId)?.defaultRiskPercent ?? null;
    const prefill = applyTradeTemplate(asTemplateData(tpl), {
      instruments: (instruments ?? []).map(toSpec),
      entryPrice: entry || null,
      direction: directionTouchedRef.current ? form.direction : null,
      strategyDefaultRiskPercent: strategyRisk,
    });
    setForm((f) => ({
      ...f,
      strategyId: prefill.strategyId ?? f.strategyId,
      instrumentId: prefill.instrumentId ?? f.instrumentId,
      direction: (prefill.direction ?? f.direction) as Direction,
      timeframe: prefill.timeframe ?? f.timeframe,
      stopPips: prefill.stopLossPips ?? f.stopPips,
      tpPips: prefill.takeProfitPips ?? f.tpPips,
      notes: prefill.notes ?? f.notes,
      tagIds:
        prefill.tagIds.length > 0
          ? Array.from(new Set([...f.tagIds, ...prefill.tagIds]))
          : f.tagIds,
      riskMode: prefill.lots != null ? "lots" : f.riskMode,
      riskPercent: prefill.riskPercent ?? f.riskPercent,
      riskAmount: prefill.riskAmount ?? f.riskAmount,
      lots: prefill.lots ?? f.lots,
    }));
    toast({ title: t("templateApplied", { name: tpl.name }) });
    recordTemplateUse.mutate(tpl.id);
  }

  // ── Auto-apply ?template=<id> from the query string (templates "use" action) ──
  React.useEffect(() => {
    if (autoTemplateRef.current || !templates) return;
    autoTemplateRef.current = true;
    if (typeof window === "undefined") return;
    const id = new URLSearchParams(window.location.search).get("template");
    if (!id) return;
    const tpl = templates.find((x) => x.id === id);
    if (tpl) applyTemplate(tpl);
  }, [templates]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.instrumentId || !entry || !effectiveLots) {
      toast({
        title: t("validationTitle"),
        description: t("validationDesc"),
        variant: "destructive",
      });
      return;
    }
    const raw: TradeInput = {
      accountId: form.accountId,
      strategyId: form.strategyId || null,
      instrumentId: form.instrumentId,
      direction: form.direction,
      orderType: "MARKET",
      status: form.closed ? "CLOSED" : "OPEN",
      timeframe: (form.timeframe || null) as Timeframe | null,
      session: null,
      setupType: null,
      marketCondition: null,
      entryTime: form.entryTime || nowIso(),
      exitTime: form.closed ? nowIso() : null,
      entryPrice: entry,
      exitPrice:
        form.closed && form.exitPrice.trim() ? form.exitPrice.trim() : null,
      stopLoss: derived?.stopLoss ?? null,
      takeProfit: derived?.takeProfit ?? null,
      mfePrice: null,
      maePrice: null,
      lots: effectiveLots,
      riskPercent:
        form.riskMode === "percent" && form.riskPercent.trim()
          ? form.riskPercent.trim()
          : null,
      riskAmount:
        form.riskMode === "amount" && form.riskAmount.trim()
          ? form.riskAmount.trim()
          : null,
      plannedRiskPercent: null,
      quoteToAccountRate: null,
      commission: "0",
      swap: "0",
      fees: "0",
      pnlSource: "CALCULATED",
      manualNetPnl: null,
      exitReason:
        form.closed && form.exitReason
          ? (form.exitReason as ExitReason)
          : null,
      emotionBefore: null,
      emotionDuring: null,
      emotionAfter: null,
      confidence: null,
      setupQualityRating: null,
      executionRating: null,
      followedPlan: null,
      tagIds: form.tagIds,
      checklistResults: null,
      preTradeAnalysis: "",
      postTradeReview: "",
      notes: form.notes.trim() || null,
      tradingViewUrl: null,
      reviewStatus: "NOT_REVIEWED",
      isDraft: false,
      clientMutationId: mutationIdRef.current,
    };
    const parsed = tradeInputSchema.safeParse(raw);
    if (!parsed.success) {
      toast({
        title: t("validationTitle"),
        description: t("validationDesc"),
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      const result: MutationResult = await createTrade.mutateAsync(parsed.data as TradeInput);
      toast({
        title: result.deduplicated
          ? t("savedToast")
          : form.closed
            ? t("savedClosedToast")
            : t("savedToast"),
      });

      // Persist quick-entry defaults (fire and forget).
      const prefs = session?.profile.preferences ?? {};
      void apiFetch("/api/profile", {
        method: "PATCH",
        body: JSON.stringify({
          preferences: {
            lastAccountId: form.accountId || null,
            lastInstrumentId: form.instrumentId || null,
            lastTimeframe: form.timeframe || null,
            rememberedLots: {
              ...(prefs.rememberedLots ?? {}),
              ...(symbol ? { [symbol]: effectiveLots } : {}),
            },
          },
        }),
      }).catch(() => {});

      setSaved({ symbol: symbol || form.instrumentId, closed: form.closed });
    } catch (error) {
      const err = error instanceof ApiClientError ? error : null;
      toast({
        title: apiErrorMessage(
          tRoot,
          err?.code,
          error instanceof Error ? error.message : ""
        ),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  const onAnother = () => {
    setSaved(null);
    mutationIdRef.current = `qt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setForm((f) => ({
      ...f,
      entryTime: nowIso(),
      entryPrice: "",
      closed: false,
      exitPrice: "",
      exitReason: "",
      notes: "",
    }));
    requestAnimationFrame(() => entryPriceRef.current?.focus());
  };

  // ── Gates ──
  if (accountsQuery.isError) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-muted-foreground">{t("loadError")}</p>
          <Button variant="outline" onClick={() => void accountsQuery.refetch()}>
            {tc("retry")}
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (accounts && accounts.filter((a) => a.isActive).length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <p className="text-sm text-muted-foreground">{t("accountMissing")}</p>
        </CardContent>
      </Card>
    );
  }

  const favoriteIds =
    session?.profile.preferences?.favoriteInstrumentIds ?? [];
  const slPriceText =
    derived && spec && stop ? fmtPrice(derived.stopLoss, spec.digits) : null;
  const tpPriceText =
    derived && spec && form.tpPips.trim() && derived.takeProfit
      ? fmtPrice(derived.takeProfit, spec.digits)
      : null;

  return (
    <div className="w-full space-y-4">
      <div className="space-y-1 text-center sm:text-left">
        <h2 className="text-xl font-bold tracking-tight sm:text-2xl">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base sr-only">{t("title")}</CardTitle>
          <CardDescription className="sr-only">{t("subtitle")}</CardDescription>
          <Field label={t("template")} htmlFor="qt-template">
            <Select
              value={templateId}
              onValueChange={(id) => {
                if (!id) return; // spurious Radix empty sync - ignore
                const tpl = templates?.find((x) => x.id === id);
                if (tpl) applyTemplate(tpl);
              }}
            >
              <SelectTrigger id="qt-template" className="w-full">
                <SelectValue placeholder={t("templateNone")} />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {(templates ?? []).map((tpl) => (
                  <SelectItem key={tpl.id} value={tpl.id}>
                    {tpl.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </CardHeader>
        <CardContent className="space-y-4">
          {saved && (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-center">
              <CheckCircle2
                className="h-8 w-8 text-emerald-500 dark:text-emerald-400"
                aria-hidden="true"
              />
              <div>
                <p className="text-sm font-semibold">
                  {saved.closed ? t("savedClosedToast") : t("savedToast")}
                </p>
                {saved.symbol && (
                  <p className="text-xs tabular-nums text-muted-foreground">
                    {saved.symbol} ·{" "}
                    <Sensitive kind="lots">
                      {fmtNum(effectiveLots, 2, 2)}
                    </Sensitive>{" "}
                    {tc("lots")}
                  </p>
                )}
              </div>
              <Button variant="outline" size="lg" onClick={onAnother}>
                {t("another")}
              </Button>
            </div>
          )}

          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => void onSubmit(e)}
          >
            <Field
              label={t("account")}
              htmlFor="qt-account"
              hint={t("rememberHint")}
            >
              <AccountSelect
                id="qt-account"
                value={form.accountId}
                onChange={(v) => set("accountId", v)}
                className="w-full"
              />
            </Field>
            <Field label={t("instrument")} htmlFor="qt-instrument">
              <InstrumentSelect
                id="qt-instrument"
                value={form.instrumentId}
                onChange={(v) => set("instrumentId", v)}
                favoriteIds={favoriteIds}
                className="w-full"
              />
            </Field>

            <Field label={t("direction")} className="sm:col-span-2">
              <ToggleGroup
                type="single"
                value={form.direction}
                onValueChange={setDirection}
                className="w-full"
              >
                <ToggleGroupItem
                  value="LONG"
                  className="min-h-10 flex-1 gap-1.5"
                  aria-label={labels.direction("LONG")}
                >
                  <ArrowUpRight
                    className="h-4 w-4 text-emerald-500"
                    aria-hidden="true"
                  />
                  {labels.direction("LONG")}
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="SHORT"
                  className="min-h-10 flex-1 gap-1.5"
                  aria-label={labels.direction("SHORT")}
                >
                  <ArrowDownRight
                    className="h-4 w-4 text-rose-500"
                    aria-hidden="true"
                  />
                  {labels.direction("SHORT")}
                </ToggleGroupItem>
              </ToggleGroup>
            </Field>

            <Field label={t("timeframe")} htmlFor="qt-timeframe">
              <TimeframeSelect
                id="qt-timeframe"
                value={form.timeframe}
                onChange={(v) => set("timeframe", v)}
                className="w-full"
              />
            </Field>
            <Field label={t("entryTime")} htmlFor="qt-entry-time">
              <DateField
                id="qt-entry-time"
                type="datetime-local"
                value={isoToLocalInput(form.entryTime)}
                onChange={(v) =>
                  set("entryTime", localInputToIso(v) ?? "")
                }
              />
            </Field>
            <Field label={t("entryPrice")} htmlFor="qt-entry-price">
              <Input
                ref={entryPriceRef}
                id="qt-entry-price"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                required
                value={form.entryPrice}
                onChange={(e) => set("entryPrice", e.target.value)}
                className="min-h-10 tabular-nums"
              />
            </Field>
            <Field
              label={t("stopPips")}
              htmlFor="qt-stop-pips"
              hint={slPriceText ? `≈ ${slPriceText}` : undefined}
            >
              <Input
                id="qt-stop-pips"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={form.stopPips}
                onChange={(e) => set("stopPips", e.target.value)}
                className="min-h-10 tabular-nums"
              />
            </Field>
            <Field
              label={t("tpPips")}
              htmlFor="qt-tp-pips"
              hint={tpPriceText ? `≈ ${tpPriceText}` : undefined}
            >
              <Input
                id="qt-tp-pips"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={form.tpPips}
                onChange={(e) => set("tpPips", e.target.value)}
                className="min-h-10 tabular-nums"
              />
            </Field>

            <Field
              label={t("risk")}
              htmlFor="qt-risk"
              className="sm:col-span-2"
              hint={
                sizingError ? (
                  <span className="font-medium text-rose-600 dark:text-rose-400">
                    {sizingError}
                  </span>
                ) : form.riskMode !== "lots" && effectiveLots ? (
                  <>
                    {t("orLots")} :{" "}
                    <Sensitive kind="lots">
                      {fmtNum(effectiveLots, 2, 2)}
                    </Sensitive>{" "}
                    {tc("lots")}
                  </>
                ) : undefined
              }
            >
              <div className="flex gap-2">
                <ToggleGroup
                  type="single"
                  value={form.riskMode}
                  onValueChange={(v) => {
                    if (v === "percent" || v === "amount" || v === "lots") {
                      set("riskMode", v);
                    }
                  }}
                  className="shrink-0"
                >
                  <ToggleGroupItem
                    value="percent"
                    className="min-h-10"
                    aria-label={t("riskPercentAria")}
                  >
                    %
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="amount"
                    className="min-h-10"
                    aria-label={t("riskAmountAria")}
                  >
                    {accountCurrency || "-"}
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="lots"
                    className="min-h-10"
                    aria-label={t("lots")}
                  >
                    {tc("lots")}
                  </ToggleGroupItem>
                </ToggleGroup>
                <Input
                  id="qt-risk"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  aria-label={
                    form.riskMode === "percent"
                      ? t("riskPercentAria")
                      : form.riskMode === "amount"
                        ? t("riskAmountAria")
                        : t("lots")
                  }
                  value={riskValue}
                  onChange={(e) => setRiskValue(e.target.value)}
                  className="min-h-10 flex-1 tabular-nums"
                />
              </div>
            </Field>

            <Field label={t("notes")} htmlFor="qt-notes" className="sm:col-span-2">
              <Input
                id="qt-notes"
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
              />
            </Field>

            <div className="flex min-h-10 items-center justify-between gap-3 rounded-lg border px-3 sm:col-span-2">
              <Label htmlFor="qt-closed">{t("closedToggle")}</Label>
              <Switch
                id="qt-closed"
                checked={form.closed}
                onCheckedChange={(v) => set("closed", v)}
              />
            </div>

            {form.closed && (
              <>
                <Field label={t("exitPrice")} htmlFor="qt-exit-price">
                  <Input
                    id="qt-exit-price"
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min="0"
                    value={form.exitPrice}
                    onChange={(e) => set("exitPrice", e.target.value)}
                    className="min-h-10 tabular-nums"
                  />
                </Field>
                <Field label={t("exitReason")} htmlFor="qt-exit-reason">
                  <Select
                    value={form.exitReason || "none"}
                    onValueChange={(v) => {
                      if (v !== "") set("exitReason", v === "none" ? "" : v);
                    }}
                  >
                    <SelectTrigger id="qt-exit-reason" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{tc("none")}</SelectItem>
                      {EXIT_REASONS.map((r) => (
                        <SelectItem key={r} value={r}>
                          {labels.exitReason(r)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </>
            )}

            {/* ── Live preview strip ── */}
            <div className="rounded-md bg-muted p-3 sm:col-span-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("preview")}
              </p>
              {!previewReady ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("previewInvalid")}
                </p>
              ) : (
                <dl className="mt-2 grid grid-cols-3 gap-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {t("previewPips")}
                    </dt>
                    <dd className="font-semibold tabular-nums">
                      {fmtNum(stop, 1)} {tc("pips")}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {t("previewRisk")}
                    </dt>
                    <dd className="font-semibold tabular-nums">
                      {derived?.sizing?.valid ? (
                        <Money
                          value={derived.sizing.actualRiskAmount}
                          currency={accountCurrency}
                        />
                      ) : preview?.riskAmount ? (
                        <Money
                          value={preview.riskAmount}
                          currency={accountCurrency}
                        />
                      ) : (
                        "-"
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {t("previewRr")}
                    </dt>
                    <dd className="font-semibold tabular-nums">
                      {preview?.plannedRR
                        ? `1 : ${fmtNum(preview.plannedRR, 2)}`
                        : "-"}
                    </dd>
                  </div>
                </dl>
              )}
            </div>

            <Button
              type="submit"
              size="lg"
              disabled={submitting || saved !== null}
              className="w-full sm:col-span-2"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="h-4 w-4" aria-hidden="true" />
              )}
              {submitting
                ? t("submitting")
                : form.closed
                  ? t("submitClosed")
                  : t("submit")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
