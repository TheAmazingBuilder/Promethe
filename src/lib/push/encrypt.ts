/**
 * Web Push message encryption - RFC 8291 / RFC 8188 `aes128gcm`.
 *
 * No web-push dependency (none is installed and none can be installed
 * from this VM): pure Node built-in `crypto`. The application server
 * encrypts with the receiver's p256dh public key and auth secret
 * (HKDF-SHA256 + ECDH P-256 + AES-128-GCM, single record, rs = 4096).
 * The push service never sees the plaintext.
 *
 * Test-only vectors live in tests/unit/push-crypto.test.ts, including
 * the RFC 8291 section 5 worked example verified byte-for-byte.
 */
import {
  createCipheriv,
  createECDH,
  randomBytes,
  createHmac,
} from "node:crypto";
import { fromBase64Url } from "@/lib/push/vapid";

/** The app payload: serialized as JSON, then encrypted as one record. */
export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

/** Serialize the app payload as JSON bytes. */
export function encodePushPayload(payload: PushPayload): Buffer {
  return Buffer.from(
    JSON.stringify({
      title: payload.title,
      body: payload.body,
      ...(payload.url ? { url: payload.url } : {}),
    }),
    "utf8"
  );
}

export interface EncryptPushMessageInput {
  plaintext: Buffer;
  /** base64url, 65-byte uncompressed P-256 public key. */
  receiverPublicKey: string;
  /** base64url, 16-byte auth secret. */
  authSecret: string;
  /** Fixed sender key (tests only; a fresh ephemeral key otherwise). */
  senderPrivateKey?: Buffer;
  /** Fixed salt (tests only; random otherwise). */
  salt?: Buffer;
}

export interface EncryptedPushMessage {
  salt: Buffer;
  /** The ephemeral sender public key (65 bytes, uncompressed). */
  serverPublicKey: Buffer;
  /** Full body: 86-octet header + ciphertext (with 16-byte auth tag). */
  body: Buffer;
}

function hkdfExtract(salt: Buffer, ikm: Buffer): Buffer {
  return createHmac("sha256", salt).update(ikm).digest();
}

function hkdfExpand(prk: Buffer, info: Buffer, length: number): Buffer {
  const okm = Buffer.alloc(length);
  let t = Buffer.alloc(0);
  let counter = 1;
  let filled = 0;
  while (filled < length) {
    t = createHmac("sha256", prk)
      .update(Buffer.concat([t, info, Buffer.from([counter])]))
      .digest();
    const take = Math.min(t.length, length - filled);
    t.copy(okm, filled, 0, take);
    filled += take;
    counter += 1;
  }
  return okm;
}

/**
 * Encrypt one aes128gcm record (RFC 8188 section 2). The record is
 * plaintext || 0x02 (padding delimiter). Key derivation is RFC 8291
 * section 3.4: ECDH shared secret, HKDF-Extract(auth, secret) ->
 * PRK_key, HKDF-Expand(PRK_key, "WebPush: info" || 0x00 || ua_public ||
 * as_public, 32) -> IKM, HKDF-Extract(salt, IKM) -> PRK, then CEK /
 * NONCE from PRK ("Content-Encoding: aes128gcm" / "Content-Encoding:
 * nonce" || 0x00).
 */
export function encryptPushMessage(
  input: EncryptPushMessageInput
): EncryptedPushMessage {
  const receiverPublic = fromBase64Url(input.receiverPublicKey);
  const authSecret = fromBase64Url(input.authSecret);
  if (receiverPublic.length !== 65 || receiverPublic[0] !== 0x04) {
    throw new Error("INVALID_P256DH");
  }
  if (authSecret.length !== 16) {
    throw new Error("INVALID_AUTH_SECRET");
  }

  const sender = createECDH("prime256v1");
  if (input.senderPrivateKey) sender.setPrivateKey(input.senderPrivateKey);
  else sender.generateKeys();
  const senderPublic = sender.getPublicKey(null, "uncompressed");
  const ecdhSecret = sender.computeSecret(receiverPublic);

  const prkKey = hkdfExtract(authSecret, ecdhSecret);
  const ikm = hkdfExpand(
    prkKey,
    Buffer.concat([
      Buffer.from("WebPush: info", "utf8"),
      Buffer.from([0]),
      receiverPublic,
      senderPublic,
    ]),
    32
  );
  const salt = input.salt ?? randomBytes(16);
  const prk = hkdfExtract(salt, ikm);
  const cek = hkdfExpand(
    prk,
    Buffer.concat([
      Buffer.from("Content-Encoding: aes128gcm", "utf8"),
      Buffer.from([0]),
    ]),
    16
  );
  const nonce = hkdfExpand(
    prk,
    Buffer.concat([
      Buffer.from("Content-Encoding: nonce", "utf8"),
      Buffer.from([0]),
    ]),
    12
  );

  const record = Buffer.concat([input.plaintext, Buffer.from([0x02])]);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(record),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  // Header: salt (16) || rs uint32be (4096) || keyid length (1) || sender
  // public key (65) = 86 octets.
  const header = Buffer.alloc(16 + 4 + 1 + senderPublic.length);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(senderPublic.length, 20);
  senderPublic.copy(header, 21);

  return {
    salt,
    serverPublicKey: senderPublic,
    body: Buffer.concat([header, ciphertext]),
  };
}

/** Test-only: the HKDF primitives, so the test can decrypt like a receiver. */
export const __testOnly = { hkdfExtract, hkdfExpand };
