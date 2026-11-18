/**
 * Versioned alias of /api/comments/unread.
 *
 * Re-exports the handlers from src/app/api/comments/unread/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../comments/unread/route";
