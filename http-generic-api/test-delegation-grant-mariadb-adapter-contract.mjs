import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { planDelegationGrantCreateShadow } from "./delegationGrantLifecycleShadowService.js";
import { executeDelegationGrantRepositoryMutation } from "./delegationGrantRepositoryMutationService.js";
import {
  createDelegationGrantMariaDbRepository,
  _testingDelegationGrantMariaDbRepository,
} from "./delegationGrantMariaDbRepository.js";
import {
  evaluateDelegationGrantMariaDbReadiness,
  _testingDelegationGrantMariaDbValidation,
} from "./delegationGrantMariaDbValidationService.js";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const GRANT_ID = "22222222-2222-4222-8222-222222222222";
const PLAN_ID = "33333333-3333-4333-8333-333333333333";
const OPERATION_ID = "44444444-4444-4444-8444-444444444444";
const STEP_ID = "55555555-5555-4555-8555-555555555555";
const CAPABILITY_ENVELOPE_ID = "66666666-6666-4666-8666-666666666666";
const APPROVAL_HOLD_ID = "77777777-7777-4777-8777-777777777777";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const NOW = "2026-07-29T03:00:00.000Z";

function readiness() {
  return {
    status: "verified_applied",
    migration_applied: true,
    readback_complete: true,
    migration_checksum_sha256: HASH_A,
    statement_count: 2,
    schema_readback_fingerprint: HASH_B,
  };
}

function buildPlan() {
  return planDelegationGrantCreateShadow({
    preview: {
      decision: "eligible_preview",
      grant_hash: HASH_C,
      grant: {
        schema_version: "spec011-delegation-grant-shadow-v1",
        grant_id: GRANT_ID,
        delegated_by: "user-1",
        delegated_to: "agent-1",
        approval_mode: "delegated_plan_bound",
        plan_id: PLAN_ID,
        plan_hash: HASH_A,
        resource_scope: [{ resource_uri: "github://owner/repo", snapshot_hash: HASH_B }],
        allowed_intents: ["repo.patch.apply"],
        denied_intents: ["repo.pr.merge"],
        max_risk_tier: "medium",
        limits: { max_mutations: 3, max_retries: 1, max_pull_requests: 1 },
        require_readback: true,
        stop_on_drift: true,
        policy_version: "policy-v1",
        status: "preview",
        created_at: "2026-07-29T02:00:00.000Z",
        expires_at: "2026-07-29T04:00:00.000Z",
        revoked_at: null,
        secrets_included: false,
      },
    },
    schemaReadiness: readiness(),
    operationId: OPERATION_ID,
    stepId: STEP_ID,
    idempotencyKey: "slice-f-create-001",
    requestedBy: "user-1",
    principalScope: "tenant",
    providerOrAdapter: "delegation_mariadb_adapter_contract",
    now: NOW,
  });
}

function authorization(plan) {
  return {
    approved: true,
    capability_envelope_id: CAPABILITY_ENVELOPE_ID,
    approval_hold_id: APPROVAL_HOLD_ID,
    resource_authority_ref: "resource-authority:slice-f-test",
    expected_request_fingerprint: plan.request_fingerprint,
  };
}

class FakeConnection {
  constructor() {
    this.receipts = new Map();
    this.grants = new Map();
    this.calls = [];
    this.began = false;
    this.committed = false;
    this.rolledBack = false;
    this.released = false;
  }

  async beginTransaction() {
    this.began = true;
  }

  async execute(sql, params = []) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    this.calls.push({ sql: normalized, params: structuredClone(params) });

    if (normalized.startsWith("SELECT receipt_id") && normalized.includes("operation_key = ?")) {
      const [operationKey, idempotencyKey] = params;
      return [[...this.receipts.values()].filter(
        (row) => row.operation_key === operationKey && row.idempotency_key === idempotencyKey,
      ).slice(0, 2)];
    }

    if (normalized.startsWith("INSERT INTO repository_automation_receipts")) {
      const [receiptId, runId, stepKey, operationKey, idempotencyKey, requestSha, receiptJson] = params;
      this.receipts.set(receiptId, {
        receipt_id: receiptId,
        run_id: runId,
        step_key: stepKey,
        operation_key: operationKey,
        idempotency_key: idempotencyKey,
        request_sha256: requestSha,
        dispatch_status: "pending",
        provider_status: null,
        provider_receipt_json: receiptJson,
        readback_json: null,
        recovered_from_transport: 0,
      });
      return [{ affectedRows: 1 }];
    }

    if (normalized.startsWith("INSERT INTO agent_delegations")) {
      assert.match(normalized, /grant_schema_version, approval_mode, user_id/);
      const [
        delegationId, schemaVersion, approvalMode, userId, tenantId, agentId,
        intentKey, planId, planHash, resourceScopeJson, resourceScopeHash,
        allowedIntentsJson, deniedIntentsJson, maxRiskTier, maxMutations,
        maxRetries, maxPullRequests, policyVersion, grantHash, idempotencyKey,
        canonicalStatus, approvedBy, approvedAt, canonicalCreatedAt,
        canonicalUpdatedAt, expiresAt,
      ] = params;
      this.grants.set(`${tenantId}:${delegationId}`, {
        delegation_id: delegationId,
        grant_schema_version: schemaVersion,
        approval_mode: approvalMode,
        user_id: userId,
        tenant_id: tenantId,
        agent_id: agentId,
        intent_key: intentKey,
        plan_id: planId,
        plan_hash: planHash,
        resource_scope_json: resourceScopeJson,
        resource_scope_hash: resourceScopeHash,
        allowed_intents_json: allowedIntentsJson,
        denied_intents_json: deniedIntentsJson,
        max_risk_tier: maxRiskTier,
        max_mutations: maxMutations,
        max_retries: maxRetries,
        max_pull_requests: maxPullRequests,
        require_readback: 1,
        stop_on_drift: 1,
        policy_version: policyVersion,
        grant_hash: grantHash,
        idempotency_key: idempotencyKey,
        status: "pending",
        canonical_status: canonicalStatus,
        approved_by: approvedBy,
        approved_at: approvedAt,
        runtime_policy_ready: 0,
        canonical_created_at: canonicalCreatedAt,
        canonical_updated_at: canonicalUpdatedAt,
        expires_at: expiresAt,
        revoked_at: null,
      });
      return [{ affectedRows: 1 }];
    }

    if (normalized.startsWith("SELECT delegation_id")) {
      const [tenantId, grantId] = params;
      const row = this.grants.get(`${tenantId}:${grantId}`);
      return [row ? [structuredClone(row)] : []];
    }

    if (normalized.startsWith("UPDATE repository_automation_receipts")) {
      const [dispatchStatus, receiptJson, readbackJson, receiptId, operationKey] = params;
      const row = this.receipts.get(receiptId);
      if (!row || row.operation_key !== operationKey) return [{ affectedRows: 0 }];
      Object.assign(row, {
        dispatch_status: dispatchStatus,
        provider_status: 200,
        provider_receipt_json: receiptJson,
        readback_json: readbackJson,
        recovered_from_transport: 0,
      });
      return [{ affectedRows: 1 }];
    }

    if (normalized.startsWith("SELECT receipt_id") && normalized.includes("receipt_id = ?")) {
      const row = this.receipts.get(params[0]);
      return [row ? [structuredClone(row)] : []];
    }

    throw new Error(`Unexpected SQL in fake engine: ${normalized}`);
  }

  async commit() {
    this.committed = true;
  }

  async rollback() {
    this.rolledBack = true;
  }

  release() {
    this.released = true;
  }
}

class FakePool {
  constructor(connection) {
    this.connection = connection;
  }

  async getConnection() {
    return this.connection;
  }
}

{
  const connection = new FakeConnection();
  const repository = createDelegationGrantMariaDbRepository({ pool: new FakePool(connection) });
  const plan = buildPlan();
  const result = await executeDelegationGrantRepositoryMutation({
    repository,
    plan,
    tenantId: TENANT_ID,
    schemaReadiness: readiness(),
    authorization: authorization(plan),
    now: NOW,
  });

  assert.equal(result.decision, "verified_success");
  assert.equal(result.grant.approval_mode, "delegated_plan_bound");
  assert.equal(result.receipt.state, "reconciled");
  assert.equal(result.receipt.readback_complete, true);
  assert.equal(connection.began, true);
  assert.equal(connection.committed, true);
  assert.equal(connection.rolledBack, false);
  assert.equal(connection.released, true);

  const storedGrant = connection.grants.get(`${TENANT_ID}:${GRANT_ID}`);
  assert.equal(storedGrant.runtime_policy_ready, 0);
  assert.equal(storedGrant.status, "pending");
  assert.equal(storedGrant.canonical_status, "active");
  assert.equal(storedGrant.approval_mode, "delegated_plan_bound");
  assert.equal(storedGrant.approved_by, "user-1");
}

{
  const completeSchema = {
    status: "pass",
    readback_complete: true,
    row_data_read: false,
    secrets_included: false,
    tables: [..._testingDelegationGrantMariaDbValidation.REQUIRED_TABLES],
    agent_delegations_columns: [..._testingDelegationGrantMariaDbValidation.REQUIRED_AGENT_COLUMNS],
    agent_delegations_indexes: [..._testingDelegationGrantMariaDbValidation.REQUIRED_AGENT_INDEXES],
    repository_automation_receipts_indexes:
      [..._testingDelegationGrantMariaDbValidation.REQUIRED_RECEIPT_INDEXES],
    effective_view_present: true,
  };
  const completeEngine = {
    storage_engine: "InnoDB",
    character_set: "utf8mb4",
    collation: "utf8mb4_unicode_ci",
    sql_mode: "STRICT_TRANS_TABLES,NO_ZERO_DATE",
    json_supported: true,
    check_constraints_enforced: true,
    transaction_isolation_verified: true,
    secrets_included: false,
  };
  const verified = evaluateDelegationGrantMariaDbReadiness({
    migrationEvidence: {
      mode: "apply",
      ledger_status: "applied",
      migration_checksum_sha256: HASH_A,
      statement_count: 2,
      readback_complete: true,
      ledger_evidence_ref: "migration-ledger:test",
    },
    schemaReadback: completeSchema,
    engineEvidence: completeEngine,
    rollbackAssessment: {
      status: "pass",
      destructive_change_detected: false,
      runtime_binding_enabled: false,
    },
    now: NOW,
  });
  assert.equal(verified.status, "verified_applied");
  assert.equal(verified.migration_applied, true);
  assert.match(verified.schema_readback_fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(verified.guarantees.database_write_performed, false);

  const blocked = evaluateDelegationGrantMariaDbReadiness({
    migrationEvidence: { mode: "dry_run", ledger_status: "planned" },
    schemaReadback: { ...completeSchema, effective_view_present: false },
    engineEvidence: { ...completeEngine, transaction_isolation_verified: false },
    rollbackAssessment: { status: "blocked", runtime_binding_enabled: true },
    now: NOW,
  });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.migration_applied, false);
  assert.equal(blocked.schema_readback_fingerprint, null);
  assert.ok(blocked.blockers.includes("DELEGATION_MARIADB_LEDGER_APPLY_REQUIRED"));
  assert.ok(blocked.blockers.includes("DELEGATION_MARIADB_EFFECTIVE_VIEW_MISSING"));
  assert.ok(blocked.blockers.includes("DELEGATION_MARIADB_RUNTIME_BINDING_MUST_REMAIN_DISABLED"));
}

assert.equal(
  _testingDelegationGrantMariaDbRepository.tenantOperationKey(TENANT_ID, "slice-f-create-001").length,
  83,
);

const adapterSource = await readFile(new URL("./delegationGrantMariaDbRepository.js", import.meta.url), "utf8");
assert.doesNotMatch(adapterSource, /getPool\s*\(/);
assert.doesNotMatch(adapterSource, /express|Router\s*\(/);
assert.match(adapterSource, /repository_automation_receipts/);
assert.match(adapterSource, /agent_delegations/);
assert.match(adapterSource, /runtime_policy_ready = 0/);

console.log("delegation grant MariaDB adapter contract tests passed");
