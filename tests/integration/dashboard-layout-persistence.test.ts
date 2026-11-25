import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createUserWithDefaults } from "@/server/users";
import {
  addWidget,
  createDashboard,
  deleteDashboard,
  importDashboards,
  listDashboards,
  patchDashboard,
  patchWidget,
} from "@/server/dashboards";
import { dashboardImportSchema } from "@/lib/validations/dashboard";
import type { WidgetLayouts } from "@/lib/dashboard/types";

const L1: WidgetLayouts = { lg: { x: 0, y: 0, w: 4, h: 3 } };
const L2: WidgetLayouts = { lg: { x: 4, y: 0, w: 4, h: 3 } };
const L3: WidgetLayouts = { lg: { x: 8, y: 0, w: 4, h: 3 } };

let userAId: string;
let userBId: string;
let userCId: string;

async function makeUser(email: string) {
  const created = await createUserWithDefaults({
    email,
    password: "Test-password-123",
    displayName: "Dashboard Layout Test",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "en",
  });
  return created.user.id;
}

beforeAll(async () => {
  userAId = await makeUser("dashboard-layout-a@test.local");
  userBId = await makeUser("dashboard-layout-b@test.local");
  userCId = await makeUser("dashboard-layout-c@test.local");
});

afterAll(async () => {
  for (const id of [userAId, userBId, userCId]) {
    if (id) await db.user.deleteMany({ where: { id } });
  }
  await db.$disconnect();
});

/** Fresh dashboard of user A with one kpi-strip widget (version 0). */
async function freshDashboardWithWidget() {
  const dashboard = await createDashboard(userAId, {
    name: "Layout Test",
    icon: "layout-dashboard",
  });
  const widget = await addWidget(userAId, dashboard.id, {
    type: "kpi-strip",
    layouts: L1,
  });
  return { dashboard, widget };
}

describe("dashboard layout persistence (lot 12, roadmap §16)", () => {
  it("rejects a stale widget PATCH with 409 and never overwrites the newer layout", async () => {
    const { dashboard, widget } = await freshDashboardWithWidget();
    expect(widget.version).toBe(0);

    const saved = await patchWidget(userAId, dashboard.id, widget.id, {
      layouts: L2,
      expectedVersion: 0,
    });
    expect(saved.version).toBe(1);
    expect(saved.layouts.lg).toEqual(L2.lg);

    await expect(
      patchWidget(userAId, dashboard.id, widget.id, {
        layouts: L3,
        expectedVersion: 0,
      })
    ).rejects.toMatchObject({ code: "STALE_LAYOUT", status: 409 });

    const reread = await listDashboards(userAId);
    const row = reread
      .find((d) => d.id === dashboard.id)!
      .widgets.find((w) => w.id === widget.id)!;
    expect(row.version).toBe(1);
    expect(row.layouts.lg).toEqual(L2.lg);

    const savedAgain = await patchWidget(userAId, dashboard.id, widget.id, {
      layouts: L3,
      expectedVersion: 1,
    });
    expect(savedAgain.version).toBe(2);
    expect(savedAgain.layouts.lg).toEqual(L3.lg);
  });

  it("two overlapping saves with the same version resolve to exactly one winner", async () => {
    const { dashboard, widget } = await freshDashboardWithWidget();

    const results = await Promise.allSettled([
      patchWidget(userAId, dashboard.id, widget.id, {
        layouts: L2,
        expectedVersion: 0,
      }),
      patchWidget(userAId, dashboard.id, widget.id, {
        layouts: L3,
        expectedVersion: 0,
      }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(
      (rejected[0] as PromiseRejectedResult).reason
    ).toMatchObject({ code: "STALE_LAYOUT", status: 409 });

    const reread = await listDashboards(userAId);
    const row = reread
      .find((d) => d.id === dashboard.id)!
      .widgets.find((w) => w.id === widget.id)!;
    expect(row.version).toBe(1);
    expect([L2.lg, L3.lg]).toContainEqual(row.layouts.lg);
  });

  it("layouts persist across dashboard switch and re-read", async () => {
    const { dashboard, widget } = await freshDashboardWithWidget();
    await createDashboard(userAId, {
      name: "Second",
      icon: "layout-dashboard",
    });

    await patchWidget(userAId, dashboard.id, widget.id, {
      layouts: L2,
      expectedVersion: 0,
    });

    // "Switch" to the other dashboard and back: the first read must still
    // carry the patched layout, and a fresh read (page reload) too.
    const firstRead = await listDashboards(userAId);
    expect(
      firstRead
        .find((d) => d.id === dashboard.id)!
        .widgets.find((w) => w.id === widget.id)!.layouts.lg
    ).toEqual(L2.lg);
    expect(firstRead.find((d) => d.name === "Second")).toBeDefined();

    const secondRead = await listDashboards(userAId);
    expect(
      secondRead
        .find((d) => d.id === dashboard.id)!
        .widgets.find((w) => w.id === widget.id)!.layouts.lg
    ).toEqual(L2.lg);
  });

  it("import rejects a wrong schema version and reports skipped widgets", async () => {
    const badVersion = dashboardImportSchema.safeParse({
      version: 2,
      dashboards: [
        {
          name: "Imported",
          widgets: [{ type: "kpi-strip", layouts: L1 }],
        },
      ],
    });
    expect(badVersion.success).toBe(false);

    const goodVersion = dashboardImportSchema.safeParse({
      version: 1,
      dashboards: [
        {
          name: "Imported",
          widgets: [{ type: "kpi-strip", layouts: L1 }],
        },
      ],
    });
    expect(goodVersion.success).toBe(true);

    const { dashboards, skipped } = await importDashboards(
      userAId,
      {
        version: 1,
        dashboards: [
          {
            name: "Imported",
            icon: "layout-dashboard",
            widgets: [
              { type: "kpi-strip", title: null, layouts: L1 },
              { type: "no-such-widget", title: null, layouts: L1 },
              {
                type: "kpi-strip",
                title: null,
                config: "not-an-object",
                layouts: L1,
              },
            ],
          },
        ],
      },
      1024
    );
    expect(skipped).toContainEqual(
      expect.objectContaining({
        dashboardIndex: 0,
        type: "no-such-widget",
        reason: "UNKNOWN_WIDGET_TYPE",
      })
    );
    expect(skipped).toContainEqual(
      expect.objectContaining({
        dashboardIndex: 0,
        type: "kpi-strip",
        reason: "INVALID_CONFIG",
      })
    );
    const imported = dashboards.find((d) => d.name === "Imported");
    expect(imported).toBeDefined();
    expect(imported!.widgets).toHaveLength(1);
    expect(imported!.widgets[0]!.type).toBe("kpi-strip");
  });

  it("import stops at the dashboard limit and reports LIMIT_REACHED", async () => {
    // User C starts with the bootstrapped "Daily" dashboard; fill to 8.
    const existing = await listDashboards(userCId);
    expect(existing).toHaveLength(1);
    for (let i = 0; i < 7; i++) {
      await createDashboard(userCId, {
        name: `Filler ${i}`,
        icon: "layout-dashboard",
      });
    }
    expect(await db.dashboard.count({ where: { userId: userCId } })).toBe(8);

    const { skipped } = await importDashboards(
      userCId,
      {
        version: 1,
        dashboards: [
          {
            name: "Too Many",
            icon: "layout-dashboard",
            widgets: [{ type: "kpi-strip", title: null, layouts: L1 }],
          },
        ],
      },
      1024
    );
    expect(skipped).toContainEqual(
      expect.objectContaining({
        dashboardIndex: 0,
        widgetIndex: -1,
        reason: "LIMIT_REACHED",
      })
    );
    expect(await db.dashboard.count({ where: { userId: userCId } })).toBe(8);
  });

  it("unsetting the default promotes another dashboard; the only dashboard keeps it", async () => {
    const initial = await listDashboards(userAId);
    const daily = initial.find((d) => d.isDefault)!;
    await createDashboard(userAId, {
      name: "Promote Target",
      icon: "layout-dashboard",
    });

    const patched = await patchDashboard(userAId, daily.id, {
      isDefault: false,
    });
    expect(patched.isDefault).toBe(false);

    const after = await listDashboards(userAId);
    const defaults = after.filter((d) => d.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.id).not.toBe(daily.id);

    // User C has 8 dashboards but only one default: unsetting it there is
    // refused because there is nothing to promote on the only default.
    // (Use a fresh single-dashboard user instead: user B.)
    const bDashboards = await listDashboards(userBId);
    expect(bDashboards).toHaveLength(1);
    expect(bDashboards[0]!.isDefault).toBe(true);
    await expect(
      patchDashboard(userBId, bDashboards[0]!.id, { isDefault: false })
    ).rejects.toMatchObject({ code: "DEFAULT_REQUIRED", status: 409 });
    const bAfter = await listDashboards(userBId);
    expect(bAfter[0]!.isDefault).toBe(true);
  });

  it("a user cannot read or modify another user's dashboards", async () => {
    const { dashboard, widget } = await freshDashboardWithWidget();

    const bList = await listDashboards(userBId);
    expect(bList.some((d) => d.id === dashboard.id)).toBe(false);

    await expect(
      patchWidget(userBId, dashboard.id, widget.id, {
        layouts: L2,
        expectedVersion: 0,
      })
    ).rejects.toMatchObject({ code: "DASHBOARD_NOT_FOUND", status: 404 });
    await expect(
      patchDashboard(userBId, dashboard.id, { name: "Hacked" })
    ).rejects.toMatchObject({ code: "DASHBOARD_NOT_FOUND", status: 404 });
    await expect(
      deleteDashboard(userBId, dashboard.id)
    ).rejects.toMatchObject({ code: "DASHBOARD_NOT_FOUND", status: 404 });

    const aList = await listDashboards(userAId);
    expect(aList.find((d) => d.id === dashboard.id)).toBeDefined();
  });
});
