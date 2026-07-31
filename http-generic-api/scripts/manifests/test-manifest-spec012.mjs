// Spec 012 integrated Governed Policy & Operational Attention phase.
// Kept separate from the upstream and Spec 011 manifests to reduce overlap
// while preserving one canonical root test composition.
export const testCommands = Object.freeze([
  "node test-governed-policy-questionnaire-domain.mjs",
  "node test-governed-policy-application-lifecycle.mjs",
  "node test-governed-policy-repository-contract.mjs",
  "node test-governed-policy-migration-and-contracts.mjs",
]);
