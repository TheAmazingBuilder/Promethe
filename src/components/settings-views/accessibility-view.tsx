"use client";

/**
 * AccessibilityView (v2.5 Module 8, §3.3) — #/reglages/accessibility.
 *
 * Text scale (80–200 %), contrast modes (Standard / High / System),
 * reduced motion, dyslexia-friendly font, line/letter spacing, focus ring,
 * larger touch targets, underline links, tabular numbers — every change
 * applies INSTANTLY through the A11yProvider (attributes on <html>) with a
 * LIVE PREVIEW panel that reflects the current settings, plus reset to
 * defaults. WCAG 2.2 AA target (README "Privacy & accessibility").
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import {
  ALargeSmall,
  Contrast,
  Focus,
  Hand,
  Link2,
  RotateCcw,
  Type,
  Vibrate,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useA11yPrefs } from "@/components/a11y/a11y-provider";
import { useFormat } from "@/lib/format/use-format";
import { TEXT_SCALE_PRESETS } from "@/lib/a11y/preferences";
import { Money } from "@/components/privacy/money";
import { cn } from "@/lib/utils";

type Option<T extends string> = { value: T; labelKey: string };

const CONTRAST_OPTIONS: Option<"STANDARD" | "HIGH" | "SYSTEM">[] = [
  { value: "SYSTEM", labelKey: "optSystem" },
  { value: "STANDARD", labelKey: "optStandard" },
  { value: "HIGH", labelKey: "optHigh" },
];

const MOTION_OPTIONS: Option<"SYSTEM" | "ON" | "OFF">[] = [
  { value: "SYSTEM", labelKey: "optSystem" },
  { value: "ON", labelKey: "optReducedOn" },
  { value: "OFF", labelKey: "optReducedOff" },
];

const FONT_OPTIONS: Option<"DEFAULT" | "DYSLEXIA_FRIENDLY" | "MONO_NUMBERS">[] = [
  { value: "DEFAULT", labelKey: "optFontDefault" },
  { value: "DYSLEXIA_FRIENDLY", labelKey: "optFontDyslexia" },
  { value: "MONO_NUMBERS", labelKey: "optFontMono" },
];

const FOCUS_OPTIONS: Option<"STANDARD" | "ENHANCED">[] = [
  { value: "STANDARD", labelKey: "optFocusStandard" },
  { value: "ENHANCED", labelKey: "optFocusEnhanced" },
];

export function AccessibilityView() {
  const t = useTranslations("accessibility");
  const tCommon = useTranslations("common");
  const { preferences, set, reset, reducedMotionActive, synced } = useA11yPrefs();
  const fmt = useFormat();

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{t("title")}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {t("description")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant={synced ? "secondary" : "outline"}>
            {synced ? tCommon("save") : t("localOnly")}
          </Badge>
          <Button variant="outline" size="sm" onClick={reset}>
            <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("resetDefaults")}
          </Button>
        </div>
      </div>

      {/* ── Text scale ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ALargeSmall className="h-5 w-5" aria-hidden="true" />
            {t("textScale")}
          </CardTitle>
          <CardDescription>{t("textScaleDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <span className="w-10 text-right text-xs text-muted-foreground">80 %</span>
            <Slider
              value={[preferences.textScale]}
              min={80}
              max={200}
              step={10}
              onValueChange={([v]) => set({ textScale: v ?? 100 })}
              aria-label={t("textScale")}
              className="min-w-32 flex-1"
            />
            <span className="w-12 text-xs text-muted-foreground">200 %</span>
            <Badge variant="secondary" className="tabular-nums w-14 justify-center">
              {preferences.textScale} %
            </Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {TEXT_SCALE_PRESETS.map((preset) => (
              <Button
                key={preset.key}
                variant={
                  preferences.textScale === preset.value ? "default" : "outline"
                }
                size="sm"
                aria-pressed={preferences.textScale === preset.value}
                onClick={() => set({ textScale: preset.value })}
              >
                {t(`preset.${preset.key}`)}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Contrast & motion ── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Contrast className="h-5 w-5" aria-hidden="true" />
              {t("contrastMode")}
            </CardTitle>
            <CardDescription>{t("contrastModeDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Label htmlFor="contrast-select" className="sr-only">
              {t("contrastMode")}
            </Label>
            <Select
              value={preferences.contrastMode}
              onValueChange={(v) =>
                set({ contrastMode: v as typeof preferences.contrastMode })
              }
            >
              <SelectTrigger id="contrast-select" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONTRAST_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {t(o.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Vibrate className="h-5 w-5" aria-hidden="true" />
              {t("reducedMotion")}
            </CardTitle>
            <CardDescription>{t("reducedMotionDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Label htmlFor="motion-select" className="sr-only">
              {t("reducedMotion")}
            </Label>
            <Select
              value={preferences.reducedMotion}
              onValueChange={(v) =>
                set({ reducedMotion: v as typeof preferences.reducedMotion })
              }
            >
              <SelectTrigger id="motion-select" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MOTION_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {t(o.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {reducedMotionActive && (
              <p className="text-xs text-muted-foreground" role="status">
                {t("reducedMotionActive")}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Typography ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Type className="h-5 w-5" aria-hidden="true" />
            {t("typography")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="font-select">{t("fontFamily")}</Label>
            <Select
              value={preferences.fontFamily}
              onValueChange={(v) =>
                set({ fontFamily: v as typeof preferences.fontFamily })
              }
            >
              <SelectTrigger id="font-select" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {t(o.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {preferences.fontFamily === "DYSLEXIA_FRIENDLY" && (
              <p className="text-xs text-muted-foreground">{t("fontDyslexiaNote")}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="line-height">
              {t("lineHeight")}
              {preferences.lineHeight != null && (
                <span className="ml-1 text-muted-foreground">
                  ({preferences.lineHeight} %)
                </span>
              )}
            </Label>
            <Select
              value={preferences.lineHeight == null ? "default" : String(preferences.lineHeight)}
              onValueChange={(v) =>
                set({ lineHeight: v === "default" ? null : Number(v) })
              }
            >
              <SelectTrigger id="line-height" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">{t("themeDefault")}</SelectItem>
                {[120, 140, 160, 180, 200].map((v) => (
                  <SelectItem key={v} value={String(v)}>
                    {v} %
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="letter-spacing">
              {t("letterSpacing")}
              {preferences.letterSpacing != null && (
                <span className="ml-1 text-muted-foreground">
                  ({(preferences.letterSpacing / 10).toFixed(1)} %)
                </span>
              )}
            </Label>
            <Select
              value={
                preferences.letterSpacing == null
                  ? "default"
                  : String(preferences.letterSpacing)
              }
              onValueChange={(v) =>
                set({ letterSpacing: v === "default" ? null : Number(v) })
              }
            >
              <SelectTrigger id="letter-spacing" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">{t("themeDefault")}</SelectItem>
                {[-50, -20, 0, 20, 50, 100, 200].map((v) => (
                  <SelectItem key={v} value={String(v)}>
                    {(v / 10).toFixed(1)} %
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* ── Interaction ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Focus className="h-5 w-5" aria-hidden="true" />
            {t("interaction")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="focus-select">{t("focusRing")}</Label>
              <Select
                value={preferences.focusRingStyle}
                onValueChange={(v) =>
                  set({ focusRingStyle: v as typeof preferences.focusRingStyle })
                }
              >
                <SelectTrigger id="focus-select" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FOCUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {t(o.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("focusRingHint")}
              </p>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="touch-targets" className="flex items-center gap-2 text-sm font-medium">
                  <Hand className="h-4 w-4" aria-hidden="true" />
                  {t("largerTouchTargets")}
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("largerTouchTargetsDesc")}
                </p>
              </div>
              <Switch
                id="touch-targets"
                checked={preferences.largerTouchTargets}
                onCheckedChange={(v) => set({ largerTouchTargets: v })}
              />
            </div>
          </div>
          <Separator />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="underline-links" className="flex items-center gap-2 text-sm font-medium">
                  <Link2 className="h-4 w-4" aria-hidden="true" />
                  {t("underlineLinks")}
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("underlineLinksDesc")}
                </p>
              </div>
              <Switch
                id="underline-links"
                checked={preferences.underlineLinks}
                onCheckedChange={(v) => set({ underlineLinks: v })}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="tabular-nums" className="text-sm font-medium">
                  {t("tabularNumbers")}
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("tabularNumbersDesc")}
                </p>
              </div>
              <Switch
                id="tabular-nums"
                checked={preferences.tabularNumbers}
                onCheckedChange={(v) => set({ tabularNumbers: v })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Live preview ── */}
      <Card>
        <CardHeader>
          <CardTitle>{t("livePreview")}</CardTitle>
          <CardDescription>{t("livePreviewDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 rounded-lg border bg-background p-4 sm:grid-cols-3">
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("previewKpi")}
              </p>
              <p className="text-2xl font-semibold tabular-nums">
                <Money value="987.65" currency="USD" signed />
              </p>
              <p className="text-sm text-muted-foreground">
                {fmt.pct(58.3)} · {t("previewWinRate")}
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("previewForm")}
              </p>
              <div className="space-y-2">
                <Label htmlFor="preview-input" className="text-sm">
                  {t("previewLabel")}
                </Label>
                <Input id="preview-input" placeholder="0.01" className="max-w-[10rem]" />
                <Button size="sm">{tCommon("save")}</Button>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("previewText")}
              </p>
              <p className="text-sm leading-relaxed">
                {t("previewBody")}
              </p>
              <a href="#/reglages/accessibility" className="text-sm underline-offset-4 hover:underline">
                {t("previewLink")}
              </a>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {t("previewNote")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
