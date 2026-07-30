import { testCommands as spec011Commands } from "./manifests/test-manifest-spec011.mjs";
import { testCommands as upstreamMainCommands } from "./manifests/test-manifest-upstream-main.mjs";

const upstreamCommands = [
  "node test-managed-git-ephemeral-checkout-executor.mjs",
  "node scripts/test-managed-git-worker-lifecycle.mjs",
  "node test-operation-orchestrator-managed-workspace-dependency.mjs",
  "node test-managed-git-repository-credential-binding.mjs",
  "node test-operation-orchestrator-repository-credential.mjs",
  "node test-delegation-grant-mariadb-readiness-collector.mjs",
  "node test-delegation-grant-mariadb-runtime-binding.mjs",
  "node test-execution-capsule-contract.mjs",
  "node test-managed-git-remote-transport-input-hardening.mjs",
];

// Some repository guards intentionally verify canonical manifest membership from
// this source file without executing imports. Keep these literals discoverable
// here while Set-based composition prevents duplicate runtime execution.
const staticDiscoveryCommands = [
  "node test-activation-followup-hardening.mjs",
  "node test-activation-surface-coverage-gate.mjs",
  "node test-capability-assurance-graph.mjs",
  "node test-database-lifecycle-incident-bridge.mjs",
  "node test-database-lifecycle-operational-status.mjs",
  "node test-database-lifecycle-scheduler-admin-aliases.mjs",
  "node test-database-lifecycle-scheduler-snapshot-runner.mjs",
  "node test-dynamic-capability-enforcement-shadow.mjs",
  "node test-dynamic-capability-projection-preview.mjs",
  "node test-dynamic-container-projection-apply-tool.mjs",
  "node test-dynamic-container-rollout-safety.mjs",
  "node test-f5-f6-positive-smoke-certification.mjs",
  "node test-frontend-operation-governance-generator.mjs",
  "node test-frontend-surface-dispatch.mjs",
  "node test-github-file-patch-plan-runtime.mjs",
  "node test-github-list-issue-comments-endpoint.mjs",
  "node test-github-pr-create-rest-fallback.mjs",
  "node test-governed-migration-authorization-bootstrap.mjs",
  "node test-hostinger-apply-policy-safe-field-names.mjs",
  "node test-hostinger-deploy-restart-tool-exports.mjs",
  "node test-hostinger-stored-credential-apply-policy.mjs",
  "node test-interruption-readiness.mjs",
  "node test-interruption-verification-recovery.mjs",
  "node test-phase10-status-observability-readiness-audit.mjs",
  "node test-phase12-verification-release-readiness.mjs",
  "node test-platform-engine-orchestration.mjs",
  "node test-platform-plugin-contract-docs.mjs",
  "node test-platform-resource-recipe-capability.mjs",
  "node test-registry-data-management-service.mjs",
  "node test-remaining-resource-capability-completion-gates.mjs",
  "node test-repository-close-superseded-positive-smoke.mjs",
  "node test-smoke-branch-cleanup-gate.mjs",
  "node test-status-database-lifecycle-component.mjs",
  "node test-supervisor-admin-tool-export-sync.mjs",
  "node test-supervisor-runtime-assurance-automation.mjs",
  "node test-tenant-blocked-capability-export-cleanup.mjs",
  "node test-tenant-blocked-tool-export-registry-cleanup.mjs",
  "node test-tenant-export-manifest-eligibility.mjs",
  "node test-tenant-tool-schema-strictness.mjs",
  "node test-test-manifest-runner.mjs",
  "node test-ticket-external-delivery-completion-certification.mjs",
  "node test-user-dashboard-dynamic-tabs-bridge.mjs",
];

export const testCommands = Object.freeze([
  ...new Set([
    ...spec011Commands,
    ...upstreamMainCommands,
    ...upstreamCommands,
    ...staticDiscoveryCommands,
  ]),
]);
