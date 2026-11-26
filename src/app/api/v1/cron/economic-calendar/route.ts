/**
 * Versioned alias of /api/cron/economic-calendar.
 *
 * Re-exports the handlers from src/app/api/cron/economic-calendar/route.ts
 * so the versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../cron/economic-calendar/route";
