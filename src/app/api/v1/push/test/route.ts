/**
 * Versioned alias of /api/push/test.
 *
 * Re-exports the handlers from src/app/api/push/test/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../push/test/route";
