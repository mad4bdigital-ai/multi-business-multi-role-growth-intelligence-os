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

const readOnlyWorkflow = readFileSync("../.github/workflows/pr-generated-artifact-refresh.yml", "utf8");
const governedWriterWorkflow = readFileSync("../.github/workflows/governed-generated-artifact-refresh.yml", "utf8");
const governedWriterTool = readFileSync("scripts/maintenance-tools/generated-artifact-refresh.mjs", "utf8");

assert.match(
  readOnlyWorkflow,
  /head\.ref == github\.event\.repository\.default_branch[\s\S]*base\.ref == 'Production'/u,
  "read-only pull-request evaluation must permit only the default-branch to Production promotion path",
);
assert.match(readOnlyWorkflow, /EVENT_NAME: \$\{\{ github\.event_name \}\}/u);
assert.match(readOnlyWorkflow, /PR_BASE_REF: \$\{\{ github\.event\.pull_request\.base\.ref \|\| '' \}\}/u);
assert.match(readOnlyWorkflow, /elif \[\[ "\$\{TARGET_REF\}" == "\$\{DEFAULT_BRANCH\}" \]\]; then[\s\S]*PR_BASE_REF[\s\S]*Production/u);
assert.match(readOnlyWorkflow, /permissions:\s*\n\s*contents: read/u);
assert.match(readOnlyWorkflow, /persist-credentials: false/u);
assert.doesNotMatch(readOnlyWorkflow, /git push/u);

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
  cases: 20,
  protected_promotion_read_only: true,
  protected_writer_mutation: false,
  secrets_included: false,
}));
