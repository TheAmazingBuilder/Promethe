/**
 * Versioned alias of /api/import/batches/[id]/rows.
 *
 * Re-exports the handlers from src/app/api/import/batches/[id]/rows/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../../../import/batches/[id]/rows/route";
