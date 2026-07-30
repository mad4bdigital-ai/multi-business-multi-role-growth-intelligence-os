#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptFile = fileURLToPath(import.meta.url);
const apiRoot = path.resolve(path.dirname(scriptFile), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(apiRoot, relativePath), "utf8");
}

function write(relativePath, content) {
  fs.writeFileSync(path.join(apiRoot, relativePath), content, "utf8");
}

function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(`Missing ${label}`);
  if (source.indexOf(needle, first + needle.length) >= 0) throw new Error(`Ambiguous ${label}`);
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

function replaceBlock(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) throw new Error(`Missing ${label}`);
  return source.slice(0, start) + replacement + source.slice(end);
}

const rolloutTestPath = "test-dynamic-container-rollout-safety.mjs";
let rolloutTest = read(rolloutTestPath);
const canaryClaims = `// frontend-surface-operation: POST /admin/container-authority/canary-promotions
// frontend-state-change-proof: POST /admin/container-authority/canary-promotions
// frontend-surface-operation: POST /admin/container-authority/canary-rollbacks
// frontend-state-change-proof: POST /admin/container-authority/canary-rollbacks
`;
if (!rolloutTest.includes("POST /admin/container-authority/canary-promotions")) {
  rolloutTest = replaceOnce(
    rolloutTest,
    `import { runContainerQueryPlanPreflight } from "./dynamicContainerQueryPlanPreflight.js";\n`,
    `import { runContainerQueryPlanPreflight } from "./dynamicContainerQueryPlanPreflight.js";\n${canaryClaims}`,
    "dynamic-container query-plan import",
  );
}
write(rolloutTestPath, rolloutTest);

const generatorPath = "scripts/frontend-operation-governance-generator.mjs";
let generator = read(generatorPath);
const canaryImplementation = `const CANARY_RECIPES = [
  {
    recipe_id: "dynamic-container-canary-promotion-transaction-v1",
    rule_id: "generated-dynamic-container-canary-promotion-governance",
    operation: "POST /admin/container-authority/canary-promotions",
    service_function: "runContainerCanaryPromotion",
    mutation_sql: "SET rollout_mode='read_only_canary'",
    rationale: "Promotes one exact read-only canary only after capability-envelope authorization, rollout-readiness validation, and typed confirmation, then verifies the exact promoted state and consumes the envelope before committing one SQL transaction.",
    preflight_mode: "capability_envelope_and_rollout_readiness_check",
    approval_mode: "runtime_authorization_and_typed_confirmation",
    parameter_bindings: {
      target_canary_key: "request.body.targetCanaryKey",
      capability_envelope_id: "request.body.capabilityEnvelopeId",
      confirmation: "request.body.confirm",
      rollout_mode: "response.readback.rollout_mode",
    },
  },
  {
    recipe_id: "dynamic-container-canary-rollback-transaction-v1",
    rule_id: "generated-dynamic-container-canary-rollback-governance",
    operation: "POST /admin/container-authority/canary-rollbacks",
    service_function: "runContainerCanaryRollback",
    mutation_sql: "SET rollout_mode='shadow'",
    rationale: "Returns one exact active canary to shadow mode only after capability-envelope authorization and typed confirmation, then verifies the exact shadow state and consumes the envelope before committing one SQL transaction.",
    preflight_mode: "capability_envelope_and_active_canary_lock",
    approval_mode: "runtime_authorization_and_typed_confirmation",
    parameter_bindings: {
      target_canary_key: "request.body.targetCanaryKey",
      capability_envelope_id: "request.body.capabilityEnvelopeId",
      confirmation: "request.body.confirm",
      reason: "request.body.reason|runtime_canary_not_observed",
      rollout_mode: "response.readback.rollout_mode",
    },
  },
  {
    recipe_id: "dynamic-container-canary-closeout-transaction-v1",
    rule_id: "generated-dynamic-container-canary-closeout-governance",
    operation: "POST /admin/container-authority/canary-closeouts",
    service_function: "runContainerCanaryCloseout",
    mutation_sql: "SET rollout_mode='shadow'",
    rationale: "Applies a capability-envelope-authorized canary closeout only after typed confirmation, then verifies the exact accepted shadow state and consumes the envelope before committing one SQL transaction.",
    preflight_mode: "capability_envelope_and_monitoring_check",
    approval_mode: "runtime_authorization_and_typed_confirmation",
    parameter_bindings: {
      target_canary_key: "request.body.targetCanaryKey",
      capability_envelope_id: "request.body.capabilityEnvelopeId",
      confirmation: "request.body.confirm",
      canary_key: "response.readback.canary_key",
    },
  },
];

function evaluateCanaryRecipe(recipe, context) {
  const normalizedRecipe = {
    ...recipe,
    source_file: CANARY_ROUTE_FILE,
    owner: "platform-governance",
  };
  const route = context.canaryRoutes.get(normalizedRecipe.operation);
  const serviceBlock = extractFunctionBlock(
    context.sourceByFile.get(CANARY_SERVICE_FILE),
    normalizedRecipe.service_function,
  );
  const claimedTests = context.testEvidence.byOperation.get(normalizedRecipe.operation) || [];
  const readbackSql = "FROM container_shadow_canary_registry WHERE canary_key=? LIMIT 1";
  const gates = [
    evidenceGate("route_present", route, CANARY_ROUTE_FILE),
    evidenceGate("admin_guard", route?.route_guards?.includes("requireAdminPrincipal") && route?.route_guards?.includes("requireBackendApiKey"), "requireAdminPrincipal/requireBackendApiKey"),
    evidenceGate("route_service_binding", route?.declaration?.includes(normalizedRecipe.service_function), normalizedRecipe.service_function),
    evidenceGate("service_function_present", serviceBlock, normalizedRecipe.service_function),
    evidenceGate("transaction_begin_commit", serviceBlock.includes("beginTransaction") && serviceBlock.includes("executor.commit"), "beginTransaction/commit"),
    evidenceGate("transaction_rollback", serviceBlock.includes("executor.rollback"), "executor.rollback"),
    evidenceGate("capability_envelope_preflight", serviceBlock.includes("resolveCapabilityExecutionEnvelope") && serviceBlock.includes("envelope.apply_allowed"), "capability envelope/apply_allowed"),
    evidenceGate("typed_confirmation", serviceBlock.includes("confirm !== plan.confirmation"), "plan.confirmation"),
    evidenceGate("mutation_present", serviceBlock.includes(normalizedRecipe.mutation_sql), normalizedRecipe.mutation_sql),
    evidenceGate("transactional_readback_follows_mutation", ordered(serviceBlock, normalizedRecipe.mutation_sql, readbackSql), readbackSql),
    evidenceGate("envelope_consumed_before_commit", ordered(serviceBlock, "transitionCapabilityEnvelopeLifecycle", "executor.commit"), "envelope lifecycle/commit"),
    evidenceGate("provider_write_denial", serviceBlock.includes("providerCalls:false") && serviceBlock.includes("externalWrites:false"), "providerCalls:false/externalWrites:false"),
    evidenceGate("registered_operation_test", claimedTests.includes(CANARY_TEST_FILE), CANARY_TEST_FILE),
  ];
  return {
    recipe: normalizedRecipe,
    gates,
    evidenceFiles: [CANARY_ROUTE_FILE, CANARY_SERVICE_FILE, CANARY_TEST_FILE],
  };
}

`;
if (!generator.includes("dynamic-container-canary-promotion-transaction-v1")) {
  generator = replaceBlock(
    generator,
    "function evaluateCanaryRecipe(context) {",
    "function evaluateBootstrapRecipe(context) {",
    `${canaryImplementation}function evaluateBootstrapRecipe(context) {`,
    "legacy canary evaluator",
  );
  generator = replaceOnce(
    generator,
    "    evaluateCanaryRecipe(context),",
    "    ...CANARY_RECIPES.map((recipe) => evaluateCanaryRecipe(recipe, context)),",
    "canary evaluation registration",
  );
}
write(generatorPath, generator);

const generatorTestPath = "test-frontend-operation-governance-generator.mjs";
let generatorTest = read(generatorTestPath);
if (!generatorTest.includes('"POST /admin/container-authority/canary-promotions"')) {
  generatorTest = replaceOnce(
    generatorTest,
    '  "POST /admin/container-authority/canary-closeouts",\n',
    '  "POST /admin/container-authority/canary-closeouts",\n  "POST /admin/container-authority/canary-promotions",\n  "POST /admin/container-authority/canary-rollbacks",\n',
    "expected canary operation list",
  );
  generatorTest = generatorTest.replaceAll("candidate_count: 6", "candidate_count: 8");
  generatorTest = generatorTest.replaceAll("generated_rule_count: 6", "generated_rule_count: 8");
  generatorTest = generatorTest.replaceAll("generated_rule_count, 6", "generated_rule_count, 8");
}
write(generatorTestPath, generatorTest);

console.log("PR #2948 clean-scope source port applied");
