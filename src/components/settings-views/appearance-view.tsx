"use client";

/**
 * AppearanceView (v2.5 Module 1, spec §1) — /settings/appearance.
 *
 * Palette (6 presets + custom with a WCAG contrast checker + auto-adjust),
 * density, chart palette — everything with a LIVE PREVIEW that reflects the
 * current (unsaved) selection: the preview container carries the same
 * data-palette / data-chart-palette attributes + custom inline vars as the
 * provider would set on <html>, so every semantic utility resolves exactly
 * as it will after saving. Save bar is sticky at the bottom of the view.
 */
import * as React from "react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import { Check, RotateCcw, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useA11yPrefs } from "@/components/a11y/a11y-provider";
import {
  useAppearanceContext,
} from "@/components/app/appearance-provider";
import {
  CHART_PALETTE_KEYS,
  CHART_PALETTE_PREVIEW,
  DENSITY_KEYS,
  PALETTE_KEYS,
  PALETTE_PREVIEW,
  isChartPaletteKey,
  isDensityKey,
  isPaletteKey,
  type ChartPaletteKey,
  type DensityKey,
  type PaletteKey,
} from "@/lib/dashboard/appearance";
import { cn } from "@/lib/utils";

// ── WCAG helpers ─────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** sRGB relative luminance (WCAG 2.1). */
function relativeLuminance(hex: string): number | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const f = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}

/** Contrast ratio of two hex colors (1..21). */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la == null || lb == null) return null;
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Mix a hex toward white (percent > 0) or black (percent < 0), 0-100. */
function shadeHex(hex: string, percent: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const target = percent >= 0 ? 255 : 0;
  const amount = Math.abs(percent) / 100;
  const mixed = rgb.map(
    (c) => Math.round(c + (target - c) * amount)
  ) as [number, number, number];
  return `#${mixed.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function isValidHex(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

// ── Local form state ─────────────────────────────────────────────────────────

interface AppearanceForm {
  paletteKey: PaletteKey;
  gainColor: string;
  lossColor: string;
  neutralColor: string;
  density: DensityKey;
  chartPaletteKey: ChartPaletteKey;
}

const DEFAULT_GAIN = "#10b981";
const DEFAULT_LOSS = "#f43f5e";
const DEFAULT_NEUTRAL = "#8b8f98";

// ── View ─────────────────────────────────────────────────────────────────────

export function AppearanceView() {
  const t = useTranslations("appearance");
  const { appearance, setAppearance, isLoading } = useAppearanceContext();
  const { resolvedTheme } = useTheme();
  const { toast } = useToast();
  const { reducedMotionActive } = useA11yPrefs();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  const [form, setForm] = React.useState<AppearanceForm>({
    paletteKey: "default",
    gainColor: DEFAULT_GAIN,
    lossColor: DEFAULT_LOSS,
    neutralColor: DEFAULT_NEUTRAL,
    density: "COMFORTABLE",
    chartPaletteKey: "default",
  });
  const [initialized, setInitialized] = React.useState(false);

  // Prefill from the saved row (once loaded).
  React.useEffect(() => {
    if (appearance == null || initialized) return;
    setForm({
      paletteKey: isPaletteKey(appearance.paletteKey)
        ? appearance.paletteKey
        : "default",
      gainColor: appearance.gainColor ?? DEFAULT_GAIN,
      lossColor: appearance.lossColor ?? DEFAULT_LOSS,
      neutralColor: appearance.neutralColor ?? DEFAULT_NEUTRAL,
      density: isDensityKey(appearance.density)
        ? appearance.density
        : "COMFORTABLE",
      chartPaletteKey: isChartPaletteKey(appearance.chartPaletteKey)
        ? appearance.chartPaletteKey
        : "default",
    });
    setInitialized(true);
  }, [appearance, initialized]);

  if (!mounted || isLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-44 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  const isCustom = form.paletteKey === "custom";
  const isDark = resolvedTheme === "dark";

  const dirty =
    appearance == null ||
    appearance.paletteKey !== form.paletteKey ||
    (isCustom && appearance.gainColor !== form.gainColor) ||
    (isCustom && appearance.lossColor !== form.lossColor) ||
    (isCustom && appearance.neutralColor !== form.neutralColor) ||
    appearance.density !== form.density ||
    appearance.chartPaletteKey !== form.chartPaletteKey;

  const onSave = () => {
    setAppearance({
      paletteKey: form.paletteKey,
      gainColor: isCustom && isValidHex(form.gainColor) ? form.gainColor : null,
      lossColor: isCustom && isValidHex(form.lossColor) ? form.lossColor : null,
      neutralColor:
        isCustom && isValidHex(form.neutralColor)
          ? form.neutralColor
          : null,
      density: form.density,
      chartPaletteKey: form.chartPaletteKey,
    });
    toast({ title: t("savedToast") });
  };

  const onReset = () => {
    const next: AppearanceForm = {
      paletteKey: "default",
      gainColor: DEFAULT_GAIN,
      lossColor: DEFAULT_LOSS,
      neutralColor: DEFAULT_NEUTRAL,
      density: "COMFORTABLE",
      chartPaletteKey: "default",
    };
    setForm(next);
    setAppearance({
      paletteKey: "default",
      density: "COMFORTABLE",
      chartPaletteKey: "default",
      gainColor: null,
      lossColor: null,
      neutralColor: null,
    });
    toast({ title: t("resetToast") });
  };

  // Preview scope: the container mimics what the provider sets on <html> —
  // palette + chart palette attributes, or custom inline vars. Descendant
  // semantic utilities (text-gain, bg-gain-subtle, var(--chart-3)…) resolve
  // exactly as they will after saving.
  const previewStyle = isCustom
    ? ({
        "--gain": form.gainColor,
        "--loss": form.lossColor,
        "--neutral": form.neutralColor,
        "--gain-fg": form.gainColor,
        "--loss-fg": form.lossColor,
        "--neutral-fg": form.neutralColor,
      } as React.CSSProperties)
    : undefined;

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-24">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{t("title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* ── 1. Live preview ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("previewTitle")}</CardTitle>
          <CardDescription>{t("previewDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            data-palette={isCustom ? undefined : form.paletteKey}
            data-chart-palette={form.chartPaletteKey}
            style={previewStyle}
            className="space-y-4 rounded-lg border bg-background p-4"
          >
            <div className="h-36 w-full" role="img" aria-label={t("previewChart")}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={[
                    { name: "A", v: 12 },
                    { name: "B", v: 19 },
                    { name: "C", v: 8 },
                    { name: "D", v: 24 },
                    { name: "E", v: 15 },
                  ]}
                  margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    strokeOpacity={0.3}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                    axisLine={false}
                    interval={0}
                  />
                  <Tooltip cursor={{ fillOpacity: 0.1 }} />
                  <Bar dataKey="v" radius={[3, 3, 0, 0]} maxBarSize={40} isAnimationActive={!reducedMotionActive}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Cell key={n} fill={`var(--chart-${n})`} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <table className="w-full text-sm">
              <caption className="sr-only">{t("previewTable")}</caption>
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-1 font-medium">
                    {t("previewColDay")}
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    {t("previewColPnl")}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t">
                  <td className="py-1.5">{t("previewRowWin")}</td>
                  <td className="py-1.5 text-right font-semibold tabular-nums text-gain">
                    +123.45 USD
                  </td>
                </tr>
                <tr className="border-t">
                  <td className="py-1.5">{t("previewRowLoss")}</td>
                  <td className="py-1.5 text-right font-semibold tabular-nums text-loss">
                    −89.00 USD
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="grid grid-cols-7 gap-1.5">
              {(["gain", "gain", "loss", "flat", "gain", "loss", "flat"] as const).map(
                (kind, i) => (
                  <div
                    key={i}
                    className={cn(
                      "flex h-12 flex-col items-center justify-center rounded-md border text-[10px] font-semibold tabular-nums",
                      kind === "gain"
                        ? "border-gain-subtle bg-gain-subtle text-gain"
                        : kind === "loss"
                          ? "border-loss-subtle bg-loss-subtle text-loss"
                          : "bg-muted text-muted-foreground"
                    )}
                  >
                    {kind === "gain" ? "+2" : kind === "loss" ? "−1" : "0"}
                  </div>
                )
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── 2. Palette ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("paletteTitle")}</CardTitle>
          <CardDescription>{t("paletteDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            role="radiogroup"
            aria-label={t("paletteTitle")}
            className="grid grid-cols-2 gap-2 sm:grid-cols-3"
          >
            {PALETTE_KEYS.map((key) => {
              const active = form.paletteKey === key;
              const swatches =
                key === "custom"
                  ? {
                      gain: form.gainColor,
                      loss: form.lossColor,
                      neutral: form.neutralColor,
                    }
                  : PALETTE_PREVIEW[key];
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() =>
                    setForm((f) => ({ ...f, paletteKey: key }))
                  }
                  className={cn(
                    "flex flex-col items-start gap-2 rounded-lg border p-3 text-sm transition-colors",
                    active
                      ? "border-primary bg-accent font-medium"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-3.5 w-3.5 rounded-full"
                      style={{ backgroundColor: swatches.gain }}
                      aria-hidden="true"
                    />
                    <span
                      className="inline-block h-3.5 w-3.5 rounded-full"
                      style={{ backgroundColor: swatches.loss }}
                      aria-hidden="true"
                    />
                    <span
                      className="inline-block h-3.5 w-3.5 rounded-full"
                      style={{ backgroundColor: swatches.neutral }}
                      aria-hidden="true"
                    />
                  </span>
                  <span className="flex items-center gap-1">
                    {t(`palette.${key}`)}
                    {active ? (
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>

          {isCustom ? (
            <CustomColorsSection
              form={form}
              setForm={setForm}
              isDark={isDark}
            />
          ) : null}
        </CardContent>
      </Card>

      {/* ── 3. Density ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("densityTitle")}</CardTitle>
          <CardDescription>{t("densityDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            role="radiogroup"
            aria-label={t("densityTitle")}
            className="grid grid-cols-3 gap-2"
          >
            {DENSITY_KEYS.map((key) => {
              const active = form.density === key;
              const rows =
                key === "COMPACT" ? 5 : key === "SPACIOUS" ? 3 : 4;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setForm((f) => ({ ...f, density: key }))}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-lg border p-3 text-sm transition-colors",
                    active
                      ? "border-primary bg-accent font-medium"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  <span
                    className="flex w-full flex-col gap-0.5"
                    aria-hidden="true"
                  >
                    {Array.from({ length: rows }, (_, i) => (
                      <span
                        key={i}
                        className={cn(
                          "w-full rounded-sm bg-current opacity-30",
                          key === "COMPACT"
                            ? "h-1"
                            : key === "SPACIOUS"
                              ? "h-2"
                              : "h-1.5"
                        )}
                      />
                    ))}
                  </span>
                  {t(`density.${key}`)}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── 4. Chart palette ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("chartTitle")}</CardTitle>
          <CardDescription>{t("chartDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            role="radiogroup"
            aria-label={t("chartTitle")}
            className="grid grid-cols-2 gap-2"
          >
            {CHART_PALETTE_KEYS.map((key) => {
              const active = form.chartPaletteKey === key;
              const swatches = CHART_PALETTE_PREVIEW[key];
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() =>
                    setForm((f) => ({ ...f, chartPaletteKey: key }))
                  }
                  className={cn(
                    "flex flex-col items-start gap-2 rounded-lg border p-3 text-sm transition-colors",
                    active
                      ? "border-primary bg-accent font-medium"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  <span
                    className="flex h-3 w-full overflow-hidden rounded-full"
                    aria-hidden="true"
                  >
                    {swatches.map((hex) => (
                      <span
                        key={hex}
                        className="h-full flex-1"
                        style={{ backgroundColor: hex }}
                      />
                    ))}
                  </span>
                  <span className="flex items-center gap-1">
                    {t(`chart.${key}`)}
                    {active ? (
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── Save bar ── */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <p className="text-xs text-muted-foreground">
            {dirty ? t("unsavedHint") : t("savedHint")}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onReset}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              {t("reset")}
            </Button>
            <Button onClick={onSave} disabled={!dirty}>
              <Save className="h-4 w-4" aria-hidden="true" />
              {t("save")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Custom palette + contrast checker ────────────────────────────────────────

function CustomColorsSection({
  form,
  setForm,
  isDark,
}: {
  form: AppearanceForm;
  setForm: React.Dispatch<React.SetStateAction<AppearanceForm>>;
  isDark: boolean;
}) {
  const t = useTranslations("appearance");

  /** Effective page background (read live from the DOM). */
  const bgColor = React.useMemo(() => {
    if (typeof window === "undefined") return "#ffffff";
    const raw = window.getComputedStyle(document.body).backgroundColor;
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(raw);
    if (!m) return "#ffffff";
    const [, r, g, b, a] = m;
    // Alpha over the nearest solid approximation (the app bg is solid).
    if (a != null && Number(a) < 1) return `#${[r, g, b].map((c) => Number(c).toString(16).padStart(2, "0")).join("")}`;
    return `#${[r, g, b].map((c) => Number(c).toString(16).padStart(2, "0")).join("")}`;
  }, [isDark]);

  const fields = [
    {
      key: "gainColor" as const,
      label: t("customGain"),
      value: form.gainColor,
    },
    {
      key: "lossColor" as const,
      label: t("customLoss"),
      value: form.lossColor,
    },
    {
      key: "neutralColor" as const,
      label: t("customNeutral"),
      value: form.neutralColor,
    },
  ];

  const setColor = (key: keyof AppearanceForm, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  /** Auto-adjust one failing color: darken (light) / lighten (dark) by 5%. */
  const autoAdjust = (key: "gainColor" | "lossColor") => {
    const start = form[key];
    let candidate = start;
    for (let i = 0; i < 20; i++) {
      const ratio = contrastRatio(candidate, bgColor);
      if (ratio != null && ratio >= 4.5) break;
      candidate = shadeHex(candidate, isDark ? 5 : -5);
    }
    setColor(key, candidate);
  };

  return (
    <div className="mt-4 space-y-4 rounded-lg border border-dashed p-3">
      <p className="text-xs font-semibold text-muted-foreground">
        {t("customSection")}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {fields.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <Label htmlFor={`ap-${field.key}`}>{field.label}</Label>
            <div className="flex items-center gap-2">
              <input
                id={`ap-${field.key}`}
                type="color"
                value={field.value}
                onChange={(e) => setColor(field.key, e.target.value)}
                className="h-9 w-10 shrink-0 cursor-pointer rounded-md border bg-transparent p-1"
                aria-label={field.label}
              />
              <Input
                value={field.value}
                onChange={(e) => setColor(field.key, e.target.value)}
                maxLength={7}
                className="font-mono text-xs uppercase"
                aria-label={`${field.label} (hex)`}
                inputMode="text"
              />
            </div>
          </div>
        ))}
      </div>

      {/* Contrast checker */}
      <div className="space-y-3">
        <p className="text-xs font-semibold text-muted-foreground">
          {t("contrastTitle")}
        </p>
        {(["gainColor", "lossColor"] as const).map((key) => {
          const valid = isValidHex(form[key]);
          const ratio = valid ? contrastRatio(form[key], bgColor) : null;
          const textPass = ratio != null && ratio >= 4.5;
          const graphicsPass = ratio != null && ratio >= 3;
          const label = key === "gainColor" ? t("customGain") : t("customLoss");
          return (
            <div
              key={key}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border p-2.5 text-sm"
            >
              <span className="font-medium">{label}</span>
              <span className="tabular-nums text-muted-foreground">
                {ratio != null
                  ? t("contrastRatio", { ratio: ratio.toFixed(2) })
                  : t("contrastInvalid")}
              </span>
              <Badge
                variant="outline"
                className={
                  textPass
                    ? "border-gain-subtle bg-gain-subtle text-gain"
                    : "border-loss-subtle bg-loss-subtle text-loss"
                }
              >
                {textPass ? t("contrastTextPass") : t("contrastTextFail")}
              </Badge>
              <Badge
                variant="outline"
                className={
                  graphicsPass
                    ? "border-gain-subtle bg-gain-subtle text-gain"
                    : "border-loss-subtle bg-loss-subtle text-loss"
                }
              >
                {graphicsPass
                  ? t("contrastGraphicsPass")
                  : t("contrastGraphicsFail")}
              </Badge>
              {!textPass ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  onClick={() => autoAdjust(key)}
                >
                  {t("contrastAutoAdjust")}
                </Button>
              ) : null}
            </div>
          );
        })}
        {/* Live sample chips with the custom colors */}
        <div
          className="flex flex-wrap items-center gap-2"
          style={
            {
              "--gain": form.gainColor,
              "--loss": form.lossColor,
              "--neutral": form.neutralColor,
              "--gain-fg": form.gainColor,
              "--loss-fg": form.lossColor,
              "--neutral-fg": form.neutralColor,
            } as React.CSSProperties
          }
        >
          <span className="rounded-md border-gain-subtle bg-gain-subtle px-2 py-1 text-sm font-semibold tabular-nums text-gain">
            +123.45 USD
          </span>
          <span className="rounded-md border-loss-subtle bg-loss-subtle px-2 py-1 text-sm font-semibold tabular-nums text-loss">
            −89.00 USD
          </span>
          <span className="rounded-md bg-muted px-2 py-1 text-sm tabular-nums text-muted-foreground">
            0.00 USD
          </span>
        </div>
      </div>
    </div>
  );
}
