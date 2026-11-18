"use client";

/**
 * v2.5 Module 8 — <Money /> and <Sensitive /> (§3.1 / §3.2).
 *
 * The ONLY sanctioned way to render a monetary or sensitive value in JSX:
 *  - HIDE mode → the placeholder "••••" (width-stable). The real value is
 *    never rendered, so it cannot leak into the DOM text, attributes, titles
 *    or chart SVG — enforced by the leak tests;
 *  - BLUR mode → the value renders but the `.sensitive` class blurs it via
 *    CSS (real text IS in the DOM — documented limit);
 *  - Screen readers announce "amount hidden" (sr-only), never the real value
 *    in HIDE mode, and "(hidden)" in BLUR mode.
 *
 * Each component subscribes individually to the privacy store, so a toggle
 * re-renders exactly the sensitive values — not the whole tree (§6).
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import {
  fmtMoney,
  fmtSignedMoney,
} from "@/lib/format";
import {
  getPrivacyServerSnapshot,
  getPrivacySnapshot,
  subscribePrivacy,
} from "@/lib/privacy/store";
import {
  isSensitiveKindBlurred,
  isSensitiveKindHidden,
} from "@/lib/privacy/policy";
import type { SensitiveKind } from "@/lib/privacy/types";
import type { DecimalInput } from "@/lib/trading/dec";
import { cn } from "@/lib/utils";

/** Internal subscription hook - the store identity changes only on change. */
function usePrivacySnapshot() {
  return React.useSyncExternalStore(
    subscribePrivacy,
    getPrivacySnapshot,
    getPrivacyServerSnapshot
  );
}

export interface MoneyProps {
  value: DecimalInput | null | undefined;
  currency?: string;
  /** Signed form (+/−) - the sign is masked too in HIDE mode. */
  signed?: boolean;
  maxDigits?: number;
  /** Which scope flag controls this value (default "amount"). */
  kind?: SensitiveKind;
  className?: string;
  /** Render as a <span> block with fixed min-width (width-stable). */
  stableWidth?: boolean;
}

export function Money({
  value,
  currency = "USD",
  signed = false,
  maxDigits = 2,
  kind = "amount",
  className,
  stableWidth = true,
}: MoneyProps) {
  const t = useTranslations("privacy");
  const privacy = usePrivacySnapshot();
  // HIDE replaces the value; BLUR keeps the real text (CSS-blurred).
  const hidden = privacy.mode === "HIDE" && isSensitiveKindHidden(privacy, kind);
  const blurred = isSensitiveKindBlurred(privacy, kind);
  const text = signed
    ? fmtSignedMoney(value, currency, maxDigits)
    : fmtMoney(value, currency, maxDigits);

  return (
    <span
      className={cn(
        "tabular-nums whitespace-nowrap",
        blurred && "sensitive",
        hidden && stableWidth && "inline-block min-w-[3.5em] text-center",
        className
      )}
    >
      {hidden ? (
        <>
          <span aria-hidden="true">{text}</span>
          <span className="sr-only">{t("amountHidden")}</span>
        </>
      ) : blurred ? (
        <>
          <span aria-hidden="true">{text}</span>
          <span className="sr-only">{t("valueHidden")}</span>
        </>
      ) : (
        text
      )}
    </span>
  );
}

export interface SensitiveProps {
  /** Sensitive kind - picks the scope flag that guards it. */
  kind: SensitiveKind;
  children: React.ReactNode;
  className?: string;
  /** Placeholder used in HIDE mode (default "••••"). */
  placeholder?: string;
}

/**
 * Wraps arbitrary sensitive content (account names, broker info, lot sizes…).
 * In HIDE mode the children are NOT rendered — the placeholder replaces them
 * (nothing sensitive reaches the DOM).
 */
export function Sensitive({
  kind,
  children,
  className,
  placeholder = "••••",
}: SensitiveProps) {
  const t = useTranslations("privacy");
  const privacy = usePrivacySnapshot();
  // HIDE replaces the children; BLUR keeps them (CSS-blurred).
  const hidden = privacy.mode === "HIDE" && isSensitiveKindHidden(privacy, kind);
  const blurred = isSensitiveKindBlurred(privacy, kind);

  if (hidden) {
    return (
      <span
        className={cn(
          "tabular-nums whitespace-nowrap inline-block min-w-[3.5em] text-center",
          className
        )}
      >
        <span aria-hidden="true">{placeholder}</span>
        <span className="sr-only">{t("valueHidden")}</span>
      </span>
    );
  }
  if (blurred) {
    return (
      <span className={cn("sensitive", className)}>
        <span aria-hidden="true">{children}</span>
        <span className="sr-only">{t("valueHidden")}</span>
      </span>
    );
  }
  return <span className={className}>{children}</span>;
}
