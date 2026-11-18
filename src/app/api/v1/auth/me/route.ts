/**
 * Versioned alias of /api/auth/me.
 *
 * Re-exports the handlers from src/app/api/auth/me/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../auth/me/route";
