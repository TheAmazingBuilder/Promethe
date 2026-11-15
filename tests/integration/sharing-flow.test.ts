/**
 * v3 Phase 4 — Integration tests for the share-link flow (db/test.db).
 *
 * Proves against a real database:
 *  - TRADE + REPORT link creation (ownership enforced — no IDOR)
 *  - public resolution serves the redacted payload with NO leaks
 *    (findLeaks over the serialized public payload)
 *  - view counting, maxViews, expiry, revocation → generic GONE
 *  - LIVE links reflect trade updates and die with the trade
 *  - SNAPSHOT links stay frozen
 *  - list/revoke are owner-scoped (cross-user isolation)
 *  - the public media proxy respects the policy and the link status
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
import {
  createShareLink,
  listShareLinks,
  revokeShareLink,
  resolveShareLink,
  readPublicScreenshot,
} from "@/server/sharing";
import { findLeaks, PIPS_R_ONLY_PRESET, NO_REDACTION } from "@/lib/redaction";

const PIPS_POLICY = { ...PIPS_R_ONLY_PRESET };
const FULL_POLICY = { ...NO_REDACTION };

let userA: { id: string; email: string };
let userB: { id: string; email: string };
let accountAId: string;
let instrumentId: string;
let tradeAId: string;
let noteA: string;

function tokenFromUrl(urlPath: string): string {
  return urlPath.split("/").pop() ?? "";
}

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
    email: "share-a@test.local",
    password: "password1",
    displayName: "Share A",
    timezone: "UTC",
    baseCurrency: "USD",
    locale: "fr",
  });
  const b = await createUserWithDefaults({
    email: "share-b@test.local",
    password: "password1",
    displayName: "Share B",
    timezone: "UTC",
    baseCurrency: "USD",
    locale: "en",
  });
  userA = a.user;
  userB = b.user;

  accountAId = (await db.account.findFirstOrThrow({ where: { userId: userA.id } })).id;

  noteA = "Setup breakout Londres — note confidentielle unique-42";
  const trade = await db.trade.create({
    data: {
      userId: userA.id,
      accountId: accountAId,
      instrumentId,
      direction: "LONG",
      entryTime: new Date("2025-03-10T08:00:00Z"),
      entryPrice: "2650.00",
      status: "CLOSED",
      exitTime: new Date("2025-03-10T10:30:00Z"),
      exitPrice: "2662.50",
      stopLoss: "2647.00",
      lots: "0.50",
      netPnl: "610.75",
      pips: "125.0",
      rMultiple: "4.17",
      resultType: "WIN",
      notes: noteA,
      preTradeAnalysis: "",
      postTradeReview: "",
      source: "MANUAL",
    },
  });
  tradeAId = trade.id;

  // Two more trades for the REPORT link.
  for (const [i, pnl] of [0, 1].entries()) {
    await db.trade.create({
      data: {
        userId: userA.id,
        accountId: accountAId,
        instrumentId,
        direction: i === 0 ? "LONG" : "SHORT",
        entryTime: new Date(`2025-03-1${2 + i}T08:00:00Z`),
        entryPrice: "2650.00",
        status: "CLOSED",
        exitTime: new Date(`2025-03-1${2 + i}T09:00:00Z`),
        exitPrice: pnl > 0 ? "2655.00" : "2645.00",
        lots: "0.10",
        netPnl: pnl > 0 ? "50.00" : "-50.00",
        rMultiple: pnl > 0 ? "1.0" : "-1.0",
        resultType: pnl > 0 ? "WIN" : "LOSS",
        preTradeAnalysis: "",
        postTradeReview: "",
        source: "MANUAL",
      },
    });
  }
});

afterAll(async () => {
  await db.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  await db.instrument.deleteMany({ where: { id: instrumentId } });
  await db.$disconnect();
});

// ── TRADE links ──────────────────────────────────────────────────────────────

describe("share links — TRADE", () => {
  it("crée un lien et ne montre l'URL qu'une fois (jeton 43 car., préfixe stocké)", async () => {
    const created = await createShareLink(userA.id, {
      type: "TRADE",
      tradeId: tradeAId,
      title: "XAUUSD breakout",
      mode: "SNAPSHOT",
      policy: PIPS_POLICY,
      expiresInDays: 30,
      maxViews: null,
    });
    expect(created.urlPath).toMatch(/^\/s\/[A-Za-z0-9_-]{43}$/);
    expect(created.link.status).toBe("ACTIVE");
    expect(created.link.tokenPrefix).toMatch(/^[A-Za-z0-9_-]{6}$/);
    // Le hash stocké n'est PAS le jeton brut.
    const row = await db.shareLink.findUnique({ where: { id: created.link.id } });
    expect(row?.tokenHash).not.toBe(tokenFromUrl(created.urlPath));
    expect(row?.tokenHash).toHaveLength(64); // HMAC-SHA256 hex
  });

  it("refuse de partager le trade d'un autre utilisateur (IDOR)", async () => {
    await expect(
      createShareLink(userB.id, {
        type: "TRADE",
        tradeId: tradeAId,
        title: "Vol",
        mode: "SNAPSHOT",
        policy: FULL_POLICY,
        expiresInDays: 7,
        maxViews: null,
      })
    ).rejects.toThrow("SHARE_TRADE_NOT_FOUND");
  });

  it("sert un payload SNAPSHOT réduit SANS fuite (pips & R)", async () => {
    const created = await createShareLink(userA.id, {
      type: "TRADE",
      tradeId: tradeAId,
      title: "Pips only",
      mode: "SNAPSHOT",
      policy: PIPS_POLICY,
      expiresInDays: 30,
      maxViews: null,
    });
    const raw = tokenFromUrl(created.urlPath);

    const result = await resolveShareLink(raw, { countView: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.payload.kind).toBe("TRADE");
    if (result.payload.kind !== "TRADE") return;

    // Champs masqués ABSENTS structurellement.
    expect("netPnl" in result.payload.trade).toBe(false);
    expect("lots" in result.payload.trade).toBe(false);
    expect("accountName" in result.payload.trade).toBe(false);
    expect("userId" in result.payload.trade).toBe(false);
    // Champs visibles conservés.
    expect(result.payload.trade.symbol).toBe("XAUUSD");
    expect(Number(result.payload.trade.pips)).toBe(125);
    expect(Number(result.payload.trade.rMultiple)).toBeCloseTo(4.17, 2);
    // Notes visibles dans le preset pips & R.
    expect(result.payload.trade.notes).toBe(noteA);

    // Scan de fuite sur le JSON sérialisé complet.
    const leaks = findLeaks(JSON.parse(JSON.stringify(result.payload)), [
      610.75,
      "610.75",
      "0.50",
      "Compte principal",
      userA.id,
    ]);
    expect(leaks).toEqual([]);

    // La vue a été comptée.
    const row = await db.shareLink.findUnique({ where: { id: created.link.id } });
    expect(row?.viewCount).toBe(1);
    expect(row?.lastViewedAt).not.toBeNull();
  });

  it("un SNAPSHOT reste figé après modification du trade", async () => {
    const created = await createShareLink(userA.id, {
      type: "TRADE",
      tradeId: tradeAId,
      title: "Fige",
      mode: "SNAPSHOT",
      policy: { ...FULL_POLICY, hideNotes: false },
      expiresInDays: 30,
      maxViews: null,
    });
    await db.trade.update({
      where: { id: tradeAId },
      data: { notes: "NOTE MODIFIÉE APRES CREATION" },
    });
    const result = await resolveShareLink(tokenFromUrl(created.urlPath), {
      countView: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.payload.kind === "TRADE") {
      expect(result.payload.trade.notes).toBe(noteA); // l'ancienne valeur
    }
    // Restore.
    await db.trade.update({ where: { id: tradeAId }, data: { notes: noteA } });
  });

  it("un LIVE reflète les mises à jour puis meurt avec le trade", async () => {
    const created = await createShareLink(userA.id, {
      type: "TRADE",
      tradeId: tradeAId,
      title: "Live",
      mode: "LIVE",
      policy: FULL_POLICY,
      expiresInDays: 30,
      maxViews: null,
    });
    const raw = tokenFromUrl(created.urlPath);

    await db.trade.update({
      where: { id: tradeAId },
      data: { notes: "NOTE LIVE UNIQUE-99" },
    });
    let result = await resolveShareLink(raw, { countView: false });
    expect(result.ok).toBe(true);
    if (result.ok && result.payload.kind === "TRADE") {
      expect(result.payload.trade.notes).toBe("NOTE LIVE UNIQUE-99");
    }

    // Suppression du trade → le lien devient GONE.
    const tempTrade = await db.trade.create({
      data: {
        userId: userA.id,
        accountId: accountAId,
        instrumentId,
        direction: "LONG",
        entryTime: new Date("2025-03-20T08:00:00Z"),
        entryPrice: "2660.00",
        status: "CLOSED",
        exitTime: new Date("2025-03-20T09:00:00Z"),
        exitPrice: "2670.00",
        preTradeAnalysis: "",
        postTradeReview: "",
        source: "MANUAL",
      },
    });
    const live = await createShareLink(userA.id, {
      type: "TRADE",
      tradeId: tempTrade.id,
      title: "Live éphémère",
      mode: "LIVE",
      policy: FULL_POLICY,
      expiresInDays: 30,
      maxViews: null,
    });
    await db.trade.delete({ where: { id: tempTrade.id } });
    const gone = await resolveShareLink(tokenFromUrl(live.urlPath), {
      countView: false,
    });
    expect(gone.ok).toBe(false);

    // Restore.
    await db.trade.update({ where: { id: tradeAId }, data: { notes: noteA } });
  });

  it("expire après expiresAt (GONE générique)", async () => {
    const created = await createShareLink(userA.id, {
      type: "TRADE",
      tradeId: tradeAId,
      title: "Expiré",
      mode: "SNAPSHOT",
      policy: FULL_POLICY,
      expiresInDays: 7,
      maxViews: null,
    });
    await db.shareLink.update({
      where: { id: created.link.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const result = await resolveShareLink(tokenFromUrl(created.urlPath), {
      countView: false,
    });
    expect(result.ok).toBe(false);
    expect(result).toEqual({ ok: false, reason: "GONE" });
  });

  it("bloque au-delà de maxViews (comptage atomique)", async () => {
    const created = await createShareLink(userA.id, {
      type: "TRADE",
      tradeId: tradeAId,
      title: "Limité",
      mode: "SNAPSHOT",
      policy: FULL_POLICY,
      expiresInDays: 30,
      maxViews: 2,
    });
    const raw = tokenFromUrl(created.urlPath);
    expect((await resolveShareLink(raw, { countView: true })).ok).toBe(true);
    expect((await resolveShareLink(raw, { countView: true })).ok).toBe(true);
    const third = await resolveShareLink(raw, { countView: true });
    expect(third.ok).toBe(false);
    const row = await db.shareLink.findUnique({ where: { id: created.link.id } });
    expect(row?.viewCount).toBe(2);
  });

  it("révoque immédiatement (page ET captures partagées)", async () => {
    const created = await createShareLink(userA.id, {
      type: "TRADE",
      tradeId: tradeAId,
      title: "À révoquer",
      mode: "SNAPSHOT",
      policy: FULL_POLICY,
      expiresInDays: 30,
      maxViews: null,
    });
    const raw = tokenFromUrl(created.urlPath);

    const ok = await revokeShareLink(userA.id, created.link.id);
    expect(ok).toBe(true);

    expect((await resolveShareLink(raw, { countView: false })).ok).toBe(false);
    // Le proxy média refuse aussi (captures mortes avec le lien).
    expect(await readPublicScreenshot(raw, "nimporte")).toBeNull();

    // Le snapshot stocké est effacé (hygiène).
    const row = await db.shareLink.findUnique({ where: { id: created.link.id } });
    expect(row?.snapshotJson).toBeNull();
    expect(row?.revokedAt).not.toBeNull();
  });

  it("jeton invalide → GONE sans distinction", async () => {
    const bad = await resolveShareLink("a".repeat(43), { countView: false });
    expect(bad).toEqual({ ok: false, reason: "GONE" });
    const malformed = await resolveShareLink("trop-court", { countView: false });
    expect(malformed).toEqual({ ok: false, reason: "GONE" });
  });
});

// ── REPORT links ─────────────────────────────────────────────────────────────

describe("share links — REPORT", () => {
  it("crée un rapport de période et le sert réduit (courbe en %)", async () => {
    const created = await createShareLink(userA.id, {
      type: "REPORT",
      reportPeriod: { start: "2025-03-01", end: "2025-03-31", accountId: null },
      title: "Mars 2025",
      mode: "SNAPSHOT",
      policy: PIPS_POLICY,
      expiresInDays: 90,
      maxViews: null,
    });
    const result = await resolveShareLink(tokenFromUrl(created.urlPath), {
      countView: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.kind).toBe("REPORT");
    if (result.payload.kind !== "REPORT") return;

    expect(result.payload.stats.tradeCount).toBe(3);
    expect("netPnl" in result.payload.stats).toBe(false);
    expect(result.payload.equity.unit).toBe("PERCENT");
    expect(result.payload.bySymbol.some((row) => row.name === "XAUUSD")).toBe(true);
    expect("netPnl" in result.payload.bySymbol[0]).toBe(false);

    // Aucun montant du journal ne fuite.
    const leaks = findLeaks(JSON.parse(JSON.stringify(result.payload)), [
      610.75,
      "610.75",
      50.0,
      "50.00",
    ]);
    expect(leaks).toEqual([]);
  });

  it("refuse un compte qui n'appartient pas au propriétaire", async () => {
    const accountB = await db.account.findFirstOrThrow({
      where: { userId: userB.id },
    });
    await expect(
      createShareLink(userA.id, {
        type: "REPORT",
        reportPeriod: {
          start: "2025-03-01",
          end: "2025-03-31",
          accountId: accountB.id,
        },
        title: "Compte volé",
        mode: "SNAPSHOT",
        policy: FULL_POLICY,
        expiresInDays: 30,
        maxViews: null,
      })
    ).rejects.toThrow("ACCOUNT_NOT_FOUND");
  });

  it("refuse une période invalide (inversée)", async () => {
    await expect(
      createShareLink(userA.id, {
        type: "REPORT",
        reportPeriod: { start: "2025-03-31", end: "2025-03-01", accountId: null },
        title: "Inversé",
        mode: "SNAPSHOT",
        policy: FULL_POLICY,
        expiresInDays: 30,
        maxViews: null,
      })
    ).rejects.toThrow("INVALID_PERIOD");
  });
});

// ── owner scoping ────────────────────────────────────────────────────────────

describe("share links — isolation propriétaire", () => {
  it("listShareLinks ne retourne que SES liens", async () => {
    const created = await createShareLink(userA.id, {
      type: "TRADE",
      tradeId: tradeAId,
      title: "A only",
      mode: "SNAPSHOT",
      policy: FULL_POLICY,
      expiresInDays: 30,
      maxViews: null,
    });
    const listA = await listShareLinks(userA.id);
    const listB = await listShareLinks(userB.id);
    expect(listA.some((l) => l.id === created.link.id)).toBe(true);
    expect(listB.some((l) => l.id === created.link.id)).toBe(false);
    // Le DTO ne porte jamais le hash ni le jeton.
    const dto = listA.find((l) => l.id === created.link.id);
    expect(dto).toBeDefined();
    expect(JSON.stringify(dto)).not.toContain("tokenHash");
  });

  it("user B ne peut pas révoquer le lien de user A", async () => {
    const created = await createShareLink(userA.id, {
      type: "TRADE",
      tradeId: tradeAId,
      title: "Pas toucher",
      mode: "SNAPSHOT",
      policy: FULL_POLICY,
      expiresInDays: 30,
      maxViews: null,
    });
    const ok = await revokeShareLink(userB.id, created.link.id);
    expect(ok).toBe(false);
    const result = await resolveShareLink(tokenFromUrl(created.urlPath), {
      countView: false,
    });
    expect(result.ok).toBe(true); // toujours vivant
  });
});

// ── media proxy policy ───────────────────────────────────────────────────────

describe("readPublicScreenshot — politique", () => {
  it("refuse les captures quand la politique les masque (même lien valide)", async () => {
    const created = await createShareLink(userA.id, {
      type: "TRADE",
      tradeId: tradeAId,
      title: "No shots",
      mode: "SNAPSHOT",
      policy: { ...FULL_POLICY, hideScreenshots: true },
      expiresInDays: 30,
      maxViews: null,
    });
    // Même une capture qui existe → null car la politique la masque.
    expect(
      await readPublicScreenshot(tokenFromUrl(created.urlPath), "whatever")
    ).toBeNull();
  });

  it("sert une capture d'un lien valide dont la politique l'autorise", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const path = await import("node:path");
    const { UPLOAD_ROOT } = await import("@/server/uploads");

    const shotId = "shotshare01";
    const storagePath = path.posix.join(userA.id, tradeAId, `${shotId}.png`);
    await mkdir(path.join(UPLOAD_ROOT, userA.id, tradeAId), { recursive: true });
    await writeFile(
      path.join(UPLOAD_ROOT, storagePath),
      Buffer.from("89504e470d0a1a0a", "hex")
    );
    await db.tradeScreenshot.create({
      data: {
        id: shotId,
        tradeId: tradeAId,
        userId: userA.id,
        storagePath,
        label: "ENTRY",
        caption: "Entrée",
      },
    });

    // Create the link AFTER the screenshot exists so its ref is captured
    // in the stored snapshot.
    const created = await createShareLink(userA.id, {
      type: "TRADE",
      tradeId: tradeAId,
      title: "Avec capture",
      mode: "SNAPSHOT",
      policy: FULL_POLICY,
      expiresInDays: 30,
      maxViews: null,
    });
    const raw = tokenFromUrl(created.urlPath);

    const file = await readPublicScreenshot(raw, shotId);
    expect(file).not.toBeNull();
    expect(file?.contentType).toBe("image/png");

    // Révocation → la capture meurt avec le lien.
    await revokeShareLink(userA.id, created.link.id);
    expect(await readPublicScreenshot(raw, shotId)).toBeNull();

    // Cleanup.
    await db.tradeScreenshot.deleteMany({ where: { id: shotId } });
  }, 30000);
});
