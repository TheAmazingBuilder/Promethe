/**
 * Versioned alias of /api/dashboards/[id]/apply-template.
 *
 * Re-exports the handlers from src/app/api/dashboards/[id]/apply-template/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../../dashboards/[id]/apply-template/route";
