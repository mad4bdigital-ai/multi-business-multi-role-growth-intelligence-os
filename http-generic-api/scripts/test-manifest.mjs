import { testCommands as spec011Commands } from "./manifests/test-manifest-spec011.mjs";

const upstreamCommands = [
  "node test-managed-git-ephemeral-checkout-executor.mjs",
  "node scripts/test-managed-git-worker-lifecycle.mjs",
  "node test-operation-orchestrator-managed-workspace-dependency.mjs",
  "node test-managed-git-repository-credential-binding.mjs",
  "node test-operation-orchestrator-repository-credential.mjs",
];

// Some repository guards intentionally verify canonical manifest membership from
// this source file without executing imports. Keep these literals discoverable
// here while Set-based composition prevents duplicate runtime execution.
const staticDiscoveryCommands = [
  "node test-activation-surface-coverage-gate.mjs",
  "node test-capability-assurance-graph.mjs",
  "node test-database-lifecycle-incident-bridge.mjs",
  "node test-database-lifecycle-operational-status.mjs",
  "node test-database-lifecycle-scheduler-admin-aliases.mjs",
  "node test-database-lifecycle-scheduler-snapshot-runner.mjs",
  "node test-dynamic-capability-enforcement-shadow.mjs",
  "node test-dynamic-capability-projection-preview.mjs",
  "node test-dynamic-container-projection-apply-tool.mjs",
  "node test-frontend-surface-dispatch.mjs",
  "node test-github-list-issue-comments-endpoint.mjs",
  "node test-governed-migration-authorization-bootstrap.mjs",
  "node test-interruption-readiness.mjs",
  "node test-interruption-verification-recovery.mjs",
  "node test-phase10-status-observability-readiness-audit.mjs",
  "node test-repository-close-superseded-positive-smoke.mjs",
  "node test-status-database-lifecycle-component.mjs",
  "node test-supervisor-runtime-assurance-automation.mjs",
  "node test-tenant-blocked-capability-export-cleanup.mjs",
  "node test-tenant-blocked-tool-export-registry-cleanup.mjs",
  "node test-tenant-export-manifest-eligibility.mjs",
  "node test-tenant-tool-schema-strictness.mjs",
  "node test-test-manifest-runner.mjs",
];

export const testCommands = Object.freeze([
  ...new Set([...spec011Commands, ...upstreamCommands, ...staticDiscoveryCommands]),
]);
