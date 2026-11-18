/**
 * Versioned alias of /api/goals/[id].
 *
 * Re-exports the handlers from src/app/api/goals/[id]/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../goals/[id]/route";
