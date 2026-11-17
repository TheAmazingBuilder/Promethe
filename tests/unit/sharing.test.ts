/**
 * v3 Phase 4 — PURE unit tests for the sharing layer.
 *
 * Covers: share-link status transitions, policy summaries, report payload
 * redaction (structural absence of monetary fields, equity → %), snapshot
 * JSON round-trip and the read-time URL injection (raw token never stored).
 */
import { describe, expect, it } from "vitest";
import {
  shareLinkStatus,
  policySummary,
  expiryLabel,
  MAX_EXPIRY_DAYS,
} from "@/lib/sharing/status";
import {
  redactReportPayload,
  parseStoredSnapshot,
  toPublicPayload,
} from "@/lib/sharing/snapshot";
import {
  findLeaks,
  NO_REDACTION,
  PIPS_R_ONLY_PRESET,
} from "@/lib/redaction";

// ── shareLinkStatus ──────────────────────────────────────────────────────────

describe("shareLinkStatus", () => {
  const base = {
    revokedAt: null,
    expiresAt: new Date("2099-01-01T00:00:00Z"),
    maxViews: null,
    viewCount: 0,
  };
  const now = new Date("2025-06-01T00:00:00Z");

  it("est ACTIVE tant que rien ne bloque", () => {
    expect(shareLinkStatus(base, now)).toBe("ACTIVE");
  });

  it("passe REVOKED dès revokedAt défini (priorité maximale)", () => {
    expect(
      shareLinkStatus({ ...base, revokedAt: new Date("2025-05-01T00:00:00Z") }, now)
    ).toBe("REVOKED");
  });

  it("passe EXPIRED après expiresAt", () => {
    expect(
      shareLinkStatus({ ...base, expiresAt: new Date("2025-05-31T23:59:59Z") }, now)
    ).toBe("EXPIRED");
  });

  it("passe VIEW_LIMIT quand viewCount atteint maxViews", () => {
    expect(shareLinkStatus({ ...base, maxViews: 3, viewCount: 3 }, now)).toBe(
      "VIEW_LIMIT"
    );
    expect(shareLinkStatus({ ...base, maxViews: 3, viewCount: 2 }, now)).toBe(
      "ACTIVE"
    );
  });

  it("EXPIRED l'emporte sur VIEW_LIMIT (les deux rendent le lien GONE)", () => {
    const row = {
      revokedAt: null,
      expiresAt: new Date("2025-01-01T00:00:00Z"),
      maxViews: 1,
      viewCount: 5,
    };
    expect(shareLinkStatus(row, now)).toBe("EXPIRED");
  });
});

// ── policySummary / expiryLabel ──────────────────────────────────────────────

describe("policySummary", () => {
  it("lists what is hidden", () => {
    const summary = policySummary(PIPS_R_ONLY_PRESET);
    expect(summary).toContain("amounts");
    expect(summary).toContain("account");
    expect(summary).toContain("screenshots");
    expect(summary).not.toContain("notes");
  });

  it("shows \u201cnothing hidden\u201d when the policy is open", () => {
    expect(policySummary(NO_REDACTION)).toBe("nothing hidden");
  });
});

describe("expiryLabel", () => {
  it("formats the standard options", () => {
    expect(expiryLabel(7)).toBe("7 days");
    expect(expiryLabel(365)).toBe("1 year");
    expect(expiryLabel(3650)).toBe("10 years (max)");
  });

  it("caps expiry at 10 years", () => {
    expect(MAX_EXPIRY_DAYS).toBe(3650);
  });
});

// ── redactReportPayload ──────────────────────────────────────────────────────

const RAW_REPORT = {
  kind: "REPORT" as const,
  title: "Rapport T1",
  mode: "SNAPSHOT" as const,
  capturedAt: "2025-06-01T12:00:00.000Z",
  period: { start: "2025-01-01", end: "2025-03-31" },
  stats: {
    tradeCount: 10,
    winRate: "55",
    netPnl: "1234.56",
    avgWin: "300",
    profitFactor: "1.8",
    expectancyR: "0.35",
    balance: "15000",
  },
  equity: {
    points: [
      { time: "2025-01-05T10:00:00Z", value: 10000 },
      { time: "2025-02-05T10:00:00Z", value: 11000 },
      { time: "2025-03-05T10:00:00Z", value: 11234.56 },
    ],
    unit: "CURRENCY" as const,
  },
  byStrategy: [
    {
      key: "s1",
      name: "Breakout",
      tradeCount: 5,
      winRate: "60",
      netPnl: "800.25",
      totalR: "4.2",
      avgR: "0.84",
      profitFactor: "2.1",
    },
  ],
  bySymbol: [
    {
      key: "XAUUSD",
      name: "XAUUSD",
      tradeCount: 10,
      winRate: "55",
      netPnl: "1234.56",
      totalR: "6.1",
      avgR: "0.61",
      profitFactor: "1.8",
    },
  ],
};

describe("redactReportPayload", () => {
  it("conserve les stats en politique ouverte", () => {
    const out = redactReportPayload(RAW_REPORT, NO_REDACTION);
    expect(out.stats.netPnl).toBe("1234.56");
    expect(out.byStrategy[0].netPnl).toBe("800.25");
    expect(out.equity.unit).toBe("CURRENCY");
  });

  it("supprime structurellement les montants en mode pips & R", () => {
    const out = redactReportPayload(RAW_REPORT, PIPS_R_ONLY_PRESET);
    expect("netPnl" in out.stats).toBe(false);
    expect("avgWin" in out.stats).toBe(false);
    expect("balance" in out.stats).toBe(false);
    expect("currency" in out.stats).toBe(false);
    expect("netPnl" in out.byStrategy[0]).toBe(false);
    expect("netPnl" in out.bySymbol[0]).toBe(false);
    // Les ratios restent
    expect(out.stats.winRate).toBe("55");
    expect(out.stats.profitFactor).toBe("1.8");
    expect(out.byStrategy[0].totalR).toBe("4.2");
  });

  it("converts the curve to percentages when amounts are hidden", () => {
    const out = redactReportPayload(RAW_REPORT, PIPS_R_ONLY_PRESET);
    expect(out.equity.unit).toBe("PERCENT");
    expect(out.equity.points[0].value).toBe(0);
    // 10000 → 11234.56 ≈ +12.35 %
    expect(out.equity.points[2].value).toBeCloseTo(12.35, 1);
  });

  it("ne fuit aucun montant dans le JSON sérialisé (mode pips & R)", () => {
    const out = redactReportPayload(RAW_REPORT, PIPS_R_ONLY_PRESET);
    const leaks = findLeaks(JSON.parse(JSON.stringify(out)), [
      1234.56,
      800.25,
      15000,
      10000,
    ]);
    expect(leaks).toEqual([]);
  });
});

// ── snapshot round-trip + URL injection ──────────────────────────────────────

describe("parseStoredSnapshot / toPublicPayload", () => {
  it("fait le aller-retour JSON d'un snapshot trade et injecte le jeton brut", () => {
    const stored = {
      kind: "TRADE" as const,
      title: "XAUUSD test",
      mode: "SNAPSHOT" as const,
      capturedAt: "2025-06-01T12:00:00.000Z",
      policy: PIPS_R_ONLY_PRESET,
      trade: { symbol: "XAUUSD", pips: "42.5" },
      screenshotRefs: [{ id: "shot1", label: "ENTRY", caption: null }],
    };
    const json = JSON.stringify(stored);
    const parsed = parseStoredSnapshot(json);
    expect(parsed).not.toBeNull();
    expect(parsed?.kind).toBe("TRADE");

    const payload = toPublicPayload(parsed!, "RAWTOKEN_ABC123");
    expect(payload.kind).toBe("TRADE");
    if (payload.kind === "TRADE") {
      expect(payload.screenshots[0].url).toBe(
        "/api/public/media/RAWTOKEN_ABC123/shot1"
      );
      // Le JSON stocké ne contient PAS le jeton brut
      expect(json).not.toContain("RAWTOKEN_ABC123");
    }
  });

  it("retourne null sur un JSON corrompu ou un mauvais kind", () => {
    expect(parseStoredSnapshot(null)).toBeNull();
    expect(parseStoredSnapshot("pas du json")).toBeNull();
    expect(parseStoredSnapshot('{"kind":"OTHER"}')).toBeNull();
  });

  it("round-trip d'un snapshot rapport", () => {
    const stored = redactReportPayload(RAW_REPORT, PIPS_R_ONLY_PRESET);
    const parsed = parseStoredSnapshot(JSON.stringify(stored));
    expect(parsed?.kind).toBe("REPORT");
    const payload = toPublicPayload(parsed!, "tok");
    expect(payload.kind).toBe("REPORT");
  });
});
