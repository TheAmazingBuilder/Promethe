/**
 * Versioned alias of /api/templates.
 *
 * Re-exports the handlers from src/app/api/templates/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../templates/route";
