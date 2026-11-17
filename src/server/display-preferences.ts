/**
 * v2.5 Module 8 — UserDisplayPreference data access (server-only).
 *
 * Same pattern as the appearance row: created with defaults on first read,
 * one row per user (userId === users.id, cascade delete), all reads/writes
 * scoped by the authenticated user (requireUser in the route). PUT is a
 * PARTIAL patch so the privacy provider, the a11y provider and the time
 * settings can each sync their slice without clobbering the others.
 */
import { db } from "@/lib/db";
import {
  displayPreferencesSchema,
  type DisplayPreferences,
  type DisplayPreferencesInput,
} from "@/lib/validations/display";
import { DEFAULT_PRIVACY_AUTO, DEFAULT_PRIVACY_SCOPE } from "@/lib/privacy/types";
import type { PrivacyAutoEnable, PrivacyScope } from "@/lib/privacy/types";
import { normalizeA11yPreferences } from "@/lib/a11y/preferences";
import type { ExtraTimezone } from "@/lib/time/broker-time";
import type { TradingDaySettings } from "@/lib/time/trading-day";

/** Parses a JSON column with a fallback - never throws, never logs data. */
function parseJson<T>(raw: string, fallback: T): T {
  try {
    const parsed = JSON.parse(raw) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function rowToPreferences(row: {
  privacyMode: string;
  privacyScope: string;
  privacyAutoEnable: string;
  privacyShortcut: string;
  blurScreenshots: boolean;
  revealOnHover: boolean;
  hideAmountsInNotifications: boolean;
  textScale: number;
  contrastMode: string;
  reducedMotion: string;
  fontFamily: string;
  lineHeight: number | null;
  letterSpacing: number | null;
  focusRingStyle: string;
  largerTouchTargets: boolean;
  underlineLinks: boolean;
  tabularNumbers: boolean;
  extraTimezones: string;
  timeFormat: string;
  weekStartsOn: number;
  tradingDayRolloverMode: string;
  tradingDayRolloverTime: string | null;
  tradingDayRolloverTimezone: string | null;
}): DisplayPreferences {
  const scope: PrivacyScope = {
    ...DEFAULT_PRIVACY_SCOPE,
    ...parseJson<Partial<PrivacyScope>>(row.privacyScope, {}),
  };
  const auto: PrivacyAutoEnable = {
    ...DEFAULT_PRIVACY_AUTO,
    ...parseJson<Partial<PrivacyAutoEnable>>(row.privacyAutoEnable, {}),
  };
  const extra = parseJson<ExtraTimezone[]>(row.extraTimezones, [])
    .filter(
      (z) =>
        typeof z?.label === "string" &&
        typeof z?.ianaTimezone === "string" &&
        typeof z?.kind === "string"
    )
    .slice(0, 3);
  const tradingDay: TradingDaySettings = {
    mode:
      row.tradingDayRolloverMode === "NEW_YORK_CLOSE" ||
      row.tradingDayRolloverMode === "CUSTOM"
        ? row.tradingDayRolloverMode
        : "MIDNIGHT_LOCAL",
    rolloverTime: row.tradingDayRolloverTime,
    rolloverTimezone: row.tradingDayRolloverTimezone,
  };

  // Normalize + validate the whole shape through the Zod schema (strict
  // typing at the boundary — a malformed row falls back to defaults).
  const candidate = {
    privacyMode:
      row.privacyMode === "HIDE" || row.privacyMode === "BLUR" ? row.privacyMode : "OFF",
    privacyScope: scope,
    privacyAutoEnable: auto,
    privacyShortcut: row.privacyShortcut || "shift+h",
    blurScreenshots: row.blurScreenshots,
    revealOnHover: row.revealOnHover,
    hideAmountsInNotifications: row.hideAmountsInNotifications,
    textScale: row.textScale,
    contrastMode: row.contrastMode,
    reducedMotion: row.reducedMotion,
    fontFamily: row.fontFamily,
    lineHeight: row.lineHeight,
    letterSpacing: row.letterSpacing,
    focusRingStyle: row.focusRingStyle,
    largerTouchTargets: row.largerTouchTargets,
    underlineLinks: row.underlineLinks,
    tabularNumbers: row.tabularNumbers,
    extraTimezones: extra,
    timeFormat: row.timeFormat,
    weekStartsOn: row.weekStartsOn === 0 || row.weekStartsOn === 6 ? row.weekStartsOn : 1,
    tradingDay,
  };
  const parsed = displayPreferencesSchema.safeParse(candidate);
  return parsed.success ? parsed.data : displayPreferencesSchema.parse({});
}

/** GET - the user's row, created with defaults on first read. */
export async function getDisplayPreferences(
  userId: string
): Promise<DisplayPreferences> {
  let row = await db.userDisplayPreference.findUnique({ where: { userId } });
  if (!row) {
    row = await db.userDisplayPreference.create({ data: { userId } });
  }
  return rowToPreferences(row);
}

/** PUT - partial patch; JSON slices replace, scalars overwrite. */
export async function putDisplayPreferences(
  userId: string,
  input: DisplayPreferencesInput
): Promise<DisplayPreferences> {
  const current = await db.userDisplayPreference.findUnique({ where: { userId } });
  const base = current ?? (await db.userDisplayPreference.create({ data: { userId } }));

  const currentPrefs = rowToPreferences(base);

  const data = {
    privacyMode: input.privacyMode ?? undefined,
    privacyScope:
      input.privacyScope != null
        ? JSON.stringify({ ...currentPrefs.privacyScope, ...input.privacyScope })
        : undefined,
    privacyAutoEnable:
      input.privacyAutoEnable != null
        ? JSON.stringify({
            ...currentPrefs.privacyAutoEnable,
            ...input.privacyAutoEnable,
          })
        : undefined,
    privacyShortcut: input.privacyShortcut ?? undefined,
    blurScreenshots: input.blurScreenshots ?? undefined,
    revealOnHover: input.revealOnHover ?? undefined,
    hideAmountsInNotifications: input.hideAmountsInNotifications ?? undefined,
    ...normalizeA11yPreferences({
      textScale: input.textScale ?? currentPrefs.textScale,
      contrastMode: input.contrastMode ?? currentPrefs.contrastMode,
      reducedMotion: input.reducedMotion ?? currentPrefs.reducedMotion,
      fontFamily: input.fontFamily ?? currentPrefs.fontFamily,
      lineHeight:
        input.lineHeight !== undefined ? input.lineHeight : currentPrefs.lineHeight,
      letterSpacing:
        input.letterSpacing !== undefined
          ? input.letterSpacing
          : currentPrefs.letterSpacing,
      focusRingStyle: input.focusRingStyle ?? currentPrefs.focusRingStyle,
      largerTouchTargets:
        input.largerTouchTargets ?? currentPrefs.largerTouchTargets,
      underlineLinks: input.underlineLinks ?? currentPrefs.underlineLinks,
      tabularNumbers: input.tabularNumbers ?? currentPrefs.tabularNumbers,
    }),
    extraTimezones:
      input.extraTimezones != null ? JSON.stringify(input.extraTimezones) : undefined,
    timeFormat: input.timeFormat ?? undefined,
    weekStartsOn: input.weekStartsOn ?? undefined,
    tradingDayRolloverMode: input.tradingDay?.mode ?? undefined,
    tradingDayRolloverTime:
      input.tradingDay != null
        ? (input.tradingDay.rolloverTime ?? null)
        : undefined,
    tradingDayRolloverTimezone:
      input.tradingDay != null
        ? (input.tradingDay.rolloverTimezone ?? null)
        : undefined,
  };

  // Strip undefined so Prisma only touches the provided slices.
  for (const key of Object.keys(data)) {
    if (data[key as keyof typeof data] === undefined) {
      delete data[key as keyof typeof data];
    }
  }

  const row = await db.userDisplayPreference.update({
    where: { userId },
    data,
  });
  return rowToPreferences(row);
}

/**
 * Server-side notification redaction flag (§3.1): composers call this and, when
 * true, build bodies with R multiples / pips only (never amounts).
 */
export async function shouldHideAmountsInNotifications(
  userId: string
): Promise<boolean> {
  const row = await db.userDisplayPreference.findUnique({
    where: { userId },
    select: { hideAmountsInNotifications: true },
  });
  return row?.hideAmountsInNotifications === true;
}
