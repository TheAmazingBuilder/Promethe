/**
 * Versioned alias of /api/profile/handle.
 *
 * Re-exports the handlers from src/app/api/profile/handle/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../profile/handle/route";
