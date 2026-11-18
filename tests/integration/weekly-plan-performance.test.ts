/**
 * Phase 2 perf item 4 — weekly plan / performance report (db/test.db).
 *
 * The weekly plan only computes the 3 modules it uses; toggling a
 * checkbox is a single update when its row already exists (no plan
 * rebuild); the performance report embeds the standard 30d plan, so
 * the page needs no second GET /api/weekly-plan.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createUserWithDefaults } from "@/server/users";
import {
  getWeeklyPlan,
  toggleWeeklyPlanAction,
} from "@/server/weekly-plan";
import { getPerformanceReport } from "@/server/performance-report";
import {
  WEEKLY_PLAN_RULES,
  type WeeklyPlanRule,
} from "@/lib/validations/analytics";

const XAUUSD_SPEC = {
  symbol: "XAUUSD",
  name: "Gold / US Dollar",
  assetClass: "METAL",
  baseCurrency: "XAU",
  quoteCurrency: "USD",
  digits: 2,
  pipSize: "0.10",
  pointSize: "0.01",
  contractSize: "100",
  tickSize: "0.01",
  isActive: true,
};

let instrumentId: string;
let user: { id: string };
let accountId: string;

beforeAll(async () => {
  const existing = await db.instrument.findFirst({
    where: { userId: null, symbol: "XAUUSD" },
  });
  const instrument =
    existing ??
    (await db.instrument.create({
      data: { userId: null, ...XAUUSD_SPEC },
    }));
  instrumentId = instrument.id;

  const created = await createUserWithDefaults({
    email: "weekly-plan-perf@test.local",
    password: "test-password-123",
    displayName: "Weekly Plan Test",
    timezone: "America/Toronto",
    baseCurrency: "USD",
    locale: "en",
  });
  user = created.user;
  const accounts = await db.account.findMany({ where: { userId: user.id } });
  accountId = accounts[0].id;

  // 6 losing trades, same session, same entry-hour bucket, last 30 days:
  // worst-session + worst-hour + after-loss all fire.
  for (let i = 0; i < 6; i++) {
    const day = new Date(Date.UTC(2026, 10, 10 + i, 14, 0, 0));
    await db.trade.create({
      data: {
        userId: user.id,
        accountId,
        instrumentId,
        direction: "LONG",
        status: "CLOSED",
        session: "LONDON",
        entryTime: day,
        exitTime: new Date(day.getTime() + 2 * 60 * 60 * 1000),
        entryPrice: "2000",
        exitPrice: "1995",
        lots: "1",
        netPnl: "-50",
        rMultiple: "-0.5",
        resultType: "LOSS",
        followedPlan: true,
        riskPercent: "1",
        preTradeAnalysis: "",
        postTradeReview: "",
      },
    });
  }
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [user.id] } } });
  await db.$disconnect();
});

describe("weekly plan toggle (no rebuild)", () => {
  it("toggles an existing checkbox with a single update", async () => {
    const { plan } = await getWeeklyPlan(user.id, {});
    expect(plan.actions.length).toBeGreaterThan(0);
    const first = plan.actions[0];

    const toggled = await toggleWeeklyPlanAction(user.id, {
      rule: first.rule,
      done: true,
    });
    expect(toggled).toEqual({
      rule: first.rule,
      title: first.title,
      target: first.target,
      done: true,
    });
    const row = await db.weeklyPlanAction.findUnique({
      where: {
        userId_weekStart_rule: {
          userId: user.id,
          weekStart: new Date(`${plan.weekStart}T00:00:00.000Z`),
          rule: first.rule,
        },
      },
    });
    expect(row?.done).toBe(true);

    const untoggled = await toggleWeeklyPlanAction(user.id, {
      rule: first.rule,
      done: false,
    });
    expect(untoggled?.done).toBe(false);
  });

  it("returns null for a rule that is not in this week's plan", async () => {
    const { plan } = await getWeeklyPlan(user.id, {});
    const live = new Set(plan.actions.map((a) => a.rule));
    const absent = (WEEKLY_PLAN_RULES as readonly string[]).find(
      (r) => !live.has(r as WeeklyPlanRule)
    ) as WeeklyPlanRule | undefined;
    expect(absent).toBeDefined();
    if (absent == null) return;
    const result = await toggleWeeklyPlanAction(user.id, {
      rule: absent,
      done: true,
    });
    expect(result).toBeNull();
  });
});

describe("performance report embeds the 30d plan", () => {
  it("embeds the same plan at 30d (no second weekly-plan call)", async () => {
    const { plan } = await getWeeklyPlan(user.id, {});
    const payload = await getPerformanceReport(user.id, { period: "30d" });
    expect(payload.plan.actions.map((a) => a.rule)).toEqual(
      plan.actions.map((a) => a.rule)
    );
    // The report's recommendations are the plan's top actions.
    expect(payload.report.recommendations.map((a) => a.rule)).toEqual(
      plan.actions.slice(0, 3).map((a) => a.rule)
    );
    expect(payload.plan.weekStart).toBe(plan.weekStart);
  });

  it("still embeds the 30d plan at another period", async () => {
    const { plan } = await getWeeklyPlan(user.id, {});
    const payload = await getPerformanceReport(user.id, { period: "90d" });
    expect(payload.plan.actions.map((a) => a.rule)).toEqual(
      plan.actions.map((a) => a.rule)
    );
    expect(payload.period).toBe("90d");
  });
});
