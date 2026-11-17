/**
 * v2.5 Module 5 (f) - partial exit plans (ExitPlan CRUD).
 *
 * Tiers: close pct% at a price target or an R multiple (sum = 100%).
 * Optional breakeven move and trailing start after a given tier.
 * Plans are attached to a trade from the trade detail page
 * (Trade.exitPlanId, written through the trade API).
 */
"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { validateExitPlan } from "@/lib/tools/exit-plans";
import {
  isToolsTablesMissing,
  useCreateExitPlan,
  useDeleteExitPlan,
  useExitPlans,
  useUpdateExitPlan,
} from "@/hooks/use-tools";
import type { ExitPlanEntry, ExitPlanTier } from "@/lib/tools/types";
import { ToolsUnavailable } from "./shared";
import { fmtNum } from "@/lib/format";

interface DraftTier extends ExitPlanTier {
  key: string;
}

function toDraft(plan: ExitPlanEntry | null): {
  name: string;
  tiers: DraftTier[];
  breakeven: string;
  trailing: string;
  notes: string;
} {
  return {
    name: plan?.name ?? "",
    tiers: (plan?.tiers ?? [{ pct: 50, targetType: "PRICE", target: "" }]).map(
      (tier, i) => ({ ...tier, key: `tier-${i}-${Date.now()}` })
    ),
    breakeven: plan?.breakevenAfterTier === null || plan?.breakevenAfterTier === undefined
      ? ""
      : String(plan.breakevenAfterTier),
    trailing: plan?.trailingAfterTier === null || plan?.trailingAfterTier === undefined
      ? ""
      : String(plan.trailingAfterTier),
    notes: plan?.notes ?? "",
  };
}

export function ExitPlansManager() {
  const t = useTranslations("tools");
  const plansQuery = useExitPlans();
  const plans = plansQuery.data ?? [];
  const createPlan = useCreateExitPlan();
  const updatePlan = useUpdateExitPlan();
  const deletePlan = useDeleteExitPlan();
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState(() => toDraft(null));
  const [error, setError] = React.useState<string | null>(null);

  const startNew = () => {
    setEditingId("new");
    setDraft(toDraft(null));
    setError(null);
  };

  const startEdit = (plan: ExitPlanEntry) => {
    setEditingId(plan.id);
    setDraft(toDraft(plan));
    setError(null);
  };

  const save = () => {
    const tiers: ExitPlanTier[] = draft.tiers.map((tier) => ({
      pct: Number(tier.pct) || 0,
      targetType: tier.targetType,
      target: tier.target.trim(),
    }));
    const problem = validateExitPlan(tiers);
    if (draft.name.trim() === "") {
      setError(t("exitPlanNameRequired"));
      return;
    }
    if (problem) {
      setError(t(`exitPlanError_${problem}`));
      return;
    }
    const entry = {
      name: draft.name.trim(),
      tiers,
      breakevenAfterTier: draft.breakeven === "" ? null : Number(draft.breakeven),
      trailingAfterTier: draft.trailing === "" ? null : Number(draft.trailing),
      notes: draft.notes.trim(),
    };
    if (editingId === "new") {
      createPlan.mutate(entry);
    } else if (editingId) {
      updatePlan.mutate({ id: editingId, patch: entry });
    }
    setEditingId(null);
    setError(null);
  };

  const setTier = (key: string, patch: Partial<DraftTier>) => {
    setDraft((d) => ({
      ...d,
      tiers: d.tiers.map((tier) => (tier.key === key ? { ...tier, ...patch } : tier)),
    }));
  };

  return (
    <div className="space-y-4">
      {isToolsTablesMissing(plansQuery.error) && <ToolsUnavailable />}
      {plans.length === 0 && editingId === null && (
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">{t("exitPlanEmpty")}</p>
      )}

      {plans.length > 0 && (
        <ul className="space-y-2">
          {plans.map((plan) => (
            <li key={plan.id} className="rounded-lg border p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{plan.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {plan.tiers
                      .map((tier) => `${fmtNum(tier.pct, 0)}% @ ${tier.targetType === "R" ? `${tier.target}R` : tier.target}`)
                      .join(" - ")}
                  </p>
                  {plan.breakevenAfterTier !== null && (
                    <p className="text-xs text-muted-foreground">
                      {t("exitPlanBreakevenAfter", { n: plan.breakevenAfterTier + 1 })}
                    </p>
                  )}
                  {plan.trailingAfterTier !== null && (
                    <p className="text-xs text-muted-foreground">
                      {t("exitPlanTrailingAfter", { n: plan.trailingAfterTier + 1 })}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="icon" aria-label={t("exitPlanEdit", { name: plan.name })}
                    onClick={() => startEdit(plan)}>
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label={t("exitPlanDelete", { name: plan.name })}
                    onClick={() => deletePlan.mutate(plan.id)}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editingId === null ? (
        <Button variant="outline" onClick={startNew}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />{t("exitPlanNew")}
        </Button>
      ) : (
        <div className="space-y-4 rounded-lg border p-4">
          <div className="space-y-2">
            <Label htmlFor="ep-name">{t("exitPlanName")}</Label>
            <Input id="ep-name" value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder={t("exitPlanNamePlaceholder")} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t("exitPlanTiers")}</Label>
              <Button variant="outline" size="sm" disabled={draft.tiers.length >= 4}
                onClick={() => setDraft((d) => ({
                  ...d,
                  tiers: [...d.tiers, { key: `tier-${Date.now()}`, pct: 0, targetType: "PRICE", target: "" }],
                }))}>
                <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />{t("exitPlanAddTier")}
              </Button>
            </div>
            {draft.tiers.map((tier, i) => (
              <div key={tier.key} className="flex items-end gap-2">
                <div className="w-20 space-y-1">
                  <Label htmlFor={`ep-pct-${tier.key}`}>{t("exitPlanPct")}</Label>
                  <Input id={`ep-pct-${tier.key}`} type="number" inputMode="decimal" min="0" max="100" step="any"
                    value={tier.pct === 0 ? "" : String(tier.pct)}
                    placeholder="50"
                    onChange={(e) => setTier(tier.key, { pct: Number(e.target.value) || 0 })}
                    className="tabular-nums" />
                </div>
                <div className="w-28 space-y-1">
                  <Label htmlFor={`ep-type-${tier.key}`}>{t("exitPlanTargetType")}</Label>
                  <Select value={tier.targetType}
                    onValueChange={(v) => setTier(tier.key, { targetType: v as "PRICE" | "R" })}>
                    <SelectTrigger id={`ep-type-${tier.key}`} className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PRICE">{t("exitPlanTargetPrice")}</SelectItem>
                      <SelectItem value="R">{t("exitPlanTargetR")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1 space-y-1">
                  <Label htmlFor={`ep-target-${tier.key}`}>
                    {tier.targetType === "R" ? t("exitPlanTargetRValue") : t("exitPlanTargetPriceValue")}
                  </Label>
                  <Input id={`ep-target-${tier.key}`} type="number" inputMode="decimal" min="0" step="any"
                    value={tier.target}
                    onChange={(e) => setTier(tier.key, { target: e.target.value })}
                    className="tabular-nums" />
                </div>
                <Button variant="ghost" size="icon"
                  aria-label={t("exitPlanRemoveTier", { n: i + 1 })}
                  disabled={draft.tiers.length <= 1}
                  onClick={() => setDraft((d) => ({ ...d, tiers: d.tiers.filter((x) => x.key !== tier.key) }))}>
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              {t("exitPlanSum", { sum: fmtNum(draft.tiers.reduce((acc, tier) => acc + (Number(tier.pct) || 0), 0), 0) })}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ep-be">{t("exitPlanBreakeven")}</Label>
              <Select value={draft.breakeven === "" ? "none" : draft.breakeven}
                onValueChange={(v) => setDraft((d) => ({ ...d, breakeven: v === "none" ? "" : v }))}>
                <SelectTrigger id="ep-be" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("exitPlanNever")}</SelectItem>
                  {draft.tiers.map((_, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {t("exitPlanAfterTier", { n: i + 1 })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ep-tr">{t("exitPlanTrailing")}</Label>
              <Select value={draft.trailing === "" ? "none" : draft.trailing}
                onValueChange={(v) => setDraft((d) => ({ ...d, trailing: v === "none" ? "" : v }))}>
                <SelectTrigger id="ep-tr" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("exitPlanNever")}</SelectItem>
                  {draft.tiers.map((_, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {t("exitPlanAfterTier", { n: i + 1 })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ep-notes">{t("exitPlanNotes")}</Label>
            <Textarea id="ep-notes" value={draft.notes}
              onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} rows={2} />
          </div>

          {error && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <Button onClick={save}>{t("exitPlanSave")}</Button>
            <Button variant="outline" onClick={() => { setEditingId(null); setError(null); }}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
