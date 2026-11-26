/**
 * Web Push HTTP sender (RFC 8030 + RFC 8292 VAPID + RFC 8291 encryption).
 *
 * One POST to the subscription endpoint. No dependency: Node built-in
 * crypto (via ./vapid and ./encrypt) and the global fetch. The fetch
 * implementation is injectable so tests can prove every outcome without
 * any network.
 *
 * Response mapping:
 *   2xx            -> delivered.
 *   404 / 410 Gone -> the subscription is expired: the caller must delete
 *     the subscription row (never retry a dead endpoint).
 *   429            -> retryable, honours Retry-After (seconds, capped at
 *     1 h) when present.
 *   other 4xx/5xx  -> failed (retryable by the outbox backoff, dead after
 *     MAX_OUTBOX_ATTEMPTS).
 * Network error / timeout (10 s) -> failed, retryable.
 */
import {
  createVapidJwt,
  getVapidConfig,
  toBase64Url,
  vapidAuthorization,
  vapidSubject,
  type VapidConfig,
} from "@/lib/push/vapid";
import { encodePushPayload, encryptPushMessage, type PushPayload } from "@/lib/push/encrypt";

export const PUSH_FETCH_TIMEOUT_MS = 10_000;
export const PUSH_TTL_SECONDS = 24 * 60 * 60;

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type PushSendOutcome =
  | { ok: true }
  | { ok: false; gone: true; error: string }
  | { ok: false; gone?: false; retryAfterSeconds?: number; error: string };

export interface SendWebPushInput {
  subscription: PushSubscriptionInput;
  payload: PushPayload;
  vapid?: VapidConfig | null;
  fetchImpl?: typeof fetch;
  now?: Date;
}

/** Parse a Retry-After header (seconds, or an HTTP date) into seconds. */
export function parseRetryAfterSeconds(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds, 3600);
  }
  const date = Date.parse(value);
  if (Number.isFinite(date)) {
    return Math.max(0, Math.min(Math.floor((date - Date.now()) / 1000), 3600));
  }
  return undefined;
}

export async function sendWebPush(input: SendWebPushInput): Promise<PushSendOutcome> {
  const vapid = input.vapid ?? getVapidConfig();
  if (!vapid) {
    return { ok: false, error: "VAPID_NOT_CONFIGURED" };
  }
  let endpoint: URL;
  try {
    endpoint = new URL(input.subscription.endpoint);
  } catch {
    return { ok: false, error: "INVALID_ENDPOINT" };
  }
  if (endpoint.protocol !== "https:") {
    return { ok: false, error: "INVALID_ENDPOINT" };
  }

  let encrypted;
  try {
    encrypted = encryptPushMessage({
      plaintext: encodePushPayload(input.payload),
      receiverPublicKey: input.subscription.p256dh,
      authSecret: input.subscription.auth,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `ENCRYPTION_FAILED: ${detail.slice(0, 120)}` };
  }

  const now = input.now ?? new Date();
  const jwt = createVapidJwt({
    audience: endpoint.origin,
    subject: vapidSubject(),
    config: vapid,
    now,
  });

  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PUSH_FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(endpoint.href, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "aes128gcm",
        Encryption: `salt=${toBase64Url(encrypted.salt)}`,
        "Crypto-Key": `dh=${toBase64Url(encrypted.serverPublicKey)}; p256ecdsa=${vapid.publicKeyB64}`,
        Authorization: vapidAuthorization(jwt, vapid.publicKeyB64),
        TTL: String(PUSH_TTL_SECONDS),
      },
      body: Uint8Array.from(encrypted.body),
      signal: controller.signal,
    });
    if (res.ok) return { ok: true };
    if (res.status === 404 || res.status === 410) {
      return { ok: false, gone: true, error: `SUBSCRIPTION_GONE (${res.status})` };
    }
    if (res.status === 429) {
      const retryAfterSeconds = parseRetryAfterSeconds(res.headers.get("retry-after"));
      return {
        ok: false,
        retryAfterSeconds: retryAfterSeconds ?? 60,
        error: "RATE_LIMITED (429)",
      };
    }
    return { ok: false, error: `PUSH_FAILED (${res.status})` };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `NETWORK_ERROR: ${detail.slice(0, 120)}` };
  } finally {
    clearTimeout(timer);
  }
}
