/**
 * Dashboards — server-side data access (v2.5 Module 1, userId-scoped).
 *
 * Every function takes the SESSION userId and scopes all reads/writes with it
 * (isolation pattern shared with trades/goals — the Supabase-RLS equivalent).
 * JSON columns (config / layouts / periodOverride / definitionJson) are stored
 * as strings in SQLite and parsed defensively on read. Layouts are normalized
 * (bounds + collision compaction) on every read via lib/dashboard/layout — the
 * normalized shape is returned in the DTO but never persisted on read.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  MAX_DASHBOARDS,
  MAX_WIDGETS_PER_DASHBOARD,
  type DashboardDTO,
  type DashboardWidgetDTO,
  type PeriodOverride,
  type WidgetLayout,
  type WidgetLayouts,
} from "@/lib/dashboard/types";
import {
  getWidgetDefinition,
  safeParseWidgetConfig,
} from "@/lib/dashboard/registry";
import {
  findFreeSlot,
  migrateLayouts,
  normalizeLayouts,
} from "@/lib/dashboard/layout";
import {
  DEFAULT_DASHBOARD,
  getTemplate,
  type TemplateWidget,
} from "@/lib/dashboard/templates";
import {
  DASHBOARD_IMPORT_MAX_BYTES,
  type DashboardCreate,
  type DashboardImportPayload,
  type DashboardPatch,
  type WidgetCreateInput,
  type WidgetPatchInput,
} from "@/lib/validations/dashboard";
// Registers the v2.5 M2 chart widgets before any getWidgetDefinition /
// safeParseWidgetConfig call — idempotent side-effect import.
import "@/lib/dashboard/register-chart-widgets";
import "@/lib/dashboard/register-risk-reward-widgets";
import "@/lib/dashboard/register-mrt-wave2-widgets";

/** Domain errors - mapped to typed API responses by apiError(). */
export class DashboardValidationError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 422) {
    super(code);
    this.name = "DashboardValidationError";
    this.code = code;
    this.status = status;
  }
}

// ── Row types & JSON helpers ─────────────────────────────────────────────────

type DashboardRow = Prisma.DashboardGetPayload<{ include: { widgets: true } }>;
type WidgetRow = Prisma.DashboardWidgetGetPayload<Record<string, never>>;
type UserTemplateRow = Prisma.UserDashboardTemplateGetPayload<
  Record<string, never>
>;

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (raw == null || raw === "") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ── DTO mappers ──────────────────────────────────────────────────────────────

function widgetBounds(type: string): {
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
} {
  const definition = getWidgetDefinition(type);
  if (!definition) return {};
  return {
    minW: definition.minSize.w,
    minH: definition.minSize.h,
    maxW: definition.maxSize.w,
    maxH: definition.maxSize.h,
  };
}

function toWidgetDTO(widget: WidgetRow): DashboardWidgetDTO {
  const normalized = normalizeLayouts([
    {
      id: widget.id,
      layouts: parseJson<WidgetLayouts>(widget.layouts, {}),
      ...widgetBounds(widget.type),
    },
  ]);
  return {
    id: widget.id,
    type: widget.type,
    title: widget.title,
    config: parseJson<Record<string, unknown>>(widget.config, {}),
    layouts: normalized[widget.id] ?? {},
    periodOverride: parseJson<PeriodOverride | null>(widget.periodOverride, null),
    accountOverride: widget.accountOverride,
  };
}

/** Prisma row → DashboardDTO (layouts normalized, JSON parsed, never persisted). */
export function toDashboardDTO(row: DashboardRow): DashboardDTO {
  const widgets = [...row.widgets].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id)
  );
  const normalized = normalizeLayouts(
    widgets.map((w) => ({
      id: w.id,
      layouts: parseJson<WidgetLayouts>(w.layouts, {}),
      ...widgetBounds(w.type),
    }))
  );
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    order: row.order,
    isDefault: row.isDefault,
    templateKey: row.templateKey,
    widgets: widgets.map((w) => ({
      id: w.id,
      type: w.type,
      title: w.title,
      config: parseJson<Record<string, unknown>>(w.config, {}),
      layouts: normalized[w.id] ?? {},
      periodOverride: parseJson<PeriodOverride | null>(w.periodOverride, null),
      accountOverride: w.accountOverride,
    })),
  };
}

export interface UserTemplateDTO {
  id: string;
  name: string;
  description: string | null;
  /** Parsed export-shaped definition ({ version, exportedAt, dashboards }). */
  definition: unknown;
  createdAt: string;
}

function toUserTemplateDTO(row: UserTemplateRow): UserTemplateDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    definition: parseJson<unknown>(row.definitionJson, null),
    createdAt: row.createdAt.toISOString(),
  };
}

// ── Export / import shapes ───────────────────────────────────────────────────

export interface DashboardExportWidget {
  type: string;
  title: string | null;
  config: unknown;
  layouts: WidgetLayouts;
  periodOverride: PeriodOverride | null;
}

export interface DashboardExportPayload {
  version: 1;
  exportedAt: string;
  dashboards: Array<{
    name: string;
    icon: string;
    widgets: DashboardExportWidget[];
  }>;
}

export type ImportSkipReason =
  | "UNKNOWN_WIDGET_TYPE"
  | "INVALID_CONFIG"
  | "LIMIT_REACHED";

export interface DashboardImportSkip {
  /** Index in the import payload's dashboards array. */
  dashboardIndex: number;
  /** Index in the dashboard's widgets array (-1 = whole dashboard skipped). */
  widgetIndex: number;
  /** Widget type ("" when the whole dashboard was skipped). */
  type: string;
  reason: ImportSkipReason;
}

function buildExportPayload(row: DashboardRow): DashboardExportPayload {
  const widgets = [...row.widgets].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id)
  );
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    dashboards: [
      {
        name: row.name,
        icon: row.icon,
        widgets: widgets.map((w) => ({
          type: w.type,
          title: w.title,
          config: parseJson<Record<string, unknown>>(w.config, {}),
          layouts: parseJson<WidgetLayouts>(w.layouts, {}),
          periodOverride: parseJson<PeriodOverride | null>(w.periodOverride, null),
        })),
      },
    ],
  };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/** Widget blueprint - normalized across built-in templates and import files. */
interface WidgetBlueprint {
  type: string;
  title?: string | null;
  config?: unknown;
  layouts?: WidgetLayouts;
  periodOverride?: PeriodOverride | null;
}

function templateToBlueprints(
  widgets: readonly TemplateWidget[]
): WidgetBlueprint[] {
  return widgets.map((w) => ({
    type: w.type,
    title: w.title ?? null,
    config: w.config,
    layouts: w.layout,
    periodOverride: null,
  }));
}

/**
 * Insert a list of widget blueprints on a dashboard.
 * - unknown registry type → skipped (UNKNOWN_WIDGET_TYPE) when a recorder is
 *   given;
 * - invalid config → fallback to the definition's defaultConfig (built-in
 *   templates) or skip (import files), per `invalidConfig`;
 * - layouts run through migrateLayouts before persistence.
 */
async function insertWidgets(
  userId: string,
  dashboardId: string,
  blueprints: readonly WidgetBlueprint[],
  invalidConfig: "fallback" | "skip",
  recordSkip?: (widgetIndex: number, type: string, reason: ImportSkipReason) => void,
  client: Pick<Prisma.TransactionClient, "dashboardWidget"> = db
): Promise<void> {
  const existingLg: WidgetLayout[] = [];
  for (const [widgetIndex, blueprint] of blueprints.entries()) {
    const definition = getWidgetDefinition(blueprint.type);
    if (!definition) {
      recordSkip?.(widgetIndex, blueprint.type, "UNKNOWN_WIDGET_TYPE");
      continue;
    }

    const configResult = safeParseWidgetConfig(
      blueprint.type,
      blueprint.config ?? definition.defaultConfig
    );
    if (!configResult.ok) {
      if (invalidConfig === "skip") {
        recordSkip?.(widgetIndex, blueprint.type, "INVALID_CONFIG");
        continue;
      }
      // Built-in template with a stale config → registry defaults keep the
      // widget alive (templates are code-versioned, this is a safety net).
    }
    const config = configResult.ok ? configResult.config : definition.defaultConfig;

    const layouts =
      blueprint.layouts ??
      (() => {
        const slot = findFreeSlot(
          existingLg,
          definition.defaultLayout.w,
          definition.defaultLayout.h
        );
        return {
          lg: {
            x: slot.x,
            y: slot.y,
            w: definition.defaultLayout.w,
            h: definition.defaultLayout.h,
          },
        };
      })();
    const stored = migrateLayouts(1, layouts).layouts;
    if (stored.lg) existingLg.push(stored.lg);

    await client.dashboardWidget.create({
      data: {
        dashboardId,
        userId,
        type: blueprint.type,
        title: blueprint.title ?? null,
        config: JSON.stringify(config),
        layouts: JSON.stringify(stored),
        periodOverride:
          blueprint.periodOverride != null
            ? JSON.stringify(blueprint.periodOverride)
            : null,
        accountOverride: null,
      },
    });
  }
}

async function nextOrder(
  userId: string,
  client: Pick<Prisma.TransactionClient, "dashboard"> = db
): Promise<number> {
  const aggregate = await client.dashboard.aggregate({
    where: { userId },
    _max: { order: true },
  });
  return (aggregate._max.order ?? -1) + 1;
}

async function requireDashboard(
  userId: string,
  dashboardId: string
): Promise<DashboardRow> {
  const row = await db.dashboard.findFirst({
    where: { id: dashboardId, userId },
    include: { widgets: true },
  });
  if (!row) throw new DashboardValidationError("DASHBOARD_NOT_FOUND", 404);
  return row;
}

async function loadDashboardDTO(
  userId: string,
  dashboardId: string
): Promise<DashboardDTO> {
  return toDashboardDTO(await requireDashboard(userId, dashboardId));
}

// ── Dashboards ───────────────────────────────────────────────────────────────

/**
 * All dashboards of the user (order asc, widgets by creation).
 * Bootstraps the default dashboard on first read (zero rows → "Daily",
 * direct port of the v2 home view).
 */
export async function listDashboards(userId: string): Promise<DashboardDTO[]> {
  let rows = await db.dashboard.findMany({
    where: { userId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    include: { widgets: true },
  });

  if (rows.length === 0) {
    // nameKey resolution is impossible server-side — the default bootstrap
    // stores the literal English name ("Daily"); the UI may rename it.
    const created = await db.dashboard.create({
      data: {
        userId,
        name: "Daily",
        icon: DEFAULT_DASHBOARD.icon,
        order: 0,
        isDefault: true,
        templateKey: null,
      },
    });
    await insertWidgets(
      userId,
      created.id,
      templateToBlueprints(DEFAULT_DASHBOARD.widgets),
      "fallback"
    );
    rows = await db.dashboard.findMany({
      where: { userId },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      include: { widgets: true },
    });
  }

  return rows.map(toDashboardDTO);
}

export async function createDashboard(
  userId: string,
  input: DashboardCreate
): Promise<DashboardDTO> {
  let blueprints: WidgetBlueprint[] = [];
  let templateKey: string | null = null;
  if (input.templateKey != null) {
    const template = getTemplate(input.templateKey);
    if (!template) {
      throw new DashboardValidationError("TEMPLATE_NOT_FOUND", 404);
    }
    templateKey = template.key;
    blueprints = templateToBlueprints(template.dashboards[0]?.widgets ?? []);
  }

  // Dashboard and its initial widgets form one logical operation. If widget
  // persistence fails, roll back the dashboard instead of leaving it empty.
  return db.$transaction(async (tx) => {
    const count = await tx.dashboard.count({ where: { userId } });
    if (count >= MAX_DASHBOARDS) {
      throw new DashboardValidationError("TOO_MANY_DASHBOARDS", 409);
    }
    const dashboard = await tx.dashboard.create({
      data: {
        userId,
        name: input.name,
        icon: input.icon,
        order: await nextOrder(userId, tx),
        isDefault: count === 0,
        templateKey,
      },
    });
    await insertWidgets(userId, dashboard.id, blueprints, "fallback", undefined, tx);
    const row = await tx.dashboard.findFirst({
      where: { id: dashboard.id, userId },
      include: { widgets: true },
    });
    if (!row) throw new DashboardValidationError("DASHBOARD_NOT_FOUND", 404);
    return toDashboardDTO(row);
  });
}

export async function patchDashboard(
  userId: string,
  dashboardId: string,
  patch: DashboardPatch
): Promise<DashboardDTO> {
  return db.$transaction(async (tx) => {
    const existing = await tx.dashboard.findFirst({
      where: { id: dashboardId, userId },
    });
    if (!existing) throw new DashboardValidationError("DASHBOARD_NOT_FOUND", 404);

    if (patch.isDefault === true) {
      // Keep the default switch atomic: never commit with zero defaults
      // because the second write failed after clearing the previous one.
      await tx.dashboard.updateMany({
        where: { userId, isDefault: true, NOT: { id: existing.id } },
        data: { isDefault: false },
      });
    }

    const updated = await tx.dashboard.update({
      where: { id: existing.id },
      data: {
        ...(patch.name != null ? { name: patch.name } : {}),
        ...(patch.icon != null ? { icon: patch.icon } : {}),
        ...(patch.isDefault != null ? { isDefault: patch.isDefault } : {}),
      },
      include: { widgets: true },
    });
    return toDashboardDTO(updated);
  });
}

export async function deleteDashboard(
  userId: string,
  dashboardId: string
): Promise<void> {
  await db.$transaction(async (tx) => {
    const existing = await tx.dashboard.findFirst({
      where: { id: dashboardId, userId },
    });
    if (!existing) throw new DashboardValidationError("DASHBOARD_NOT_FOUND", 404);

    const remaining = await tx.dashboard.count({
      where: { userId, NOT: { id: existing.id } },
    });
    if (remaining === 0) {
      throw new DashboardValidationError("LAST_DASHBOARD", 409);
    }

    await tx.dashboard.delete({ where: { id: existing.id } }); // widgets cascade

    if (existing.isDefault) {
      // Promote the first remaining dashboard in the same transaction.
      const first = await tx.dashboard.findFirst({
        where: { userId },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      });
      if (first) {
        await tx.dashboard.update({
          where: { id: first.id },
          data: { isDefault: true },
        });
      }
    }
  });
}

export async function reorderDashboards(
  userId: string,
  order: string[]
): Promise<DashboardDTO[]> {
  const rows = await db.dashboard.findMany({
    where: { userId },
    select: { id: true },
  });
  const owned = new Set(rows.map((r) => r.id));
  const valid =
    rows.length === order.length &&
    new Set(order).size === order.length &&
    order.every((id) => owned.has(id));
  if (!valid) {
    throw new DashboardValidationError("DASHBOARD_NOT_FOUND", 404);
  }

  await db.$transaction(
    order.map((id, index) =>
      db.dashboard.update({ where: { id }, data: { order: index } })
    )
  );
  return listDashboards(userId);
}

// ── Widgets ──────────────────────────────────────────────────────────────────

export async function addWidget(
  userId: string,
  dashboardId: string,
  input: WidgetCreateInput
): Promise<DashboardWidgetDTO> {
  const dashboard = await requireDashboard(userId, dashboardId);

  const definition = getWidgetDefinition(input.type);
  if (!definition) {
    throw new DashboardValidationError("UNKNOWN_WIDGET_TYPE", 422);
  }

  const widgetCount = await db.dashboardWidget.count({
    where: { dashboardId: dashboard.id },
  });
  if (widgetCount >= MAX_WIDGETS_PER_DASHBOARD) {
    throw new DashboardValidationError("TOO_MANY_WIDGETS", 409);
  }

  let accountOverride: string | null = null;
  if (input.accountOverride != null) {
    const account = await db.account.findFirst({
      where: { id: input.accountOverride, userId },
      select: { id: true },
    });
    if (!account) {
      throw new DashboardValidationError("ACCOUNT_NOT_FOUND", 422);
    }
    accountOverride = account.id;
  }

  const configResult = safeParseWidgetConfig(
    input.type,
    input.config ?? definition.defaultConfig
  );
  const config = configResult.ok
    ? configResult.config
    : definition.defaultConfig;

  const existing = await db.dashboardWidget.findMany({
    where: { dashboardId: dashboard.id },
    select: { layouts: true },
  });
  const existingLg = existing
    .map((w) => parseJson<WidgetLayouts>(w.layouts, {}).lg)
    .filter((l): l is WidgetLayout => l != null);

  const layouts: WidgetLayouts =
    input.layouts ??
    (() => {
      const slot = findFreeSlot(
        existingLg,
        definition.defaultLayout.w,
        definition.defaultLayout.h
      );
      return {
        lg: {
          x: slot.x,
          y: slot.y,
          w: definition.defaultLayout.w,
          h: definition.defaultLayout.h,
        },
      };
    })();

  const created = await db.dashboardWidget.create({
    data: {
      dashboardId: dashboard.id,
      userId,
      type: input.type,
      title: input.title ?? null,
      config: JSON.stringify(config),
      layouts: JSON.stringify(migrateLayouts(1, layouts).layouts),
      periodOverride:
        input.periodOverride != null
          ? JSON.stringify(input.periodOverride)
          : null,
      accountOverride,
    },
  });
  return toWidgetDTO(created);
}

export async function patchWidget(
  userId: string,
  dashboardId: string,
  widgetId: string,
  input: WidgetPatchInput
): Promise<DashboardWidgetDTO> {
  const dashboard = await requireDashboard(userId, dashboardId);

  const widget = await db.dashboardWidget.findFirst({
    where: { id: widgetId, userId, dashboardId: dashboard.id },
  });
  if (!widget) {
    throw new DashboardValidationError("WIDGET_NOT_FOUND", 404);
  }

  let accountOverride: string | null | undefined;
  if (input.accountOverride !== undefined && input.accountOverride != null) {
    const account = await db.account.findFirst({
      where: { id: input.accountOverride, userId },
      select: { id: true },
    });
    if (!account) {
      throw new DashboardValidationError("ACCOUNT_NOT_FOUND", 422);
    }
    accountOverride = account.id;
  } else if (input.accountOverride === null) {
    accountOverride = null;
  }

  let config: string | undefined;
  if (input.config !== undefined) {
    const configResult = safeParseWidgetConfig(widget.type, input.config);
    if (!configResult.ok) {
      // Reject rather than silently reset — the client gets actionable
      // feedback and the stored config is preserved.
      throw new DashboardValidationError("INVALID_CONFIG", 422);
    }
    config = JSON.stringify(configResult.config);
  }

  const updated = await db.dashboardWidget.update({
    where: { id: widget.id },
    data: {
      ...(input.title !== undefined ? { title: input.title ?? null } : {}),
      ...(config !== undefined ? { config } : {}),
      ...(input.layouts !== undefined
        ? { layouts: JSON.stringify(migrateLayouts(1, input.layouts).layouts) }
        : {}),
      ...(input.periodOverride !== undefined
        ? {
            periodOverride:
              input.periodOverride != null
                ? JSON.stringify(input.periodOverride)
                : null,
          }
        : {}),
      ...(accountOverride !== undefined ? { accountOverride } : {}),
    },
  });
  return toWidgetDTO(updated);
}

export async function deleteWidget(
  userId: string,
  dashboardId: string,
  widgetId: string
): Promise<void> {
  const dashboard = await requireDashboard(userId, dashboardId);
  const widget = await db.dashboardWidget.findFirst({
    where: { id: widgetId, userId, dashboardId: dashboard.id },
  });
  if (!widget) {
    throw new DashboardValidationError("WIDGET_NOT_FOUND", 404);
  }
  await db.dashboardWidget.delete({ where: { id: widget.id } });
}

// ── Export / import ──────────────────────────────────────────────────────────

export async function exportDashboard(
  userId: string,
  dashboardId: string
): Promise<DashboardExportPayload> {
  const row = await requireDashboard(userId, dashboardId);
  return buildExportPayload(row);
}

export async function importDashboards(
  userId: string,
  payload: DashboardImportPayload,
  rawBytes: number
): Promise<{ dashboards: DashboardDTO[]; skipped: DashboardImportSkip[] }> {
  if (rawBytes > DASHBOARD_IMPORT_MAX_BYTES) {
    throw new DashboardValidationError("IMPORT_TOO_LARGE", 413);
  }

  const skipped: DashboardImportSkip[] = [];
  let limitReached = false;

  for (const [dashboardIndex, dashboardInput] of payload.dashboards.entries()) {
    const count = await db.dashboard.count({ where: { userId } });
    if (count >= MAX_DASHBOARDS) {
      limitReached = true;
    }
    if (limitReached) {
      skipped.push({
        dashboardIndex,
        widgetIndex: -1,
        type: "",
        reason: "LIMIT_REACHED",
      });
      continue;
    }

    const created = await db.dashboard.create({
      data: {
        userId,
        name: dashboardInput.name,
        icon: dashboardInput.icon ?? "layout-dashboard",
        order: await nextOrder(userId),
        isDefault: count === 0,
        templateKey: null,
      },
    });

    const blueprints: WidgetBlueprint[] = dashboardInput.widgets.map((w) => ({
      type: w.type,
      title: w.title ?? null,
      config: w.config,
      layouts: w.layouts,
      periodOverride: w.periodOverride ?? null,
    }));
    await insertWidgets(
      userId,
      created.id,
      blueprints,
      "skip",
      (widgetIndex, type, reason) =>
        skipped.push({ dashboardIndex, widgetIndex, type, reason })
    );
  }

  const dashboards = await listDashboards(userId);
  return { dashboards, skipped };
}

// ── Templates ────────────────────────────────────────────────────────────────

/**
 * Replace mode — drop the dashboard's widgets and insert the template's.
 * Returns the updated DTO plus the skipped-widget list (same semantics as
 * create: unknown types / invalid configs are skipped and reported).
 */
export async function applyTemplate(
  userId: string,
  dashboardId: string,
  templateKey: string
): Promise<{ dashboard: DashboardDTO; skipped: DashboardImportSkip[] }> {
  const dashboard = await requireDashboard(userId, dashboardId);

  const template = getTemplate(templateKey);
  if (!template) {
    throw new DashboardValidationError("TEMPLATE_NOT_FOUND", 404);
  }

  await db.dashboardWidget.deleteMany({
    where: { dashboardId: dashboard.id },
  });

  const skipped: DashboardImportSkip[] = [];
  const blueprints = templateToBlueprints(
    template.dashboards[0]?.widgets ?? []
  );
  await insertWidgets(userId, dashboard.id, blueprints, "fallback", (widgetIndex, type, reason) =>
    skipped.push({ dashboardIndex: 0, widgetIndex, type, reason })
  );

  return {
    dashboard: await loadDashboardDTO(userId, dashboard.id),
    skipped,
  };
}

export async function saveAsTemplate(
  userId: string,
  dashboardId: string,
  input: { name: string; description?: string | null }
): Promise<UserTemplateDTO> {
  const row = await requireDashboard(userId, dashboardId);
  const created = await db.userDashboardTemplate.create({
    data: {
      userId,
      name: input.name,
      description: input.description ?? null,
      definitionJson: JSON.stringify(buildExportPayload(row)),
    },
  });
  return toUserTemplateDTO(created);
}

export async function listUserTemplates(
  userId: string
): Promise<UserTemplateDTO[]> {
  const rows = await db.userDashboardTemplate.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toUserTemplateDTO);
}

export async function deleteUserTemplate(
  userId: string,
  templateId: string
): Promise<boolean> {
  const deleted = await db.userDashboardTemplate.deleteMany({
    where: { id: templateId, userId },
  });
  return deleted.count > 0;
}
