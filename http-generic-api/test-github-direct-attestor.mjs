import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  validateEvidence, validateReview, validateChecks, validateCandidate, statusTarget
} from "../.github/scripts/github-direct-attestor.mjs";

const head = "a".repeat(40), base = "b".repeat(40), candidate = "c".repeat(40), run = 42;
const identity = { pr_number: 8493, source_head_sha: head, base_sha: base,
  merge_candidate_sha: candidate, executed_sha: candidate, source_run_id: run };
const evidence = {
  identity,
  report: { contract: "mad4b.repository-derived-state-closure.v2",
    candidate_sha: candidate, converged: true, blocking_stale_or_failed_artifact_count: 0 },
  finalizer: { contract: "mad4b.repository-governance-evidence-finalizer.v2",
    merge_candidate_sha: candidate, converged: true, failed_or_missing_required_ids: [] },
  objections: { contract: "mad4b.repository-policy-objections.v1",
    candidate_sha: candidate, source_head_sha: head, blocking_count: 0, manual_count: 0,
    activation_count: 0, merge_allowed_by_source_policy: true, automerge_allowed: false },
  owner: { ok: true, exact_head_sha: head, mode: "single_owner_attestation" },
  environment: { converged: true, issue_count: 0 },
};
const exact = { pr: 8493, head, base, candidate, run };
const copy = v => JSON.parse(JSON.stringify(v));
function rejected(fn, tag) { assert.throws(fn, e => e.message.includes(tag), tag); }
assert.equal(validateEvidence(evidence, exact), true);
assert.equal(statusTarget("main", head, candidate), head);
assert.equal(statusTarget("Production", head, candidate), candidate);
for (const [file, field, value] of [
  ["identity", "source_head_sha", "f".repeat(40)],
  ["identity", "base_sha", "f".repeat(40)],
  ["identity", "merge_candidate_sha", "f".repeat(40)],
  ["identity", "source_run_id", 43],
  ["report", "converged", false],
  ["report", "blocking_stale_or_failed_artifact_count", 1],
  ["finalizer", "converged", false],
  ["objections", "blocking_count", 1],
  ["objections", "manual_count", 1],
  ["objections", "automerge_allowed", true],
  ["objections", "activation_count", 1],
  ["objections", "source_head_sha", "f".repeat(40)],
  ["owner", "ok", false],
  ["owner", "exact_head_sha", "f".repeat(40)],
  ["environment", "issue_count", 2],
]) {
  const v = copy(evidence); v[file][field] = value;
  rejected(() => validateEvidence(v, exact), "DIRECT_ATTESTOR_BLOCKED");
}
const owner = "mad4bdigital-ai";
const review = { state: "COMMENTED", commit_id: head, user: { login: owner },
  body: "OWNER_ATTEST_SINGLE_OWNER\nexact_head_sha: " + head };
assert.equal(validateReview([review], owner, owner, head), true);
for (const bad of [
  { body: "NOT APPROVED\nOWNER_ATTEST_SINGLE_OWNER\nexact_head_sha: " + head },
  { body: "OWNER_ATTEST_SINGLE_OWNER\nexact_head_sha: " + base },
  { commit_id: base },
  { state: "DISMISSED" },
  { user: { login: "attacker" } }
]) rejected(() => validateReview([{ ...review, ...bad }], owner, owner, head), "exact_head_owner_review_missing");
rejected(() => validateReview([review], owner, "different-author", head), "single_owner_author_eligibility_missing");
const checks = ["Syntax Check","Unit & Integration Tests","Policy Objection Gate","Single Owner Review Gate"]
  .map(name => ({ name, status: "completed", conclusion: "success", app: { slug: "github-actions" } }));
assert.equal(validateChecks(checks), true);
for (const name of checks.map(v => v.name)) {
  rejected(() => validateChecks(checks.filter(v => v.name !== name)), "required_check_not_successful:" + name);
}
rejected(() => validateChecks(checks.map(v => ({ ...v, app: { slug: "attacker" } }))), "required_check_not_successful");
assert.equal(validateCandidate([], { total_count: 0 }, []), true);
rejected(() => validateCandidate([{ context: "other", state: "success" }], { total_count: 0 }, []), "merge_candidate_status_conflict");
rejected(() => validateCandidate([], { total_count: 1 }, []), "merge_candidate_check_run_conflict");
rejected(() => validateCandidate([], { total_count: 0 }, [{ context: "Derived State Closure" }]), "existing_head_attestation_conflict");
const wf = readFileSync("../.github/workflows/github-direct-attestor.yml", "utf8");
assert.match(wf, /workflow_dispatch:/);
assert.match(wf, /Governance-Direct/);
assert.match(wf, /DIRECT_GITHUB_APP_PRIVATE_KEY/);
assert.match(wf, /DIRECT_ATTEST_AND_MERGE/);
assert.match(wf, /REPO_AUTOSYNC_TOKEN/);
assert.match(wf, /--match-head-commit "\$HEAD"/);
assert.doesNotMatch(wf, /gh pr merge[^\n]*--admin/);
assert.doesNotMatch(wf, /pull_request_target:/);
assert.doesNotMatch(wf, /@?actions\/create-github-app-token@main/);
assert.doesNotMatch(wf, /BACKEND_API_KEY|auth\.mad4b\.com/);
const src = readFileSync("../.github/scripts/github-direct-attestor.mjs", "utf8");
assert.match(src, /DIRECT_ATTESTOR_ENABLED === "enabled"/);
assert.match(src, /installToken\(repo, appId, key\)/);
assert.match(src, /"\/statuses\/" \+ head/);
assert.doesNotMatch(src, /"\/statuses\/" \+ candidate, "POST"/);
console.log("MAD4B_GITHUB_DIRECT_ATTESTOR_TESTS: PASS");
