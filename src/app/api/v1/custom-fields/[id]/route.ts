/**
 * Versioned alias of /api/custom-fields/[id].
 *
 * Re-exports the handlers from src/app/api/custom-fields/[id]/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../custom-fields/[id]/route";
