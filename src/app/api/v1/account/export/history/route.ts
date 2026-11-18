/**
 * Versioned alias of /api/account/export/history.
 *
 * Re-exports the handlers from src/app/api/account/export/history/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../../account/export/history/route";
