import { describe, it, expect } from "vitest";
import { GOAL_TEMPLATES, findGoalTemplate } from "../../src/lib/trading/goal-templates";
import { GOAL_METRICS, GOAL_PERIODS } from "../../src/lib/trading/goals";

/**
 * Goal templates (MRT wave 3) — predefined in code, never seeded in the
 * database. The view turns a template into a real Goal row on "Add goal".
 */
describe("GOAL_TEMPLATES", () => {
  it("five templates, unique ids, valid metric / period / target", () => {
    expect(GOAL_TEMPLATES).toHaveLength(5);
    const ids = GOAL_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of GOAL_TEMPLATES) {
      expect(GOAL_METRICS).toContain(t.metric);
      expect(GOAL_PERIODS).toContain(t.period);
      expect(Number(t.targetValue)).toBeGreaterThan(0);
    }
  });

  it("covers the three MRT demo goals (A+ win rate, plan follow, screenshots)", () => {
    expect(findGoalTemplate("a-plus-win-rate")).toMatchObject({
      metric: "A_PLUS_WIN_RATE",
      targetValue: "70",
      period: "MONTHLY",
    });
    expect(findGoalTemplate("follow-plan")).toMatchObject({
      metric: "PLAN_FOLLOW_RATE",
      targetValue: "90",
      period: "MONTHLY",
    });
    expect(findGoalTemplate("log-with-screenshot")).toMatchObject({
      metric: "TRADES_WITH_SCREENSHOT",
      targetValue: "30",
      period: "MONTHLY",
    });
  });

  it("unknown id → undefined", () => {
    expect(findGoalTemplate("nope")).toBeUndefined();
  });
});
