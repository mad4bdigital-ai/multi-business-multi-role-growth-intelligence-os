import assert from "node:assert/strict";
import {
  GOVERNANCE_ATTESTATION_CONTEXTS,
  runGithubRepositoryGovernanceAttestation,
} from "./githubRepositoryGovernanceAttestation.js";

const OWNER = "mad4bdigital-ai";
const REPO = "multi-business-multi-role-growth-intelligence-os";
const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const CANDIDATE = "c".repeat(40);
const EVIDENCE = "d".repeat(64);
const CREATOR = 991;

function response(status, payload) {
  return { ok: status >= 200 && status < 300, status, async json() { return payload; } };
}
function mockFetch({ branch = "main", candidate = CANDIDATE } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const method = String(options.method || "GET").toUpperCase();
    const path = new URL(url).pathname + new URL(url).search;
    calls.push({ method, path, body: options.body ? JSON.parse(options.body) : null });
    if (path === `/repos/${OWNER}/${REPO}/pulls/7437` && method === "GET") {
      return response(200, {
        state: "open",
        base: { ref: branch, sha: BASE },
        head: { sha: HEAD, repo: { full_name: `${OWNER}/${REPO}` } },
        merge_commit_sha: candidate,
      });
    }
    if (path === `/repos/${OWNER}/${REPO}/statuses/${CANDIDATE}` && method === "POST") {
      const body = JSON.parse(options.body || "{}");
      return response(201, { id: 1234, sha: CANDIDATE, state: body.state, context: body.context, creator: { id: CREATOR } });
    }
    if (path === `/repos/${OWNER}/${REPO}/commits/${CANDIDATE}/statuses?per_page=100` && method === "GET") {
      const context = branch === "main" ? GOVERNANCE_ATTESTATION_CONTEXTS.main.context : GOVERNANCE_ATTESTATION_CONTEXTS.Production.context;
      return response(200, [{ id: 1234, sha: CANDIDATE, state: "success", context, creator: { id: CREATOR } }]);
    }
    throw new Error(`Unhandled request ${method} ${path}`);
  };
  return { fetchImpl, calls };
}
function input(branch = "main") {
  const policy = GOVERNANCE_ATTESTATION_CONTEXTS[branch];
  return {
    mode: "attest",
    owner: OWNER,
    repo: REPO,
    default_branch: branch,
    pr_number: 7437,
    source_head_sha: HEAD,
    base_sha: BASE,
    candidate_sha: CANDIDATE,
    executed_sha: CANDIDATE,
    evidence_sha256: EVIDENCE,
    source_run_id: 321,
    confirm: policy.confirm,
  };
}
function deps(fetchImpl) {
  return { token: "injected-test-token", fetchImpl, auth: { caller_type: "admin", user_id: "admin-1" } };
}
async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => error?.code === code);
}

const previousAppId = process.env.GITHUB_APP_ID;
process.env.GITHUB_APP_ID = "777";
try {
  for (const branch of ["main", "Production"]) {
    const mock = mockFetch({ branch });
    const result = await runGithubRepositoryGovernanceAttestation(input(branch), deps(mock.fetchImpl));
    assert.equal(result.branch, branch);
    assert.equal(result.context, GOVERNANCE_ATTESTATION_CONTEXTS[branch].context);
    assert.equal(result.candidate_sha, CANDIDATE);
    assert.equal(result.executed_sha, CANDIDATE);
    assert.equal(result.same_cycle_readback_proven, true);
    assert.equal(result.app_id, 777);
    assert.equal(result.mutation_executed, true);
    assert.equal(result.repository_content_mutation_executed, false);
    assert.equal(result.secrets_included, false);
    const post = mock.calls.find((call) => call.method === "POST");
    assert.equal(post.path, `/repos/${OWNER}/${REPO}/statuses/${CANDIDATE}`);
    assert.equal(post.body.context, GOVERNANCE_ATTESTATION_CONTEXTS[branch].context);
    assert.equal(post.body.state, "success");
  }

  {
    const mock = mockFetch({ candidate: "e".repeat(40) });
    await expectCode(runGithubRepositoryGovernanceAttestation(input("main"), deps(mock.fetchImpl)), "github_governance_attestation_merge_candidate_drift");
    assert.equal(mock.calls.some((call) => call.method === "POST"), false);
  }
  {
    const mock = mockFetch();
    await expectCode(runGithubRepositoryGovernanceAttestation({ ...input("main"), executed_sha: HEAD }, deps(mock.fetchImpl)), "github_governance_attestation_executed_candidate_mismatch");
    assert.equal(mock.calls.length, 0);
  }
  {
    const mock = mockFetch();
    await expectCode(runGithubRepositoryGovernanceAttestation({ ...input("main"), confirm: "WRONG" }, deps(mock.fetchImpl)), "github_governance_attestation_confirmation_invalid");
    assert.equal(mock.calls.length, 0);
  }

  console.log(JSON.stringify({
    ok: true,
    test: "github_repository_governance_exact_candidate_attestation",
    main_context: "Derived State Closure",
    production_context: "Governed Production Promotion",
    same_cycle_readback: true,
    stale_candidate_rejected: true,
    secrets_included: false
  }));
} finally {
  if (previousAppId === undefined) delete process.env.GITHUB_APP_ID;
  else process.env.GITHUB_APP_ID = previousAppId;
}
