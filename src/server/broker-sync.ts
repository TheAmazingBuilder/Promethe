/**
 * v3 — Broker sync data-access layer (owner-scoped).
 *
 * Every function takes userId (OWNER context — ingest tokens bypass this
 * layer but are bound to the connection's account server-side). The raw EA
 * token is returned EXACTLY ONCE at creation/rotation; only the hash is
 * stored.
 */
import type { BrokerConnection, SymbolMapping } from "@prisma/client";
import { db } from "@/lib/db";
import { generateToken, hashToken, tokenPrefixOf } from "@/lib/tokens";
import { evaluateLifeStatus } from "@/lib/sync/status";

export class BrokerSyncError extends Error {
  constructor(
    public code: string,
    public status: number,
    message?: string
  ) {
    super(message ?? code);
    this.name = "BrokerSyncError";
  }
}

export interface BrokerConnectionDTO {
  id: string;
  accountId: string;
  accountName: string;
  platform: string;
  label: string;
  tokenPrefix: string;
  brokerServer: string | null;
  brokerLogin: string | null;
  /** Evaluated at read time (ACTIVE/STALE/PENDING) or sticky (MISMATCH/REVOKED). */
  status: string;
  lastHeartbeatAt: string | null;
  lastEventAt: string | null;
  eaVersion: string | null;
  historyBackfillFrom: string | null;
  autoMergeEnabled: boolean;
  createdAt: string;
  revokedAt: string | null;
}

function toDTO(
  connection: BrokerConnection & { account: { name: string } }
): BrokerConnectionDTO {
  const status =
    connection.status === "MISMATCH" || connection.status === "REVOKED"
      ? connection.status
      : evaluateLifeStatus(connection.lastHeartbeatAt);
  return {
    id: connection.id,
    accountId: connection.accountId,
    accountName: connection.account.name,
    platform: connection.platform,
    label: connection.label,
    tokenPrefix: connection.tokenPrefix,
    brokerServer: connection.brokerServer,
    brokerLogin: connection.brokerLogin,
    status,
    lastHeartbeatAt: connection.lastHeartbeatAt?.toISOString() ?? null,
    lastEventAt: connection.lastEventAt?.toISOString() ?? null,
    eaVersion: connection.eaVersion,
    historyBackfillFrom: connection.historyBackfillFrom?.toISOString() ?? null,
    autoMergeEnabled: connection.autoMergeEnabled,
    createdAt: connection.createdAt.toISOString(),
    revokedAt: connection.revokedAt?.toISOString() ?? null,
  };
}

// ── Connections ──────────────────────────────────────────────────────────────

export async function listConnections(userId: string): Promise<BrokerConnectionDTO[]> {
  const rows = await db.brokerConnection.findMany({
    where: { userId },
    include: { account: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toDTO);
}

async function requireConnection(
  userId: string,
  id: string
): Promise<BrokerConnection> {
  const connection = await db.brokerConnection.findFirst({ where: { id, userId } });
  if (!connection) throw new BrokerSyncError("CONNECTION_NOT_FOUND", 404);
  return connection;
}

export interface CreatedConnection {
  connection: BrokerConnectionDTO;
  /** Raw token - displayed ONCE, never stored or logged. */
  token: string;
  /** Ready-to-copy ingest URL for the EA. */
  ingestUrl: string;
}

export async function createConnection(
  userId: string,
  input: { accountId: string; platform: "MT4" | "MT5"; label: string }
): Promise<CreatedConnection> {
  const account = await db.account.findFirst({ where: { id: input.accountId, userId } });
  if (!account) throw new BrokerSyncError("ACCOUNT_NOT_FOUND", 422);

  // One connection per (account, platform) keeps the binding unambiguous.
  const clash = await db.brokerConnection.findFirst({
    where: { userId, accountId: input.accountId, platform: input.platform, status: { not: "REVOKED" } },
  });
  if (clash) throw new BrokerSyncError("CONNECTION_EXISTS", 409);

  const token = `tj_${generateToken(32)}`;
  const created = await db.brokerConnection.create({
    data: {
      userId,
      accountId: input.accountId,
      platform: input.platform,
      label: input.label,
      tokenHash: hashToken(token),
      tokenPrefix: tokenPrefixOf(token),
      status: "PENDING",
    },
    include: { account: { select: { name: true } } },
  });

  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  return {
    connection: toDTO(created),
    token,
    ingestUrl: `${base ?? ""}/api/ingest/mt`,
  };
}

export async function rotateToken(
  userId: string,
  id: string
): Promise<{ connection: BrokerConnectionDTO; token: string }> {
  const connection = await requireConnection(userId, id);
  if (connection.status === "REVOKED") {
    throw new BrokerSyncError("CONNECTION_REVOKED", 422);
  }
  const token = `tj_${generateToken(32)}`;
  const updated = await db.brokerConnection.update({
    where: { id: connection.id },
    data: {
      tokenHash: hashToken(token),
      tokenPrefix: tokenPrefixOf(token),
      status: "PENDING", // the new token must prove itself with a heartbeat
      brokerServer: null, // rebinding allowed on rotation
      brokerLogin: null,
    },
    include: { account: { select: { name: true } } },
  });
  return { connection: toDTO(updated), token };
}

export async function revokeConnection(userId: string, id: string): Promise<BrokerConnectionDTO> {
  const connection = await requireConnection(userId, id);
  const updated = await db.brokerConnection.update({
    where: { id: connection.id },
    data: { status: "REVOKED", revokedAt: new Date() },
    include: { account: { select: { name: true } } },
  });
  return toDTO(updated);
}

export async function updateConnection(
  userId: string,
  id: string,
  patch: {
    label?: string;
    autoMergeEnabled?: boolean;
    historyBackfillFrom?: string | null;
    resetBinding?: boolean;
  }
): Promise<BrokerConnectionDTO> {
  const connection = await requireConnection(userId, id);

  if (patch.resetBinding) {
    // Owner-initiated recovery after MISMATCH: forget the bound terminal.
    const updated = await db.brokerConnection.update({
      where: { id: connection.id },
      data: {
        brokerServer: null,
        brokerLogin: null,
        status: connection.status === "REVOKED" ? "REVOKED" : "PENDING",
      },
      include: { account: { select: { name: true } } },
    });
    return toDTO(updated);
  }

  const updated = await db.brokerConnection.update({
    where: { id: connection.id },
    data: {
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(patch.autoMergeEnabled !== undefined ? { autoMergeEnabled: patch.autoMergeEnabled } : {}),
      ...(patch.historyBackfillFrom !== undefined
        ? { historyBackfillFrom: patch.historyBackfillFrom ? new Date(patch.historyBackfillFrom) : null }
        : {}),
    },
    include: { account: { select: { name: true } } },
  });
  return toDTO(updated);
}

// ── Symbol mappings ──────────────────────────────────────────────────────────

export interface SymbolMappingDTO {
  id: string;
  brokerSymbol: string;
  instrumentId: string;
  instrumentSymbol: string;
  instrumentPipSize: string;
  /** True when the instrument was auto-created by normalization (verify pip). */
  autoResolved: boolean;
  createdAt: string;
}

export async function listSymbolMappings(userId: string): Promise<SymbolMappingDTO[]> {
  const mappings = await db.symbolMapping.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  if (mappings.length === 0) return [];

  const instruments = await db.instrument.findMany({
    where: { id: { in: mappings.map((m) => m.instrumentId) } },
  });
  const byId = new Map(instruments.map((instrument) => [instrument.id, instrument]));

  return mappings.map((mapping) => {
    const instrument = byId.get(mapping.instrumentId);
    return {
      id: mapping.id,
      brokerSymbol: mapping.brokerSymbol,
      instrumentId: mapping.instrumentId,
      instrumentSymbol: instrument?.symbol ?? "?",
      instrumentPipSize: instrument?.pipSize.toString() ?? "?",
      autoResolved:
        instrument !== undefined &&
        instrument.symbol.toUpperCase() !== mapping.brokerSymbol.toUpperCase() &&
        instrument.userId === userId,
      createdAt: mapping.createdAt.toISOString(),
    };
  });
}

export async function upsertSymbolMapping(
  userId: string,
  input: { brokerSymbol: string; instrumentId: string; pipSize?: string | null }
): Promise<void> {
  const instrument = await db.instrument.findFirst({
    where: { id: input.instrumentId, OR: [{ userId: null }, { userId }] },
  });
  if (!instrument) throw new BrokerSyncError("INSTRUMENT_NOT_FOUND", 422);

  if (input.pipSize) {
    // The user confirmed/adjusted the pip convention for this instrument.
    await db.instrument.update({
      where: { id: instrument.id },
      data: { pipSize: input.pipSize },
    });
  }

  await db.symbolMapping.upsert({
    where: { userId_brokerSymbol: { userId, brokerSymbol: input.brokerSymbol } },
    update: { instrumentId: input.instrumentId },
    create: { userId, brokerSymbol: input.brokerSymbol, instrumentId: input.instrumentId },
  });
}

export async function deleteSymbolMapping(userId: string, id: string): Promise<boolean> {
  const removed = await db.symbolMapping.deleteMany({ where: { id, userId } });
  return removed.count > 0;
}

// ── Magic number mappings ────────────────────────────────────────────────────

export interface MagicMappingDTO {
  id: string;
  magicNumber: string;
  strategyId: string;
  strategyName: string;
  connectionId: string | null;
}

export async function listMagicMappings(userId: string): Promise<MagicMappingDTO[]> {
  const mappings = await db.magicNumberMapping.findMany({
    where: { userId },
    orderBy: { magicNumber: "asc" },
  });
  if (mappings.length === 0) return [];
  const strategies = await db.strategy.findMany({
    where: { id: { in: mappings.map((m) => m.strategyId) } },
    select: { id: true, name: true },
  });
  const byId = new Map(strategies.map((s) => [s.id, s.name]));
  return mappings.map((m) => ({
    id: m.id,
    magicNumber: m.magicNumber,
    strategyId: m.strategyId,
    strategyName: byId.get(m.strategyId) ?? "?",
    connectionId: m.connectionId,
  }));
}

export async function createMagicMapping(
  userId: string,
  input: { magicNumber: string; strategyId: string; connectionId?: string | null }
): Promise<MagicMappingDTO> {
  const strategy = await db.strategy.findFirst({ where: { id: input.strategyId, userId } });
  if (!strategy) throw new BrokerSyncError("STRATEGY_NOT_FOUND", 422);
  const existing = await db.magicNumberMapping.findFirst({
    where: { userId, magicNumber: input.magicNumber, connectionId: input.connectionId ?? null },
  });
  if (existing) throw new BrokerSyncError("MAGIC_MAPPING_EXISTS", 409);
  const created = await db.magicNumberMapping.create({
    data: {
      userId,
      magicNumber: input.magicNumber,
      strategyId: input.strategyId,
      connectionId: input.connectionId ?? null,
    },
  });
  return {
    id: created.id,
    magicNumber: created.magicNumber,
    strategyId: created.strategyId,
    strategyName: strategy.name,
    connectionId: created.connectionId,
  };
}

export async function deleteMagicMapping(userId: string, id: string): Promise<boolean> {
  const removed = await db.magicNumberMapping.deleteMany({ where: { id, userId } });
  return removed.count > 0;
}

// ── Dashboard overview ───────────────────────────────────────────────────────

export interface SyncOverviewDTO {
  connections: BrokerConnectionDTO[];
  /** Synced trades awaiting user details (strategy/notes). */
  needsDetailsCount: number;
  /** Latest equity per synced account (from heartbeats). */
  equity: { accountId: string; accountName: string; balance: string; equity: string; time: string }[];
  /** Last ingest events, newest first (max 10). */
  recentEvents: {
    id: string;
    connectionLabel: string;
    type: string;
    status: string;
    errorCode: string | null;
    receivedAt: string;
  }[];
}

export async function getSyncOverview(userId: string): Promise<SyncOverviewDTO> {
  const [connections, needsDetailsCount, snapshots, events] = await Promise.all([
    db.brokerConnection.findMany({
      where: { userId, status: { not: "REVOKED" } },
      include: { account: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    db.trade.count({ where: { userId, needsDetails: true, isDraft: false } }),
    db.accountEquitySnapshot.findMany({
      where: { userId },
      orderBy: { time: "desc" },
      take: 60,
      include: { account: { select: { name: true } } },
    }),
    db.syncEventLog.findMany({
      where: { userId },
      orderBy: { receivedAt: "desc" },
      take: 10,
      include: { connection: { select: { label: true } } },
    }),
  ]);

  // Latest snapshot per account.
  const latest = new Map<string, (typeof snapshots)[number]>();
  for (const snapshot of snapshots) {
    if (!latest.has(snapshot.accountId)) latest.set(snapshot.accountId, snapshot);
  }

  return {
    connections: connections.map(toDTO),
    needsDetailsCount,
    equity: [...latest.values()].map((snapshot) => ({
      accountId: snapshot.accountId,
      accountName: snapshot.account.name,
      balance: snapshot.balance.toString(),
      equity: snapshot.equity.toString(),
      time: snapshot.time.toISOString(),
    })),
    recentEvents: events.map((event) => ({
      id: event.id,
      connectionLabel: event.connection.label,
      type: event.type,
      status: event.status,
      errorCode: event.errorCode,
      receivedAt: event.receivedAt.toISOString(),
    })),
  };
}
