"use client";

import * as React from "react";
import { Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { Money } from "@/components/privacy/money";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "@/components/app/session-context";
import { useAccounts } from "@/hooks/use-trading";
import {
  useCreatePropChallenge,
  useCreatePropExpense,
  useCreatePropFirmRuleSet,
  useCreatePropPayout,
  useCreatePropPhaseResult,
  useDeletePropChallenge,
  useDeletePropExpense,
  useDeletePropFirmRuleSet,
  useDeletePropPayout,
  usePropChallengeEvaluation,
  usePropFirmWorkspace,
  useUpdatePropChallenge,
  useUpdatePropExpense,
  useUpdatePropPayout,
} from "@/hooks/use-prop-firms";
import { ApiClientError } from "@/lib/api-client";
import { apiErrorMessage } from "@/lib/i18n-errors";
import type { AccountDTO } from "@/lib/trading/dto";
import type {
  PropChallengeDTO,
  PropExpenseDTO,
  PropFirmRuleSetDTO,
  PropPayoutDTO,
} from "@/lib/prop-firms/types";
import type { PropRuleEvaluation } from "@/lib/prop/engine";
import type {
  PropChallengeInput,
  PropExpenseInput,
  PropExpensePatch,
  PropFirmRuleSetInput,
  PropPayoutInput,
  PropPayoutPatch,
  PropPhaseResultInput,
  PropPhaseRuleInput,
} from "@/lib/validations/prop-firms";

const PHASES = ["PHASE_1", "PHASE_2", "FUNDED"] as const;
const STATUSES = ["IN_PROGRESS", "PASSED", "FAILED", "ABANDONED"] as const;
const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "CHF", "AUD", "NZD", "JPY"] as const;

function todayLocalDay(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isPhase(value: string): value is (typeof PHASES)[number] {
  return PHASES.some((phase) => phase === value);
}

function isStatus(value: string): value is (typeof STATUSES)[number] {
  return STATUSES.some((status) => status === value);
}

function isDrawdownType(value: string): value is PropPhaseRuleInput["drawdownType"] {
  return value === "STATIC" || value === "TRAILING" || value === "EQUITY_BASED" || value === "BALANCE_BASED";
}

function statusLabel(status: string, t: ReturnType<typeof useTranslations>): string {
  if (status === "PASSED") return t("passed");
  if (status === "FAILED") return t("failed");
  if (status === "ABANDONED") return t("abandoned");
  return t("active");
}

function phaseLabel(phase: string, t: ReturnType<typeof useTranslations>): string {
  if (phase === "PHASE_2") return t("phase2");
  if (phase === "FUNDED") return t("funded");
  return t("phase1");
}

function errorToast(
  error: unknown,
  tRoot: ReturnType<typeof useTranslations>,
  fallback: string,
  toast: (input: { title: string; variant?: "default" | "destructive" }) => void,
) {
  const apiError = error instanceof ApiClientError ? error : null;
  toast({
    title: apiErrorMessage(
      tRoot,
      apiError?.code,
      error instanceof Error ? error.message : fallback,
    ),
    variant: "destructive",
  });
}

// ── Lot 5 — live rule evaluation of one challenge ───────────────────────────

function evaluationRuleLabel(rule: string, t: ReturnType<typeof useTranslations>): string {
  switch (rule) {
    case "DAILY_LOSS": return t("ruleDailyLoss");
    case "TOTAL_DRAWDOWN": return t("ruleTotalDrawdown");
    case "PROFIT_TARGET": return t("ruleProfitTarget");
    case "MIN_TRADING_DAYS": return t("ruleMinTradingDays");
    case "MAX_TRADING_DAYS": return t("ruleMaxTradingDays");
    case "CONSISTENCY": return t("ruleConsistency");
    case "WEEKEND_HOLDING": return t("ruleWeekendHolding");
    case "NEWS_TRADING": return t("ruleNewsTrading");
    case "LEVERAGE": return t("ruleLeverage");
    default: return rule;
  }
}

function evaluationRuleStatusLabel(status: string, t: ReturnType<typeof useTranslations>): string {
  switch (status) {
    case "PASS": return t("rulePass");
    case "WARNING": return t("ruleWarning");
    case "IMMINENT": return t("ruleImminent");
    case "BREACH": return t("ruleBreach");
    case "PENDING": return t("rulePending");
    case "SKIPPED": return t("ruleSkipped");
    case "UNKNOWN": return t("ruleUnknown");
    default: return status;
  }
}

function evaluationRuleTone(status: string): string {
  switch (status) {
    case "BREACH": return "text-loss";
    case "IMMINENT": return "text-loss";
    case "WARNING": return "text-amber-700 dark:text-amber-400";
    case "PASS": return "text-gain";
    default: return "text-muted-foreground";
  }
}

function ChallengeEvaluation({ challengeId, currency }: { challengeId: string; currency: string }) {
  const t = useTranslations("propFirmsView");
  const { data, isLoading, isError } = usePropChallengeEvaluation(challengeId);

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (isError || !data?.evaluation) {
    return <p className="text-xs text-muted-foreground">{t("evaluationError")}</p>;
  }
  const evaluation = data.evaluation;
  const outcome = evaluation.phaseOutcome.outcome;
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">{t("evaluation")} · {phaseLabel(evaluation.phase, t)}</p>
        <Badge variant={outcome === "PASSED" ? "default" : outcome === "FAILED" ? "destructive" : "secondary"}>
          {outcome === "PASSED" ? t("phasePassedEval") : outcome === "FAILED" ? t("phaseFailedEval") : t("phaseInProgressEval")}
        </Badge>
      </div>
      <p className="text-xs tabular-nums text-muted-foreground">
        {t("currentEquityLabel")}: <Money value={evaluation.currentEquity} currency={currency} /> · {t("tradingDaysCount")}: {evaluation.tradingDays}
      </p>
      {evaluation.phaseOutcome.recommendedAction !== "NONE" ? (
        <p className="text-xs font-medium">
          {evaluation.phaseOutcome.recommendedAction === "MARK_PHASE_PASSED" ? t("recommendedMarkPassed") : t("recommendedMarkFailed")}
          {" — "}
          <span className="font-normal text-muted-foreground">{evaluation.phaseOutcome.reasons[0] ?? ""}</span>
        </p>
      ) : null}
      {evaluation.equityData === "CLOSED_ONLY" ? (
        <p className="text-xs text-muted-foreground">{t("equityClosedOnly")}</p>
      ) : null}
      <div className="space-y-2">
        {evaluation.rules.map((rule: PropRuleEvaluation) => (
          <div key={rule.rule} className="rounded-md border p-2 text-xs">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">{evaluationRuleLabel(rule.rule, t)}</span>
              <span className={evaluationRuleTone(rule.status)}>{evaluationRuleStatusLabel(rule.status, t)}</span>
            </div>
            <p className="mt-1 text-muted-foreground">{rule.detail}</p>
            {rule.used != null && rule.limit != null ? (
              <p className="mt-1 tabular-nums text-muted-foreground">{rule.used} / {rule.limit}</p>
            ) : null}
          </div>
        ))}
      </div>
      <p className="text-xs tabular-nums text-muted-foreground">
        {t("feeLabel")}: {evaluation.fees.challengeFee} {evaluation.fees.feeCurrency}
        {" · "}
        {t("expenseHistory")}: {evaluation.fees.totalExpenses} {evaluation.fees.feeCurrency}
        {" · "}
        {t("payoutHistory")}: {evaluation.fees.totalPayoutsNet} {evaluation.fees.feeCurrency}
      </p>
    </div>
  );
}

type ChallengeDraft = {
  accountId: string;
  ruleSetId: string;
  name: string;
  firm: string;
  accountSize: string;
  challengeFee: string;
  feeCurrency: string;
  purchaseDate: string;
  startDate: string;
  notes: string;
};

function ChallengeEditor({
  open,
  onOpenChange,
  accounts,
  ruleSets,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: AccountDTO[];
  ruleSets: PropFirmRuleSetDTO[];
}) {
  const t = useTranslations("propFirmsView");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const create = useCreatePropChallenge();
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState<ChallengeDraft>({
    accountId: "",
    ruleSetId: "",
    name: "",
    firm: "",
    accountSize: "",
    challengeFee: "0",
    feeCurrency: "USD",
    purchaseDate: "",
    startDate: todayLocalDay(),
    notes: "",
  });

  React.useEffect(() => {
    if (!open) return;
    setForm({
      accountId: "",
      ruleSetId: "",
      name: "",
      firm: "",
      accountSize: "",
      challengeFee: "0",
      feeCurrency: "USD",
      purchaseDate: todayLocalDay(),
      startDate: todayLocalDay(),
      notes: "",
    });
  }, [open]);

  const set = <K extends keyof ChallengeDraft>(key: K, value: ChallengeDraft[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const onSave = async () => {
    if (!form.accountId || !form.ruleSetId || !form.name.trim() || !form.firm.trim() || !form.accountSize.trim()) return;
    setSaving(true);
    try {
      const payload: PropChallengeInput = {
        accountId: form.accountId,
        ruleSetId: form.ruleSetId,
        name: form.name.trim(),
        firm: form.firm.trim(),
        accountSize: form.accountSize.trim(),
        challengeFee: form.challengeFee.trim() || "0",
        feeCurrency: form.feeCurrency,
        purchaseDate: form.purchaseDate || null,
        startDate: form.startDate,
        endDate: null,
        currentPhase: "PHASE_1",
        status: "IN_PROGRESS",
        notes: form.notes.trim() || null,
      };
      await create.mutateAsync(payload);
      toast({ title: t("created") });
      onOpenChange(false);
    } catch (error) {
      errorToast(error, tRoot, t("error"), toast);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("createChallengeTitle")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>{t("account")}</Label>
            <Select
              value={form.accountId}
              onValueChange={(value) => {
                const account = accounts.find((item) => item.id === value);
                set("accountId", value);
                if (account) {
                  set("accountSize", account.initialBalance);
                  set("feeCurrency", account.currency);
                }
              }}
            >
              <SelectTrigger><SelectValue placeholder={t("account")} /></SelectTrigger>
              <SelectContent>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>{account.name} · {account.currency}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>{t("ruleSet")}</Label>
            <Select
              value={form.ruleSetId}
              onValueChange={(value) => {
                const ruleSet = ruleSets.find((item) => item.id === value);
                set("ruleSetId", value);
                if (ruleSet) {
                  set("firm", ruleSet.firm);
                  if (!form.name.trim()) set("name", `${ruleSet.firm} evaluation`);
                }
              }}
            >
              <SelectTrigger><SelectValue placeholder={t("ruleSet")} /></SelectTrigger>
              <SelectContent>
                {ruleSets.map((ruleSet) => (
                  <SelectItem key={ruleSet.id} value={ruleSet.id}>{ruleSet.firm} · {ruleSet.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="prop-challenge-name">{t("name")}</Label>
            <Input id="prop-challenge-name" value={form.name} onChange={(event) => set("name", event.target.value)} maxLength={100} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prop-challenge-firm">{t("firm")}</Label>
            <Input id="prop-challenge-firm" value={form.firm} onChange={(event) => set("firm", event.target.value)} maxLength={80} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prop-challenge-size">{t("accountSize")}</Label>
            <Input id="prop-challenge-size" inputMode="decimal" value={form.accountSize} onChange={(event) => set("accountSize", event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prop-challenge-fee">{t("challengeFee")}</Label>
            <Input id="prop-challenge-fee" inputMode="decimal" value={form.challengeFee} onChange={(event) => set("challengeFee", event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("feeCurrency")}</Label>
            <Select value={form.feeCurrency} onValueChange={(value) => set("feeCurrency", value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CURRENCIES.map((currency) => <SelectItem key={currency} value={currency}>{currency}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prop-purchase-date">{t("purchaseDate")}</Label>
            <Input id="prop-purchase-date" type="date" value={form.purchaseDate} onChange={(event) => set("purchaseDate", event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prop-start-date">{t("startDate")}</Label>
            <Input id="prop-start-date" type="date" value={form.startDate} onChange={(event) => set("startDate", event.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="prop-challenge-notes">{t("notes")}</Label>
            <Input id="prop-challenge-notes" value={form.notes} onChange={(event) => set("notes", event.target.value)} maxLength={3000} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
          <Button onClick={() => void onSave()} disabled={saving || !accounts.length || !ruleSets.length}>{t("save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type PhaseDraft = {
  profitTargetPercent: string;
  maxDailyLossPercent: string;
  maxTotalDrawdownPercent: string;
  drawdownType: PropPhaseRuleInput["drawdownType"];
  minTradingDays: string;
  maxTradingDays: string;
  consistencyRulePercent: string;
  newsTradingRestricted: boolean;
  weekendHoldingAllowed: boolean;
  leverage: string;
};

const DEFAULT_PHASE: PhaseDraft = {
  profitTargetPercent: "8",
  maxDailyLossPercent: "5",
  maxTotalDrawdownPercent: "10",
  drawdownType: "STATIC",
  minTradingDays: "5",
  maxTradingDays: "30",
  consistencyRulePercent: "",
  newsTradingRestricted: false,
  weekendHoldingAllowed: false,
  leverage: "100",
};

function makePhaseRule(phase: "PHASE_1" | "PHASE_2", draft: PhaseDraft): PropPhaseRuleInput {
  return {
    phase,
    profitTargetPercent: draft.profitTargetPercent,
    maxDailyLossPercent: draft.maxDailyLossPercent || null,
    maxTotalDrawdownPercent: draft.maxTotalDrawdownPercent || null,
    drawdownType: draft.drawdownType,
    minTradingDays: Number(draft.minTradingDays),
    maxTradingDays: draft.maxTradingDays ? Number(draft.maxTradingDays) : null,
    consistencyRulePercent: draft.consistencyRulePercent || null,
    newsTradingRestricted: draft.newsTradingRestricted,
    weekendHoldingAllowed: draft.weekendHoldingAllowed,
    leverage: draft.leverage || null,
  };
}

function RuleSetEditor({
  open,
  onOpenChange,
  timezone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timezone: string;
}) {
  const t = useTranslations("propFirmsView");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const create = useCreatePropFirmRuleSet();
  const [saving, setSaving] = React.useState(false);
  const [name, setName] = React.useState("");
  const [firm, setFirm] = React.useState("");
  const [resetTimeLocal, setResetTimeLocal] = React.useState("00:00");
  const [timezoneValue, setTimezoneValue] = React.useState(timezone || "UTC");
  const [includePhase2, setIncludePhase2] = React.useState(true);
  const [phase1, setPhase1] = React.useState<PhaseDraft>(DEFAULT_PHASE);
  const [phase2, setPhase2] = React.useState<PhaseDraft>({ ...DEFAULT_PHASE, profitTargetPercent: "5" });

  React.useEffect(() => {
    if (!open) return;
    setName("");
    setFirm("");
    setResetTimeLocal("00:00");
    setTimezoneValue(timezone || "UTC");
    setIncludePhase2(true);
    setPhase1(DEFAULT_PHASE);
    setPhase2({ ...DEFAULT_PHASE, profitTargetPercent: "5" });
  }, [open, timezone]);

  const onSave = async () => {
    if (!name.trim() || !firm.trim()) return;
    setSaving(true);
    try {
      const payload: PropFirmRuleSetInput = {
        name: name.trim(),
        firm: firm.trim(),
        phases: [
          makePhaseRule("PHASE_1", phase1),
          ...(includePhase2 ? [makePhaseRule("PHASE_2", phase2)] : []),
        ],
        resetTimeLocal,
        timezone: timezoneValue,
        notes: null,
      };
      await create.mutateAsync(payload);
      toast({ title: t("created") });
      onOpenChange(false);
    } catch (error) {
      errorToast(error, tRoot, t("error"), toast);
    } finally {
      setSaving(false);
    }
  };

  const phaseFields = (
    title: string,
    draft: PhaseDraft,
    update: React.Dispatch<React.SetStateAction<PhaseDraft>>,
    prefix: string,
  ) => {
    const set = <K extends keyof PhaseDraft>(key: K, value: PhaseDraft[K]) =>
      update((current) => ({ ...current, [key]: value }));
    return (
      <div className="space-y-3 rounded-lg border p-3">
        <p className="text-sm font-semibold">{title}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor={`${prefix}-target`}>{t("profitTarget")}</Label><Input id={`${prefix}-target`} inputMode="decimal" value={draft.profitTargetPercent} onChange={(event) => set("profitTargetPercent", event.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor={`${prefix}-daily`}>{t("dailyLoss")}</Label><Input id={`${prefix}-daily`} inputMode="decimal" value={draft.maxDailyLossPercent} onChange={(event) => set("maxDailyLossPercent", event.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor={`${prefix}-drawdown`}>{t("maxDrawdown")}</Label><Input id={`${prefix}-drawdown`} inputMode="decimal" value={draft.maxTotalDrawdownPercent} onChange={(event) => set("maxTotalDrawdownPercent", event.target.value)} /></div>
          <div className="space-y-1">
            <Label>{t("drawdownType")}</Label>
            <Select value={draft.drawdownType} onValueChange={(value) => { if (isDrawdownType(value)) set("drawdownType", value); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="STATIC">{t("static")}</SelectItem>
                <SelectItem value="TRAILING">{t("trailing")}</SelectItem>
                <SelectItem value="EQUITY_BASED">{t("equityBased")}</SelectItem>
                <SelectItem value="BALANCE_BASED">{t("balanceBased")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label htmlFor={`${prefix}-min-days`}>{t("minTradingDays")}</Label><Input id={`${prefix}-min-days`} type="number" min="0" max="365" value={draft.minTradingDays} onChange={(event) => set("minTradingDays", event.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor={`${prefix}-max-days`}>{t("maxTradingDays")}</Label><Input id={`${prefix}-max-days`} type="number" min="1" max="365" value={draft.maxTradingDays} onChange={(event) => set("maxTradingDays", event.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor={`${prefix}-consistency`}>{t("consistency")}</Label><Input id={`${prefix}-consistency`} inputMode="decimal" value={draft.consistencyRulePercent} onChange={(event) => set("consistencyRulePercent", event.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor={`${prefix}-leverage`}>{t("leverage")}</Label><Input id={`${prefix}-leverage`} inputMode="decimal" value={draft.leverage} onChange={(event) => set("leverage", event.target.value)} /></div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.newsTradingRestricted} onChange={(event) => set("newsTradingRestricted", event.target.checked)} />{t("newsRestricted")}</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.weekendHoldingAllowed} onChange={(event) => set("weekendHoldingAllowed", event.target.checked)} />{t("weekendAllowed")}</label>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("createRuleSetTitle")}</DialogTitle>
          <DialogDescription>{t("phaseRules")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label htmlFor="prop-rule-name">{t("ruleSetName")}</Label><Input id="prop-rule-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} /></div>
            <div className="space-y-1"><Label htmlFor="prop-rule-firm">{t("firm")}</Label><Input id="prop-rule-firm" value={firm} onChange={(event) => setFirm(event.target.value)} maxLength={80} /></div>
            <div className="space-y-1"><Label htmlFor="prop-rule-reset">{t("resetTime")}</Label><Input id="prop-rule-reset" type="time" value={resetTimeLocal} onChange={(event) => setResetTimeLocal(event.target.value)} /></div>
            <div className="space-y-1"><Label htmlFor="prop-rule-timezone">{t("timezone")}</Label><Input id="prop-rule-timezone" value={timezoneValue} onChange={(event) => setTimezoneValue(event.target.value)} maxLength={64} /></div>
          </div>
          {phaseFields(t("phase1"), phase1, setPhase1, "prop-phase1")}
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={includePhase2} onChange={(event) => setIncludePhase2(event.target.checked)} />
            {t("includePhase2")}
          </label>
          {includePhase2 ? phaseFields(t("phase2"), phase2, setPhase2, "prop-phase2") : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
          <Button onClick={() => void onSave()} disabled={saving || !name.trim() || !firm.trim()}>{t("save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PhaseResultEditor({
  challenge,
  open,
  onOpenChange,
}: {
  challenge: PropChallengeDTO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("propFirmsView");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const create = useCreatePropPhaseResult();
  const [phase, setPhase] = React.useState<PropPhaseResultInput["phase"]>("PHASE_1");
  const [result, setResult] = React.useState<PropPhaseResultInput["result"]>("IN_PROGRESS");
  const [startDate, setStartDate] = React.useState(todayLocalDay());
  const [endDate, setEndDate] = React.useState("");
  const [startingBalance, setStartingBalance] = React.useState("");
  const [endingBalance, setEndingBalance] = React.useState("");
  const [tradingDaysCount, setTradingDaysCount] = React.useState("0");
  const [failReason, setFailReason] = React.useState<PropPhaseResultInput["failReason"]>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const initial = challenge?.currentPhase;
    setPhase(initial && isPhase(initial) ? initial : "PHASE_1");
    setResult("IN_PROGRESS");
    setStartDate(todayLocalDay());
    setEndDate("");
    setStartingBalance(challenge?.accountSize ?? "");
    setEndingBalance("");
    setTradingDaysCount("0");
    setFailReason(null);
  }, [open, challenge]);

  const onSave = async () => {
    if (!challenge) return;
    setSaving(true);
    try {
      const payload: PropPhaseResultInput = {
        phase,
        result,
        startDate: startDate || null,
        endDate: endDate || null,
        startingBalance: startingBalance.trim() || null,
        endingBalance: endingBalance.trim() || null,
        tradingDaysCount: Number(tradingDaysCount || 0),
        failReason: result === "FAILED" ? failReason : null,
      };
      await create.mutateAsync({ challengeId: challenge.id, input: payload });
      toast({ title: t("created") });
      onOpenChange(false);
    } catch (error) {
      errorToast(error, tRoot, t("error"), toast);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{t("phaseResultTitle")}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label>{t("phase")}</Label><Select value={phase} onValueChange={(value) => { if (isPhase(value)) setPhase(value); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PHASES.map((item) => <SelectItem key={item} value={item}>{phaseLabel(item, t)}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label>{t("result")}</Label><Select value={result} onValueChange={(value) => { if (value === "PASSED" || value === "FAILED" || value === "IN_PROGRESS") setResult(value); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="IN_PROGRESS">{t("inProgress")}</SelectItem><SelectItem value="PASSED">{t("phasePassed")}</SelectItem><SelectItem value="FAILED">{t("phaseFailed")}</SelectItem></SelectContent></Select></div>
          <div className="space-y-1"><Label>{t("phaseStart")}</Label><Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></div>
          <div className="space-y-1"><Label>{t("phaseEnd")}</Label><Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></div>
          <div className="space-y-1"><Label>{t("startingBalance")}</Label><Input inputMode="decimal" value={startingBalance} onChange={(event) => setStartingBalance(event.target.value)} /></div>
          <div className="space-y-1"><Label>{t("endingBalance")}</Label><Input inputMode="decimal" value={endingBalance} onChange={(event) => setEndingBalance(event.target.value)} /></div>
          <div className="space-y-1"><Label>{t("tradingDays")}</Label><Input type="number" min="0" value={tradingDaysCount} onChange={(event) => setTradingDaysCount(event.target.value)} /></div>
          {result === "FAILED" ? <div className="space-y-1"><Label>{t("failReason")}</Label><Select value={failReason ?? "OTHER"} onValueChange={(value) => { if (value === "MAX_DAILY_LOSS" || value === "MAX_DRAWDOWN" || value === "TIME_LIMIT" || value === "RULE_VIOLATION" || value === "OTHER") setFailReason(value); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="MAX_DAILY_LOSS">{t("maxDailyLoss")}</SelectItem><SelectItem value="MAX_DRAWDOWN">{t("maxDrawdownReason")}</SelectItem><SelectItem value="TIME_LIMIT">{t("timeLimit")}</SelectItem><SelectItem value="RULE_VIOLATION">{t("ruleViolation")}</SelectItem><SelectItem value="OTHER">{t("other")}</SelectItem></SelectContent></Select></div> : null}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>{t("cancel")}</Button><Button onClick={() => void onSave()} disabled={saving}>{t("save")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PayoutEditor({
  challenge,
  open,
  onOpenChange,
  editing,
}: {
  challenge: PropChallengeDTO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: PropPayoutDTO | null;
}) {
  const t = useTranslations("propFirmsView");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const create = useCreatePropPayout();
  const update = useUpdatePropPayout();
  const [grossAmount, setGrossAmount] = React.useState("");
  const [profitSplitPercent, setProfitSplitPercent] = React.useState("80");
  const [currency, setCurrency] = React.useState("USD");
  const [requestedAt, setRequestedAt] = React.useState(todayLocalDay());
  const [receivedAt, setReceivedAt] = React.useState("");
  const [method, setMethod] = React.useState("");
  const [status, setStatus] = React.useState<PropPayoutInput["status"]>("REQUESTED");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    if (editing) {
      setGrossAmount(editing.grossAmount);
      setProfitSplitPercent(editing.profitSplitPercent);
      setCurrency(editing.currency);
      setRequestedAt(editing.requestedAt.slice(0, 10));
      setReceivedAt(editing.receivedAt?.slice(0, 10) ?? "");
      setMethod(editing.method ?? "");
      setStatus(editing.status === "RECEIVED" || editing.status === "REJECTED" ? editing.status : "REQUESTED");
      return;
    }
    setGrossAmount("");
    setProfitSplitPercent("80");
    setCurrency(challenge?.accountCurrency ?? "USD");
    setRequestedAt(todayLocalDay());
    setReceivedAt("");
    setMethod("");
    setStatus("REQUESTED");
  }, [open, challenge, editing]);

  const onSave = async () => {
    if (!challenge || !grossAmount.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        const patch: PropPayoutPatch = {
          grossAmount: grossAmount.trim(),
          profitSplitPercent: Number(profitSplitPercent),
          currency,
          requestedAt,
          receivedAt: receivedAt || null,
          method: method.trim() || null,
          status,
        };
        await update.mutateAsync({ challengeId: challenge.id, payoutId: editing.id, patch });
        toast({ title: t("updated") });
      } else {
        const payload: PropPayoutInput = {
          grossAmount: grossAmount.trim(),
          profitSplitPercent: Number(profitSplitPercent),
          currency,
          requestedAt,
          receivedAt: receivedAt || null,
          method: method.trim() || null,
          status,
          note: null,
        };
        await create.mutateAsync({ challengeId: challenge.id, input: payload });
        toast({ title: t("created") });
      }
      onOpenChange(false);
    } catch (error) {
      errorToast(error, tRoot, t("error"), toast);
    } finally {
      setSaving(false);
    }
  };

  const estimatedNet = Number(grossAmount) * Number(profitSplitPercent) / 100;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{editing ? t("editPayout") : t("payoutTitle")}</DialogTitle><DialogDescription>{t("payoutSplitHint")}</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label>{t("grossAmount")}</Label><Input inputMode="decimal" value={grossAmount} onChange={(event) => setGrossAmount(event.target.value)} /></div>
          <div className="space-y-1"><Label>{t("profitSplit")}</Label><Input type="number" min="0" max="100" value={profitSplitPercent} onChange={(event) => setProfitSplitPercent(event.target.value)} /></div>
          <div className="space-y-1"><Label>{t("feeCurrency")}</Label><Select value={currency} onValueChange={setCurrency}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CURRENCIES.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label>{t("payoutStatus")}</Label><Select value={status} onValueChange={(value) => { if (value === "REQUESTED" || value === "RECEIVED" || value === "REJECTED") setStatus(value); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="REQUESTED">{t("requested")}</SelectItem><SelectItem value="RECEIVED">{t("received")}</SelectItem><SelectItem value="REJECTED">{t("rejected")}</SelectItem></SelectContent></Select></div>
          <div className="space-y-1"><Label>{t("requestedAt")}</Label><Input type="date" value={requestedAt} onChange={(event) => setRequestedAt(event.target.value)} /></div>
          <div className="space-y-1"><Label>{t("receivedAt")}</Label><Input type="date" value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} /></div>
          <div className="space-y-1 sm:col-span-2"><Label>{t("method")}</Label><Input value={method} onChange={(event) => setMethod(event.target.value)} maxLength={80} /></div>
          <div className="sm:col-span-2 rounded-md bg-muted/50 p-3 text-sm">{t("netAmount")}: <strong className="tabular-nums">{Number.isFinite(estimatedNet) ? estimatedNet.toFixed(2) : "—"} {currency}</strong></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>{t("cancel")}</Button><Button onClick={() => void onSave()} disabled={saving || !grossAmount.trim()}>{t("save")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExpenseEditor({
  challenge,
  open,
  onOpenChange,
  editing,
}: {
  challenge: PropChallengeDTO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: PropExpenseDTO | null;
}) {
  const t = useTranslations("propFirmsView");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const create = useCreatePropExpense();
  const update = useUpdatePropExpense();
  const [type, setType] = React.useState<PropExpenseInput["type"]>("FEE");
  const [amount, setAmount] = React.useState("");
  const [currency, setCurrency] = React.useState("USD");
  const [date, setDate] = React.useState(todayLocalDay());
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    if (editing) {
      setType(editing.type === "RESET" || editing.type === "ADDON" || editing.type === "OTHER" ? editing.type : "FEE");
      setAmount(editing.amount);
      setCurrency(editing.currency);
      setDate(editing.date);
      setNote(editing.note ?? "");
      return;
    }
    setType("FEE");
    setAmount("");
    setCurrency(challenge?.feeCurrency ?? "USD");
    setDate(todayLocalDay());
    setNote("");
  }, [open, challenge, editing]);

  const onSave = async () => {
    if (!challenge || !amount.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        const patch: PropExpensePatch = {
          type,
          amount: amount.trim(),
          currency,
          date,
          note: note.trim() || null,
        };
        await update.mutateAsync({ challengeId: challenge.id, expenseId: editing.id, patch });
        toast({ title: t("updated") });
      } else {
        await create.mutateAsync({
          challengeId: challenge.id,
          input: { type, amount: amount.trim(), currency, date, note: note.trim() || null },
        });
        toast({ title: t("created") });
      }
      onOpenChange(false);
    } catch (error) {
      errorToast(error, tRoot, t("error"), toast);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{editing ? t("editExpense") : t("expenseTitle")}</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label>{t("expenseType")}</Label><Select value={type} onValueChange={(value) => { if (value === "FEE" || value === "RESET" || value === "ADDON" || value === "OTHER") setType(value); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="FEE">{t("fee")}</SelectItem><SelectItem value="RESET">{t("reset")}</SelectItem><SelectItem value="ADDON">{t("addon")}</SelectItem><SelectItem value="OTHER">{t("other")}</SelectItem></SelectContent></Select></div>
          <div className="space-y-1"><Label>{t("amount")}</Label><Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
          <div className="space-y-1"><Label>{t("feeCurrency")}</Label><Select value={currency} onValueChange={setCurrency}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CURRENCIES.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label>{t("date")}</Label><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
          <div className="space-y-1 sm:col-span-2"><Label>{t("note")}</Label><Input value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>{t("cancel")}</Button><Button onClick={() => void onSave()} disabled={saving || !amount.trim()}>{t("save")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ChallengeCard({
  challenge,
  onPhase,
  onPayout,
  onExpense,
  onEditPayout,
  onEditExpense,
}: {
  challenge: PropChallengeDTO;
  onPhase: (challenge: PropChallengeDTO) => void;
  onPayout: (challenge: PropChallengeDTO) => void;
  onExpense: (challenge: PropChallengeDTO) => void;
  onEditPayout: (payout: PropPayoutDTO, challenge: PropChallengeDTO) => void;
  onEditExpense: (expense: PropExpenseDTO, challenge: PropChallengeDTO) => void;
}) {
  const t = useTranslations("propFirmsView");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const update = useUpdatePropChallenge();
  const remove = useDeletePropChallenge();
  const removePayout = useDeletePropPayout();
  const removeExpense = useDeletePropExpense();
  const [saving, setSaving] = React.useState(false);

  const deletePayout = async (payoutId: string) => {
    if (!window.confirm(t("deletePayoutConfirm"))) return;
    try {
      await removePayout.mutateAsync({ challengeId: challenge.id, payoutId });
      toast({ title: t("deleted") });
    } catch (error) {
      errorToast(error, tRoot, t("error"), toast);
    }
  };

  const deleteExpense = async (expenseId: string) => {
    if (!window.confirm(t("deleteExpenseConfirm"))) return;
    try {
      await removeExpense.mutateAsync({ challengeId: challenge.id, expenseId });
      toast({ title: t("deleted") });
    } catch (error) {
      errorToast(error, tRoot, t("error"), toast);
    }
  };

  const changeStatus = async (value: string) => {
    if (!isStatus(value)) return;
    try {
      await update.mutateAsync({
        id: challenge.id,
        patch: {
          status: value,
          ...(value === "PASSED" || value === "FAILED" || value === "ABANDONED"
            ? { currentPhase: value, endDate: todayLocalDay() }
            : {}),
        },
      });
    } catch (error) {
      errorToast(error, tRoot, t("error"), toast);
    }
  };

  const deleteChallenge = async () => {
    if (!window.confirm(t("deleteConfirm"))) return;
    setSaving(true);
    try {
      await remove.mutateAsync(challenge.id);
      toast({ title: t("deleted") });
    } catch (error) {
      errorToast(error, tRoot, t("error"), toast);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base">{challenge.name}</CardTitle>
            <CardDescription>{challenge.firm} · {challenge.accountName}</CardDescription>
          </div>
          <Badge variant={challenge.status === "PASSED" ? "default" : challenge.status === "FAILED" ? "destructive" : "secondary"}>
            {statusLabel(challenge.status, t)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div><p className="text-xs text-muted-foreground">{t("size")}</p><p className="text-sm font-semibold tabular-nums"><Money value={challenge.accountSize} currency={challenge.accountCurrency} /></p></div>
          <div><p className="text-xs text-muted-foreground">{t("feeLabel")}</p><p className="text-sm font-semibold tabular-nums"><Money value={challenge.challengeFee} currency={challenge.feeCurrency} /></p></div>
          <div><p className="text-xs text-muted-foreground">{t("currentPhaseLabel")}</p><p className="text-sm font-semibold">{phaseLabel(challenge.currentPhase, t)}</p></div>
          <div><p className="text-xs text-muted-foreground">{t("startDate")}</p><p className="text-sm font-semibold tabular-nums">{challenge.startDate}</p></div>
        </div>

        <ChallengeEvaluation challengeId={challenge.id} currency={challenge.accountCurrency} />

        <div className="flex flex-wrap items-center gap-2">
          <Label className="text-xs text-muted-foreground">{t("updateStatus")}</Label>
          <Select value={challenge.status} onValueChange={(value) => void changeStatus(value)}>
            <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="IN_PROGRESS">{t("active")}</SelectItem>
              <SelectItem value="PASSED">{t("passed")}</SelectItem>
              <SelectItem value="FAILED">{t("failed")}</SelectItem>
              <SelectItem value="ABANDONED">{t("abandoned")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-2">
            <p className="text-sm font-semibold">{t("phaseHistory")}</p>
            {challenge.phaseResults.length === 0 ? <p className="text-xs text-muted-foreground">{t("noPhaseHistory")}</p> : challenge.phaseResults.map((phase) => (
              <div key={phase.id} className="rounded-md border p-2 text-xs">
                <div className="flex justify-between gap-2"><span className="font-medium">{phaseLabel(phase.phase, t)}</span><span className="text-muted-foreground">{phase.result}</span></div>
                <p className="mt-1 text-muted-foreground">{phase.startDate ?? "—"} → {phase.endDate ?? "—"} · {phase.tradingDaysCount} {t("tradingDays").toLowerCase()}</p>
                {phase.endingBalance ? <p className="mt-1 tabular-nums">{t("endingBalance")}: {phase.endingBalance} {challenge.accountCurrency}</p> : null}
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-semibold">{t("payoutHistory")}</p>
            {challenge.payouts.length === 0 ? <p className="text-xs text-muted-foreground">{t("noPayouts")}</p> : challenge.payouts.map((payout) => (
              <div key={payout.id} className="rounded-md border p-2 text-xs">
                <div className="flex justify-between gap-2"><span className="font-medium">{payout.status}</span><span className="text-muted-foreground">{payout.requestedAt.slice(0, 10)}</span></div>
                <p className="mt-1 tabular-nums">{t("grossAmount")}: {payout.grossAmount} {payout.currency}</p>
                <p className="tabular-nums">{t("netAmount")}: <strong>{payout.netAmount} {payout.currency}</strong></p>
                <div className="mt-1 flex gap-1">
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => onEditPayout(payout, challenge)}><Pencil className="mr-1 h-3 w-3" />{t("edit")}</Button>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-destructive" onClick={() => void deletePayout(payout.id)}><Trash2 className="mr-1 h-3 w-3" />{t("delete")}</Button>
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-semibold">{t("expenseHistory")}</p>
            {challenge.expenses.length === 0 ? <p className="text-xs text-muted-foreground">{t("noExpenses")}</p> : challenge.expenses.map((expense) => (
              <div key={expense.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-xs">
                <span>{expense.type} · {expense.date}</span>
                <span className="flex items-center gap-1">
                  <strong className="tabular-nums">{expense.amount} {expense.currency}</strong>
                  <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs" onClick={() => onEditExpense(expense, challenge)} aria-label={t("editExpense")}><Pencil className="h-3 w-3" /></Button>
                  <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs text-destructive" onClick={() => void deleteExpense(expense.id)} aria-label={t("deleteExpense")}><Trash2 className="h-3 w-3" /></Button>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-t pt-3">
          <Button size="sm" variant="outline" onClick={() => onPhase(challenge)}>{t("recordPhase")}</Button>
          <Button size="sm" variant="outline" onClick={() => onPayout(challenge)}>{t("recordPayout")}</Button>
          <Button size="sm" variant="outline" onClick={() => onExpense(challenge)}>{t("addExpense")}</Button>
          <Button size="sm" variant="ghost" className="ml-auto text-destructive" disabled={saving} onClick={() => void deleteChallenge()}><Trash2 className="mr-1 h-3.5 w-3.5" />{t("deleteChallenge")}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RuleSetCard({ ruleSet }: { ruleSet: PropFirmRuleSetDTO }) {
  const t = useTranslations("propFirmsView");
  const tRoot = useTranslations();
  const { toast } = useToast();
  const remove = useDeletePropFirmRuleSet();
  const [saving, setSaving] = React.useState(false);

  const onDelete = async () => {
    if (ruleSet.isGlobal || !window.confirm(t("deleteConfirm"))) return;
    setSaving(true);
    try {
      await remove.mutateAsync(ruleSet.id);
      toast({ title: t("deleted") });
    } catch (error) {
      errorToast(error, tRoot, t("error"), toast);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div><CardTitle className="text-base">{ruleSet.name}</CardTitle><CardDescription>{ruleSet.firm}</CardDescription></div>
          <Badge variant="outline">{ruleSet.isGlobal ? t("global") : t("personal")}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">{t("resetTime")}: {ruleSet.resetTimeLocal} · {ruleSet.timezone}</p>
        {ruleSet.phases.map((phase) => (
          <div key={phase.phase} className="flex flex-wrap justify-between gap-2 rounded-md border p-2 text-xs">
            <span className="font-medium">{phaseLabel(phase.phase, t)}</span>
            <span className="tabular-nums">{t("profitTarget")}: {phase.profitTargetPercent}%</span>
            <span className="tabular-nums">{t("dailyLoss")}: {phase.maxDailyLossPercent ?? "—"}%</span>
            <span className="tabular-nums">{t("maxDrawdown")}: {phase.maxTotalDrawdownPercent ?? "—"}%</span>
          </div>
        ))}
        {!ruleSet.isGlobal ? <div className="flex justify-end"><Button size="sm" variant="ghost" className="text-destructive" disabled={saving} onClick={() => void onDelete()}><Trash2 className="mr-1 h-3.5 w-3.5" />{t("deleteRuleSet")}</Button></div> : null}
      </CardContent>
    </Card>
  );
}

export function PropFirmsView() {
  const t = useTranslations("propFirmsView");
  const { data, isLoading, isError, refetch } = usePropFirmWorkspace();
  const { data: accounts = [] } = useAccounts();
  const { session } = useSession();
  const [challengeOpen, setChallengeOpen] = React.useState(false);
  const [ruleSetOpen, setRuleSetOpen] = React.useState(false);
  const [activeChallenge, setActiveChallenge] = React.useState<PropChallengeDTO | null>(null);
  const [phaseOpen, setPhaseOpen] = React.useState(false);
  const [payoutOpen, setPayoutOpen] = React.useState(false);
  const [expenseOpen, setExpenseOpen] = React.useState(false);
  const [editingPayout, setEditingPayout] = React.useState<PropPayoutDTO | null>(null);
  const [editingExpense, setEditingExpense] = React.useState<PropExpenseDTO | null>(null);

  const propAccounts = accounts.filter((account) => account.type === "PROP");
  const ruleSets = data?.ruleSets ?? [];
  const challenges = data?.challenges ?? [];
  const timezone = session?.profile.timezone ?? "UTC";

  const openDialog = (kind: "phase" | "payout" | "expense", challenge: PropChallengeDTO) => {
    setActiveChallenge(challenge);
    setEditingPayout(null);
    setEditingExpense(null);
    setPhaseOpen(kind === "phase");
    setPayoutOpen(kind === "payout");
    setExpenseOpen(kind === "expense");
  };

  const openEditPayout = (payout: PropPayoutDTO, challenge: PropChallengeDTO) => {
    setActiveChallenge(challenge);
    setEditingPayout(payout);
    setPayoutOpen(true);
  };

  const openEditExpense = (expense: PropExpenseDTO, challenge: PropChallengeDTO) => {
    setActiveChallenge(challenge);
    setEditingExpense(expense);
    setExpenseOpen(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <Button variant="outline" onClick={() => setRuleSetOpen(true)}><Plus className="mr-1 h-4 w-4" />{t("addRuleSet")}</Button>
            <Button onClick={() => setChallengeOpen(true)} disabled={!propAccounts.length || !ruleSets.length}><Plus className="mr-1 h-4 w-4" />{t("addChallenge")}</Button>
          </>
        }
      />

      {!propAccounts.length ? <Card><CardContent className="flex items-center gap-3 py-4 text-sm text-muted-foreground"><ShieldCheck className="h-5 w-5 shrink-0" />{t("noPropAccount")}</CardContent></Card> : null}
      {propAccounts.length > 0 && ruleSets.length === 0 ? <Card><CardContent className="py-4 text-sm text-muted-foreground">{t("createRuleFirst")}</CardContent></Card> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">{t("active")}</p><p className="text-2xl font-semibold tabular-nums">{challenges.filter((item) => item.status === "IN_PROGRESS").length}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">{t("passed")}</p><p className="text-2xl font-semibold tabular-nums">{challenges.filter((item) => item.status === "PASSED").length}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">{t("ruleSets")}</p><p className="text-2xl font-semibold tabular-nums">{ruleSets.length}</p></CardContent></Card>
      </div>

      <section className="space-y-3" aria-labelledby="prop-challenges-heading">
        <h2 id="prop-challenges-heading" className="text-sm font-semibold">{t("challenges")}</h2>
        {isLoading ? <div className="space-y-3"><Skeleton className="h-36 w-full" /><Skeleton className="h-36 w-full" /></div> : null}
        {isError ? <Card><CardContent className="flex items-center justify-between gap-3 py-4 text-sm"><span>{t("error")}</span><Button variant="outline" size="sm" onClick={() => void refetch()}>{t("save")}</Button></CardContent></Card> : null}
        {!isLoading && !isError && challenges.length === 0 ? <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">{t("emptyChallenges")}</CardContent></Card> : null}
        <div className="space-y-3">
          {challenges.map((challenge) => (
            <ChallengeCard
              key={challenge.id}
              challenge={challenge}
              onPhase={(item) => openDialog("phase", item)}
              onPayout={(item) => openDialog("payout", item)}
              onExpense={(item) => openDialog("expense", item)}
              onEditPayout={openEditPayout}
              onEditExpense={openEditExpense}
            />
          ))}
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="prop-rules-heading">
        <h2 id="prop-rules-heading" className="text-sm font-semibold">{t("ruleSets")}</h2>
        {ruleSets.length === 0 ? <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">{t("emptyRuleSets")}</CardContent></Card> : null}
        <div className="grid gap-3 lg:grid-cols-2">
          {ruleSets.map((ruleSet) => <RuleSetCard key={ruleSet.id} ruleSet={ruleSet} />)}
        </div>
      </section>

      <ChallengeEditor open={challengeOpen} onOpenChange={setChallengeOpen} accounts={propAccounts} ruleSets={ruleSets} />
      <RuleSetEditor open={ruleSetOpen} onOpenChange={setRuleSetOpen} timezone={timezone} />
      <PhaseResultEditor challenge={activeChallenge} open={phaseOpen} onOpenChange={setPhaseOpen} />
      <PayoutEditor
        challenge={activeChallenge}
        open={payoutOpen}
        onOpenChange={(open) => { if (!open) setEditingPayout(null); setPayoutOpen(open); }}
        editing={editingPayout}
      />
      <ExpenseEditor
        challenge={activeChallenge}
        open={expenseOpen}
        onOpenChange={(open) => { if (!open) setEditingExpense(null); setExpenseOpen(open); }}
        editing={editingExpense}
      />
    </div>
  );
}

