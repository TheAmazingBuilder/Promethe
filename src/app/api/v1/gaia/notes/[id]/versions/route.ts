/**
 * Versioned alias of /api/gaia/notes/[id]/versions.
 *
 * Re-exports the handlers from src/app/api/gaia/notes/[id]/versions/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../../../gaia/notes/[id]/versions/route";
