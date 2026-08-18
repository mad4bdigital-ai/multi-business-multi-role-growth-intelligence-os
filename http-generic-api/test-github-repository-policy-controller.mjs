import assert from "node:assert/strict";
import {
  GITHUB_REPOSITORY_POLICY_CONFIRMATION,
  GITHUB_REPOSITORY_POLICY_REQUIRED_CHECKS,
  GITHUB_REPOSITORY_POLICY_RULESET_NAME,
  buildGithubRepositoryPolicyCapabilityBinding,
  buildGithubRepositoryPolicyPlan,
  readGithubRepositoryPolicy,
  runGithubRepositoryPolicyController,
} from "./githubRepositoryPolicyController.js";

const OWNER = "mad4bdigital-ai";
const SOLE_HUMAN = "repository-owner";
const REPO = "multi-business-multi-role-growth-intelligence-os";
const MAIN_SHA = "a".repeat(40);
const PRODUCTION_SHA = "c".repeat(40);
const STALE_SHA = "b".repeat(40);
const APP_ID = 777;

function response(status, payload) {
  return { ok: status >= 200 && status < 300, status, async json() { return payload; } };
}

function legacyMainRuleset({
  bypassActors = [],
  sourceType = "Repository",
  source = `${OWNER}/${REPO}`,
  producerId = APP_ID,
  context = "Derived State Closure",
} = {}) {
  return {
    id: 42,
    name: GITHUB_REPOSITORY_POLICY_RULESET_NAME,
    target: "branch",
    enforcement: "active",
    source_type: sourceType,
    source,
    bypass_actors: bypassActors,
    conditions: { ref_name: { include: ["refs/heads/main"], exclude: [] } },
    rules: [
      {
        type: "pull_request",
        parameters: {
          allowed_merge_methods: ["merge", "squash", "rebase"],
          dismiss_stale_reviews_on_push: true,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_approving_review_count: 0,
          required_review_thread_resolution: true,
        },
      },
      {
        type: "required_status_checks",
        parameters: {
          do_not_enforce_on_create: false,
          required_status_checks: [{ context, ...(producerId ? { integration_id: producerId } : {}) }],
          strict_required_status_checks_policy: true,
        },
      },
      { type: "non_fast_forward" },
    ],
  };
}

function createGithubFetch({
  branch = "main",
  branchSha = branch === "main" ? MAIN_SHA : PRODUCTION_SHA,
  classicStatus = 404,
  initialRuleset = null,
  postReadbackRuleset = null,
  repositoryAutoMerge = false,
  repositoryPayload = undefined,
  branchPayload = undefined,
  rulesetDetailStatus = 200,
  collaboratorPermissionStatus = 200,
} = {}) {
  const state = { ruleset: initialRuleset, postReadbackRuleset, mutations: [], reads: 0 };
  const fetchImpl = async (url, options = {}) => {
    const method = String(options.method || "GET").toUpperCase();
    const parsed = new URL(url);
    const path = parsed.pathname;
    state.reads += method === "GET" ? 1 : 0;

    if (path === `/repos/${OWNER}/${REPO}` && method === "GET") {
      return response(200, repositoryPayload === undefined ? { allow_auto_merge: repositoryAutoMerge } : repositoryPayload);
    }
    if (path === `/repos/${OWNER}/${REPO}/branches/${branch}` && method === "GET") {
      return response(200, branchPayload === undefined
        ? { name: branch, commit: { sha: branchSha }, protected: Boolean(state.ruleset) }
        : branchPayload);
    }
    if (path === `/repos/${OWNER}/${REPO}/rules/branches/${branch}` && method === "GET") {
      return response(200, state.ruleset ? state.ruleset.rules.map((rule) => ({ ...rule, ruleset_id: 42 })) : []);
    }
    if (path === `/repos/${OWNER}/${REPO}/rulesets` && method === "GET") {
      return response(200, state.ruleset ? [{ id: 42, name: state.ruleset.name }] : []);
    }
    if (path === `/repos/${OWNER}/${REPO}/branches/${branch}/protection` && method === "GET") {
      return classicStatus === 404
        ? response(404, { message: "Branch not protected" })
        : response(classicStatus, { message: classicStatus === 403 ? "Resource not accessible by integration" : "unexpected" });
    }
    if (path === `/repos/${OWNER}/${REPO}/collaborators` && method === "GET") {
      assert.equal(parsed.searchParams.get("affiliation"), "all");
      assert.equal(parsed.searchParams.get("per_page"), "100");
      return response(200, [{ login: SOLE_HUMAN, type: "User" }]);
    }
    if (path === `/repos/${OWNER}/${REPO}/collaborators/${SOLE_HUMAN}/permission` && method === "GET") {
      return collaboratorPermissionStatus === 200
        ? response(200, { permission: "admin", role_name: "admin" })
        : response(collaboratorPermissionStatus, { message: "permission unavailable" });
    }
    if (path === `/repos/${OWNER}/${REPO}/rulesets/42` && method === "GET") {
      if (!state.ruleset) return response(404, { message: "Not Found" });
      if (rulesetDetailStatus !== 200) return response(rulesetDetailStatus, { message: "Ruleset detail unavailable" });
      return response(200, state.postReadbackRuleset || state.ruleset);
    }
    if (path === `/repos/${OWNER}/${REPO}/rulesets` && method === "POST") {
      const body = JSON.parse(options.body || "{}");
      state.ruleset = { id: 42, source_type: "Repository", source: `${OWNER}/${REPO}`, ...body };
      state.mutations.push({ method, path, body });
      return response(201, state.ruleset);
    }
    if (path === `/repos/${OWNER}/${REPO}/rulesets/42` && method === "PUT") {
      const body = JSON.parse(options.body || "{}");
      state.ruleset = { id: 42, source_type: "Repository", source: `${OWNER}/${REPO}`, ...body };
      state.mutations.push({ method, path, body });
      return response(200, state.ruleset);
    }
    if (path === `/repos/${OWNER}/${REPO}/rulesets/42` && method === "DELETE") {
      state.mutations.push({ method, path });
      state.ruleset = null;
      return response(204, null);
    }
    throw new Error(`Unhandled GitHub mock request: ${method} ${path}`);
  };
  return { fetchImpl, state };
}

function controllerDeps(fetchImpl, authorizeApply = async () => ({ ok: true, envelope_id: "env-policy-1", apply_allowed: true })) {
  return {
    token: "test-installation-token",
    fetchImpl,
    authorizeApply,
    auth: { caller_type: "admin", tenant_id: "tenant-1", user_id: "admin-1" },
  };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.code, code);
    return true;
  });
}

const previousAppId = process.env.GITHUB_APP_ID;
const previousInstallationId = process.env.GITHUB_APP_INSTALLATION_ID;
process.env.GITHUB_APP_ID = String(APP_ID);
process.env.GITHUB_APP_INSTALLATION_ID = "888";

try {
  assert.deepEqual([...GITHUB_REPOSITORY_POLICY_REQUIRED_CHECKS], ["Derived State Closure"]);

  {
    const mock = createGithubFetch();
    const readback = await readGithubRepositoryPolicy({ owner: OWNER, repo: REPO, default_branch: "main" }, controllerDeps(mock.fetchImpl));
    assert.equal(readback.branch_sha, MAIN_SHA);
    assert.equal(readback.main_sha, MAIN_SHA);
    assert.equal(readback.branch_protected, false);
    assert.equal(readback.constitution.source_of_truth, true);
    assert.deepEqual(readback.required_checks, ["Derived State Closure"]);
    assert.equal(readback.proof.server_policy_gate_complete, false);
    assert.ok(readback.findings.includes("direct_push_block_unproven"));
    assert.equal(mock.state.mutations.length, 0);

    const plan = buildGithubRepositoryPolicyPlan({ owner: OWNER, repo: REPO }, readback);
    assert.equal(plan.operation, "create_ruleset");
    assert.equal(plan.constitution.source_of_truth, true);
    assert.equal(plan.activation_blockers.length, 0);
    const statusRule = plan.desired_ruleset.rules.find((rule) => rule.type === "required_status_checks");
    assert.deepEqual(statusRule.parameters.required_status_checks, [{ context: "Derived State Closure", integration_id: APP_ID }]);
    assert.deepEqual(plan.desired_ruleset.conditions.ref_name.include, ["refs/heads/main"]);
    assert.equal(plan.review_policy_mode, "single_owner_attestation");
    assert.equal(plan.desired_ruleset.rules.find((rule) => rule.type === "pull_request").parameters.required_approving_review_count, 0);
    assert.throws(
      () => buildGithubRepositoryPolicyPlan({ required_checks: ["Syntax Check"] }, readback),
      (error) => error?.code === "github_repository_policy_required_checks_invalid"
    );
  }

  {
    const mock = createGithubFetch({ branch: "Production", branchSha: PRODUCTION_SHA });
    const result = await runGithubRepositoryPolicyController(
      { mode: "plan", owner: OWNER, repo: REPO, default_branch: "Production" },
      controllerDeps(mock.fetchImpl)
    );
    assert.equal(result.target.default_branch, "Production");
    assert.equal(result.expected_commit_sha, PRODUCTION_SHA);
    assert.deepEqual(result.required_checks, []);
    assert.equal(result.operation, "blocked");
    assert.ok(result.activation_blockers.includes("generic_pull_request_merge_forbidden_not_expressible_by_current_repository_ruleset_contract"));
    assert.deepEqual(result.desired_ruleset.conditions.ref_name.include, ["refs/heads/Production"]);
    assert.equal(result.desired_ruleset.rules.some((rule) => rule.type === "required_status_checks"), false);
    assert.equal(result.review_policy_mode, "independent_approval");
    const binding = buildGithubRepositoryPolicyCapabilityBinding({
      target: { owner: OWNER, repo: REPO, default_branch: "Production" },
      expected_commit_sha: PRODUCTION_SHA,
      expected_policy_fingerprint: result.policy_fingerprint,
    });
    assert.ok(binding);
    assert.equal(binding.resource_uri, `github://${OWNER}/${REPO}/branch/Production`);
  }

  {
    let fetchCalls = 0;
    await expectCode(
      readGithubRepositoryPolicy({ owner: OWNER, repo: REPO, default_branch: "unknown" }, {
        token: "test-installation-token",
        fetchImpl: async () => { fetchCalls += 1; return response(500, {}); },
      }),
      "github_repository_policy_branch_unregistered"
    );
    assert.equal(fetchCalls, 0);
  }

  {
    let fetchCalls = 0;
    await expectCode(
      runGithubRepositoryPolicyController({
        mode: "apply",
        owner: OWNER,
        repo: REPO,
        expected_main_sha: MAIN_SHA,
        expected_policy_fingerprint: "c".repeat(64),
        confirm: "WRONG",
        capability_envelope_id: "env-policy-1",
      }, controllerDeps(async () => { fetchCalls += 1; throw new Error("network should not be reached"); })),
      "github_repository_policy_confirmation_invalid"
    );
    assert.equal(fetchCalls, 0);
  }

  {
    const mock = createGithubFetch({ classicStatus: 403 });
    const planResult = await runGithubRepositoryPolicyController({ mode: "plan", owner: OWNER, repo: REPO }, controllerDeps(mock.fetchImpl));
    await expectCode(
      runGithubRepositoryPolicyController({
        mode: "apply",
        owner: OWNER,
        repo: REPO,
        expected_main_sha: MAIN_SHA,
        expected_policy_fingerprint: planResult.policy_fingerprint,
        confirm: GITHUB_REPOSITORY_POLICY_CONFIRMATION,
        capability_envelope_id: "env-policy-1",
      }, controllerDeps(mock.fetchImpl)),
      "github_repository_policy_state_unreadable"
    );
    assert.equal(mock.state.mutations.length, 0);
  }

  {
    const mock = createGithubFetch();
    const planResult = await runGithubRepositoryPolicyController({ mode: "plan", owner: OWNER, repo: REPO }, controllerDeps(mock.fetchImpl));
    await expectCode(
      runGithubRepositoryPolicyController({
        mode: "apply",
        owner: OWNER,
        repo: REPO,
        expected_main_sha: STALE_SHA,
        expected_policy_fingerprint: planResult.policy_fingerprint,
        confirm: GITHUB_REPOSITORY_POLICY_CONFIRMATION,
        capability_envelope_id: "env-policy-1",
      }, controllerDeps(mock.fetchImpl)),
      "github_repository_policy_main_sha_drift"
    );
    assert.equal(mock.state.mutations.length, 0);
  }

  {
    const initialRuleset = legacyMainRuleset({
      bypassActors: [{ actor_id: APP_ID, actor_type: "Integration", bypass_mode: "always" }],
    });
    const mock = createGithubFetch({ initialRuleset });
    const planResult = await runGithubRepositoryPolicyController({ mode: "plan", owner: OWNER, repo: REPO }, controllerDeps(mock.fetchImpl));
    await expectCode(
      runGithubRepositoryPolicyController({
        mode: "apply",
        owner: OWNER,
        repo: REPO,
        expected_main_sha: MAIN_SHA,
        expected_policy_fingerprint: planResult.policy_fingerprint,
        confirm: GITHUB_REPOSITORY_POLICY_CONFIRMATION,
        capability_envelope_id: "env-policy-1",
      }, controllerDeps(mock.fetchImpl)),
      "github_repository_policy_bypass_actor_present"
    );
    assert.equal(mock.state.mutations.length, 0);
  }

  {
    const mock = createGithubFetch();
    const planResult = await runGithubRepositoryPolicyController({ mode: "plan", owner: OWNER, repo: REPO }, controllerDeps(mock.fetchImpl));
    const applied = await runGithubRepositoryPolicyController({
      mode: "apply",
      owner: OWNER,
      repo: REPO,
      expected_main_sha: MAIN_SHA,
      expected_policy_fingerprint: planResult.policy_fingerprint,
      confirm: GITHUB_REPOSITORY_POLICY_CONFIRMATION,
      capability_envelope_id: "env-policy-1",
    }, controllerDeps(mock.fetchImpl));
    assert.equal(applied.mutation_executed, true);
    assert.equal(applied.mutation.operation, "create_ruleset");
    assert.equal(applied.postconditions.required_check_producer_bound, true);
    assert.equal(applied.postconditions.server_policy_gate_complete, true);
    assert.equal(applied.readback.proof.server_policy_gate_complete, true);
    assert.equal(mock.state.mutations.filter((item) => item.method === "POST").length, 1);
    assert.equal(mock.state.mutations.some((item) => item.method === "DELETE"), false);
    assert.equal(JSON.stringify(applied).includes("test-installation-token"), false);
  }

  {
    const mock = createGithubFetch({ postReadbackRuleset: legacyMainRuleset({ producerId: null }) });
    const planResult = await runGithubRepositoryPolicyController({ mode: "plan", owner: OWNER, repo: REPO }, controllerDeps(mock.fetchImpl));
    await expectCode(
      runGithubRepositoryPolicyController({
        mode: "apply",
        owner: OWNER,
        repo: REPO,
        expected_main_sha: MAIN_SHA,
        expected_policy_fingerprint: planResult.policy_fingerprint,
        confirm: GITHUB_REPOSITORY_POLICY_CONFIRMATION,
        capability_envelope_id: "env-policy-1",
      }, controllerDeps(mock.fetchImpl)),
      "github_repository_policy_postcondition_failed"
    );
    assert.equal(mock.state.mutations.some((item) => item.method === "POST"), true);
    assert.equal(mock.state.mutations.some((item) => item.method === "DELETE"), true);
  }

  {
    const inheritedRuleset = legacyMainRuleset({ sourceType: "Organization", source: OWNER });
    const mock = createGithubFetch({ initialRuleset: inheritedRuleset });
    const planResult = await runGithubRepositoryPolicyController({ mode: "plan", owner: OWNER, repo: REPO }, controllerDeps(mock.fetchImpl));
    assert.equal(planResult.operation, "blocked");
    assert.equal(planResult.preconditions.managed_ruleset_repository_owned, false);
    await expectCode(
      runGithubRepositoryPolicyController({
        mode: "apply",
        owner: OWNER,
        repo: REPO,
        expected_main_sha: MAIN_SHA,
        expected_policy_fingerprint: planResult.policy_fingerprint,
        confirm: GITHUB_REPOSITORY_POLICY_CONFIRMATION,
        capability_envelope_id: "env-policy-1",
      }, controllerDeps(mock.fetchImpl)),
      "github_repository_policy_managed_ruleset_not_repository_owned"
    );
  }

  {
    await expectCode(
      readGithubRepositoryPolicy({ owner: OWNER, repo: REPO, api_token: "ghp_should_never_be_accepted" }, controllerDeps(async () => response(500, {}))),
      "github_repository_policy_secret_field_rejected"
    );
  }

  console.log(JSON.stringify({
    ok: true,
    test: "github_repository_policy_controller_constitution_convergence",
    constitution_source_of_truth: true,
    canonical_main_gate: "Derived State Closure",
    required_check_producer_binding: true,
    main_same_cycle_apply_readback: true,
    production_registered_fail_closed: true,
    stale_sha_blocks_apply: true,
    inherited_ruleset_blocks_apply: true,
    secrets_included: false,
  }));
} finally {
  if (previousAppId === undefined) delete process.env.GITHUB_APP_ID;
  else process.env.GITHUB_APP_ID = previousAppId;
  if (previousInstallationId === undefined) delete process.env.GITHUB_APP_INSTALLATION_ID;
  else process.env.GITHUB_APP_INSTALLATION_ID = previousInstallationId;
}
