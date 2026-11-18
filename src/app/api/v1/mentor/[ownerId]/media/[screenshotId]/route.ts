/**
 * Versioned alias of /api/mentor/[ownerId]/media/[screenshotId].
 *
 * Re-exports the handlers from src/app/api/mentor/[ownerId]/media/[screenshotId]/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../../../mentor/[ownerId]/media/[screenshotId]/route";
