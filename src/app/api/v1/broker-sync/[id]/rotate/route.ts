/**
 * Versioned alias of /api/broker-sync/[id]/rotate.
 *
 * Re-exports the handlers from src/app/api/broker-sync/[id]/rotate/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../../broker-sync/[id]/rotate/route";
