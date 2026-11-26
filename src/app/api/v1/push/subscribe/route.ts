/**
 * Versioned alias of /api/push/subscribe.
 *
 * Re-exports the handlers from src/app/api/push/subscribe/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../push/subscribe/route";
