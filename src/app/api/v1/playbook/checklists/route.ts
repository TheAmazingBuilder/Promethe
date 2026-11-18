/**
 * Versioned alias of /api/playbook/checklists.
 *
 * Re-exports the handlers from src/app/api/playbook/checklists/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../playbook/checklists/route";
