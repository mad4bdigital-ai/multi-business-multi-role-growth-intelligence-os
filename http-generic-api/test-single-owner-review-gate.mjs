import assert from "node:assert/strict";
import fs from "node:fs";
import { evaluateReviewGate } from "./scripts/single-owner-review-gate.mjs";

const sha = "a".repeat(40);
const owner = "mad4bdigital-ai";
const soleHuman = "repository-owner";
const admin = { login: soleHuman, type: "User", permissions: { admin: true, maintain: true, push: true } };

{
  const result = evaluateReviewGate({
    owner,
    author: soleHuman,
    headSha: sha,
    collaborators: [admin],
    reviews: [{
      user: { login: soleHuman },
      state: "COMMENTED",
      commit_id: sha,
      submitted_at: "2026-08-07T00:00:00Z",
      body: `OWNER_ATTEST_SINGLE_OWNER
exact_head_sha: ${sha}`,
    }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.mode, "single_owner_attestation");
}
{
  const result = evaluateReviewGate({
    owner,
    author: soleHuman,
    headSha: sha,
    collaborators: [admin],
    reviews: [{
      user: { login: soleHuman },
      state: "COMMENTED",
      commit_id: "b".repeat(40),
      submitted_at: "2026-08-07T00:00:00Z",
      body: `OWNER_ATTEST_SINGLE_OWNER
exact_head_sha: ${sha}`,
    }],
  });
  assert.equal(result.ok, false);
}
{
  const reviewer = { login: "reviewer", type: "User", permissions: { push: true } };
  const result = evaluateReviewGate({
    owner,
    author: soleHuman,
    headSha: sha,
    collaborators: [admin, reviewer],
    reviews: [{
      user: { login: soleHuman },
      state: "COMMENTED",
      commit_id: sha,
      submitted_at: "2026-08-07T00:00:00Z",
      body: `OWNER_ATTEST_SINGLE_OWNER
exact_head_sha: ${sha}`,
    }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.mode, "independent_approval");
}
{
  const reviewer = { login: "reviewer", type: "User", permissions: { push: true } };
  const result = evaluateReviewGate({
    owner,
    author: soleHuman,
    headSha: sha,
    collaborators: [admin, reviewer],
    reviews: [{
      user: { login: "reviewer" },
      state: "APPROVED",
      commit_id: sha,
      submitted_at: "2026-08-07T00:00:00Z",
      body: "approved",
    }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.mode, "independent_approval");
}


{
  const result = evaluateReviewGate({
    owner,
    author: "automation-bot",
    headSha: sha,
    collaborators: [admin],
    reviews: [{
      user: { login: soleHuman },
      state: "APPROVED",
      commit_id: sha,
      submitted_at: "2026-08-07T00:00:00Z",
      body: "approved",
    }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.mode, "independent_approval");
}

{
  const gateSource = fs.readFileSync(new URL("./scripts/single-owner-review-gate.mjs", import.meta.url), "utf8");
  const workflowSource = fs.readFileSync(new URL("../.github/workflows/single-owner-review-gate.yml", import.meta.url), "utf8");
  assert.match(gateSource, /collaborators\?affiliation=all/);
  assert.doesNotMatch(gateSource, /collaborators\?affiliation=direct/);
  assert.match(gateSource, /Pagination safety bound exceeded/);
  assert.match(workflowSource, /pull_request_target:/);
  assert.doesNotMatch(workflowSource, /^  pull_request:/m);
  assert.match(workflowSource, /ref: main/);
  assert.doesNotMatch(workflowSource, /pull_request\.head\.sha \|\| github\.sha/);
}

console.log(JSON.stringify({ ok: true, test: "single_owner_review_gate", secrets_included: false }));
