import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertGeneratedArtifactPrIdentity,
  normalizeGeneratedArtifactEvidence,
} from "./generated-artifact-refresh-pr-publisher.mjs";

const sourceHeadSha = "1".repeat(40);
const otherSha = "2".repeat(40);

function report({
  candidateSha = sourceHeadSha,
  sourceSha = sourceHeadSha,
  outcome = "passed",
  commitSha = null,
  repositoryMutationPerformed = false,
  headRef = "gpt/example",
  baseRef = "main",
} = {}) {
  return {
    contract: "mad4b.pr-generated-artifact-refresh-summary.v1",
    identity: {
      candidate_kind: "head",
      candidate_sha: candidateSha,
      source_head_sha: sourceSha,
      head_ref: headRef,
      base_ref: baseRef,
    },
    outcome,
    first_failure: outcome === "passed" ? null : { code: "generated_artifact_drift_detected" },
    generated_artifacts: {
      commit_sha: commitSha,
      changed_files: outcome === "passed" ? [] : ["http-generic-api/frontend-surface-dispatch.generated.json"],
      repository_mutation_performed: repositoryMutationPerformed,
    },
    secrets_included: false,
  };
}

const evidence = normalizeGeneratedArtifactEvidence({
  report: report(),
  workflowConclusion: "success",
  workflowRunId: 10,
  sourceHeadSha,
});
assert.equal(evidence.candidateSha, sourceHeadSha);
assert.equal(evidence.sourceHeadSha, sourceHeadSha);
assert.equal(evidence.detail, "generated artifacts current");
assert.equal(
  assertGeneratedArtifactPrIdentity(
    { state: "open", head: { ref: "gpt/example", sha: sourceHeadSha } },
    evidence,
    "gpt/example",
  ),
  true,
);

const protectedPromotionEvidence = normalizeGeneratedArtifactEvidence({
  report: report({ headRef: "main", baseRef: "Production" }),
  workflowConclusion: "success",
  workflowRunId: 16,
  sourceHeadSha,
});
assert.equal(
  assertGeneratedArtifactPrIdentity(
    { state: "open", head: { ref: "main", sha: sourceHeadSha }, base: { ref: "Production" } },
    protectedPromotionEvidence,
    "main",
  ),
  true,
);

assert.throws(() => normalizeGeneratedArtifactEvidence({
  report: report({ sourceSha: otherSha }),
  workflowConclusion: "success",
  workflowRunId: 11,
  sourceHeadSha,
}), /source head/u);

assert.throws(() => normalizeGeneratedArtifactEvidence({
  report: report({ candidateSha: otherSha }),
  workflowConclusion: "success",
  workflowRunId: 12,
  sourceHeadSha,
}), /candidate must equal source head/u);

assert.throws(() => normalizeGeneratedArtifactEvidence({
  report: report({ commitSha: otherSha }),
  workflowConclusion: "success",
  workflowRunId: 13,
  sourceHeadSha,
}), /may not report a generated commit/u);

assert.throws(() => normalizeGeneratedArtifactEvidence({
  report: report({ repositoryMutationPerformed: true }),
  workflowConclusion: "success",
  workflowRunId: 14,
  sourceHeadSha,
}), /repository_mutation_performed=false/u);

assert.throws(() => normalizeGeneratedArtifactEvidence({
  report: report({ outcome: "blocked" }),
  workflowConclusion: "success",
  workflowRunId: 15,
  sourceHeadSha,
}), /Successful workflow/u);

assert.throws(() => assertGeneratedArtifactPrIdentity(
  { state: "open", head: { ref: "gpt/example", sha: otherSha } },
  evidence,
  "gpt/example",
), /current PR head/iu);

const workBranchReadOnlyWorkflow = readFileSync("../.github/workflows/pr-generated-artifact-refresh.yml", "utf8");
const protectedPromotionReadOnlyWorkflow = readFileSync("../.github/workflows/production-promotion-generated-artifact-evidence.yml", "utf8");
const evidencePublisherWorkflow = readFileSync("../.github/workflows/ci-evidence-pr-publisher.yml", "utf8");
const evidenceRoutingPolicy = JSON.parse(readFileSync("../.github/ci-evidence-routing.json", "utf8"));
const governedWriterWorkflow = readFileSync("../.github/workflows/governed-generated-artifact-refresh.yml", "utf8");
const governedWriterTool = readFileSync("scripts/maintenance-tools/generated-artifact-refresh.mjs", "utf8");

assert.match(
  workBranchReadOnlyWorkflow,
  /branches-ignore:[\s\S]*- Production/u,
  "the work-branch evaluator must not compete with the dedicated Production promotion workflow",
);
assert.match(workBranchReadOnlyWorkflow, /^name: PR Generated Artifact Refresh$/mu);
assert.match(workBranchReadOnlyWorkflow, /startsWith\(github\.event\.pull_request\.head\.ref, 'gpt\/'\)/u);
assert.match(workBranchReadOnlyWorkflow, /startsWith\(github\.event\.pull_request\.head\.ref, 'cert\/'\)/u);
assert.match(workBranchReadOnlyWorkflow, /permissions:\s*\n\s*contents: read/u);
assert.match(workBranchReadOnlyWorkflow, /persist-credentials: false/u);
assert.doesNotMatch(workBranchReadOnlyWorkflow, /contents: write/u);
assert.doesNotMatch(workBranchReadOnlyWorkflow, /git push/u);
assert.match(
  workBranchReadOnlyWorkflow,
  /\.github\/workflows\/production-promotion-generated-artifact-evidence\.yml/u,
  "the work-branch evaluator must track the uniquely pathed Production evaluator",
);
assert.doesNotMatch(
  workBranchReadOnlyWorkflow,
  /\.github\/workflows\/protected-promotion-generated-artifact-refresh\.yml/u,
  "the retired workflow path must not remain in the governed trigger set",
);

assert.match(
  protectedPromotionReadOnlyWorkflow,
  /pull_request:[\s\S]*branches:[\s\S]*- Production/u,
  "the dedicated evaluator must be registered for Production-target pull requests",
);
assert.match(protectedPromotionReadOnlyWorkflow, /^name: Protected Promotion Generated Artifact Refresh$/mu);
assert.doesNotMatch(protectedPromotionReadOnlyWorkflow, /^name: PR Generated Artifact Refresh$/mu);
assert.doesNotMatch(protectedPromotionReadOnlyWorkflow, /workflow_dispatch:/u);
assert.match(
  protectedPromotionReadOnlyWorkflow,
  /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/u,
);
assert.match(protectedPromotionReadOnlyWorkflow, /github\.event\.pull_request\.base\.ref/u);
assert.match(protectedPromotionReadOnlyWorkflow, /PR_BASE_REF[\s\S]*Production/u);
assert.match(protectedPromotionReadOnlyWorkflow, /CI_SOURCE_HEAD_SHA/u);
assert.match(protectedPromotionReadOnlyWorkflow, /persist-credentials: false/u);
assert.match(protectedPromotionReadOnlyWorkflow, /permissions:\s*\n\s*contents: read/u);
assert.doesNotMatch(protectedPromotionReadOnlyWorkflow, /contents: write/u);
assert.doesNotMatch(protectedPromotionReadOnlyWorkflow, /git push/u);
assert.match(
  protectedPromotionReadOnlyWorkflow,
  /pr-generated-artifact-refresh-\$\{\{ github\.run_id \}\}-summary/u,
);
assert.match(
  protectedPromotionReadOnlyWorkflow,
  /mad4b\.pr-generated-artifact-refresh-summary\.v1/u,
);

assert.match(evidencePublisherWorkflow, /- PR Generated Artifact Refresh/u);
assert.match(evidencePublisherWorkflow, /- Protected Promotion Generated Artifact Refresh/u);
assert.match(
  evidencePublisherWorkflow,
  /github\.event\.workflow_run\.name == 'PR Generated Artifact Refresh' \|\|[\s\S]*github\.event\.workflow_run\.name == 'Protected Promotion Generated Artifact Refresh'/u,
);
assert.match(
  evidencePublisherWorkflow,
  /"PR Generated Artifact Refresh"\|"Protected Promotion Generated Artifact Refresh"\)/u,
);

assert.deepEqual(
  evidenceRoutingPolicy.pr_evidence_publisher.generated_artifact_workflow_aliases,
  ["PR Generated Artifact Refresh", "Protected Promotion Generated Artifact Refresh"],
);
for (const workflow of evidenceRoutingPolicy.pr_evidence_publisher.generated_artifact_workflow_aliases) {
  const route = evidenceRoutingPolicy.routes.find((entry) => entry.workflow === workflow);
  assert.ok(route, `missing generated-artifact evidence route for ${workflow}`);
  assert.equal(route.canonical_contract, "mad4b.pr-generated-artifact-refresh-summary.v1");
  assert.equal(route.candidate_kind, "head");
}

assert.match(governedWriterWorkflow, /on:\s*\n\s*workflow_dispatch:/u);
assert.doesNotMatch(governedWriterWorkflow, /pull_request:/u);
assert.match(governedWriterWorkflow, /TARGET_REF" == "main" \|\| "\$TARGET_REF" == "Production"/u);
assert.match(governedWriterWorkflow, /EXPECTED_HEAD_SHA/u);
assert.match(governedWriterWorkflow, /APPLY_GENERATED_ARTIFACT_REFRESH/u);
assert.doesNotMatch(governedWriterWorkflow, /--force|force-with-lease/u);

assert.match(governedWriterTool, /new Set\(\["main", "Production"\]\)/u);
assert.match(governedWriterTool, /expected_head_sha_mismatch_before_push/u);
assert.match(governedWriterTool, /generated_artifact_write_set_violation/u);
assert.match(governedWriterTool, /git", \["push", "origin", `HEAD:\$\{args\.target_ref\}`\]/u);
assert.doesNotMatch(governedWriterTool, /--force|force-with-lease/u);

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.pr-generated-artifact-refresh-publisher-test.v1",
  cases: 40,
  work_branch_evaluator_excludes_production: true,
  protected_promotion_unique_workflow_name: true,
  protected_promotion_unique_workflow_path: true,
  protected_promotion_read_only: true,
  publisher_alias_routing: true,
  protected_writer_mutation: false,
  secrets_included: false,
}));
