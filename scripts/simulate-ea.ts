/**
 * v3 — scripts/simulate-ea.ts
 *
 * Simulates a MetaTrader terminal pushing events to /api/ingest/mt against
 * the running dev server (http://localhost:3000). Scenario:
 *   heartbeat → open → modify SL → partial close → close → deposit →
 *   duplicate re-send → out-of-order batch → wrong-login (MISMATCH).
 *
 * Usage:
 *   bun scripts/simulate-ea.ts [email] [--base http://localhost:3000]
 *
 * The script finds (or creates) a BrokerConnection for the user's first
 * account directly in the DB (server-side script, dev only) and prints the
 * token ONCE. Each step prints the per-event results.
 */
import { randomBytes } from "node:crypto";

const BASE = process.argv.includes("--base")
  ? process.argv[process.argv.indexOf("--base") + 1]
  : "http://localhost:3000";
const EMAIL = process.argv.find((arg) => arg.includes("@")) ?? "demo@tradejournal.app";

// ── Minimal DB bootstrap (mirrors src/lib/db.ts for a standalone script) ────
import { readFileSync } from "node:fs";

process.env.DATABASE_URL ??= "file:/home/z/my-project/db/custom.db";
process.env.TOKEN_PEPPER ??= readEnvFile("TOKEN_PEPPER");
process.env.IP_HASH_PEPPER ??= readEnvFile("IP_HASH_PEPPER");

/** Reads a variable from .env when absent from the real environment. */
function readEnvFile(name: string): string {
  try {
    const content = readFileSync(".env", "utf8");
    const match = content.match(new RegExp(`^${name}="?(.+?)"?$`, "m"));
    if (match) return match[1];
  } catch {
    /* ignore */
  }
  return "";
}

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();

  const { createHmac } = await import("node:crypto");
  const hashToken = (token: string) =>
    createHmac("sha256", process.env.TOKEN_PEPPER!).update(token).digest("hex");

  const user = await db.user.findUnique({ where: { email: EMAIL } });
  if (!user) {
    console.error(`✗ User ${EMAIL} not found — sign up first or pass an existing email.`);
    process.exit(1);
  }
  const account = await db.account.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
  if (!account) {
    console.error("✗ User has no account.");
    process.exit(1);
  }

  // Reuse an existing PENDING connection or create one.
  let connection = await db.brokerConnection.findFirst({
    where: { userId: user.id, accountId: account.id, platform: "MT5", status: { in: ["PENDING", "ACTIVE"] } },
  });
  let token: string;
  if (connection && connection.brokerServer === null) {
    // Token unknown (hash-only) → rotate to get a fresh one.
    token = `tj_${randomBytes(32).toString("base64url")}`;
    connection = await db.brokerConnection.update({
      where: { id: connection.id },
      data: {
        tokenHash: hashToken(token),
        tokenPrefix: token.slice(0, 6),
        status: "PENDING",
      },
    });
  } else if (connection) {
    token = `tj_${randomBytes(32).toString("base64url")}`;
    connection = await db.brokerConnection.update({
      where: { id: connection.id },
      data: {
        tokenHash: hashToken(token),
        tokenPrefix: token.slice(0, 6),
        brokerServer: null,
        brokerLogin: null,
        status: "PENDING",
      },
    });
  } else {
    token = `tj_${randomBytes(32).toString("base64url")}`;
    connection = await db.brokerConnection.create({
      data: {
        userId: user.id,
        accountId: account.id,
        platform: "MT5",
        label: "Simulateur EA",
        tokenHash: hashToken(token),
        tokenPrefix: token.slice(0, 6),
        status: "PENDING",
      },
    });
  }

  console.log(`▶ Connection ${connection.id} (${connection.label}) — account ${account.name}`);
  console.log(`  token: ${token}\n`);

  const SERVER = "SimBroker-Demo01";
  const LOGIN = "99887766";
  const OFFSET = 7200; // GMT+2
  const nowSec = () => Math.floor(Date.now() / 1000);
  const serverNow = () => nowSec() + OFFSET; // pretend we are the broker clock

  // Unique per run so re-running the simulator never collides with the
// (userId, eventId) idempotency keys of a previous run.
let positionCounter = 500 + (Date.now() % 100000);
  const nextPosition = () => String(++positionCounter);

  async function post(payload: unknown, label: string) {
    const response = await fetch(`${BASE}/api/ingest/mt`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    console.log(`── ${label} → HTTP ${response.status}`);
    if (Array.isArray(body.results)) {
      for (const result of body.results as { eventId: string; status: string; reason?: string }[]) {
        console.log(`   ${result.status.padEnd(10)} ${result.eventId}${result.reason ? ` (${result.reason})` : ""}`);
      }
    } else if (body.error) {
      console.log(`   error: ${body.error} — ${(body.message as string) ?? ""}`);
    }
    console.log("");
    return response.status;
  }

  function envelope(events: unknown[]) {
    return {
      schemaVersion: 1,
      platform: "MT5",
      eaVersion: "1.0.0",
      server: SERVER,
      login: LOGIN,
      currency: "USD",
      leverage: "500",
      serverGmtOffsetSeconds: OFFSET,
      sentAt: nowSec(),
      events,
    };
  }

  const SPEC = {
    digits: "2",
    point: "0.01",
    tickSize: "0.01",
    tickValue: "1",
    contractSize: "100",
  };

  // ── Scenario ────────────────────────────────────────────────────────────

  await post(
    envelope([
      {
        eventId: `MT5:${SERVER}:${LOGIN}:HB:${nowSec()}`,
        type: "HEARTBEAT",
        time: serverNow(),
        balance: "10000",
        equity: "10000",
        openPositions: 0,
      },
    ]),
    "1. Heartbeat (binding)"
  );

  const positionId = nextPosition();
  const openTime = serverNow() - 3600;

  await post(
    envelope([
      {
        eventId: `MT5:${SERVER}:${LOGIN}:OPEN:${positionId}`,
        type: "POSITION_OPENED",
        time: openTime,
        symbol: "XAUUSDm",
        symbolSpec: SPEC,
        positionId,
        ticket: `9900${positionId}`,
        direction: "LONG",
        volume: "0.50",
        openTime,
        openPrice: "2650.50",
        stopLoss: "2645.00",
        takeProfit: "2662.00",
        magic: "777",
        comment: "sim open",
      },
    ]),
    "2. Position opened (0.50 XAUUSDm, SL 2645)"
  );

  await post(
    envelope([
      {
        eventId: `MT5:${SERVER}:${LOGIN}:MOD:${positionId}:${nowSec()}`,
        type: "POSITION_MODIFIED",
        time: serverNow() - 1800,
        positionId,
        stopLoss: "2650.00",
        takeProfit: "2668.00",
      },
    ]),
    "3. SL moved to breakeven, TP extended"
  );

  await post(
    envelope([
      {
        eventId: `MT5:${SERVER}:${LOGIN}:PCLOSE:${positionId}:${nowSec()}`,
        type: "POSITION_PARTIAL_CLOSE",
        time: serverNow() - 900,
        positionId,
        closedVolume: "0.20",
        closeTime: serverNow() - 900,
        closePrice: "2655.80",
        profit: "106.00",
        commission: "-0.40",
        swap: "0",
      },
    ]),
    "4. Partial close 0.20 @ 2655.80"
  );

  await post(
    envelope([
      {
        eventId: `MT5:${SERVER}:${LOGIN}:CLOSE:${positionId}`,
        type: "POSITION_CLOSED",
        time: serverNow(),
        symbol: "XAUUSDm",
        symbolSpec: SPEC,
        positionId,
        ticket: `9900${positionId}`,
        direction: "LONG",
        volume: "0.30",
        openTime,
        openPrice: "2650.50",
        closeTime: serverNow(),
        closePrice: "2658.40",
        stopLoss: "2650.00",
        takeProfit: "2668.00",
        commission: "-0.60",
        swap: "-0.30",
        fees: "0",
        profit: "237.00",
        magic: "777",
        comment: "sim close",
        mfePrice: "2659.10",
        maePrice: "2649.20",
        mfeMaeComplete: true,
      },
    ]),
    "5. Final close 0.30 @ 2658.40 (broker P&L)"
  );

  await post(
    envelope([
      {
        eventId: `MT5:${SERVER}:${LOGIN}:BAL:${nowSec() + 1}`,
        type: "BALANCE_OPERATION",
        time: serverNow(),
        amount: "500",
        kind: "DEPOSIT",
        comment: "sim deposit",
      },
    ]),
    "6. Deposit +500"
  );

  await post(
    envelope([
      {
        eventId: `MT5:${SERVER}:${LOGIN}:CLOSE:${positionId}`,
        type: "POSITION_CLOSED",
        time: serverNow(),
        symbol: "XAUUSDm",
        positionId,
        ticket: `9900${positionId}`,
        volume: "0.30",
        closeTime: serverNow(),
        closePrice: "2658.40",
        profit: "237.00",
      },
    ]),
    "7. Duplicate close re-send (idempotency)"
  );

  // Out-of-order: an ADD execution whose event time predates the close.
  const latePosition = nextPosition();
  await post(
    envelope([
      {
        eventId: `MT5:${SERVER}:${LOGIN}:CLOSE:${latePosition}`,
        type: "POSITION_CLOSED",
        time: serverNow(),
        symbol: "EURUSD",
        symbolSpec: { digits: "5", point: "0.00001", tickSize: "0.00001", tickValue: "1", contractSize: "100000" },
        positionId: latePosition,
        ticket: `9900${latePosition}`,
        direction: "SHORT",
        volume: "0.10",
        openTime: serverNow() - 7200,
        openPrice: "1.08500",
        closeTime: serverNow() - 3600,
        closePrice: "1.08320",
        commission: "-0.35",
        swap: "0",
        fees: "0",
        profit: "18.00",
        stopLoss: "1.08650",
        takeProfit: "1.08200",
        mfeMaeComplete: false,
      },
    ]),
    "8. Out-of-order history-style close (EURUSD)"
  );

  await post(
    {
      schemaVersion: 1,
      platform: "MT5",
      eaVersion: "1.0.0",
      server: "SimBroker-OTHER",
      login: "11112222",
      serverGmtOffsetSeconds: OFFSET,
      sentAt: nowSec(),
      events: [
        {
          eventId: `MT5:SimBroker-OTHER:11112222:HB:${nowSec()}`,
          type: "HEARTBEAT",
          time: serverNow(),
          balance: "5",
          equity: "5",
          openPositions: 0,
        },
      ],
    },
    "9. WRONG login (expect MISMATCH + rejection)"
  );

  // ── Final state ─────────────────────────────────────────────────────────
  const trades = await db.trade.findMany({
    where: { accountId: account.id, source: "EA_SYNC" },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  console.log("── Resulting synced trades:");
  for (const trade of trades) {
    console.log(
      `   ${trade.id.slice(-6)} ${trade.direction} lots=${trade.lots} entry=${trade.entryPrice} ` +
        `exit=${trade.exitPrice ?? "OPEN"} status=${trade.status} net=${trade.netPnl ?? "?"} ` +
        `pips=${trade.pips ?? "?"} R=${trade.rMultiple ?? "?"} source=${trade.pnlSource}`
    );
  }
  const executions = await db.tradeExecution.count({
    where: { trade: { accountId: account.id, source: "EA_SYNC" } },
  });
  console.log(`   executions total: ${executions}`);
  const cash = await db.cashTransaction.findMany({
    where: { accountId: account.id, externalId: { not: null } },
  });
  console.log(`   synced cash transactions: ${cash.length}`);

  // Reset the connection to a clean state for the next run.
  await db.brokerConnection.update({
    where: { id: connection.id },
    data: { brokerServer: null, brokerLogin: null, status: "PENDING" },
  });

  await db.$disconnect();
  console.log("\n✓ Simulation complete — connection reset to PENDING for re-use.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
