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
  projectPublicTrade,
  redactReportPayload,
  parseStoredSnapshot,
  sanitizeStoredSnapshot,
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
        "/api/v1/public/media/RAWTOKEN_ABC123/shot1"
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

// ── Lot 14 Sharing: snapshot allowlist + strategy anonymization ─────────────

describe("projectPublicTrade - field allowlist", () => {
  it("drops unknown keys a future DTO field would introduce", () => {
    const trade = {
      symbol: "XAUUSD",
      direction: "LONG",
      pips: "42.5",
      netPnl: "100",
      // Fields that do not exist today - must never reach a snapshot.
      futureSecretField: "TOPSECRET-1",
      brokerLogin: "login-007",
      customFields: { accountNumber: "ACC-1" },
      internalNote: "do not share",
    };
    const out = projectPublicTrade(trade);
    expect(out.symbol).toBe("XAUUSD");
    expect(out.pips).toBe("42.5");
    expect(out).not.toHaveProperty("futureSecretField");
    expect(out).not.toHaveProperty("brokerLogin");
    expect(out).not.toHaveProperty("customFields");
    expect(out).not.toHaveProperty("internalNote");
    expect(JSON.stringify(out)).not.toContain("TOPSECRET-1");
  });

  it("projects nested review, executions and tags onto known keys", () => {
    const trade = {
      symbol: "XAUUSD",
      review: {
        id: "r1",
        planAdherenceScore: 4,
        mainLesson: "Wait",
        futureReviewField: "leak-me",
      },
      executions: [
        { id: "e1", type: "ENTRY", time: "2025-01-15T08:00:00Z", price: "2650", lots: "0.5", commission: "1", pnl: null, futureExecField: "x" },
      ],
      tags: [
        { id: "t1", name: "Breakout", color: "#fff", kind: "SETUP", isPreset: false, futureTagField: "y" },
      ],
      checklistStatus: { requiredTotal: 2, requiredChecked: 1, missing: ["A"], complete: false, future: 1 },
    };
    const out = projectPublicTrade(trade);
    const review = out.review as Record<string, unknown>;
    expect(review.mainLesson).toBe("Wait");
    expect(review).not.toHaveProperty("futureReviewField");
    const executions = out.executions as Record<string, unknown>[];
    expect(executions[0]).not.toHaveProperty("futureExecField");
    expect(executions[0].price).toBe("2650");
    const tags = out.tags as Record<string, unknown>[];
    expect(tags[0].name).toBe("Breakout");
    expect(tags[0]).not.toHaveProperty("futureTagField");
    const status = out.checklistStatus as Record<string, unknown>;
    expect(status.missing).toEqual(["A"]);
    expect(status).not.toHaveProperty("future");
  });

  it("is idempotent", () => {
    const trade = { symbol: "XAUUSD", unknownKey: "x", review: { id: "r", future: 1 } };
    expect(projectPublicTrade(projectPublicTrade(trade))).toEqual(
      projectPublicTrade(trade)
    );
  });
});

describe("redactReportPayload - hideStrategyName", () => {
  const hideStrategy = { ...NO_REDACTION, hideStrategyName: true };

  it("anonymizes strategy names and ids in byStrategy rows", () => {
    const out = redactReportPayload(RAW_REPORT, hideStrategy);
    expect(out.byStrategy[0].name).toBe("Strategy 1");
    expect(out.byStrategy[0].key).toBe("strategy-1");
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain("Breakout");
    expect(serialized).not.toContain("s1");
    // Symbols are not strategy names - they stay.
    expect(out.bySymbol[0].name).toBe("XAUUSD");
    expect(out.bySymbol[0].key).toBe("XAUUSD");
  });

  it("keeps real strategy names when the policy does not hide them", () => {
    const out = redactReportPayload(RAW_REPORT, NO_REDACTION);
    expect(out.byStrategy[0].name).toBe("Breakout");
    expect(out.byStrategy[0].key).toBe("s1");
  });

  it("drops unknown stat keys a future engine field would introduce", () => {
    const raw = {
      ...RAW_REPORT,
      stats: { ...RAW_REPORT.stats, futureStat: "TOPSECRET-2", accountName: "Hidden" },
    };
    const out = redactReportPayload(raw, NO_REDACTION);
    expect(out.stats).not.toHaveProperty("futureStat");
    expect(out.stats).not.toHaveProperty("accountName");
    expect(JSON.stringify(out)).not.toContain("TOPSECRET-2");
    expect(out.stats.tradeCount).toBe(10);
  });
});

describe("sanitizeStoredSnapshot - old snapshots served under new rules", () => {
  it("strips captions, strategy names and unknown keys from a pre-Lot-14 snapshot", () => {
    const old = {
      kind: "TRADE" as const,
      title: "Old link",
      mode: "SNAPSHOT" as const,
      capturedAt: "2025-06-01T12:00:00.000Z",
      policy: { ...NO_REDACTION, hideNotes: true },
      trade: {
        symbol: "XAUUSD",
        notes: "should have been hidden",
        futureSecretField: "TOPSECRET-3",
        customFields: { login: "x" },
      },
      screenshotRefs: [{ id: "s1", label: "ENTRY", caption: "caption secrete-77" }],
    };
    const clean = sanitizeStoredSnapshot(old as never);
    expect(clean.kind).toBe("TRADE");
    if (clean.kind === "TRADE") {
      expect(clean.trade).not.toHaveProperty("futureSecretField");
      expect(clean.trade).not.toHaveProperty("customFields");
      expect(clean.screenshotRefs[0].caption).toBeNull();
      expect(clean.screenshotRefs[0].label).toBe("ENTRY");
      expect(JSON.stringify(clean)).not.toContain("caption secrete-77");
      expect(JSON.stringify(clean)).not.toContain("TOPSECRET-3");
    }
  });

  it("anonymizes strategy rows of a stored report snapshot", () => {
    const stored = redactReportPayload(RAW_REPORT, NO_REDACTION);
    const withNames = { ...stored, policy: { ...NO_REDACTION, hideStrategyName: true } };
    const clean = sanitizeStoredSnapshot(withNames as never);
    expect(clean.kind).toBe("REPORT");
    if (clean.kind === "REPORT") {
      expect(clean.byStrategy[0].name).toBe("Strategy 1");
      expect(JSON.stringify(clean)).not.toContain("Breakout");
    }
  });

  it("re-applies current redaction rules to a stored trade snapshot", () => {
    const old = {
      kind: "TRADE" as const,
      title: "Old link",
      mode: "SNAPSHOT" as const,
      capturedAt: "2025-06-01T12:00:00.000Z",
      policy: { ...NO_REDACTION, hideNotes: true },
      trade: {
        symbol: "XAUUSD",
        notes: "old note that should have been hidden",
        review: {
          id: "r1",
          planAdherenceScore: 4,
          customAnswers: [
            { questionId: "q1", question: "Q?", type: "TEXT", answer: "old answer secrete-55" },
          ],
        },
      },
      screenshotRefs: [],
    };
    const clean = sanitizeStoredSnapshot(old as never);
    expect(clean.kind).toBe("TRADE");
    if (clean.kind === "TRADE") {
      expect(clean.trade).not.toHaveProperty("notes");
      const review = clean.trade.review as Record<string, unknown>;
      expect(review).not.toHaveProperty("customAnswers");
      expect(JSON.stringify(clean)).not.toContain("old answer secrete-55");
    }
  });

  it("leaves a current snapshot unchanged", () => {
    const current = redactReportPayload(RAW_REPORT, PIPS_R_ONLY_PRESET);
    expect(sanitizeStoredSnapshot(current as never)).toEqual(current);
  });
});
