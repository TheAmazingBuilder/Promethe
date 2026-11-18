/**
 * Versioned alias of /api/tool-scenarios/[id].
 *
 * Re-exports the handlers from src/app/api/tool-scenarios/[id]/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../tool-scenarios/[id]/route";
