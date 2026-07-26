import { getPool } from "./db.js";
import {
  capabilityEnvelopeError,
  markCapabilityEnvelopeReferenced,
  resolveCapabilityExecutionEnvelope,
} from "./capabilityResolutionEnvelopeGuard.js";

const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const REQUIRED_CONFIRMATION = "BOOTSTRAP_GOVERNED_MIGRATION_EXECUTE_APPLY_POLICY";
const ACCEPTED_OPERATION_INTENTS = Object.freeze([
  "governed_migration_apply_policy_bootstrap",
  "governed.migration.apply_policy.bootstrap",
]);
const ALLOWED_INPUT_KEYS = new Set(["confirm", "decision_note", "capability_envelope_id"]);

export const GOVERNED_MIGRATION_EXECUTE_APPLY_POLICY = Object.freeze({
  policy_key: "governed_migration_execute_apply_v1",
  app_key: "platform_orchestration",
  capability_key: "governed_migration_execute",
  operation_intent: "governed_migration_execute",
  runtime_surface: "auth_host",
  status: "active",
  allow_external_write: 0,
  allow_credential_binding: 0,
  allow_no_credential_binding: 1,
  requires_ready_for_dispatch: 1,
  requires_dispatch_allowed: 1,
  requires_zero_blocking_gaps: 1,
  requires_audit_evidence: 1,
  requires_readback: 1,
  requires_typed_confirmation: 1,
  requires_same_cycle_dry_run: 1,
  allowed_source_tiers: Object.freeze(["platform_managed_fallback"]),
  policy: Object.freeze({
    governed_runner_only: true,
    checksum_bound_authorization_required: true,
    typed_confirmation_required: true,
    same_cycle_dry_run_required: true,
    same_cycle_ledger_readback_required: true,
    arbitrary_sql_forbidden: true,
    provider_call_forbidden: true,
    external_write_forbidden: true,
    credential_payload_read_forbidden: true,
    secrets_included: false,
  }),
});

function compact(value = "", max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function bootstrapError(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function parseJson(value, fallback) {
  if (value && typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizedJson(value) {
  return JSON.stringify(value);
}

export function governedMigrationApplyPolicyBootstrapConfirmation() {
  return REQUIRED_CONFIRMATION;
}

async function queryPolicy(db) {
  const [rows] = await db.query(
    `SELECT policy_key, app_key, capability_key, operation_intent, runtime_surface, status,
            allow_external_write, allow_credential_binding, allow_no_credential_binding,
            requires_ready_for_dispatch, requires_dispatch_allowed, requires_zero_blocking_gaps,
            requires_audit_evidence, requires_readback, requires_typed_confirmation,
            requires_same_cycle_dry_run, allowed_source_tiers_json, policy_json, notes,
            created_at, updated_at
       FROM capability_apply_authorization_policy_registry
      WHERE policy_key = ?
      LIMIT 1`,
    [GOVERNED_MIGRATION_EXECUTE_APPLY_POLICY.policy_key]
  );
  return rows?.[0] || null;
}

function verifyPolicy(row) {
  if (!row) return null;
  const expected = GOVERNED_MIGRATION_EXECUTE_APPLY_POLICY;
  const scalarChecks = [
    ["app_key", String(row.app_key || ""), expected.app_key],
    ["capability_key", String(row.capability_key || ""), expected.capability_key],
    ["operation_intent", String(row.operation_intent || ""), expected.operation_intent],
    ["runtime_surface", String(row.runtime_surface || ""), expected.runtime_surface],
    ["status", String(row.status || ""), expected.status],
    ["allow_external_write", Number(row.allow_external_write || 0), expected.allow_external_write],
    ["allow_credential_binding", Number(row.allow_credential_binding || 0), expected.allow_credential_binding],
    ["allow_no_credential_binding", Number(row.allow_no_credential_binding || 0), expected.allow_no_credential_binding],
    ["requires_ready_for_dispatch", Number(row.requires_ready_for_dispatch || 0), expected.requires_ready_for_dispatch],
    ["requires_dispatch_allowed", Number(row.requires_dispatch_allowed || 0), expected.requires_dispatch_allowed],
    ["requires_zero_blocking_gaps", Number(row.requires_zero_blocking_gaps || 0), expected.requires_zero_blocking_gaps],
    ["requires_audit_evidence", Number(row.requires_audit_evidence || 0), expected.requires_audit_evidence],
    ["requires_readback", Number(row.requires_readback || 0), expected.requires_readback],
    ["requires_typed_confirmation", Number(row.requires_typed_confirmation || 0), expected.requires_typed_confirmation],
    ["requires_same_cycle_dry_run", Number(row.requires_same_cycle_dry_run || 0), expected.requires_same_cycle_dry_run],
  ];
  const mismatches = scalarChecks
    .filter(([, actual, wanted]) => actual !== wanted)
    .map(([field, actual, wanted]) => ({ field, actual, expected: wanted }));

  const sourceTiers = parseJson(row.allowed_source_tiers_json, []);
  if (normalizedJson(sourceTiers) !== normalizedJson(expected.allowed_source_tiers)) {
    mismatches.push({ field: "allowed_source_tiers_json", actual: sourceTiers, expected: expected.allowed_source_tiers });
  }
  const policyJson = parseJson(row.policy_json, {});
  if (normalizedJson(policyJson) !== normalizedJson(expected.policy)) {
    mismatches.push({ field: "policy_json", actual: policyJson, expected: expected.policy });
  }
  if (mismatches.length) {
    throw bootstrapError(409, "governed_migration_apply_policy_conflict", "The existing governed migration apply policy does not match the fixed bootstrap contract.", {
      policy_key: row.policy_key,
      mismatches,
    });
  }
  return { ...row, allowed_source_tiers_json: sourceTiers, policy_json: policyJson };
}

async function resolveBootstrapEnvelope({ pool, input, auth, resolveEnvelope }) {
  const resolved = await resolveEnvelope({
    pool,
    source: input,
    acceptedAppKeys: ["platform_orchestration"],
    acceptedIntents: ACCEPTED_OPERATION_INTENTS,
    expectedTenantId: auth?.tenant_id || PLATFORM_TENANT_ID,
    expectedUserId: auth?.user_id || "",
    requireReadyForDispatch: true,
    requireDispatchAllowed: true,
    requireNoBlockingGaps: true,
  });
  if (!resolved?.ok) {
    throw capabilityEnvelopeError(resolved, "Governed migration apply policy bootstrap requires a valid capability resolution envelope.");
  }
  return resolved;
}

export async function bootstrapGovernedMigrationApplyPolicy(input = {}, deps = {}) {
  const unknownKeys = Object.keys(input || {}).filter((key) => !ALLOWED_INPUT_KEYS.has(key));
  if (unknownKeys.length) {
    throw bootstrapError(400, "governed_migration_apply_policy_unknown_input", "The bootstrap tool accepts only its fixed confirmation, decision note, and capability envelope.", {
      unknown_keys: unknownKeys,
    });
  }
  if (compact(input.confirm, 128) !== REQUIRED_CONFIRMATION) {
    throw bootstrapError(400, "governed_migration_apply_policy_confirmation_required", `Bootstrap requires confirm=${REQUIRED_CONFIRMATION}.`, {
      required_confirmation: REQUIRED_CONFIRMATION,
    });
  }
  const decisionNote = compact(input.decision_note, 1000);
  if (decisionNote.length < 20) {
    throw bootstrapError(400, "governed_migration_apply_policy_decision_note_required", "decision_note must contain at least 20 characters.");
  }

  const pool = deps.pool || getPool();
  const auth = deps.auth || {};
  const resolveEnvelope = deps.resolveEnvelope || resolveCapabilityExecutionEnvelope;
  const markReferenced = deps.markReferenced || markCapabilityEnvelopeReferenced;
  const envelope = await resolveBootstrapEnvelope({ pool, input, auth, resolveEnvelope });
  const existingRow = await queryPolicy(pool);
  let existing = null;
  let policyUpgradeRequired = false;
  if (existingRow) {
    try {
      existing = verifyPolicy(existingRow);
    } catch (error) {
      if (error?.code !== "governed_migration_apply_policy_conflict") throw error;
      policyUpgradeRequired = true;
    }
  }
  if (existing) {
    await markReferenced({
      pool,
      envelopeId: envelope.envelope_id,
      executionRef: `capability_apply_policy:${GOVERNED_MIGRATION_EXECUTE_APPLY_POLICY.policy_key}`,
    });
    return {
      ok: true,
      policy_created: false,
      policy_upgraded: false,
      idempotent: true,
      policy: existing,
      capability_envelope_id: envelope.envelope_id,
      provider_call_executed: false,
      external_write_executed: false,
      secrets_included: false,
    };
  }

  const expected = GOVERNED_MIGRATION_EXECUTE_APPLY_POLICY;
  const notes = compact(`${decisionNote} Fixed bootstrap contract; governed runner only; no provider call; no external write.`, 2000);
  const connection = typeof pool.getConnection === "function" ? await pool.getConnection() : pool;
  const transactional = typeof connection.beginTransaction === "function";
  try {
    if (transactional) await connection.beginTransaction();
    await connection.query(
      `INSERT INTO capability_apply_authorization_policy_registry
        (policy_key, app_key, capability_key, operation_intent, runtime_surface, status,
         allow_external_write, allow_credential_binding, allow_no_credential_binding,
         requires_ready_for_dispatch, requires_dispatch_allowed, requires_zero_blocking_gaps,
         requires_audit_evidence, requires_readback, requires_typed_confirmation,
         requires_same_cycle_dry_run, allowed_source_tiers_json, policy_json, notes)
       VALUES (?, ?, ?, ?, ?, 'active', 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         app_key = VALUES(app_key),
         capability_key = VALUES(capability_key),
         operation_intent = VALUES(operation_intent),
         runtime_surface = VALUES(runtime_surface),
         status = 'active',
         allow_external_write = 0,
         allow_credential_binding = 0,
         allow_no_credential_binding = 1,
         requires_ready_for_dispatch = 1,
         requires_dispatch_allowed = 1,
         requires_zero_blocking_gaps = 1,
         requires_audit_evidence = 1,
         requires_readback = 1,
         requires_typed_confirmation = 1,
         requires_same_cycle_dry_run = 1,
         allowed_source_tiers_json = VALUES(allowed_source_tiers_json),
         policy_json = VALUES(policy_json),
         notes = VALUES(notes),
         updated_at = CURRENT_TIMESTAMP`,
      [
        expected.policy_key,
        expected.app_key,
        expected.capability_key,
        expected.operation_intent,
        expected.runtime_surface,
        JSON.stringify(expected.allowed_source_tiers),
        JSON.stringify(expected.policy),
        notes,
      ]
    );
    if (transactional) await connection.commit();
  } catch (error) {
    if (transactional) {
      try { await connection.rollback(); } catch { }
    }
    if (String(error?.code || "") === "ER_DUP_ENTRY") {
      const raced = verifyPolicy(await queryPolicy(pool));
      if (raced) {
        return {
          ok: true,
          policy_created: false,
          idempotent: true,
          policy: raced,
          capability_envelope_id: envelope.envelope_id,
          provider_call_executed: false,
          external_write_executed: false,
          secrets_included: false,
        };
      }
    }
    throw error;
  } finally {
    if (connection !== pool && typeof connection.release === "function") connection.release();
  }

  const readback = verifyPolicy(await queryPolicy(pool));
  if (!readback) {
    throw bootstrapError(500, "governed_migration_apply_policy_readback_failed", "The fixed apply policy row was not visible during same-cycle readback.");
  }
  await markReferenced({
    pool,
    envelopeId: envelope.envelope_id,
    executionRef: `capability_apply_policy:${expected.policy_key}`,
  });
  return {
    ok: true,
    policy_created: !policyUpgradeRequired,
    policy_upgraded: policyUpgradeRequired,
    idempotent: false,
    policy: readback,
    capability_envelope_id: envelope.envelope_id,
    provider_call_executed: false,
    external_write_executed: false,
    secrets_included: false,
  };
}
