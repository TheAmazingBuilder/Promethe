/**
 * Versioned alias of /api/ingest/mt.
 *
 * Re-exports the handlers from src/app/api/ingest/mt/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../ingest/mt/route";
