/**
 * Locale-aware formatting. The locale is set by the I18nProvider on mount
 * and on every language switch (setFormatLocale) — defaults to fr-CA.
 * All functions accept Decimal | number | string and never throw.
 *
 * v2.5 Module 8 — SINGLE CHOKE POINT RULE: fmtMoney / fmtSignedMoney /
 * fmtPct consult the privacy store, so every monetary or percentage display
 * that goes through them is redacted in HIDE mode (placeholder, never in the
 * DOM). New UI code must render money via <Money /> or useFormat() (which
 * re-render on toggle); direct Intl/currency formatting outside this module
 * is rejected by tests/unit/no-direct-money-formatting.test.ts.
 */
import { toD, type DecimalInput } from "./trading/dec";
import { getPrivacySnapshot } from "./privacy/store";
import { privacyMask } from "./privacy/policy";

let currentLocale = "fr-CA";

/** Called by the I18nProvider — keeps every formatter in sync with the UI. */
export function setFormatLocale(locale: string): void {
  currentLocale = locale;
}

/** Current Intl locale (exposed for one-off toLocaleString calls). */
export function getFormatLocale(): string {
  return currentLocale;
}

export const LOCALE = "fr-CA"; // legacy constant (kept for compatibility)

export function fmtNum(
  v: DecimalInput | null | undefined,
  maxDigits = 2,
  minDigits = 0
): string {
  if (v === null || v === undefined) return "—";
  const d = toD(v);
  if (!d.isFinite()) return "—";
  return new Intl.NumberFormat(currentLocale, {
    maximumFractionDigits: maxDigits,
    minimumFractionDigits: minDigits,
  }).format(d.toNumber());
}

/** Price with the instrument's number of decimals. */
export function fmtPrice(
  v: DecimalInput | null | undefined,
  digits = 2
): string {
  if (v === null || v === undefined) return "—";
  return new Intl.NumberFormat(currentLocale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(toD(v).toNumber());
}

/** Signed number: +1 234,50 / −1 234,50 (uses the real minus sign U+2212). */
export function fmtSigned(
  v: DecimalInput | null | undefined,
  maxDigits = 2,
  minDigits = 0
): string {
  if (v === null || v === undefined) return "—";
  const d = toD(v);
  if (d.isZero()) return fmtNum(d, maxDigits, minDigits);
  const body = new Intl.NumberFormat(currentLocale, {
    maximumFractionDigits: maxDigits,
    minimumFractionDigits: minDigits,
  }).format(d.abs().toNumber());
  return d.gt(0) ? `+${body}` : `−${body}`;
}

/** Money with currency code suffix (safe for any code — no Intl currency crash). */
export function fmtMoney(
  v: DecimalInput | null | undefined,
  currency = "USD",
  maxDigits = 2
): string {
  if (v === null || v === undefined) return "—";
  const d = toD(v);
  if (!d.isFinite()) return "—";
  const body = new Intl.NumberFormat(currentLocale, {
    maximumFractionDigits: maxDigits,
    minimumFractionDigits: maxDigits > 0 ? 2 : 0,
  }).format(d.toNumber());
  return privacyMask(getPrivacySnapshot(), "amount", `${body} ${currency}`);
}

export function fmtSignedMoney(
  v: DecimalInput | null | undefined,
  currency = "USD",
  maxDigits = 2
): string {
  if (v === null || v === undefined) return "—";
  const d = toD(v);
  if (d.isZero()) return fmtMoney(d, currency, maxDigits);
  // HIDE mode masks the sign too — the placeholder reveals nothing (§3.1).
  const prefs = getPrivacySnapshot();
  if (prefs.mode === "HIDE" && prefs.scope.hideCurrencyAmounts) {
    return privacyMask(prefs, "amount", "");
  }
  const body = new Intl.NumberFormat(currentLocale, {
    maximumFractionDigits: maxDigits,
    minimumFractionDigits: maxDigits > 0 ? 2 : 0,
  }).format(d.abs().toNumber());
  return d.gt(0) ? `+${body} ${currency}` : `−${body} ${currency}`;
}

export function fmtPct(
  v: DecimalInput | null | undefined,
  maxDigits = 2
): string {
  return privacyMask(
    getPrivacySnapshot(),
    "percent",
    `${fmtNum(v, maxDigits)} %`
  );
}

/** Tailwind classes for profit/loss coloring (v2.5 M1 — semantic tokens). */
export function pnlClass(v: DecimalInput | null | undefined): string {
  if (v === null || v === undefined) return "text-muted-foreground";
  const d = toD(v);
  if (d.gt(0)) return "text-gain";
  if (d.lt(0)) return "text-loss";
  return "text-muted-foreground";
}

// ── Timezone-aware date/time (trades are stored UTC, displayed per profile) ──

/** "5 févr. 2026, 09 h 30" in the given timezone. */
export function fmtDateTimeInTz(
  iso: string | Date | null | undefined,
  timezone: string,
  locale?: string
): string {
  if (iso === null || iso === undefined) return "—";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat(locale ?? currentLocale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
    }).format(d);
  } catch {
    return new Intl.DateTimeFormat(locale ?? currentLocale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(d);
  }
}

/** "5 févr. 2026" in the given timezone. */
export function fmtDateInTz(
  iso: string | Date | null | undefined,
  timezone: string,
  locale?: string
): string {
  if (iso === null || iso === undefined) return "—";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat(locale ?? currentLocale, {
      dateStyle: "medium",
      timeZone: timezone,
    }).format(d);
  } catch {
    return new Intl.DateTimeFormat(locale ?? currentLocale, {
      dateStyle: "medium",
    }).format(d);
  }
}

/** "09:30" (time only) in the given timezone. */
export function fmtTimeInTz(
  iso: string | Date | null | undefined,
  timezone: string,
  locale?: string
): string {
  if (iso === null || iso === undefined) return "—";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat(locale ?? currentLocale, {
      timeStyle: "short",
      timeZone: timezone,
    }).format(d);
  } catch {
    return new Intl.DateTimeFormat(locale ?? currentLocale, {
      timeStyle: "short",
    }).format(d);
  }
}

/** Local (browser) datetime-local input value from an ISO string: "2026-02-05T09:30". */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local input value → ISO string (UTC, with offset). */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
