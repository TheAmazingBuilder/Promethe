/**
 * Screenshot storage — local filesystem equivalent of Supabase Storage in the
 * sandbox: uploads/{userId}/{tradeId}/{id}.{ext}, served ONLY through the
 * ownership-checked /api/v1/uploads/[id] route (never as static files).
 *
 * Client-side compression (max 1600px, WebP q0.8) happens BEFORE the upload
 * (addendum §11.7) — the server enforces type + size limits as defense in depth.
 */
import { createId } from "@/lib/id";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";

export const UPLOAD_ROOT = path.join(process.cwd(), "uploads");

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

export class UploadValidationError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 422) {
    super(code);
    this.name = "UploadValidationError";
    this.code = code;
    this.status = status;
  }
}

export interface SavedUpload {
  id: string;
  label: string | null;
  caption: string | null;
  createdAt: string;
  url: string;
}

export async function saveUpload(
  userId: string,
  tradeId: string,
  file: File,
  label: string | null,
  caption: string | null
): Promise<SavedUpload> {
  const trade = await db.trade.findFirst({
    where: { id: tradeId, userId },
    select: { id: true },
  });
  if (!trade) throw new UploadValidationError("TRADE_NOT_FOUND", 422);

  const ext = MIME_EXT[file.type];
  if (!ext) throw new UploadValidationError("UNSUPPORTED_TYPE");
  if (file.size <= 0 || file.size > MAX_BYTES) {
    throw new UploadValidationError("FILE_TOO_LARGE");
  }

  const id = createId();
  const dir = path.join(UPLOAD_ROOT, userId, tradeId);
  const fileName = `${id}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, fileName), buffer);

  const row = await db.tradeScreenshot.create({
    data: {
      id,
      tradeId,
      userId,
      storagePath: path.posix.join(userId, tradeId, fileName),
      label,
      caption,
    },
  });

  return {
    id: row.id,
    label: row.label,
    caption: row.caption,
    createdAt: row.createdAt.toISOString(),
    url: `/api/v1/uploads/${row.id}`,
  };
}

export async function readUpload(
  userId: string,
  id: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const row = await db.tradeScreenshot.findFirst({
    where: { id, userId },
  });
  if (!row) return null;
  const ext = row.storagePath.split(".").pop() ?? "";
  const contentType = EXT_MIME[ext] ?? "application/octet-stream";
  try {
    const buffer = await readFile(path.join(UPLOAD_ROOT, row.storagePath));
    return { buffer, contentType };
  } catch {
    return null;
  }
}

export async function deleteUpload(userId: string, id: string): Promise<boolean> {
  const row = await db.tradeScreenshot.findFirst({ where: { id, userId } });
  if (!row) return false;
  await db.tradeScreenshot.deleteMany({ where: { id, userId } });
  await unlink(path.join(UPLOAD_ROOT, row.storagePath)).catch(() => undefined);
  return true;
}
