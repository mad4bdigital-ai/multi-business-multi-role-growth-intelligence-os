import assert from "node:assert/strict";
import {
  assertGeneratedArtifactPrIdentity,
  normalizeGeneratedArtifactEvidence,
} from "./generated-artifact-refresh-pr-publisher.mjs";

const sourceHeadSha = "1".repeat(40);
const generatedHeadSha = "2".repeat(40);

function report({ candidateSha = sourceHeadSha, generatedSha = null, outcome = "passed", sourceSha = sourceHeadSha } = {}) {
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
    first_failure: outcome === "passed" ? null : { code: "verify_auth_parity_failed" },
    generated_artifacts: {
      commit_sha: generatedSha,
      changed_files: generatedSha ? ["http-generic-api/frontend-surface-dispatch.generated.json"] : [],
    },
    secrets_included: false,
  };
}

{
  const evidence = normalizeGeneratedArtifactEvidence({
    report: report(),
    workflowConclusion: "success",
    workflowRunId: 10,
    sourceHeadSha,
  });
  assert.equal(evidence.candidateSha, sourceHeadSha);
  assert.equal(evidence.detail, "generated artifacts already current");
}

{
  const generatedReport = report({ candidateSha: generatedHeadSha, generatedSha: generatedHeadSha });
  const evidence = normalizeGeneratedArtifactEvidence({
    report: generatedReport,
    workflowConclusion: "success",
    workflowRunId: 11,
    sourceHeadSha,
  });
  assert.equal(evidence.candidateSha, generatedHeadSha);
  assert.equal(evidence.sourceHeadSha, sourceHeadSha);
  assert.match(evidence.detail, new RegExp(generatedHeadSha));
  assert.equal(assertGeneratedArtifactPrIdentity({ state: "open", head: { ref: "gpt/example", sha: generatedHeadSha } }, evidence, generatedReport, "gpt/example"), true);
}

assert.throws(() => normalizeGeneratedArtifactEvidence({
  report: report({ sourceSha: "3".repeat(40) }),
  workflowConclusion: "success",
  workflowRunId: 12,
  sourceHeadSha,
}), /source head/u);

assert.throws(() => normalizeGeneratedArtifactEvidence({
  report: report({ candidateSha: generatedHeadSha, generatedSha: "3".repeat(40) }),
  workflowConclusion: "success",
  workflowRunId: 13,
  sourceHeadSha,
}), /Generated commit/u);

assert.throws(() => normalizeGeneratedArtifactEvidence({
  report: report({ outcome: "blocked" }),
  workflowConclusion: "success",
  workflowRunId: 14,
  sourceHeadSha,
}), /Successful workflow/u);

{
  const generatedReport = report({ candidateSha: generatedHeadSha, generatedSha: generatedHeadSha });
  const evidence = normalizeGeneratedArtifactEvidence({
    report: generatedReport,
    workflowConclusion: "success",
    workflowRunId: 15,
    sourceHeadSha,
  });
  assert.throws(() => assertGeneratedArtifactPrIdentity(
    { state: "open", head: { ref: "gpt/example", sha: sourceHeadSha } },
    evidence,
    generatedReport,
    "gpt/example",
  ), /current PR head/iu);
}

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.pr-generated-artifact-refresh-publisher-test.v1",
  cases: 6,
  secrets_included: false,
}));
