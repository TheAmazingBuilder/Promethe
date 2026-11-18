/**
 * Versioned alias of /api/custom-fields.
 *
 * Re-exports the handlers from src/app/api/custom-fields/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../custom-fields/route";
