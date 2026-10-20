import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateEvidence, validateReview, validateChecks, validateCandidate, statusTarget } from "../.github/scripts/github-direct-attestor.mjs";
import { GOVERNANCE_ATTESTATION_CONTEXTS, GITHUB_REPOSITORY_GOVERNANCE_ATTESTATION_VERSION, readGithubRepositoryGovernanceAttestationContract, runGithubRepositoryGovernanceAttestation } from "./githubRepositoryGovernanceAttestation.js";
const OWNER = "mad4bdigital-ai", REPO = "multi-business-multi-role-growth-intelligence-os";
const HEAD = "a".repeat(40), BASE = "b".repeat(40), CANDIDATE = "c".repeat(40), TREE = "e".repeat(40), EVIDENCE = "d".repeat(64), CREATOR = 991, RUN_ID = 321;
const SOURCE = Object.freeze({
  main: { path: ".github/workflows/derived-state-closure.yml", event: "pull_request", artifact: `derived-state-closure-${RUN_ID}` },
  Production: { path: ".github/workflows/governed-production-promotion-request-launcher.yml", event: "workflow_dispatch", artifact: `governed-production-promotion-convergence-${RUN_ID}` },
});
// Runtime protocol preflight must expose capability without any status write.
const preflight = readGithubRepositoryGovernanceAttestationContract();
assert.equal(GITHUB_REPOSITORY_GOVERNANCE_ATTESTATION_VERSION, "github-repository-governance-attestation-v4");
assert.equal(preflight.contract, GITHUB_REPOSITORY_GOVERNANCE_ATTESTATION_VERSION);
assert.equal(preflight.mode, "preflight");
assert.equal(preflight.candidate_same_cycle_readback_supported, true);
assert.equal(preflight.main_exact_head_status_supported, true);
assert.equal(preflight.native_status_provider, "installed_github_app");
assert.deepEqual(preflight.supported_branches, ["main", "Production"]);
assert.equal(preflight.mutation_executed, false);
assert.equal(preflight.secrets_included, false);
assert.equal(Object.keys(preflight).some((key) => /token|password|credential|private[_-]?key/i.test(key)), false);
const protectedRoutes = readFileSync(new URL("./routes/repositoryAutomationRoutes.js", import.meta.url), "utf8");
assert.match(protectedRoutes, /router\.get\("\/admin\/repository-automation\/attestor-contract", \.\.\.requireAdmin/);
assert.match(protectedRoutes, /readGithubRepositoryGovernanceAttestationContract\(\)/);

function response(status, payload) { return { ok: status >= 200 && status < 300, status, async json() { return payload; } }; }
function mockFetch({ branch = "main", candidate = CANDIDATE, tree = TREE, runConclusion = "success", sourcePath = SOURCE[branch].path, sourceEvent = SOURCE[branch].event, artifactDigest = EVIDENCE, artifactName = SOURCE[branch].artifact, runPr = 7437, runRepository = `${OWNER}/${REPO}`, headStatusSpoof = false, headWriteReject = false, headPrDriftBefore = false, headPrDriftAfter = false } = {}) {
  const calls = [];
  let pullReads = 0;
  let headPublished = false;
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url), method = String(options.method || "GET").toUpperCase(), path = parsed.pathname + parsed.search;
    calls.push({ method, path, body: options.body ? JSON.parse(options.body) : null });
    if (path === `/repos/${OWNER}/${REPO}/actions/runs/${RUN_ID}` && method === "GET") return response(200, {
      id: RUN_ID,
      status: "completed",
      conclusion: runConclusion,
      path: sourcePath,
      event: sourceEvent,
      head_sha: HEAD,
      repository: { full_name: runRepository },
      head_repository: { full_name: runRepository },
      pull_requests: sourceEvent === "pull_request" ? [{ number: runPr }] : [],
    });
    if (path === `/repos/${OWNER}/${REPO}/actions/runs/${RUN_ID}/artifacts?per_page=100` && method === "GET") return response(200, { artifacts: [{ id: 555, name: artifactName, expired: false, digest: `sha256:${artifactDigest}`, workflow_run: { id: RUN_ID } }] });
    if (path === `/repos/${OWNER}/${REPO}/pulls/7437` && method === "GET") {
      pullReads += 1;
      const changed = (headPrDriftBefore && pullReads >= 3) || (headPrDriftAfter && headPublished);
      return response(200, { state: "open", draft: false, base: { ref: branch, sha: BASE }, head: { sha: HEAD, repo: { full_name: `${OWNER}/${REPO}` } }, merge_commit_sha: changed ? "f".repeat(40) : candidate });
    }
    if (branch === "Production" && path === `/repos/${OWNER}/${REPO}/git/commits/${CANDIDATE}` && method === "GET") return response(200, { sha: CANDIDATE, tree: { sha: tree } });
    if (branch === "Production" && path === `/repos/${OWNER}/${REPO}/git/commits/${HEAD}` && method === "GET") return response(200, { sha: HEAD, tree: { sha: TREE } });
    if (path === `/repos/${OWNER}/${REPO}/statuses/${CANDIDATE}` && method === "POST") { const body = JSON.parse(options.body || "{}"); return response(201, { id: 1234, sha: CANDIDATE, state: body.state, context: body.context, creator: { id: CREATOR } }); }
    if (path === `/repos/${OWNER}/${REPO}/commits/${CANDIDATE}/statuses?per_page=100` && method === "GET") return response(200, [{ id: 1234, sha: CANDIDATE, state: "success", context: GOVERNANCE_ATTESTATION_CONTEXTS[branch].context, creator: { id: CREATOR } }]);
    if (branch === "main" && path === `/repos/${OWNER}/${REPO}/statuses/${HEAD}` && method === "POST") {
      if (headWriteReject) return response(403, { message: "Forbidden" });
      headPublished = true;
      const body = JSON.parse(options.body || "{}");
      return response(201, { id: 2345, sha: HEAD, state: body.state, context: body.context, creator: { id: CREATOR } });
    }
    if (branch === "main" && path === `/repos/${OWNER}/${REPO}/commits/${HEAD}/statuses?per_page=100` && method === "GET") return response(200, [{ id: headStatusSpoof ? 9999 : 2345, sha: HEAD, state: "success", context: GOVERNANCE_ATTESTATION_CONTEXTS[branch].context, creator: { id: CREATOR } }]);
    throw new Error(`Unhandled ${method} ${path}`);
  };
  return { fetchImpl, calls };
}
function input(branch = "main") { return { mode: "attest", owner: OWNER, repo: REPO, default_branch: branch, pr_number: 7437, source_head_sha: HEAD, base_sha: BASE, candidate_sha: CANDIDATE, executed_sha: branch === "main" ? CANDIDATE : HEAD, evidence_sha256: EVIDENCE, source_run_id: RUN_ID, confirm: GOVERNANCE_ATTESTATION_CONTEXTS[branch].confirm }; }
function deps(fetchImpl) { return { token: "injected-test-token", fetchImpl, auth: { caller_type: "admin", user_id: "admin-1" } }; }
async function expectCode(promise, code) { await assert.rejects(promise, (error) => error?.code === code); }
const previousAppId = process.env.GITHUB_APP_ID; process.env.GITHUB_APP_ID = "777";
try {
  for (const branch of ["main", "Production"]) {
    const mock = mockFetch({ branch });
    const result = await runGithubRepositoryGovernanceAttestation(input(branch), deps(mock.fetchImpl));
    assert.equal(result.branch, branch); assert.equal(result.context, GOVERNANCE_ATTESTATION_CONTEXTS[branch].context); assert.equal(result.same_cycle_readback_proven, true); assert.equal(result.app_id, 777); assert.equal(result.secrets_included, false);
    assert.equal(result.source_provenance.run_id, RUN_ID); assert.equal(result.source_provenance.artifact_id, 555); assert.equal(result.source_provenance.artifact_digest_sha256, EVIDENCE);
    if (branch === "main") {
      assert.equal(result.executed_relation, "executed_is_merge_candidate");
      assert.equal(result.status_id, 1234);
      assert.equal(result.head_status_id, 2345);
      assert.equal(result.head_status_creator_id, CREATOR);
      assert.equal(result.native_required_head_status_proven, true);
      assert.deepEqual(mock.calls.filter(c => c.method === "POST").map(c => c.path), [`/repos/${OWNER}/${REPO}/statuses/${CANDIDATE}`, `/repos/${OWNER}/${REPO}/statuses/${HEAD}`]);
    }
    else {
      assert.equal(result.head_status_id, null);
      assert.equal(result.native_required_head_status_proven, false); assert.equal(result.executed_relation, "executed_source_tree_equals_merge_candidate_tree"); assert.equal(result.candidate_tree_sha, TREE); assert.equal(result.executed_tree_sha, TREE); }
  }
  { const mock = mockFetch(); await expectCode(runGithubRepositoryGovernanceAttestation({ ...input("main"), repo: "other-repo" }, deps(mock.fetchImpl)), "github_governance_attestation_repository_binding_mismatch"); assert.equal(mock.calls.length, 0); }
  { const mock = mockFetch({ sourcePath: ".github/workflows/ci.yml" }); await expectCode(runGithubRepositoryGovernanceAttestation(input("main"), deps(mock.fetchImpl)), "github_governance_attestation_source_workflow_mismatch"); assert.equal(mock.calls.some((call) => call.method === "POST"), false); }
  { const mock = mockFetch({ runConclusion: "failure" }); await expectCode(runGithubRepositoryGovernanceAttestation(input("main"), deps(mock.fetchImpl)), "github_governance_attestation_source_run_not_successful"); assert.equal(mock.calls.some((call) => call.method === "POST"), false); }
  { const mock = mockFetch({ runPr: 9999 }); await expectCode(runGithubRepositoryGovernanceAttestation(input("main"), deps(mock.fetchImpl)), "github_governance_attestation_source_pr_mismatch"); assert.equal(mock.calls.some((call) => call.method === "POST"), false); }
  { const mock = mockFetch({ artifactDigest: "f".repeat(64) }); await expectCode(runGithubRepositoryGovernanceAttestation(input("main"), deps(mock.fetchImpl)), "github_governance_attestation_source_artifact_digest_mismatch"); assert.equal(mock.calls.some((call) => call.method === "POST"), false); }
  { const mock = mockFetch({ artifactName: "untrusted-artifact" }); await expectCode(runGithubRepositoryGovernanceAttestation(input("main"), deps(mock.fetchImpl)), "github_governance_attestation_source_artifact_ambiguous"); assert.equal(mock.calls.some((call) => call.method === "POST"), false); }
  { const mock = mockFetch({ candidate: "f".repeat(40) }); await expectCode(runGithubRepositoryGovernanceAttestation(input("main"), deps(mock.fetchImpl)), "github_governance_attestation_merge_candidate_drift"); assert.equal(mock.calls.some((call) => call.method === "POST"), false); }
  { const mock = mockFetch({ branch: "Production", tree: "f".repeat(40) }); await expectCode(runGithubRepositoryGovernanceAttestation(input("Production"), deps(mock.fetchImpl)), "github_governance_attestation_candidate_tree_mismatch"); assert.equal(mock.calls.some((call) => call.method === "POST"), false); }
  { const mock = mockFetch({ headStatusSpoof: true }); await expectCode(runGithubRepositoryGovernanceAttestation(input("main"), deps(mock.fetchImpl)), "github_governance_attestation_same_cycle_readback_failed"); assert.equal(mock.calls.filter(c => c.method === "POST").length, 2); }
  { const mock = mockFetch({ headWriteReject: true }); await expectCode(runGithubRepositoryGovernanceAttestation(input("main"), deps(mock.fetchImpl)), "github_governance_attestation_status_create_failed"); assert.equal(mock.calls.filter(c => c.method === "POST").length, 2); }
  { const mock = mockFetch({ headPrDriftBefore: true }); await expectCode(runGithubRepositoryGovernanceAttestation(input("main"), deps(mock.fetchImpl)), "github_governance_attestation_head_status_pr_drift"); assert.equal(mock.calls.filter(c => c.method === "POST").length, 1); }
  { const mock = mockFetch({ headPrDriftAfter: true }); await expectCode(runGithubRepositoryGovernanceAttestation(input("main"), deps(mock.fetchImpl)), "github_governance_attestation_head_status_pr_drift"); assert.equal(mock.calls.filter(c => c.method === "POST").length, 2); }
  { const mock = mockFetch(); await expectCode(runGithubRepositoryGovernanceAttestation({ ...input("main"), executed_sha: HEAD }, deps(mock.fetchImpl)), "github_governance_attestation_executed_candidate_mismatch"); assert.equal(mock.calls.length, 0); }
  { const mock = mockFetch(); await expectCode(runGithubRepositoryGovernanceAttestation({ ...input("main"), confirm: "ATTEST_ANYTHING" }, deps(mock.fetchImpl)), "github_governance_attestation_confirmation_invalid"); assert.equal(mock.calls.length, 0); }
  console.log(JSON.stringify({ ok: true, test: "github_repository_governance_exact_candidate_attestation", main_exact_candidate: true, production_tree_equivalence: true, stale_candidate_rejected: true, repository_bound: true, trusted_run_verified: true, artifact_digest_verified: true, forged_provenance_rejected: true, secrets_included: false }));
} finally { if (previousAppId === undefined) delete process.env.GITHUB_APP_ID; else process.env.GITHUB_APP_ID = previousAppId; }

// Independent Direct GitHub App attestation regressions, without extra registered test files.
const head = "a".repeat(40), base = "b".repeat(40), candidate = "c".repeat(40), run = 42;
const identity = { pr_number: 8493, source_head_sha: head, base_sha: base,
  merge_candidate_sha: candidate, executed_sha: candidate, source_run_id: run };
const evidence = {
  identity,
  report: { contract: "mad4b.repository-derived-state-closure.v2",
    candidate: { sha: candidate, pr_number: 8493, source_head_sha: head, base_sha: base },
    converged: true, blocking_stale_or_failed_artifact_count: 0 },
  finalizer: { contract: "mad4b.repository-governance-evidence-finalizer.v2",
    merge_candidate_sha: candidate, source_head_sha: head, base_sha: base,
    executed_sha: candidate, pr_number: 8493, required_count: 1, failed_or_missing_required_count: 0,
    converged: true, failed_or_missing_required_ids: [] },
  objections: { contract: "mad4b.repository-policy-objections.v1",
    candidate_sha: candidate, source_head_sha: head, blocking_count: 0, manual_count: 0,
    activation_count: 0, merge_allowed_by_source_policy: true, automerge_allowed: false },
  owner: { ok: true, pr_number: 8493, exact_head_sha: head, mode: "single_owner_attestation" },
  environment: { converged: true, issue_count: 0, expected_head_sha: head, base_sha: base },
};
const exact = { pr: 8493, head, base, candidate, run };
const copy = v => JSON.parse(JSON.stringify(v));
function rejected(fn, tag) { assert.throws(fn, e => e.message.includes(tag), tag); }
assert.equal(validateEvidence(evidence, exact), true);
{
  const wrongCandidate = copy(evidence);
  wrongCandidate.report.candidate.sha = "f".repeat(40);
  rejected(() => validateEvidence(wrongCandidate, exact), "derived_state_not_converged");
  const wrongBase = copy(evidence);
  wrongBase.report.candidate.base_sha = "f".repeat(40);
  rejected(() => validateEvidence(wrongBase, exact), "derived_state_not_converged");
  const wrongProducer = copy(evidence);
  wrongProducer.finalizer.executed_sha = "f".repeat(40);
  rejected(() => validateEvidence(wrongProducer, exact), "producer_evidence_not_converged");
}
assert.equal(statusTarget("main", head, candidate), head);
assert.equal(statusTarget("Production", head, candidate), candidate);
for (const [file, field, value] of [
  ["identity", "source_head_sha", "f".repeat(40)],
  ["identity", "base_sha", "f".repeat(40)],
  ["identity", "merge_candidate_sha", "f".repeat(40)],
  ["identity", "source_run_id", 43],
  ["report", "converged", false],
  ["report", "blocking_stale_or_failed_artifact_count", 1],
  ["finalizer", "required_count", 0],
  ["finalizer", "failed_or_missing_required_count", 1],
  ["owner", "pr_number", 99],
  ["environment", "expected_head_sha", "f".repeat(40)],
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
const wf = readFileSync(new URL("../.github/workflows/derived-state-converged-automerge.yml", import.meta.url), "utf8");
assert.match(wf, /attestor_runtime_contract_unverified/);
assert.match(wf, /attestor-preflight-response[.]json/);
assert.match(wf, /github-repository-governance-attestation-v4/);
assert.ok(wf.indexOf("attestor_runtime_contract_unverified") < wf.indexOf('response="$RUNNER_TEMP/attestation-response.json"'));

assert.match(wf, /workflow_dispatch:/);
assert.match(wf, /Governance-Direct/);
assert.match(wf, /DIRECT_GITHUB_APP_PRIVATE_KEY/);
assert.match(wf, /DIRECT_ATTEST_AND_MERGE/);
assert.match(wf, /REPO_AUTOSYNC_TOKEN/);
assert.match(wf, /--match-head-commit "\$HEAD"/);
assert.doesNotMatch(wf, /gh pr merge[^\n]*--admin/);
assert.match(wf, /head_attestor_status_id:.*steps[.]final[.]outputs[.]head_attestor_status_id/);
assert.match(wf, /EXPECTED_HEAD_ATTESTOR_STATUS_ID=/);
assert.match(wf, /EXPECTED_HEAD_STATUS_CREATOR_ID=/);
const readinessSource = readFileSync(new URL("../.github/ops/github-followup-automerge-readiness.mjs", import.meta.url), "utf8");
assert.match(readinessSource, /expectedHeadAttestorStatusId/);
assert.match(readinessSource, /expectedHeadStatusCreatorId/);
assert.match(readinessSource, /blocked_exact_head_attestor_status_missing/);
assert.ok(readinessSource.includes('latestSameCycleAttestorStatus(headStatuses'));
assert.doesNotMatch(wf, /pull_request_target:/);
assert.doesNotMatch(wf, /@?actions\/create-github-app-token@main/);
const directJob = wf.split("\n  direct_attest:\n")[1]?.split("\n  direct_merge:\n")[0] || "";
assert.ok(directJob.includes("DIRECT_GITHUB_APP_PRIVATE_KEY"));
assert.doesNotMatch(directJob, /BACKEND_API_KEY|auth\.mad4b\.com/);
const src = readFileSync(new URL("../.github/scripts/github-direct-attestor.mjs", import.meta.url), "utf8");
assert.match(src, /DIRECT_ATTESTOR_ENABLED === "enabled"/);
assert.match(src, /installToken\(repo, appId, key\)/);
assert.match(src, /"\/statuses\/" \+ head/);
assert.doesNotMatch(src, /"\/statuses\/" \+ candidate, "POST"/);
console.log("MAD4B_GITHUB_DIRECT_ATTESTOR_TESTS: PASS");
