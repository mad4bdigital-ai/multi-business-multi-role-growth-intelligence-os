import assert from "node:assert/strict";

import {
  attachRepoMaintenanceCoordination,
  buildRepoMaintenanceCoordinationTelemetry,
} from "./scripts/repo-maintenance-coordination.mjs";

const telemetry = buildRepoMaintenanceCoordinationTelemetry({
  branch: "chore/repo-contract-auto-sync-test",
  changed_files: [
    "docs/surface-contract-discovery-status.md",
    "docs/surface-contract-discovery-status.md",
  ],
  repository_current_state: {
    base_sha: "a".repeat(40),
    branch_sha: "b".repeat(40),
  },
});

assert.equal(telemetry.ok, true);
assert.equal(telemetry.mode, "advisory");
assert.equal(telemetry.tool_key, "auto_sync_commit");
assert.equal(telemetry.should_block, false);
assert.equal(telemetry.summary.path_count, 1);
assert.deepEqual(telemetry.summary.policy_groups, ["documentation"]);
assert.equal(telemetry.secrets_included, false);

const report = attachRepoMaintenanceCoordination({
  ok: true,
  mode: "write",
  changed_files: ["docs/surface-contract-discovery-status.md"],
  changed_count: 1,
}, {
  changed_files: ["docs/surface-contract-discovery-status.md"],
});

assert.equal(report.repository_coordination.action, "allow_with_path_claim");
assert.equal(report.repository_coordination.should_block, false);
assert.deepEqual(report.repository_coordination.policy_groups, ["documentation"]);

console.log("repo maintenance coordination telemetry ok");
