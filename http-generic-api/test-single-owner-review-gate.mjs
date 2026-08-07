import assert from "node:assert/strict";
import fs from "node:fs";
import { evaluateReviewGate, singleOwnerAttestationContract } from "./scripts/single-owner-review-gate.mjs";

const sha = "a".repeat(40);
const prNumber = 6605;
const owner = "mad4bdigital-ai";
const soleHuman = "repository-owner";
const admin = { login: soleHuman, type: "User", permissions: { admin: true, maintain: true, push: true } };
const attestation = singleOwnerAttestationContract(prNumber, sha);
const attestationBody = [
  attestation.token,
  attestation.exact_head_line,
  attestation.reviewed_line,
  attestation.evidence_line,
  attestation.authorization_line,
].join("\n");

assert.equal(attestation.token, `OWNER_ATTEST_SINGLE_OWNER_PR_${prNumber}_${sha.slice(0, 12)}`);

{
  const result = evaluateReviewGate({
    prNumber,
    owner,
    author: soleHuman,
    headSha: sha,
    collaborators: [admin],
    reviews: [{
      user: { login: soleHuman },
      state: "COMMENTED",
      commit_id: sha,
      submitted_at: "2026-08-07T00:00:00Z",
      body: attestationBody,
    }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.mode, "single_owner_attestation");
  assert.equal(result.required_attestation, null);
}

{
  const result = evaluateReviewGate({
    prNumber,
    owner,
    author: soleHuman,
    headSha: sha,
    collaborators: [admin],
    reviews: [{
      user: { login: soleHuman },
      state: "COMMENTED",
      commit_id: sha,
      submitted_at: "2026-08-07T00:00:00Z",
      body: `OWNER_ATTEST_SINGLE_OWNER\nexact_head_sha: ${sha}`,
    }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "single_owner_exact_head_attestation_missing");
  assert.equal(result.required_attestation.token, attestation.token);
}

{
  const result = evaluateReviewGate({
    prNumber,
    owner,
    author: soleHuman,
    headSha: sha,
    collaborators: [admin],
    reviews: [{
      user: { login: soleHuman },
      state: "COMMENTED",
      commit_id: sha,
      submitted_at: "2026-08-07T00:00:00Z",
      body: [attestation.token, attestation.exact_head_line, attestation.reviewed_line, attestation.evidence_line].join("\n"),
    }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.required_attestation.authorization_line, "authorizes_ready_merge_for_exact_sha: true");
}

{
  const result = evaluateReviewGate({
    prNumber,
    owner,
    author: soleHuman,
    headSha: sha,
    collaborators: [admin],
    reviews: [{
      user: { login: soleHuman },
      state: "COMMENTED",
      commit_id: "b".repeat(40),
      submitted_at: "2026-08-07T00:00:00Z",
      body: attestationBody,
    }],
  });
  assert.equal(result.ok, false);
}

{
  const reviewer = { login: "reviewer", type: "User", permissions: { push: true } };
  const result = evaluateReviewGate({
    prNumber,
    owner,
    author: soleHuman,
    headSha: sha,
    collaborators: [admin, reviewer],
    reviews: [{
      user: { login: soleHuman },
      state: "COMMENTED",
      commit_id: sha,
      submitted_at: "2026-08-07T00:00:00Z",
      body: attestationBody,
    }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.mode, "independent_approval");
}

{
  const reviewer = { login: "reviewer", type: "User", permissions: { push: true } };
  const result = evaluateReviewGate({
    prNumber,
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
    prNumber,
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
  assert.match(gateSource, /OWNER_ATTEST_SINGLE_OWNER_PR_/);
  assert.match(gateSource, /authorizes_ready_merge_for_exact_sha: true/);
  assert.match(gateSource, /Pagination safety bound exceeded/);
  assert.doesNotMatch(gateSource, /\/check-runs/);
  assert.doesNotMatch(gateSource, /method:\s*["']POST["']/);
  assert.match(workflowSource, /pull_request_target:/);
  assert.doesNotMatch(workflowSource, /^  pull_request:/m);
  assert.match(workflowSource, /ref: main/);
  assert.doesNotMatch(workflowSource, /pull_request\.head\.sha \|\| github\.sha/);
  assert.doesNotMatch(workflowSource, /checks:\s*write/);
  assert.doesNotMatch(workflowSource, /permissions:\s*write-all/);
  assert.match(workflowSource, /jobs:\n  evaluate:\n    name: Single Owner Review Gate/);
}

console.log(JSON.stringify({ ok: true, test: "single_owner_review_gate", secrets_included: false }));
