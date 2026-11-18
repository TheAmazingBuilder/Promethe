/**
 * Versioned alias of /api/accounts/health.
 *
 * Re-exports the handler from src/app/api/accounts/health/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../accounts/health/route";
