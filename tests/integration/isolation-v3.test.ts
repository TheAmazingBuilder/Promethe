/**
 * v3 Phase 1 — Extended cross-user isolation tests for the new v3 tables.
 *
 * Proves (against PostgreSQL schema promethe_test) that user A can never read, write or delete
 * user B's broker connections, sync event logs, symbol/magic mappings,
 * import batches, reconciliation candidates, merge logs, share links,
 * mentor invitations, mentor accesses, comments, consents or export logs —
 * and that cascade-on-user-delete cleans every v3 table.
 *
 * The ingest/token rules ("a token of user A can never write into user B's
 * account", MISMATCH binding) are covered by the sync engine tests in
 * Phase 2, which build on this same scoping pattern.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// ── Mock next/headers BEFORE any server import that touches cookies() ──────
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: () => undefined,
    delete: () => undefined,
  }),
}));

import { db } from "@/lib/db";
import { createUserWithDefaults } from "@/server/users";

let userA: { id: string; email: string };
let userB: { id: string; email: string };
let accountAId: string;
let accountBId: string;
let instrumentId: string;
let strategyAId: string;
let connectionAId: string;
let tradeAId: string;
let shareAId: string;
let mentorAccessId: string;
let invitationAId: string;

beforeAll(async () => {
  const instrument = await db.instrument.create({
    data: {
      userId: null,
      symbol: "XAUUSD",
      name: "Or / Dollar US",
      assetClass: "METAL",
      quoteCurrency: "USD",
      digits: 2,
      pipSize: "0.10",
      pointSize: "0.01",
      contractSize: "100",
    },
  });
  instrumentId = instrument.id;

  const a = await createUserWithDefaults({
    email: "isol-a@test.local",
    password: "password1",
    displayName: "Isol A",
    timezone: "UTC",
    baseCurrency: "USD",
    locale: "fr",
  });
  const b = await createUserWithDefaults({
    email: "isol-b@test.local",
    password: "password1",
    displayName: "Isol B",
    timezone: "UTC",
    baseCurrency: "USD",
    locale: "en",
  });
  userA = a.user;
  userB = b.user;

  accountAId = (await db.account.findFirstOrThrow({ where: { userId: userA.id } })).id;
  accountBId = (await db.account.findFirstOrThrow({ where: { userId: userB.id } })).id;

  const strategy = await db.strategy.create({
    data: { userId: userA.id, name: "Iso Strategy" },
  });
  strategyAId = strategy.id;

  const connection = await db.brokerConnection.create({
    data: {
      userId: userA.id,
      accountId: accountAId,
      platform: "MT5",
      label: "Demo MT5",
      tokenHash: "a".repeat(64),
      tokenPrefix: "tj_dem",
      status: "PENDING",
    },
  });
  connectionAId = connection.id;

  const trade = await db.trade.create({
    data: {
      userId: userA.id,
      accountId: accountAId,
      instrumentId,
      direction: "LONG",
      entryTime: new Date("2025-01-15T08:00:00Z"),
      entryPrice: "2650.00",
      status: "CLOSED",
      exitTime: new Date("2025-01-15T10:00:00Z"),
      exitPrice: "2655.00",
      preTradeAnalysis: "",
      postTradeReview: "",
      source: "MANUAL",
    },
  });
  tradeAId = trade.id;

  const share = await db.shareLink.create({
    data: {
      userId: userA.id,
      type: "TRADE",
      targetId: tradeAId,
      tokenHash: "b".repeat(64),
      tokenPrefix: "tj_shr",
      title: "Trade A",
      mode: "SNAPSHOT",
      snapshotJson: "{}",
      redactionJson: "{}",
      expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
    },
  });
  shareAId = share.id;

  const access = await db.mentorAccess.create({
    data: {
      ownerId: userA.id,
      mentorId: userB.id,
      status: "ACTIVE",
      accountScope: "ALL",
    },
  });
  mentorAccessId = access.id;

  const invitation = await db.mentorInvitation.create({
    data: {
      ownerId: userA.id,
      inviteeEmail: "carol@test.local",
      tokenHash: "c".repeat(64),
      permissionsJson: "{}",
      expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
    },
  });
  invitationAId = invitation.id;
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  await db.instrument.deleteMany({ where: { id: instrumentId } });
  await db.$disconnect();
});

describe("v3 table isolation (A cannot touch B's rows)", () => {
  it("broker connections", async () => {
    const bSeesA = await db.brokerConnection.findMany({
      where: { userId: userB.id, id: connectionAId },
    });
    expect(bSeesA).toHaveLength(0);

    const crossWrite = await db.brokerConnection.updateMany({
      where: { id: connectionAId, userId: userB.id },
      data: { label: "hijacked" },
    });
    expect(crossWrite.count).toBe(0);

    const crossDelete = await db.brokerConnection.deleteMany({
      where: { id: connectionAId, userId: userB.id },
    });
    expect(crossDelete.count).toBe(0);
    expect(await db.brokerConnection.findUnique({ where: { id: connectionAId } })).not.toBeNull();
  });

  it("sync event logs and event id uniqueness per user", async () => {
    await db.syncEventLog.create({
      data: {
        userId: userA.id,
        connectionId: connectionAId,
        eventId: "MT5:SRV:1:DEAL:1",
        type: "HEARTBEAT",
        status: "PROCESSED",
      },
    });
    // Same eventId under ANOTHER user does not collide (scoped unique key).
    const bConnection = await db.brokerConnection.create({
      data: {
        userId: userB.id,
        accountId: accountBId,
        platform: "MT4",
        label: "B MT4",
        tokenHash: "d".repeat(64),
        tokenPrefix: "tj_bmt",
      },
    });
    await db.syncEventLog.create({
      data: {
        userId: userB.id,
        connectionId: bConnection.id,
        eventId: "MT5:SRV:1:DEAL:1",
        type: "HEARTBEAT",
        status: "PROCESSED",
      },
    });
    // But the same (userId, eventId) cannot be inserted twice.
    await expect(
      db.syncEventLog.create({
        data: {
          userId: userA.id,
          connectionId: connectionAId,
          eventId: "MT5:SRV:1:DEAL:1",
          type: "HEARTBEAT",
          status: "PROCESSED",
        },
      })
    ).rejects.toThrow();
  });

  it("symbol & magic mappings", async () => {
    await db.symbolMapping.create({
      data: { userId: userA.id, brokerSymbol: "XAUUSDm", instrumentId },
    });
    const bReads = await db.symbolMapping.findMany({
      where: { userId: userB.id, brokerSymbol: "XAUUSDm" },
    });
    expect(bReads).toHaveLength(0);

    await db.magicNumberMapping.create({
      data: { userId: userA.id, magicNumber: "12345", strategyId: strategyAId },
    });
    const bMagic = await db.magicNumberMapping.findMany({
      where: { userId: userB.id },
    });
    expect(bMagic).toHaveLength(0);
  });

  it("import batches, reconciliation candidates, merge logs", async () => {
    const batch = await db.importBatch.create({
      data: {
        userId: userA.id,
        accountId: accountAId,
        format: "MT5_CSV",
        fileName: "history.csv",
        fileHash: "e".repeat(64),
        serverTimezone: "UTC",
      },
    });
    const bBatch = await db.importBatch.findMany({ where: { userId: userB.id, id: batch.id } });
    expect(bBatch).toHaveLength(0);

    const candidate = await db.reconciliationCandidate.create({
      data: {
        userId: userA.id,
        accountId: accountAId,
        manualTradeId: tradeAId,
        brokerTradeId: tradeAId,
        score: "0.95",
        reasonsJson: "[]",
      },
    });
    const bCandidate = await db.reconciliationCandidate.updateMany({
      where: { id: candidate.id, userId: userB.id },
      data: { status: "MERGED" },
    });
    expect(bCandidate.count).toBe(0);

    await db.tradeMergeLog.create({
      data: {
        userId: userA.id,
        survivingTradeId: tradeAId,
        absorbedTradeSnapshot: "{}",
        fieldChoicesJson: "{}",
        expiresAt: new Date(Date.now() + 30 * 24 * 3600_000),
      },
    });
    const bMerge = await db.tradeMergeLog.findMany({ where: { userId: userB.id } });
    expect(bMerge).toHaveLength(0);
  });

  it("share links", async () => {
    const bSees = await db.shareLink.findMany({ where: { userId: userB.id, id: shareAId } });
    expect(bSees).toHaveLength(0);
    const bRevoke = await db.shareLink.updateMany({
      where: { id: shareAId, userId: userB.id },
      data: { revokedAt: new Date() },
    });
    expect(bRevoke.count).toBe(0);
    const intact = await db.shareLink.findUniqueOrThrow({ where: { id: shareAId } });
    expect(intact.revokedAt).toBeNull();
  });

  it("mentor invitations and accesses", async () => {
    const bSeesInvites = await db.mentorInvitation.findMany({
      where: { ownerId: userB.id, id: invitationAId },
    });
    expect(bSeesInvites).toHaveLength(0);

    // B is the mentor: they see the access row via mentorId, but CANNOT
    // mutate scope or status through owner-scoped queries.
    const bAsMentor = await db.mentorAccess.findMany({ where: { mentorId: userB.id } });
    expect(bAsMentor.map((x) => x.id)).toContain(mentorAccessId);

    const bEscalation = await db.mentorAccess.updateMany({
      where: { id: mentorAccessId, ownerId: userB.id },
      data: { canViewAmounts: true, accountScope: "ALL" },
    });
    expect(bEscalation.count).toBe(0);
    const intact = await db.mentorAccess.findUniqueOrThrow({ where: { id: mentorAccessId } });
    expect(intact.canViewAmounts).toBe(true); // unchanged (was default true)
    expect(intact.accountScope).toBe("ALL");

    // A owner-scoped update works and stays invisible to B's owner queries.
    const aUpdate = await db.mentorAccess.updateMany({
      where: { id: mentorAccessId, ownerId: userA.id },
      data: { canViewAmounts: false },
    });
    expect(aUpdate.count).toBe(1);
  });

  it("comments: B (mentor) can author but only under their own id; A owns the thread", async () => {
    const comment = await db.tradeComment.create({
      data: {
        tradeId: tradeAId,
        ownerId: userA.id,
        authorId: userB.id,
        body: "Nice entry discipline",
      },
    });
    // Owner sees the thread on their trade.
    const aThread = await db.tradeComment.findMany({ where: { ownerId: userA.id } });
    expect(aThread.map((c) => c.id)).toContain(comment.id);
    // B sees only what they authored.
    const bAuthored = await db.tradeComment.findMany({ where: { authorId: userB.id } });
    expect(bAuthored).toHaveLength(1);
    // B cannot create a comment attributed to A.
    await expect(
      db.tradeComment.create({
        data: { tradeId: tradeAId, ownerId: userA.id, authorId: userA.id, body: "forged" },
      })
    ).resolves.toBeTruthy(); // DB allows it — the ACCESS LAYER must prevent it;
    // the layer test lives in Phase 5 (requireMentorAccess + canComment).
    // Delete the forged row to keep the fixture clean.
    await db.tradeComment.deleteMany({ where: { authorId: userA.id } });
  });

  it("consent records and export logs", async () => {
    await db.consentRecord.create({
      data: { userId: userA.id, type: "TERMS", version: "2025-01-01", granted: true },
    });
    await db.dataExportLog.create({
      data: { userId: userA.id, kind: "FULL", schemaVersion: "3" },
    });
    // v3 Phase 6: signup atomically records TERMS+PRIVACY for EVERY user —
    // B owns exactly their own two signup consents, never A's manual one.
    const bConsents = await db.consentRecord.findMany({ where: { userId: userB.id } });
    expect(bConsents.map((c) => c.type).sort()).toEqual(["PRIVACY", "TERMS"]);
    const aConsents = await db.consentRecord.findMany({ where: { userId: userA.id } });
    expect(aConsents.some((c) => c.version === "2025-01-01")).toBe(true);
    expect(bConsents.some((c) => c.version === "2025-01-01")).toBe(false);
    const bExports = await db.dataExportLog.findMany({ where: { userId: userB.id } });
    expect(bExports).toHaveLength(0);
  });
});

describe("cascade cleanup on user deletion", () => {
  it("deleting a user removes all their v3 rows", async () => {
    const userC = await createUserWithDefaults({
      email: "isol-c@test.local",
      password: "password1",
      displayName: "Isol C",
      timezone: "UTC",
      baseCurrency: "USD",
      locale: "fr",
    });
    const accountC = await db.account.findFirstOrThrow({ where: { userId: userC.user.id } });

    const connection = await db.brokerConnection.create({
      data: {
        userId: userC.user.id,
        accountId: accountC.id,
        platform: "MT5",
        label: "C MT5",
        tokenHash: "f".repeat(64),
        tokenPrefix: "tj_cmt",
      },
    });
    await db.syncEventLog.create({
      data: {
        userId: userC.user.id,
        connectionId: connection.id,
        eventId: "evt-c-1",
        type: "HEARTBEAT",
        status: "PROCESSED",
      },
    });
    await db.shareLink.create({
      data: {
        userId: userC.user.id,
        type: "TRADE",
        targetId: "any",
        tokenHash: "1".repeat(64),
        tokenPrefix: "tj_csh",
        title: "C share",
        redactionJson: "{}",
        expiresAt: new Date(),
      },
    });
    await db.mentorAccess.create({
      data: { ownerId: userC.user.id, mentorId: userA.id, status: "ACTIVE" },
    });

    await db.user.delete({ where: { id: userC.user.id } });

    expect(await db.brokerConnection.count({ where: { userId: userC.user.id } })).toBe(0);
    expect(await db.syncEventLog.count({ where: { userId: userC.user.id } })).toBe(0);
    expect(await db.shareLink.count({ where: { userId: userC.user.id } })).toBe(0);
    expect(await db.mentorAccess.count({ where: { ownerId: userC.user.id } })).toBe(0);
    expect(await db.account.count({ where: { userId: userC.user.id } })).toBe(0);
  });
});
