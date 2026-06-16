import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  REPOSITORY_ADVISORY_COMMENT_V5_GATE,
  REPOSITORY_ADVISORY_COMMENT_V5_SCHEMA,
  buildRepositoryAdvisoryCommentPreviewV5,
  selectRepositoryAdvisoryCommentType,
} from "./repositoryTenantAdvisoryCommentsV5.js";
import { normalizeGithubRepoRef } from "./repositoryTenantIntelligenceV2.js";

function sha256(value = "") {
  return createHash("sha256").update(String(value)).digest("hex");
}

const repoRef = normalizeGithubRepoRef({ resource_uri: "github://mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os" });

assert.equal(selectRepositoryAdvisoryCommentType({ planned_action: "run_or_wait_for_ci_recommendation" }), "ci_wait_advisory");
assert.equal(selectRepositoryAdvisoryCommentType({ classification: "duplicate_migration_conflict" }), "migration_conflict_advisory");
assert.equal(selectRepositoryAdvisoryCommentType({ classification: "stale_docs_agent_only" }), "stale_docs_agent_advisory");
assert.equal(selectRepositoryAdvisoryCommentType({ planned_action: "block_merge_manual_fix_plan" }), "unsafe_to_merge_advisory");
assert.equal(selectRepositoryAdvisoryCommentType({ classification: "unknown" }), "manual_review_advisory");

const preview = buildRepositoryAdvisoryCommentPreviewV5({
  repoRef,
  plan_id: "11111111-1111-4111-8111-111111111111",
  plan: {
    pr_number: 99,
    title: "Needs CI",
    classification: "clean_but_ci_missing",
    planned_action: "run_or_wait_for_ci_recommendation",
  },
  source_report_evidence_id: "22222222-2222-4222-8222-222222222222",
  source_planner_evidence_id: "33333333-3333-4333-8333-333333333333",
});

assert.equal(preview.schema_version, REPOSITORY_ADVISORY_COMMENT_V5_SCHEMA);
assert.equal(preview.engine_version, "v5_approval_gated_advisory_comment");
assert.equal(preview.mode, "approval_gated_comment_preview");
assert.equal(preview.planned_comment_type, "ci_wait_advisory");
assert.equal(preview.requires_approval, true);
assert.equal(preview.allowed_action, REPOSITORY_ADVISORY_COMMENT_V5_GATE);
assert.equal(preview.apply_allowed, false);
assert.equal(preview.mutations_executed, false);
assert.equal(preview.secrets_included, false);
assert.match(preview.comment_preview_markdown, /repository-intelligence-advisory:v5/);
assert.match(preview.comment_preview_markdown, /Mutation boundary: no close, no label, no merge, no file patch, no force-push, and no migration apply\./);
assert.equal(sha256(preview.comment_preview_markdown), preview.comment_preview_sha256);
for (const forbidden of ["close", "label", "merge", "patch", "force_push", "migration_apply"]) {
  assert.ok(preview.forbidden_mutations.includes(forbidden));
}

const runtimeSource = readFileSync(new URL("./repositoryTenantAdvisoryCommentsV5.js", import.meta.url), "utf8");
assert.match(runtimeSource, /findUsableRepositoryProviderBinding/);
assert.match(runtimeSource, /repository_advisory_comment_v5_authorization_gated/);
assert.doesNotMatch(runtimeSource, /temporary repository advisory comment v5 readiness smoke binding/);
console.log("repository advisory comments v5 tests passed");
