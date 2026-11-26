import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createUserWithDefaults } from "@/server/users";
import {
  createDashboard,
  deleteDashboard,
  listDashboards,
  patchDashboard,
} from "@/server/dashboards";

let userId: string;

beforeAll(async () => {
  const created = await createUserWithDefaults({
    email: "dashboard-mutations@test.local",
    password: "test-password-123",
    displayName: "Dashboard Mutation Test",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "en",
  });
  userId = created.user.id;
});

afterAll(async () => {
  if (userId) await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});

describe("dashboard mutations preserve invariants", () => {
  it("switches the default and promotes a remaining dashboard atomically", async () => {
    const initial = await listDashboards(userId);
    expect(initial).toHaveLength(1);
    expect(initial[0]?.isDefault).toBe(true);

    const created = await createDashboard(userId, {
      name: "Secondary",
      icon: "layout-dashboard",
    });
    expect(created.isDefault).toBe(false);

    const selected = await patchDashboard(userId, created.id, {
      isDefault: true,
    });
    expect(selected.isDefault).toBe(true);

    const afterSwitch = await listDashboards(userId);
    expect(afterSwitch.filter((dashboard) => dashboard.isDefault)).toHaveLength(1);
    expect(afterSwitch.find((dashboard) => dashboard.id === initial[0]?.id)?.isDefault).toBe(false);

    await deleteDashboard(userId, created.id);
    const afterDelete = await listDashboards(userId);
    expect(afterDelete).toHaveLength(1);
    expect(afterDelete[0]?.id).toBe(initial[0]?.id);
    expect(afterDelete[0]?.isDefault).toBe(true);
  });

  it("does not allow deleting the last dashboard", async () => {
    const dashboards = await listDashboards(userId);
    await expect(deleteDashboard(userId, dashboards[0]!.id)).rejects.toMatchObject({
      code: "LAST_DASHBOARD",
      status: 409,
    });
    expect(await db.dashboard.count({ where: { userId } })).toBe(1);
  });
});
