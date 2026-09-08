import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReleaseCutPromotionEvidence,
  resolveReusedBuilderRunId,
} from "../scripts/production-promotion-release-cut-evidence.mjs";

const sha = (digit) => String(digit).repeat(40);
const digest = "a".repeat(64);
const candidateSha = sha(4);
const requestHeadSha = sha(5);
const requestHeadBranch = "release/production-sync-request-test";
const builderRunId = "12345";

function exactInput(builderRun = builderRunId) {
  return {
    review_mode: "ai_policy",
    request_pr: "7300",
    release_pr: "7301",
    validation_pr: "7302",
    release_cut_sha: sha(1),
    current_main_sha: sha(1),
    production_sha: sha(3),
    candidate_sha: candidateSha,
    builder_run_id: builderRun,
    certified_validation_run_id: "101",
    gate_registry_sha256: digest,
    supporting_runs: { staging_live_certification: "200" },
  };
}

function snapshot({ artifact = {}, run = {}, request = {} } = {}) {
  const exactArtifact = {
    id: 98765,
    name: `production-promotion-candidate-${candidateSha}`,
    expired: false,
    workflow_run: {
      id: Number(builderRunId),
      head_sha: requestHeadSha,
      head_branch: requestHeadBranch,
    },
    ...artifact,
  };
  const exactRun = {
    id: Number(builderRunId),
    path: ".github/workflows/production-promotion-candidate.yml",
    event: "workflow_dispatch",
    status: "completed",
    conclusion: "success",
    head_sha: requestHeadSha,
    head_branch: requestHeadBranch,
    ...run,
  };
  return {
    input: exactInput("reused"),
    requestPull: {
      head: {
        sha: requestHeadSha,
        ref: requestHeadBranch,
        ...request,
      },
    },
    artifacts: { artifacts: [exactArtifact] },
    runsById: { [builderRunId]: exactRun },
  };
}

test("reused builder provenance resolves the exact successful candidate builder run", () => {
  assert.equal(resolveReusedBuilderRunId(snapshot()), builderRunId);
});

test("reused builder provenance fails closed when the candidate artifact is expired", () => {
  assert.throws(
    () => resolveReusedBuilderRunId(snapshot({ artifact: { expired: true } })),
    /no exact successful candidate builder provenance/u,
  );
});

test("reused builder provenance fails closed when the builder run failed", () => {
  assert.throws(
    () => resolveReusedBuilderRunId(snapshot({ run: { conclusion: "failure" } })),
    /no exact successful candidate builder provenance/u,
  );
});

test("reused builder provenance fails closed for the wrong workflow path", () => {
  assert.throws(
    () => resolveReusedBuilderRunId(snapshot({ run: { path: ".github/workflows/other.yml" } })),
    /no exact successful candidate builder provenance/u,
  );
});

test("reused builder provenance fails closed when request head identity differs", () => {
  assert.throws(
    () => resolveReusedBuilderRunId(snapshot({ request: { sha: sha(6) } })),
    /no exact successful candidate builder provenance/u,
  );
});

test("release-cut evidence schema remains strict and numeric for builder provenance", () => {
  assert.equal(buildReleaseCutPromotionEvidence(exactInput()).builder_run_id, builderRunId);
  assert.throws(
    () => buildReleaseCutPromotionEvidence(exactInput("reused")),
    /builder_run_id is invalid/u,
  );
});
