import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildRepositoryActionPlannerV4,
  buildRepositoryIntelligenceReportV3,
  classifyRepositoryPullRequestV2,
  normalizeGithubRepoRef,
  smokeSafeTenantId,
} from "./repositoryTenantIntelligenceV2.js";

const repoRef = normalizeGithubRepoRef({ resource_uri: "github://mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os" });
assert.equal(repoRef.owner, "mad4bdigital-ai");
assert.equal(repoRef.repo, "multi-business-multi-role-growth-intelligence-os");
assert.equal(repoRef.resource_uri, "github://mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os");

const longSmokeTenant = smokeSafeTenantId("repository_intelligence_v2_readiness_smoke_tenant_final_with_extra_length");
assert.equal(longSmokeTenant.startsWith("smoke_"), true);
assert.equal(longSmokeTenant.length <= 36, true);
assert.equal(smokeSafeTenantId(`${longSmokeTenant}_missing`).length <= 36, true);

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

const report = buildRepositoryIntelligenceReportV3({
  sweepResult: {
    resource_uri: repoRef.resource_uri,
    summary: { provider_calls_made: 3 },
    pull_requests: [
      { number: 10, title: "Docs agent: stale note", url: "https://example.test/pull/10", author: "docs-agent", ...docsPr },
      { number: 11, title: "Needs CI", url: "https://example.test/pull/11", author: "dev", ...ciMissingPr },
    ],
  },
  args: { state: "open", limit: 2, include_markdown: true },
  scope: { tenant_id: "tenant_test" },
  repoRef,
});
assert.equal(report.schema_version, "tenant_repository_intelligence_report.v3");
assert.equal(report.engine_version, "v3_read_only_decision_report");
assert.equal(report.summary.pr_count, 2);
assert.equal(report.summary.classifications.stale_docs_agent_only, 1);
assert.equal(report.summary.classifications.clean_but_ci_missing, 1);
assert.equal(report.summary.mutations_executed, false);
assert.match(report.markdown, /Repository Intelligence Decision Report/);
assert.equal(report.pull_request_evidence[0].mutations_allowed, false);

const planner = buildRepositoryActionPlannerV4(report);
assert.equal(planner.schema_version, "tenant_repository_action_planner.v4");
assert.equal(planner.mode, "dry_run_only");
assert.equal(planner.summary.planned_action_counts.close_superseded_dry_run, 1);
assert.equal(planner.summary.planned_action_counts.run_or_wait_for_ci_recommendation, 1);
assert.equal(planner.summary.mutations_executed, false);
assert.equal(planner.apply_allowed, false);
assert.equal(planner.next_gate, "approval_gated_mutations_v5_not_enabled");

const runtimeSource = readFileSync(new URL("./repositoryTenantIntelligenceV2.js", import.meta.url), "utf8");
assert.match(runtimeSource, /findUsableRepositoryProviderBinding/);
assert.match(runtimeSource, /repository_provider_binding_required/);
assert.match(runtimeSource, /status:'authorization_gated'/);
assert.match(runtimeSource, /source_system_id IS NOT NULL/);
assert.doesNotMatch(runtimeSource, /temporary repository intelligence v2 readiness smoke binding/);
console.log("repository tenant intelligence v2/v3/v4 tests passed");
