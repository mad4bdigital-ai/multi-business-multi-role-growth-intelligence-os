import assert from "node:assert/strict";
import {
  analyzeRepoConflict,
  buildConflictCaseStudy,
  buildPrAutomationPreview,
  buildRepoConflictResolutionDryRun,
  buildTenantConflictResolutionDryRun,
} from "./repoConflictIntelligenceService.js";

const generatedInput = {
  base: "main",
  head: "gpt/example",
  pull_number: 2474,
  compare: { mergeable: false, mergeable_state: "dirty" },
  commits: [{ sha: "abc", author: { login: "docs-agent[bot]" }, message: "generated work map" }],
  files: [
    { filename: "docs/auto-docs-agent/pr-2474.md", status: "conflicting", conflicted: true },
    { filename: "docs/work-maps/generated.json", status: "modified" },
    { filename: "http-generic-api/routes/index.js", status: "modified" },
  ],
};

const analysis = analyzeRepoConflict(generatedInput);
const dryRun = buildRepoConflictResolutionDryRun({ ...generatedInput, analysis });
assert.equal(dryRun.ok, true);
assert.equal(dryRun.mode, "dry_run");
assert.equal(dryRun.execution_allowed, false);
assert.equal(dryRun.provider_write, false);
assert.equal(dryRun.recommended_path, "clean_branch_replay");
assert.ok(dryRun.operations.some((operation) => operation.type === "exclude_generated_artifact"));
assert.ok(dryRun.operations.some((operation) => operation.type === "semantic_patch_preview"));
assert.equal(dryRun.secrets_included, false);

const manualDryRun = buildRepoConflictResolutionDryRun({
  compare: { mergeable: false, mergeable_state: "dirty" },
  files: [{ filename: "src/auth/session.js", status: "conflicting", conflicted: true }],
});
assert.equal(manualDryRun.classification, "manual_review_required");
assert.equal(manualDryRun.resolution_status, "blocked_manual_review");
assert.equal(manualDryRun.execution_allowed, false);

const automation = buildPrAutomationPreview(generatedInput);
assert.equal(automation.comment_required, true);
assert.equal(automation.provider_write, false);
assert.equal(automation.approval_hold_required, true);
assert.match(automation.comment.markdown, /clean_branch_replay/);
assert.match(automation.comment.markdown, /PR #2474/);
assert.equal(automation.secrets_included, false);

const tenant = buildTenantConflictResolutionDryRun(generatedInput);
assert.equal(tenant.scope, "tenant");
assert.equal(tenant.execution_allowed, false);
assert.equal(tenant.provider_write, false);
assert.deepEqual(tenant.safe_next_actions, ["request_admin_resolution"]);

const caseStudy = buildConflictCaseStudy("pr_2474_generated_docs_conflict");
assert.equal(caseStudy.ok, true);
assert.equal(caseStudy.case_key, "pr_2474_generated_docs_conflict");
assert.equal(caseStudy.analysis.classification, "dirty_generated_docs_conflict");
assert.equal(caseStudy.dry_run.execution_allowed, false);
assert.equal(caseStudy.automation_preview.provider_write, false);

console.log("repo conflict intelligence phase two tests passed");
