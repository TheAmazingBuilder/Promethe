/**
 * Versioned alias of /api/broker-sync/magic/[id].
 *
 * Re-exports the handlers from src/app/api/broker-sync/magic/[id]/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../../broker-sync/magic/[id]/route";
