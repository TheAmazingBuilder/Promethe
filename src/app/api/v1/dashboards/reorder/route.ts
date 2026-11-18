/**
 * Versioned alias of /api/dashboards/reorder.
 *
 * Re-exports the handlers from src/app/api/dashboards/reorder/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../dashboards/reorder/route";
