/**
 * Versioned alias of /api/integrations/[id].
 *
 * Re-exports the handlers from src/app/api/integrations/[id]/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../integrations/[id]/route";
