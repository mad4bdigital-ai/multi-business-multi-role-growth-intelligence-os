import assert from "node:assert/strict";
import { GOVERNANCE_ATTESTATION_CONTEXTS, runGithubRepositoryGovernanceAttestation } from "./githubRepositoryGovernanceAttestation.js";
const OWNER = "mad4bdigital-ai", REPO = "multi-business-multi-role-growth-intelligence-os";
const HEAD = "a".repeat(40), BASE = "b".repeat(40), CANDIDATE = "c".repeat(40), TREE = "e".repeat(40), EVIDENCE = "d".repeat(64), CREATOR = 991, RUN_ID = 321;
const SOURCE = Object.freeze({
  main: { path: ".github/workflows/derived-state-closure.yml", event: "pull_request", artifact: `derived-state-closure-${RUN_ID}` },
  Production: { path: ".github/workflows/governed-production-promotion-request-launcher.yml", event: "workflow_dispatch", artifact: `governed-production-promotion-convergence-${RUN_ID}` },
});
function response(status, payload) { return { ok: status >= 200 && status < 300, status, async json() { return payload; } }; }
function mockFetch({ branch = "main", candidate = CANDIDATE, tree = TREE, runConclusion = "success", sourcePath = SOURCE[branch].path, sourceEvent = SOURCE[branch].event, artifactDigest = EVIDENCE, artifactName = SOURCE[branch].artifact, runPr = 7437, runRepository = `${OWNER}/${REPO}` } = {}) {
  const calls = [];
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
    if (path === `/repos/${OWNER}/${REPO}/pulls/7437` && method === "GET") return response(200, { state: "open", base: { ref: branch, sha: BASE }, head: { sha: HEAD, repo: { full_name: `${OWNER}/${REPO}` } }, merge_commit_sha: candidate });
    if (branch === "Production" && path === `/repos/${OWNER}/${REPO}/git/commits/${CANDIDATE}` && method === "GET") return response(200, { sha: CANDIDATE, tree: { sha: tree } });
    if (branch === "Production" && path === `/repos/${OWNER}/${REPO}/git/commits/${HEAD}` && method === "GET") return response(200, { sha: HEAD, tree: { sha: TREE } });
    if (path === `/repos/${OWNER}/${REPO}/statuses/${CANDIDATE}` && method === "POST") { const body = JSON.parse(options.body || "{}"); return response(201, { id: 1234, sha: CANDIDATE, state: body.state, context: body.context, creator: { id: CREATOR } }); }
    if (path === `/repos/${OWNER}/${REPO}/commits/${CANDIDATE}/statuses?per_page=100` && method === "GET") return response(200, [{ id: 1234, sha: CANDIDATE, state: "success", context: GOVERNANCE_ATTESTATION_CONTEXTS[branch].context, creator: { id: CREATOR } }]);
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
    if (branch === "main") assert.equal(result.executed_relation, "executed_is_merge_candidate");
    else { assert.equal(result.executed_relation, "executed_source_tree_equals_merge_candidate_tree"); assert.equal(result.candidate_tree_sha, TREE); assert.equal(result.executed_tree_sha, TREE); }
  }
  { const mock = mockFetch(); await expectCode(runGithubRepositoryGovernanceAttestation({ ...input("main"), repo: "other-repo" }, deps(mock.fetchImpl)), "github_governance_attestation_repository_binding_mismatch"); assert.equal(mock.calls.length, 0); }
  { const mock = mockFetch({ sourcePath: ".github/workflows/ci.yml" }); await expectCode(runGithubRepositoryGovernanceAttestation(input("main"), deps(mock.fetchImpl)), "github_governance_attestation_source_workflow_mismatch"); assert.equal(mock.calls.some((call) => call.method === "POST"), false); }
  { const mock = mockFetch({ runConclusion: "failure" }); await expectCode(runGithubRepositoryGovernanceAttestation(input("main"), deps(mock.fetchImpl)), "github_governance_attestation_source_run_not_successful"); assert.equal(mock.calls.some((call) => call.method === "POST"), false); }
  { const mock = mockFetch({ runPr: 9999 }); await expectCode(runGithubRepositoryGovernanceAttestation(input("main"), deps(mock.fetchImpl)), "github_governance_attestation_source_pr_mismatch"); assert.equal(mock.calls.some((call) => call.method === "POST"), false); }
  { const mock = mockFetch({ artifactDigest: "f".repeat(64) }); await expectCode(runGithubRepositoryGovernanceAttestation(input("main"), deps(mock.fetchImpl)), "github_governance_attestation_source_artifact_digest_mismatch"); assert.equal(mock.calls.some((call) => call.method === "POST"), false); }
  { const mock = mockFetch({ artifactName: "untrusted-artifact" }); await expectCode(runGithubRepositoryGovernanceAttestation(input("main"), deps(mock.fetchImpl)), "github_governance_attestation_source_artifact_ambiguous"); assert.equal(mock.calls.some((call) => call.method === "POST"), false); }
  { const mock = mockFetch({ candidate: "f".repeat(40) }); await expectCode(runGithubRepositoryGovernanceAttestation(input("main"), deps(mock.fetchImpl)), "github_governance_attestation_merge_candidate_drift"); assert.equal(mock.calls.some((call) => call.method === "POST"), false); }
  { const mock = mockFetch({ branch: "Production", tree: "f".repeat(40) }); await expectCode(runGithubRepositoryGovernanceAttestation(input("Production"), deps(mock.fetchImpl)), "github_governance_attestation_candidate_tree_mismatch"); assert.equal(mock.calls.some((call) => call.method === "POST"), false); }
  { const mock = mockFetch(); await expectCode(runGithubRepositoryGovernanceAttestation({ ...input("main"), executed_sha: HEAD }, deps(mock.fetchImpl)), "github_governance_attestation_executed_candidate_mismatch"); assert.equal(mock.calls.length, 0); }
  { const mock = mockFetch(); await expectCode(runGithubRepositoryGovernanceAttestation({ ...input("main"), confirm: "ATTEST_ANYTHING" }, deps(mock.fetchImpl)), "github_governance_attestation_confirmation_invalid"); assert.equal(mock.calls.length, 0); }
  console.log(JSON.stringify({ ok: true, test: "github_repository_governance_exact_candidate_attestation", main_exact_candidate: true, production_tree_equivalence: true, stale_candidate_rejected: true, repository_bound: true, trusted_run_verified: true, artifact_digest_verified: true, forged_provenance_rejected: true, secrets_included: false }));
} finally { if (previousAppId === undefined) delete process.env.GITHUB_APP_ID; else process.env.GITHUB_APP_ID = previousAppId; }
