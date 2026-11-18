/**
 * Versioned alias of /api/mentor.
 *
 * Re-exports the handlers from src/app/api/mentor/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../mentor/route";
