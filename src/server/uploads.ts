/**
 * Private screenshot storage backed by Supabase Storage.
 *
 * Objects are stored under:
 *   <userId>/<tradeId>/<screenshotId>.<ext>
 *
 * The bucket must remain private. All reads and deletes are performed by this
 * server module with the service-role key, only after a Prisma ownership check.
 * The service-role key must never be sent to the browser.
 */
import { createId } from "@/lib/id";
import { db } from "@/lib/db";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const DEFAULT_BUCKET = "trade-screenshots";

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

class UploadStorageError extends Error {
  readonly code = "STORAGE_UNAVAILABLE";
  readonly status = 503;

  constructor() {
    super("Screenshot storage is unavailable.");
    this.name = "UploadStorageError";
  }
}

export interface SavedUpload {
  id: string;
  label: string | null;
  caption: string | null;
  createdAt: string;
  url: string;
}

function storageConfig() {
  const baseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET;

  if (!baseUrl || !serviceKey) throw new UploadStorageError();

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new UploadStorageError();
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    throw new UploadStorageError();
  }

  return { baseUrl, serviceKey, bucket };
}

function objectUrl(baseUrl: string, bucket: string, objectPath: string) {
  const encodedBucket = encodeURIComponent(bucket);
  const encodedPath = objectPath
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${baseUrl}/storage/v1/object/${encodedBucket}/${encodedPath}`;
}

function normalizeStoragePath(storagePath: string) {
  // Compatibility for rows created by the former local-filesystem backend.
  return storagePath.replace(/^uploads\//, "");
}

async function storageRequest(
  objectPath: string,
  init: RequestInit = {}
): Promise<Response> {
  const { baseUrl, serviceKey, bucket } = storageConfig();
  try {
    return await fetch(objectUrl(baseUrl, bucket, objectPath), {
      ...init,
      cache: "no-store",
      headers: (() => {
        const headers = new Headers(init.headers);
        headers.set("apikey", serviceKey);
        headers.set("Authorization", `Bearer ${serviceKey}`);
        return headers;
      })(),
    });
  } catch {
    throw new UploadStorageError();
  }
}

async function removeStorageObject(objectPath: string): Promise<void> {
  const { baseUrl, serviceKey, bucket } = storageConfig();
  let response: Response;
  try {
    response = await fetch(
      `${baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}`,
      {
        method: "DELETE",
        cache: "no-store",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prefixes: [objectPath] }),
      }
    );
  } catch {
    throw new UploadStorageError();
  }

  // A missing object is already in the desired state.
  if (!response.ok && response.status !== 404) {
    throw new UploadStorageError();
  }
}

function hasValidImageSignature(buffer: Buffer, mime: string): boolean {
  if (mime === "image/png") {
    return (
      buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      )
    );
  }

  if (mime === "image/jpeg") {
    return (
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    );
  }

  if (mime === "image/webp") {
    return (
      buffer.length >= 12 &&
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP"
    );
  }

  return false;
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

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!hasValidImageSignature(buffer, file.type)) {
    throw new UploadValidationError("INVALID_IMAGE");
  }

  const id = createId();
  const fileName = `${id}.${ext}`;
  const storagePath = `${userId}/${tradeId}/${fileName}`;

  const uploadResponse = await storageRequest(storagePath, {
    method: "POST",
    headers: {
      "Content-Type": file.type,
      "Cache-Control": "private, max-age=0, no-store",
      "x-upsert": "false",
    },
    body: new Uint8Array(buffer),
  });

  if (!uploadResponse.ok) throw new UploadStorageError();

  try {
    const row = await db.tradeScreenshot.create({
      data: {
        id,
        tradeId,
        userId,
        storagePath,
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
  } catch (error) {
    await removeStorageObject(storagePath).catch(() => undefined);
    throw error;
  }
}

export async function readUpload(
  userId: string,
  id: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const row = await db.tradeScreenshot.findFirst({
    where: { id, userId },
  });
  if (!row) return null;

  const storagePath = normalizeStoragePath(row.storagePath);
  const response = await storageRequest(storagePath);

  if (response.status === 404) return null;
  if (!response.ok) throw new UploadStorageError();

  const ext = storagePath.split(".").pop() ?? "";
  const contentType = EXT_MIME[ext];
  if (!contentType) return null;

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType,
  };
}

export async function deleteUpload(userId: string, id: string): Promise<boolean> {
  const row = await db.tradeScreenshot.findFirst({ where: { id, userId } });
  if (!row) return false;

  await removeStorageObject(normalizeStoragePath(row.storagePath));
  await db.tradeScreenshot.deleteMany({ where: { id, userId } });
  return true;
}
