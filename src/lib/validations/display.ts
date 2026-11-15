/**
 * v2.5 Module 8 — Display-preferences validation (Zod).
 *
 * The UserDisplayPreference row is written by TWO independent providers
 * (privacy and a11y) plus the time settings view — the PUT route therefore
 * accepts a PARTIAL patch and merges it server-side, so one slice never
 * clobbers the others.
 */
import { z } from "zod";
import { isValidTimezone } from "@/lib/time/zones";

const clockString = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM");

export const privacyScopeSchema = z.object({
  hideCurrencyAmounts: z.boolean(),
  hideLots: z.boolean(),
  hideBalances: z.boolean(),
  hideAccountNames: z.boolean(),
  hideBrokerInfo: z.boolean(),
  hidePercentages: z.boolean(),
  hideRAndPips: z.boolean(),
});

export const privacyAutoEnableSchema = z.object({
  onWindowBlur: z.boolean(),
  onInactivitySeconds: z
    .number()
    .int()
    .min(5)
    .max(3600)
    .nullable(),
});

export const extraTimezoneSchema = z.object({
  label: z.string().trim().min(1).max(24),
  ianaTimezone: z.string().refine(isValidTimezone, "Unknown IANA timezone"),
  kind: z.enum(["USER", "BROKER_SERVER", "MARKET", "UTC", "CUSTOM"]),
});

export const tradingDaySettingsSchema = z.object({
  mode: z.enum(["MIDNIGHT_LOCAL", "NEW_YORK_CLOSE", "CUSTOM"]),
  rolloverTime: clockString.nullable().optional(),
  rolloverTimezone: z
    .string()
    .refine(isValidTimezone, "Unknown IANA timezone")
    .nullable()
    .optional(),
});

/** Full runtime shape of a row (GET response body). */
export const displayPreferencesSchema = z.object({
  privacyMode: z.enum(["OFF", "HIDE", "BLUR"]),
  privacyScope: privacyScopeSchema,
  privacyAutoEnable: privacyAutoEnableSchema,
  privacyShortcut: z.string().trim().min(1).max(30),
  blurScreenshots: z.boolean(),
  revealOnHover: z.boolean(),
  hideAmountsInNotifications: z.boolean(),
  textScale: z.number().int().min(80).max(200),
  contrastMode: z.enum(["STANDARD", "HIGH", "SYSTEM"]),
  reducedMotion: z.enum(["SYSTEM", "ON", "OFF"]),
  fontFamily: z.enum(["DEFAULT", "DYSLEXIA_FRIENDLY", "MONO_NUMBERS"]),
  lineHeight: z.number().int().min(100).max(200).nullable(),
  letterSpacing: z.number().int().min(-50).max(200).nullable(),
  focusRingStyle: z.enum(["STANDARD", "ENHANCED"]),
  largerTouchTargets: z.boolean(),
  underlineLinks: z.boolean(),
  tabularNumbers: z.boolean(),
  extraTimezones: z.array(extraTimezoneSchema).max(3),
  timeFormat: z.enum(["12H", "24H", "LOCALE"]),
  weekStartsOn: z.union([z.literal(0), z.literal(1), z.literal(6)]),
  tradingDay: tradingDaySettingsSchema,
});

/** PATCH body — every field optional; JSON sub-objects replace their slice. */
export const displayPreferencesInputSchema = z.object({
  privacyMode: z.enum(["OFF", "HIDE", "BLUR"]).optional(),
  privacyScope: privacyScopeSchema.partial().optional(),
  privacyAutoEnable: privacyAutoEnableSchema.partial().optional(),
  privacyShortcut: z.string().trim().min(1).max(30).optional(),
  blurScreenshots: z.boolean().optional(),
  revealOnHover: z.boolean().optional(),
  hideAmountsInNotifications: z.boolean().optional(),
  textScale: z.number().int().min(80).max(200).optional(),
  contrastMode: z.enum(["STANDARD", "HIGH", "SYSTEM"]).optional(),
  reducedMotion: z.enum(["SYSTEM", "ON", "OFF"]).optional(),
  fontFamily: z.enum(["DEFAULT", "DYSLEXIA_FRIENDLY", "MONO_NUMBERS"]).optional(),
  lineHeight: z.number().int().min(100).max(200).nullable().optional(),
  letterSpacing: z.number().int().min(-50).max(200).nullable().optional(),
  focusRingStyle: z.enum(["STANDARD", "ENHANCED"]).optional(),
  largerTouchTargets: z.boolean().optional(),
  underlineLinks: z.boolean().optional(),
  tabularNumbers: z.boolean().optional(),
  extraTimezones: z.array(extraTimezoneSchema).max(3).optional(),
  timeFormat: z.enum(["12H", "24H", "LOCALE"]).optional(),
  weekStartsOn: z.union([z.literal(0), z.literal(1), z.literal(6)]).optional(),
  tradingDay: tradingDaySettingsSchema.optional(),
});

export type DisplayPreferences = z.infer<typeof displayPreferencesSchema>;
export type DisplayPreferencesInput = z.infer<typeof displayPreferencesInputSchema>;
export type ExtraTimezoneInput = z.infer<typeof extraTimezoneSchema>;
export type TradingDaySettingsInput = z.infer<typeof tradingDaySettingsSchema>;
