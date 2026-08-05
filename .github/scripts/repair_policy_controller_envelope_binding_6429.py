from pathlib import Path
from textwrap import dedent

CONTROLLER_PATH = Path("http-generic-api/githubRepositoryPolicyController.js")
TEST_PATH = Path("http-generic-api/test-github-repository-policy-controller.mjs")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


controller = CONTROLLER_PATH.read_text()
tests = TEST_PATH.read_text()

unique_marker = dedent("""\
function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => compact(value, 255)).filter(Boolean))];
}
""")
unique_replacement = unique_marker + dedent("""\

export function buildGithubRepositoryPolicyCapabilityBinding({
  target = {},
  expected_main_sha = "",
  expected_policy_fingerprint = "",
} = {}) {
  const owner = compact(target.owner || "", 191);
  const repo = compact(target.repo || "", 191);
  const branch = compact(target.default_branch || "main", 191) || "main";
  const expectedMainSha = compact(expected_main_sha, 40).toLowerCase();
  const expectedPolicyFingerprint = compact(expected_policy_fingerprint, 64).toLowerCase();
  if (!owner || !repo || branch !== "main" || !SHA_PATTERN.test(expectedMainSha) || !FINGERPRINT_PATTERN.test(expectedPolicyFingerprint)) {
    return null;
  }
  const resourceUri = `github://${owner}/${repo}/branch/${branch}`;
  const bindingSha256 = githubRepositoryPolicyFingerprint({
    contract: GITHUB_REPOSITORY_POLICY_CONTROLLER_VERSION,
    capability_key: "repository_policy_controller",
    operation_intent: "github_repository_policy_apply",
    resource_uri: resourceUri,
    expected_main_sha: expectedMainSha,
    expected_policy_fingerprint: expectedPolicyFingerprint,
  });
  return {
    resource_uri: resourceUri,
    expected_commit_sha: expectedMainSha,
    expected_policy_fingerprint: expectedPolicyFingerprint,
    binding_sha256: bindingSha256,
    capability_sha256: expectedPolicyFingerprint,
    secrets_included: false,
  };
}
""")
if "export function buildGithubRepositoryPolicyCapabilityBinding" in controller:
    raise SystemExit("capability binding helper already exists")
controller = replace_once(controller, unique_marker, unique_replacement, "insert capability binding helper")

plan_marker = dedent("""\
  const policyFingerprint = githubRepositoryPolicyFingerprint({
    target,
    expected_main_sha: currentMainSha,
    desired_ruleset: desiredRuleset,
  });
  return {
""")
plan_replacement = dedent("""\
  const policyFingerprint = githubRepositoryPolicyFingerprint({
    target,
    expected_main_sha: currentMainSha,
    desired_ruleset: desiredRuleset,
  });
  const capabilityAuthorization = buildGithubRepositoryPolicyCapabilityBinding({
    target,
    expected_main_sha: currentMainSha,
    expected_policy_fingerprint: policyFingerprint,
  });
  return {
""")
controller = replace_once(controller, plan_marker, plan_replacement, "add plan authorization binding")
controller = replace_once(
    controller,
    '    policy_fingerprint: policyFingerprint,\n    operation: existingManagedRuleset ? "update_ruleset" : "create_ruleset",\n',
    '    policy_fingerprint: policyFingerprint,\n    capability_authorization: capabilityAuthorization,\n    operation: existingManagedRuleset ? "update_ruleset" : "create_ruleset",\n',
    "expose plan authorization binding",
)

start = controller.index("async function authorizeApply(args, deps, target) {")
end = controller.index("\nfunction validateApplyInputs", start)
authorization_function = dedent("""\
async function authorizeApply(args, deps, target) {
  const authorization = buildGithubRepositoryPolicyCapabilityBinding({
    target,
    expected_main_sha: args.expected_main_sha,
    expected_policy_fingerprint: args.expected_policy_fingerprint || args.policy_fingerprint,
  });
  if (!authorization) {
    throw controllerError(400, "github_repository_policy_capability_binding_invalid", "Policy apply requires a complete repository, main SHA, and policy fingerprint binding.");
  }

  if (typeof deps.authorizeApply === "function") {
    const result = await deps.authorizeApply({ args, target, authorization, auth: deps.auth || {} });
    if (!result?.ok) throw controllerError(403, "github_repository_policy_capability_envelope_invalid", "Policy apply requires a valid capability envelope.");
    if (result.apply_allowed !== true) {
      throw capabilityEnvelopeError({
        ok: false,
        status: "capability_resolution_envelope_apply_not_allowed",
        envelope_id: result.envelope_id || null,
        secrets_included: false,
      }, "GitHub main policy apply requires an apply-authorized capability resolution envelope.");
    }
    return { ...result, authorization, secrets_included: false };
  }

  const pool = deps.pool || getPool();
  const acceptedIntents = [
    "github_repository_policy_apply",
    "repository_policy_controller",
    "github_main_review_policy",
  ];
  const resolver = deps.resolveCapabilityExecutionEnvelope || resolveCapabilityExecutionEnvelope;
  const marker = deps.markCapabilityEnvelopeReferenced || markCapabilityEnvelopeReferenced;
  const resolved = await resolver({
    pool,
    source: args,
    acceptedAppKeys: ["github"],
    acceptedIntents,
    acceptedCapabilityKeys: ["repository_policy_controller"],
    expectedTenantId: deps.auth?.tenant_id || PLATFORM_TENANT_ID,
    expectedUserId: deps.auth?.user_id || deps.auth?.admin_id || "",
    expectedResourceUri: authorization.resource_uri,
    expectedCommitSha: authorization.expected_commit_sha,
    requireCommitHint: true,
    expectedBindingSha256: authorization.binding_sha256,
    expectedCapabilitySha256: authorization.capability_sha256,
  });
  if (!resolved.ok) {
    throw capabilityEnvelopeError(resolved, "GitHub main policy apply requires a valid capability resolution envelope.");
  }
  if (resolved.apply_allowed !== true) {
    throw capabilityEnvelopeError({
      ok: false,
      status: "capability_resolution_envelope_apply_not_allowed",
      envelope_id: resolved.envelope_id,
      secrets_included: false,
    }, "GitHub main policy apply requires an apply-authorized capability resolution envelope.");
  }
  if (
    resolved.app_key !== "github"
    || resolved.capability_key !== "repository_policy_controller"
    || !acceptedIntents.includes(String(resolved.operation_intent || "").trim().toLowerCase())
    || resolved.resource_uri !== authorization.resource_uri
    || resolved.expected_commit_sha !== authorization.expected_commit_sha
    || resolved.binding_sha256 !== authorization.binding_sha256
    || resolved.capability_sha256 !== authorization.capability_sha256
  ) {
    throw capabilityEnvelopeError({
      ok: false,
      status: "capability_resolution_envelope_policy_binding_mismatch",
      envelope_id: resolved.envelope_id,
      secrets_included: false,
    }, "GitHub main policy apply requires an envelope bound to the exact repository, main SHA, and policy fingerprint.");
  }
  await marker({
    pool,
    envelopeId: resolved.envelope_id,
    executionRef: `github_repository_policy_apply:${target.owner}/${target.repo}:${target.default_branch}:${authorization.expected_commit_sha}:${authorization.expected_policy_fingerprint}`,
  });
  return { ...resolved, authorization, secrets_included: false };
}
""")
controller = controller[:start] + authorization_function + controller[end:]

tests = replace_once(
    tests,
    "  GITHUB_REPOSITORY_POLICY_RULESET_NAME,\n  buildGithubRepositoryPolicyPlan,\n",
    "  GITHUB_REPOSITORY_POLICY_RULESET_NAME,\n  buildGithubRepositoryPolicyCapabilityBinding,\n  buildGithubRepositoryPolicyPlan,\n",
    "import capability binding helper",
)
tests = replace_once(
    tests,
    'function controllerDeps(fetchImpl, authorizeApply = async () => ({ ok: true, envelope_id: "env-policy-1" })) {\n',
    'function controllerDeps(fetchImpl, authorizeApply = async () => ({ ok: true, envelope_id: "env-policy-1", apply_allowed: true })) {\n',
    "require apply permission in test authorization",
)

envelope_test_marker = dedent("""\
  {
    const mock = createGithubFetch({ classicStatus: 403 });
""")
envelope_test = dedent("""\
  {
    let resolverOptions = null;
    let fetchCalls = 0;
    let markCalls = 0;
    const expectedPolicyFingerprint = "c".repeat(64);
    const expectedAuthorization = buildGithubRepositoryPolicyCapabilityBinding({
      target: { owner: OWNER, repo: REPO, default_branch: "main" },
      expected_main_sha: MAIN_SHA,
      expected_policy_fingerprint: expectedPolicyFingerprint,
    });
    await expectCode(
      runGithubRepositoryPolicyController({
        mode: "apply",
        owner: OWNER,
        repo: REPO,
        expected_main_sha: MAIN_SHA,
        expected_policy_fingerprint: expectedPolicyFingerprint,
        confirm: GITHUB_REPOSITORY_POLICY_CONFIRMATION,
        capability_envelope_id: "env-policy-no-apply",
      }, {
        token: "test-installation-token",
        fetchImpl: async () => { fetchCalls += 1; throw new Error("network should not be reached"); },
        auth: { caller_type: "admin", tenant_id: "tenant-1", user_id: "admin-1" },
        resolveCapabilityExecutionEnvelope: async (options) => {
          resolverOptions = options;
          return {
            ok: true,
            envelope_id: "env-policy-no-apply",
            app_key: "github",
            capability_key: "repository_policy_controller",
            operation_intent: "github_repository_policy_apply",
            resource_uri: expectedAuthorization.resource_uri,
            expected_commit_sha: expectedAuthorization.expected_commit_sha,
            binding_sha256: expectedAuthorization.binding_sha256,
            capability_sha256: expectedAuthorization.capability_sha256,
            apply_allowed: false,
            secrets_included: false,
          };
        },
        markCapabilityEnvelopeReferenced: async () => { markCalls += 1; },
      }),
      "capability_resolution_envelope_apply_not_allowed"
    );
    assert.equal(fetchCalls, 0);
    assert.equal(markCalls, 0);
    assert.deepEqual(resolverOptions.acceptedAppKeys, ["github"]);
    assert.deepEqual(resolverOptions.acceptedCapabilityKeys, ["repository_policy_controller"]);
    assert.equal(resolverOptions.expectedResourceUri, expectedAuthorization.resource_uri);
    assert.equal(resolverOptions.expectedCommitSha, MAIN_SHA);
    assert.equal(resolverOptions.requireCommitHint, true);
    assert.equal(resolverOptions.expectedBindingSha256, expectedAuthorization.binding_sha256);
    assert.equal(resolverOptions.expectedCapabilitySha256, expectedPolicyFingerprint);
  }

""") + envelope_test_marker
tests = replace_once(tests, envelope_test_marker, envelope_test, "add exact envelope binding regression")
tests = replace_once(
    tests,
    "    invalid_envelope_blocks_before_network: true,\n    typed_confirmation_required: true,\n",
    "    invalid_envelope_blocks_before_network: true,\n    exact_envelope_binding_required: true,\n    apply_allowed_required: true,\n    typed_confirmation_required: true,\n",
    "extend regression summary",
)

CONTROLLER_PATH.write_text(controller)
TEST_PATH.write_text(tests)
