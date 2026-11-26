/**
 * VAPID (RFC 8292) - application server keys and JWT creation.
 *
 * No dependency: Node built-in crypto only. Keys are raw P-256 points
 * encoded base64url (public key 65 bytes uncompressed starting with 0x04,
 * private key 32 bytes), as produced by the Push API and by the key
 * generation command in docs/notifications.md.
 *
 * Env vars (names only - values live in Vercel / .env, never in the repo):
 *   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY - server sender keys.
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY - same public key, inlined at build time
 *     for the browser subscribe call. Both public-key vars must hold the
 *     same value; changing any of them requires a redeploy.
 */
import crypto from "node:crypto";

/** base64url (no padding) encode. */
export function toBase64Url(data: Buffer): string {
  return data.toString("base64url");
}

/** base64url decode. Throws on malformed input. */
export function fromBase64Url(value: string): Buffer {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Empty base64url value.");
  }
  return Buffer.from(value, "base64url");
}

export interface VapidConfig {
  publicKey: Buffer;
  privateKey: Buffer;
  /** base64url public key, as the browser and the Authorization header need it. */
  publicKeyB64: string;
}

/** Parse and validate a VAPID public key (65 bytes, uncompressed point). */
export function parseVapidPublicKey(value: string): Buffer {
  const key = fromBase64Url(value);
  if (key.length !== 65 || key[0] !== 0x04) {
    throw new Error("Invalid VAPID public key: expected 65 bytes starting with 0x04.");
  }
  return key;
}

/** Parse and validate a VAPID private key (32-byte scalar). */
export function parseVapidPrivateKey(value: string): Buffer {
  const key = fromBase64Url(value);
  if (key.length !== 32) {
    throw new Error("Invalid VAPID private key: expected 32 bytes.");
  }
  return key;
}

/**
 * Read the VAPID sender config from the environment. Reads env on every
 * call (never cached at import time) so tests can set throwaway keys.
 * Returns null when either key is missing or malformed.
 */
export function getVapidConfig(): VapidConfig | null {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return null;
  try {
    const publicKey = parseVapidPublicKey(pub);
    const privateKey = parseVapidPrivateKey(priv);
    return { publicKey, privateKey, publicKeyB64: pub };
  } catch {
    return null;
  }
}

export function isPushConfigured(): boolean {
  return getVapidConfig() !== null;
}

/** App URL used as the VAPID JWT `sub` claim (identifies the sender). */
export function vapidSubject(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL;
  return url && url.trim() !== "" ? url.replace(/\/+$/, "") : "https://promethe.app";
}

function publicKeyToJwk(publicKey: Buffer): {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
} {
  return {
    kty: "EC",
    crv: "P-256",
    x: toBase64Url(publicKey.subarray(1, 33)),
    y: toBase64Url(publicKey.subarray(33, 65)),
  };
}

/** Derive the public point of a P-256 private scalar (uncompressed, 65 bytes). */
export function derivePublicKey(privateKey: Buffer): Buffer {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.setPrivateKey(privateKey);
  return ecdh.getPublicKey();
}

function privateKeyToKeyObject(
  privateKey: Buffer,
  publicKey: Buffer
): crypto.KeyObject {
  const jwk = publicKeyToJwk(publicKey);
  return crypto.createPrivateKey({
    key: { ...jwk, d: toBase64Url(privateKey) },
    format: "jwk",
  });
}

export interface VapidJwtInput {
  /** Push service origin, e.g. https://fcm.googleapis.com */
  audience: string;
  subject: string;
  config: VapidConfig;
  /** Seconds until expiry from now (default 12 h, the RFC 8292 guidance). */
  expiresInSeconds?: number;
  now?: Date;
}

/**
 * Create a VAPID JWT (ES256, raw R||S signature). The JWT authenticates
 * the application server to the push service.
 */
export function createVapidJwt(input: VapidJwtInput): string {
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const header = toBase64Url(
    Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" }), "utf8")
  );
  const payload = toBase64Url(
    Buffer.from(
      JSON.stringify({
        aud: input.audience,
        exp: nowSeconds + (input.expiresInSeconds ?? 12 * 60 * 60),
        sub: input.subject,
      }),
      "utf8"
    )
  );
  const signingInput = `${header}.${payload}`;
  const publicKey = derivePublicKey(input.config.privateKey);
  const keyObject = privateKeyToKeyObject(input.config.privateKey, publicKey);
  const signature = crypto.sign("sha256", Buffer.from(signingInput, "utf8"), {
    key: keyObject,
    dsaEncoding: "ieee-p1363",
  });
  return `${signingInput}.${toBase64Url(signature)}`;
}

/** `Authorization` header value for a push request. */
export function vapidAuthorization(jwt: string, publicKeyB64: string): string {
  return `vapid t=${jwt}, k=${publicKeyB64}`;
}
