/**
 * Versioned alias of /api/gaia/folders/[id].
 *
 * Re-exports the handlers from src/app/api/gaia/folders/[id]/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../../gaia/folders/[id]/route";
