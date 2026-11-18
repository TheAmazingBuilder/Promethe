/**
 * Versioned alias of /api/cron/integrations.
 *
 * Re-exports the handlers from src/app/api/cron/integrations/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../cron/integrations/route";
