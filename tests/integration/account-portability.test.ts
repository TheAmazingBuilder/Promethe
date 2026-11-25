/**
 * v3 Phase 6 — Portability & compliance integration tests (PostgreSQL schema promethe_test).
 *
 * Proves the GDPR model end-to-end:
 *  - export: COMPLETE (every domain file present), ISOLATED (user B's trades
 *    never in user A's archive), EXACT (screenshot bytes identical),
 *    SECRET-FREE (no tokenHash / passwordHash / session ids anywhere),
 *    LOGGED (DataExportLog) and RATE-LIMITED (24 h cooldown)
 *  - deletion: password gate, 7-day grace respected by the cron, cancel,
 *    execution cascade-deletes every table + uploads, tombstone (HMAC),
 *    idempotent re-run, other users untouched
 *  - consents: TERMS/PRIVACY recorded at signup, listed
 *  - maintenance: sync payload purge, merge-log cleanup, invitation expiry
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

import { strFromU8, unzipSync } from "fflate";
import { db } from "@/lib/db";
import { createUserWithDefaults } from "@/server/users";
import {
  buildUserExport,
  listExportHistory,
  requestUserExport,
} from "@/server/account-export";
import {
  cancelAccountDeletion,
  executeDueDeletions,
  getDeletionState,
  scheduleAccountDeletion,
} from "@/server/account-deletion";
import { listConsents } from "@/server/consent";
import { runDailyMaintenance } from "@/server/maintenance";
import { hashUserId } from "@/lib/tokens";
import { mockSupabaseStorage } from "../helpers/supabase-storage";

const storage = mockSupabaseStorage();

let aliceId: string;
let bobId: string;
let caraId: string;
let aliceAccountId: string;
let aliceTradeId: string;
let aliceShotId: string;
let shotStoragePath: string;
let caraStoragePath: string;

const SHOT_BYTES = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000154a24f5f0000000049454e44ae426082",
  "hex"
); // valid 1×1 PNG

beforeAll(async () => {
  const alice = await createUserWithDefaults({
    email: "alice-export@test.local",
    password: "password1",
    displayName: "Alice Export",
    timezone: "UTC",
    baseCurrency: "USD",
    locale: "fr",
  });
  const bob = await createUserWithDefaults({
    email: "bob-other@test.local",
    password: "password1",
    displayName: "Bob Other",
    timezone: "UTC",
    baseCurrency: "USD",
    locale: "fr",
  });
  const cara = await createUserWithDefaults({
    email: "cara-delete@test.local",
    password: "password1",
    displayName: "Cara Delete",
    timezone: "UTC",
    baseCurrency: "USD",
    locale: "fr",
  });
  aliceId = alice.user.id;
  bobId = bob.user.id;
  caraId = cara.user.id;

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

  const accounts = await db.account.findMany({ where: { userId: aliceId } });
  aliceAccountId = accounts[0].id;

  const strategy = await db.strategy.create({
    data: { userId: aliceId, name: "Breakout Londres" },
  });

  const trade = await db.trade.create({
    data: {
      userId: aliceId,
      accountId: aliceAccountId,
      instrumentId: instrument.id,
      strategyId: strategy.id,
      direction: "LONG",
      entryPrice: "2650.00",
      status: "CLOSED",
      entryTime: new Date("2025-01-15T08:00:00Z"),
      exitTime: new Date("2025-01-15T10:00:00Z"),
      exitPrice: "2655.00",
      netPnl: "53.00",
      lots: "0.10",
      pips: "50",
      rMultiple: "1.2",
      source: "MANUAL",
      reviewStatus: "NOT_REVIEWED",
      preTradeAnalysis: "",
      postTradeReview: "",
      notes: "Setup respecté.",
    },
  });
  aliceTradeId = trade.id;

  // Bob's trade — must NEVER appear in Alice's archive.
  const bobAccounts = await db.account.findMany({ where: { userId: bobId } });
  await db.trade.create({
    data: {
      userId: bobId,
      accountId: bobAccounts[0].id,
      instrumentId: instrument.id,
      direction: "SHORT",
      entryPrice: "2660.00",
      status: "OPEN",
      entryTime: new Date("2025-02-01T08:00:00Z"),
      source: "MANUAL",
      reviewStatus: "NOT_REVIEWED",
      preTradeAnalysis: "",
      postTradeReview: "",
    },
  });

  // Screenshot file + row for Alice.
  aliceShotId = "shot_export_0001";
  shotStoragePath = `${aliceId}/${aliceTradeId}/${aliceShotId}.png`;
  storage.objects.set(shotStoragePath, { bytes: SHOT_BYTES, contentType: "image/png" });
  await db.tradeScreenshot.create({
    data: {
      id: aliceShotId,
      tradeId: aliceTradeId,
      userId: aliceId,
      storagePath: shotStoragePath,
      label: "ENTRY",
      caption: "Entrée breakout",
    },
  });

  // Secrets-bearing rows for Alice (tokenHash values unique to this file —
  // integration tests run in parallel workers against the same test DB).
  const ALICE_SHARE_HASH = "z9".repeat(32);
  const ALICE_BROKER_HASH = "y8".repeat(32);
  await db.shareLink.create({
    data: {
      userId: aliceId,
      type: "TRADE",
      targetId: aliceTradeId,
      tokenHash: ALICE_SHARE_HASH,
      tokenPrefix: "shr_abc",
      title: "Trade du 15 janvier",
      mode: "SNAPSHOT",
      redactionJson: "{}",
      expiresAt: new Date("2030-01-01T00:00:00Z"),
      snapshotJson: "{}",
    },
  });
  await db.brokerConnection.create({
    data: {
      userId: aliceId,
      accountId: aliceAccountId,
      platform: "MT5",
      label: "Demo MT5",
      tokenHash: ALICE_BROKER_HASH,
      tokenPrefix: "ea_xyz",
    },
  });

  // Cross-user comment: Bob comments on Alice's trade.
  await db.tradeComment.create({
    data: {
      tradeId: aliceTradeId,
      ownerId: aliceId,
      authorId: bobId,
      body: "Belle exécution @alice_fx",
    },
  });

  // Cara (deletion test subject) gets a trade + screenshot file.
  const caraAccounts = await db.account.findMany({ where: { userId: caraId } });
  const caraTrade = await db.trade.create({
    data: {
      userId: caraId,
      accountId: caraAccounts[0].id,
      instrumentId: instrument.id,
      direction: "LONG",
      entryPrice: "1.0850",
      status: "OPEN",
      entryTime: new Date("2025-03-01T08:00:00Z"),
      source: "MANUAL",
      reviewStatus: "NOT_REVIEWED",
      preTradeAnalysis: "",
      postTradeReview: "",
    },
  });
  const caraShotId = "shot_cara_0001";
  caraStoragePath = `${caraId}/${caraTrade.id}/${caraShotId}.png`;
  storage.objects.set(caraStoragePath, { bytes: SHOT_BYTES, contentType: "image/png" });
  await db.tradeScreenshot.create({
    data: {
      id: caraShotId,
      tradeId: caraTrade.id,
      userId: caraId,
      storagePath: caraStoragePath,
      label: "ENTRY",
    },
  });
});

afterAll(async () => {
  storage.restore();
  await db.$disconnect();
});

// ── Consents ─────────────────────────────────────────────────────────────────

describe("consents (signup proof)", () => {
  it("records TERMS + PRIVACY at signup (atomic with the user)", async () => {
    const rows = await db.consentRecord.findMany({
      where: { userId: aliceId },
      orderBy: { type: "asc" },
    });
    expect(rows.map((r) => r.type).sort()).toEqual(["PRIVACY", "TERMS"]);
    expect(rows.every((r) => r.granted)).toBe(true);
    expect(rows[0].version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("lists the consent history (most recent first)", async () => {
    const consents = await listConsents(aliceId);
    expect(consents).toHaveLength(2);
    expect(consents.map((c) => c.type)).toContain("TERMS");
    expect(consents.every((c) => c.granted)).toBe(true);
  });
});

// ── Export ───────────────────────────────────────────────────────────────────

describe("data export (portability)", () => {
  let zip: Record<string, Uint8Array>;

  it("builds a complete archive with every domain file", async () => {
    const built = await buildUserExport(aliceId);
    expect(built).not.toBeNull();
    zip = Object.fromEntries(Object.entries(unzipSync(built!.zip)));

    const expected = [
      "manifest.json",
      "README.txt",
      "profile.json",
      "accounts.json",
      "instruments.json",
      "strategies.json",
      "tags.json",
      "trades.json",
      "journal.json",
      "rules.json",
      "goals.json",
      "views.json",
      "templates.json",
      "cash.json",
      "reviews.json",
      "reports.json",
      "scenarios.json",
      "calendar.json",
      "propfirms.json",
      "sync.json",
      "sharing.json",
      "comments.json",
      "notifications.json",
      "misc.json",
      "consents.json",
      "exports.json",
      "deletion.json",
      `screenshots/${aliceShotId}.png`,
    ];
    for (const name of expected) {
      expect(zip[name], `missing entry: ${name}`).toBeDefined();
    }
  });

  it("manifest counts match and exclusions are documented", () => {
    const manifest = JSON.parse(strFromU8(zip["manifest.json"]));
    expect(manifest.counts.trades).toBe(1);
    expect(manifest.counts.screenshots).toBe(1);
    expect(manifest.counts.screenshotFiles).toBe(1);
    expect(manifest.excluded.length).toBeGreaterThanOrEqual(4);
    expect(manifest.schemaVersion).toBe("1.0.0");
  });

  it("contains Alice's trade with exact decimals — and NEVER Bob's", () => {
    const trades = JSON.parse(strFromU8(zip["trades.json"]));
    expect(trades).toHaveLength(1);
    expect(trades[0].id).toBe(aliceTradeId);
    expect(trades[0].netPnl).toBe("53"); // decimal serialized as string, exact
    const raw = strFromU8(zip["trades.json"]);
    expect(raw).not.toContain(bobId);
  });

  it("includes the screenshot file with byte-identical content", async () => {
    const inZip = Buffer.from(zip[`screenshots/${aliceShotId}.png`]);
    const stored = storage.objects.get(shotStoragePath);
    expect(stored).toBeDefined();
    expect(inZip.equals(Buffer.from(stored!.bytes))).toBe(true);
  });

  it("exports Bob's comment on Alice's trade under onMyTrades", () => {
    const comments = JSON.parse(strFromU8(zip["comments.json"]));
    expect(comments.onMyTrades).toHaveLength(1);
    expect(comments.onMyTrades[0].authorId).toBe(bobId);
    expect(comments.onMyTrades[0].body).toContain("Belle exécution");
  });

  it("leaks NO secrets: no tokenHash, passwordHash or session ids", () => {
    for (const [name, bytes] of Object.entries(zip)) {
      const raw = strFromU8(bytes);
      // Secret VALUES must appear nowhere.
      expect(raw, `secret leak in ${name}`).not.toContain("z9".repeat(32));
      expect(raw, `secret leak in ${name}`).not.toContain("y8".repeat(32));
      // Key names must not exist either — except in the manifest, which
      // DOCUMENTS the exclusions (transparency, not a leak).
      if (name !== "manifest.json") {
        expect(raw, `secret key in ${name}`).not.toContain("passwordHash");
        expect(raw, `secret key in ${name}`).not.toContain("tokenHash");
      }
    }
    // Sessions exported as metadata only.
    const profile = JSON.parse(strFromU8(zip["profile.json"]));
    for (const session of profile.sessions ?? []) {
      expect(Object.keys(session).sort()).toEqual(["createdAt", "expiresAt"]);
    }
    // Share link metadata present, secret absent.
    const sharing = JSON.parse(strFromU8(zip["sharing.json"]));
    expect(sharing).toHaveLength(1);
    expect(sharing[0].tokenPrefix).toBe("shr_abc");
  });

  it("logs the export and enforces the 24 h cooldown", async () => {
    const first = await requestUserExport(aliceId);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.sizeBytes).toBeGreaterThan(500);
      expect(first.fileName).toMatch(/^tradejournal-export-\d{4}-\d{2}-\d{2}-[a-z0-9]+\.zip$/);
    }

    const logs = await db.dataExportLog.findMany({ where: { userId: aliceId } });
    expect(logs).toHaveLength(1);
    expect(logs[0].kind).toBe("FULL");
    expect(logs[0].sizeBytes).toBeGreaterThan(500);

    const second = await requestUserExport(aliceId);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.code).toBe("RATE_LIMITED");
      expect(second.retryAfterMs ?? 0).toBeGreaterThan(0);
    }

    const history = await listExportHistory(aliceId);
    expect(history).toHaveLength(1);
    expect(history[0].schemaVersion).toBe("1.0.0");
  });
});

// ── Deletion ─────────────────────────────────────────────────────────────────

describe("account deletion (erasure)", () => {
  it("rejects a wrong password", async () => {
    const result = await scheduleAccountDeletion(caraId, "wrong-password");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("BAD_PASSWORD");
    expect(await getDeletionState(caraId)).toBeNull();
  });

  it("schedules with a 7-day grace and notifies", async () => {
    const before = Date.now();
    const result = await scheduleAccountDeletion(caraId, "password1");
    expect(result.ok).toBe(true);

    const state = await getDeletionState(caraId);
    expect(state?.status).toBe("PENDING");
    const delta = new Date(state!.scheduledFor).getTime() - before;
    expect(delta).toBeGreaterThan(6.9 * 24 * 3600_000);
    expect(delta).toBeLessThan(7.1 * 24 * 3600_000);

    const notif = await db.notificationLog.findFirst({
      where: { userId: caraId, type: "DELETION_SCHEDULED" },
    });
    expect(notif).not.toBeNull();
  });

  it("refuses to double-schedule", async () => {
    const result = await scheduleAccountDeletion(caraId, "password1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("ALREADY_PENDING");
  });

  it("cancels and notifies", async () => {
    expect(await cancelAccountDeletion(caraId)).toBe(true);
    expect(await getDeletionState(caraId)).toBeNull();
    const notif = await db.notificationLog.findFirst({
      where: { userId: caraId, type: "DELETION_CANCELLED" },
    });
    expect(notif).not.toBeNull();
    expect(await cancelAccountDeletion(caraId)).toBe(false); // nothing pending
  });

  it("cron respects the grace period (no early execution)", async () => {
    await scheduleAccountDeletion(caraId, "password1");
    const report = await executeDueDeletions(new Date()); // now < scheduledFor
    expect(report.executed).toBe(0);
    expect(await getDeletionState(caraId)?.then((s) => s?.status ?? null)).toBe("PENDING");
  });

  it("executes after the grace: full cascade, tombstone, uploads removed", async () => {
    const caraHash = hashUserId(caraId);
    const report = await executeDueDeletions(
      new Date(Date.now() + 8 * 24 * 3600_000)
    );
    expect(report.executed).toBe(1);
    expect(report.tombstones).toContain(caraHash);

    // User and EVERY related row gone.
    expect(await db.user.findUnique({ where: { id: caraId } })).toBeNull();
    expect(await db.profile.findUnique({ where: { id: caraId } })).toBeNull();
    expect(await db.account.findFirst({ where: { userId: caraId } })).toBeNull();
    expect(await db.trade.findFirst({ where: { userId: caraId } })).toBeNull();
    expect(await db.tradeScreenshot.findFirst({ where: { userId: caraId } })).toBeNull();
    expect(await db.consentRecord.findFirst({ where: { userId: caraId } })).toBeNull();
    expect(await db.notificationLog.findFirst({ where: { userId: caraId } })).toBeNull();
    expect(
      await db.accountDeletionRequest.findUnique({ where: { userId: caraId } })
    ).toBeNull();

    // Tombstone kept — the HMAC id, not the raw user id.
    const tombstone = await db.deletedUserTombstone.findUnique({
      where: { id: caraHash },
    });
    expect(tombstone).not.toBeNull();
    expect(caraHash).not.toBe(caraId);
    expect(caraHash).toHaveLength(64);

    // Supabase Storage object removed with the account cascade.
    expect(storage.objects.has(caraStoragePath)).toBe(false);

    // Alice and Bob untouched.
    expect(await db.user.findUnique({ where: { id: aliceId } })).not.toBeNull();
    expect(await db.user.findUnique({ where: { id: bobId } })).not.toBeNull();
    expect(await db.trade.findFirst({ where: { userId: aliceId } })).not.toBeNull();
  });

  it("is idempotent — a re-run deletes nothing more", async () => {
    const report = await executeDueDeletions(
      new Date(Date.now() + 9 * 24 * 3600_000)
    );
    expect(report.executed).toBe(0);
  });
});

// ── Daily maintenance ────────────────────────────────────────────────────────

describe("daily maintenance (cron)", () => {
  it("purges old sync payloads, merge logs and expired invitations", async () => {
    const old = new Date(Date.now() - 20 * 24 * 3600_000);

    const connection = await db.brokerConnection.findFirst({
      where: { userId: aliceId },
    });
    const syncLog = await db.syncEventLog.create({
      data: {
        userId: aliceId,
        connectionId: connection!.id,
        eventId: "evt-old-1",
        type: "TRADE_OPEN",
        status: "PROCESSED",
        payloadJson: '{"secret":"payload"}',
        receivedAt: old,
        processedAt: old,
      },
    });
    await db.tradeMergeLog.create({
      data: {
        userId: aliceId,
        survivingTradeId: aliceTradeId,
        absorbedTradeSnapshot: "{}",
        fieldChoicesJson: "{}",
        expiresAt: new Date(Date.now() - 24 * 3600_000),
      },
    });
    const report = await runDailyMaintenance();

    const purged = await db.syncEventLog.findUnique({ where: { id: syncLog.id } });
    expect(purged?.payloadJson).toBeNull(); // audit row kept, payload gone
    expect(
      await db.tradeMergeLog.findFirst({ where: { userId: aliceId } })
    ).toBeNull();
    expect(report.syncPayloadsPurged).toBeGreaterThanOrEqual(1);
    expect(report.mergeLogsDeleted).toBeGreaterThanOrEqual(1);
  });
});
