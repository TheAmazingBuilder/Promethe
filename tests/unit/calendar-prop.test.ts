import { describe, it, expect } from "vitest";
import {
  buildMonthGrid,
  computeMonthSummary,
  computeDayStreaks,
  computePropStatus,
  daysInMonth,
  localDateInTz,
  monthBounds,
  weekdayIndex,
  type CalendarDay,
} from "../../src/lib/analytics/calendar";

function day(
  date: string,
  netPnl: string,
  tradeCount = 1,
  extra: Partial<CalendarDay> = {},
): CalendarDay {
  return {
    date,
    netPnl,
    tradeCount,
    wins: Number(netPnl) > 0 ? tradeCount : 0,
    losses: Number(netPnl) < 0 ? tradeCount : 0,
    totalR: null,
    hasJournal: false,
    ...extra,
  };
}

// ── Month grid ───────────────────────────────────────────────────────────────

describe("buildMonthGrid (semaines lundi-first)", () => {
  it("janvier 2025 commence un mercredi — 2 cellules du mois précédent", () => {
    const weeks = buildMonthGrid(2025, 1);
    expect(weeks[0][0].date).toBe("2024-12-30");
    expect(weeks[0][0].inMonth).toBe(false);
    expect(weeks[0].map((c) => c.date)).toEqual([
      "2024-12-30",
      "2024-12-31",
      "2025-01-01",
      "2025-01-02",
      "2025-01-03",
      "2025-01-04",
      "2025-01-05",
    ]);
  });

  it("chaque semaine a 7 cellules et chaque cellule un numéro de semaine", () => {
    const weeks = buildMonthGrid(2026, 3);
    for (const week of weeks) {
      expect(week).toHaveLength(7);
      expect(new Set(week.map((c) => c.week)).size).toBe(1);
    }
  });

  it("compte exactement daysInMonth cellules in-month", () => {
    for (const [y, m] of [
      [2024, 2],
      [2025, 2],
      [2025, 12],
    ] as const) {
      const cells = buildMonthGrid(y, m).flat();
      expect(cells.filter((c) => c.inMonth)).toHaveLength(daysInMonth(y, m));
    }
  });

  it("février 2024 (bissextile) finit un jeudi", () => {
    const weeks = buildMonthGrid(2024, 2);
    const last = weeks.at(-1)!.filter((c) => c.inMonth).at(-1)!;
    expect(last.date).toBe("2024-02-29");
    expect(weekdayIndex(last.date)).toBe(3); // 0=lun … 3=jeu
  });

  it("le lundi précède toujours le dimanche dans chaque ligne", () => {
    for (const week of buildMonthGrid(2025, 6)) {
      expect(weekdayIndex(week[0].date)).toBe(0);
      expect(weekdayIndex(week[6].date)).toBe(6);
    }
  });
});

describe("monthBounds / daysInMonth", () => {
  it("bornes du mois", () => {
    expect(monthBounds(2025, 1)).toEqual({ first: "2025-01-01", last: "2025-01-31" });
    expect(monthBounds(2024, 2)).toEqual({ first: "2024-02-01", last: "2024-02-29" });
    expect(monthBounds(2025, 2)).toEqual({ first: "2025-02-01", last: "2025-02-28" });
  });
});

// ── Month summary ────────────────────────────────────────────────────────────

describe("computeMonthSummary", () => {
  it("mois vide → zéros et null", () => {
    const s = computeMonthSummary([]);
    expect(s.netPnl).toBe("0");
    expect(s.tradingDays).toBe(0);
    expect(s.bestDay).toBeNull();
    expect(s.greenRate).toBeNull();
  });

  it("agrège verts/rouges, meilleur/pire jour et taux de jours verts", () => {
    const s = computeMonthSummary([
      day("2025-05-02", "120"),
      day("2025-05-05", "-80"),
      day("2025-05-06", "-20"),
      day("2025-05-09", "60"),
      day("2025-05-10", "0", 2), // plat, compte comme jour de trading
    ]);
    expect(s.netPnl).toBe("80");
    expect(s.tradingDays).toBe(5);
    expect(s.greenDays).toBe(2);
    expect(s.redDays).toBe(2);
    expect(s.bestDay).toEqual({ date: "2025-05-02", netPnl: "120" });
    expect(s.worstDay).toEqual({ date: "2025-05-05", netPnl: "-80" });
    expect(Number(s.greenRate)).toBe(40);
  });

  it("ignore les jours sans trade (journal seul)", () => {
    const s = computeMonthSummary([day("2025-05-02", "0", 0, { hasJournal: true })]);
    expect(s.tradingDays).toBe(0);
    expect(s.netPnl).toBe("0");
  });
});

// ── Streaks ─────────────────────────────────────────────────────────────────

describe("computeDayStreaks", () => {
  it("streak courant gagnant, plus longue série perdante", () => {
    const s = computeDayStreaks([
      day("2025-05-01", "-50"),
      day("2025-05-02", "-30"),
      day("2025-05-03", "-10"),
      day("2025-05-05", "40"),
      day("2025-05-06", "60"),
    ]);
    expect(s.current).toBe(2);
    expect(s.longestLoss).toBe(3);
    expect(s.longestWin).toBe(2);
  });

  it("un jour sans trading ne casse pas la série", () => {
    const s = computeDayStreaks([
      day("2025-05-01", "40"),
      day("2025-05-05", "60"), // 3 jours sans trading entre les deux
    ]);
    expect(s.current).toBe(2);
    expect(s.longestWin).toBe(2);
  });

  it("jour plat réinitialise la série courante", () => {
    const s = computeDayStreaks([
      day("2025-05-01", "40"),
      day("2025-05-02", "0"),
      day("2025-05-03", "60"),
    ]);
    expect(s.current).toBe(1);
    expect(s.longestWin).toBe(1);
  });

  it("aucun jour de trading → zéros", () => {
    const s = computeDayStreaks([day("2025-05-01", "0", 0)]);
    expect(s.current).toBe(0);
    expect(s.longestWin).toBe(0);
    expect(s.longestLoss).toBe(0);
  });
});

// ── PROP status ─────────────────────────────────────────────────────────────

describe("computePropStatus", () => {
  const base = {
    initialBalance: "100000",
    currentEquity: "100000",
    peakEquity: "100000",
    todayPnl: "0",
    maxDailyLossPercent: "5",
    maxTotalDrawdownPercent: "10",
    profitTarget: "10000",
    drawdownType: "STATIC" as const,
  };

  it("compte intact → OK partout", () => {
    const s = computePropStatus(base);
    expect(s.overall).toBe("OK");
    expect(s.dailyLoss.status).toBe("OK");
    expect(s.totalDrawdown.status).toBe("OK");
    expect(s.dailyLoss.limitAmount).toBe("5000");
    expect(s.totalDrawdown.limitAmount).toBe("10000");
    expect(s.profitTarget.reached).toBe(false);
    expect(s.profitTarget.progressPercent).toBe("0");
  });

  it("perte du jour à 60 % de la limite → OK, à 80 % → WARNING", () => {
    const s60 = computePropStatus({ ...base, todayPnl: "-3000" });
    expect(s60.dailyLoss.status).toBe("OK");
    expect(s60.dailyLoss.used).toBe("3000");
    expect(s60.dailyLoss.remaining).toBe("2000");
    expect(Number(s60.dailyLoss.usedPercent)).toBe(60);

    const s80 = computePropStatus({ ...base, todayPnl: "-4000" });
    expect(s80.dailyLoss.status).toBe("WARNING");
    expect(s80.overall).toBe("WARNING");
  });

  it("perte du jour à 95 % de la limite → IMMINENT (Lot 5)", () => {
    const s95 = computePropStatus({ ...base, todayPnl: "-4750" });
    expect(s95.dailyLoss.status).toBe("IMMINENT");
    expect(s95.overall).toBe("IMMINENT");
    expect(s95.breached).toBe(false);
    const s94 = computePropStatus({ ...base, todayPnl: "-4700" });
    expect(s94.dailyLoss.status).toBe("WARNING");
  });

  it("perte du jour au-delà de la limite → BREACHED", () => {
    const s = computePropStatus({ ...base, todayPnl: "-5200" });
    expect(s.dailyLoss.status).toBe("BREACHED");
    expect(s.overall).toBe("BREACHED");
    expect(s.breached).toBe(true);
    expect(Number(s.dailyLoss.usedPercent)).toBe(104);
    expect(s.dailyLoss.remaining).toBe("-200");
  });

  it("gain du jour → consommation nulle", () => {
    const s = computePropStatus({ ...base, todayPnl: "1500" });
    expect(s.dailyLoss.used).toBe("0");
    expect(s.todayStartEquity).toBe("98500");
  });

  it("drawdown STATIC mesuré depuis le solde initial", () => {
    const s = computePropStatus({ ...base, currentEquity: "92000", peakEquity: "92000" });
    expect(s.totalDrawdown.used).toBe("8000");
    expect(s.totalDrawdown.status).toBe("WARNING"); // 80 % de 10 000
  });

  it("drawdown TRAILING mesuré depuis le plus haut", () => {
    const s = computePropStatus({
      ...base,
      currentEquity: "104000",
      peakEquity: "112000",
      drawdownType: "TRAILING",
    });
    // 112 000 − 104 000 = 8 000 consommés (le gain accumulé compte)
    expect(s.totalDrawdown.used).toBe("8000");
    expect(s.totalDrawdown.status).toBe("WARNING");
    expect(s.drawdownType).toBe("TRAILING");
  });

  it("drawdown TRAILING au plus haut → consommation nulle malgré le gain", () => {
    const s = computePropStatus({
      ...base,
      currentEquity: "112000",
      peakEquity: "112000",
      drawdownType: "TRAILING",
    });
    expect(s.totalDrawdown.used).toBe("0");
    expect(s.overall).toBe("OK");
    expect(s.profitTarget.reached).toBe(true);
    expect(s.profitTarget.remaining).toBe("-2000");
  });

  it("limites non configurées → statuts OK avec valeurs nulles", () => {
    const s = computePropStatus({
      ...base,
      maxDailyLossPercent: null,
      maxTotalDrawdownPercent: null,
      profitTarget: null,
      todayPnl: "-9000",
      currentEquity: "91000",
    });
    expect(s.dailyLoss.status).toBe("OK");
    expect(s.dailyLoss.limitAmount).toBeNull();
    expect(s.dailyLoss.usedPercent).toBeNull();
    expect(s.totalDrawdown.limitAmount).toBeNull();
    expect(s.profitTarget.targetAmount).toBeNull();
    expect(s.profitTarget.progressPercent).toBeNull();
  });

  it("drawdownType null → défaut STATIC", () => {
    const s = computePropStatus({ ...base, drawdownType: null });
    expect(s.drawdownType).toBe("STATIC");
  });

  it("objectif atteint sans dépasser les limites → OK global", () => {
    const s = computePropStatus({
      ...base,
      currentEquity: "110500",
      peakEquity: "110500",
    });
    expect(s.profitTarget.reached).toBe(true);
    expect(s.overall).toBe("OK");
    expect(Number(s.profitTarget.progressPercent)).toBe(105);
  });
});

// ── Local dates ──────────────────────────────────────────────────────────────

describe("localDateInTz / weekdayIndex", () => {
  it("convertit un instant UTC en date locale", () => {
    // 2025-01-01 00:30 UTC = 2024-12-31 19:30 à Toronto (UTC-5)
    expect(localDateInTz(new Date("2025-01-01T00:30:00Z"), "America/Toronto")).toBe(
      "2024-12-31",
    );
    expect(localDateInTz(new Date("2025-01-01T00:30:00Z"), "UTC")).toBe("2025-01-01");
    expect(localDateInTz(new Date("2025-01-01T00:30:00Z"), "Asia/Tokyo")).toBe(
      "2025-01-01",
    );
  });

  it("fuseau invalide → null", () => {
    expect(localDateInTz(new Date(), "Mars/Olympus")).toBeNull();
  });

  it("weekdayIndex : lundi=0, dimanche=6", () => {
    expect(weekdayIndex("2025-01-06")).toBe(0);
    expect(weekdayIndex("2025-01-12")).toBe(6);
  });
});
