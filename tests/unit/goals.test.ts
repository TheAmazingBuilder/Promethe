import { describe, it, expect } from "vitest";
import {
  computeGoalProgress,
  goalWindow,
  type GoalDef,
  type GoalTradePoint,
  type GoalDisciplinePoint,
} from "../../src/lib/trading/goals";

const TZ = "America/Toronto";

function goal(over: Partial<GoalDef> = {}): GoalDef {
  return {
    id: "g1",
    metric: "NET_PNL",
    name: "Test",
    targetValue: "1000",
    period: "MONTHLY",
    startDate: "2026-01-01",
    endDate: null,
    ...over,
  };
}

/** 2026-11-14 12:00 Toronto (UTC-5 → 17:00Z). */
const NOW = new Date("2026-11-14T12:00:00-05:00");

function tp(exitIso: string, netPnl: string, rMultiple: string | null = null): GoalTradePoint {
  return { exitIso, netPnl, rMultiple };
}

// ── Fenêtres ────────────────────────────────────────────────────────────────

describe("goalWindow — période courante (TZ Toronto)", () => {
  it("MONTHLY : 1er du mois courant → 1er du mois suivant", () => {
    const w = goalWindow(goal({ period: "MONTHLY" }), NOW, TZ);
    expect(w).toEqual({
      startDay: "2026-11-01",
      endDay: "2026-12-01",
      today: "2026-11-14",
    });
  });

  it("WEEKLY : lundi de la semaine courante (14 nov 2026 = samedi)", () => {
    const w = goalWindow(goal({ period: "WEEKLY" }), NOW, TZ);
    expect(w.startDay).toBe("2026-11-09"); // lundi
    expect(w.endDay).toBe("2026-11-16");
  });

  it("QUARTERLY : Q4 → 1er janvier suivant", () => {
    const w = goalWindow(goal({ period: "QUARTERLY" }), NOW, TZ);
    expect(w.startDay).toBe("2026-10-01");
    expect(w.endDay).toBe("2027-01-01");
  });

  it("QUARTERLY : Q1 2026 → 2026-04-01", () => {
    const w = goalWindow(
      goal({ period: "QUARTERLY" }),
      new Date("2026-02-10T10:00:00-05:00"),
      TZ
    );
    expect(w.startDay).toBe("2026-01-01");
    expect(w.endDay).toBe("2026-04-01");
  });

  it("YEARLY : année civile courante", () => {
    const w = goalWindow(goal({ period: "YEARLY" }), NOW, TZ);
    expect(w.startDay).toBe("2026-01-01");
    expect(w.endDay).toBe("2027-01-01");
  });

  it("ALL_TIME : startDate → ∞, borné par endDate", () => {
    expect(
      goalWindow(goal({ period: "ALL_TIME", startDate: "2025-06-15" }), NOW, TZ)
    ).toEqual({ startDay: "2025-06-15", endDay: "9999-12-31", today: "2026-11-14" });
    expect(
      goalWindow(
        goal({ period: "ALL_TIME", startDate: "2025-06-15", endDate: "2026-03-31" }),
        NOW,
        TZ
      )
    ).toEqual({ startDay: "2025-06-15", endDay: "2026-04-01", today: "2026-11-14" });
  });

  it("clamp : startDate après le début de période", () => {
    const w = goalWindow(
      goal({ period: "MONTHLY", startDate: "2026-11-08" }),
      NOW,
      TZ
    );
    expect(w.startDay).toBe("2026-11-08");
    expect(w.endDay).toBe("2026-12-01");
  });

  it("le changement de jour suit la TZ (02:00Z du 1er déc = 30 nov 21:00 Toronto)", () => {
    // En UTC on est déjà le 1er décembre ; à Toronto c'est encore le 30
    // novembre → fenêtre du MOIS DE NOVEMBRE.
    const w = goalWindow(
      goal({ period: "MONTHLY" }),
      new Date("2026-12-01T02:00:00Z"),
      TZ
    );
    expect(w.startDay).toBe("2026-11-01");
  });

  it("TZ invalide → repli UTC sans crash", () => {
    const w = goalWindow(goal({ period: "MONTHLY" }), NOW, "Not/AZone");
    expect(w.startDay).toBe("2026-11-01");
  });
});

// ── Métriques ───────────────────────────────────────────────────────────────

describe("computeGoalProgress — métriques", () => {
  const nov = (day: number, hour = 10) =>
    `2026-11-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00-05:00`;

  it("NET_PNL : somme des trades clôturés dans la fenêtre, hors fenêtre ignorés", () => {
    const p = computeGoalProgress(
      goal({ id: "g1", metric: "NET_PNL", targetValue: "500" }),
      [
        tp(nov(3), "200"),
        tp(nov(10), "150"),
        tp(nov(13), "-50"),
        tp("2026-10-31T20:00:00-04:00", "9999"), // jour local 31 oct → hors fenêtre
        tp(nov(20), "100"), // futur relatif à now ? — inclus : la fenêtre va jusqu'au 12-01
      ],
      [],
      NOW,
      TZ
    );
    expect(p.currentValue).toBe("400");
    expect(p.progressPercent).toBe(80);
    expect(p.isAchieved).toBe(false);
  });

  it("NET_PNL : objectif atteint → isAchieved, progress plafonné à 100", () => {
    const p = computeGoalProgress(
      goal({ id: "g1", metric: "NET_PNL", targetValue: "300" }),
      [tp(nov(5), "600")],
      [],
      NOW,
      TZ
    );
    expect(p.isAchieved).toBe(true);
    expect(p.progressPercent).toBe(100);
  });

  it("WIN_RATE : % de trades gagnants ; null sans trade", () => {
    const g = goal({ id: "g1", metric: "WIN_RATE", targetValue: "55" });
    const p = computeGoalProgress(
      g,
      [tp(nov(2), "100"), tp(nov(4), "-40"), tp(nov(6), "80"), tp(nov(8), "0")],
      [],
      NOW,
      TZ
    );
    expect(p.currentValue).toBe("50");
    expect(p.progressPercent).toBe(90.91); // 50 / 55 × 100

    const empty = computeGoalProgress(g, [], [], NOW, TZ);
    expect(empty.currentValue).toBeNull();
    expect(empty.progressPercent).toBe(0);
  });

  it("AVG_R : moyenne des R non nuls ; trades sans R ignorés", () => {
    const p = computeGoalProgress(
      goal({ id: "g1", metric: "AVG_R", targetValue: "0.5" }),
      [tp(nov(2), "100", "1.5"), tp(nov(4), "-40", "-0.5"), tp(nov(6), "0", null)],
      [],
      NOW,
      TZ
    );
    expect(p.currentValue).toBe("0.5");
    expect(p.isAchieved).toBe(true);
  });

  it("PROFIT_FACTOR : gains/pertes bruts, Infinity sans perte, null sans données", () => {
    const g = goal({ id: "g1", metric: "PROFIT_FACTOR", targetValue: "2" });
    expect(
      computeGoalProgress(
        g,
        [tp(nov(2), "300"), tp(nov(4), "-100"), tp(nov(6), "-50")],
        [],
        NOW,
        TZ
      ).currentValue
    ).toBe("2");
    expect(
      computeGoalProgress(g, [tp(nov(2), "300")], [], NOW, TZ).currentValue
    ).toBe("Infinity");
    expect(computeGoalProgress(g, [], [], NOW, TZ).currentValue).toBeNull();
    // Infinity ≥ target → atteint.
    expect(
      computeGoalProgress(g, [tp(nov(2), "300")], [], NOW, TZ).isAchieved
    ).toBe(true);
  });

  it("TRADE_COUNT : nombre de trades, 0 sans données (pas null)", () => {
    const p = computeGoalProgress(
      goal({ id: "g1", metric: "TRADE_COUNT", targetValue: "10" }),
      [tp(nov(2), "1"), tp(nov(3), "-1"), tp(nov(4), "0")],
      [],
      NOW,
      TZ
    );
    expect(p.currentValue).toBe("3");
    expect(
      computeGoalProgress(
        goal({ id: "g2", metric: "TRADE_COUNT" }),
        [],
        [],
        NOW,
        TZ
      ).currentValue
    ).toBe("0");
  });

  it("DISCIPLINE_SCORE : moyenne des scores journal dans la fenêtre", () => {
    const ds: GoalDisciplinePoint[] = [
      { date: "2026-11-02", score: 4 },
      { date: "2026-11-03", score: 5 },
      { date: "2026-11-10", score: 3 },
      { date: "2026-10-31", score: 1 }, // hors fenêtre
    ];
    const p = computeGoalProgress(
      goal({ id: "g1", metric: "DISCIPLINE_SCORE", targetValue: "4" }),
      [],
      ds,
      NOW,
      TZ
    );
    expect(p.currentValue).toBe("4");
    expect(p.isAchieved).toBe(true);
  });

  it("netPnl null compté 0 (trade clôturé sans P&L)", () => {
    const p = computeGoalProgress(
      goal({ id: "g1", metric: "NET_PNL", targetValue: "100" }),
      [tp(nov(2), "50"), tp(nov(3), null as unknown as string)],
      [],
      NOW,
      TZ
    );
    expect(p.currentValue).toBe("50");
  });
});

// ── Expiration ──────────────────────────────────────────────────────────────

describe("computeGoalProgress — expiration", () => {
  it("endDate passé et non atteint → isExpired", () => {
    const p = computeGoalProgress(
      goal({
        id: "g1",
        metric: "NET_PNL",
        targetValue: "1000",
        startDate: "2026-01-01",
        endDate: "2026-10-31",
      }),
      [tp("2026-05-01T10:00:00-04:00", "100")],
      [],
      NOW,
      TZ
    );
    expect(p.isExpired).toBe(true);
    expect(p.isAchieved).toBe(false);
  });

  it("endDate futur → pas expiré même sans progrès", () => {
    const p = computeGoalProgress(
      goal({ id: "g1", metric: "NET_PNL", endDate: "2026-11-30" }),
      [],
      [],
      NOW,
      TZ
    );
    expect(p.isExpired).toBe(false);
  });

  it("target ≤ 0 jamais atteint (garde)", () => {
    const p = computeGoalProgress(
      goal({ id: "g1", metric: "NET_PNL", targetValue: "0" }),
      [tp("2026-11-02T10:00:00-05:00", "500")],
      [],
      NOW,
      TZ
    );
    expect(p.isAchieved).toBe(false);
    expect(p.progressPercent).toBe(0);
  });
});
