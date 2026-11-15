# B1-SERVER — TradeJournal v2.5 Module 1: Customizable dashboards (server layer)

## Scope delivered
Server data-access layer + API routes for the customizable dashboards module.
No frontend, no tests, no i18n edits, no changes under `src/components` or `messages/`.

## Files created
- `src/server/dashboards.ts` — dashboard/widget CRUD, export/import, templates,
  `DashboardValidationError` (code+status), `toDashboardDTO` (layouts normalized on read,
  never persisted), default-dashboard bootstrap ("Daily", DEFAULT_DASHBOARD widgets).
- `src/server/dashboard-data.ts` — `getRequirements(userId)` + batched
  `getDashboardData(userId, dashboardId, { preset, accountId })`: one trade fetch,
  per-widget period resolution (resolvePeriod/applyPeriod/applyComparePeriod),
  per-widget account scope (override REPLACES global filter, in-memory), 19 widget
  loaders, per-widget error isolation (`WIDGET_DATA_FAILED`, `METRIC_NOT_FOUND`).
- `src/server/appearance.ts` — `getAppearance` (creates default row) / `putAppearance`
  (upsert; switching palette away from "custom" clears gain/loss/neutral colors).
- `src/server/custom-metrics.ts` — CRUD, limit 50 (`TOO_MANY_METRICS`), formula
  validated via `validateFormula` (`FORMULA_INVALID` 422).
- `src/app/api/dashboards/route.ts` (GET list+requirements, POST create 201)
- `src/app/api/dashboards/reorder/route.ts` (POST)
- `src/app/api/dashboards/[id]/route.ts` (PATCH, DELETE 204)
- `src/app/api/dashboards/[id]/widgets/route.ts` (POST 201)
- `src/app/api/dashboards/[id]/widgets/[widgetId]/route.ts` (PATCH, DELETE 204)
- `src/app/api/dashboards/[id]/data/route.ts` (POST batched data)
- `src/app/api/dashboards/[id]/export/route.ts` (GET)
- `src/app/api/dashboards/[id]/apply-template/route.ts` (POST replace mode)
- `src/app/api/dashboards/[id]/save-template/route.ts` (POST 201)
- `src/app/api/dashboards/import/route.ts` (POST raw text, byte check 413,
  JSON.parse 422 IMPORT_INVALID_JSON, Zod 422, skip-report import)
- `src/app/api/user-templates/route.ts` (GET) + `[id]/route.ts` (DELETE 204)
- `src/app/api/custom-metrics/route.ts` (GET/POST) + `[id]/route.ts` (PATCH/DELETE)
- `src/app/api/appearance/route.ts` (GET/PUT)

## Files modified
- `src/lib/validations/dashboard.ts` — added `templateApplySchema`,
  `templateSaveSchema`, and `DashboardCreate/DashboardPatch/DashboardDataQuery/
  CustomMetricPatch` inferred types (schemas the task said to add if needed).
- `src/lib/validations/shared.ts` — re-exported all dashboard schemas/types.
- `src/server/api.ts` — `DashboardValidationError` added to `isCoded` + 14 English
  CODE_MESSAGES entries (DASHBOARD_NOT_FOUND, WIDGET_NOT_FOUND, TOO_MANY_DASHBOARDS,
  LAST_DASHBOARD, TOO_MANY_WIDGETS, UNKNOWN_WIDGET_TYPE, INVALID_CONFIG,
  TEMPLATE_NOT_FOUND, IMPORT_TOO_LARGE, IMPORT_INVALID_JSON, METRIC_NOT_FOUND,
  TOO_MANY_METRICS, FORMULA_INVALID).

## Key decisions / deviations (see final report for detail)
- Widget `accountOverride` REPLACES the global account filter (spec types.ts
  semantics); the closed-trade dataset is fetched once unscoped and scoped per
  widget in memory so overrides don't intersect with the global filter.
- `reviewedPercent` computed from the in-memory sampled rows (rows already carry
  `reviewStatus`) instead of a global `groupBy` — a global groupBy cannot produce
  the per-sample percentage the spec defines.
- `patchWidget` with an invalid config → 422 INVALID_CONFIG (reject) instead of
  silently resetting to defaults.
- Equity/curve with an active account filter uses that account's initialBalance;
  without a filter it uses the profile-currency account convention of
  `src/server/dashboard.ts`.
- strategy-table / instrument-table return the full group lists (no server-side
  `limit` slice; the config limit is a display concern).
- `applyTemplate` does not rewrite `Dashboard.templateKey` (spec silent).
- Import LIMIT_REACHED skip entries use `widgetIndex: -1, type: ""`.

## Verified
- `bunx tsc --noEmit` → zero `src/` errors; `bun run lint` → clean.
- All 21 route handlers return 401 `{"error":"UNAUTHORIZED",...}` without a session.
- Full authenticated happy-path exercised with a seeded scratch user (since
  deleted): bootstrap, template create, widget CRUD + auto-placement, batched data
  (KPI/compare/extras, curve, calendar 2 months, breakdowns, R-histogram,
  custom-metric evaluation, prop/sync/goals/news placeholders, static widgets
  `data:null`), appearance round-trip incl. color clearing, custom metric formula
  validation, export shape, import with UNKNOWN_WIDGET_TYPE/INVALID_CONFIG skips,
  invalid-JSON import 422, apply-template replace, reorder, default promotion on
  delete, LAST_DASHBOARD 409, METRIC_NOT_FOUND widget error. No 500s anywhere.

## Notes for the frontend agent (B1-UI)
- `GET /api/dashboards` → `{ dashboards: DashboardDTO[], requirements }`.
- `POST /api/dashboards/[id]/data` body `{ preset, accountId? }` → payload keyed
  by widget id: `{ data, error }`; static widgets (sticky-note, quick-actions)
  return `{ data: null, error: null }`.
- period-compare only returns `compare` when the widget's periodOverride has
  `compareToPrevious: true` — set it when creating that widget.
