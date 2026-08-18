import assert from "node:assert/strict";
import {
  GITHUB_REPOSITORY_POLICY_CONFIRMATION,
  GITHUB_REPOSITORY_POLICY_REQUIRED_CHECKS,
  branchPatternMatches,
  buildGithubRepositoryPolicyPlan,
  buildGithubRepositoryPolicyCapabilityBinding,
  githubRepositoryPolicyConfirmationForBranch,
  readGithubRepositoryPolicy,
  runGithubRepositoryPolicyController,
} from "./githubRepositoryPolicyController.js";

const OWNER = "mad4bdigital-ai", REPO = "multi-business-multi-role-growth-intelligence-os", HUMAN = "repository-owner";
const MAIN_SHA = "a".repeat(40), PROD_SHA = "b".repeat(40), APP_ID = 777;
function response(status, payload) { return { ok: status >= 200 && status < 300, status, async json() { return payload; } }; }
function mockGitHub(branch = "main", branchSha = MAIN_SHA) {
  const state = { ruleset: null, mutations: [] };
  const expectedName = branch === "main" ? "MAD4B main review policy" : "MAD4B Production governance policy";
  const fetchImpl = async (url, options = {}) => {
    const method = String(options.method || "GET").toUpperCase(), parsed = new URL(url), path = parsed.pathname;
    if (path === `/repos/${OWNER}/${REPO}` && method === "GET") return response(200, { allow_auto_merge: false });
    if (path === `/repos/${OWNER}/${REPO}/branches/${branch}` && method === "GET") return response(200, { name: branch, commit: { sha: branchSha }, protected: Boolean(state.ruleset) });
    if (path === `/repos/${OWNER}/${REPO}/rules/branches/${branch}` && method === "GET") return response(200, state.ruleset ? state.ruleset.rules.map((rule) => ({ ...rule, ruleset_id: 42 })) : []);
    if (path === `/repos/${OWNER}/${REPO}/rulesets` && method === "GET") return response(200, state.ruleset ? [{ id: 42, name: expectedName }] : []);
    if (path === `/repos/${OWNER}/${REPO}/rulesets/42` && method === "GET") return state.ruleset ? response(200, state.ruleset) : response(404, { message: "not found" });
    if (path === `/repos/${OWNER}/${REPO}/branches/${branch}/protection` && method === "GET") return response(404, { message: "not protected" });
    if (path === `/repos/${OWNER}/${REPO}/collaborators` && method === "GET") return response(200, [{ login: HUMAN, type: "User" }]);
    if (path === `/repos/${OWNER}/${REPO}/collaborators/${HUMAN}/permission` && method === "GET") return response(200, { permission: "admin", role_name: "admin" });
    if (path === `/repos/${OWNER}/${REPO}/rulesets` && method === "POST") {
      const body = JSON.parse(options.body || "{}"); state.ruleset = { id: 42, source_type: "Repository", source: `${OWNER}/${REPO}`, ...body }; state.mutations.push({ method, body }); return response(201, state.ruleset);
    }
    if (path === `/repos/${OWNER}/${REPO}/rulesets/42` && method === "PUT") { const body = JSON.parse(options.body || "{}"); state.ruleset = { id: 42, source_type: "Repository", source: `${OWNER}/${REPO}`, ...body }; state.mutations.push({ method, body }); return response(200, state.ruleset); }
    if (path === `/repos/${OWNER}/${REPO}/rulesets/42` && method === "DELETE") { state.ruleset = null; state.mutations.push({ method }); return response(204, null); }
    throw new Error(`Unhandled ${method} ${path}`);
  };
  return { fetchImpl, state };
}
function deps(fetchImpl) { return { token: "test-token", fetchImpl, authorizeApply: async () => ({ ok: true, envelope_id: "env-1", apply_allowed: true }), auth: { caller_type: "admin", tenant_id: "tenant", user_id: "admin" } }; }
async function expectCode(promise, code) { await assert.rejects(promise, (error) => error?.code === code); }
const prevApp = process.env.GITHUB_APP_ID, prevInstall = process.env.GITHUB_APP_INSTALLATION_ID; process.env.GITHUB_APP_ID = String(APP_ID); process.env.GITHUB_APP_INSTALLATION_ID = "888";
try {
  assert.deepEqual([...GITHUB_REPOSITORY_POLICY_REQUIRED_CHECKS], ["Derived State Closure"]);
  assert.equal(branchPatternMatches("refs/heads/**", "main"), true);
  assert.equal(branchPatternMatches("refs/heads/**", "Production"), true);
  assert.equal(branchPatternMatches("refs/heads/Prod?ction", "Production"), true);
  assert.equal(branchPatternMatches("refs/heads/release/**", "main"), false);
  assert.equal(branchPatternMatches("refs/heads/release/**", "release/candidate"), true);
  for (const [branch, sha, requiredCheck] of [["main", MAIN_SHA, "Derived State Closure"], ["Production", PROD_SHA, "Governed Production Promotion"]]) {
    const mock = mockGitHub(branch, sha);
    const plan = await runGithubRepositoryPolicyController({ mode: "plan", owner: OWNER, repo: REPO, default_branch: branch }, deps(mock.fetchImpl));
    assert.equal(plan.constitution.source_of_truth, true);
    assert.equal(plan.target.default_branch, branch);
    assert.equal(plan.expected_commit_sha, sha);
    assert.deepEqual(plan.required_checks, [requiredCheck]);
    assert.equal(plan.operation, "create_ruleset");
    assert.equal(plan.activation_blockers.length, 0);
    const checkRule = plan.desired_ruleset.rules.find((rule) => rule.type === "required_status_checks");
    assert.deepEqual(checkRule.parameters.required_status_checks, [{ context: requiredCheck, integration_id: APP_ID }]);
    assert.deepEqual(plan.desired_ruleset.conditions.ref_name.include, [`refs/heads/${branch}`]);
    const binding = buildGithubRepositoryPolicyCapabilityBinding({ target: { owner: OWNER, repo: REPO, default_branch: branch }, expected_commit_sha: sha, expected_policy_fingerprint: plan.policy_fingerprint });
    assert.equal(binding.resource_uri, `github://${OWNER}/${REPO}/branch/${branch}`);
    const applied = await runGithubRepositoryPolicyController({ mode: "apply", owner: OWNER, repo: REPO, default_branch: branch, expected_commit_sha: sha, expected_policy_fingerprint: plan.policy_fingerprint, confirm: githubRepositoryPolicyConfirmationForBranch(branch), capability_envelope_id: "env-1" }, deps(mock.fetchImpl));
    assert.equal(applied.mutation_executed, true);
    assert.equal(applied.postconditions.required_check_producer_bound, true);
    assert.equal(applied.postconditions.generic_pull_request_merge_forbidden_proven, true);
    assert.equal(applied.postconditions.server_policy_gate_complete, true);
    assert.equal(applied.readback.proof.server_policy_gate_complete, true);
  }
  {
    const mock = mockGitHub("main", MAIN_SHA);
    const readback = await readGithubRepositoryPolicy({ owner: OWNER, repo: REPO, default_branch: "main" }, deps(mock.fetchImpl));
    assert.throws(() => buildGithubRepositoryPolicyPlan({ required_checks: ["Syntax Check"] }, readback), (error) => error?.code === "github_repository_policy_required_checks_invalid");
  }
  {
    let calls = 0;
    await expectCode(readGithubRepositoryPolicy({ owner: OWNER, repo: REPO, default_branch: "unknown" }, { token: "x", fetchImpl: async () => { calls += 1; return response(500, {}); } }), "github_repository_policy_branch_unregistered");
    assert.equal(calls, 0);
  }
  {
    const mock = mockGitHub("main", MAIN_SHA);
    const plan = await runGithubRepositoryPolicyController({ mode: "plan", owner: OWNER, repo: REPO }, deps(mock.fetchImpl));
    await expectCode(runGithubRepositoryPolicyController({ mode: "apply", owner: OWNER, repo: REPO, expected_commit_sha: PROD_SHA, expected_policy_fingerprint: plan.policy_fingerprint, confirm: GITHUB_REPOSITORY_POLICY_CONFIRMATION, capability_envelope_id: "env-1" }, deps(mock.fetchImpl)), "github_repository_policy_main_sha_drift");
    assert.equal(mock.state.mutations.length, 0);
  }
  console.log(JSON.stringify({ ok: true, test: "github_repository_policy_controller_constitution_native", main_final_gate: "Derived State Closure", production_final_gate: "Governed Production Promotion", app_bound_required_checks: true, production_promotion_only: true, branch_pattern_compiler: true, secrets_included: false }));
} finally { if (prevApp === undefined) delete process.env.GITHUB_APP_ID; else process.env.GITHUB_APP_ID = prevApp; if (prevInstall === undefined) delete process.env.GITHUB_APP_INSTALLATION_ID; else process.env.GITHUB_APP_INSTALLATION_ID = prevInstall; }
