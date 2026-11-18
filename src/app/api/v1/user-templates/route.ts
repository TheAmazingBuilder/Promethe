/**
 * Versioned alias of /api/user-templates.
 *
 * Re-exports the handlers from src/app/api/user-templates/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../user-templates/route";
