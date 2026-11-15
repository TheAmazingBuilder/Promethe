import { describe, it, expect } from "vitest";
import {
  evaluateRules,
  type RuleDef,
  type RuleTradeContext,
  type RuleDayContext,
} from "../../src/lib/trading/rules";

function rule(over: Partial<RuleDef> & Pick<RuleDef, "id" | "kind">): RuleDef {
  return {
    value: "3",
    description: null,
    isActive: true,
    ...over,
  };
}

function trade(over: Partial<RuleTradeContext> = {}): RuleTradeContext {
  return {
    status: "CLOSED",
    isDraft: false,
    entryLocalDay: "2026-11-10",
    exitLocalDay: "2026-11-10",
    riskAmount: "100",
    netPnl: "-50",
    ...over,
  };
}

function day(over: Partial<RuleDayContext> = {}): RuleDayContext {
  return {
    entryDayCount: 1,
    exitDayPnl: ["-50"],
    ...over,
  };
}

// ── MAX_TRADES_PER_DAY ──────────────────────────────────────────────────────

describe("evaluateRules — MAX_TRADES_PER_DAY", () => {
  it("compte > limite → violation avec la valeur mesurée", () => {
    const v = evaluateRules(
      [rule({ id: "r1", kind: "MAX_TRADES_PER_DAY", value: "3" })],
      trade(),
      day({ entryDayCount: 4 })
    );
    expect(v).toEqual([
      { ruleId: "r1", kind: "MAX_TRADES_PER_DAY", measured: "4", limit: "3" },
    ]);
  });

  it("compte = limite → OK (la limite est atteignable)", () => {
    const v = evaluateRules(
      [rule({ id: "r1", kind: "MAX_TRADES_PER_DAY", value: "3" })],
      trade(),
      day({ entryDayCount: 3 })
    );
    expect(v).toEqual([]);
  });

  it("limite décimale 2.5 : 3 trades > 2.5 → violation", () => {
    const v = evaluateRules(
      [rule({ id: "r1", kind: "MAX_TRADES_PER_DAY", value: "2.5" })],
      trade(),
      day({ entryDayCount: 3 })
    );
    expect(v).toHaveLength(1);
    expect(v[0].measured).toBe("3");
  });
});

// ── MAX_DAILY_LOSS ──────────────────────────────────────────────────────────

describe("evaluateRules — MAX_DAILY_LOSS", () => {
  it("perte du jour ≤ −limite → violation (égale = breach)", () => {
    const v = evaluateRules(
      [rule({ id: "r1", kind: "MAX_DAILY_LOSS", value: "500" })],
      trade(),
      day({ exitDayPnl: ["-300", "-200"] })
    );
    expect(v).toEqual([
      {
        ruleId: "r1",
        kind: "MAX_DAILY_LOSS",
        measured: "-500",
        limit: "-500",
      },
    ]);
  });

  it("jour au-dessus de la limite (incl. jour positif) → OK", () => {
    const r = rule({ id: "r1", kind: "MAX_DAILY_LOSS", value: "500" });
    expect(
      evaluateRules([r], trade(), day({ exitDayPnl: ["-300", "-199"] }))
    ).toEqual([]);
    expect(
      evaluateRules([r], trade(), day({ exitDayPnl: ["100", "50"] }))
    ).toEqual([]);
  });

  it("trade OUVERT non évalué (pas de P&L réalisé)", () => {
    const v = evaluateRules(
      [rule({ id: "r1", kind: "MAX_DAILY_LOSS", value: "500" })],
      trade({ status: "OPEN", exitLocalDay: null, netPnl: null }),
      day({ exitDayPnl: [] })
    );
    expect(v).toEqual([]);
  });

  it("les autres jours de sortie ne comptent pas", () => {
    // Le contexte exitDayPnl est fourni par le serveur pour le jour de
    // sortie DU trade — le moteur fait confiance à l'agrégat.
    const v = evaluateRules(
      [rule({ id: "r1", kind: "MAX_DAILY_LOSS", value: "100" })],
      trade({ exitLocalDay: "2026-11-11" }),
      day({ exitDayPnl: ["-150"] })
    );
    expect(v).toHaveLength(1);
  });
});

// ── MAX_RISK_PER_TRADE ──────────────────────────────────────────────────────

describe("evaluateRules — MAX_RISK_PER_TRADE", () => {
  it("risque > limite → violation", () => {
    const v = evaluateRules(
      [rule({ id: "r1", kind: "MAX_RISK_PER_TRADE", value: "100" })],
      trade({ riskAmount: "100.01" }),
      day()
    );
    expect(v).toEqual([
      {
        ruleId: "r1",
        kind: "MAX_RISK_PER_TRADE",
        measured: "100.01",
        limit: "100",
      },
    ]);
  });

  it("risque = limite → OK ; risque null → non évalué", () => {
    const r = rule({ id: "r1", kind: "MAX_RISK_PER_TRADE", value: "100" });
    expect(evaluateRules([r], trade({ riskAmount: "100" }), day())).toEqual([]);
    expect(
      evaluateRules([r], trade({ riskAmount: null }), day())
    ).toEqual([]);
  });

  it("évalué aussi sur un trade OUVERT (risque connu à l'entrée)", () => {
    const v = evaluateRules(
      [rule({ id: "r1", kind: "MAX_RISK_PER_TRADE", value: "50" })],
      trade({ status: "OPEN", exitLocalDay: null, netPnl: null, riskAmount: "75" }),
      day({ exitDayPnl: [] })
    );
    expect(v).toHaveLength(1);
  });
});

// ── Globales ────────────────────────────────────────────────────────────────

describe("evaluateRules — règles globales", () => {
  it("brouillon jamais évalué, règle inactive ignorée, CUSTOM jamais détectée", () => {
    const rules: RuleDef[] = [
      rule({ id: "r1", kind: "MAX_TRADES_PER_DAY", value: "3" }),
      rule({ id: "r2", kind: "MAX_DAILY_LOSS", value: "1", isActive: false }),
      rule({ id: "r3", kind: "MAX_RISK_PER_TRADE", value: "150" }),
      rule({ id: "r4", kind: "CUSTOM" }),
    ];
    expect(evaluateRules(rules, trade({ isDraft: true }), day())).toEqual([]);
    expect(
      evaluateRules(rules, trade(), day({ entryDayCount: 1, exitDayPnl: ["10"] }))
    ).toEqual([]);
  });

  it("plusieurs violations cumulées, ordre stable des règles", () => {
    const rules: RuleDef[] = [
      rule({ id: "a", kind: "MAX_TRADES_PER_DAY", value: "2" }),
      rule({ id: "b", kind: "MAX_DAILY_LOSS", value: "100" }),
      rule({ id: "c", kind: "MAX_RISK_PER_TRADE", value: "50" }),
    ];
    const v = evaluateRules(
      rules,
      trade({ riskAmount: "80", netPnl: "-120" }),
      day({ entryDayCount: 3, exitDayPnl: ["-120"] })
    );
    expect(v.map((x) => x.ruleId)).toEqual(["a", "b", "c"]);
  });

  it("valeur ≤ 0 → règle ignorée (garde anti-configuration)", () => {
    const v = evaluateRules(
      [rule({ id: "r1", kind: "MAX_DAILY_LOSS", value: "0" })],
      trade(),
      day({ exitDayPnl: ["-9999"] })
    );
    expect(v).toEqual([]);
  });
});
