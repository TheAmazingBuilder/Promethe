/**
 * Typed message catalog — English only (Phase 3). The EN file defines the
 * shape; there is no FR catalog anymore (messages/fr.json was deleted).
 */
import en from "../../messages/en.json";
import type { AppLocale } from "./config";

export type Messages = typeof en;

export const MESSAGES: Record<AppLocale, Messages> = {
  en,
};
