"use client";

/**
 * Full trade form (create / edit) — v2 §4.1.
 *
 * One state object mirroring TradeInput with STRING fields for every decimal
 * (exact round-trip with the API), datetimes stored as ISO and bound to
 * datetime-local inputs via isoToLocalInput / localInputToIso.
 *
 * Layout: stacked section Cards on the left, sticky live preview (previewTrade)
 * on the right. Templates prefill the create form via applyTradeTemplate.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  FileText,
  Loader2,
  Save,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  AccountSelect,
  DraftBadge,
  Field,
  InstrumentSelect,
  ResultBadge,
  StrategySelect,
  TimeframeSelect,
  guardEmpty,
  toSpec,
  useTradingLabels,
} from "./trade-bits";
import {
  useAccounts,
  useCreateTrade,
  useInstruments,
  useRecordTemplateUse,
  useStrategies,
  useTags,
  useTemplates,
  useTrade,
  useUpdateTrade,
  type MutationResult,
} from "@/hooks/use-trading";
import type { TemplateDTO } from "@/lib/trading/dto";
import { useToast } from "@/hooks/use-toast";
import { useCustomFields } from "@/hooks/use-productivity";
import { CustomFieldInputs } from "./custom-field-inputs";
import { useSession } from "@/components/app/session-context";
import { Money } from "@/components/privacy/money";
import { useFormat } from "@/lib/format/use-format";
import { navigate } from "@/lib/router";
import { ApiClientError } from "@/lib/api-client";
import { apiErrorMessage, translateFieldErrors } from "@/lib/i18n-errors";
import { zodFieldErrors } from "@/lib/auth/validators";
import { tradeInputSchema, type TradeInput, type TradePatch } from "@/lib/validations/trade";
import {
  applyTradeTemplate,
  pipsFromPrices,
  type TradeTemplateData,
} from "@/lib/trading/template";
import { previewTrade, type TradePreview } from "@/lib/trading/calculate";
import { toD } from "@/lib/trading/dec";
import {
  EMOTIONS,
  EXIT_REASONS,
  MARKET_CONDITIONS,
  ORDER_TYPES,
  TRADE_STATUSES,
  TRADING_SESSIONS,
  type Direction,
  type Emotion,
  type ExitReason,
  type MarketCondition,
  type OrderType,
  type Timeframe,
  type TradeStatus,
  type TradingSession,
} from "@/lib/trading/types";
import {
  fmtNum,
  fmtSigned,
  isoToLocalInput,
  localInputToIso,
  pnlClass,
} from "@/lib/format";
import { cn } from "@/lib/utils";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Minute-precision ISO for datetime-local round-trips. */
function nowIso(): string {
  return (
    localInputToIso(isoToLocalInput(new Date().toISOString())) ??
    new Date().toISOString()
  );
}

/** Trimmed non-empty string, else null. */
function nul(v: string): string | null {
  const s = v.trim();
  return s === "" ? null : s;
}

function toIntOrNull(v: string): number | null {
  if (v === "") return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/** TemplateDTO (loose string enums) → client-safe TradeTemplateData. */
function asTemplateData(tpl: TemplateDTO): TradeTemplateData {
  return {
    ...tpl,
    direction: tpl.direction as TradeTemplateData["direction"],
    timeframe: tpl.timeframe as TradeTemplateData["timeframe"],
    session: tpl.session as TradeTemplateData["session"],
    orderType: tpl.orderType as TradeTemplateData["orderType"],
  };
}

// ── Form state ───────────────────────────────────────────────────────────────

interface TradeFormState {
  accountId: string;
  strategyId: string;
  instrumentId: string;
  direction: Direction;
  orderType: OrderType;
  status: TradeStatus;
  timeframe: string;
  session: string; // "" | "auto" | TradingSession
  setupType: string;
  marketCondition: string;
  entryTime: string; // ISO ("" = cleared → now on submit)
  exitTime: string; // ISO ("" = null)
  entryPrice: string;
  exitPrice: string;
  stopLoss: string;
  takeProfit: string;
  mfePrice: string;
  maePrice: string;
  lots: string;
  riskPercent: string;
  riskAmount: string;
  plannedRiskPercent: string;
  quoteToAccountRate: string;
  commission: string;
  swap: string;
  fees: string;
  pnlSource: "CALCULATED" | "MANUAL";
  manualNetPnl: string;
  exitReason: string;
  emotionBefore: string;
  emotionDuring: string;
  emotionAfter: string;
  confidence: string;
  setupQualityRating: string;
  executionRating: string;
  followedPlan: boolean;
  tagIds: string[];
  checklistResults: Record<string, boolean>;
  /** Custom-field values, keyed by definition key (v2.5 Module 4 §4.7). */
  customFields: Record<string, unknown>;
  preTradeAnalysis: string;
  postTradeReview: string;
  notes: string;
  tradingViewUrl: string;
  reviewStatus: "NOT_REVIEWED" | "REVIEWED";
  isDraft: boolean;
}

function emptyForm(): TradeFormState {
  return {
    accountId: "",
    strategyId: "",
    instrumentId: "",
    direction: "LONG",
    orderType: "MARKET",
    status: "OPEN",
    timeframe: "",
    session: "auto",
    setupType: "",
    marketCondition: "",
    entryTime: nowIso(),
    exitTime: "",
    entryPrice: "",
    exitPrice: "",
    stopLoss: "",
    takeProfit: "",
    mfePrice: "",
    maePrice: "",
    lots: "",
    riskPercent: "",
    riskAmount: "",
    plannedRiskPercent: "",
    quoteToAccountRate: "",
    commission: "0",
    swap: "0",
    fees: "0",
    pnlSource: "CALCULATED",
    manualNetPnl: "",
    exitReason: "",
    emotionBefore: "",
    emotionDuring: "",
    emotionAfter: "",
    confidence: "",
    setupQualityRating: "",
    executionRating: "",
    followedPlan: false,
    tagIds: [],
    checklistResults: {},
    customFields: {},
    preTradeAnalysis: "",
    postTradeReview: "",
    notes: "",
    tradingViewUrl: "",
    reviewStatus: "NOT_REVIEWED",
    isDraft: false,
  };
}

/** trades.form label key for a schema field (inline validation alert). */
const FIELD_LABELS: Record<string, string> = {
  accountId: "account",
  instrumentId: "instrument",
  direction: "direction",
  entryTime: "entryTime",
  entryPrice: "entryPrice",
  exitTime: "exitTime",
  exitPrice: "exitPrice",
  stopLoss: "stopLoss",
  takeProfit: "takeProfit",
  mfePrice: "mfe",
  maePrice: "mae",
  lots: "lots",
  riskPercent: "riskPercent",
  riskAmount: "riskAmount",
  plannedRiskPercent: "plannedRisk",
  quoteToAccountRate: "quoteToAccountRate",
  commission: "commission",
  swap: "swap",
  fees: "fees",
  manualNetPnl: "manualNetPnl",
  exitReason: "exitReason",
  tradingViewUrl: "tradingViewUrl",
  notes: "notes",
  tagIds: "sectionTags",
  checklistResults: "checklist",
};

// ── Component ────────────────────────────────────────────────────────────────

export function TradeFormView({
  mode,
  tradeId,
}: {
  mode: "create" | "edit";
  tradeId?: string;
}) {
  const t = useTranslations("trades.form");
  const td = useTranslations("trades.detail");
  const tc = useTranslations("common");
  const tRoot = useTranslations();
  const labels = useTradingLabels();
  const fmt = useFormat();
  const { toast } = useToast();
  const { session } = useSession();

  const [form, setForm] = React.useState<TradeFormState>(emptyForm);
  const [templateId, setTemplateId] = React.useState("");
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]> | null>(null);
  const [submitting, setSubmitting] = React.useState<"full" | "draft" | null>(null);
  const [expectedUpdatedAt, setExpectedUpdatedAt] = React.useState<string | null>(null);

  const topRef = React.useRef<HTMLDivElement>(null);
  const prefilledIdRef = React.useRef<string | null>(null);
  const accountDefaultedRef = React.useRef(false);
  const directionTouchedRef = React.useRef(false);
  const mutationIdRef = React.useRef<string>(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `tf-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

  const tradeQuery = useTrade(mode === "edit" ? tradeId ?? null : null);
  const customFieldsQuery = useCustomFields(false);
  const customFieldDefs = customFieldsQuery.data ?? [];

  // Create mode: apply definition default values once they load.
  React.useEffect(() => {
    if (mode !== "create" || customFieldDefs.length === 0) return;
    setForm((f) => {
      const next = { ...f.customFields };
      let changed = false;
      for (const d of customFieldDefs) {
        if (
          next[d.key] === undefined &&
          d.defaultValue !== null &&
          d.defaultValue !== undefined
        ) {
          next[d.key] = d.defaultValue;
          changed = true;
        }
      }
      return changed ? { ...f, customFields: next } : f;
    });
  }, [mode, customFieldDefs]);
  const trade = tradeQuery.data;
  const { data: accounts } = useAccounts();
  const { data: instruments } = useInstruments();
  const { data: strategies } = useStrategies();
  const { data: tags } = useTags();
  const { data: templates } = useTemplates();

  const createTrade = useCreateTrade();
  const updateTrade = useUpdateTrade();
  const recordTemplateUse = useRecordTemplateUse();

  // ── Edit prefill (once per loaded trade) ──
  React.useEffect(() => {
    if (!trade || prefilledIdRef.current === trade.id) return;
    prefilledIdRef.current = trade.id;
    setExpectedUpdatedAt(trade.updatedAt);
    setFieldErrors(null);
    setForm({
      accountId: trade.accountId,
      strategyId: trade.strategyId ?? "",
      instrumentId: trade.instrumentId,
      direction: trade.direction as Direction,
      orderType: trade.orderType as OrderType,
      status: trade.status as TradeStatus,
      timeframe: trade.timeframe ?? "",
      session: trade.session ?? "auto",
      setupType: trade.setupType ?? "",
      marketCondition: trade.marketCondition ?? "",
      entryTime: trade.entryTime,
      exitTime: trade.exitTime ?? "",
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice ?? "",
      stopLoss: trade.stopLoss ?? "",
      takeProfit: trade.takeProfit ?? "",
      mfePrice: trade.mfePrice ?? "",
      maePrice: trade.maePrice ?? "",
      lots: trade.lots,
      riskPercent: trade.riskPercent ?? "",
      riskAmount: trade.riskAmount ?? "",
      plannedRiskPercent: "",
      quoteToAccountRate: "",
      commission: trade.commission,
      swap: trade.swap,
      fees: trade.fees,
      pnlSource: trade.pnlSource === "MANUAL" ? "MANUAL" : "CALCULATED",
      manualNetPnl: "",
      exitReason: trade.exitReason ?? "",
      emotionBefore: trade.emotionBefore ?? "",
      emotionDuring: trade.emotionDuring ?? "",
      emotionAfter: trade.emotionAfter ?? "",
      confidence: trade.confidence != null ? String(trade.confidence) : "",
      setupQualityRating:
        trade.setupQualityRating != null ? String(trade.setupQualityRating) : "",
      executionRating:
        trade.executionRating != null ? String(trade.executionRating) : "",
      followedPlan: trade.followedPlan ?? false,
      tagIds: trade.tags.map((tag) => tag.id),
      checklistResults: trade.checklistResults ?? {},
      customFields: trade.customFields ?? {},
      preTradeAnalysis: trade.preTradeAnalysis,
      postTradeReview: trade.postTradeReview,
      notes: trade.notes ?? "",
      tradingViewUrl: trade.tradingViewUrl ?? "",
      reviewStatus: trade.reviewStatus === "REVIEWED" ? "REVIEWED" : "NOT_REVIEWED",
      isDraft: trade.isDraft,
    });
  }, [trade]);

  // ── Create mode: smart account default (preferences) ──
  React.useEffect(() => {
    if (mode !== "create" || accountDefaultedRef.current || !accounts) return;
    accountDefaultedRef.current = true;
    const prefs = session?.profile.preferences ?? {};
    const candidates = [
      prefs.lastAccountId ?? null,
      session?.profile.defaultAccountId ?? null,
      accounts.find((a) => a.isActive)?.id ?? null,
    ];
    const pick = candidates.find((c) => c != null && accounts.some((a) => a.id === c));
    if (pick) {
      setForm((f) => (f.accountId === "" ? { ...f, accountId: pick } : f));
    }
  }, [mode, accounts, session]);

  // ── Derived data ──
  const specs = React.useMemo(
    () => (instruments ?? []).map(toSpec),
    [instruments]
  );
  const spec = React.useMemo(
    () => specs.find((s) => s.id === form.instrumentId) ?? null,
    [specs, form.instrumentId]
  );
  const account = React.useMemo(
    () => (accounts ?? []).find((a) => a.id === form.accountId) ?? null,
    [accounts, form.accountId]
  );
  const accountCurrency = account?.currency ?? "";
  const accountBalance = account?.initialBalance ?? null;
  const strategy = React.useMemo(
    () => strategies?.find((s) => s.id === form.strategyId) ?? null,
    [strategies, form.strategyId]
  );

  const hasExit = form.exitPrice.trim() !== "";
  const hasTakeProfit = form.takeProfit.trim() !== "";

  const preview: TradePreview | null = React.useMemo(() => {
    if (!spec || !form.entryPrice.trim() || !form.lots.trim()) return null;
    try {
      return previewTrade({
        instrument: spec,
        direction: form.direction,
        lots: form.lots.trim(),
        entry: form.entryPrice.trim(),
        exit: form.exitPrice.trim() || form.takeProfit.trim() || form.entryPrice.trim(),
        stopLoss: nul(form.stopLoss),
        takeProfit: nul(form.takeProfit),
        commission: form.commission.trim() || "0",
        swap: form.swap.trim() || "0",
        fees: form.fees.trim() || "0",
        quoteToAccountRate: nul(form.quoteToAccountRate),
        accountCurrency: accountCurrency || null,
        accountBalance,
      });
    } catch {
      return null;
    }
  }, [
    spec,
    form.direction,
    form.lots,
    form.entryPrice,
    form.exitPrice,
    form.takeProfit,
    form.stopLoss,
    form.commission,
    form.swap,
    form.fees,
    form.quoteToAccountRate,
    accountCurrency,
    accountBalance,
  ]);

  /** SL on the wrong side of the entry for the chosen direction. */
  const slInvalid = React.useMemo(() => {
    const sl = nul(form.stopLoss);
    const entry = nul(form.entryPrice);
    if (!sl || !entry) return false;
    const s = toD(sl);
    const e = toD(entry);
    return form.direction === "LONG" ? s.gte(e) : s.lte(e);
  }, [form.stopLoss, form.entryPrice, form.direction]);

  const slPipsText = React.useMemo(() => {
    if (!spec || !form.entryPrice.trim() || !form.stopLoss.trim()) return null;
    return `${fmtNum(pipsFromPrices(form.entryPrice.trim(), form.stopLoss.trim(), spec), 1)} ${tc("pips")}`;
  }, [spec, form.entryPrice, form.stopLoss, tc]);

  const tpPipsText = React.useMemo(() => {
    if (!spec || !form.entryPrice.trim() || !form.takeProfit.trim()) return null;
    return `${fmtNum(pipsFromPrices(form.entryPrice.trim(), form.takeProfit.trim(), spec), 1)} ${tc("pips")}`;
  }, [spec, form.entryPrice, form.takeProfit, tc]);

  // ── Handlers ──
  const set = <K extends keyof TradeFormState>(key: K, value: TradeFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const setDirection = (value: string) => {
    if (value !== "LONG" && value !== "SHORT") return;
    directionTouchedRef.current = true;
    set("direction", value);
  };

  const toggleTag = (id: string) =>
    setForm((f) => ({
      ...f,
      tagIds: f.tagIds.includes(id)
        ? f.tagIds.filter((x) => x !== id)
        : [...f.tagIds, id],
    }));

  const applyTemplate = (tplId: string) => {
    setTemplateId(tplId);
    const tpl = templates?.find((x) => x.id === tplId);
    if (!tpl) return;
    const strategyRisk =
      strategies?.find((s) => s.id === tpl.strategyId)?.defaultRiskPercent ?? null;
    const prefill = applyTradeTemplate(asTemplateData(tpl), {
      instruments: specs,
      entryPrice: nul(form.entryPrice),
      direction: directionTouchedRef.current ? form.direction : null,
      strategyDefaultRiskPercent: strategyRisk,
    });
    setForm((f) => ({
      ...f,
      strategyId: prefill.strategyId ?? f.strategyId,
      instrumentId: prefill.instrumentId ?? f.instrumentId,
      direction: (prefill.direction ?? f.direction) as Direction,
      timeframe: prefill.timeframe ?? f.timeframe,
      session: prefill.session ?? f.session,
      orderType: (prefill.orderType ?? f.orderType) as OrderType,
      riskPercent: prefill.riskPercent ?? f.riskPercent,
      riskAmount: prefill.riskAmount ?? f.riskAmount,
      lots: prefill.lots ?? f.lots,
      stopLoss: prefill.stopLossPrice ?? f.stopLoss,
      takeProfit: prefill.takeProfitPrice ?? f.takeProfit,
      notes: prefill.notes ?? f.notes,
      tagIds: Array.from(new Set([...f.tagIds, ...prefill.tagIds])),
      checklistResults:
        prefill.checklistItemIds.length > 0
          ? {
              ...f.checklistResults,
              ...Object.fromEntries(prefill.checklistItemIds.map((id) => [id, true])),
            }
          : f.checklistResults,
    }));
    toast({ title: t("templateApplied", { name: tpl.name }) });
    recordTemplateUse.mutate(tpl.id);
  };

  const scrollToTop = () =>
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  function buildPayload(draft: boolean): TradeInput {
    return {
      accountId: form.accountId,
      strategyId: form.strategyId || null,
      instrumentId: form.instrumentId,
      direction: form.direction,
      orderType: form.orderType,
      status: form.status,
      timeframe: (form.timeframe || null) as Timeframe | null,
      session:
        form.session && form.session !== "auto"
          ? (form.session as TradingSession)
          : null,
      setupType: nul(form.setupType),
      marketCondition: (form.marketCondition || null) as MarketCondition | null,
      entryTime: form.entryTime || nowIso(),
      exitTime: nul(form.exitTime),
      entryPrice: form.entryPrice.trim(),
      exitPrice: nul(form.exitPrice),
      stopLoss: nul(form.stopLoss),
      takeProfit: nul(form.takeProfit),
      mfePrice: nul(form.mfePrice),
      maePrice: nul(form.maePrice),
      lots: form.lots.trim() || "0",
      riskPercent: nul(form.riskPercent),
      riskAmount: nul(form.riskAmount),
      plannedRiskPercent: nul(form.plannedRiskPercent),
      quoteToAccountRate: nul(form.quoteToAccountRate),
      commission: form.commission.trim() || "0",
      swap: form.swap.trim() || "0",
      fees: form.fees.trim() || "0",
      pnlSource: form.pnlSource,
      manualNetPnl: nul(form.manualNetPnl),
      exitReason: (form.exitReason || null) as ExitReason | null,
      emotionBefore: (form.emotionBefore || null) as Emotion | null,
      emotionDuring: (form.emotionDuring || null) as Emotion | null,
      emotionAfter: (form.emotionAfter || null) as Emotion | null,
      confidence: toIntOrNull(form.confidence),
      setupQualityRating: toIntOrNull(form.setupQualityRating),
      executionRating: toIntOrNull(form.executionRating),
      followedPlan: form.followedPlan,
      tagIds: form.tagIds,
      customFields: form.customFields,
      checklistResults:
        Object.keys(form.checklistResults).length > 0 ? form.checklistResults : null,
      preTradeAnalysis: form.preTradeAnalysis,
      postTradeReview: form.postTradeReview,
      notes: nul(form.notes),
      tradingViewUrl: nul(form.tradingViewUrl),
      reviewStatus: form.reviewStatus,
      isDraft: draft,
    };
  }

  async function onSubmit(draft: boolean) {
    let payload: TradeInput;
    if (draft) {
      // Drafts: only the core identifying fields are required.
      const missing: Record<string, string[]> = {};
      if (!form.accountId) missing.accountId = ["required"];
      if (!form.instrumentId) missing.instrumentId = ["required"];
      if (!form.entryPrice.trim()) missing.entryPrice = ["required"];
      if (Object.keys(missing).length > 0) {
        setFieldErrors(missing);
        scrollToTop();
        return;
      }
      setFieldErrors(null);
      payload = buildPayload(true);
    } else {
      const parsed = tradeInputSchema.safeParse(buildPayload(false));
      if (!parsed.success) {
        setFieldErrors(zodFieldErrors(parsed.error));
        scrollToTop();
        return;
      }
      setFieldErrors(null);
      payload = parsed.data as TradeInput;
    }

    setSubmitting(draft ? "draft" : "full");
    try {
      if (mode === "edit" && tradeId) {
        const patch: TradePatch = {
          ...payload,
          expectedUpdatedAt: expectedUpdatedAt ?? undefined,
        };
        const result: MutationResult = await updateTrade.mutateAsync({
          id: tradeId,
          patch,
        });
        setExpectedUpdatedAt(result.trade.updatedAt);
        if (result.conflict) {
          toast({
            title: t("conflictToastTitle"),
            description: t("conflictToastDesc"),
            variant: "destructive",
          });
        } else {
          toast({ title: t("updatedToast") });
          navigate(`#/trades/${result.trade.id}`);
        }
      } else {
        const result: MutationResult = await createTrade.mutateAsync({
          ...payload,
          clientMutationId: mutationIdRef.current,
        });
        mutationIdRef.current = `tf-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        if (result.deduplicated) {
          toast({ title: t("deduplicatedToast") });
        } else if (draft) {
          toast({ title: t("draftSavedToast") });
        } else {
          toast({ title: t("createdToast") });
        }
        navigate(`#/trades/${result.trade.id}`);
      }
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
      if (err?.fieldErrors) {
        setFieldErrors(err.fieldErrors);
        scrollToTop();
      }
    } finally {
      setSubmitting(null);
    }
  }

  // ── Edit-mode gates ──
  if (mode === "edit" && (!tradeId || tradeQuery.isError)) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-muted-foreground">{t("loadError")}</p>
          <Button variant="outline" onClick={() => void tradeQuery.refetch()}>
            {tc("retry")}
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (mode === "edit" && tradeQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const busy = submitting !== null;
  const ratings = ["1", "2", "3", "4", "5"];
  const translatedErrors = fieldErrors
    ? translateFieldErrors(tRoot, fieldErrors)
    : null;

  return (
    <div ref={topRef} className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h2 className="flex flex-wrap items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
          {mode === "edit" ? t("editTitle") : t("createTitle")}
          {mode === "edit" && form.isDraft ? <DraftBadge /> : null}
        </h2>
        {mode === "create" && (
          <div className="w-full sm:w-64">
            <Field label={t("template")} htmlFor="tf-template">
              <Select
                value={templateId}
                onValueChange={(id) => {
                  if (id) applyTemplate(id);
                }}
              >
                <SelectTrigger id="tf-template" className="w-full">
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
          </div>
        )}
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        {/* ── Left: form sections ── */}
        <form
          id="trade-form"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void onSubmit(false);
          }}
        >
          {translatedErrors && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              <AlertTitle>{tRoot("errors.api.VALIDATION")}</AlertTitle>
              <AlertDescription>
                <ul className="list-disc space-y-0.5 pl-4">
                  {Object.entries(translatedErrors).map(([field, messages]) =>
                    messages.map((message, i) => (
                      <li key={`${field}-${i}`}>
                        {FIELD_LABELS[field]
                          ? `${t(FIELD_LABELS[field] as Parameters<typeof t>[0])} - ${message}`
                          : message}
                      </li>
                    ))
                  )}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Context */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t("sectionContext")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label={t("account")} htmlFor="tf-account">
                <AccountSelect
                  id="tf-account"
                  value={form.accountId}
                  onChange={(v) => set("accountId", v)}
                  className="w-full"
                />
              </Field>
              <Field label={t("strategy")} htmlFor="tf-strategy">
                <StrategySelect
                  id="tf-strategy"
                  value={form.strategyId}
                  onChange={(v) => set("strategyId", v)}
                  noneLabel={t("strategyNone")}
                  className="w-full"
                />
              </Field>
              <Field
                label={t("instrument")}
                htmlFor="tf-instrument"
                className="sm:col-span-2"
              >
                <InstrumentSelect
                  id="tf-instrument"
                  value={form.instrumentId}
                  onChange={(v) => set("instrumentId", v)}
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
                      className="h-4 w-4 text-gain"
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
                      className="h-4 w-4 text-loss"
                      aria-hidden="true"
                    />
                    {labels.direction("SHORT")}
                  </ToggleGroupItem>
                </ToggleGroup>
              </Field>
              <Field label={t("orderType")} htmlFor="tf-order-type">
                <Select
                  value={form.orderType}
                  onValueChange={guardEmpty((v) => set("orderType", v as OrderType))}
                >
                  <SelectTrigger id="tf-order-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ORDER_TYPES.map((ot) => (
                      <SelectItem key={ot} value={ot}>
                        {labels.orderType(ot)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("status")} htmlFor="tf-status">
                <Select
                  value={form.status}
                  onValueChange={guardEmpty((v) => set("status", v as TradeStatus))}
                >
                  <SelectTrigger id="tf-status" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRADE_STATUSES.map((st) => (
                      <SelectItem key={st} value={st}>
                        {labels.status(st)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("timeframe")} htmlFor="tf-timeframe">
                <TimeframeSelect
                  id="tf-timeframe"
                  value={form.timeframe}
                  onChange={(v) => set("timeframe", v)}
                  className="w-full"
                />
              </Field>
              <Field label={t("session")} htmlFor="tf-session">
                <Select
                  value={form.session || "auto"}
                  onValueChange={guardEmpty((v) => set("session", v))}
                >
                  <SelectTrigger id="tf-session" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">{t("sessionAuto")}</SelectItem>
                    {TRADING_SESSIONS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {labels.session(s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("setupType")} htmlFor="tf-setup-type">
                <Input
                  id="tf-setup-type"
                  value={form.setupType}
                  placeholder={t("setupPlaceholder")}
                  maxLength={60}
                  onChange={(e) => set("setupType", e.target.value)}
                />
              </Field>
              <Field label={t("marketCondition")} htmlFor="tf-market-condition">
                <Select
                  value={form.marketCondition || "none"}
                  onValueChange={guardEmpty((v) => set("marketCondition", v === "none" ? "" : v))}
                >
                  <SelectTrigger id="tf-market-condition" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{tc("none")}</SelectItem>
                    {MARKET_CONDITIONS.map((mc) => (
                      <SelectItem key={mc} value={mc}>
                        {labels.marketCondition(mc)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </CardContent>
          </Card>

          {/* Execution */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t("sectionExecution")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label={t("entryTime")} htmlFor="tf-entry-time">
                <Input
                  id="tf-entry-time"
                  type="datetime-local"
                  value={isoToLocalInput(form.entryTime)}
                  onChange={(e) =>
                    set("entryTime", localInputToIso(e.target.value) ?? "")
                  }
                />
              </Field>
              <Field label={t("entryPrice")} htmlFor="tf-entry-price">
                <Input
                  id="tf-entry-price"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  required
                  value={form.entryPrice}
                  onChange={(e) => set("entryPrice", e.target.value)}
                  className="tabular-nums"
                />
              </Field>
              <Field label={t("lots")} htmlFor="tf-lots">
                <Input
                  id="tf-lots"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={form.lots}
                  onChange={(e) => set("lots", e.target.value)}
                  className="tabular-nums"
                />
              </Field>
              <Field
                label={t("stopLoss")}
                htmlFor="tf-stop-loss"
                hint={
                  <>
                    {slPipsText && (
                      <span className="tabular-nums">{slPipsText}</span>
                    )}
                    <span>{t("initialSlNote")}</span>
                  </>
                }
              >
                <Input
                  id="tf-stop-loss"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={form.stopLoss}
                  onChange={(e) => set("stopLoss", e.target.value)}
                  className="tabular-nums"
                  aria-invalid={slInvalid || undefined}
                />
              </Field>
              <Field
                label={t("takeProfit")}
                htmlFor="tf-take-profit"
                hint={tpPipsText ?? undefined}
              >
                <Input
                  id="tf-take-profit"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={form.takeProfit}
                  onChange={(e) => set("takeProfit", e.target.value)}
                  className="tabular-nums"
                />
              </Field>
              <Field label={t("mfe")} htmlFor="tf-mfe">
                <Input
                  id="tf-mfe"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={form.mfePrice}
                  onChange={(e) => set("mfePrice", e.target.value)}
                  className="tabular-nums"
                />
              </Field>
              <Field label={t("mae")} htmlFor="tf-mae">
                <Input
                  id="tf-mae"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={form.maePrice}
                  onChange={(e) => set("maePrice", e.target.value)}
                  className="tabular-nums"
                />
              </Field>
            </CardContent>
          </Card>

          {/* Risk */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t("sectionRisk")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <Field label={t("riskPercent")} htmlFor="tf-risk-percent">
                <Input
                  id="tf-risk-percent"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={form.riskPercent}
                  onChange={(e) => set("riskPercent", e.target.value)}
                  className="tabular-nums"
                />
              </Field>
              <Field label={t("riskAmount")} htmlFor="tf-risk-amount">
                <Input
                  id="tf-risk-amount"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={form.riskAmount}
                  onChange={(e) => set("riskAmount", e.target.value)}
                  className="tabular-nums"
                />
              </Field>
              <Field label={t("plannedRisk")} htmlFor="tf-planned-risk">
                <Input
                  id="tf-planned-risk"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={form.plannedRiskPercent}
                  onChange={(e) => set("plannedRiskPercent", e.target.value)}
                  className="tabular-nums"
                />
              </Field>
            </CardContent>
          </Card>

          {/* Exit */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t("sectionExit")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label={t("exitTime")} htmlFor="tf-exit-time">
                <Input
                  id="tf-exit-time"
                  type="datetime-local"
                  value={isoToLocalInput(form.exitTime)}
                  onChange={(e) =>
                    set("exitTime", localInputToIso(e.target.value) ?? "")
                  }
                />
              </Field>
              <Field label={t("exitPrice")} htmlFor="tf-exit-price">
                <Input
                  id="tf-exit-price"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={form.exitPrice}
                  onChange={(e) => set("exitPrice", e.target.value)}
                  className="tabular-nums"
                />
              </Field>
              <Field label={t("exitReason")} htmlFor="tf-exit-reason">
                <Select
                  value={form.exitReason || "none"}
                  onValueChange={guardEmpty((v) => set("exitReason", v === "none" ? "" : v))}
                  disabled={form.status !== "CLOSED"}
                >
                  <SelectTrigger id="tf-exit-reason" className="w-full">
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
            </CardContent>
          </Card>

          {/* Costs */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t("sectionCosts")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <Field label={t("commission")} htmlFor="tf-commission">
                <Input
                  id="tf-commission"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={form.commission}
                  onChange={(e) => set("commission", e.target.value)}
                  className="tabular-nums"
                />
              </Field>
              <Field label={t("swap")} htmlFor="tf-swap">
                <Input
                  id="tf-swap"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={form.swap}
                  onChange={(e) => set("swap", e.target.value)}
                  className="tabular-nums"
                />
              </Field>
              <Field label={t("fees")} htmlFor="tf-fees" hint={t("costsHint")}>
                <Input
                  id="tf-fees"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={form.fees}
                  onChange={(e) => set("fees", e.target.value)}
                  className="tabular-nums"
                />
              </Field>
              {spec && accountCurrency && spec.quoteCurrency !== accountCurrency && (
                <Field
                  label={t("quoteToAccountRate", {
                    quote: spec.quoteCurrency,
                    currency: accountCurrency,
                  })}
                  htmlFor="tf-rate"
                  hint={t("rateHint")}
                >
                  <Input
                    id="tf-rate"
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min="0"
                    value={form.quoteToAccountRate}
                    onChange={(e) => set("quoteToAccountRate", e.target.value)}
                    className="tabular-nums"
                  />
                </Field>
              )}
              <Field label={t("pnlSource")} htmlFor="tf-pnl-source">
                <Select
                  value={form.pnlSource}
                  onValueChange={guardEmpty((v) =>
                    set("pnlSource", v === "MANUAL" ? "MANUAL" : "CALCULATED")
                  )}
                >
                  <SelectTrigger id="tf-pnl-source" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CALCULATED">{t("pnlCalculated")}</SelectItem>
                    <SelectItem value="MANUAL">{t("pnlManual")}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {form.pnlSource === "MANUAL" && (
                <Field label={t("manualNetPnl")} htmlFor="tf-manual-pnl">
                  <Input
                    id="tf-manual-pnl"
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={form.manualNetPnl}
                    onChange={(e) => set("manualNetPnl", e.target.value)}
                    className="tabular-nums"
                  />
                </Field>
              )}
            </CardContent>
          </Card>

          {/* Psychology */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t("sectionPsychology")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <Field label={t("emotionBefore")} htmlFor="tf-emotion-before">
                <Select
                  value={form.emotionBefore || "none"}
                  onValueChange={guardEmpty((v) =>
                    set("emotionBefore", v === "none" ? "" : v)
                  )}
                >
                  <SelectTrigger id="tf-emotion-before" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value="none">{tc("none")}</SelectItem>
                    {EMOTIONS.map((e) => (
                      <SelectItem key={e} value={e}>
                        {labels.emotion(e)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("emotionDuring")} htmlFor="tf-emotion-during">
                <Select
                  value={form.emotionDuring || "none"}
                  onValueChange={guardEmpty((v) =>
                    set("emotionDuring", v === "none" ? "" : v)
                  )}
                >
                  <SelectTrigger id="tf-emotion-during" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value="none">{tc("none")}</SelectItem>
                    {EMOTIONS.map((e) => (
                      <SelectItem key={e} value={e}>
                        {labels.emotion(e)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("emotionAfter")} htmlFor="tf-emotion-after">
                <Select
                  value={form.emotionAfter || "none"}
                  onValueChange={guardEmpty((v) => set("emotionAfter", v === "none" ? "" : v))}
                >
                  <SelectTrigger id="tf-emotion-after" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value="none">{tc("none")}</SelectItem>
                    {EMOTIONS.map((e) => (
                      <SelectItem key={e} value={e}>
                        {labels.emotion(e)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("confidence")} htmlFor="tf-confidence">
                <Select
                  value={form.confidence || "none"}
                  onValueChange={guardEmpty((v) => set("confidence", v === "none" ? "" : v))}
                >
                  <SelectTrigger id="tf-confidence" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{tc("none")}</SelectItem>
                    {ratings.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}/5
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("setupQuality")} htmlFor="tf-setup-quality">
                <Select
                  value={form.setupQualityRating || "none"}
                  onValueChange={guardEmpty((v) =>
                    set("setupQualityRating", v === "none" ? "" : v)
                  )}
                >
                  <SelectTrigger id="tf-setup-quality" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{tc("none")}</SelectItem>
                    {ratings.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}/5
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("executionRating")} htmlFor="tf-execution-rating">
                <Select
                  value={form.executionRating || "none"}
                  onValueChange={guardEmpty((v) =>
                    set("executionRating", v === "none" ? "" : v)
                  )}
                >
                  <SelectTrigger id="tf-execution-rating" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{tc("none")}</SelectItem>
                    {ratings.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}/5
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <div className="flex min-h-10 items-center justify-between gap-3 rounded-lg border px-3 sm:col-span-3">
                <Label htmlFor="tf-followed-plan">{t("followedPlan")}</Label>
                <Switch
                  id="tf-followed-plan"
                  checked={form.followedPlan}
                  onCheckedChange={(v) => set("followedPlan", v)}
                />
              </div>
            </CardContent>
          </Card>

          {/* Analysis */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t("sectionAnalysis")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Field label={t("preTrade")} htmlFor="tf-pre-trade">
                <Textarea
                  id="tf-pre-trade"
                  rows={3}
                  value={form.preTradeAnalysis}
                  onChange={(e) => set("preTradeAnalysis", e.target.value)}
                />
              </Field>
              <Field label={t("postTrade")} htmlFor="tf-post-trade">
                <Textarea
                  id="tf-post-trade"
                  rows={3}
                  value={form.postTradeReview}
                  onChange={(e) => set("postTradeReview", e.target.value)}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("notes")} htmlFor="tf-notes">
                  <Input
                    id="tf-notes"
                    value={form.notes}
                    onChange={(e) => set("notes", e.target.value)}
                  />
                </Field>
                <Field label={t("tradingViewUrl")} htmlFor="tf-tv-url">
                  <Input
                    id="tf-tv-url"
                    type="url"
                    inputMode="url"
                    value={form.tradingViewUrl}
                    onChange={(e) => set("tradingViewUrl", e.target.value)}
                  />
                </Field>
              </div>
            </CardContent>
          </Card>

          {/* Tags + review status */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t("sectionTags")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {(tags ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">{tc("none")}</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {(tags ?? []).map((tag) => {
                    const active = form.tagIds.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggleTag(tag.id)}
                        className={cn(
                          badgeVariants({ variant: active ? "default" : "outline" }),
                          "min-h-10 cursor-pointer gap-1.5 px-3 font-normal",
                          active ? "" : "text-muted-foreground"
                        )}
                        style={active ? { borderColor: `${tag.color}66` } : undefined}
                      >
                        <span
                          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: tag.color }}
                          aria-hidden="true"
                        />
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              )}
              <Separator />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("reviewStatus")} htmlFor="tf-review-status">
                  <Select
                    value={form.reviewStatus}
                    onValueChange={guardEmpty((v) =>
                      set("reviewStatus", v === "REVIEWED" ? "REVIEWED" : "NOT_REVIEWED")
                    )}
                  >
                    <SelectTrigger id="tf-review-status" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NOT_REVIEWED">
                        {labels.reviewStatus("NOT_REVIEWED")}
                      </SelectItem>
                      <SelectItem value="REVIEWED">
                        {labels.reviewStatus("REVIEWED")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <div className="space-y-2">
                  <div className="flex min-h-10 items-center justify-between gap-3 rounded-lg border px-3">
                    <Label htmlFor="tf-is-draft">{t("isDraft")}</Label>
                    <Switch
                      id="tf-is-draft"
                      checked={form.isDraft}
                      onCheckedChange={(v) => set("isDraft", v)}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">{t("draftHint")}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Custom fields (v2.5 Module 4 §4.7) */}
          {customFieldDefs.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{t("sectionCustomFields")}</CardTitle>
              </CardHeader>
              <CardContent>
                <CustomFieldInputs
                  definitions={customFieldDefs}
                  values={form.customFields}
                  onChange={(next) => set("customFields", next)}
                />
              </CardContent>
            </Card>
          )}

          {/* Strategy checklist */}
          {strategy && strategy.checklistItems.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{t("checklist")}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-2">
                {strategy.checklistItems.map((item) => (
                  <label
                    key={item.id}
                    className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg border px-3 text-sm"
                  >
                    <Checkbox
                      checked={form.checklistResults[item.id] ?? false}
                      onCheckedChange={(v) =>
                        setForm((f) => ({
                          ...f,
                          checklistResults: {
                            ...f.checklistResults,
                            [item.id]: v === true,
                          },
                        }))
                      }
                    />
                    <span className="flex-1">{item.label}</span>
                    {item.isRequired && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {t("checklistRequired")}
                      </span>
                    )}
                  </label>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              size="lg"
              disabled={busy}
              onClick={() => void onSubmit(true)}
            >
              {submitting === "draft" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <FileText className="h-4 w-4" aria-hidden="true" />
              )}
              {submitting === "draft" ? t("submitting") : t("submitDraft")}
            </Button>
            <Button type="submit" size="lg" disabled={busy}>
              {submitting === "full" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="h-4 w-4" aria-hidden="true" />
              )}
              {submitting === "full" ? t("submitting") : t("submit")}
            </Button>
          </div>
        </form>

        {/* ── Right: live preview ── */}
        <aside className="w-full self-start xl:sticky xl:top-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t("previewTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!preview ? (
                <p className="text-sm text-muted-foreground">{t("previewEmpty")}</p>
              ) : (
                <>
                  {slInvalid && (
                    <p className="rounded-md border border-loss-subtle bg-loss-subtle p-2 text-xs font-medium text-loss">
                      {t("previewInvalidSide")}
                    </p>
                  )}
                  <dl className="space-y-2 text-sm">
                    <PreviewRow
                      label={t("previewPips")}
                      value={
                        hasExit || hasTakeProfit
                          ? `${fmtSigned(preview.pips, 1)} ${tc("pips")}`
                          : "-"
                      }
                      valueClass={
                        hasExit || hasTakeProfit ? pnlClass(preview.pips) : undefined
                      }
                    />
                    <PreviewRow
                      label={t("previewRR")}
                      value={
                        preview.plannedRR ? fmtSigned(preview.plannedRR, 2) : "-"
                      }
                    />
                    <PreviewRow
                      label={t("previewRisk")}
                      value={
                        preview.riskAmount ? (
                          <>
                            <Money
                              value={preview.riskAmount}
                              currency={accountCurrency}
                            />
                            {preview.riskPercent
                              ? ` · ${fmt.pct(preview.riskPercent)}`
                              : null}
                          </>
                        ) : (
                          "-"
                        )
                      }
                    />
                  </dl>
                  {hasExit && (
                    <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                          {td("netPnl")}
                        </span>
                        <ResultBadge result={preview.resultType} />
                      </div>
                      <p className="text-2xl font-bold tabular-nums tracking-tight">
                        <Money
                          signed
                          value={preview.netPnl}
                          currency={accountCurrency || "USD"}
                          className={pnlClass(preview.netPnl)}
                        />
                      </p>
                      <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                        <span>{td("grossPnl")}</span>
                        <Money
                          signed
                          value={preview.grossPnl}
                          currency={accountCurrency || "USD"}
                        />
                      </div>
                      <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                        <span>{td("costs")}</span>
                        <span className="tabular-nums">
                          −
                          <Money
                            value={preview.totalCosts}
                            currency={accountCurrency || "USD"}
                          />
                        </span>
                      </div>
                    </div>
                  )}
                  {preview.isEstimate && (
                    <Badge
                      variant="outline"
                      className="border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                    >
                      {t("previewEstimate")}
                    </Badge>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function PreviewRow({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("font-semibold tabular-nums", valueClass ?? "")}>{value}</dd>
    </div>
  );
}
