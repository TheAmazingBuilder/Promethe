/**
 * Versioned alias of /api/risk-reward/summary.
 *
 * Re-exports the handlers from src/app/api/risk-reward/summary/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../risk-reward/summary/route";
