"use client";

/**
 * v2.5 Module 8 — useFormat(): the React entry point of the formatting
 * choke point (§1). Subscribes to the privacy store so the calling component
 * re-renders exactly when the privacy mode/scope changes, then returns the
 * same privacy-aware formatters as src/lib/format.ts.
 *
 * Usage:
 *   const fmt = useFormat();
 *   fmt.money(trade.netPnl, account.currency)   // "••••" in HIDE mode
 *   fmt.signedMoney(...) / fmt.pct(...) / fmt.num(...) / fmt.price(...)
 *
 * Chart components use it for axis ticks, tooltips and data labels — the
 * subscription re-runs the render so formatters never draw a real scale in
 * HIDE mode (§3.1). For plain JSX prefer <Money /> (same behaviour plus the
 * screen-reader label).
 */
import { useMemo, useSyncExternalStore } from "react";
import {
  fmtMoney,
  fmtNum,
  fmtPct,
  fmtPrice,
  fmtSigned,
  fmtSignedMoney,
} from "@/lib/format";
import {
  getPrivacyServerSnapshot,
  getPrivacySnapshot,
  subscribePrivacy,
} from "@/lib/privacy/store";
import { PRIVACY_PLACEHOLDER } from "@/lib/privacy/policy";
import type { SensitiveKind } from "@/lib/privacy/types";
import type { DecimalInput } from "@/lib/trading/dec";

export interface FormatApi {
  /** Money with currency suffix — placeholder in HIDE mode (scope: amounts). */
  money(v: DecimalInput | null | undefined, currency?: string, maxDigits?: number): string;
  /** Signed money — placeholder (sign included) in HIDE mode. */
  signedMoney(v: DecimalInput | null | undefined, currency?: string, maxDigits?: number): string;
  /** Percentage — placeholder when hidePercentages is on. */
  pct(v: DecimalInput | null | undefined, maxDigits?: number): string;
  /** Plain number (counts, R multiples, pips — visible by default). */
  num(v: DecimalInput | null | undefined, maxDigits?: number, minDigits?: number): string;
  /** Signed number (R multiples). */
  signed(v: DecimalInput | null | undefined, maxDigits?: number, minDigits?: number): string;
  /** Price with instrument decimals — never masked. */
  price(v: DecimalInput | null | undefined, digits?: number): string;
  /** Lot size — placeholder when hideLots is on. */
  lots(v: DecimalInput | null | undefined, maxDigits?: number): string;
  /** Current privacy mode ("OFF" | "HIDE" | "BLUR"). */
  privacyMode: string;
  /** True when `kind` is masked in HIDE mode / blurred in BLUR mode. */
  isMasked(kind: SensitiveKind): boolean;
}

export function useFormat(): FormatApi {
  // The snapshot identity changes only when the effective state changes —
  // subscribers re-render on toggle without re-rendering the whole tree.
  const privacy = useSyncExternalStore(
    subscribePrivacy,
    getPrivacySnapshot,
    getPrivacyServerSnapshot
  );

  return useMemo<FormatApi>(() => {
    const lotsHidden = privacy.mode === "HIDE" && privacy.scope.hideLots;
    return {
      money: (v, currency, maxDigits) => fmtMoney(v, currency, maxDigits),
      signedMoney: (v, currency, maxDigits) =>
        fmtSignedMoney(v, currency, maxDigits),
      pct: (v, maxDigits) => fmtPct(v, maxDigits),
      num: (v, maxDigits, minDigits) => fmtNum(v, maxDigits, minDigits),
      signed: (v, maxDigits, minDigits) => fmtSigned(v, maxDigits, minDigits),
      price: (v, digits) => fmtPrice(v, digits),
      lots: (v, maxDigits = 2) =>
        lotsHidden
          ? PRIVACY_PLACEHOLDER
          : fmtNum(v, maxDigits),
      privacyMode: privacy.mode,
      isMasked: (kind) => {
        if (privacy.mode !== "HIDE" && privacy.mode !== "BLUR") return false;
        switch (kind) {
          case "amount":
            return privacy.scope.hideCurrencyAmounts;
          case "balance":
            return privacy.scope.hideBalances;
          case "lots":
            return privacy.scope.hideLots;
          case "account":
            return privacy.scope.hideAccountNames;
          case "broker":
            return privacy.scope.hideBrokerInfo;
          case "percent":
            return privacy.scope.hidePercentages;
          case "r":
            return privacy.scope.hideRAndPips;
        }
      },
    };
  }, [privacy]);
}
