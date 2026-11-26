/**
 * Web Push subscription payload validation (Zod).
 *
 * The browser PushSubscription JSON carries the endpoint URL and the two
 * keys the application server needs to encrypt for this device. Both keys
 * are base64url: p256dh is the 65-byte uncompressed P-256 public key,
 * auth is the 16-byte authentication secret (RFC 8291 section 3.2).
 */
import { z } from "zod";
import { fromBase64Url } from "@/lib/push/vapid";

function isBase64UrlBytes(value: string, length: number, firstByte?: number): boolean {
  try {
    const bytes = fromBase64Url(value);
    if (bytes.length !== length) return false;
    if (firstByte !== undefined && bytes[0] !== firstByte) return false;
    return true;
  } catch {
    return false;
  }
}

export const pushSubscriptionSchema = z.object({
  endpoint: z
    .string()
    .url()
    .refine((url) => url.startsWith("https://"), {
      message: "Endpoint must be an https URL.",
    }),
  keys: z.object({
    p256dh: z
      .string()
      .refine((v) => isBase64UrlBytes(v, 65, 0x04), {
        message: "p256dh must be a 65-byte uncompressed P-256 public key.",
      }),
    auth: z.string().refine((v) => isBase64UrlBytes(v, 16), {
      message: "auth must be a 16-byte secret.",
    }),
  }),
});

export type PushSubscriptionPayload = z.infer<typeof pushSubscriptionSchema>;

export const pushEndpointSchema = z.object({
  endpoint: z.string().url(),
});
