/**
 * Collision-resistant ids for files and other non-Prisma-managed entities.
 * cuid-style: timestamp + random, URL-safe.
 */
import { randomBytes } from "node:crypto";

export function createId(): string {
  return `${Date.now().toString(36)}${randomBytes(8).toString("hex")}`;
}
