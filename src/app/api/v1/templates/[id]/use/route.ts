/**
 * Versioned alias of /api/templates/[id]/use.
 *
 * Re-exports the handlers from src/app/api/templates/[id]/use/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../../templates/[id]/use/route";
