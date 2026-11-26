/**
 * Web Push cryptography (§25.4) - RFC 8291 section 5 worked example.
 *
 * The sender is pure Node built-in `crypto` (no web-push dependency):
 * RFC 8292 VAPID (ES256 JWT, P-256) + RFC 8291 / RFC 8188 `aes128gcm`
 * (ECDH + HKDF-SHA256 + AES-128-GCM). These tests prove the round-trip
 * without any network: the RFC golden vector byte-for-byte, a
 * decrypt-with-the-receiver's-private-key round-trip, and a
 * verify-the-VAPID-JWT-signature-with-the-public-key check. All keys
 * here are throwaway test fixtures (the RFC vectors or pairs generated
 * in-test) - never production keys.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDecipheriv,
  createECDH,
  createPublicKey,
  verify as verifySignature,
} from "node:crypto";
import {
  encodePushPayload,
  encryptPushMessage,
  __testOnly as encryptTestOnly,
} from "@/lib/push/encrypt";
import {
  createVapidJwt,
  fromBase64Url,
  getVapidConfig,
  isPushConfigured,
  toBase64Url,
  vapidAuthorization,
  vapidSubject,
} from "@/lib/push/vapid";

// RFC 8291 section 5 / Appendix A.
const RFC_PLAINTEXT = "When I grow up, I want to be a watermelon";
const RFC_AS_PRIVATE = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw";
const RFC_AS_PUBLIC =
  "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
const RFC_UA_PRIVATE = "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94";
const RFC_UA_PUBLIC =
  "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const RFC_SALT = "DGv6ra1nlYgDCS1FRnbzlw";
const RFC_AUTH = "BTBZMqHH6r4Tts7J_aSIgg";
const RFC_HEADER =
  "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
const RFC_CIPHERTEXT =
  "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ";

function ecdhFromPrivate(privateB64: string) {
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(fromBase64Url(privateB64));
  return ecdh;
}

/**
 * Decrypt one aes128gcm record the way a push service / receiver would:
 * ECDH with the receiver's private key and the sender's public key from
 * the header, then the RFC 8291 key derivation, then AES-128-GCM.
 */
function decryptPushRecord(
  body: Buffer,
  receiverPrivateB64: string,
  authB64: string
): Buffer {
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  expect(rs).toBe(4096);
  const keyIdLength = body[20];
  const senderPublic = body.subarray(21, 21 + keyIdLength);
  const ciphertext = body.subarray(21 + keyIdLength);

  const receiver = ecdhFromPrivate(receiverPrivateB64);
  const receiverPublic = receiver.getPublicKey(null, "uncompressed");
  const ecdhSecret = receiver.computeSecret(senderPublic);
  const prkKey = encryptTestOnly.hkdfExtract(fromBase64Url(authB64), ecdhSecret);
  const ikm = encryptTestOnly.hkdfExpand(
    prkKey,
    Buffer.concat([
      Buffer.from("WebPush: info", "utf8"),
      Buffer.from([0]),
      receiverPublic,
      senderPublic,
    ]),
    32
  );
  const prk = encryptTestOnly.hkdfExtract(salt, ikm);
  const cek = encryptTestOnly.hkdfExpand(
    prk,
    Buffer.concat([
      Buffer.from("Content-Encoding: aes128gcm", "utf8"),
      Buffer.from([0]),
    ]),
    16
  );
  const nonce = encryptTestOnly.hkdfExpand(
    prk,
    Buffer.concat([
      Buffer.from("Content-Encoding: nonce", "utf8"),
      Buffer.from([0]),
    ]),
    12
  );
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const plain = Buffer.concat([
    decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
    decipher.final(),
  ]);
  // The record is plaintext || 0x02 padding delimiter.
  expect(plain.length).toBeGreaterThan(0);
  expect(plain[plain.length - 1]).toBe(0x02);
  return plain.subarray(0, plain.length - 1);
}

describe("push crypto - RFC 8291 section 5 golden vector", () => {
  it("encrypts the worked example byte-for-byte (header + ciphertext)", () => {
    const sender = ecdhFromPrivate(RFC_AS_PRIVATE);
    expect(toBase64Url(sender.getPublicKey(null, "uncompressed"))).toBe(
      RFC_AS_PUBLIC
    );
    const result = encryptPushMessage({
      plaintext: Buffer.from(RFC_PLAINTEXT, "utf8"),
      receiverPublicKey: RFC_UA_PUBLIC,
      authSecret: RFC_AUTH,
      senderPrivateKey: sender.getPrivateKey(),
      salt: fromBase64Url(RFC_SALT),
    });
    expect(toBase64Url(result.salt)).toBe(RFC_SALT);
    expect(toBase64Url(result.serverPublicKey)).toBe(RFC_AS_PUBLIC);
    expect(result.body.length).toBe(86 + fromBase64Url(RFC_CIPHERTEXT).length);
    expect(toBase64Url(result.body.subarray(0, 86))).toBe(RFC_HEADER);
    expect(toBase64Url(result.body.subarray(86))).toBe(RFC_CIPHERTEXT);
  });

  it("decrypts the RFC ciphertext back to the plaintext", () => {
    const body = Buffer.concat([
      fromBase64Url(RFC_HEADER),
      fromBase64Url(RFC_CIPHERTEXT),
    ]);
    const plain = decryptPushRecord(body, RFC_UA_PRIVATE, RFC_AUTH);
    expect(plain.toString("utf8")).toBe(RFC_PLAINTEXT);
  });

  it("rejects a bad receiver key and a bad auth secret", () => {
    const base = {
      plaintext: Buffer.from("x"),
      receiverPublicKey: RFC_UA_PUBLIC,
      authSecret: RFC_AUTH,
    };
    expect(() =>
      encryptPushMessage({
        ...base,
        receiverPublicKey: toBase64Url(Buffer.alloc(65, 1)),
      })
    ).toThrow("INVALID_P256DH");
    expect(() =>
      encryptPushMessage({
        ...base,
        authSecret: toBase64Url(Buffer.alloc(8)),
      })
    ).toThrow("INVALID_AUTH_SECRET");
  });
});

describe("push crypto - round-trip with fresh keys", () => {
  it("encrypts the app payload and decrypts it with the receiver key", () => {
    const receiver = createECDH("prime256v1");
    receiver.generateKeys();
    const auth = Buffer.from("0123456789abcdef", "utf8");
    const payload = {
      title: "Sync stale",
      body: "Broker sync is 2 days old.",
      url: "/broker-sync",
    };
    const result = encryptPushMessage({
      plaintext: encodePushPayload(payload),
      receiverPublicKey: toBase64Url(receiver.getPublicKey(null, "uncompressed")),
      authSecret: toBase64Url(auth),
    });
    const plain = decryptPushRecord(
      result.body,
      toBase64Url(receiver.getPrivateKey()),
      toBase64Url(auth)
    );
    expect(JSON.parse(plain.toString("utf8"))).toEqual(payload);
  });

  it("uses a fresh ephemeral sender key on every call", () => {
    const receiver = createECDH("prime256v1");
    receiver.generateKeys();
    const auth = Buffer.from("fedcba9876543210", "utf8");
    const input = {
      plaintext: encodePushPayload({ title: "A", body: "same" }),
      receiverPublicKey: toBase64Url(receiver.getPublicKey(null, "uncompressed")),
      authSecret: toBase64Url(auth),
    };
    const a = encryptPushMessage(input);
    const b = encryptPushMessage(input);
    // Same plaintext, different sender key + salt: different ciphertext.
    expect(a.body.equals(b.body)).toBe(false);
    expect(a.serverPublicKey.equals(b.serverPublicKey)).toBe(false);
  });
});

describe("push crypto - VAPID (RFC 8292)", () => {
  const vapid = createECDH("prime256v1");
  vapid.generateKeys();
  const publicKey = toBase64Url(vapid.getPublicKey(null, "uncompressed"));
  const privateKey = toBase64Url(vapid.getPrivateKey());

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is unconfigured without keys, malformed keys, and configured with a valid pair", () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    expect(isPushConfigured()).toBe(false);
    expect(getVapidConfig()).toBeNull();

    vi.stubEnv("VAPID_PUBLIC_KEY", toBase64Url(Buffer.alloc(10)));
    vi.stubEnv("VAPID_PRIVATE_KEY", privateKey);
    expect(getVapidConfig()).toBeNull();

    vi.stubEnv("VAPID_PUBLIC_KEY", publicKey);
    vi.stubEnv("VAPID_PRIVATE_KEY", privateKey);
    expect(isPushConfigured()).toBe(true);
    const config = getVapidConfig();
    expect(config).not.toBeNull();
    expect(config!.publicKeyB64).toBe(publicKey);
  });

  it("subject falls back to the app URL when none is set", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(vapidSubject()).toBe("https://promethe.app");
  });

  it("signs a JWT the public key verifies (aud, exp, sub)", () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", publicKey);
    vi.stubEnv("VAPID_PRIVATE_KEY", privateKey);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    const config = getVapidConfig();
    expect(config).not.toBeNull();
    const now = new Date("2026-11-26T00:00:00.000Z");
    const jwt = createVapidJwt({
      audience: "https://push.example.com",
      subject: vapidSubject(),
      config: config!,
      now,
    });
    const header = vapidAuthorization(jwt, config!.publicKeyB64);
    expect(header).toMatch(/^vapid t=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+, k=/);
    const token = header.replace(/^vapid t=/, "").split(", k=")[0];
    const [headerB64, payloadB64, signatureB64] = token.split(".");
    const jwtHeader = JSON.parse(fromBase64Url(headerB64).toString("utf8"));
    expect(jwtHeader).toEqual({ typ: "JWT", alg: "ES256" });
    const claims = JSON.parse(fromBase64Url(payloadB64).toString("utf8"));
    expect(claims.aud).toBe("https://push.example.com");
    expect(claims.sub).toBe("https://promethe.app");
    expect(claims.exp).toBe(Math.floor(now.getTime() / 1000) + 12 * 60 * 60);
    expect(claims).not.toHaveProperty("iat");
    // Verify the ES256 signature with the public key (JWK form).
    const pubBytes = config!.publicKey;
    const pub = createPublicKey({
      key: {
        kty: "EC",
        crv: "P-256",
        x: toBase64Url(pubBytes.subarray(1, 33)),
        y: toBase64Url(pubBytes.subarray(33, 65)),
      },
      format: "jwk",
    });
    // Verify the ES256 signature with the public key (JWK form).
    // The JWT signature is the raw R||S (64 bytes) from ieee-p1363:
    // the one-shot crypto.verify takes the encoding on the key options
    // (the streaming Verify.verify ignores it).
    expect(
      verifySignature(
        "sha256",
        Buffer.from(`${headerB64}.${payloadB64}`, "utf8"),
        { key: pub, dsaEncoding: "ieee-p1363" },
        fromBase64Url(signatureB64)
      )
    ).toBe(true);
  });
});
