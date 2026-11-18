/**
 * Versioned alias of /api/auth/logout.
 *
 * Re-exports the handlers from src/app/api/auth/logout/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../auth/logout/route";
