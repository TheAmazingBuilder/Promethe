/**
 * Zod schemas shared by the client forms and the API routes — single source
 * of truth for validation. Client-safe: imports zod only.
 *
 * Messages are stable CODES (not prose): the client maps them to localized
 * strings via src/lib/i18n-errors.ts. The server keeps them opaque.
 */
import { z } from "zod";
import { LOCALES } from "@/i18n/config";
import { COMMON_CURRENCIES } from "@/lib/trading/types";

const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "emailRequired")
  .max(190, "emailMax")
  .email("emailInvalid");

const password = z
  .string()
  .min(1, "passwordRequired")
  .max(128, "passwordMax");

export const loginSchema = z.object({
  email,
  password,
});

export const signupSchema = z.object({
  email,
  password: z
    .string()
    .min(8, "passwordMin")
    .max(128, "passwordMax")
    .regex(/[A-Za-z]/, "passwordLetter")
    .regex(/[0-9]/, "passwordDigit"),
  displayName: z
    .string()
    .trim()
    .min(1, "displayNameMin")
    .max(60, "displayNameMax")
    .optional(),
  timezone: z
    .string()
    .trim()
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_+\-/]*\/?[A-Za-z0-9_+\-/]*$/, "timezoneInvalid")
    .optional(),
  locale: z.enum(LOCALES).optional(),
});

const preferencesSchema = z.object({
  lastAccountId: z.string().max(40).nullish(),
  lastInstrumentId: z.string().max(40).nullish(),
  lastTimeframe: z.string().max(8).nullish(),
  rememberedLots: z.record(z.string(), z.string()).nullish(),
  favoriteInstrumentIds: z.array(z.string().max(40)).max(60).nullish(),
});

export const updateProfileSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "displayNameMin")
    .max(60, "displayNameMax")
    .optional(),
  timezone: z
    .string()
    .trim()
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_+\-/]*\/?[A-Za-z0-9_+\-/]*$/, "timezoneInvalid")
    .optional(),
  baseCurrency: z.enum(COMMON_CURRENCIES, "currencyInvalid").optional(),
  locale: z.enum(LOCALES, "localeInvalid").optional(),
  theme: z.enum(["light", "dark", "system"], "themeInvalid").optional(),
  preferences: preferencesSchema.optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/** Flatten a ZodError into { field: messages[] } - compatible zod 3 & 4. */
export function zodFieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}
