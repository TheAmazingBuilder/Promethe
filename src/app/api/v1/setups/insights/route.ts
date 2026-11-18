/**
 * Versioned alias of /api/setups/insights.
 *
 * Re-exports the handlers from src/app/api/setups/insights/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../setups/insights/route";
