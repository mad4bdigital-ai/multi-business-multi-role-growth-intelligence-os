#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildOperationGovernance as buildBaseOperationGovernance,
  extractFunctionBlock,
} from "./frontend-operation-governance-base.mjs";
import {
  parseRoutesFromFile,
  parseTestEvidenceClaims,
} from "./frontend-surface-dispatch.mjs";

export { extractFunctionBlock };

const DEFAULT_OUTPUT = "frontend-operation-governance.generated.json";
const WRAPPER_FILE = "scripts/frontend-operation-governance-generator.mjs";
const BASE_GENERATOR_FILE = "scripts/frontend-operation-governance-base.mjs";
const LEASE_ROUTE_FILE = "routes/repositoryAutomationRoutes.js";
const LEASE_CONTROL_FILE = "repositoryReconciliationLeaseControl.js";
const LEASE_SERVICE_FILE = "repositoryOperationLeaseService.js";
const LEASE_TEST_FILE = "test-repository-reconciliation-lease-control.mjs";
const BRAND_ROUTE_FILE = "routes/workspaceResourceRoutes.js";
const BRAND_SERVICE_FILE = "workspaceBrandLifecycle.js";
const BRAND_TEST_FILE = "test-workspace-brand-create-operation-governance.mjs";
const MATERIALIZE_ROUTE_FILE = "routes/resourceApiRoutes.js";
const MATERIALIZE_SERVICE_FILE = "workspaceBrandCoreAssetMaterialization.js";
const MATERIALIZE_MIGRATION_FILE = "migrations/1050_workspace_asset_provenance_content_identity.sql";
const MATERIALIZE_TEST_FILE = "test-brand-core-asset-materialization-operation-governance.mjs";
const TEST_REGISTRY_FILE = "frontend-operation-governance-tests.json";
const LEASE_OPERATION = "POST /admin/repository-automation/reconciliation-lease";
const BRAND_CREATE_OPERATION = "POST /me/workspaces/{tenant_id}/brands";
const BRAND_CORE_MATERIALIZE_OPERATION = "POST /me/workspaces/{tenant_id}/assets/materialize-brand-core";

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
  return byOperation;
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

function evaluateLeaseRecipe(apiRoot) {
  const routeSource = readText(apiRoot, LEASE_ROUTE_FILE);
  const controlSource = readText(apiRoot, LEASE_CONTROL_FILE);
  const leaseSource = readText(apiRoot, LEASE_SERVICE_FILE);
  const route = routeRegistry(routeSource, LEASE_ROUTE_FILE).get(LEASE_OPERATION);
  const runBlock = extractFunctionBlock(controlSource, "runRepositoryReconciliationLeaseControl");
  const envelopeBlock = extractFunctionBlock(controlSource, "requireCapabilityEnvelope");
  const acquireBlock = extractFunctionBlock(leaseSource, "acquireRepositoryOperationLease");
  const renewBlock = extractFunctionBlock(leaseSource, "renewRepositoryOperationLease");
  const releaseBlock = extractFunctionBlock(leaseSource, "releaseRepositoryOperationLease");
  const claimedTests = registeredTestEvidence(apiRoot).get(LEASE_OPERATION) || [];
  const transactionalBlocks = [acquireBlock, renewBlock, releaseBlock];
  const gates = [
    evidenceGate("route_present", route, LEASE_ROUTE_FILE),
    evidenceGate("admin_guard", route?.route_guards?.includes("requireAdminPrincipal") && route?.route_guards?.includes("requireBackendApiKey"), "requireAdminPrincipal/requireBackendApiKey"),
    evidenceGate("route_service_binding", route?.declaration?.includes("runRepositoryReconciliationLeaseControl"), "runRepositoryReconciliationLeaseControl"),
    evidenceGate("control_function_present", runBlock, "runRepositoryReconciliationLeaseControl"),
    evidenceGate("defense_in_depth_admin_check", runBlock.includes("assertAdminCaller"), "assertAdminCaller"),
    evidenceGate("typed_confirmation", runBlock.includes("assertTypedConfirmation"), "assertTypedConfirmation"),
    evidenceGate("force_bypass_rejected", controlSource.includes("assertNoForceFlags") && controlSource.includes("repository_reconciliation_lease_control_force_forbidden"), "assertNoForceFlags/force_forbidden"),
    evidenceGate("capability_envelope_exact_binding", envelopeBlock.includes("resolveCapabilityExecutionEnvelope") && envelopeBlock.includes("expectedResourceUri") && envelopeBlock.includes("expectedBindingSha256"), "expectedResourceUri/expectedBindingSha256"),
    evidenceGate("capability_envelope_apply_authorization", envelopeBlock.includes("resolved.apply_allowed !== true"), "apply_allowed"),
    evidenceGate("lease_specific_intent", envelopeBlock.includes("repository_reconciliation_lease_control") && !envelopeBlock.includes('"repo_mutation"'), "lease-specific intent/no generic repo_mutation"),
    evidenceGate("envelope_reference_before_service_dispatch", ordered(envelopeBlock, "markCapabilityEnvelopeReferenced", "return resolved") && ordered(runBlock, "await requireCapabilityEnvelope", "await leaseDependencies"), "envelope reference before lease service dispatch"),
    evidenceGate("all_actions_dispatched", runBlock.includes("acquireRepositoryOperationLease") && runBlock.includes("renewRepositoryOperationLease") && runBlock.includes("releaseRepositoryOperationLease"), "acquire/renew/release dispatch"),
    evidenceGate("transaction_scope_all_actions", transactionalBlocks.every((block) => block.includes("getConnection") && block.includes("beginTransaction") && block.includes("connection.commit")), "getConnection/beginTransaction/commit"),
    evidenceGate("transaction_rollback_all_actions", transactionalBlocks.every((block) => block.includes("connection.rollback") && block.includes("connection.release")), "rollback/release"),
    evidenceGate("acquire_transactional_readback", (ordered(acquireBlock, "INSERT INTO repository_operation_leases", "const created = await readLeaseById") || ordered(acquireBlock, "UPDATE repository_operation_leases", "const renewed = await readLeaseById")) && acquireBlock.includes("repository_operation_lease_readback_failed"), "acquire/reuse readback before commit"),
    evidenceGate("renew_transactional_readback", ordered(renewBlock, "UPDATE repository_operation_leases", "const renewed = await readLeaseById"), "renew readback before commit"),
    evidenceGate("release_transactional_readback", ordered(releaseBlock, "UPDATE repository_operation_leases", "const released = await readLeaseById") && releaseBlock.includes('released.status !== "released"'), "release readback before commit"),
    evidenceGate("registered_operation_test", claimedTests.includes(LEASE_TEST_FILE), LEASE_TEST_FILE),
  ];
  const recipe = {
    recipe_id: "repository-reconciliation-lease-control-v1",
    rule_id: "generated-repository-reconciliation-lease-control-governance",
    operation: LEASE_OPERATION,
    source_file: LEASE_ROUTE_FILE,
    owner: "repository-automation",
    rationale: "Acquires, renews, or releases one repository reconciliation lease only after Admin authentication, exact resource and fingerprint capability-envelope binding, apply authorization, and typed confirmation; each durable mutation is verified inside the same SQL transaction before commit and rolls back on mutation or readback failure.",
    preflight_mode: "capability_envelope_resource_and_fingerprint_binding",
    approval_mode: "runtime_authorization_and_typed_confirmation",
    parameter_bindings: {
      action: "request.body.action",
      capability_envelope_id: "request.body.capability_envelope_id",
      repository_owner: "request.body.owner|request.body.repository_owner",
      repository_name: "request.body.repo|request.body.repository_name",
      branch_name: "request.body.branch|request.body.branch_name",
      expected_base_sha: "request.body.expected_base_sha",
      expected_branch_sha: "request.body.expected_branch_sha",
      lease_id: "response.lease.lease_id",
      resource_fingerprint: "response.lease.resource_fingerprint",
    },
  };
  return { recipe, gates, evidenceFiles: [LEASE_ROUTE_FILE, LEASE_CONTROL_FILE, LEASE_SERVICE_FILE, LEASE_TEST_FILE] };
}

function evaluateBrandCreateRecipe(apiRoot) {
  const routeSource = readText(apiRoot, BRAND_ROUTE_FILE);
  const serviceSource = readText(apiRoot, BRAND_SERVICE_FILE);
  const route = routeRegistry(routeSource, BRAND_ROUTE_FILE).get(BRAND_CREATE_OPERATION);
  const createBlock = extractFunctionBlock(serviceSource, "createWorkspaceBrand");
  const ownerBlock = extractFunctionBlock(serviceSource, "requireOwnerAuthority");
  const linkBlock = extractFunctionBlock(serviceSource, "ensureTenantBrandLink");
  const workspaceBlock = extractFunctionBlock(serviceSource, "ensureBrandWorkspace");
  const grantBlock = extractFunctionBlock(serviceSource, "ensureCreatorBrandGrant");
  const claimedTests = registeredTestEvidence(apiRoot).get(BRAND_CREATE_OPERATION) || [];
  const gates = [
    evidenceGate("route_present", route, BRAND_ROUTE_FILE),
    evidenceGate("user_jwt_guard", route?.route_guards?.includes("requireUserJwt"), "requireUserJwt"),
    evidenceGate("route_service_binding", route?.declaration?.includes("createWorkspaceBrand"), "createWorkspaceBrand"),
    evidenceGate("transaction_scope", routeSource.includes("MUTATION_TRANSACTION: workspace_brand_create") && routeSource.includes("await connection.commit()") && routeSource.includes("await connection.rollback()"), "begin/commit/rollback"),
    evidenceGate("service_present", createBlock, "createWorkspaceBrand"),
    evidenceGate("locked_owner_authority", ownerBlock.includes("LIMIT 2 FOR UPDATE") && ownerBlock.includes("OWNER_ROLES.has"), "owner/admin locked membership"),
    evidenceGate("canonical_identity", serviceSource.includes("canonicalWorkspaceBrandTargetKey") && serviceSource.includes("normalizeWorkspaceBrandName"), "deterministic canonical identity"),
    evidenceGate("explicit_tenant_link", linkBlock.includes("workspace_owner_brand_create") && linkBlock.includes("tenant_brand_links") && linkBlock.includes("FOR UPDATE"), "tenant_brand_links explicit authority/readback"),
    evidenceGate("brand_workspace_binding", workspaceBlock.includes("workspace_registry") && workspaceBlock.includes("linked_brand_key") && workspaceBlock.includes("FOR UPDATE"), "brand workspace registry/readback"),
    evidenceGate("creator_admin_grant", grantBlock.includes("workspace_resource_grants") && grantBlock.includes("'brand'") && grantBlock.includes("'admin'") && grantBlock.includes("FOR UPDATE"), "creator brand/admin grant/readback"),
    evidenceGate("no_secret_response", routeSource.includes("secrets_included: false"), "secrets_included=false"),
    evidenceGate("registered_operation_test", claimedTests.includes(BRAND_TEST_FILE), BRAND_TEST_FILE),
  ];
  const recipe = {
    recipe_id: "workspace-brand-create-v1",
    rule_id: "generated-workspace-brand-create-governance",
    operation: BRAND_CREATE_OPERATION,
    source_file: BRAND_ROUTE_FILE,
    owner: "workspace-platform",
    rationale: "Creates or idempotently reuses one canonical brand for an active workspace owner/admin, then atomically establishes the explicit tenant-brand authority link, canonical brand workspace binding, and creator brand/admin grant; all authority and durable readbacks occur on the same transaction and roll back together on failure.",
    preflight_mode: "locked_workspace_owner_authority_and_canonical_identity",
    approval_mode: "runtime_authorization",
    parameter_bindings: {
      tenant_id: "request.path.tenant_id",
      display_name: "request.body.display_name|request.body.brand_name",
      actor_user_id: "authenticated_user.user_id",
      brand_target_key: "response.brand.target_key",
      brand_workspace_id: "response.workspace_link.workspace_id",
      creator_grant_id: "response.creator_grant.grant_id",
    },
  };
  return { recipe, gates, evidenceFiles: [BRAND_ROUTE_FILE, BRAND_SERVICE_FILE, BRAND_TEST_FILE] };
}

function evaluateBrandCoreMaterializeRecipe(apiRoot) {
  const routeSource = readText(apiRoot, MATERIALIZE_ROUTE_FILE);
  const serviceSource = readText(apiRoot, MATERIALIZE_SERVICE_FILE);
  const migrationSource = readText(apiRoot, MATERIALIZE_MIGRATION_FILE);
  const route = routeRegistry(routeSource, MATERIALIZE_ROUTE_FILE).get(BRAND_CORE_MATERIALIZE_OPERATION);
  const materializeBlock = extractFunctionBlock(serviceSource, "materializeWorkspaceBrandCoreAsset");
  const schemaBlock = extractFunctionBlock(serviceSource, "assertProvenanceSchema");
  const brandBlock = extractFunctionBlock(serviceSource, "resolveCanonicalBrand");
  const workspaceBlock = extractFunctionBlock(serviceSource, "resolveBrandWorkspace");
  const sourceBlock = extractFunctionBlock(serviceSource, "resolveBrandCoreSource");
  const persistBlock = extractFunctionBlock(serviceSource, "materializeAsset");
  const claimedTests = registeredTestEvidence(apiRoot).get(BRAND_CORE_MATERIALIZE_OPERATION) || [];
  const gates = [
    evidenceGate("route_present", route, MATERIALIZE_ROUTE_FILE),
    evidenceGate(
      "canonical_user_jwt_guard",
      routeSource.includes("const requireUserJwt = createUserJwtMiddleware();")
        && route?.route_guards?.includes("requireUserJwt")
        && !/\bfunction\s+(?:verifyUserJwt|requireUserJwt)\s*\(/.test(routeSource),
      "centralized createUserJwtMiddleware binding parsed as requireUserJwt with no route-local User JWT verifier"
    ),
    evidenceGate("route_service_binding", route?.declaration?.includes("materializeWorkspaceBrandCoreAsset"), "materializeWorkspaceBrandCoreAsset"),
    evidenceGate("transaction_scope", routeSource.includes("MUTATION_TRANSACTION: workspace_brand_core_asset_materialize") && routeSource.includes("await connection.beginTransaction()") && routeSource.includes("await connection.commit()") && routeSource.includes("await connection.rollback()"), "transaction begin/commit/rollback"),
    evidenceGate("route_readback_marker", routeSource.includes("MUTATION_READBACK: workspace_brand_core_asset_materialize") && routeSource.includes("provenance_sha256"), "exact materialization readback marker"),
    evidenceGate("service_present", materializeBlock, "materializeWorkspaceBrandCoreAsset"),
    evidenceGate("schema_preflight", schemaBlock.includes("information_schema.columns") && schemaBlock.includes("1050_workspace_asset_provenance_content_identity.sql"), "Migration 1050 schema preflight"),
    evidenceGate("canonical_brand_authority", brandBlock.includes("resolveWorkspaceAssetBrandRef") && brandBlock.includes("FOR UPDATE"), "canonical tenant Brand authority"),
    evidenceGate("brand_workspace_authority", workspaceBlock.includes("workspace_registry") && workspaceBlock.includes("linked_brand_key") && workspaceBlock.includes("FOR UPDATE"), "canonical Brand Workspace authority"),
    evidenceGate("canonical_source_resolution", sourceBlock.includes("FROM brand_core") && sourceBlock.includes("LIMIT 3 FOR UPDATE") && sourceBlock.includes("sourceActive"), "Brand Core source identity/status resolution"),
    evidenceGate("provenance_identity", persistBlock.includes("source_ref_sha256") && persistBlock.includes("provenance_sha256") && persistBlock.includes("content_sha256") && persistBlock.includes("brand_core"), "durable provenance/content identity fields"),
    evidenceGate("transactional_readback", persistBlock.includes("FROM workspace_assets") && persistBlock.includes("LIMIT 2 FOR UPDATE") && persistBlock.includes("brand_core_asset_materialize_readback_mismatch"), "exact persisted provenance readback"),
    evidenceGate("no_provider_content_fetch", serviceSource.includes("provider_content_fetched: false") && !serviceSource.includes("fetch("), "no provider content fetch"),
    evidenceGate("migration_contract", migrationSource.includes("v_workspace_asset_provenance_schema_readiness") && migrationSource.includes("uq_workspace_asset_provenance") && migrationSource.includes("content_sha256 CHAR(64)"), "Migration 1050 provenance readiness"),
    evidenceGate("registered_operation_test", claimedTests.includes(MATERIALIZE_TEST_FILE), MATERIALIZE_TEST_FILE),
  ];
  const recipe = {
    recipe_id: "workspace-brand-core-asset-materialize-v1",
    rule_id: "generated-workspace-brand-core-asset-materialize-governance",
    operation: BRAND_CORE_MATERIALIZE_OPERATION,
    source_file: MATERIALIZE_ROUTE_FILE,
    owner: "workspace-platform",
    rationale: "Materializes exactly one active Brand Core context source into durable workspace_assets only after canonical User-JWT, tenant Brand authority, Brand Workspace authority, Migration 1050 provenance readiness, deterministic source identity, and transactional persisted-provenance readback; no provider content is fetched or falsely checksummed.",
    preflight_mode: "canonical_user_jwt_brand_authority_and_provenance_schema",
    approval_mode: "runtime_authorization",
    parameter_bindings: {
      tenant_id: "request.path.tenant_id",
      brand_ref: "request.body.brand_ref",
      source_ref: "request.body.source_ref",
      asset_id: "response.asset.asset_id",
      provenance_sha256: "response.asset.provenance_sha256",
      brand_workspace_id: "response.workspace.workspace_id",
    },
  };
  return {
    recipe,
    gates,
    evidenceFiles: [
      MATERIALIZE_ROUTE_FILE,
      MATERIALIZE_SERVICE_FILE,
      MATERIALIZE_MIGRATION_FILE,
      MATERIALIZE_TEST_FILE,
    ],
  };
}

function generatedStateChangeRule(recipe, evidenceFiles, apiRoot) {
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
    generated_evidence: {
      recipe_id: recipe.recipe_id,
      source_digest: digest(evidenceFiles.map((file) => `${file}:${digest(readText(apiRoot, file))}`).join("\n")),
      fail_closed: true,
    },
  };
}

function withSourceAuthority(plan, apiRoot) {
  const files = unique([
    ...plan.source_authority.map((entry) => entry.file),
    WRAPPER_FILE,
    BASE_GENERATOR_FILE,
    TEST_REGISTRY_FILE,
    LEASE_ROUTE_FILE,
    LEASE_CONTROL_FILE,
    LEASE_SERVICE_FILE,
    LEASE_TEST_FILE,
    BRAND_ROUTE_FILE,
    BRAND_SERVICE_FILE,
    BRAND_TEST_FILE,
    MATERIALIZE_ROUTE_FILE,
    MATERIALIZE_SERVICE_FILE,
    MATERIALIZE_MIGRATION_FILE,
    MATERIALIZE_TEST_FILE,
  ]);
  const sourceAuthority = files.map((file) => ({
    file,
    sha256: digest(readText(apiRoot, file)),
    present: Boolean(readText(apiRoot, file)),
  }));
  return {
    ...plan,
    generator: {
      ...plan.generator,
      id: "frontend-operation-governance-generator-v4-brand-core-asset-materialization",
      source_digest: digest(sourceAuthority.map((entry) => `${entry.file}:${entry.sha256}`).join("\n")),
      fail_closed: true,
    },
    source_authority: sourceAuthority,
  };
}

export function buildOperationGovernance({ apiRoot = process.cwd() } = {}) {
  const basePlan = buildBaseOperationGovernance({ apiRoot });
  if (process.env.FRONTEND_OPERATION_GOVERNANCE_BASE_TEST === "1") return basePlan;

  const evaluations = [
    evaluateLeaseRecipe(apiRoot),
    evaluateBrandCreateRecipe(apiRoot),
    evaluateBrandCoreMaterializeRecipe(apiRoot),
  ];
  const plan = withSourceAuthority(basePlan, apiRoot);
  const operationRules = [...plan.operation_rules];
  const rejectedCandidates = [...plan.rejected_candidates];

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
    } else {
      operationRules.push(generatedStateChangeRule(evaluation.recipe, evaluation.evidenceFiles, apiRoot));
    }
  }

  operationRules.sort((left, right) => left.operation.localeCompare(right.operation));
  rejectedCandidates.sort((left, right) => left.operation.localeCompare(right.operation));
  return {
    ...plan,
    coverage: {
      candidate_count: basePlan.coverage.candidate_count + evaluations.length,
      generated_rule_count: operationRules.length,
      rejected_candidate_count: rejectedCandidates.length,
    },
    operation_rules: operationRules,
    rejected_candidates: rejectedCandidates,
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
