/**
 * Versioned alias of /api/display-preferences.
 *
 * Re-exports the handlers from src/app/api/display-preferences/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../display-preferences/route";
