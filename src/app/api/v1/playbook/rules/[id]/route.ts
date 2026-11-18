/**
 * Versioned alias of /api/playbook/rules/[id].
 *
 * Re-exports the handlers from src/app/api/playbook/rules/[id]/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../../playbook/rules/[id]/route";
