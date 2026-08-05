import assert from "node:assert/strict";
import {
  GITHUB_REPOSITORY_POLICY_CONFIRMATION,
  GITHUB_REPOSITORY_POLICY_REQUIRED_CHECKS,
  GITHUB_REPOSITORY_POLICY_RULESET_NAME,
  buildGithubRepositoryPolicyPlan,
  readGithubRepositoryPolicy,
  runGithubRepositoryPolicyController,
} from "./githubRepositoryPolicyController.js";

const OWNER = "mad4bdigital-ai";
const REPO = "multi-business-multi-role-growth-intelligence-os";
const MAIN_SHA = "a".repeat(40);
const STALE_SHA = "b".repeat(40);
const APP_ID = 777;

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  };
}

function desiredRuleset({ bypassActors = [], reviewCount = 1, missingCheck = null } = {}) {
  const checks = GITHUB_REPOSITORY_POLICY_REQUIRED_CHECKS
    .filter((check) => check !== missingCheck)
    .map((context) => ({ context }));
  return {
    id: 42,
    name: GITHUB_REPOSITORY_POLICY_RULESET_NAME,
    target: "branch",
    enforcement: "active",
    bypass_actors: bypassActors,
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    rules: [
      {
        type: "pull_request",
        parameters: {
          allowed_merge_methods: ["merge", "squash", "rebase"],
          dismiss_stale_reviews_on_push: true,
          require_code_owner_review: false,
          require_last_push_approval: true,
          required_approving_review_count: reviewCount,
          required_review_thread_resolution: true,
        },
      },
      {
        type: "required_status_checks",
        parameters: {
          do_not_enforce_on_create: false,
          required_status_checks: checks,
          strict_required_status_checks_policy: true,
        },
      },
      { type: "non_fast_forward" },
    ],
  };
}

function createGithubFetch({
  classicStatus = 404,
  initialRuleset = null,
  postReadbackRuleset = null,
  repositoryAutoMerge = false,
} = {}) {
  const state = {
    ruleset: initialRuleset,
    postReadbackRuleset,
    mutations: [],
    reads: 0,
  };

  const fetchImpl = async (url, options = {}) => {
    const method = String(options.method || "GET").toUpperCase();
    const parsed = new URL(url);
    const path = parsed.pathname;
    state.reads += method === "GET" ? 1 : 0;

    if (path === `/repos/${OWNER}/${REPO}` && method === "GET") {
      return response(200, { allow_auto_merge: repositoryAutoMerge });
    }
    if (path === `/repos/${OWNER}/${REPO}/branches/main` && method === "GET") {
      return response(200, { name: "main", commit: { sha: MAIN_SHA }, protected: Boolean(state.ruleset) });
    }
    if (path === `/repos/${OWNER}/${REPO}/rules/branches/main` && method === "GET") {
      return response(200, state.ruleset ? state.ruleset.rules.map((rule) => ({ ...rule, ruleset_id: 42 })) : []);
    }
    if (path === `/repos/${OWNER}/${REPO}/rulesets` && method === "GET") {
      return response(200, state.ruleset ? [{ id: 42, name: state.ruleset.name }] : []);
    }
    if (path === `/repos/${OWNER}/${REPO}/branches/main/protection` && method === "GET") {
      return classicStatus === 404
        ? response(404, { message: "Branch not protected" })
        : response(classicStatus, { message: classicStatus === 403 ? "Resource not accessible by integration" : "unexpected" });
    }
    if (path === `/repos/${OWNER}/${REPO}/collaborators` && method === "GET") {
      return response(200, [{ login: OWNER, type: "User" }]);
    }
    if (path === `/repos/${OWNER}/${REPO}/collaborators/${OWNER}/permission` && method === "GET") {
      return response(200, { permission: "admin", role_name: "admin" });
    }
    if (path === `/repos/${OWNER}/${REPO}/rulesets/42` && method === "GET") {
      if (!state.ruleset) return response(404, { message: "Not Found" });
      return response(200, state.postReadbackRuleset || state.ruleset);
    }
    if (path === `/repos/${OWNER}/${REPO}/rulesets` && method === "POST") {
      const body = JSON.parse(options.body || "{}");
      state.ruleset = { id: 42, ...body };
      state.mutations.push({ method, path, body });
      return response(201, state.ruleset);
    }
    if (path === `/repos/${OWNER}/${REPO}/rulesets/42` && method === "PUT") {
      const body = JSON.parse(options.body || "{}");
      state.ruleset = { id: 42, ...body };
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

function controllerDeps(fetchImpl, authorizeApply = async () => ({ ok: true, envelope_id: "env-policy-1" })) {
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
  {
    const mock = createGithubFetch();
    const readback = await readGithubRepositoryPolicy(
      { owner: OWNER, repo: REPO, default_branch: "main" },
      controllerDeps(mock.fetchImpl)
    );
    assert.equal(readback.main_sha, MAIN_SHA);
    assert.equal(readback.branch_protected, false);
    assert.equal(readback.proof.policy_state_readable, true);
    assert.equal(readback.proof.server_policy_gate_complete, false);
    assert.ok(readback.findings.includes("required_review_missing"));
    assert.ok(readback.findings.includes("direct_push_block_unproven"));
    assert.equal(mock.state.mutations.length, 0);
    assert.equal(readback.secrets_included, false);
  }

  {
    const mock = createGithubFetch();
    const readback = await readGithubRepositoryPolicy({ owner: OWNER, repo: REPO }, controllerDeps(mock.fetchImpl));
    const first = buildGithubRepositoryPolicyPlan({ owner: OWNER, repo: REPO }, readback);
    const second = buildGithubRepositoryPolicyPlan({ owner: OWNER, repo: REPO }, readback);
    assert.equal(first.policy_fingerprint, second.policy_fingerprint);
    assert.deepEqual(
      first.desired_ruleset.rules.find((rule) => rule.type === "required_status_checks").parameters.required_status_checks.map((item) => item.context),
      [...GITHUB_REPOSITORY_POLICY_REQUIRED_CHECKS]
    );
    assert.equal(first.desired_ruleset.bypass_actors.length, 0);
    assert.equal(first.desired_ruleset.rules.some((rule) => rule.type === "non_fast_forward"), true);
    assert.throws(
      () => buildGithubRepositoryPolicyPlan({ required_approving_review_count: 0 }, readback),
      (error) => error?.code === "github_repository_policy_unsafe_override_rejected"
    );
    assert.throws(
      () => buildGithubRepositoryPolicyPlan({ required_checks: ["Syntax Check"] }, readback),
      (error) => error?.code === "github_repository_policy_required_checks_invalid"
    );
  }

  {
    let fetchCalls = 0;
    let authorizeCalls = 0;
    const fetchImpl = async () => { fetchCalls += 1; throw new Error("network should not be reached"); };
    await expectCode(
      runGithubRepositoryPolicyController({
        mode: "apply",
        owner: OWNER,
        repo: REPO,
        expected_main_sha: MAIN_SHA,
        expected_policy_fingerprint: "c".repeat(64),
        confirm: "WRONG",
        capability_envelope_id: "env-policy-1",
      }, controllerDeps(fetchImpl, async () => { authorizeCalls += 1; return { ok: true }; })),
      "github_repository_policy_confirmation_invalid"
    );
    assert.equal(fetchCalls, 0);
    assert.equal(authorizeCalls, 0);
  }

  {
    let fetchCalls = 0;
    const fetchImpl = async () => { fetchCalls += 1; throw new Error("network should not be reached"); };
    await expectCode(
      runGithubRepositoryPolicyController({
        mode: "apply",
        owner: OWNER,
        repo: REPO,
        expected_main_sha: MAIN_SHA,
        expected_policy_fingerprint: "c".repeat(64),
        confirm: GITHUB_REPOSITORY_POLICY_CONFIRMATION,
        capability_envelope_id: "missing-envelope",
      }, controllerDeps(fetchImpl, async () => ({ ok: false }))),
      "github_repository_policy_capability_envelope_invalid"
    );
    assert.equal(fetchCalls, 0);
  }

  {
    const mock = createGithubFetch({ classicStatus: 403 });
    const planResult = await runGithubRepositoryPolicyController(
      { mode: "plan", owner: OWNER, repo: REPO },
      controllerDeps(mock.fetchImpl)
    );
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
    const planResult = await runGithubRepositoryPolicyController(
      { mode: "plan", owner: OWNER, repo: REPO },
      controllerDeps(mock.fetchImpl)
    );
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
    const initialRuleset = desiredRuleset({
      bypassActors: [{ actor_id: APP_ID, actor_type: "Integration", bypass_mode: "always" }],
    });
    const mock = createGithubFetch({ initialRuleset });
    const planResult = await runGithubRepositoryPolicyController(
      { mode: "plan", owner: OWNER, repo: REPO },
      controllerDeps(mock.fetchImpl)
    );
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
    const planResult = await runGithubRepositoryPolicyController(
      { mode: "plan", owner: OWNER, repo: REPO },
      controllerDeps(mock.fetchImpl)
    );
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
    assert.equal(applied.postconditions.server_policy_gate_complete, true);
    assert.equal(applied.readback.proof.server_policy_gate_complete, true);
    assert.equal(mock.state.mutations.filter((item) => item.method === "POST").length, 1);
    assert.equal(mock.state.mutations.some((item) => item.method === "DELETE"), false);
    assert.equal(JSON.stringify(applied).includes("test-installation-token"), false);
    assert.equal(applied.secrets_included, false);
  }

  {
    const mock = createGithubFetch({ postReadbackRuleset: desiredRuleset({ missingCheck: "Execute current phase journeys" }) });
    const planResult = await runGithubRepositoryPolicyController(
      { mode: "plan", owner: OWNER, repo: REPO },
      controllerDeps(mock.fetchImpl)
    );
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
    await expectCode(
      readGithubRepositoryPolicy({ owner: OWNER, repo: REPO, api_token: "ghp_should_never_be_accepted" }, controllerDeps(async () => response(500, {}))),
      "github_repository_policy_secret_field_rejected"
    );
  }

  console.log(JSON.stringify({
    ok: true,
    test: "github_repository_policy_controller_fail_closed",
    readback_zero_rules_incomplete: true,
    inaccessible_policy_blocks_apply: true,
    stale_sha_blocks_apply: true,
    invalid_envelope_blocks_before_network: true,
    typed_confirmation_required: true,
    bypass_actor_blocks_apply: true,
    exact_plan_applies_once: true,
    postcondition_mismatch_rolls_back: true,
    secrets_included: false,
  }));
} finally {
  if (previousAppId === undefined) delete process.env.GITHUB_APP_ID;
  else process.env.GITHUB_APP_ID = previousAppId;
  if (previousInstallationId === undefined) delete process.env.GITHUB_APP_INSTALLATION_ID;
  else process.env.GITHUB_APP_INSTALLATION_ID = previousInstallationId;
}
