import { readFileSync, writeFileSync } from "node:fs";

function replaceExact(source, from, to, expectedCount, label) {
  const count = source.split(from).length - 1;
  if (count !== expectedCount) {
    throw new Error(`${label}: expected ${expectedCount} occurrence(s), found ${count}`);
  }
  return source.split(from).join(to);
}

const facadePath = "http-generic-api/repositoryAutomationPolicyFacade.js";
let facade = readFileSync(facadePath, "utf8");
facade = replaceExact(
  facade,
  `  const runId = compact(input.run_id || "", 64) || randomUUID();
  const idempotencyKey = compact(input.idempotency_key || \`repository-policy:${'${plan.plan_sha256}'}\`, 191);`,
  `  const runId = compact(input.run_id || "", 64) || randomUUID();
  const requestedIdempotencyKey = String(input.idempotency_key ?? "").trim();
  const idempotencyKey = requestedIdempotencyKey
    ? \`repository-policy:${'${sha256({ requested_idempotency_key: requestedIdempotencyKey, plan_sha256: plan.plan_sha256 })}'}\`
    : \`repository-policy:${'${plan.plan_sha256}'}\`;`,
  1,
  "policy custom idempotency binding"
);
writeFileSync(facadePath, facade);

const testPath = "http-generic-api/test-repository-automation-policy-facade.mjs";
let test = readFileSync(testPath, "utf8");
test = replaceExact(
  test,
  `assert.equal(applied.repository_content_mutation_executed, false);
assert.equal(applied.force_push_executed, false);
assert.equal(applied.secrets_included, false);

let capturedApply = null;`,
  `assert.equal(applied.repository_content_mutation_executed, false);
assert.equal(applied.force_push_executed, false);
assert.equal(applied.secrets_included, false);

const persistedIdempotencyKeys = [];
function persistencePool() {
  return {
    async query(sql, params = []) {
      if (sql.includes("SELECT run_id FROM repository_automation_runs")) {
        persistedIdempotencyKeys.push(params[0]);
      }
      return [[]];
    },
  };
}
const persistenceController = async (args) => {
  if (args.mode === "readback") return readback;
  if (args.mode === "apply") {
    return {
      contract: "github-repository-policy-controller-v1",
      mode: "apply",
      policy_fingerprint: policyPlan.policy_fingerprint,
      mutation: { operation: "create_ruleset", ruleset_id: 42 },
      mutation_executed: true,
      readback: {
        ...readback,
        proof: { ...readback.proof, server_policy_gate_complete: true },
      },
      secrets_included: false,
    };
  }
  throw new Error(\`unexpected mode ${'${args.mode}'}\`);
};
for (const capabilityEnvelopeId of ["env-policy-1", "env-policy-2"]) {
  await runRepositoryAutomation({
    automation_key: "repository_policy",
    mode: "apply",
    owner: OWNER,
    repo: REPO,
    default_branch: "main",
    expected_main_sha: MAIN_SHA,
    expected_policy_fingerprint: policyPlan.policy_fingerprint,
    confirm: GITHUB_REPOSITORY_POLICY_CONFIRMATION,
    capability_envelope_id: capabilityEnvelopeId,
    idempotency_key: "customer-retry-key",
  }, {
    persist: true,
    pool: persistencePool(),
    policyController: persistenceController,
    auth: { caller_type: "admin" },
  });
}
assert.equal(persistedIdempotencyKeys.length, 2);
assert.match(persistedIdempotencyKeys[0], /^repository-policy:[a-f0-9]{64}$/);
assert.match(persistedIdempotencyKeys[1], /^repository-policy:[a-f0-9]{64}$/);
assert.notEqual(persistedIdempotencyKeys[0], persistedIdempotencyKeys[1]);

let capturedApply = null;`,
  1,
  "custom idempotency persistence regression"
);
test = replaceExact(
  test,
  `  apply_idempotency_bound_to_main_policy_and_envelope: true,
  overlong_authority_values_rejected_without_truncation: true,`,
  `  apply_idempotency_bound_to_main_policy_and_envelope: true,
  caller_supplied_idempotency_key_bound_to_plan_identity: true,
  overlong_authority_values_rejected_without_truncation: true,`,
  1,
  "custom idempotency result claim"
);
writeFileSync(testPath, test);

console.log(JSON.stringify({
  ok: true,
  files: [facadePath, testPath],
  caller_idempotency_bound_to_plan: true,
}));
