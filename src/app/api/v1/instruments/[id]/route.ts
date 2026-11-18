/**
 * Versioned alias of /api/instruments/[id].
 *
 * Re-exports the handlers from src/app/api/instruments/[id]/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../instruments/[id]/route";
