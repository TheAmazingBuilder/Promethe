"use client";

/**
 * Period editor — popover content for the widget period chip.
 * Modes: inherit / preset / rolling days / rolling trades / custom range,
 * plus "compare to previous period". Validated client-side with
 * periodOverrideSchema before saving; "Clear" removes the override.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { periodOverrideSchema } from "@/lib/validations/dashboard";
import {
  PERIOD_PRESETS,
  type PeriodMode,
  type PeriodOverride,
  type PeriodPreset,
} from "@/lib/dashboard/types";

const MODES: readonly PeriodMode[] = [
  "INHERIT",
  "PRESET",
  "ROLLING_DAYS",
  "ROLLING_TRADES",
  "CUSTOM",
];

function clampInt(value: string, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function PeriodEditor({
  override,
  onSave,
}: {
  override: PeriodOverride | null;
  onSave: (periodOverride: PeriodOverride | null) => void;
}) {
  const t = useTranslations("dashboards");
  const { toast } = useToast();

  const [mode, setMode] = React.useState<PeriodMode>(override?.mode ?? "INHERIT");
  const [preset, setPreset] = React.useState<PeriodPreset>(
    override?.preset ?? "last30"
  );
  const [rollingDays, setRollingDays] = React.useState(
    String(override?.rollingDays ?? 30)
  );
  const [rollingTrades, setRollingTrades] = React.useState(
    String(override?.rollingTrades ?? 20)
  );
  const [customFrom, setCustomFrom] = React.useState(override?.customFrom ?? "");
  const [customTo, setCustomTo] = React.useState(override?.customTo ?? "");
  const [compareToPrevious, setCompareToPrevious] = React.useState(
    override?.compareToPrevious ?? false
  );

  const build = (): PeriodOverride | null => {
    if (mode === "INHERIT") return null;
    const next: PeriodOverride = { mode };
    if (mode === "PRESET") next.preset = preset;
    if (mode === "ROLLING_DAYS")
      next.rollingDays = clampInt(rollingDays, 1, 365, 30);
    if (mode === "ROLLING_TRADES")
      next.rollingTrades = clampInt(rollingTrades, 1, 1000, 20);
    if (mode === "CUSTOM") {
      next.customFrom = customFrom || undefined;
      next.customTo = customTo || undefined;
    }
    if (compareToPrevious) next.compareToPrevious = true;
    return next;
  };

  const save = () => {
    const next = build();
    if (next != null) {
      const parsed = periodOverrideSchema.safeParse(next);
      if (!parsed.success) {
        toast({
          title: t("periods.invalid"),
          variant: "destructive",
        });
        return;
      }
      onSave(parsed.data as PeriodOverride);
    } else {
      onSave(null);
    }
  };

  return (
    <div className="space-y-3">
      <RadioGroup
        value={mode}
        onValueChange={(v) => setMode(v as PeriodMode)}
        className="gap-2"
      >
        {MODES.map((m) => (
          <div key={m} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <RadioGroupItem value={m} id={`period-${m}`} />
              <Label htmlFor={`period-${m}`} className="text-sm font-normal">
                {t(`periods.mode.${m}`)}
              </Label>
            </div>
            {m === "PRESET" && mode === "PRESET" ? (
              <div className="pl-6">
                <Select
                  value={preset}
                  onValueChange={(v) => setPreset(v as PeriodPreset)}
                >
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PERIOD_PRESETS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {t(`periods.${p}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {m === "ROLLING_DAYS" && mode === "ROLLING_DAYS" ? (
              <div className="pl-6">
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={rollingDays}
                  onChange={(e) => setRollingDays(e.target.value)}
                  aria-label={t("periods.rollingDays")}
                  className="h-8"
                />
              </div>
            ) : null}
            {m === "ROLLING_TRADES" && mode === "ROLLING_TRADES" ? (
              <div className="pl-6">
                <Input
                  type="number"
                  min={1}
                  max={1000}
                  value={rollingTrades}
                  onChange={(e) => setRollingTrades(e.target.value)}
                  aria-label={t("periods.rollingTrades")}
                  className="h-8"
                />
              </div>
            ) : null}
            {m === "CUSTOM" && mode === "CUSTOM" ? (
              <div className="grid grid-cols-2 gap-2 pl-6">
                <div className="space-y-1">
                  <Label htmlFor="period-from" className="text-xs">
                    {t("periods.customFrom")}
                  </Label>
                  <Input
                    id="period-from"
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="h-8"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="period-to" className="text-xs">
                    {t("periods.customTo")}
                  </Label>
                  <Input
                    id="period-to"
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="h-8"
                  />
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </RadioGroup>

      <Separator />

      <div className="flex items-center justify-between gap-2">
        <Label
          htmlFor="period-compare"
          className="text-sm font-normal leading-tight"
        >
          {t("periods.compareToPrevious")}
        </Label>
        <Switch
          id="period-compare"
          checked={compareToPrevious}
          onCheckedChange={setCompareToPrevious}
          disabled={mode === "INHERIT" || mode === "ROLLING_TRADES"}
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onSave(null)}
        >
          {t("periods.clear")}
        </Button>
        <Button type="button" size="sm" onClick={save}>
          {t("periods.apply")}
        </Button>
      </div>
    </div>
  );
}
