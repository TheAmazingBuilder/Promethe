/**
 * Versioned alias of /api/playbook/templates/instantiate.
 *
 * Re-exports the handlers from src/app/api/playbook/templates/instantiate/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../../playbook/templates/instantiate/route";
