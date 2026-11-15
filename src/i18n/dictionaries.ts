/**
 * Typed message catalogs — the FR file defines the shape; the EN file must
 * match it exactly (compile-time guarantee via the `Messages` assignment).
 */
import fr from "../../messages/fr.json";
import en from "../../messages/en.json";
import type { AppLocale } from "./config";

export type Messages = typeof fr;

// Compile-time check: every key present in fr.json must exist in en.json.
const enMessages: Messages = en;

export const MESSAGES: Record<AppLocale, Messages> = {
  fr,
  en: enMessages,
};
