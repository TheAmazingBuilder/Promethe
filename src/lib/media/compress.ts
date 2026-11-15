/**
 * Client-side image compression (addendum §11.7 / v2 §4.1).
 *
 * Screenshots are resized to max 1600px and encoded as WebP q0.8 BEFORE
 * upload — respecting mobile data and the storage quota. Falls back to the
 * original blob when the browser cannot encode WebP.
 */
export interface CompressOptions {
  maxDimension?: number;
  quality?: number;
}

const DEFAULTS: Required<CompressOptions> = { maxDimension: 1600, quality: 0.8 };
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Downscale + re-encode an image blob to WebP (≤ maxDimension). */
export async function compressImage(
  input: Blob,
  options?: CompressOptions
): Promise<Blob> {
  const { maxDimension, quality } = { ...DEFAULTS, ...options };

  try {
    const bitmap = await createImageBitmap(input);
    const scale = Math.min(
      1,
      maxDimension / Math.max(bitmap.width, bitmap.height)
    );
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return input;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const compressed = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(
        (blob) => resolve(blob),
        "image/webp",
        quality
      );
    });

    if (!compressed) return input;
    // Never grow the file — keep whichever is smaller.
    return compressed.size < input.size ? compressed : input;
  } catch {
    return input;
  }
}

/** Read an image from the clipboard (one-tap screenshot paste). Returns null when unavailable. */
export async function readClipboardImage(): Promise<Blob | null> {
  try {
    if (!("clipboard" in navigator) || !navigator.clipboard.read) return null;
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith("image/"));
      if (type) return await item.getType(type);
    }
    return null;
  } catch {
    return null;
  }
}

export function looksLikeImage(blob: Blob): boolean {
  return (
    blob.type === "image/png" ||
    blob.type === "image/jpeg" ||
    blob.type === "image/webp"
  );
}
