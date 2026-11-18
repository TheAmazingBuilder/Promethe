/**
 * Versioned alias of /api/reconciliation/bulk-merge.
 *
 * Re-exports the handlers from src/app/api/reconciliation/bulk-merge/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../reconciliation/bulk-merge/route";
