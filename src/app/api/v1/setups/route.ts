/**
 * Versioned alias of /api/setups.
 *
 * Re-exports the handlers from src/app/api/setups/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../setups/route";
