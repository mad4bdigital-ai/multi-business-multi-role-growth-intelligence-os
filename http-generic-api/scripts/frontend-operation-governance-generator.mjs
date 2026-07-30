#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  parseRoutesFromFile,
  parseTestEvidenceClaims,
} from "./frontend-surface-dispatch.mjs";

const DEFAULT_OUTPUT = "frontend-operation-governance.generated.json";
const RESOURCE_ROUTE_FILE = "routes/resourceApiRoutes.js";
const RESOURCE_SERVICE_FILE = "src/application/resourceApi/resourceApiService.js";
const RESOURCE_REPOSITORY_FILE = "src/infrastructure/resourceApi/resourceRepository.js";
const RESOURCE_TEST_FILE = "test-resource-api-service.mjs";
const CANARY_ROUTE_FILE = "routes/dynamicContainerAuthorityRoutes.js";
const CANARY_SERVICE_FILE = "dynamicContainerRolloutSafety.js";
const CANARY_TEST_FILE = "test-frontend-operation-governance-generator.mjs";
const CANARY_BEHAVIOR_TEST_FILE = "test-dynamic-container-rollout-safety.mjs";
const BOOTSTRAP_ROUTE_FILE = "routes/connectRoutes.js";
const BOOTSTRAP_SERVICE_FILE = "tenantConnectBootstrapService.js";
const BOOTSTRAP_TRANSACTION_FILE = "tenantConnectBootstrapTransaction.js";
const BOOTSTRAP_TEST_FILE = "test-tenant-connect-bootstrap-transaction.mjs";
const TEST_REGISTRY_FILE = "frontend-operation-governance-tests.json";
const TEST_MANIFEST_FILE = "scripts/test-manifest.mjs";

const RESOURCE_RECIPES = [
  {
    recipe_id: "tenant-resource-create-transaction-v1",
    rule_id: "generated-tenant-resource-create-governance",
    operation: "POST /me/workspaces/{tenant_id}/resources/{resourceKey}",
    route_handler: "controller.tenantResourceCreate",
    service_function: "tenantCreateResource",
    mutation_call: "transactionRepository.insertAsset",
    rationale: "Creates a tenant asset and verifies its scoped readback before committing the same SQL transaction; any mutation or readback failure rolls the transaction back.",
    parameter_bindings: { tenant_id: "path.tenant_id", resource_key: "path.resourceKey", resource_id: "response.id" },
  },
  {
    recipe_id: "tenant-resource-update-transaction-v1",
    rule_id: "generated-tenant-resource-update-governance",
    operation: "PATCH /me/workspaces/{tenant_id}/resources/{resourceKey}/{resourceId}",
    route_handler: "controller.tenantResourceUpdate",
    service_function: "tenantUpdateResource",
    mutation_call: "transactionRepository.updateAssetFields",
    rationale: "Checks tenant ownership and update capability, mutates the asset, and verifies the scoped readback before committing the same SQL transaction.",
    parameter_bindings: { tenant_id: "path.tenant_id", resource_key: "path.resourceKey", resource_id: "path.resourceId" },
  },
  {
    recipe_id: "tenant-resource-archive-transaction-v1",
    rule_id: "generated-tenant-resource-archive-governance",
    operation: "DELETE /me/workspaces/{tenant_id}/resources/{resourceKey}/{resourceId}",
    route_handler: "controller.tenantResourceArchive",
    service_function: "tenantSetResourceLifecycle",
    mutation_call: "transactionRepository.setAssetLifecycle",
    rationale: "Checks tenant ownership and archive capability, changes lifecycle state, and verifies the scoped readback before committing the same SQL transaction.",
    parameter_bindings: { tenant_id: "path.tenant_id", resource_key: "path.resourceKey", resource_id: "path.resourceId" },
  },
  {
    recipe_id: "tenant-resource-restore-transaction-v1",
    rule_id: "generated-tenant-resource-restore-governance",
    operation: "POST /me/workspaces/{tenant_id}/resources/{resourceKey}/{resourceId}/restore",
    route_handler: "controller.tenantResourceRestore",
    service_function: "tenantSetResourceLifecycle",
    mutation_call: "transactionRepository.setAssetLifecycle",
    rationale: "Checks tenant ownership and restore capability, changes lifecycle state, and verifies the scoped readback before committing the same SQL transaction.",
    parameter_bindings: { tenant_id: "path.tenant_id", resource_key: "path.resourceKey", resource_id: "path.resourceId" },
  },
];

const CANARY_RECIPES = [
  {
    recipe_id: "dynamic-container-canary-promotion-transaction-v1",
    rule_id: "generated-dynamic-container-canary-promotion-governance",
    operation: "POST /admin/container-authority/canary-promotions",
    service_function: "runContainerCanaryPromotion",
    mutation_sql: "SET rollout_mode='read_only_canary'",
    rationale: "Promotes one exact read-only canary only after capability-envelope authorization, rollout-readiness validation, and typed confirmation, then verifies the exact promoted state and consumes the envelope before committing one SQL transaction.",
    preflight_mode: "capability_envelope_and_rollout_readiness_check",
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
    parameter_bindings: {
      target_canary_key: "request.body.targetCanaryKey",
      capability_envelope_id: "request.body.capabilityEnvelopeId",
      confirmation: "request.body.confirm",
      canary_key: "response.readback.canary_key",
    },
  },
];

function canonicalText(value = "") {
  return String(value).replace(/\r\n?/g, "\n");
}

function digest(value = "") {
  return createHash("sha256").update(canonicalText(value), "utf8").digest("hex");
}

function readText(apiRoot, relativeFile) {
  const target = path.resolve(apiRoot, relativeFile);
  const root = path.resolve(apiRoot);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) return "";
  return fs.existsSync(target) ? canonicalText(fs.readFileSync(target, "utf8")) : "";
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))].sort();
}

function registeredTestFiles(source = "") {
  try {
    const registry = JSON.parse(canonicalText(source));
    if (registry?.schema_version !== "frontend-operation-governance-test-registry-v1" || !Array.isArray(registry.tests)) return [];
    return unique(registry.tests
      .map((entry) => String(entry?.file || "").trim())
      .filter((file) => /^(?:[A-Za-z0-9_.-]+\/)*test-[A-Za-z0-9_.-]+\.mjs$/.test(file)));
  } catch {
    return [];
  }
}

function registeredTestEvidence(apiRoot) {
  const registrySource = readText(apiRoot, TEST_REGISTRY_FILE);
  const byOperation = new Map();
  for (const testFile of registeredTestFiles(registrySource)) {
    for (const operation of parseTestEvidenceClaims(readText(apiRoot, testFile))) {
      if (!byOperation.has(operation)) byOperation.set(operation, []);
      byOperation.get(operation).push(testFile);
    }
  }
  for (const [operation, files] of byOperation) byOperation.set(operation, unique(files));
  return { byOperation, registrySource };
}

export function extractFunctionBlock(source = "", functionName = "") {
  const escapedName = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${escapedName}\\s*\\(`);
  const normalized = canonicalText(source);
  const start = normalized.search(matcher);
  if (start < 0) return "";
  const bodyStart = /\)\s*\{/.exec(normalized.slice(start));
  const open = bodyStart ? start + bodyStart.index + bodyStart[0].lastIndexOf("{") : -1;
  if (open < 0) return "";
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = open; index < normalized.length; index += 1) {
    const character = normalized[index];
    const next = normalized[index + 1];
    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") { blockComment = false; index += 1; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "/" && next === "/") { lineComment = true; index += 1; continue; }
    if (character === "/" && next === "*") { blockComment = true; index += 1; continue; }
    if (["\"", "'", "`"].includes(character)) { quote = character; continue; }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return normalized.slice(start, index + 1);
    }
  }
  return "";
}

function routeRegistry(source, sourceFile) {
  return new Map(parseRoutesFromFile(source, sourceFile).map((operation) => [operation.signature, operation]));
}

function ordered(source, first, second) {
  const firstIndex = source.indexOf(first);
  return firstIndex >= 0 && source.indexOf(second, firstIndex + first.length) > firstIndex;
}

function evidenceGate(code, passed, evidence) {
  return { code, passed: Boolean(passed), evidence };
}

function generatedRule(recipe, evidenceFiles, sourceByFile) {
  const evidenceDigest = digest(evidenceFiles.map((file) => `${file}:${digest(sourceByFile.get(file) || "")}`).join("\n"));
  return {
    rule_id: recipe.rule_id,
    operation: recipe.operation,
    source_file: recipe.source_file,
    classification: "state_change",
    owner: recipe.owner,
    rationale: recipe.rationale,
    preflight: { mode: recipe.preflight_mode },
    approval: { mode: recipe.approval_mode },
    readback: { mode: "transactional_readback", same_cycle: true, before_commit: true },
    rollback: { mode: "transaction", on: ["mutation_failure", "readback_failure"] },
    parameter_bindings: recipe.parameter_bindings,
    evidence_refs: evidenceFiles,
    generated_evidence: { recipe_id: recipe.recipe_id, source_digest: evidenceDigest, fail_closed: true },
  };
}

function evaluateResourceRecipe(recipe, context) {
  const route = context.resourceRoutes.get(recipe.operation);
  const serviceBlock = extractFunctionBlock(context.sourceByFile.get(RESOURCE_SERVICE_FILE), recipe.service_function);
  const transactionBlock = extractFunctionBlock(context.sourceByFile.get(RESOURCE_REPOSITORY_FILE), "withTransaction");
  const claimedTests = context.testEvidence.byOperation.get(recipe.operation) || [];
  const gates = [
    evidenceGate("route_present", route, RESOURCE_ROUTE_FILE),
    evidenceGate("route_handler_bound", route?.declaration?.includes(recipe.route_handler), recipe.route_handler),
    evidenceGate("tenant_user_guard", route?.route_guards?.includes("requireUser"), "requireUser"),
    evidenceGate("service_function_present", serviceBlock, recipe.service_function),
    evidenceGate("transaction_scope_used", serviceBlock.includes("withMutationTransaction(async (transactionRepository)"), "withMutationTransaction"),
    evidenceGate("membership_preflight_in_transaction", serviceBlock.includes("requireMembership(auth, tenantId, transactionRepository)"), "requireMembership"),
    evidenceGate("capability_preflight_present", serviceBlock.includes("requireAssetOperation") && (recipe.service_function === "tenantCreateResource" || serviceBlock.includes("resourceCapabilities")), "requireAssetOperation/resourceCapabilities"),
    evidenceGate("mutation_uses_transaction_repository", serviceBlock.includes(recipe.mutation_call), recipe.mutation_call),
    evidenceGate("readback_follows_mutation", ordered(serviceBlock, recipe.mutation_call, "transactionRepository.getResource"), "transactionRepository.getResource"),
    evidenceGate("repository_connection_scope", transactionBlock.includes("getConnection") && transactionBlock.includes("transactionConnection: true"), "getConnection/transactionConnection"),
    evidenceGate("repository_begin_commit", transactionBlock.includes("beginTransaction") && transactionBlock.includes("connection.commit"), "beginTransaction/commit"),
    evidenceGate("repository_verified_rollback", transactionBlock.includes("connection.rollback") && transactionBlock.includes("resource_transaction_rollback_failed"), "rollback/fail-closed error"),
    evidenceGate("repository_connection_release", transactionBlock.includes("connection.release"), "connection.release"),
    evidenceGate("registered_operation_test", claimedTests.includes(RESOURCE_TEST_FILE), RESOURCE_TEST_FILE),
  ];
  return {
    recipe: { ...recipe, source_file: RESOURCE_ROUTE_FILE, owner: "resource-platform", preflight_mode: "inline_capability_check", approval_mode: "runtime_authorization" },
    gates,
    evidenceFiles: [RESOURCE_ROUTE_FILE, RESOURCE_SERVICE_FILE, RESOURCE_REPOSITORY_FILE, RESOURCE_TEST_FILE],
  };
}

function evaluateCanaryRecipe(recipe, context) {
  const normalizedRecipe = { ...recipe, source_file: CANARY_ROUTE_FILE, owner: "platform-governance", approval_mode: "runtime_authorization_and_typed_confirmation" };
  const route = context.canaryRoutes.get(normalizedRecipe.operation);
  const serviceSource = context.sourceByFile.get(CANARY_SERVICE_FILE);
  const serviceBlock = extractFunctionBlock(serviceSource, normalizedRecipe.service_function);
  const requiresRolloutReadiness = normalizedRecipe.service_function === "runContainerCanaryPromotion";
  const promotionPlanBlock = requiresRolloutReadiness
    ? extractFunctionBlock(serviceSource, "buildContainerCanaryPromotionPlan")
    : "";
  const evidenceTest = context.sourceByFile.get(CANARY_TEST_FILE) || "";
  const testManifest = context.sourceByFile.get(TEST_MANIFEST_FILE) || "";
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
    evidenceGate(
      "rollout_readiness_query",
      !requiresRolloutReadiness
        || (serviceBlock.includes("v_container_rollout_readiness")
          && serviceBlock.includes("readinessRows?.[0]")
          && serviceBlock.includes("buildContainerCanaryPromotionPlan")),
      "v_container_rollout_readiness/readinessRows/buildContainerCanaryPromotionPlan"
    ),
    evidenceGate(
      "rollout_readiness_validation",
      !requiresRolloutReadiness
        || (promotionPlanBlock.includes("readinessCode ?? readiness.readiness_code")
          && promotionPlanBlock.includes('!== "ready_for_review"')),
      "buildContainerCanaryPromotionPlan/ready_for_review"
    ),
    evidenceGate("typed_confirmation", serviceBlock.includes("confirm !== plan.confirmation"), "plan.confirmation"),
    evidenceGate("mutation_present", serviceBlock.includes(normalizedRecipe.mutation_sql), normalizedRecipe.mutation_sql),
    evidenceGate("transactional_readback_follows_mutation", ordered(serviceBlock, normalizedRecipe.mutation_sql, readbackSql), readbackSql),
    evidenceGate("envelope_consumed_before_commit", ordered(serviceBlock, "transitionCapabilityEnvelopeLifecycle", "executor.commit"), "envelope lifecycle/commit"),
    evidenceGate("provider_write_denial", serviceBlock.includes("providerCalls:false") && serviceBlock.includes("externalWrites:false"), "providerCalls:false/externalWrites:false"),
    evidenceGate("behavioral_test_bound", evidenceTest.includes(`await import("./${CANARY_BEHAVIOR_TEST_FILE}")`), CANARY_BEHAVIOR_TEST_FILE),
    evidenceGate("executable_test_registered", testManifest.includes(`node ${CANARY_TEST_FILE}`), TEST_MANIFEST_FILE),
    evidenceGate("registered_operation_test", claimedTests.includes(CANARY_TEST_FILE), CANARY_TEST_FILE),
  ];
  return {
    recipe: normalizedRecipe,
    gates,
    evidenceFiles: [CANARY_ROUTE_FILE, CANARY_SERVICE_FILE, CANARY_TEST_FILE, CANARY_BEHAVIOR_TEST_FILE, TEST_MANIFEST_FILE],
  };
}

function evaluateBootstrapRecipe(context) {
  const recipe = {
    recipe_id: "tenant-connect-bootstrap-transaction-v1",
    rule_id: "generated-tenant-connect-bootstrap-governance",
    operation: "POST /connect/bootstrap",
    source_file: BOOTSTRAP_ROUTE_FILE,
    owner: "tenant-activation",
    rationale: "Serializes bootstrap for the signed user, checks workspace eligibility, optionally creates the tenant and membership, activates Managed mode, and verifies the exact membership and connection before committing one SQL transaction.",
    preflight_mode: "inline_capability_check",
    approval_mode: "runtime_authorization",
    parameter_bindings: { user_id: "auth.user_id", tenant_id: "auth.tenant_id|response.principal.workspace_key", mode: "request.body.mode|managed" },
  };
  const route = context.bootstrapRoutes.get(recipe.operation);
  const routeSource = context.sourceByFile.get(BOOTSTRAP_ROUTE_FILE);
  const atomicAdapterBlock = extractFunctionBlock(routeSource, "activateManagedConnectionForTenant");
  const serviceBlock = extractFunctionBlock(context.sourceByFile.get(BOOTSTRAP_SERVICE_FILE), "orchestrateTenantConnectBootstrap");
  const transactionBlock = extractFunctionBlock(context.sourceByFile.get(BOOTSTRAP_TRANSACTION_FILE), "executeTenantConnectBootstrapTransaction");
  const claimedTests = context.testEvidence.byOperation.get(recipe.operation) || [];
  const connectionMutation = "INSERT INTO \\`tenant_backend_connections\\`";
  const membershipReadback = "const [readbackMembershipRows]";
  const verifiedReadback = "verifyReadback({ membership, connection, tenantId })";
  const gates = [
    evidenceGate("route_present", route, BOOTSTRAP_ROUTE_FILE),
    evidenceGate("signed_user_guard", route?.route_guards?.includes("requireUserJwt"), "requireUserJwt"),
    evidenceGate("route_atomic_binding", route?.declaration?.includes("orchestrateTenantConnectBootstrap") && route?.declaration?.includes("activateManagedConnectionForTenant") && atomicAdapterBlock.includes("executeTenantConnectBootstrapTransaction"), "orchestrateTenantConnectBootstrap/atomic transaction adapter"),
    evidenceGate("managed_only_preflight", serviceBlock.includes('mode !== "managed"') && serviceBlock.includes("bootstrap_managed_only"), "managed-only service preflight"),
    evidenceGate("service_atomic_dependency", serviceBlock.includes("await applyManagedBootstrap") && serviceBlock.includes("readback?.verified"), "applyManagedBootstrap/verified readback"),
    evidenceGate("transaction_scope_present", transactionBlock.includes("getConnection") && transactionBlock.includes("beginTransaction"), "getConnection/beginTransaction"),
    evidenceGate("principal_concurrency_lock", transactionBlock.includes("FROM `users`") && transactionBlock.includes("FOR UPDATE"), "signed user FOR UPDATE"),
    evidenceGate("membership_preflight_in_transaction", transactionBlock.includes("activeWorkspaceOptions") && transactionBlock.includes("tenant_selection_required") && transactionBlock.includes("tenant_membership_required"), "membership selection gates"),
    evidenceGate("workspace_mutation_present", transactionBlock.includes("INSERT INTO \\`tenants\\`") && transactionBlock.includes("INSERT INTO \\`memberships\\`"), "tenant/membership inserts"),
    evidenceGate("managed_connection_mutation_present", transactionBlock.includes(connectionMutation), connectionMutation),
    evidenceGate("integration_policy_uses_transaction", transactionBlock.includes("upsertIntegrationPolicies") && transactionBlock.includes("db: transaction"), "upsertIntegrationPolicies/db: transaction"),
    evidenceGate("transactional_readback_follows_mutation", ordered(transactionBlock, connectionMutation, membershipReadback) && ordered(transactionBlock, membershipReadback, verifiedReadback), "membership/connection readback after mutation"),
    evidenceGate("verification_precedes_commit", ordered(transactionBlock, verifiedReadback, "transaction.commit"), "verifyReadback/commit"),
    evidenceGate("verified_rollback", transactionBlock.includes("transaction.rollback") && transactionBlock.includes("connect_bootstrap_transaction_rollback_failed") && transactionBlock.includes('state: "indeterminate"'), "rollback/fail-closed error"),
    evidenceGate("connection_release", transactionBlock.includes("transaction.release"), "transaction.release"),
    evidenceGate("registered_operation_test", claimedTests.includes(BOOTSTRAP_TEST_FILE), BOOTSTRAP_TEST_FILE),
  ];
  return { recipe, gates, evidenceFiles: [BOOTSTRAP_ROUTE_FILE, BOOTSTRAP_SERVICE_FILE, BOOTSTRAP_TRANSACTION_FILE, BOOTSTRAP_TEST_FILE] };
}

export function buildOperationGovernance({ apiRoot = process.cwd() } = {}) {
  const generatorFile = "scripts/frontend-operation-governance-generator.mjs";
  const testEvidence = registeredTestEvidence(apiRoot);
  const evidenceFiles = unique([
    generatorFile,
    TEST_REGISTRY_FILE,
    TEST_MANIFEST_FILE,
    RESOURCE_ROUTE_FILE,
    RESOURCE_SERVICE_FILE,
    RESOURCE_REPOSITORY_FILE,
    RESOURCE_TEST_FILE,
    CANARY_ROUTE_FILE,
    CANARY_SERVICE_FILE,
    CANARY_TEST_FILE,
    CANARY_BEHAVIOR_TEST_FILE,
    BOOTSTRAP_ROUTE_FILE,
    BOOTSTRAP_SERVICE_FILE,
    BOOTSTRAP_TRANSACTION_FILE,
    BOOTSTRAP_TEST_FILE,
  ]);
  const sourceByFile = new Map(evidenceFiles.map((file) => [file, readText(apiRoot, file)]));
  const context = {
    sourceByFile,
    testEvidence,
    resourceRoutes: routeRegistry(sourceByFile.get(RESOURCE_ROUTE_FILE), RESOURCE_ROUTE_FILE),
    canaryRoutes: routeRegistry(sourceByFile.get(CANARY_ROUTE_FILE), CANARY_ROUTE_FILE),
    bootstrapRoutes: routeRegistry(sourceByFile.get(BOOTSTRAP_ROUTE_FILE), BOOTSTRAP_ROUTE_FILE),
  };
  const evaluations = [
    ...RESOURCE_RECIPES.map((recipe) => evaluateResourceRecipe(recipe, context)),
    ...CANARY_RECIPES.map((recipe) => evaluateCanaryRecipe(recipe, context)),
    evaluateBootstrapRecipe(context),
  ];
  const operationRules = [];
  const rejectedCandidates = [];
  for (const evaluation of evaluations) {
    const missingEvidence = evaluation.gates.filter((gate) => !gate.passed).map((gate) => gate.code);
    if (missingEvidence.length) {
      rejectedCandidates.push({
        recipe_id: evaluation.recipe.recipe_id,
        operation: evaluation.recipe.operation,
        source_file: evaluation.recipe.source_file,
        reason: "required_evidence_missing",
        missing_evidence: missingEvidence,
        gates: evaluation.gates,
      });
      continue;
    }
    operationRules.push(generatedRule(evaluation.recipe, evaluation.evidenceFiles, sourceByFile));
  }
  operationRules.sort((left, right) => left.operation.localeCompare(right.operation));
  rejectedCandidates.sort((left, right) => left.operation.localeCompare(right.operation));
  const sourceAuthority = evidenceFiles.map((file) => ({ file, sha256: digest(sourceByFile.get(file)), present: Boolean(sourceByFile.get(file)) }));
  return {
    schema_version: "frontend-operation-governance-v1",
    generator: { id: "frontend-operation-governance-generator-v1", source_digest: digest(sourceAuthority.map((entry) => `${entry.file}:${entry.sha256}`).join("\n")), fail_closed: true },
    source_authority: sourceAuthority,
    coverage: { candidate_count: evaluations.length, generated_rule_count: operationRules.length, rejected_candidate_count: rejectedCandidates.length },
    operation_rules: operationRules,
    rejected_candidates: rejectedCandidates,
    safety: { writes_runtime_source: false, writes_database: false, executes_provider_calls: false, deploys: false, secrets_included: false },
  };
}

export function syncOperationGovernance({ apiRoot = process.cwd(), mode = "write", output = DEFAULT_OUTPUT } = {}) {
  const target = path.resolve(apiRoot, output);
  const plan = buildOperationGovernance({ apiRoot });
  const content = `${JSON.stringify(plan, null, 2)}\n`;
  const current = fs.existsSync(target) ? canonicalText(fs.readFileSync(target, "utf8")) : "";
  const drift = current !== content;
  if (mode === "write") fs.writeFileSync(target, content, "utf8");
  return { ok: mode === "write" || !drift, mode, output, drift, plan };
}

function parseArgs(argv = process.argv.slice(2)) {
  return {
    mode: argv.includes("--check") ? "check" : argv.includes("--write") ? "write" : "json",
    output: argv.find((argument) => argument.startsWith("--out="))?.slice("--out=".length) || DEFAULT_OUTPUT,
  };
}

function isDirectExecution(importMetaUrl, argvPath = process.argv[1]) {
  return Boolean(argvPath) && importMetaUrl === pathToFileURL(path.resolve(argvPath)).href;
}

if (isDirectExecution(import.meta.url)) {
  const args = parseArgs();
  const result = args.mode === "json"
    ? { ok: true, mode: "json", output: args.output, drift: false, plan: buildOperationGovernance() }
    : syncOperationGovernance({ mode: args.mode, output: args.output });
  process.stdout.write(`${JSON.stringify({ ok: result.ok, mode: result.mode, output: result.output, drift: result.drift, coverage: result.plan.coverage }, null, 2)}\n`);
  if (!result.ok) process.exit(1);
}
