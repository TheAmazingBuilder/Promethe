/**
 * Error translation helpers — the API returns stable codes; the client maps
 * them to localized strings. Server-side English messages act as fallback for
 * unknown codes only.
 */
import type { useTranslations } from "next-intl";

export type TFunction = ReturnType<typeof useTranslations>;

const KNOWN_API_CODES = new Set([
  "VALIDATION",
  "EMAIL_TAKEN",
  "INVALID_CREDENTIALS",
  "RATE_LIMITED",
  "UNAUTHORIZED",
  "NOT_FOUND",
  "FORBIDDEN",
  "INTERNAL",
  "NETWORK",
  "OFFLINE",
  "ACCOUNT_NOT_FOUND",
  "INSTRUMENT_NOT_FOUND",
  "STRATEGY_NOT_FOUND",
  "TAG_NOT_FOUND",
  "CHECKLIST_NOT_FOUND",
  "EXIT_PRICE_REQUIRED",
  "ALREADY_CLOSED",
  "INVALID_DATE",
  "TRADES_ON_ACCOUNT",
  "UNSUPPORTED_TYPE",
  "FILE_TOO_LARGE",
  "TRADE_NOT_FOUND",
]);

const KNOWN_VALIDATION_CODES = new Set([
  "emailRequired",
  "emailInvalid",
  "emailMax",
  "passwordRequired",
  "passwordMin",
  "passwordMax",
  "passwordLetter",
  "passwordDigit",
  "displayNameMin",
  "displayNameMax",
  "timezoneInvalid",
  "localeInvalid",
  "currencyInvalid",
  "themeInvalid",
  "invalidDecimal",
  "invalidDate",
  "invalidUrl",
  "invalidColor",
  "required",
]);

/** Translates a single validation code (unknown codes → generic). */
export function validationMessage(t: TFunction, code: string): string {
  return KNOWN_VALIDATION_CODES.has(code)
    ? t(`errors.validation.${code}` as Parameters<TFunction>[0])
    : t("errors.validation.generic");
}

/** Localized message for an API error code (falls back to the server message). */
export function apiErrorMessage(
  t: TFunction,
  code: string | undefined,
  fallback: string
): string {
  if (code && KNOWN_API_CODES.has(code)) {
    return t(`errors.api.${code}` as Parameters<TFunction>[0]);
  }
  return fallback;
}

/** Translates Zod field-error codes ({ field: ["passwordMin", …] }). */
export function translateFieldErrors(
  t: TFunction,
  fieldErrors?: Record<string, string[]>
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [field, messages] of Object.entries(fieldErrors ?? {})) {
    out[field] = messages.map((message) =>
      KNOWN_VALIDATION_CODES.has(message)
        ? t(`errors.validation.${message}` as Parameters<TFunction>[0])
        : t("errors.validation.generic")
    );
  }
  return out;
}

/** Localized message for a position-sizing invalid reason code. */
export function sizingErrorMessage(
  t: TFunction,
  reason: string | null | undefined,
  minLots?: string
): string {
  if (
    reason === "STOP_SIDE_LONG" ||
    reason === "STOP_SIDE_SHORT" ||
    reason === "STOP_EQUALS_ENTRY" ||
    reason === "INVALID_AMOUNT" ||
    reason === "INVALID_PRICE" ||
    reason === "INVALID_INSTRUMENT_SPECS" ||
    reason === "MISSING_ACCOUNT_CURRENCY" ||
    reason === "MISSING_QUOTE_CURRENCY" ||
    reason === "MISSING_CONVERSION_RATE" ||
    reason === "INVALID_CONVERSION_RATE" ||
    reason === "INSUFFICIENT_RISK" ||
    reason === "INVALID_LOT_CONSTRAINTS"
  ) {
    return t(`errors.sizing.${reason}` as Parameters<TFunction>[0], {
      minLots: minLots ?? "0.01",
    });
  }
  return t("errors.sizing.FALLBACK");
}
