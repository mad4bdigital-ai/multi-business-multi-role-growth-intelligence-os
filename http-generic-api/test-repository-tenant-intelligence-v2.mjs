import assert from "node:assert/strict";

import {
  classifyRepositoryPullRequestV2,
  normalizeGithubRepoRef,
  smokeSafeTenantId,
} from "./repositoryTenantIntelligenceV2.js";

const repoRef = normalizeGithubRepoRef({ resource_uri: "github://mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os" });
assert.equal(repoRef.owner, "mad4bdigital-ai");
assert.equal(repoRef.repo, "multi-business-multi-role-growth-intelligence-os");
assert.equal(repoRef.resource_uri, "github://mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os");

const docsPr = classifyRepositoryPullRequestV2({
  number: 1,
  title: "Docs agent: impact note for abc123",
  head_ref_name: "docs-agent/abc123",
  evidence: { changed_files: [{ filename: "docs/auto-docs-agent/pr-1.md" }], check_runs: [] },
});
assert.equal(docsPr.classification_v2, "stale_docs_agent_only");
assert.equal(docsPr.deep_signals.docs_agent_branch, true);
assert.equal(docsPr.deep_signals.docs_agent_only_files, true);
assert.equal(docsPr.recommended_action_v2, "review_docs_agent_backlog_or_close_manually");

const migrationConflictPr = classifyRepositoryPullRequestV2({
  number: 2,
  title: "Add duplicate migrations",
  head: { ref: "gpt/migration-conflict" },
  merge_state_status: "clean",
  changed_files: [
    { filename: "http-generic-api/migrations/900_sprint68_a.sql" },
    { filename: "http-generic-api/migrations/900_sprint68_b.sql" },
  ],
  check_runs: [{ name: "CI", status: "completed", conclusion: "success" }],
});
assert.equal(migrationConflictPr.classification_v2, "duplicate_migration_conflict");
assert.deepEqual(migrationConflictPr.deep_signals.duplicate_migration_numbers, ["900"]);
assert.equal(migrationConflictPr.deep_signals.mutations_allowed, false);

const ciMissingPr = classifyRepositoryPullRequestV2({
  number: 3,
  title: "Feature",
  head: { ref: "gpt/feature" },
  merge_state_status: "clean",
  changed_files: [{ filename: "http-generic-api/feature.js" }],
  check_runs: [],
});
assert.equal(ciMissingPr.classification_v2, "clean_but_ci_missing");
assert.equal(ciMissingPr.recommended_action_v2, "run_or_wait_for_ci");

const readyPr = classifyRepositoryPullRequestV2({
  number: 4,
  title: "Ready",
  head: { ref: "gpt/ready" },
  merge_state_status: "clean",
  changed_files: [{ filename: "http-generic-api/ready.js" }],
  check_runs: [{ name: "CI", status: "completed", conclusion: "success" }],
});
assert.equal(readyPr.classification_v2, "merge_ready");
assert.equal(readyPr.recommended_action_v2, "review_and_merge_manually_if_policy_allows");

console.log("repository tenant intelligence v2 tests passed");
