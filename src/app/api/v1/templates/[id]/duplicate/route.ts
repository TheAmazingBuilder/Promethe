/**
 * Versioned alias of /api/templates/[id]/duplicate.
 *
 * Re-exports the handlers from src/app/api/templates/[id]/duplicate/route.ts
 * so the versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../../templates/[id]/duplicate/route";
