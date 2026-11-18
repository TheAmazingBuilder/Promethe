/**
 * v2.5 Module 9 - AES-256-GCM encryption for integration secrets.
 *
 * Discord webhook URLs and Telegram bot tokens are stored ONLY as
 * ciphertext (IntegrationEndpoint.secretEncrypted). The master key comes
 * from INTEGRATION_ENCRYPTION_KEY (32 bytes, hex or base64) and is NEVER
 * logged, returned, or committed. Without the key, creating an endpoint
 * fails with a clear message naming the variable to set.
 *
 * Ciphertext format: "v1:<iv hex>:<auth tag hex>:<cipher hex>".
 * Server-only: imports node:crypto, never import from client components.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export class IntegrationCryptoError extends Error {
  readonly code: string;
  constructor(code: "ENCRYPTION_KEY_MISSING" | "ENCRYPTION_KEY_INVALID") {
    super(
      code === "ENCRYPTION_KEY_MISSING"
        ? "INTEGRATION_ENCRYPTION_KEY is not set."
        : "INTEGRATION_ENCRYPTION_KEY is invalid (need 32 bytes, hex or base64)."
    );
    this.name = "IntegrationCryptoError";
    this.code = code;
  }
}

/** Parse the master key (hex 64 chars, or base64 of 32 bytes). */
export function getIntegrationKey(): Buffer {
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!raw || raw.trim() === "") {
    throw new IntegrationCryptoError("ENCRYPTION_KEY_MISSING");
  }
  const trimmed = raw.trim();
  let key: Buffer | null = null;
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    key = Buffer.from(trimmed, "hex");
  } else {
    try {
      const decoded = Buffer.from(trimmed, "base64");
      if (decoded.length === 32) key = decoded;
    } catch {
      key = null;
    }
  }
  if (!key || key.length !== 32) {
    throw new IntegrationCryptoError("ENCRYPTION_KEY_INVALID");
  }
  return key;
}

export function hasIntegrationEncryptionKey(): boolean {
  try {
    getIntegrationKey();
    return true;
  } catch {
    return false;
  }
}

/** Encrypt a secret (webhook URL or bot token). Never log the input. */
export function encryptSecret(plaintext: string): string {
  const key = getIntegrationKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/** Decrypt a ciphertext produced by encryptSecret. */
export function decryptSecret(ciphertext: string): string {
  const key = getIntegrationKey();
  const parts = ciphertext.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Unsupported secret format.");
  }
  const iv = Buffer.from(parts[1], "hex");
  const tag = Buffer.from(parts[2], "hex");
  const data = Buffer.from(parts[3], "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
