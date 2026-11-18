/**
 * Versioned alias of /api/calendar/year.
 *
 * Re-exports the handlers from src/app/api/calendar/year/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../calendar/year/route";
