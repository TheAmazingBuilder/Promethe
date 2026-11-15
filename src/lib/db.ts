import { PrismaClient } from "@prisma/client";
import { softDeleteExtension } from "@/lib/trash/extension";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/**
 * Shared Prisma client — wrapped with the soft-delete extension (v2.5
 * Module 4 §4.6): every default read of trade / journalEntry / strategy /
 * tag excludes rows with `deletedAt` set; the trash module and the
 * import/sync dedupe opt in via `withDeleted()`.
 *
 * The extension is query-only (no result-shape change), so the extended
 * client is safely assignable to PrismaClient — one documented cast here
 * instead of touching every importer.
 */
function createDb(): PrismaClient {
  const base = new PrismaClient({
    // Query logging is useful in dev; tests keep a quiet output.
    log: process.env.VITEST ? ["error"] : ["query"],
  });
  return base.$extends(softDeleteExtension) as unknown as PrismaClient;
}

export const db = globalForPrisma.prisma ?? createDb()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db
