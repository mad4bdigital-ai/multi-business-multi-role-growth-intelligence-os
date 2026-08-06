import { readFileSync, writeFileSync } from "node:fs";

function replaceExact(source, from, to, expectedCount, label) {
  const count = source.split(from).length - 1;
  if (count !== expectedCount) {
    throw new Error(`${label}: expected ${expectedCount} occurrence(s), found ${count}`);
  }
  return source.split(from).join(to);
}

const controllerPath = "http-generic-api/githubRepositoryPolicyController.js";
let controller = readFileSync(controllerPath, "utf8");
controller = replaceExact(
  controller,
  '  const expectedMainSha = compact(expected_main_sha, 40).toLowerCase();',
  '  const expectedMainSha = String(expected_main_sha ?? "").trim().toLowerCase();',
  1,
  "controller capability main SHA normalization"
);
controller = replaceExact(
  controller,
  '  const expectedPolicyFingerprint = compact(expected_policy_fingerprint, 64).toLowerCase();',
  '  const expectedPolicyFingerprint = String(expected_policy_fingerprint ?? "").trim().toLowerCase();',
  1,
  "controller capability fingerprint normalization"
);
controller = replaceExact(
  controller,
  '  const currentMainSha = readback?.main_sha || compact(args.expected_main_sha || "", 40) || null;',
  '  const requestedMainSha = String(args.expected_main_sha ?? "").trim().toLowerCase();\n  const currentMainSha = readback?.main_sha || requestedMainSha || null;',
  1,
  "controller plan main SHA normalization"
);
controller = replaceExact(
  controller,
  '  const expectedMainSha = compact(args.expected_main_sha || "", 40).toLowerCase();',
  '  const expectedMainSha = String(args.expected_main_sha ?? "").trim().toLowerCase();',
  2,
  "controller apply main SHA normalization"
);
controller = replaceExact(
  controller,
  '  const expectedFingerprint = compact(args.expected_policy_fingerprint || args.policy_fingerprint || "", 64).toLowerCase();',
  '  const expectedFingerprint = String(args.expected_policy_fingerprint ?? args.policy_fingerprint ?? "").trim().toLowerCase();',
  2,
  "controller apply fingerprint normalization"
);
controller = replaceExact(
  controller,
  '  if (compact(args.confirm || "", 128) !== GITHUB_REPOSITORY_POLICY_CONFIRMATION) {',
  '  if (String(args.confirm ?? "").trim() !== GITHUB_REPOSITORY_POLICY_CONFIRMATION) {',
  2,
  "controller typed confirmation normalization"
);
writeFileSync(controllerPath, controller);

const facadePath = "http-generic-api/repositoryAutomationPolicyFacade.js";
let facade = readFileSync(facadePath, "utf8");
facade = replaceExact(
  facade,
  `const SECRET_VALUE_PATTERNS = [
  /Bearer\\s+[A-Za-z0-9._~+\\-/]+=*/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\\b(?:ghp_|github_pat_|ghs_)[A-Za-z0-9_.\\-]+\\b/,
];`,
  `const SECRET_VALUE_PATTERNS = [
  /Bearer\\s+[A-Za-z0-9._~+\\-/]+=*/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\\b(?:ghp_|github_pat_|ghs_)[A-Za-z0-9_.\\-]+\\b/,
];
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/i;`,
  1,
  "facade authority patterns"
);
facade = replaceExact(
  facade,
  `  const capabilityEnvelopeId = compact(input.capability_envelope_id || "", 64);
  const applyBinding = mode === "apply" ? {
    expected_main_sha: compact(input.expected_main_sha || "", 40).toLowerCase() || null,
    expected_policy_fingerprint: compact(input.expected_policy_fingerprint || input.policy_fingerprint || "", 64).toLowerCase() || null,
    capability_envelope_ref_sha256: capabilityEnvelopeId ? sha256(capabilityEnvelopeId) : null,
    typed_confirmation_matches: compact(input.confirm || "", 128) === GITHUB_REPOSITORY_POLICY_CONFIRMATION,
    secrets_included: false,
  } : null;`,
  `  const capabilityEnvelopeId = String(input.capability_envelope_id ?? "").trim();
  const expectedMainShaInput = String(input.expected_main_sha ?? "").trim().toLowerCase();
  const expectedPolicyFingerprintInput = String(input.expected_policy_fingerprint ?? input.policy_fingerprint ?? "").trim().toLowerCase();
  const typedConfirmationInput = String(input.confirm ?? "").trim();
  const applyBinding = mode === "apply" ? {
    expected_main_sha: SHA_PATTERN.test(expectedMainShaInput) ? expectedMainShaInput : null,
    expected_main_sha_input_sha256: sha256(expectedMainShaInput),
    expected_main_sha_valid: SHA_PATTERN.test(expectedMainShaInput),
    expected_policy_fingerprint: FINGERPRINT_PATTERN.test(expectedPolicyFingerprintInput) ? expectedPolicyFingerprintInput : null,
    expected_policy_fingerprint_input_sha256: sha256(expectedPolicyFingerprintInput),
    expected_policy_fingerprint_valid: FINGERPRINT_PATTERN.test(expectedPolicyFingerprintInput),
    capability_envelope_ref_sha256: capabilityEnvelopeId ? sha256(capabilityEnvelopeId) : null,
    capability_envelope_present: capabilityEnvelopeId.length > 0,
    typed_confirmation_sha256: sha256(typedConfirmationInput),
    typed_confirmation_matches: typedConfirmationInput === GITHUB_REPOSITORY_POLICY_CONFIRMATION,
    secrets_included: false,
  } : null;`,
  1,
  "facade apply binding"
);
writeFileSync(facadePath, facade);

const testPath = "http-generic-api/test-repository-automation-policy-facade.mjs";
let test = readFileSync(testPath, "utf8");
test = replaceExact(
  test,
  `  buildRepositoryAutomationPlan,
  runRepositoryAutomation,`,
  `  buildRepositoryAutomationPlan,
  runGithubRepositoryPolicyController,
  runRepositoryAutomation,`,
  1,
  "test controller import"
);
test = replaceExact(
  test,
  `assert.equal(applyPlanEnvelopeOne.apply_binding.typed_confirmation_matches, true);
assert.match(applyPlanEnvelopeOne.apply_binding.capability_envelope_ref_sha256, /^[a-f0-9]{64}$/);`,
  `assert.equal(applyPlanEnvelopeOne.apply_binding.expected_main_sha_valid, true);
assert.equal(applyPlanEnvelopeOne.apply_binding.expected_policy_fingerprint_valid, true);
assert.equal(applyPlanEnvelopeOne.apply_binding.capability_envelope_present, true);
assert.equal(applyPlanEnvelopeOne.apply_binding.typed_confirmation_matches, true);
assert.match(applyPlanEnvelopeOne.apply_binding.expected_main_sha_input_sha256, /^[a-f0-9]{64}$/);
assert.match(applyPlanEnvelopeOne.apply_binding.expected_policy_fingerprint_input_sha256, /^[a-f0-9]{64}$/);
assert.match(applyPlanEnvelopeOne.apply_binding.capability_envelope_ref_sha256, /^[a-f0-9]{64}$/);
assert.match(applyPlanEnvelopeOne.apply_binding.typed_confirmation_sha256, /^[a-f0-9]{64}$/);`,
  1,
  "test valid apply binding assertions"
);
test = replaceExact(
  test,
  `assert.equal(JSON.stringify(applyPlanEnvelopeOne).includes("env-policy-1"), false);

const calls = [];`,
  `assert.equal(JSON.stringify(applyPlanEnvelopeOne).includes("env-policy-1"), false);

const applyPlanOverlongMain = buildRepositoryAutomationPlan({
  automation_key: "repository_policy",
  mode: "apply",
  owner: OWNER,
  repo: REPO,
  default_branch: "main",
  expected_main_sha: \`${'${MAIN_SHA}'}0\`,
  expected_policy_fingerprint: policyPlan.policy_fingerprint,
  confirm: GITHUB_REPOSITORY_POLICY_CONFIRMATION,
  capability_envelope_id: "env-policy-1",
});
const applyPlanOverlongFingerprint = buildRepositoryAutomationPlan({
  automation_key: "repository_policy",
  mode: "apply",
  owner: OWNER,
  repo: REPO,
  default_branch: "main",
  expected_main_sha: MAIN_SHA,
  expected_policy_fingerprint: \`${'${policyPlan.policy_fingerprint}'}0\`,
  confirm: GITHUB_REPOSITORY_POLICY_CONFIRMATION,
  capability_envelope_id: "env-policy-1",
});
assert.equal(applyPlanOverlongMain.apply_binding.expected_main_sha, null);
assert.equal(applyPlanOverlongMain.apply_binding.expected_main_sha_valid, false);
assert.equal(applyPlanOverlongFingerprint.apply_binding.expected_policy_fingerprint, null);
assert.equal(applyPlanOverlongFingerprint.apply_binding.expected_policy_fingerprint_valid, false);
assert.notEqual(applyPlanEnvelopeOne.plan_sha256, applyPlanOverlongMain.plan_sha256);
assert.notEqual(applyPlanEnvelopeOne.plan_sha256, applyPlanOverlongFingerprint.plan_sha256);

await assert.rejects(
  runGithubRepositoryPolicyController({
    mode: "apply",
    owner: OWNER,
    repo: REPO,
    expected_main_sha: \`${'${MAIN_SHA}'}0\`,
    expected_policy_fingerprint: policyPlan.policy_fingerprint,
    confirm: GITHUB_REPOSITORY_POLICY_CONFIRMATION,
  }, { auth: { caller_type: "admin" } }),
  (error) => error?.code === "github_repository_policy_expected_main_sha_required"
);
await assert.rejects(
  runGithubRepositoryPolicyController({
    mode: "apply",
    owner: OWNER,
    repo: REPO,
    expected_main_sha: MAIN_SHA,
    expected_policy_fingerprint: \`${'${policyPlan.policy_fingerprint}'}0\`,
    confirm: GITHUB_REPOSITORY_POLICY_CONFIRMATION,
  }, { auth: { caller_type: "admin" } }),
  (error) => error?.code === "github_repository_policy_fingerprint_required"
);

const calls = [];`,
  1,
  "test overlong authority regressions"
);
test = replaceExact(
  test,
  `  apply_idempotency_bound_to_main_policy_and_envelope: true,
  capability_envelope_reference_not_exposed: true,`,
  `  apply_idempotency_bound_to_main_policy_and_envelope: true,
  overlong_authority_values_rejected_without_truncation: true,
  invalid_authority_inputs_have_distinct_plan_identity: true,
  capability_envelope_reference_not_exposed: true,`,
  1,
  "test result claims"
);
writeFileSync(testPath, test);

console.log(JSON.stringify({
  ok: true,
  files: [controllerPath, facadePath, testPath],
  strict_authority_normalization: true,
  temporary_files_included: false,
}));
