import assert from "node:assert/strict";
import {
  decideRepositoryCoordination,
  overlapPaths,
  repositoryPathPolicy,
  summarizeCoordinationDecision,
} from "./repositoryCoordinationPlane.js";

assert.equal(repositoryPathPolicy("docs/work-maps/README.md").policy, "generated_file_regenerate");
assert.equal(repositoryPathPolicy("docs/auto-docs-agent/pr-2019.md").group, "generated_docs");
assert.equal(repositoryPathPolicy("http-generic-api/scripts/test-manifest.mjs").policy, "ordered_unique_list_merge");
assert.equal(repositoryPathPolicy("http-generic-api/migrations/20260721_additive.sql").policy, "additive_governed_migration");
assert.equal(repositoryPathPolicy("http-generic-api/routes/gptToolsRoutes.js").group, "runtime_source");
assert.deepEqual(overlapPaths(["a/b.js", "docs/work-maps/README.md"], ["docs/work-maps/**"]), ["docs/work-maps/README.md"]);

const branch = "gpt/example";
const otherLease = {
  lease_id: "lease-1",
  branch,
  holder_run_id: "other-run",
  holder_actor_id: "docs-agent",
  lease_mode: "path_scoped_write",
  paths: ["docs/work-maps/**"],
  status: "active",
  expires_at: "2999-01-01T00:00:00Z",
};

assert.equal(decideRepositoryCoordination({
  intent: { branch, operation_type: "docs_agent_commit", paths: ["docs/work-maps/README.md"], operation_id: "run-1" },
  active_leases: [otherLease],
}).action, "defer");

assert.equal(decideRepositoryCoordination({
  intent: { branch, operation_type: "repo_patch_apply", paths: ["http-generic-api/scripts/test-manifest.mjs"], operation_id: "run-1" },
  active_leases: [{ ...otherLease, paths: ["http-generic-api/scripts/test-manifest.mjs"] }],
}).action, "merge_with_policy");

assert.equal(decideRepositoryCoordination({
  mode: "soft_guard",
  intent: { branch, operation_type: "repo_patch_apply", paths: ["http-generic-api/routes/gptToolsRoutes.js"], operation_id: "run-1" },
  active_leases: [{ ...otherLease, paths: ["http-generic-api/routes/gptToolsRoutes.js"] }],
}).action, "deny_conflict");

assert.equal(decideRepositoryCoordination({
  intent: { branch, operation_type: "repo_patch_apply", paths: ["http-generic-api/routes/gptToolsRoutes.js"], operation_id: "run-1" },
  active_leases: [{ ...otherLease, paths: ["docs/work-maps/**"] }],
}).action, "allow_with_path_claim");

assert.equal(decideRepositoryCoordination({
  intent: { branch, operation_type: "migration_apply", paths: ["http-generic-api/migrations/20260721_additive.sql"], operation_id: "run-1" },
}).action, "requires_exclusive_lease");

assert.equal(decideRepositoryCoordination({
  intent: { branch, operation_type: "repo_patch_apply", paths: ["http-generic-api/routes/gptToolsRoutes.js"], base_sha: "a".repeat(40), branch_sha: "b".repeat(40) },
  current_state: { base_sha: "c".repeat(40), branch_sha: "b".repeat(40) },
}).action, "reclassify");

assert.equal(decideRepositoryCoordination({
  intent: { branch, operation_type: "repo_patch_apply", paths: ["http-generic-api/routes/gptToolsRoutes.js"] },
  current_state: { unknown_provider_outcome: true, same_cycle_readback_verified: false },
}).action, "requires_readback");

const summary = summarizeCoordinationDecision(decideRepositoryCoordination({
  intent: { branch, operation_type: "repo_patch_apply", paths: ["http-generic-api/routes/gptToolsRoutes.js"] },
}));
assert.equal(summary.action, "allow_with_path_claim");
assert.equal(summary.secrets_included, false);
console.log("repository coordination plane tests passed");
