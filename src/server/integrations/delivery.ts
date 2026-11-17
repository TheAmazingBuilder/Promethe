/**
 * v2.5 Module 9 - Delivery engine: outbox, retries, daily summaries,
 * drawdown / prop alerts.
 *
 * Design:
 *  - enqueueIntegrationEvent() is idempotent (dedupeKey per endpoint) and
 *    best-effort: it NEVER throws, so a failure here can never break the
 *    business operation that triggered the event (trade close, cron…).
 *  - processOutbox() is driven by POST /api/cron/integrations (Bearer
 *    CRON_SECRET). Sends are NOT real time: on the free Vercel plan the
 *    cron runs once a day, so alerts leave at the next cron pass. The UI
 *    says so honestly.
 *  - Retries use exponential backoff (2^attempts minutes, capped at 60),
 *    honour HTTP 429 + retry_after, and give up after MAX_ATTEMPTS (DEAD).
 *  - An endpoint auto-disables after 5 consecutive failures.
 *  - Quiet hours gate daily summaries only; drawdown / prop alerts always
 *    go out.
 */
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/integrations/crypto";
import {
  isInQuietHours,
  minutesUntilQuietHoursEnd,
  TELEGRAM_API_HOST,
} from "@/lib/integrations/validation";
import {
  parseOutboundPayload,
  renderDiscord,
  renderTelegram,
  type IntegrationEventData,
  type IntegrationEventType,
  type PrivacyLevel,
} from "@/lib/integrations/templates";
import { getPropStatus } from "@/server/prop-status";
import { computeTradeStats } from "@/lib/analytics/engine";
import { localDateInTz } from "@/lib/analytics/calendar";
import { getDisplayPreferences } from "@/server/display-preferences";
import { getTradingDay, tradingDayOfTrade } from "@/lib/time/trading-day";
import { consumeRateLimit } from "@/lib/rate-limit";

export const MAX_OUTBOX_ATTEMPTS = 5;
export const MAX_CONSECUTIVE_FAILURES = 5;
const FETCH_TIMEOUT_MS = 10_000;
const DRAWDOWN_THRESHOLDS = [50, 80, 95] as const;

function appUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL;
  return url && url.trim() !== "" ? url.replace(/\/+$/, "") : "https://promethe.app";
}

function logError(message: string, error: unknown): void {
  // Never log secrets: only the message + a short error string.
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`[integrations] ${message}: ${detail.slice(0, 200)}`);
}

/** Dedupe key for one event on one endpoint. */
export function dedupeKeyFor(
  base: string,
  endpointId: string
): string {
  return `${base}:${endpointId}`;
}

export interface EnqueueResult {
  enqueued: number;
  skipped: number;
}

async function enqueueForEndpoint(
  userId: string,
  eventType: IntegrationEventType,
  data: IntegrationEventData["data"],
  baseDedupeKey: string,
  endpointId: string,
  privacyLevel: PrivacyLevel
): Promise<boolean> {
  const dedupeKey = dedupeKeyFor(baseDedupeKey, endpointId);
  const payloadJson = JSON.stringify({ eventType, privacyLevel, data });
  try {
    await db.outboundMessage.upsert({
      where: { dedupeKey },
      update: {},
      create: {
        userId,
        endpointId,
        eventType,
        dedupeKey,
        payloadJson,
        status: "PENDING",
        nextAttemptAt: new Date(),
      },
    });
    return true;
  } catch {
    // Duplicate (race) or other write issue: skip, stay best-effort.
    return false;
  }
}

/**
 * Queue one event on every enabled endpoint that subscribes to it.
 * Idempotent per (base dedupeKey, endpoint). Never throws.
 */
export async function enqueueIntegrationEvent(
  userId: string,
  eventType: IntegrationEventType,
  data: IntegrationEventData["data"],
  baseDedupeKey: string
): Promise<EnqueueResult> {
  try {
    const subscriptions = await db.integrationSubscription.findMany({
      where: {
        userId,
        eventType,
        isEnabled: true,
        endpoint: { isEnabled: true },
      },
      include: { endpoint: { select: { id: true, type: true } } },
    });
    let enqueued = 0;
    let skipped = 0;
    for (const sub of subscriptions) {
      const ok = await enqueueForEndpoint(
        userId,
        eventType,
        data,
        baseDedupeKey,
        sub.endpointId,
        sub.privacyLevel as PrivacyLevel
      );
      if (ok) enqueued += 1;
      else skipped += 1;
    }
    return { enqueued, skipped };
  } catch (error) {
    logError("enqueue failed", error);
    return { enqueued: 0, skipped: 0 };
  }
}

// ── Daily summary ────────────────────────────────────────────────────────────

export async function buildDailySummaryData(
  userId: string,
  date: string
): Promise<IntegrationEventData & { eventType: "DAILY_SUMMARY" }> {
  const [profile, prefs] = await Promise.all([
    db.profile.findUnique({
      where: { id: userId },
      select: { timezone: true, baseCurrency: true },
    }),
    getDisplayPreferences(userId),
  ]);
  const timezone = profile?.timezone ?? "UTC";
  const currency = profile?.baseCurrency ?? "USD";
  // `date` is a TRADING day (the sender computes it with getTradingDay):
  // trades belong to it when their exit falls in that trading day.
  const dayOf = (d: Date) => getTradingDay(d, timezone, prefs.tradingDay);
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const [closed, openCount] = await Promise.all([
    db.trade.findMany({
      where: {
        userId,
        status: "CLOSED",
        isDraft: false,
        exitTime: { gte: since, not: null },
      },
      select: {
        id: true,
        entryTime: true,
        exitTime: true,
        netPnl: true,
        rMultiple: true,
        resultType: true,
        strategyId: true,
        instrumentId: true,
        instrument: { select: { symbol: true } },
        direction: true,
        session: true,
        lots: true,
      },
    }),
    db.trade.count({
      where: { userId, status: "OPEN", isDraft: false },
    }),
  ]);
  const today = closed
    .filter((t) => t.exitTime != null && dayOf(t.exitTime) === date)
    .map((t) => ({
      id: t.id,
      exitTime: t.exitTime?.toISOString() ?? "",
      entryTime: t.entryTime.toISOString(),
      netPnl: t.netPnl?.toString() ?? null,
      rMultiple: t.rMultiple?.toString() ?? null,
      resultType: t.resultType,
      strategyId: t.strategyId,
      instrumentId: t.instrumentId,
      symbol: t.instrument.symbol,
      direction: t.direction,
      session: t.session,
      lots: t.lots?.toString() ?? null,
    }));
  const stats = computeTradeStats(today, {
    dayOf: tradingDayOfTrade(timezone, prefs.tradingDay),
  });
  return {
    eventType: "DAILY_SUMMARY",
    data: {
      date,
      pnl: stats.netPnl,
      currency,
      tradeCount: stats.tradeCount,
      wins: stats.wins,
      losses: stats.losses,
      breakevens: stats.breakevens,
      winRate: stats.winRate,
      openTrades: openCount,
    },
  };
}

/**
 * Queue today's summary for every user with an enabled DAILY_SUMMARY
 * subscription, skipping endpoints inside their quiet hours (deferred to
 * the next cron pass). One summary per user, endpoint and day.
 */
export async function sendDailySummariesDue(
  now = new Date()
): Promise<{ users: number; enqueued: number }> {
  let users = 0;
  let enqueued = 0;
  try {
    const subs = await db.integrationSubscription.findMany({
      where: {
        eventType: "DAILY_SUMMARY",
        isEnabled: true,
        endpoint: { isEnabled: true },
      },
      select: {
        userId: true,
        endpointId: true,
        privacyLevel: true,
        quietHoursStart: true,
        quietHoursEnd: true,
      },
    });
    const byUser = new Map<string, typeof subs>();
    for (const sub of subs) {
      const list = byUser.get(sub.userId) ?? [];
      list.push(sub);
      byUser.set(sub.userId, list);
    }
    for (const [userId, userSubs] of byUser) {
      const [profile, prefs] = await Promise.all([
        db.profile.findUnique({
          where: { id: userId },
          select: { timezone: true },
        }),
        getDisplayPreferences(userId),
      ]);
      const timezone = profile?.timezone ?? "UTC";
      // The summary covers the current TRADING day (default MIDNIGHT_LOCAL
      // = the local calendar day, i.e. the previous behaviour).
      const date = getTradingDay(now, timezone, prefs.tradingDay);
      // Skip endpoints in quiet hours for this pass.
      const active = userSubs.filter(
        (s) => !isInQuietHours(now, timezone, s.quietHoursStart, s.quietHoursEnd)
      );
      if (active.length === 0) continue;
      const summary = await buildDailySummaryData(userId, date);
      users += 1;
      // Enqueue per endpoint so quiet hours are honoured individually.
      for (const sub of active) {
        const ok = await enqueueForEndpoint(
          userId,
          "DAILY_SUMMARY",
          summary.data,
          `daily-summary:${userId}:${date}`,
          sub.endpointId,
          sub.privacyLevel as PrivacyLevel
        );
        if (ok) enqueued += 1;
      }
    }
  } catch (error) {
    logError("daily summaries failed", error);
  }
  return { users, enqueued };
}

// ── Drawdown / prop alerts ───────────────────────────────────────────────────

function dayKeyInTz(now: Date, timezone: string): string {
  try {
    return localDateInTz(now, timezone) ?? now.toISOString().slice(0, 10);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/**
 * Check the prop status after a trade close and queue alerts when a
 * drawdown threshold (50 / 80 / 95 % of the max) is crossed, when a prop
 * rule is breached, or when the profit target is reached. One alert per
 * threshold / kind per day (dedupeKey). Never throws.
 */
export async function checkDrawdownAlerts(
  userId: string,
  accountId?: string
): Promise<void> {
  try {
    const payload = await getPropStatus(userId, accountId);
    if (!payload || !payload.status) return;
    const { status, account } = payload;
    const profile = await db.profile.findUnique({
      where: { id: userId },
      select: { timezone: true, baseCurrency: true },
    });
    const timezone = profile?.timezone ?? "UTC";
    const currency = profile?.baseCurrency ?? account.currency ?? "USD";
    const dayKey = dayKeyInTz(new Date(), timezone);

    const ddUsed = Number(status.totalDrawdown.usedPercent ?? 0);
    for (const threshold of DRAWDOWN_THRESHOLDS) {
      if (ddUsed >= threshold) {
        await enqueueIntegrationEvent(
          userId,
          "DRAWDOWN_ALERT",
          {
            threshold,
            usedPercent: status.totalDrawdown.usedPercent ?? "0",
            drawdownUsed: status.totalDrawdown.used,
            drawdownLimit: status.totalDrawdown.limitAmount,
            currency,
            accountName: account.name,
            drawdownType: status.drawdownType,
          },
          `drawdown:${userId}:${account.id}:${threshold}:${dayKey}`
        );
      }
    }

    if (status.overall === "BREACHED" || status.breached) {
      await enqueueIntegrationEvent(
        userId,
        "PROP_ALERT",
        {
          kind: "BREACHED",
          accountName: account.name,
          detail:
            "Une limite prop a été dépassée (perte journalière ou drawdown total).",
        },
        `prop:${userId}:${account.id}:BREACHED:${dayKey}`
      );
    } else if (status.profitTarget.reached) {
      await enqueueIntegrationEvent(
        userId,
        "PROP_ALERT",
        {
          kind: "TARGET_REACHED",
          accountName: account.name,
          detail: "Objectif de profit du challenge atteint.",
        },
        `prop:${userId}:${account.id}:TARGET:${dayKey}`
      );
    } else {
      const dailyUsed = Number(status.dailyLoss.usedPercent ?? 0);
      if (dailyUsed >= 80) {
        await enqueueIntegrationEvent(
          userId,
          "PROP_ALERT",
          {
            kind: "DAILY_LOSS_WARNING",
            accountName: account.name,
            detail: `Perte journalière à ${status.dailyLoss.usedPercent ?? "?"} % de la limite autorisée.`,
          },
          `prop:${userId}:${account.id}:DAILY80:${dayKey}`
        );
      }
    }
  } catch (error) {
    logError("drawdown check failed", error);
  }
}

// ── Sending ──────────────────────────────────────────────────────────────────

interface SendOutcome {
  ok: boolean;
  retryAfterSeconds?: number;
  error?: string;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function parseRetryAfter(body: unknown): number | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const record = body as Record<string, unknown>;
  if (typeof record.retry_after === "number") return record.retry_after;
  const params = record.parameters as Record<string, unknown> | undefined;
  if (params && typeof params.retry_after === "number") {
    return params.retry_after;
  }
  return undefined;
}

async function sendToDiscord(
  webhookUrl: string,
  event: IntegrationEventData,
  privacy: PrivacyLevel
): Promise<SendOutcome> {
  try {
    const res = await fetchWithTimeout(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(renderDiscord(event, privacy, appUrl())),
    });
    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => null);
    const retryAfter = parseRetryAfter(body);
    if (res.status === 429 && retryAfter != null) {
      return { ok: false, retryAfterSeconds: retryAfter, error: "RATE_LIMITED" };
    }
    return {
      ok: false,
      error: `Discord HTTP ${res.status}`,
      retryAfterSeconds: res.status === 429 ? 5 : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message.slice(0, 200) : "Network error",
    };
  }
}

async function sendToTelegram(
  token: string,
  chatId: string,
  event: IntegrationEventData,
  privacy: PrivacyLevel
): Promise<SendOutcome> {
  // The host is hard-coded: user input never chooses the destination.
  const url = `https://${TELEGRAM_API_HOST}/bot${token}/sendMessage`;
  try {
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: renderTelegram(event, privacy, appUrl()),
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => null);
    const retryAfter = parseRetryAfter(body);
    if (res.status === 429 && retryAfter != null) {
      return { ok: false, retryAfterSeconds: retryAfter, error: "RATE_LIMITED" };
    }
    return {
      ok: false,
      error: `Telegram HTTP ${res.status}`,
      retryAfterSeconds: res.status === 429 ? 5 : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message.slice(0, 200) : "Network error",
    };
  }
}

async function sendOutbound(
  endpointType: string,
  secret: string,
  chatId: string | null,
  event: IntegrationEventData,
  privacy: PrivacyLevel
): Promise<SendOutcome> {
  if (endpointType === "DISCORD_WEBHOOK") {
    return sendToDiscord(secret, event, privacy);
  }
  if (endpointType === "TELEGRAM_BOT") {
    if (!chatId) return { ok: false, error: "Chat Telegram manquant." };
    return sendToTelegram(secret, chatId, event, privacy);
  }
  return { ok: false, error: "Type d'endpoint inconnu." };
}

function backoffDelayMs(attempts: number): number {
  const minutes = Math.min(2 ** attempts, 60);
  return minutes * 60 * 1000;
}

async function recordFailure(
  endpointId: string,
  error: string | undefined
): Promise<void> {
  try {
    const endpoint = await db.integrationEndpoint.update({
      where: { id: endpointId },
      data: {
        consecutiveFailures: { increment: 1 },
        lastErrorAt: new Date(),
      },
      select: { consecutiveFailures: true },
    });
    if (endpoint.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      await db.integrationEndpoint.update({
        where: { id: endpointId },
        data: { isEnabled: false },
      });
    }
  } catch (e) {
    logError("record failure failed", e);
  }
  void error;
}

export interface OutboxReport {
  processed: number;
  sent: number;
  failed: number;
  dead: number;
  deferredQuietHours: number;
}

/**
 * Drain due PENDING outbox rows. Daily summaries inside quiet hours are
 * deferred past the end of quiet hours instead of being sent.
 */
export async function processOutbox(
  limit = 50,
  now = new Date()
): Promise<OutboxReport> {
  const report: OutboxReport = {
    processed: 0,
    sent: 0,
    failed: 0,
    dead: 0,
    deferredQuietHours: 0,
  };
  let rows;
  try {
    rows = await db.outboundMessage.findMany({
      where: { status: "PENDING", nextAttemptAt: { lte: now } },
      orderBy: { createdAt: "asc" },
      take: limit,
      include: { endpoint: true },
    });
  } catch (error) {
    logError("outbox read failed", error);
    return report;
  }

  for (const row of rows) {
    report.processed += 1;
    const parsed = parseOutboundPayload(row.payloadJson);
    if (!parsed) {
      await db.outboundMessage.update({
        where: { id: row.id },
        data: { status: "DEAD", lastError: "Payload illisible." },
      });
      report.dead += 1;
      continue;
    }
    const { event, privacyLevel } = parsed;
    const endpoint = row.endpoint;
    if (!endpoint || !endpoint.isEnabled) {
      await db.outboundMessage.update({
        where: { id: row.id },
        data: { status: "DEAD", lastError: "Endpoint désactivé ou supprimé." },
      });
      report.dead += 1;
      continue;
    }

    // Quiet hours: daily summaries wait, alerts go out.
    if (event.eventType === "DAILY_SUMMARY") {
      const sub = await db.integrationSubscription.findFirst({
        where: {
          endpointId: endpoint.id,
          eventType: "DAILY_SUMMARY",
        },
        select: { quietHoursStart: true, quietHoursEnd: true },
      });
      const profile = await db.profile.findUnique({
        where: { id: row.userId },
        select: { timezone: true },
      });
      const timezone = profile?.timezone ?? "UTC";
      if (
        sub &&
        isInQuietHours(now, timezone, sub.quietHoursStart, sub.quietHoursEnd)
      ) {
        const waitMin = minutesUntilQuietHoursEnd(
          now,
          timezone,
          sub.quietHoursStart,
          sub.quietHoursEnd
        );
        await db.outboundMessage.update({
          where: { id: row.id },
          data: {
            nextAttemptAt: new Date(now.getTime() + Math.max(waitMin, 1) * 60 * 1000),
          },
        });
        report.deferredQuietHours += 1;
        continue;
      }
    }

    // Per-endpoint send rate limit (best effort, never blocks the queue).
    try {
      const rl = await consumeRateLimit(
        `integrations:${endpoint.id}`,
        30,
        60 * 1000
      );
      if (!rl.allowed) {
        await db.outboundMessage.update({
          where: { id: row.id },
          data: { nextAttemptAt: new Date(now.getTime() + 60 * 1000) },
        });
        report.failed += 1;
        continue;
      }
    } catch (error) {
      logError("rate limit check failed", error);
    }

    let secret: string;
    try {
      secret = decryptSecret(endpoint.secretEncrypted);
    } catch (error) {
      logError("decrypt failed", error);
      await db.outboundMessage.update({
        where: { id: row.id },
        data: { status: "DEAD", lastError: "Secret illisible (clé de chiffrement ?)." },
      });
      report.dead += 1;
      continue;
    }

    const outcome = await sendOutbound(
      endpoint.type,
      secret,
      endpoint.chatId,
      event,
      privacyLevel
    );

    if (outcome.ok) {
      await Promise.all([
        db.outboundMessage.update({
          where: { id: row.id },
          data: { status: "SENT", sentAt: new Date() },
        }),
        db.integrationEndpoint.update({
          where: { id: endpoint.id },
          data: { consecutiveFailures: 0, lastSentAt: new Date() },
        }),
      ]);
      report.sent += 1;
      continue;
    }

    const attempts = row.attempts + 1;
    if (outcome.retryAfterSeconds != null) {
      // 429: honour retry_after, keep PENDING.
      await db.outboundMessage.update({
        where: { id: row.id },
        data: {
          attempts,
          lastError: outcome.error ?? "RATE_LIMITED",
          nextAttemptAt: new Date(
            now.getTime() +
              Math.min(Math.max(outcome.retryAfterSeconds, 1), 3600) * 1000
          ),
        },
      });
      report.failed += 1;
      continue;
    }
    if (attempts >= MAX_OUTBOX_ATTEMPTS) {
      await db.outboundMessage.update({
        where: { id: row.id },
        data: { status: "DEAD", attempts, lastError: outcome.error ?? "Échec répété." },
      });
      await recordFailure(endpoint.id, outcome.error);
      report.dead += 1;
    } else {
      await db.outboundMessage.update({
        where: { id: row.id },
        data: {
          status: "FAILED",
          attempts,
          lastError: outcome.error ?? "Échec d'envoi.",
          nextAttemptAt: new Date(now.getTime() + backoffDelayMs(attempts)),
        },
      });
      await recordFailure(endpoint.id, outcome.error);
      report.failed += 1;
    }
  }
  return report;
}

/** Send a test message straight away (used by the "Tester" button). */
export async function sendTestMessage(
  userId: string,
  endpointId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const endpoint = await db.integrationEndpoint.findFirst({
      where: { id: endpointId, userId },
    });
    if (!endpoint) return { ok: false, error: "ENDPOINT_NOT_FOUND" };
    if (!endpoint.isEnabled) {
      return { ok: false, error: "ENDPOINT_DISABLED" };
    }
    const secret = decryptSecret(endpoint.secretEncrypted);
    const outcome = await sendOutbound(
      endpoint.type,
      secret,
      endpoint.chatId,
      { eventType: "TEST", data: {} },
      "FULL"
    );
    if (outcome.ok) {
      await db.integrationEndpoint.update({
        where: { id: endpoint.id },
        data: { consecutiveFailures: 0, lastSentAt: new Date() },
      });
      return { ok: true };
    }
    await recordFailure(endpoint.id, outcome.error);
    return { ok: false, error: outcome.error ?? "TEST_FAILED" };
  } catch (error) {
    logError("test message failed", error);
    return { ok: false, error: "TEST_FAILED" };
  }
}

export interface TelegramChatInfo {
  id: string;
  title: string;
  type: string;
}

/**
 * Call Telegram getUpdates with a user-supplied token (never stored, never
 * logged) and list the chats the bot can see, so the user can pick its chat
 * id. Returns an empty list when the bot has no recent update.
 */
export async function discoverTelegramChats(
  token: string
): Promise<{ chats: TelegramChatInfo[]; error?: string }> {
  try {
    const res = await fetchWithTimeout(
      `https://${TELEGRAM_API_HOST}/bot${token}/getUpdates`,
      { method: "GET" }
    );
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      result?: Array<{
        message?: { chat?: { id?: number; title?: string; username?: string; type?: string } };
        channel_post?: { chat?: { id?: number; title?: string; username?: string; type?: string } };
      }>;
      description?: string;
    } | null;
    if (!res.ok || !body?.ok) {
      return { chats: [], error: "TELEGRAM_API_ERROR" };
    }
    const seen = new Map<string, TelegramChatInfo>();
    for (const update of body.result ?? []) {
      const chat = update.message?.chat ?? update.channel_post?.chat;
      if (!chat || chat.id == null) continue;
      const id = String(chat.id);
      if (seen.has(id)) continue;
      seen.set(id, {
        id,
        title: chat.title ?? (chat.username ? `@${chat.username}` : id),
        type: chat.type ?? "private",
      });
    }
    return { chats: [...seen.values()] };
  } catch (error) {
    logError("telegram getUpdates failed", error);
    return { chats: [], error: "TELEGRAM_API_ERROR" };
  }
}
