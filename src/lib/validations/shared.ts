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
  setupInputSchema,
  setupPatchSchema,
  playbookRuleInputSchema,
  playbookRulePatchSchema,
  checklistTemplateInputSchema,
  checklistTemplatePatchSchema,
  playbookMatchSchema,
  instantiateTemplateSchema,
  duplicateStrategySchema,
  marketProfileSchema,
  entryConditionSchema,
  confirmationSchema,
  managementRuleSchema,
  exitRuleSchema,
  strategyRiskSchema,
  MARKET_CONDITIONS_PLAYBOOK,
  ENTRY_CONDITION_CATEGORIES,
  CONFIRMATION_TYPES,
  EXIT_TYPES,
  PLAYBOOK_RULE_CATEGORIES,
  PLAYBOOK_SESSIONS,
  TRADING_DAYS,
  STRATEGY_GRADES,
  STRATEGY_STATUSES,
  PLAYBOOK_MATCHES,
  STRATEGY_DEFINITION_FIELDS,
  touchesDefinition,
} from "./playbook";

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

export {
  analyticsQuerySchema,
  ANALYTICS_PERIODS,
  weeklyPlanQuerySchema,
  weeklyPlanToggleSchema,
  WEEKLY_PLAN_RULES,
} from "./analytics";
export type {
  AnalyticsPeriod,
  AnalyticsQuery,
  WeeklyPlanQuery,
  WeeklyPlanRule,
  WeeklyPlanToggle,
} from "./analytics";

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

export {
  searchQuerySchema,
  bulkTradesSchema,
  customFieldDefinitionInputSchema,
  customFieldDefinitionPatchSchema,
  tableColumnsInputSchema,
  shortcutUpsertSchema,
  savedViewPatchSchema,
} from "./productivity";
export type {
  SearchQuery,
  BulkTradesInput,
  CustomFieldDefinitionInput,
  CustomFieldDefinitionPatch,
  TableColumnsInput,
  ShortcutUpsertInput,
  SavedViewPatch,
} from "./productivity";

export { zodFieldErrors };

// v2.5 Module 5 — trading tools
export {
  toolScenarioInputSchema,
  toolScenarioPatchSchema,
  fxRateInputSchema,
  fxRatePatchSchema,
  fxRatesImportSchema,
  marketSessionSettingInputSchema,
  marketSessionSettingPatchSchema,
  exitPlanInputSchema,
  exitPlanPatchSchema,
  exposureSettingsSchema,
} from "./tools";
export type {
  ToolScenarioInput,
  ToolScenarioPatch,
  FxRateInput,
  FxRatePatch,
  FxRatesImportInput,
  MarketSessionSettingInput,
  MarketSessionSettingPatch,
  ExitPlanInput,
  ExitPlanPatch,
  ExposureSettingsInput,
} from "./tools";

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
