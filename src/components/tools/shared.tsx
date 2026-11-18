/**
 * v2.5 Module 5 - shared bits for the tool tabs.
 */
"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PRESET_INSTRUMENTS } from "@/lib/trading/instruments";
import { type AssetClass } from "@/lib/trading/types";

const GROUP_ORDER: AssetClass[] = ["METAL", "FOREX", "INDEX", "CRYPTO", "COMMODITY"];

export function InstrumentSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (symbol: string) => void;
}) {
  const t = useTranslations("tools");
  const tRoot = useTranslations();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{t("instrument")}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={t("instrumentPlaceholder")} />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {GROUP_ORDER.map((group) => {
            const items = PRESET_INSTRUMENTS.filter((i) => i.assetClass === group);
            if (items.length === 0) return null;
            return (
              <SelectGroup key={group}>
                <SelectLabel>{tRoot(`trading.assetClass.${group}`)}</SelectLabel>
                {items.map((i) => (
                  <SelectItem key={i.symbol} value={i.symbol}>
                    <span className="font-medium tabular-nums">{i.symbol}</span>
                    <span className="ml-2 text-muted-foreground">{i.name}</span>
                  </SelectItem>
                ))}
              </SelectGroup>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
      {hint && <dd className="text-xs text-muted-foreground tabular-nums">{hint}</dd>}
    </div>
  );
}

/**
 * Clean error state when the tools tables do not exist yet in the database
 * (migration not run): tells the user to run `npx prisma db push` on
 * their PC. Shown instead of the tool content, never a crash.
 */
export function ToolsUnavailable() {
  const t = useTranslations("tools");
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
      <p className="font-medium text-amber-600 dark:text-amber-400">
        {t("toolsUnavailableTitle")}
      </p>
      <p className="mt-1 text-muted-foreground">{t("toolsUnavailableDesc")}</p>
      <p className="mt-2 font-mono text-xs tabular-nums">npx prisma db push</p>
    </div>
  );
}

/** Encode calculator state into a shareable hash fragment (base64url JSON). */
export function encodeShareState(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload);
  const b64 =
    typeof window !== "undefined" && "btoa" in window
      ? window.btoa(unescape(encodeURIComponent(json)))
      : Buffer.from(json, "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeShareState<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
    const json =
      typeof window !== "undefined" && "atob" in window
        ? decodeURIComponent(escape(window.atob(b64)))
        : Buffer.from(b64, "base64").toString("utf8");
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
