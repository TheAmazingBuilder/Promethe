/**
 * v2.5 Module 9 - Validation for integration endpoints (pure, client-safe).
 *
 * SSRF guard: only https URLs on the allow-listed hosts are accepted for
 * Discord webhooks, and Telegram traffic only ever goes to api.telegram.org
 * (hard-coded in the delivery module, never taken from user input).
 * Secrets are validated for shape only - their value is never logged.
 */

export const DISCORD_WEBHOOK_HOSTS = ["discord.com", "discordapp.com"] as const;
export const TELEGRAM_API_HOST = "api.telegram.org";

/** Discord webhook path: /api/webhooks/<id>/<token> (query string ignored). */
const DISCORD_WEBHOOK_PATH = /^\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/;
/** Telegram bot token: <bot id digits>:<35-char secret>. */
const TELEGRAM_TOKEN = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;
const CHAT_ID = /^-?\d+$/;
const CHANNEL_USERNAME = /^@[A-Za-z0-9_]{5,}$/;
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export type ValidationResult =
  | { ok: true; value: string }
  | { ok: false; code: string };

export function validateDiscordWebhookUrl(raw: unknown): ValidationResult {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, code: "INVALID_WEBHOOK_URL" };
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, code: "INVALID_WEBHOOK_URL" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, code: "WEBHOOK_NOT_HTTPS" };
  }
  if (
    !(DISCORD_WEBHOOK_HOSTS as readonly string[]).includes(
      url.hostname.toLowerCase()
    )
  ) {
    return { ok: false, code: "WEBHOOK_HOST_NOT_ALLOWED" };
  }
  if (!DISCORD_WEBHOOK_PATH.test(url.pathname)) {
    return { ok: false, code: "INVALID_WEBHOOK_URL" };
  }
  // Drop any query string / fragment before storing.
  return { ok: true, value: `${url.origin}${url.pathname}` };
}

export function validateTelegramToken(raw: unknown): ValidationResult {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, code: "INVALID_TELEGRAM_TOKEN" };
  }
  const value = raw.trim();
  if (!TELEGRAM_TOKEN.test(value)) {
    return { ok: false, code: "INVALID_TELEGRAM_TOKEN" };
  }
  return { ok: true, value };
}

export function validateTelegramChatId(raw: unknown): ValidationResult {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, code: "INVALID_CHAT_ID" };
  }
  const value = raw.trim();
  if (!CHAT_ID.test(value) && !CHANNEL_USERNAME.test(value)) {
    return { ok: false, code: "INVALID_CHAT_ID" };
  }
  return { ok: true, value };
}

export function isValidQuietHours(value: unknown): value is string | null {
  if (value === null || value === undefined || value === "") return true;
  return typeof value === "string" && HH_MM.test(value);
}

/**
 * True when `now` falls inside the quiet window [start, end) in `timezone`.
 * Overnight windows (e.g. 22:00-07:00) wrap past midnight. Null bounds mean
 * no quiet hours.
 */
export function isInQuietHours(
  now: Date,
  timezone: string,
  start: string | null,
  end: string | null
): boolean {
  if (!start || !end || start === end) return false;
  let hhmm: string;
  try {
    hhmm = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: timezone,
    }).format(now);
  } catch {
    hhmm = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    }).format(now);
  }
  const toMin = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    return h * 60 + m;
  };
  const cur = toMin(hhmm);
  const from = toMin(start);
  const to = toMin(end);
  if (from < to) return cur >= from && cur < to;
  return cur >= from || cur < to;
}

/** Minutes until quiet hours end (from `now`), or 0 when not in quiet hours. */
export function minutesUntilQuietHoursEnd(
  now: Date,
  timezone: string,
  start: string | null,
  end: string | null
): number {
  if (!isInQuietHours(now, timezone, start, end) || !end) return 0;
  let hhmm: string;
  try {
    hhmm = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: timezone,
    }).format(now);
  } catch {
    hhmm = "00:00";
  }
  const toMin = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    return h * 60 + m;
  };
  const diff = toMin(end) - toMin(hhmm);
  return diff > 0 ? diff : diff + 24 * 60;
}
