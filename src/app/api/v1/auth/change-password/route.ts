/**
 * Versioned alias of /api/auth/change-password.
 *
 * Re-exports the handler from src/app/api/auth/change-password/route.ts so
 * the versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../auth/change-password/route";
