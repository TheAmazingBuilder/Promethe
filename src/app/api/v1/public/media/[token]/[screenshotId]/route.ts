/**
 * Versioned alias of /api/public/media/[token]/[screenshotId].
 *
 * Re-exports the handlers from src/app/api/public/media/[token]/[screenshotId]/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../../../public/media/[token]/[screenshotId]/route";
