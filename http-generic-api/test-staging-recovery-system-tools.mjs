import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyExecutionTicket } from "./recoveryExecutionTicket.js";
import { _testingStagingRecoveryAuthorityBinding } from "./stagingRecoveryAuthorityBinding.js";
import {
  STAGING_SCHEMA_REPAIR_CAPABILITY,
  STAGING_SCHEMA_REPAIR_TICKET_AUTHORITY_CONTRACT,
  _testingStagingSchemaRepairSystemTools,
  buildStagingSchemaRepairSystemTools,
  createStagingSchemaRepairTicketAuthority,
  stagingRecoverySchemaRepairApprove,
  stagingRecoverySchemaRepairPrepare,
} from "./stagingSchemaRepairSystemTools.js";
import {
  _testingStagingRecoverySystemTools,
  buildStagingRecoverySystemTools,
  isStagingRecoverySystemEnvironment,
  stagingRecoveryAccessRepairApprove,
  stagingRecoveryAccessRepairPrepare,
  stagingRecoveryActivationGatewayDarkDeployDryRun,
  stagingRecoveryCertificationCanaryApprove,
  stagingRecoveryCertificationCanaryExecute,
  stagingRecoveryCertificationCanaryPlanCreate,
  stagingRecoverySystemSurfaceReadiness,
} from "./stagingRecoverySystemTools.js";

const STAGING_ENV = Object.freeze({
  NODE_ENV: "staging",
  DEPLOYMENT_ENVIRONMENT: "staging_local_windows_docker",
  REMOTE_MCP_ENVIRONMENT: "staging",
});
const PRODUCTION_ENV = Object.freeze({
  NODE_ENV: "production",
  DEPLOYMENT_ENVIRONMENT: "production",
  REMOTE_MCP_ENVIRONMENT: "production",
});
const CONFLICTING_ENV = Object.freeze({
  NODE_ENV: "production",
  DEPLOYMENT_ENVIRONMENT: "staging_local_windows_docker",
  REMOTE_MCP_ENVIRONMENT: "staging",
});

const BUSINESS_TOOLS = [
  "staging_recovery_certification_canary_plan_create",
  "staging_recovery_certification_canary_approve",
  "staging_recovery_certification_canary_execute",
  "staging_recovery_access_repair_prepare",
  "staging_recovery_access_repair_execute",
  "staging_recovery_access_repair_approve",
];
const GATEWAY_DRY_RUN_TOOL = "prepareStagingActivationGatewayDarkDeployDryRun";
const REBUILD_EMPTY_TOOLS = [
  "staging_recovery_rebuild_empty_inspection_record",
  "staging_recovery_rebuild_empty_prepare",
  "staging_recovery_rebuild_empty_approve",
];
const FORBIDDEN_CALLER_FIELDS = new Set([
  "target_key",
  "target_fingerprint",
  "operation",
  "raw_sql",
  "sql",
  "query",
  "command",
  "script",
  "credentials",
  "credential",
  "approval_token",
  "execution_ticket_id",
  "execution_ticket_hash",
  "signature",
  "grant_binding_hash",
  "repository_path",
  "ref",
  "account_id",
  "script_name",
  "resource_binding_id",
  "workspace_id",
  "capability_envelope_id",
  "execution_nonce",
  "confirm",
]);

const SHA = "a".repeat(40);
const TREE = "b".repeat(40);
const CONTEXT = "c".repeat(64);
const MIGRATION = "20260902_staging_actions_runtime_contract_reconciliation.sql";
const MIGRATION_SHA256 = "6ca8879ec300b5970f6ddc3d9eeded38eda8dee12abd6bdeb7ba7d2ffa53ee2c";
const REMOTE_MCP_FOUNDATION_MIGRATION = "20261003_staging_remote_mcp_runtime_foundation_reconciliation.sql";
const REMOTE_MCP_FOUNDATION_MIGRATION_SHA256 = "352414ac3c1adbd7bccd3a339760c3506ae2f8e9a223ae669a012183eeabfecc";
const ACTIVATION_REGISTRY_MIGRATION = "20261003_staging_activation_registry_schema_reconciliation.sql";
const ACTIVATION_REGISTRY_MIGRATION_SHA256 = "6729297dea3b7d601035c129cf912b12b3f09fd56a3319df7a20bd9ccab31b62";

function stagingEnv(root) {
  return {
    NODE_ENV: "staging",
    DEPLOYMENT_ENVIRONMENT: "staging_local_windows_docker",
    REMOTE_MCP_ENVIRONMENT: "staging",
    RECOVERY_SERVER_MANAGED_BINDING_MODE: "injected_non_live",
    RECOVERY_SERVER_MANAGED_BINDING_MODULE: "./stagingRecoveryAuthorityBinding.js",
    RECOVERY_STAGING_READINESS_DIRECTORY: path.join(root, "recovery-readiness"),
    RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY: path.join(root, "recovery-ingress"),
    DEPLOYMENT_MANIFEST_JSON: JSON.stringify({
      repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
      branch: "main",
      commit_sha: SHA,
      tree_sha: TREE,
      context_file_set_sha256: CONTEXT,
      build_source: "staging_schema_repair_ticket_authority_test",
      secrets_included: false,
    }),
  };
}

test("Staging Recovery System Tool descriptors are advertised only for unambiguous Staging", () => {
  assert.equal(isStagingRecoverySystemEnvironment(STAGING_ENV), true);
  assert.equal(isStagingRecoverySystemEnvironment(PRODUCTION_ENV), false);
  assert.equal(isStagingRecoverySystemEnvironment(CONFLICTING_ENV), false);
  assert.deepEqual(buildStagingRecoverySystemTools(PRODUCTION_ENV), []);
  assert.deepEqual(buildStagingRecoverySystemTools(CONFLICTING_ENV), []);

  const tools = buildStagingRecoverySystemTools(STAGING_ENV);
  assert.deepEqual(tools.map((tool) => tool.name), [
    ...BUSINESS_TOOLS,
    ...REBUILD_EMPTY_TOOLS,
    GATEWAY_DRY_RUN_TOOL,
    "staging_recovery_system_surface_readiness",
  ]);
  for (const tool of tools) {
    assert.equal(tool.requires_admin, true);
    assert.equal(tool.catalog_level, "private_recovery");
    assert.equal(tool.source_key, "staging_recovery_system_surface_v1");
  }
});

test("bounded Staging Recovery schemas never accept caller-selected execution or target authority", () => {
  const tools = buildStagingRecoverySystemTools(STAGING_ENV);
  for (const name of BUSINESS_TOOLS) {
    const tool = tools.find((entry) => entry.name === name);
    assert.ok(tool, `${name} descriptor missing`);
    assert.equal(tool.inputSchema.additionalProperties, false);
    const properties = new Set(Object.keys(tool.inputSchema.properties || {}));
    for (const forbidden of FORBIDDEN_CALLER_FIELDS) {
      assert.equal(properties.has(forbidden), false, `${name} must not expose ${forbidden}`);
    }
  }
  const prepare = tools.find((entry) => entry.name === "staging_recovery_access_repair_prepare");
  assert.deepEqual(prepare.inputSchema.required, ["expected_sha", "idempotency_key"]);

  const gatewayDryRun = tools.find((entry) => entry.name === GATEWAY_DRY_RUN_TOOL);
  assert.ok(gatewayDryRun, "Staging Gateway dry-run descriptor missing");
  assert.equal(gatewayDryRun.inputSchema.additionalProperties, false);
  assert.deepEqual(gatewayDryRun.inputSchema.required, [
    "expected_source_commit",
    "expected_policy_hash",
    "environment_convergence_plan_sha256",
  ]);
  const gatewayProperties = new Set(Object.keys(gatewayDryRun.inputSchema.properties || {}));
  for (const forbidden of FORBIDDEN_CALLER_FIELDS) {
    assert.equal(gatewayProperties.has(forbidden), false, `Gateway dry-run must not expose ${forbidden}`);
  }
});

test("rebuild-empty Recovery descriptors expose only the bounded inspection, planning, and approval contracts", () => {
  const tools = buildStagingRecoverySystemTools(STAGING_ENV);
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  for (const name of REBUILD_EMPTY_TOOLS) {
    const tool = byName.get(name);
    assert.ok(tool, `${name} descriptor missing`);
    assert.equal(tool.inputSchema.additionalProperties, false);
  }

  const inspection = byName.get("staging_recovery_rebuild_empty_inspection_record").inputSchema;
  assert.deepEqual(inspection.required, ["expected_sha", "target_key", "correlation_id", "inspection", "role_bundle_bindings"]);
  assert.equal(inspection.properties.target_key.const, "staging-runtime");

  const prepare = byName.get("staging_recovery_rebuild_empty_prepare").inputSchema;
  assert.deepEqual(prepare.required, ["expected_sha", "inspection_run_id", "idempotency_key"]);

  const approve = byName.get("staging_recovery_rebuild_empty_approve").inputSchema;
  assert.deepEqual(approve.required, ["expected_sha", "inspection_run_id", "idempotency_key", "approval_confirmation"]);

  for (const schema of [inspection, prepare, approve]) {
    for (const forbidden of ["target_fingerprint", "operation", "raw_sql", "sql", "query", "command", "script", "credentials", "credential", "approval_token", "execution_ticket_id", "execution_ticket_hash", "signature", "grant_binding_hash", "plan_id", "step_id", "selected_roles", "target_role"]) {
      assert.equal(Object.hasOwn(schema.properties || {}, forbidden), false, `rebuild-empty schema must not expose ${forbidden}`);
    }
  }
  assert.equal(Object.hasOwn(prepare.properties, "target_key"), false);
  assert.equal(Object.hasOwn(approve.properties, "target_key"), false);
});

test("Staging Gateway dry-run System Tool forwards only immutable release bindings and never caller-selected provider authority", async () => {
  const input = {
    expected_source_commit: "a".repeat(40),
    expected_policy_hash: "b".repeat(64),
    environment_convergence_plan_sha256: "c".repeat(64),
  };
  let observed = null;
  const result = await stagingRecoveryActivationGatewayDarkDeployDryRun(input, {
    env: STAGING_ENV,
    runtimePool: {},
    governancePool: {},
    runDarkDeploy: async (args) => {
      observed = { ...args };
      return {
        ok: true,
        apply_ready: true,
        governance_state_mutation: true,
        provider_accessed: false,
        provider_mutation_performed: false,
        secrets_included: false,
      };
    },
  });
  assert.deepEqual(observed, { mode: "dry_run", ...input });
  assert.equal(result.system_tool, GATEWAY_DRY_RUN_TOOL);
  assert.equal(result.execution_plan_issued, true);
  assert.equal(result.apply_authority_issued, false);
  assert.equal(result.caller_selected_account_id, false);
  assert.equal(result.caller_selected_script_name, false);
  assert.equal(result.caller_selected_resource_binding, false);
  assert.equal(result.caller_selected_capability_envelope, false);
  assert.equal(result.provider_accessed, false);
  assert.equal(result.provider_mutation_performed, false);
  assert.equal(result.production_mutation_performed, false);

  await assert.rejects(
    () => stagingRecoveryActivationGatewayDarkDeployDryRun({ ...input, account_id: "caller-selected" }, {
      env: STAGING_ENV,
      runDarkDeploy: async () => ({ ok: true }),
    }),
    (error) => error?.code === "STAGING_RECOVERY_GATEWAY_PREFLIGHT_FIELD_FORBIDDEN"
      && error?.details?.fields?.includes("account_id"),
  );
});

test("Production and conflicting-environment calls fail before any Staging recovery authority can be constructed", async () => {
  for (const env of [PRODUCTION_ENV, CONFLICTING_ENV]) {
    const attempts = [
      () => stagingRecoveryCertificationCanaryPlanCreate({ expected_sha: "a".repeat(40) }, { env }),
      () => stagingRecoveryCertificationCanaryApprove({
        plan_id: `plan:${"1".repeat(32)}`,
        plan_hash: "2".repeat(64),
        step_id: `step:${"3".repeat(32)}`,
        idempotency_key: "staging-recovery-canary-approve-test",
        approval_confirmation: "APPROVE_STAGING_RECOVERY_CERTIFICATION_CANARY:bounded",
      }, { env }),
      () => stagingRecoveryCertificationCanaryExecute({
        plan_id: `plan:${"1".repeat(32)}`,
        plan_hash: "2".repeat(64),
        step_id: `step:${"3".repeat(32)}`,
        idempotency_key: "staging-recovery-canary-execute-test",
      }, { env }),
      () => stagingRecoveryAccessRepairPrepare({
        expected_sha: "a".repeat(40),
        idempotency_key: "staging-recovery-test-001",
      }, { env }),
      () => stagingRecoveryAccessRepairApprove({
        plan_id: `plan:${"1".repeat(32)}`,
        plan_hash: "2".repeat(64),
        step_id: `step:${"3".repeat(32)}`,
        idempotency_key: "staging-recovery-test-002",
        approval_confirmation: "APPROVE_STAGING_DATABASE_ACCESS_REPAIR:bounded",
      }, { env }),
    ];
    for (const attempt of attempts) {
      await assert.rejects(attempt, (error) => error?.code === "STAGING_RECOVERY_SYSTEM_SURFACE_UNAVAILABLE" && error?.status === 404);
    }
  }
});

test("surface readiness outside Staging is a no-mutation not-advertised verdict", async () => {
  const result = await stagingRecoverySystemSurfaceReadiness({}, { env: PRODUCTION_ENV });
  assert.equal(result.ok, true);
  assert.equal(result.status, "pass");
  assert.equal(result.available, false);
  assert.equal(result.production_authority, false);
  assert.equal(result.mutations_executed, false);
  assert.equal(result.secrets_included, false);
});

test("B2A Remote MCP foundation corrective migration is additive schema-only repair", () => {
  const canonicalPath = new URL("./migrations/20261003_staging_remote_mcp_runtime_foundation_reconciliation.sql", import.meta.url);
  const recoveryPath = new URL("./staging-recovery-migrations/20261003_staging_remote_mcp_runtime_foundation_reconciliation.sql", import.meta.url);
  assert.equal(existsSync(canonicalPath), false, "incident repair must remain outside the canonical ordered migration chain");
  assert.equal(existsSync(recoveryPath), true);
  const sql = readFileSync(recoveryPath, "utf8");
  assert.equal((sql.match(/CREATE TABLE IF NOT EXISTS/giu) || []).length, 4);
  assert.equal((sql.match(/COLLATE=utf8mb4_unicode_ci/giu) || []).length, 4, "every corrective table must declare the governed collation explicitly");
  for (const table of [
    "platform_runtime_config",
    "remote_mcp_oauth_clients",
    "remote_mcp_oauth_authorization_codes",
    "remote_mcp_oauth_grants",
  ]) {
    assert.match(sql, new RegExp("CREATE TABLE IF NOT EXISTS `" + table + "`", "u"));
  }
  const statements = sql
    .replace(/^\s*--.*$/gmu, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  assert.equal(statements.length, 4, "corrective migration must contain exactly four SQL statements");
  for (const statement of statements) {
    assert.match(statement, /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\b/iu, "corrective migration may contain CREATE TABLE IF NOT EXISTS statements only");
  }
});

test("Staging Activation registry corrective migration is recovery-only additive schema repair", () => {
  const canonicalPath = new URL("./migrations/20261003_staging_activation_registry_schema_reconciliation.sql", import.meta.url);
  const recoveryPath = new URL("./staging-recovery-migrations/20261003_staging_activation_registry_schema_reconciliation.sql", import.meta.url);
  assert.equal(existsSync(canonicalPath), false, "Activation incident repair must remain outside the canonical ordered migration chain");
  assert.equal(existsSync(recoveryPath), true);
  const sql = readFileSync(recoveryPath, "utf8");
  for (const table of [
    "activation_dynamic_tab_registry",
    "activation_dynamic_tab_section_registry",
    "activation_dynamic_tab_discovery_rule_registry",
    "activation_section_action_registry",
    "activation_attention_rule_registry",
    "activation_freshness_policy_registry",
    "activation_signal_subscription_registry",
    "activation_connector_pack_registry",
  ]) {
    assert.match(sql, new RegExp("CREATE TABLE IF NOT EXISTS " + table + "\\b", "u"));
  }
  const executableSql = sql.replace(/^\s*--.*$/gmu, "");
  const statements = executableSql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  assert.equal(statements.length, 8);
  for (const statement of statements) {
    assert.match(statement, /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\b/iu);
  }
  assert.doesNotMatch(executableSql, /(?:^|;)\s*(?:INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/iu);
});

test("Staging schema-repair prepare derives the fixed repository migration contract and rejects caller mutation controls", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "staging-schema-repair-"));
  try {
    const env = stagingEnv(root);
    const authority = createStagingSchemaRepairTicketAuthority({ env });
    const prepared = await authority.prepare({ expected_sha: SHA, migration: MIGRATION, idempotency_key: "staging-schema-prepare-001" });
    assert.equal(prepared.ok, true);
    assert.equal(prepared.contract, STAGING_SCHEMA_REPAIR_TICKET_AUTHORITY_CONTRACT);
    assert.equal(prepared.capability, STAGING_SCHEMA_REPAIR_CAPABILITY);
    assert.equal(prepared.status, "approval_required");
    assert.equal(prepared.migration, MIGRATION);
    assert.equal(prepared.migration_sha256, MIGRATION_SHA256);
    assert.equal(prepared.statement_count, 1);
    assert.equal(prepared.target_role, "runtime");
    assert.equal(prepared.server_derived_migration_contract, true);
    assert.equal(prepared.execution_ticket_not_returned, true);
    assert.equal(prepared.raw_sql_allowed, false);
    assert.equal(prepared.caller_database_allowed, false);
    assert.equal(prepared.approval_confirmation, `APPLY_STAGING_RUNTIME_MIGRATION:${SHA}:staging-runtime:${MIGRATION}`);
    assert.match(prepared.migration_binding_hash, /^[0-9a-f]{64}$/u);

    for (const extra of [
      { raw_sql: "ALTER TABLE actions ADD COLUMN bad INT" },
      { database: "caller_selected" },
      { target_key: "production-runtime" },
      { execution_ticket_id: "ticket:caller" },
      { migration_sha256: MIGRATION_SHA256 },
    ]) {
      await assert.rejects(
        () => authority.prepare({ expected_sha: SHA, migration: MIGRATION, idempotency_key: "staging-schema-prepare-002", ...extra }),
        (error) => error?.code === "RECOVERY_SCHEMA_REPAIR_FIELD_FORBIDDEN",
      );
    }

    const catalogPrepared = await authority.prepare({
      expected_sha: SHA,
      migration: "20260815_custom_gpt_mcp_catalog_levels.sql",
      idempotency_key: "staging-schema-prepare-catalog-001",
    });
    assert.equal(catalogPrepared.migration, "20260815_custom_gpt_mcp_catalog_levels.sql");
    assert.equal(catalogPrepared.migration_sha256, "528143808adac23eb457058c4c34dd95c4c5d462bca9ac4b170b1f19b2006681");
    assert.equal(catalogPrepared.statement_count, 7);
    assert.equal(catalogPrepared.target_role, "runtime");
    assert.equal(
      catalogPrepared.approval_confirmation,
      `APPLY_STAGING_RUNTIME_MIGRATION:${SHA}:staging-runtime:20260815_custom_gpt_mcp_catalog_levels.sql`,
    );

    const remoteMcpPrepared = await authority.prepare({
      expected_sha: SHA,
      migration: REMOTE_MCP_FOUNDATION_MIGRATION,
      idempotency_key: "staging-schema-prepare-remote-mcp-foundation-001",
    });
    assert.equal(remoteMcpPrepared.migration, REMOTE_MCP_FOUNDATION_MIGRATION);
    assert.equal(remoteMcpPrepared.migration_sha256, REMOTE_MCP_FOUNDATION_MIGRATION_SHA256);
    assert.equal(remoteMcpPrepared.statement_count, 4);
    assert.equal(remoteMcpPrepared.target_role, "runtime");
    assert.equal(_testingStagingSchemaRepairSystemTools.resolveMigration(REMOTE_MCP_FOUNDATION_MIGRATION).migration.artifact_scope, "staging_recovery_only");
    assert.equal(remoteMcpPrepared.raw_sql_allowed, false);
    assert.equal(remoteMcpPrepared.caller_database_allowed, false);
    assert.equal(
      remoteMcpPrepared.approval_confirmation,
      `APPLY_STAGING_RUNTIME_MIGRATION:${SHA}:staging-runtime:${REMOTE_MCP_FOUNDATION_MIGRATION}`,
    );

    const activationPrepared = await authority.prepare({
      expected_sha: SHA,
      migration: ACTIVATION_REGISTRY_MIGRATION,
      idempotency_key: "staging-schema-prepare-activation-registry-001",
    });
    assert.equal(activationPrepared.migration, ACTIVATION_REGISTRY_MIGRATION);
    assert.equal(activationPrepared.migration_sha256, ACTIVATION_REGISTRY_MIGRATION_SHA256);
    assert.equal(activationPrepared.statement_count, 8);
    assert.equal(activationPrepared.target_role, "runtime");
    assert.equal(_testingStagingSchemaRepairSystemTools.resolveMigration(ACTIVATION_REGISTRY_MIGRATION).migration.artifact_scope, "staging_recovery_only");
    assert.equal(activationPrepared.raw_sql_allowed, false);
    assert.equal(activationPrepared.caller_database_allowed, false);
    assert.equal(
      activationPrepared.approval_confirmation,
      `APPLY_STAGING_RUNTIME_MIGRATION:${SHA}:staging-runtime:${ACTIVATION_REGISTRY_MIGRATION}`,
    );

    await assert.rejects(
      () => authority.prepare({ expected_sha: SHA, migration: "99999999_unregistered.sql", idempotency_key: "staging-schema-prepare-003" }),
      (error) => error?.code === "RECOVERY_SCHEMA_REPAIR_MIGRATION_NOT_ALLOWLISTED",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Staging schema-repair approval issues one signed single-use migration ticket held server-side", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "staging-schema-ticket-"));
  try {
    const env = stagingEnv(root);
    const roots = _testingStagingRecoveryAuthorityBinding.roots(env);
    const graph = _testingStagingRecoveryAuthorityBinding.adapters(roots.readiness, env).adapters;
    const authority = createStagingSchemaRepairTicketAuthority({ env });
    const prepared = await authority.prepare({ expected_sha: SHA, migration: MIGRATION, idempotency_key: "staging-schema-prepare-004" });

    await assert.rejects(
      () => authority.approveAndIssue({ plan_id: prepared.plan_id, plan_hash: prepared.plan_hash, step_id: prepared.step_id, idempotency_key: "staging-schema-execute-004", approval_confirmation: `${prepared.approval_confirmation}:tampered` }),
      (error) => error?.code === "RECOVERY_APPROVAL_INVALID",
    );

    const issued = await authority.approveAndIssue({ plan_id: prepared.plan_id, plan_hash: prepared.plan_hash, step_id: prepared.step_id, idempotency_key: "staging-schema-execute-004", approval_confirmation: prepared.approval_confirmation });
    assert.equal(issued.ok, true);
    assert.equal(issued.status, "ticket_issued_server_side");
    assert.equal(issued.execution_ticket_held_server_side, true);
    assert.equal(issued.execution_ticket_not_returned, true);
    assert.equal(Object.hasOwn(issued, "ticket_id"), false);
    assert.equal(Object.hasOwn(issued, "ticket_hash"), false);
    assert.equal(Object.hasOwn(issued, "signature"), false);
    assert.equal(Object.hasOwn(issued, "server_token"), false);

    const storedPlan = await graph.recoveryStore.getPlan(prepared.plan_id);
    assert.match(storedPlan.execution_ticket_id, /^ticket:/u);
    assert.match(storedPlan.execution_ticket_hash, /^[0-9a-f]{64}$/u);
    const ticket = await graph.recoveryStore.getExecutionTicket(storedPlan.execution_ticket_id);
    assert.equal(ticket.operation, "migration");
    assert.equal(ticket.production_sha, SHA);
    assert.equal(ticket.target_key, "staging-runtime");
    assert.equal(ticket.plan_hash, prepared.plan_hash);
    assert.equal(ticket.step_id, prepared.step_id);
    assert.equal(ticket.target_role, "runtime");
    assert.equal(ticket.single_use, true);
    assert.equal(typeof ticket.signature, "string");

    const verified = await verifyExecutionTicket(ticket, {
      verifier: graph.executionTicketVerifier,
      expected: {
        production_sha: SHA,
        target_key: "staging-runtime",
        target_fingerprint: prepared.target_fingerprint,
        plan_hash: prepared.plan_hash,
        step_hash: prepared.step_hash,
        step_id: prepared.step_id,
        target_role: "runtime",
        operation: "migration",
        idempotency_key: "staging-schema-execute-004",
      },
    });
    assert.equal(verified.valid, true);

    await assert.rejects(
      () => authority.approveAndIssue({ plan_id: prepared.plan_id, plan_hash: prepared.plan_hash, step_id: prepared.step_id, idempotency_key: "staging-schema-execute-replay", approval_confirmation: prepared.approval_confirmation }),
      (error) => error?.code === "RECOVERY_APPROVAL_INVALID",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Staging schema-repair public approval returns one verified local Windows/Docker handoff without exposing ticket signature", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "staging-schema-local-handoff-"));
  try {
    const env = stagingEnv(root);
    const prepared = await stagingRecoverySchemaRepairPrepare({
      expected_sha: SHA,
      migration: REMOTE_MCP_FOUNDATION_MIGRATION,
      idempotency_key: "staging-schema-handoff-prepare-001",
    }, { env });

    const approved = await stagingRecoverySchemaRepairApprove({
      plan_id: prepared.plan_id,
      plan_hash: prepared.plan_hash,
      step_id: prepared.step_id,
      idempotency_key: "staging-schema-handoff-execute-001",
      approval_confirmation: prepared.approval_confirmation,
    }, { env });

    assert.equal(approved.ok, true);
    assert.equal(approved.status, "execution_ticket_issued_local_handoff_ready");
    assert.equal(approved.local_execution_required, true);
    assert.equal(approved.execution_ticket_held_server_side, true);
    assert.equal(approved.execution_ticket_not_returned, true);
    assert.equal(Object.hasOwn(approved, "ticket_id"), false);
    assert.equal(Object.hasOwn(approved, "ticket_hash"), false);
    assert.equal(Object.hasOwn(approved, "signature"), false);

    const handoff = approved.local_handoff;
    assert.equal(handoff.status, "local_execution_required");
    assert.equal(handoff.local_windows_docker_required, true);
    assert.equal(handoff.execution_ticket_signature_exposed, false);
    assert.equal(handoff.database_mutation_performed, false);
    assert.equal(handoff.production_authority, false);
    assert.match(handoff.command, /^node scripts\/host-breakglass-local-verified\.mjs --request-file \.\\verified-staging-schema-repair-/u);
    assert.equal(handoff.verified_request.runbook_key, "database.schema_repair");
    assert.equal(handoff.verified_request.action, "apply_migration");
    assert.equal(handoff.verified_request.expected_sha, SHA);
    assert.equal(handoff.verified_request.migration, REMOTE_MCP_FOUNDATION_MIGRATION);
    assert.equal(handoff.verified_request.authority_plan_hash, prepared.plan_hash);
    assert.match(handoff.verified_request.execution_ticket_id, /^ticket:/u);
    assert.match(handoff.verified_request.execution_ticket_hash, /^[0-9a-f]{64}$/u);
    assert.equal(handoff.authority_plan_hash_separate_from_transport_plan, true);
    assert.notEqual(handoff.transport_plan_sha256, prepared.plan_hash);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Activation registry schema repair reuses the verified local Windows/Docker execution-ticket handoff", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "staging-activation-schema-local-handoff-"));
  try {
    const env = stagingEnv(root);
    const prepared = await stagingRecoverySchemaRepairPrepare({
      expected_sha: SHA,
      migration: ACTIVATION_REGISTRY_MIGRATION,
      idempotency_key: "staging-activation-schema-handoff-prepare-001",
    }, { env });

    const approved = await stagingRecoverySchemaRepairApprove({
      plan_id: prepared.plan_id,
      plan_hash: prepared.plan_hash,
      step_id: prepared.step_id,
      idempotency_key: "staging-activation-schema-handoff-execute-001",
      approval_confirmation: prepared.approval_confirmation,
    }, { env });

    assert.equal(approved.status, "execution_ticket_issued_local_handoff_ready");
    assert.equal(approved.local_execution_required, true);
    assert.equal(approved.execution_ticket_held_server_side, true);
    assert.equal(approved.execution_ticket_not_returned, true);
    assert.equal(approved.production_authority, false);

    const handoff = approved.local_handoff;
    assert.equal(handoff.status, "local_execution_required");
    assert.equal(handoff.local_windows_docker_required, true);
    assert.equal(handoff.verified_request.runbook_key, "database.schema_repair");
    assert.equal(handoff.verified_request.action, "apply_migration");
    assert.equal(handoff.verified_request.migration, ACTIVATION_REGISTRY_MIGRATION);
    assert.equal(handoff.verified_request.expected_sha, SHA);
    assert.equal(handoff.verified_request.authority_plan_hash, prepared.plan_hash);
    assert.match(handoff.verified_request.execution_ticket_id, /^ticket:/u);
    assert.match(handoff.verified_request.execution_ticket_hash, /^[0-9a-f]{64}$/u);
    assert.equal(handoff.execution_ticket_signature_exposed, false);
    assert.equal(handoff.database_mutation_performed, false);
    assert.equal(handoff.production_authority, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Schema-repair descriptors expose only high-level plan/approval/execution references and no raw mutation controls", () => {
  const tools = buildStagingSchemaRepairSystemTools();
  assert.deepEqual(tools.map((entry) => entry.name), [
    "staging_recovery_schema_repair_prepare",
    "staging_recovery_schema_repair_approve",
    "staging_recovery_schema_repair_execute",
  ]);
  const prepare = tools[0].inputSchema;
  assert.deepEqual(prepare.required, ["expected_sha", "migration", "idempotency_key"]);
  for (const forbidden of ["sql", "raw_sql", "database", "target_key", "script_path", "execution_ticket_id", "execution_ticket_hash"]) {
    assert.equal(Object.hasOwn(prepare.properties, forbidden), false);
  }
  const directDatabaseExecutor = async () => ({ ok: true });
  directDatabaseExecutor.staging_database_mutation_authority = true;
  const positive = _testingStagingSchemaRepairSystemTools.schemaExecutionReady({
    hostBreakglassMutationExecutor: directDatabaseExecutor,
    recoveryLock: { acquire() {}, heartbeat() {}, assertFence() {}, release() {} },
    readbackVerifier: { verify() {}, independent_authority: true, role_aware: true, mutation_authority: false },
    migrationLedger: { finalize() {} },
    deploymentIdentityProvider: { readAttestation() {} },
    recoveryStore: { getExecutionTicket() {}, reserveExecutionTicket() {}, finalizeExecutionTicket() {}, markApprovalUsed() {} },
  });
  assert.equal(positive, true);
  assert.equal(_testingStagingSchemaRepairSystemTools.schemaExecutionReady({}), false);
  assert.equal(_testingStagingSchemaRepairSystemTools.schemaExecutionReady({
    hostBreakglassMutationExecutor: async () => ({ ok: true }),
    recoveryLock: { acquire() {}, heartbeat() {}, assertFence() {}, release() {} },
    readbackVerifier: { verify() {}, independent_authority: true, role_aware: true, mutation_authority: false },
    migrationLedger: { finalize() {} },
    deploymentIdentityProvider: { readAttestation() {} },
    recoveryStore: { getExecutionTicket() {}, reserveExecutionTicket() {}, finalizeExecutionTicket() {}, markApprovalUsed() {} },
  }), false, "an unmarked canary/file executor must never advertise direct database schema mutation authority");
});

console.log("staging recovery system tool contract tests loaded");

test("dedicated Staging certification canary approve/execute resolves approval server-side and never exposes Production authority", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "staging-recovery-canary-system-tool-"));
  try {
    const env = { ...stagingEnv(root), RECOVERY_MUTATIONS_ENABLED: "true" };
    const planned = await stagingRecoveryCertificationCanaryPlanCreate({ expected_sha: SHA }, { env });
    assert.equal(planned.status, "approval_required");
    assert.match(planned.approval_confirmation, /^APPROVE_STAGING_RECOVERY_CERTIFICATION_CANARY:/u);
    assert.equal(planned.approval_token_returned, false);
    assert.equal(planned.execution_ticket_returned, false);
    assert.equal(planned.production_authority, false);

    const idempotencyKey = "staging-canary-system-tool:exact";
    await assert.rejects(
      () => stagingRecoveryCertificationCanaryApprove({
        plan_id: planned.plan_id,
        plan_hash: planned.plan_hash,
        step_id: planned.steps[0].step_id,
        idempotency_key: "staging-canary-system-tool:wrong-confirmation",
        approval_confirmation: `${planned.approval_confirmation}:tampered`,
      }, { env }),
      (error) => error?.code === "STAGING_RECOVERY_CANARY_APPROVAL_INVALID"
        && error?.status === 401,
    );

    const approved = await stagingRecoveryCertificationCanaryApprove({
      plan_id: planned.plan_id,
      plan_hash: planned.plan_hash,
      step_id: planned.steps[0].step_id,
      idempotency_key: idempotencyKey,
      approval_confirmation: planned.approval_confirmation,
    }, { env });
    assert.equal(approved.status, "ticket_issued");
    assert.equal(approved.approval_token_returned, false);
    assert.equal(approved.execution_ticket_returned, false);
    assert.equal(Object.hasOwn(approved, "execution_ticket_id"), false);
    assert.equal(Object.hasOwn(approved, "execution_ticket_hash"), false);
    assert.equal(approved.database_mutation_performed, false);
    assert.equal(approved.provider_mutation_performed, false);
    assert.equal(approved.production_authority, false);

    const executed = await stagingRecoveryCertificationCanaryExecute({
      plan_id: planned.plan_id,
      plan_hash: planned.plan_hash,
      step_id: planned.steps[0].step_id,
      idempotency_key: idempotencyKey,
    }, { env });
    assert.equal(executed.ok, true);
    assert.equal(executed.approval_token_returned, false);
    assert.equal(executed.execution_ticket_returned, false);
    assert.equal(Object.hasOwn(executed, "execution_ticket_id"), false);
    assert.equal(Object.hasOwn(executed, "execution_ticket_hash"), false);
    assert.equal(executed.database_mutation_performed, false);
    assert.equal(executed.provider_mutation_performed, false);
    assert.equal(executed.production_authority, false);

    const replay = await stagingRecoveryCertificationCanaryExecute({
      plan_id: planned.plan_id,
      plan_hash: planned.plan_hash,
      step_id: planned.steps[0].step_id,
      idempotency_key: idempotencyKey,
    }, { env });
    assert.equal(replay.idempotent_replay, true);
    assert.equal(replay.approval_token_returned, false);
    assert.equal(replay.execution_ticket_returned, false);

    const readiness = await stagingRecoverySystemSurfaceReadiness({}, { env });
    assert.equal(readiness.server_managed_approval_resolver_ready, true);
    assert.equal(readiness.dedicated_certification_canary_approve_execute, true);
    assert.equal(readiness.production_authority, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test("certification canary evidence redaction removes nested approval and execution-ticket material", () => {
  const sanitized = _testingStagingRecoverySystemTools.sanitizeCanaryReplay({
    status: "reconciliation_required",
    execution_ticket_id: "ticket:top-level",
    execution_ticket_hash: "a".repeat(64),
    approval_token: "approval-token-top-level",
    nested: {
      execution_ticket_id: "ticket:nested",
      execution_ticket_hash: "b".repeat(64),
      server_token: "server-token-nested",
      signature: "signature-nested",
      safe_hash: "c".repeat(64),
      deeper: [{
        approval_token: "approval-token-array",
        execution_ticket_id: "ticket:array",
        safe: true,
      }],
    },
  });
  assert.equal(Object.hasOwn(sanitized, "execution_ticket_id"), false);
  assert.equal(Object.hasOwn(sanitized, "execution_ticket_hash"), false);
  assert.equal(Object.hasOwn(sanitized, "approval_token"), false);
  assert.equal(Object.hasOwn(sanitized.nested, "execution_ticket_id"), false);
  assert.equal(Object.hasOwn(sanitized.nested, "execution_ticket_hash"), false);
  assert.equal(Object.hasOwn(sanitized.nested, "server_token"), false);
  assert.equal(Object.hasOwn(sanitized.nested, "signature"), false);
  assert.equal(Object.hasOwn(sanitized.nested.deeper[0], "approval_token"), false);
  assert.equal(Object.hasOwn(sanitized.nested.deeper[0], "execution_ticket_id"), false);
  assert.equal(sanitized.nested.safe_hash, "c".repeat(64));
  assert.equal(sanitized.nested.deeper[0].safe, true);
  assert.equal(sanitized.approval_token_returned, false);
  assert.equal(sanitized.execution_ticket_returned, false);
  assert.equal(sanitized.production_authority, false);
  assert.equal(sanitized.secrets_included, false);
});
