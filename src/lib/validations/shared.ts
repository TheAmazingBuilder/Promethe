import { zodFieldErrors } from "@/lib/auth/validators";

/**
 * Re-export point so route files import validation helpers from a single
 * module (the trade schemas live in /src/lib/validations/trade.ts, the auth
 * zodFieldErrors helper in /src/lib/auth/validators.ts).
 */
export {
  tradeInputSchema,
  tradePatchSchema,
  tradeListQuerySchema,
  closeTradeSchema,
  templateInputSchema,
  templatePatchSchema,
  strategyInputSchema,
  accountInputSchema,
  tagInputSchema,
  tagPatchSchema,
  instrumentInputSchema,
  instrumentPatchSchema,
  savedViewInputSchema,
  checklistItemSchema,
  CHECKLIST_CATEGORIES,
  strategyVersionSchema,
} from "./trade";

export {
  journalEntrySchema,
  journalQuerySchema,
  journalDeleteQuerySchema,
  calendarQuerySchema,
  isoDay,
} from "./journal";
export type { JournalEntryInput, CalendarQuery } from "./journal";

export {
  mtIngestPayloadSchema,
  brokerConnectionCreateSchema,
  brokerConnectionUpdateSchema,
  symbolMappingUpsertSchema,
  magicMappingSchema,
} from "./sync";

export { analyticsQuerySchema, ANALYTICS_PERIODS } from "./analytics";
export type { AnalyticsPeriod, AnalyticsQuery } from "./analytics";

export {
  sharePolicySchema,
  shareLinkCreateSchema,
  shareReportCreateSchema,
  shareLinkInputSchema,
} from "./sharing";

export {
  ruleInputSchema,
  rulePatchSchema,
  goalInputSchema,
  goalPatchSchema,
  violationsQuerySchema,
  GOAL_STATUSES,
} from "./goals";
export type {
  RuleInput,
  RulePatch,
  GoalInput,
  GoalPatch,
  ViolationsQuery,
} from "./goals";

export {
  widgetLayoutsSchema,
  periodOverrideSchema,
  dashboardCreateSchema,
  dashboardPatchSchema,
  dashboardsReorderSchema,
  widgetCreateSchema,
  widgetPatchSchema,
  dashboardDataQuerySchema,
  DASHBOARD_IMPORT_MAX_BYTES,
  dashboardImportSchema,
  templateApplySchema,
  templateSaveSchema,
  customMetricInputSchema,
  customMetricPatchSchema,
  appearanceInputSchema,
  metricAggregateSchema,
  metricFilterGroupSchema,
  metricFormulaSchema,
} from "./dashboard";
export type {
  DashboardImportPayload,
  CustomMetricInput,
  AppearanceInput,
  WidgetCreateInput,
  WidgetPatchInput,
} from "./dashboard";

export { zodFieldErrors };

// v2.5 Module 8 — privacy, accessibility & time zones
export {
  displayPreferencesSchema,
  displayPreferencesInputSchema,
  privacyScopeSchema,
  privacyAutoEnableSchema,
  extraTimezoneSchema,
  tradingDaySettingsSchema,
} from "./display";
export type {
  DisplayPreferences,
  DisplayPreferencesInput,
  ExtraTimezoneInput,
  TradingDaySettingsInput,
} from "./display";
