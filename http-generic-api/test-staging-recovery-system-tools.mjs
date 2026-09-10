import assert from "node:assert/strict";
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
} from "./stagingSchemaRepairSystemTools.js";
import {
  buildStagingRecoverySystemTools,
  isStagingRecoverySystemEnvironment,
  stagingRecoveryAccessRepairApprove,
  stagingRecoveryAccessRepairPrepare,
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
  "staging_recovery_access_repair_prepare",
  "staging_recovery_access_repair_execute",
  "staging_recovery_access_repair_approve",
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
]);

const SHA = "a".repeat(40);
const TREE = "b".repeat(40);
const CONTEXT = "c".repeat(64);
const MIGRATION = "20260902_staging_actions_runtime_contract_reconciliation.sql";
const MIGRATION_SHA256 = "6ca8879ec300b5970f6ddc3d9eeded38eda8dee12abd6bdeb7ba7d2ffa53ee2c";

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
});

test("Production and conflicting-environment calls fail before any Staging recovery authority can be constructed", async () => {
  for (const env of [PRODUCTION_ENV, CONFLICTING_ENV]) {
    const attempts = [
      () => stagingRecoveryCertificationCanaryPlanCreate({ expected_sha: "a".repeat(40) }, { env }),
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
  const positive = _testingStagingSchemaRepairSystemTools.schemaExecutionReady({
    hostBreakglassMutationExecutor: async () => ({}),
    recoveryLock: { acquire() {}, heartbeat() {}, assertFence() {}, release() {} },
    readbackVerifier: { verify() {}, independent_authority: true, role_aware: true, mutation_authority: false },
    migrationLedger: { finalize() {} },
    deploymentIdentityProvider: { readAttestation() {} },
    recoveryStore: { getExecutionTicket() {}, reserveExecutionTicket() {}, finalizeExecutionTicket() {}, markApprovalUsed() {} },
  });
  assert.equal(positive, true);
  assert.equal(_testingStagingSchemaRepairSystemTools.schemaExecutionReady({}), false);
});

console.log("staging recovery system tool contract tests loaded");