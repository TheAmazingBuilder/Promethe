/**
 * Versioned alias of /api/auth/sessions.
 *
 * Re-exports the handler from src/app/api/auth/sessions/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../auth/sessions/route";
