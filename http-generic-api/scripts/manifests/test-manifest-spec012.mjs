// Spec 012 integrated Governed Policy & Operational Attention phase.
// Kept separate from the upstream and Spec 011 manifests to reduce overlap
// while preserving one canonical root test composition.
export const testCommands = Object.freeze([
  "node test-context-kernel-hardcoding-proof-aware-ratchet.mjs",
  "node test-governed-policy-questionnaire-domain.mjs",
  "node test-governed-policy-application-lifecycle.mjs",
  "node test-governed-policy-repository-contract.mjs",
  "node test-governed-policy-migration-and-contracts.mjs",
  "node test-spec012-policy-closeout-and-t026-readiness.mjs",
  "node test-spec012-task-ledger-reconciliation.mjs",
  "node test-spec012-t009-data-governance-readiness.mjs",
  "node test-spec012-t007a-t029d-slo-baseline-readiness.mjs",
  "node test-spec012-t030-oauth-correlation-foundation.mjs",
  "node test-spec012-t031-oauth-code-consumption-foundation.mjs",
  "node test-spec012-t031-oauth-token-route-wiring.mjs",
  "node test-execution-capsule-mutation-and-rollout.mjs",
]);
