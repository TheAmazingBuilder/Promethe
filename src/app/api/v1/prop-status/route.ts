/**
 * Versioned alias of /api/prop-status.
 *
 * Re-exports the handlers from src/app/api/prop-status/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../prop-status/route";
