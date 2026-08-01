import assert from "node:assert/strict";
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
} = {}) {
  return {
    contract: "mad4b.pr-generated-artifact-refresh-summary.v1",
    identity: {
      candidate_kind: "head",
      candidate_sha: candidateSha,
      source_head_sha: sourceSha,
      head_ref: "gpt/example",
      base_ref: "main",
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

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.pr-generated-artifact-refresh-publisher-test.v1",
  cases: 7,
  secrets_included: false,
}));
