/**
 * Versioned alias of /api/charts/benchmarks/[id].
 *
 * Re-exports the handlers from src/app/api/charts/benchmarks/[id]/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../../charts/benchmarks/[id]/route";
