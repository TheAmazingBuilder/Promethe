/**
 * Versioned alias of /api/playbook/rules/install-examples.
 *
 * Re-exports the handlers from src/app/api/playbook/rules/install-examples/route.ts so the
 * versioned surface (/api/v1/...) and the unversioned path stay
 * identical. The implementation lives in the unversioned file;
 * do not edit handlers here.
 */
export * from "../../../../playbook/rules/install-examples/route";
