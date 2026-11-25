"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ExternalLink,
  Flag,
  ImageDown,
  Loader2,
  Pencil,
  Plus,
  Share2,
  Trash2,
  X,
  Save,
  Shapes,
  XCircle,
} from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSession } from "@/components/app/session-context";
import { useReviewQuestions, useSaveTradeReview } from "@/hooks/use-trade-review";
import type { TradeReviewInput } from "@/lib/validations/review";
import { Money, Sensitive } from "@/components/privacy/money";
import { PrivateImage } from "@/components/privacy/private-image";
import { useFormat } from "@/lib/format/use-format";
import { ShareDialog } from "@/components/sharing/share-dialog";
import { CommentThread } from "@/components/comments/comment-thread";
import { ExportCardDialog } from "@/components/sharing/export-card-dialog";
import dynamic from "next/dynamic";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** v2.5 M2 - lightweight-charts bundle loads only when the tab is opened. */
const LazyPriceChart = dynamic(
  () =>
    import("@/components/charts/price-chart").then(
      (m) => m.PriceChartSection
    ),
  { ssr: false, loading: () => <Skeleton className="h-[520px] w-full" /> }
);

/** v2.5 M2 Phase 4 - replay player (lazy). */
const LazyReplayPlayer = dynamic(
  () =>
    import("@/components/charts/replay-player").then(
      (m) => m.ReplayPlayerSection
    ),
  { ssr: false, loading: () => <Skeleton className="h-[640px] w-full" /> }
);
import { TradeViolationsSection } from "@/components/rules/trade-violations-section";
import { TradeEventContextCard } from "@/components/economic-calendar/trade-event-context-card";
import { GaiaLinkedNotesSection } from "@/components/gaia/gaia-linked-notes";
import {
  gaiaErrorMessage,
  newBlockId,
  useCreateGaiaNote,
} from "@/components/gaia/gaia-shared";
import { ExitPlanCompare } from "@/components/tools/exit-plan-compare";
import { ScreenshotAnnotationEditor } from "@/components/trades/screenshot-annotation-editor";

import {
  DirectionBadge,
  DraftBadge,
  Field,
  GradeBadge,
  ResultBadge,
  StatusBadge,
  TagsBadges,
  toSpec,
  useTradingLabels,
} from "@/components/trades/trade-bits";
import { useSetPlaybookMatch } from "@/hooks/use-playbook";
import { useToast } from "@/hooks/use-toast";
import {
  useCloseTrade,
  useDeleteScreenshot,
  useDeleteTrade,
  useInstruments,
  useTrade,
  useUpdateScreenshot,
  useUpdateTrade,
  useUploadScreenshot,
} from "@/hooks/use-trading";
import { ApiClientError } from "@/lib/api-client";
import { toD } from "@/lib/trading/dec";
import {
  fmtDateTimeInTz,
  fmtNum,
  fmtPrice,
  fmtSigned,
  isoToLocalInput,
  localInputToIso,
  pnlClass,
} from "@/lib/format";
import { apiErrorMessage } from "@/lib/i18n-errors";
import {
  compressImage,
  looksLikeImage,
  MAX_UPLOAD_BYTES,
  readClipboardImage,
} from "@/lib/media/compress";
import { navigate } from "@/lib/router";
import { EXIT_REASONS } from "@/lib/trading/types";
import { confluenceTagsOf } from "@/lib/trading/confluences";
import type { CloseTradeInput } from "@/lib/validations/trade";

/** Trade detail sheet - read-only fiche with close dialog and screenshot flow. */
export function TradeDetailView({ tradeId }: { tradeId: string }) {
  // v2.5 M2 — overview / price chart / replay tabs
  const [detailTab, setDetailTab] = React.useState<
    "overview" | "chart" | "replay"
  >("overview");
  const t = useTranslations("trades.detail");
  const tPlaybook = useTranslations("playbook.tradeDetail");
  const tForm = useTranslations("trades.form");
  const tCommon = useTranslations("common");
  const tRoot = useTranslations();
  const labels = useTradingLabels();
  const fmt = useFormat();
  const { session } = useSession();
  const timezone = session?.profile.timezone ?? "UTC";
  const { toast } = useToast();

  const tradeQuery = useTrade(tradeId || null);
  const instruments = useInstruments();
  const updateTrade = useUpdateTrade();
  const setPlaybookMatch = useSetPlaybookMatch();
  const saveTradeReview = useSaveTradeReview();
  const reviewQuestions = useReviewQuestions();
  const [reviewDraft, setReviewDraft] = React.useState<TradeReviewInput>({
    followedPlan: null,
    planAdherenceScore: null,
    executionQuality: null,
    entryQuality: null,
    exitQuality: null,
    riskManagementScore: null,
    emotionalControlScore: null,
    wouldTakeAgain: null,
    mainLesson: "",
    whatWentWell: "",
    whatToImprove: "",
    customAnswers: [],
  });
  const deleteTrade = useDeleteTrade();
  const closeTrade = useCloseTrade();
  const uploadScreenshot = useUploadScreenshot();
  const deleteScreenshot = useDeleteScreenshot();
  const updateScreenshot = useUpdateScreenshot();
  const createGaiaNote = useCreateGaiaNote();

  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [closeOpen, setCloseOpen] = React.useState(false);
  const [shareOpen, setShareOpen] = React.useState(false);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [exitPrice, setExitPrice] = React.useState("");
  const [exitTime, setExitTime] = React.useState("");
  const [exitReason, setExitReason] = React.useState("none");
  const [commission, setCommission] = React.useState("");
  const [swap, setSwap] = React.useState("");
  const [fees, setFees] = React.useState("");
  const [rate, setRate] = React.useState("");
  const [useManual, setUseManual] = React.useState(false);
  const [manualPnl, setManualPnl] = React.useState("");
  const [uploading, setUploading] = React.useState(0);
  const [editingScreenshot, setEditingScreenshot] = React.useState<string | null>(null);
  const [annotationScreenshot, setAnnotationScreenshot] = React.useState<{
    id: string;
    url: string;
    label: string | null;
    caption: string | null;
  } | null>(null);
  const [screenshotLabel, setScreenshotLabel] = React.useState("none");
  const [screenshotCaption, setScreenshotCaption] = React.useState("");

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const trade = tradeQuery.data;
  const spec = React.useMemo(() => {
    if (!trade || !instruments.data) return null;
    const found = instruments.data.find((i) => i.id === trade.instrumentId);
    return found ? toSpec(found) : null;
  }, [trade, instruments.data]);
  const isEstimate =
    trade != null && spec != null && spec.quoteCurrency !== trade.accountCurrency;

  React.useEffect(() => {
    if (!trade) return;
    setReviewDraft({
      followedPlan: trade.review?.followedPlan ?? trade.followedPlan ?? null,
      planAdherenceScore: trade.review?.planAdherenceScore ?? null,
      executionQuality: trade.review?.executionQuality ?? null,
      entryQuality: trade.review?.entryQuality ?? null,
      exitQuality: trade.review?.exitQuality ?? null,
      riskManagementScore: trade.review?.riskManagementScore ?? null,
      emotionalControlScore: trade.review?.emotionalControlScore ?? null,
      wouldTakeAgain: (trade.review?.wouldTakeAgain as "YES" | "NO" | "MAYBE" | null) ?? null,
      mainLesson: trade.review?.mainLesson ?? "",
      whatWentWell: trade.review?.whatWentWell ?? "",
      whatToImprove: trade.review?.whatToImprove ?? "",
      customAnswers: trade.review?.customAnswers?.map(({ questionId, answer }) => ({ questionId, answer })) ?? [],
    });
  }, [trade]);

  const setReviewField = <K extends keyof TradeReviewInput,>(
    key: K,
    value: TradeReviewInput[K],
  ) => setReviewDraft((current) => ({ ...current, [key]: value }));

  const setCustomReviewAnswer = (questionId: string, answer: string | number | boolean | null) => {
    setReviewDraft((current) => ({ ...current, customAnswers: [ ...(current.customAnswers ?? []).filter((item) => item.questionId !== questionId), ...(answer === null || answer === "" ? [] : [{ questionId, answer }]) ] }));
  };
  const submitReview = () => {
    if (!trade) return;
    const customAnswers = (reviewQuestions.data ?? []).map((question) => {
      const answer = reviewDraft.customAnswers?.find((item) => item.questionId === question.id)?.answer;
      let normalizedAnswer: string | number | boolean | null = null;
      if (question.type === "SCALE" && typeof answer === "number" && Number.isInteger(answer) && answer >= 1 && answer <= 5) normalizedAnswer = answer;
      else if (question.type === "BOOLEAN" && typeof answer === "boolean") normalizedAnswer = answer;
      else if (question.type === "TEXT" && typeof answer === "string" && answer.trim().length > 0) normalizedAnswer = answer;
      return { questionId: question.id, answer: normalizedAnswer };
    });
    saveTradeReview.mutate(
      { tradeId: trade.id, review: { ...reviewDraft, customAnswers } },
      {
        onSuccess: () => toast({ title: "Trade review saved" }),
        onError: mutationErrorToast,
      },
    );
  };

  // Reset the close form each time the dialog opens.
  React.useEffect(() => {
    if (!closeOpen || !trade) return;
    setExitPrice("");
    setExitTime(isoToLocalInput(new Date().toISOString()));
    setExitReason(trade.exitReason ?? "none");
    setCommission(trade.commission);
    setSwap(trade.swap);
    setFees(trade.fees);
    setRate("");
    setUseManual(trade.pnlSource === "MANUAL");
    // Prefill the stored manual value (MD §3.3): for a MANUAL trade the
    // stored netPnl IS the manual value (no separate column). The dialog
    // used to reset this field to "" on every open, so closing lost the
    // manual P&L while the label stayed MANUAL.
    setManualPnl(
      trade.pnlSource === "MANUAL" && trade.netPnl != null ? trade.netPnl : ""
    );
  }, [closeOpen, trade]);

  const mutationErrorToast = (err: unknown) => {
    const e = err as ApiClientError;
    toast({
      title: apiErrorMessage(
        tRoot,
        e?.code,
        err instanceof Error ? err.message : ""
      ),
      variant: "destructive",
    });
  };

  const uploadBlobs = async (blobs: Blob[]) => {
    if (!trade) return;
    for (const blob of blobs) {
      if (!looksLikeImage(blob) || blob.size > MAX_UPLOAD_BYTES) {
        toast({ title: t("screensUploadError"), variant: "destructive" });
        continue;
      }
      toast({ title: t("screensCompressing") });
      const compressed = await compressImage(blob);
      setUploading((n) => n + 1);
      await new Promise<void>((resolve) => {
        uploadScreenshot.mutate(
          { tradeId: trade.id, blob: compressed, label: null, caption: null },
          {
            onSuccess: () => {
              toast({ title: t("screensUploaded") });
              resolve();
            },
            onError: (err) => {
              mutationErrorToast(err);
              resolve();
            },
          }
        );
      });
      setUploading((n) => Math.max(0, n - 1));
    }
  };

  const openScreenshotEditor = (shot: { id: string; label: string | null; caption: string | null }) => {
    setEditingScreenshot(shot.id);
    setScreenshotLabel(shot.label ?? "none");
    setScreenshotCaption(shot.caption ?? "");
  };

  const saveScreenshotDetails = () => {
    if (!editingScreenshot) return;
    updateScreenshot.mutate({ id: editingScreenshot, label: screenshotLabel === "none" ? null : screenshotLabel, caption: screenshotCaption.trim() || null }, {
      onSuccess: () => { toast({ title: t("screensDetailsSaved") }); setEditingScreenshot(null); },
      onError: mutationErrorToast,
    });
  };

  const onFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    void uploadBlobs(Array.from(files));
  };

  const onPasteScreens = (e: React.ClipboardEvent<HTMLElement>) => {
    const image = Array.from(e.clipboardData.files).find((f) =>
      f.type.startsWith("image/")
    );
    if (image) {
      e.preventDefault();
      void uploadBlobs([image]);
      return;
    }
    void (async () => {
      const blob = await readClipboardImage();
      if (blob) void uploadBlobs([blob]);
    })();
  };

  const toggleReview = () => {
    if (!trade) return;
    updateTrade.mutate(
      {
        id: trade.id,
        patch: {
          reviewStatus:
            trade.reviewStatus === "REVIEWED" ? "NOT_REVIEWED" : "REVIEWED",
        },
      },
      {
        onSuccess: () => toast({ title: t("reviewToast") }),
        onError: mutationErrorToast,
      }
    );
  };

  // Playbook match — declared at review time, never derived from
  // followedPlan. The select shows the stored declaration (or "not declared").
  const onPlaybookMatch = (value: string) => {
    if (!trade) return;
    if (value !== "MATCHED" && value !== "PARTIAL" && value !== "OFF_PLAYBOOK") return;
    setPlaybookMatch.mutate(
      { tradeId: trade.id, playbookMatch: value },
      {
        onSuccess: () => toast({ title: tPlaybook("matchSaved") }),
        onError: mutationErrorToast,
      },
    );
  };

  // Gaïa: créer une note liée à ce trade puis ouvrir l'éditeur Gaïa.
  const handleCreateGaiaNote = () => {
    if (!trade) return;
    void createGaiaNote
      .mutateAsync({
        title: `Note - Trade ${trade.symbol} ${trade.direction}`,
        blocks: [
          {
            id: newBlockId(),
            type: "ref",
            text: "",
            ref: { kind: "TRADE", id: trade.id },
          },
          { id: newBlockId(), type: "paragraph", text: "" },
        ],
      })
      .then(
        (res) => navigate(`/gaia?tab=notes&note=${res.note.id}`),
        (err: unknown) =>
          toast({ title: gaiaErrorMessage(err), variant: "destructive" }),
      );
  };

  const confirmDelete = () => {
    if (!trade) return;
    deleteTrade.mutate(trade.id, {
      onSuccess: () => {
        toast({ title: t("deletedToast") });
        navigate("/trades");
      },
      onError: mutationErrorToast,
    });
  };

  const submitClose = () => {
    if (!trade) return;
    const price = exitPrice.trim();
    if (!price) return;
    closeTrade.mutate(
      {
        id: trade.id,
        input: {
          exitPrice: price,
          exitTime: localInputToIso(exitTime),
          exitReason:
            exitReason === "none"
              ? null
              : (exitReason as CloseTradeInput["exitReason"]),
          commission: commission.trim() || null,
          swap: swap.trim() || null,
          fees: fees.trim() || null,
          quoteToAccountRate: isEstimate ? rate.trim() || null : null,
          pnlSource: useManual ? "MANUAL" : null,
          manualNetPnl: useManual && manualPnl.trim() ? manualPnl.trim() : null,
        },
      },
      {
        onSuccess: () => {
          toast({ title: t("closedToast") });
          setCloseOpen(false);
        },
        onError: mutationErrorToast,
      }
    );
  };

  // ── Load states ──
  if (tradeQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (tradeQuery.isError) {
    const err = tradeQuery.error as ApiClientError | null;
    const notFound = err?.status === 404;
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 text-muted-foreground"
          onClick={() => navigate("/trades")}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {tCommon("back")}
        </Button>
        <Card className="gap-0 py-4">
          <CardContent className="px-4">
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <AlertCircle
                className="h-8 w-8 text-muted-foreground"
                aria-hidden="true"
              />
              <p className="text-sm text-muted-foreground">
                {notFound ? t("notFound") : t("loadError")}
              </p>
              {notFound ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate("/trades")}
                >
                  {tCommon("back")}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void tradeQuery.refetch()}
                >
                  {tCommon("retry")}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!trade) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 text-muted-foreground"
          onClick={() => navigate("/trades")}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {tCommon("back")}
        </Button>
        <Card className="gap-0 py-4">
          <CardContent className="px-4">
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <AlertCircle
                className="h-8 w-8 text-muted-foreground"
                aria-hidden="true"
              />
              <p className="text-sm text-muted-foreground">{t("notFound")}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate("/trades")}
              >
                {tCommon("back")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Derived data ──
  const digits = trade.digits;
  const costs = toD(trade.commission)
    .plus(toD(trade.swap))
    .plus(toD(trade.fees));
  // v2.5 M8 — the account name is masked in HIDE/BLUR via <Sensitive>.
  const subtitleParts: Array<string | React.ReactNode> = [
    trade.accountName ? (
      <Sensitive key="account" kind="account">
        {trade.accountName}
      </Sensitive>
    ) : null,
    trade.strategyName ?? null,
    trade.session ? labels.session(trade.session) : null,
    trade.timeframe ?? null,
    labels.orderType(trade.orderType),
    trade.setupType ?? null,
    trade.marketCondition ? labels.marketCondition(trade.marketCondition) : null,
  ].filter((v) => v !== null);

  const levels: Array<[string, string]> = [
    [tForm("entryPrice"), fmtPrice(trade.entryPrice, digits)],
    [tForm("exitPrice"), fmtPrice(trade.exitPrice, digits)],
    [tForm("stopLoss"), fmtPrice(trade.stopLoss, digits)],
    [tForm("takeProfit"), fmtPrice(trade.takeProfit, digits)],
    [t("initialStop"), fmtPrice(trade.initialStopLoss, digits)],
    [t("initialTp"), fmtPrice(trade.initialTakeProfit, digits)],
    [t("mfe"), fmtPrice(trade.mfePrice, digits)],
    [t("mae"), fmtPrice(trade.maePrice, digits)],
  ];

  const context: Array<[string, React.ReactNode]> = [
    [
      t("account"),
      <Sensitive key="account" kind="account">
        {trade.accountName}
      </Sensitive>,
    ],
    [t("strategy"), trade.strategyName ?? "-"],
    [t("grade"), <GradeBadge key="grade" grade={trade.grade} />],
    [t("sessionLabel"), labels.session(trade.session)],
    [t("timeframe"), trade.timeframe ?? "-"],
    [t("orderType"), labels.orderType(trade.orderType)],
    [t("setupType"), trade.setupType ?? "-"],
    [t("marketCondition"), labels.marketCondition(trade.marketCondition)],
    ...(trade.exitReason
      ? ([[tForm("exitReason"), labels.exitReason(trade.exitReason)]] as Array<
          [string, React.ReactNode]
        >)
      : []),
  ];

  const checklistEntries = Object.entries(trade.checklistResults ?? {});

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 text-muted-foreground"
        onClick={() => navigate("/trades")}
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {tCommon("back")}
      </Button>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-bold tracking-tight tabular-nums">{trade.symbol}</h2>
            <DirectionBadge direction={trade.direction} />
            <StatusBadge status={trade.status} />
            <ResultBadge result={trade.resultType} />
            <GradeBadge grade={trade.grade} />
            {trade.isDraft && <DraftBadge />}
          </div>
          <p className="text-sm text-muted-foreground">
            {subtitleParts.map((part, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span aria-hidden="true"> · </span>}
                {part}
              </React.Fragment>
            ))}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("headerEntry")} :{" "}
            <span className="tabular-nums">
              {fmtDateTimeInTz(trade.entryTime, timezone)} ·{" "}
              {fmtPrice(trade.entryPrice, digits)}
            </span>
            <span aria-hidden="true"> · </span>
            {t("headerExit")} :{" "}
            <span className="tabular-nums">
              {trade.exitTime
                ? `${fmtDateTimeInTz(trade.exitTime, timezone)} · ${fmtPrice(trade.exitPrice, digits)}`
                : "-"}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {trade.status === "OPEN" && (
            <Button onClick={() => setCloseOpen(true)}>
              <Flag className="h-4 w-4" aria-hidden="true" />
              {t("closeSubmit")}
            </Button>
          )}
          <Button variant="outline" onClick={() => setShareOpen(true)}>
            <Share2 className="h-4 w-4" aria-hidden="true" />
            {tRoot("shareDialog.trigger")}
          </Button>
          <Button variant="outline" onClick={() => setExportOpen(true)}>
            <ImageDown className="h-4 w-4" aria-hidden="true" />
            {tRoot("exportCard.trigger")}
          </Button>
          <Button
            variant="outline"
            onClick={toggleReview}
            disabled={updateTrade.isPending}
          >
            {updateTrade.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            )}
            {trade.reviewStatus === "REVIEWED"
              ? t("reviewUnmark")
              : t("reviewMark")}
          </Button>
          <Select
            value={trade.playbookMatch ?? "none"}
            onValueChange={onPlaybookMatch}
            disabled={setPlaybookMatch.isPending}
          >
            <SelectTrigger
              className="w-[190px]"
              aria-label={tPlaybook("playbookMatch")}
              title={tPlaybook("playbookMatchHint")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{tPlaybook("notDeclared")}</SelectItem>
              <SelectItem value="MATCHED">{tPlaybook("MATCHED")}</SelectItem>
              <SelectItem value="PARTIAL">{tPlaybook("PARTIAL")}</SelectItem>
              <SelectItem value="OFF_PLAYBOOK">{tPlaybook("OFF_PLAYBOOK")}</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={() => navigate(`/trades/${trade.id}/edit`)}
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
            {t("edit")}
          </Button>
          <Button
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            {t("delete")}
          </Button>
        </div>
      </div>

      {/* ── v2.5 M2 — overview / price chart / replay tabs ── */}
      <Tabs value={detailTab} onValueChange={(v) => setDetailTab(v as typeof detailTab)}>
        <TabsList>
          <TabsTrigger value="overview">{t("tabOverview")}</TabsTrigger>
          <TabsTrigger value="chart">{t("tabChart")}</TabsTrigger>
          <TabsTrigger value="replay">{t("tabReplay")}</TabsTrigger>
        </TabsList>
      </Tabs>

      {detailTab === "chart" ? (
        <LazyPriceChart trade={trade} />
      ) : detailTab === "replay" ? (
        <LazyReplayPlayer trade={trade} />
      ) : (
        <>

      {/* ── KPI grid ── */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCell
          label={t("netPnl")}
          value={
            <Money
              signed
              value={trade.netPnl}
              currency={trade.pnlCurrency}
              className={pnlClass(trade.netPnl)}
            />
          }
          valueClassName="text-2xl"
          hint={
            isEstimate || trade.pnlSource === "MANUAL" ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {isEstimate && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge
                        variant="outline"
                        className="cursor-help border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-400"
                      >
                        {t("estimate")}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t("estimateHint", {
                        quote: spec?.quoteCurrency ?? "?",
                        currency: trade.accountCurrency,
                      })}
                    </TooltipContent>
                  </Tooltip>
                )}
                {trade.pnlSource === "MANUAL" && (
                  <p className="text-[10px] text-muted-foreground">
                    {t("manualPnlNote")}
                  </p>
                )}
              </div>
            ) : undefined
          }
        />
        <KpiCell
          label={t("pips")}
          value={fmtSigned(trade.pips)}
          valueClassName={`text-2xl ${pnlClass(trade.pips)}`}
        />
        <KpiCell
          label={t("rMultiple")}
          value={fmtSigned(trade.rMultiple, 2, 2)}
          valueClassName={`text-2xl ${pnlClass(trade.rMultiple)}`}
        />
        <KpiCell
          label={t("realizedRR")}
          value={fmtSigned(trade.realizedRR, 2, 2)}
          valueClassName={`text-2xl ${pnlClass(trade.realizedRR)}`}
        />
      </section>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCell
          label={t("plannedRR")}
          value={fmtSigned(trade.plannedRR, 2, 2)}
          valueClassName="text-base"
        />
        <KpiCell
          label={t("points")}
          value={fmtSigned(trade.points)}
          valueClassName="text-base"
        />
        <KpiCell
          label={t("riskAmount")}
          value={
            <>
              <Money value={trade.riskAmount} currency={trade.accountCurrency} />
              {trade.riskPercent ? (
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  ({fmt.pct(trade.riskPercent)})
                </span>
              ) : null}
            </>
          }
          valueClassName="text-base"
        />
        <KpiCell
          label={t("grossPnl")}
          value={
            <Money
              signed
              value={trade.grossPnl}
              currency={trade.pnlCurrency}
              className={pnlClass(trade.grossPnl)}
            />
          }
          valueClassName="text-base"
        />
        <KpiCell
          label={t("costs")}
          value={<Money value={costs} currency={trade.accountCurrency} />}
          valueClassName="text-base"
        />
      </section>

      {/* ── Levels ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("levelsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 sm:grid-cols-2">
            {levels.map(([label, value]) => (
              <InfoRow key={label} label={label} value={value} />
            ))}
          </dl>
        </CardContent>
      </Card>

      {/* ── Confluences (MRT wave 1) — badges, or the honest empty state
          for trades tagged before confluences existed. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("confluencesTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {confluenceTagsOf(trade.tags).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("confluencesEmpty")}
            </p>
          ) : (
            <TagsBadges tags={confluenceTagsOf(trade.tags)} max={10} />
          )}
        </CardContent>
      </Card>

      {/* ── Rule violations (phase 6, hidden when clean) ── */}
      <TradeViolationsSection tradeId={tradeId} />

      {/* ── Context ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("contextTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 sm:grid-cols-2">
            {context.map(([label, value]) => (
              <InfoRow key={label} label={label} value={value} />
            ))}
          </dl>
        </CardContent>
      </Card>

      {/* ── Economic events around this trade (lot 10) ── */}
      <TradeEventContextCard tradeId={tradeId} />

      {/* ── Executions ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("executionsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {trade.executions.length <= 1 ? (
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                {t("executionsEmpty")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("executionsHint")}
              </p>
            </div>
          ) : (
            <div className="max-h-96 overflow-auto rounded-lg border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted/50">
                  <TableRow>
                    <TableHead>{t("execColTime")}</TableHead>
                    <TableHead>{t("execColType")}</TableHead>
                    <TableHead className="text-right">
                      {t("execColPrice")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("execColLots")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("execColCommission")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("execColPnl")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trade.executions.map((exec) => (
                    <TableRow key={exec.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {fmtDateTimeInTz(exec.time, timezone)}
                      </TableCell>
                      <TableCell>{labels.executionType(exec.type)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtPrice(exec.price, digits)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <Sensitive kind="lots">{fmtNum(exec.lots)}</Sensitive>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <Money
                          value={exec.commission}
                          currency={trade.accountCurrency}
                        />
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        <Money
                          signed
                          value={exec.pnl}
                          currency={trade.pnlCurrency}
                          className={pnlClass(exec.pnl)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Exit plan vs real (v2.5 Module 5) ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{tRoot("tools.exitPlanCompareTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ExitPlanCompare trade={trade} />
        </CardContent>
      </Card>

      <Dialog open={editingScreenshot !== null} onOpenChange={(open) => { if (!open) setEditingScreenshot(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("screensEditDetails")}</DialogTitle><DialogDescription>{t("screensEditDescription")}</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>{t("screensLabel")}</Label><Select value={screenshotLabel} onValueChange={setScreenshotLabel}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
              <SelectItem value="none">{t("screensNoLabel")}</SelectItem>
              <SelectItem value="BEFORE">{labels.screenshotLabel("BEFORE")}</SelectItem><SelectItem value="ENTRY">{labels.screenshotLabel("ENTRY")}</SelectItem><SelectItem value="EXIT">{labels.screenshotLabel("EXIT")}</SelectItem><SelectItem value="AFTER">{labels.screenshotLabel("AFTER")}</SelectItem>
            </SelectContent></Select></div>
            <div className="space-y-2"><Label htmlFor="screenshot-caption">{t("screensCaption")}</Label><Textarea id="screenshot-caption" value={screenshotCaption} onChange={(event) => setScreenshotCaption(event.target.value)} maxLength={500} placeholder={t("screensCaptionPlaceholder")} /><p className="text-xs text-muted-foreground text-right">{screenshotCaption.length}/500</p></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setEditingScreenshot(null)}>{tCommon("cancel")}</Button><Button onClick={saveScreenshotDetails} disabled={updateScreenshot.isPending || screenshotCaption.length > 500}>{updateScreenshot.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}{tCommon("save")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {/* ── Screenshots ── */}
      <Card onPaste={onPasteScreens}>
        <CardHeader>
          <CardTitle className="text-base">{t("screensTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {trade.screenshots.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("screensEmpty")}</p>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {trade.screenshots.map((shot) => (
              <figure
                key={shot.id}
                className="relative overflow-hidden rounded-lg border"
              >
                <PrivateImage
                  src={shot.url}
                  alt={shot.caption ?? shot.label ?? trade.symbol}
                  className="h-40 w-full bg-muted object-cover object-top"
                />
                <Button variant="ghost" size="icon" className="absolute right-[4.5rem] top-1.5 h-7 w-7 bg-background/80" aria-label={t("screensAnnotate")} onClick={() => setAnnotationScreenshot(shot)}>
                  <Shapes className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button variant="ghost" size="icon" className="absolute right-10 top-1.5 h-7 w-7 bg-background/80" aria-label={t("screensEditDetails")} onClick={() => openScreenshotEditor(shot)}>
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-1.5 top-1.5 h-7 w-7 bg-background/80 text-destructive hover:bg-background"
                  aria-label={tCommon("delete")}
                  disabled={deleteScreenshot.isPending}
                  onClick={() =>
                    deleteScreenshot.mutate(shot.id, {
                      onSuccess: () =>
                        toast({ title: t("screensDeleted") }),
                      onError: mutationErrorToast,
                    })
                  }
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
                {(shot.label || shot.caption) && (
                  <figcaption className="space-y-0.5 p-2">
                    {shot.label && (
                      <Badge variant="outline" className="text-[10px]">
                        {labels.screenshotLabel(shot.label)}
                      </Badge>
                    )}
                    {shot.caption && (
                      <p className="text-xs text-muted-foreground">
                        {shot.caption}
                      </p>
                    )}
                  </figcaption>
                )}
              </figure>
            ))}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-muted-foreground transition-colors hover:bg-muted/50"
            >
              {uploading > 0 ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="h-5 w-5" aria-hidden="true" />
              )}
              <span className="text-xs font-medium">{t("screensAdd")}</span>
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              onFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <p className="text-xs text-muted-foreground">{t("screensFileHint")}</p>
        </CardContent>
      </Card>

      <ScreenshotAnnotationEditor
        screenshot={annotationScreenshot}
        open={annotationScreenshot !== null}
        onOpenChange={(open) => { if (!open) setAnnotationScreenshot(null); }}
      />

      {/* ── Structured post-trade review ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Post-trade review</CardTitle>
          <p className="text-sm text-muted-foreground">
            Rate the decisions and execution separately from the financial result. Leave any score unanswered when it does not apply.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <ReviewScoreField label="Plan adherence" value={reviewDraft.planAdherenceScore ?? null} onChange={(value) => setReviewField("planAdherenceScore", value)} />
            <ReviewScoreField label="Execution quality" value={reviewDraft.executionQuality ?? null} onChange={(value) => setReviewField("executionQuality", value)} />
            <ReviewScoreField label="Entry quality" value={reviewDraft.entryQuality ?? null} onChange={(value) => setReviewField("entryQuality", value)} />
            <ReviewScoreField label="Exit quality" value={reviewDraft.exitQuality ?? null} onChange={(value) => setReviewField("exitQuality", value)} />
            <ReviewScoreField label="Risk management" value={reviewDraft.riskManagementScore ?? null} onChange={(value) => setReviewField("riskManagementScore", value)} />
            <ReviewScoreField label="Emotional control" value={reviewDraft.emotionalControlScore ?? null} onChange={(value) => setReviewField("emotionalControlScore", value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <ReviewChoiceField
              label="Did you follow your plan?"
              value={reviewDraft.followedPlan == null ? "none" : reviewDraft.followedPlan ? "yes" : "no"}
              options={[["none", "Not answered"], ["yes", "Yes"], ["no", "No"]]}
              onChange={(value) => setReviewField("followedPlan", value === "none" ? null : value === "yes")}
            />
            <ReviewChoiceField
              label="Would you take this trade again?"
              value={reviewDraft.wouldTakeAgain ?? "none"}
              options={[["none", "Not answered"], ["YES", "Yes"], ["NO", "No"], ["MAYBE", "Maybe"]]}
              onChange={(value) => setReviewField("wouldTakeAgain", value === "none" ? null : value as "YES" | "NO" | "MAYBE")}
            />
          </div>
          <div className="grid gap-3">
            <ReviewTextField label="What went well?" value={reviewDraft.whatWentWell ?? ""} onChange={(value) => setReviewField("whatWentWell", value)} />
            <ReviewTextField label="What would you improve?" value={reviewDraft.whatToImprove ?? ""} onChange={(value) => setReviewField("whatToImprove", value)} />
            <ReviewTextField label="Main lesson" value={reviewDraft.mainLesson ?? ""} onChange={(value) => setReviewField("mainLesson", value)} />
          </div>
          {reviewQuestions.data && reviewQuestions.data.length > 0 && (
            <div className="space-y-3 border-t pt-4">
              <div><h3 className="text-sm font-semibold">Your review questions</h3><p className="text-xs text-muted-foreground">Personal prompts configured in Settings.</p></div>
              <div className="grid gap-3 sm:grid-cols-2">
                {reviewQuestions.data.map((question) => {
                  const current = reviewDraft.customAnswers?.find((item) => item.questionId === question.id)?.answer;
                  if (question.type === "SCALE") return <ReviewScoreField key={question.id} label={question.question} value={typeof current === "number" ? current : null} onChange={(value) => setCustomReviewAnswer(question.id, value)} />;
                  if (question.type === "BOOLEAN") return <ReviewChoiceField key={question.id} label={question.question} value={typeof current === "boolean" ? (current ? "yes" : "no") : "none"} options={[["none", "Not answered"], ["yes", "Yes"], ["no", "No"]]} onChange={(value) => setCustomReviewAnswer(question.id, value === "none" ? null : value === "yes")} />;
                  return <ReviewTextField key={question.id} label={question.question} value={typeof current === "string" ? current : ""} onChange={(value) => setCustomReviewAnswer(question.id, value)} />;
                })}
              </div>
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={submitReview} disabled={saveTradeReview.isPending || reviewQuestions.isLoading}>
              {saveTradeReview.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Save review
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Psychology & notes ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("psychologyTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-2 sm:grid-cols-2">
            <InfoRow
              label={t("emotionBefore")}
              value={labels.emotion(trade.emotionBefore)}
            />
            <InfoRow
              label={t("emotionDuring")}
              value={labels.emotion(trade.emotionDuring)}
            />
            <InfoRow
              label={t("emotionAfter")}
              value={labels.emotion(trade.emotionAfter)}
            />
            <InfoRow
              label={t("confidence")}
              value={
                trade.confidence != null ? `${trade.confidence} / 5` : "-"
              }
            />
            <InfoRow
              label={t("setupQuality")}
              value={
                trade.setupQualityRating != null
                  ? `${trade.setupQualityRating} / 5`
                  : "-"
              }
            />
            <InfoRow
              label={t("executionRating")}
              value={
                trade.executionRating != null
                  ? `${trade.executionRating} / 5`
                  : "-"
              }
            />
            <InfoRow
              label={t("followedPlan")}
              value={
                trade.followedPlan === true ? (
                  <span className="inline-flex items-center gap-1.5 text-gain">
                    <CheckCircle2
                      className="h-4 w-4"
                      aria-hidden="true"
                    />
                    <span className="sr-only">{tCommon("yes")}</span>
                  </span>
                ) : trade.followedPlan === false ? (
                  <span className="inline-flex items-center gap-1.5 text-loss">
                    <XCircle className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only">{tCommon("no")}</span>
                  </span>
                ) : (
                  "-"
                )
              }
            />
          </dl>

          {trade.preTradeAnalysis && (
            <TextBlock label={t("preTrade")} text={trade.preTradeAnalysis} />
          )}
          {trade.postTradeReview && (
            <TextBlock label={t("postTrade")} text={trade.postTradeReview} />
          )}
          {trade.notes && <TextBlock label={t("notes")} text={trade.notes} />}

          {checklistEntries.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("checklistTitle")}
              </h4>
              {checklistEntries.some(([, checked]) => checked) ? (
                <ul className="max-h-48 space-y-1 overflow-y-auto">
                  {checklistEntries.map(([id, checked]) => (
                    <li key={id} className="flex items-center gap-2 text-xs">
                      {checked ? (
                        <Check
                          className="h-3.5 w-3.5 shrink-0 text-gain"
                          aria-hidden="true"
                        />
                      ) : (
                        <X
                          className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50"
                          aria-hidden="true"
                        />
                      )}
                      <span className="font-mono text-muted-foreground">
                        {id}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("checklistEmpty")}
                </p>
              )}
            </div>
          )}

          {trade.tradingViewUrl && (
            <Button variant="outline" size="sm" asChild>
              <a href={trade.tradingViewUrl} target="_blank" rel="noreferrer">
                {t("tradingView")}
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Gaïa: notes liées à ce trade */}
      <GaiaLinkedNotesSection
        kind="TRADE"
        id={trade.id}
        testidPrefix="trade-detail"
        creating={createGaiaNote.isPending}
        onCreateNote={handleCreateGaiaNote}
      />

      {/* ── v3 Phase 5 — comment thread (owner + scoped mentors) ── */}
      {session && (
        <CommentThread
          tradeId={trade.id}
          viewerId={session.user.id}
          ownerView
        />
      )}

      {/* ── Meta ── */}
      <p className="text-xs text-muted-foreground">
        {t("metaCreated")} {fmtDateTimeInTz(trade.createdAt, timezone)}
        <span aria-hidden="true"> · </span>
        {t("metaUpdated")} {fmtDateTimeInTz(trade.updatedAt, timezone)}
      </p>
        </>
      )}

      {/* ── Close dialog ── */}
      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("closeTitle")}</DialogTitle>
            <DialogDescription>{t("closeDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={t("closeExitPrice")}
              htmlFor="close-exit-price"
              className="sm:col-span-1"
            >
              <Input
                id="close-exit-price"
                inputMode="decimal"
                required
                autoComplete="off"
                value={exitPrice}
                onChange={(e) => setExitPrice(e.target.value)}
              />
            </Field>
            <Field
              label={t("closeExitTime")}
              htmlFor="close-exit-time"
              className="sm:col-span-1"
            >
              <DateField
                id="close-exit-time"
                type="datetime-local"
                value={exitTime}
                onChange={setExitTime}
              />
            </Field>
            <Field
              label={t("closeExitReason")}
              htmlFor="close-exit-reason"
              className="sm:col-span-2"
            >
              <Select value={exitReason} onValueChange={setExitReason}>
                <SelectTrigger id="close-exit-reason" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{tCommon("none")}</SelectItem>
                  {EXIT_REASONS.map((reason) => (
                    <SelectItem key={reason} value={reason}>
                      {labels.exitReason(reason)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="space-y-2 sm:col-span-2">
              <p className="text-xs font-medium text-muted-foreground">
                {t("closeCosts")}
              </p>
              <div className="grid grid-cols-3 gap-2">
                <Input
                  aria-label={tForm("commission")}
                  inputMode="decimal"
                  autoComplete="off"
                  value={commission}
                  onChange={(e) => setCommission(e.target.value)}
                />
                <Input
                  aria-label={tForm("swap")}
                  inputMode="decimal"
                  autoComplete="off"
                  value={swap}
                  onChange={(e) => setSwap(e.target.value)}
                />
                <Input
                  aria-label={tForm("fees")}
                  inputMode="decimal"
                  autoComplete="off"
                  value={fees}
                  onChange={(e) => setFees(e.target.value)}
                />
              </div>
              <p className="text-[10px] text-muted-foreground">
                {tForm("costsHint")}
              </p>
            </div>
            {isEstimate && (
              <Field
                label={t("closeRate", {
                  quote: spec?.quoteCurrency ?? "?",
                  currency: trade.accountCurrency,
                })}
                htmlFor="close-rate"
                className="sm:col-span-2"
              >
                <Input
                  id="close-rate"
                  inputMode="decimal"
                  autoComplete="off"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                />
              </Field>
            )}
            <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 sm:col-span-2">
              <Label
                htmlFor="close-manual"
                className="cursor-pointer font-normal"
              >
                {tForm("pnlManual")}
              </Label>
              <Switch
                id="close-manual"
                checked={useManual}
                onCheckedChange={setUseManual}
              />
            </div>
            {useManual && (
              <Field
                label={tForm("manualNetPnl")}
                htmlFor="close-manual-pnl"
                hint={t("closeManual")}
                className="sm:col-span-2"
              >
                <Input
                  id="close-manual-pnl"
                  inputMode="decimal"
                  autoComplete="off"
                  value={manualPnl}
                  onChange={(e) => setManualPnl(e.target.value)}
                />
              </Field>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={closeTrade.isPending}
              onClick={() => setCloseOpen(false)}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              disabled={closeTrade.isPending || !exitPrice.trim()}
              onClick={submitClose}
            >
              {closeTrade.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {closeTrade.isPending ? t("closing") : t("closeSubmit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation ── */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("confirmDeleteDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteTrade.isPending}>
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteTrade.isPending}
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
            >
              {deleteTrade.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {tCommon("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── v3: share link + PNG card export ── */}
      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        tradeId={trade.id}
        defaultTitle={`${trade.symbol} - ${labels.direction(trade.direction)}`}
      />
      <ExportCardDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        trade={trade}
      />
    </div>
  );
}

// ── Local helpers ────────────────────────────────────────────────────────────

function ReviewScoreField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={value == null ? "none" : String(value)} onValueChange={(v) => onChange(v === "none" ? null : Number(v))}>
        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Not rated</SelectItem>
          {[1, 2, 3, 4, 5].map((score) => <SelectItem key={score} value={String(score)}>{score} / 5</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function ReviewChoiceField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map(([option, title]) => <SelectItem key={option} value={option}>{title}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function ReviewTextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={4000}
        rows={3}
        className="flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      />
    </div>
  );
}

/** KPI tile (dashboard-style bordered card, big tabular number). */
function KpiCell({
  label,
  value,
  valueClassName = "",
  hint,
}: {
  label: string;
  value: React.ReactNode;
  valueClassName?: string;
  hint?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`font-bold tabular-nums ${valueClassName}`}>{value}</p>
      {hint}
    </div>
  );
}

/** Label / value row used inside the levels, context and psychology grids. */
function InfoRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

/** Small heading + pre-wrapped text block (analyses, notes). */
function TextBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="space-y-1">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </h4>
      <p className="whitespace-pre-wrap text-sm">{text}</p>
    </div>
  );
}
