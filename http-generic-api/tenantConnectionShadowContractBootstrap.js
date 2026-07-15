import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import {
  capabilityEnvelopeError,
  markCapabilityEnvelopeReferenced,
  resolveCapabilityExecutionEnvelope,
} from "./capabilityResolutionEnvelopeGuard.js";
import { stableCapabilityHash } from "./dynamicCapabilityGovernanceCompiler.js";

export const TENANT_CONNECTION_SHADOW_CONTRACT_BOOTSTRAP_VERSION =
  "tenant-connection-shadow-contract-bootstrap-v1";
export const TENANT_CONNECTION_SHADOW_CONTRACT_BOOTSTRAP_CONFIRM =
  "BOOTSTRAP_TENANT_CONNECTION_SHADOW_CONTRACTS";

const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const APP_KEY = "platform_orchestration";
const OPERATION_INTENTS = Object.freeze([
  "tenant_connection_shadow_contract_bootstrap",
  "internal_registry_write",
]);
const LOCK_KEY = "tenant_connection_shadow_contract_bootstrap";
const ADAPTER_KEY = "tenant_connection_self_repair_routes_v1";
const TOOL_KEYS = Object.freeze([
  "tenant_connection_validate_adapter_smoke",
  "tenant_connection_effective_credential_plan_view",
  "tenant_connection_binding_refresh",
  "tenant_connection_provider_grant_refresh",
  "tenant_connection_resolver_refresh",
  "tenant_connection_bounded_mutation_preflight",
  "tenant_connection_bounded_mutation_execute",
  "tenant_connection_readback_certification",
  "tenant_connection_recertification_policy",
]);

const CONTRACT_INPUT_SCHEMA = Object.freeze({
  type: "object",
  required: ["connection_id"],
  properties: {
    connection_id: { type: "string", minLength: 1, maxLength: 191 },
  },
  additionalProperties: false,
});

function observedStateSchema(capabilityKey) {
  return {
    type: "object",
    required: ["ok", "capability_key", "connection_id", "observed_at", "state", "secrets_included"],
    properties: {
      ok: { type: "boolean" },
      capability_key: { const: capabilityKey },
      connection_id: { type: "string", minLength: 1, maxLength: 191 },
      observed_at: { type: "string", format: "date-time" },
      state: {
        type: "object",
        properties: {
          status: { type: "string", maxLength: 128 },
          state_hash: { type: "string", pattern: "^[0-9a-f]{64}$" },
          evidence_ref: { type: "string", maxLength: 512 },
          credential_source: { type: "string", maxLength: 128 },
          credential_scope: { type: "string", maxLength: 128 },
          credential_ref: { type: "string", maxLength: 255 },
          secret_present: { type: "boolean" },
          no_raw_secret_return: { const: true },
          readback_status: { type: "string", maxLength: 128 },
          certification_status: { type: "string", maxLength: 128 },
          provider_status: { type: "string", maxLength: 128 },
          provider_resource_ref: { type: "string", maxLength: 255 },
          idempotency_key: { type: "string", maxLength: 191 },
        },
        additionalProperties: false,
      },
      acknowledgement: {
        type: "object",
        properties: {
          state: { enum: ["not_started", "acknowledged", "observed", "failed"] },
          evidence_ref: { type: "string", maxLength: 512 },
        },
        additionalProperties: false,
      },
      verification: {
        type: "object",
        properties: {
          state: { enum: ["not_started", "verified", "unknown_effect", "failed"] },
          evidence_ref: { type: "string", maxLength: 512 },
        },
        additionalProperties: false,
      },
      provider_write_performed: { type: "boolean" },
      secrets_included: { const: false },
    },
    additionalProperties: false,
  };
}

const PROVIDER_BINDING_CONSTRAINTS = Object.freeze({
  tenant_owned_only: true,
  platform_fallback_allowed: false,
  no_raw_secret_return: true,
  provider_write_requires_separate_certification: true,
  catalog_enablement_unchanged: true,
  active_export_creation_forbidden: true,
});

export const TENANT_CONNECTION_SHADOW_ADAPTER = Object.freeze({
  adapter_key: ADAPTER_KEY,
  resource_type: "tenant_connection",
  provider_key: null,
  adapter_kind: "composite",
  installed_tool_key: "tenant_connection_self_repair_routes",
  content_policy: "metadata_only",
  supports_plan: true,
  supports_read: true,
  supports_write: false,
  status: "active",
  metadata: {
    schema_version: TENANT_CONNECTION_SHADOW_CONTRACT_BOOTSTRAP_VERSION,
    delegates_to: [...TOOL_KEYS],
    shadow_only: true,
    provider_calls_allowed: false,
    external_writes_allowed: false,
    catalog_enablement_changed: false,
    secrets_included: false,
  },
});

const CONTRACT_DEFINITIONS = Object.freeze([
  ["tenant_connection_validate_adapter_smoke", "read_only", "same_cycle_adapter_validation_metadata_readback"],
  ["tenant_connection_effective_credential_plan_view", "read_only", "same_cycle_effective_credential_plan_metadata_readback"],
  ["tenant_connection_binding_refresh", "workspace_write", "same_cycle_binding_state_readback"],
  ["tenant_connection_provider_grant_refresh", "external_write", "same_cycle_provider_grant_metadata_readback"],
  ["tenant_connection_resolver_refresh", "workspace_write", "same_cycle_resolver_state_readback"],
  ["tenant_connection_bounded_mutation_preflight", "preview_only", "same_cycle_preflight_plan_hash_readback"],
  ["tenant_connection_bounded_mutation_execute", "external_write", "same_cycle_provider_mutation_state_readback"],
  ["tenant_connection_readback_certification", "workspace_write", "same_cycle_certification_evidence_readback"],
  ["tenant_connection_recertification_policy", "workspace_write", "same_cycle_recertification_policy_state_readback"],
]);

export const TENANT_CONNECTION_SHADOW_CONTRACTS = Object.freeze(
  CONTRACT_DEFINITIONS.map(([toolKey, effectClass, verificationType]) => {
    const capabilityKey = `tenant_tool.${toolKey}`;
    return Object.freeze({
      contract_key: `${toolKey}_readback_v1`,
      contract_version: 1,
      capability_key: capabilityKey,
      adapter_key: ADAPTER_KEY,
      verification_type: verificationType,
      acknowledgement_required: true,
      verification_required: true,
      expected_effect_class: effectClass,
      input_schema: CONTRACT_INPUT_SCHEMA,
      observed_state_schema: observedStateSchema(capabilityKey),
      provider_binding_constraints: PROVIDER_BINDING_CONSTRAINTS,
      certification_status: "pending",
      status: "shadow",
      source_registry: "tenant_connection_shadow_contract_bootstrap",
      source_key: toolKey,
    });
  }),
);

function fail(code, message, status = 400, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = { ...details, secrets_included: false };
  throw error;
}

function normalizeMode(value) {
  const mode = String(value || "dry_run").trim().toLowerCase();
  if (!["dry_run", "apply"].includes(mode)) {
    fail("tenant_connection_shadow_contract_mode_invalid", "mode must be dry_run or apply.");
  }
  return mode;
}

function requireConfirmation(value) {
  if (String(value || "").trim() !== TENANT_CONNECTION_SHADOW_CONTRACT_BOOTSTRAP_CONFIRM) {
    fail(
      "tenant_connection_shadow_contract_confirmation_required",
      `Typed confirmation ${TENANT_CONNECTION_SHADOW_CONTRACT_BOOTSTRAP_CONFIRM} is required.`,
      400,
      { expected_confirmation: TENANT_CONNECTION_SHADOW_CONTRACT_BOOTSTRAP_CONFIRM },
    );
  }
}

function placeholders(values) {
  return values.map(() => "?").join(", ");
}

async function loadCurrentState(pool) {
  const capabilityKeys = TENANT_CONNECTION_SHADOW_CONTRACTS.map((item) => item.capability_key);
  const [adapterRows] = await pool.query(
    `SELECT adapter_key,resource_type,provider_key,adapter_kind,installed_tool_key,
            content_policy,supports_plan,supports_read,supports_write,status,metadata_json
       FROM platform_resource_adapters WHERE adapter_key=? LIMIT 1`,
    [ADAPTER_KEY],
  );
  const [contractRows] = await pool.query(
    `SELECT contract_id,contract_key,contract_version,capability_key,adapter_key,
            verification_type,expected_effect_class,certification_status,status,is_current,
            source_registry,source_key,secrets_included
       FROM platform_capability_readback_contracts
      WHERE is_current=1 AND contract_key IN (${placeholders(TENANT_CONNECTION_SHADOW_CONTRACTS)})
      ORDER BY contract_key`,
    TENANT_CONNECTION_SHADOW_CONTRACTS.map((item) => item.contract_key),
  );
  const [toolRows] = await pool.query(
    `SELECT tool_key,is_enabled FROM tenant_platform_endpoint_tools
      WHERE tool_key IN (${placeholders(TOOL_KEYS)}) ORDER BY tool_key`,
    [...TOOL_KEYS],
  );
  const [exportRows] = await pool.query(
    `SELECT export_key,capability_key,export_status FROM platform_plugin_capability_exports
      WHERE capability_key IN (${placeholders(capabilityKeys)}) AND export_status='active'`,
    capabilityKeys,
  );
  return {
    adapter: adapterRows?.[0] || null,
    contracts: contractRows || [],
    tools: toolRows || [],
    active_exports: exportRows || [],
  };
}

function boundedState(state) {
  return {
    adapter_present: Boolean(state.adapter),
    adapter_supports_write: Boolean(Number(state.adapter?.supports_write || 0)),
    adapter_status: state.adapter?.status || null,
    current_contract_count: state.contracts.length,
    shadow_contract_count: state.contracts.filter((row) => row.status === "shadow").length,
    enabled_tool_count: state.tools.filter((row) => Number(row.is_enabled || 0) === 1).length,
    active_tenant_export_count: state.active_exports.length,
    secrets_included: false,
  };
}

function planHash() {
  return stableCapabilityHash({
    version: TENANT_CONNECTION_SHADOW_CONTRACT_BOOTSTRAP_VERSION,
    adapter: TENANT_CONNECTION_SHADOW_ADAPTER,
    contracts: TENANT_CONNECTION_SHADOW_CONTRACTS,
  });
}

function verifyReadback(state) {
  const summary = boundedState(state);
  const contractKeys = new Set(state.contracts.map((row) => row.contract_key));
  const allContractsPresent = TENANT_CONNECTION_SHADOW_CONTRACTS.every((item) => contractKeys.has(item.contract_key));
  const safeContracts = state.contracts.every(
    (row) => row.status === "shadow"
      && row.certification_status === "pending"
      && Number(row.secrets_included || 0) === 0,
  );
  const ok = Boolean(
    state.adapter
      && state.adapter.adapter_key === ADAPTER_KEY
      && Number(state.adapter.supports_write || 0) === 0
      && state.adapter.status === "active"
      && allContractsPresent
      && safeContracts
      && summary.enabled_tool_count === 0
      && summary.active_tenant_export_count === 0
  );
  return { ok, ...summary, all_contracts_present: allContractsPresent, safe_contracts: safeContracts };
}

export async function bootstrapTenantConnectionShadowContracts(args = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const mode = normalizeMode(args.mode);
  const expectedPlanHash = planHash();
  const before = await loadCurrentState(pool);

  if (mode === "dry_run") {
    return {
      ok: true,
      report_type: "tenant_connection_shadow_contract_bootstrap",
      version: TENANT_CONNECTION_SHADOW_CONTRACT_BOOTSTRAP_VERSION,
      mode,
      plan_hash: expectedPlanHash,
      expected_confirmation: TENANT_CONNECTION_SHADOW_CONTRACT_BOOTSTRAP_CONFIRM,
      adapter: TENANT_CONNECTION_SHADOW_ADAPTER,
      contract_count: TENANT_CONNECTION_SHADOW_CONTRACTS.length,
      current_state: boundedState(before),
      apply_requires_capability_envelope: true,
      apply_requires_separate_approval: true,
      mutations_performed: false,
      provider_calls_performed: false,
      external_writes_performed: false,
      tenant_authority_changed: false,
      callable_tenant_exports_created: false,
      secrets_included: false,
    };
  }

  requireConfirmation(args.confirm);
  const capabilityEnvelopeId = String(args.capability_envelope_id || "").trim();
  if (!capabilityEnvelopeId) {
    fail("tenant_connection_shadow_contract_envelope_required", "capability_envelope_id is required for apply.");
  }
  if (args.expected_plan_hash && String(args.expected_plan_hash).toLowerCase() !== expectedPlanHash) {
    fail("tenant_connection_shadow_contract_plan_hash_mismatch", "The fixed bootstrap plan hash changed.", 409, {
      expected_plan_hash: args.expected_plan_hash,
      observed_plan_hash: expectedPlanHash,
    });
  }

  const resolveEnvelope = deps.resolveEnvelope || resolveCapabilityExecutionEnvelope;
  const resolvedEnvelope = await resolveEnvelope({
    pool,
    envelopeId: capabilityEnvelopeId,
    source: { capability_envelope_id: capabilityEnvelopeId },
    acceptedAppKeys: [APP_KEY],
    acceptedIntents: OPERATION_INTENTS,
    expectedTenantId: deps.auth?.tenant_id || PLATFORM_TENANT_ID,
    expectedUserId: deps.auth?.user_id || "",
    requireReadyForDispatch: true,
    requireDispatchAllowed: true,
    requireNoApprovalRequired: true,
    requireNoBlockingGaps: true,
    requireNoSecrets: true,
  });
  if (!resolvedEnvelope?.ok) {
    throw capabilityEnvelopeError(
      resolvedEnvelope,
      "Tenant connection shadow contract bootstrap requires an approved platform_orchestration envelope.",
    );
  }
  if (!resolvedEnvelope.apply_allowed) {
    fail("tenant_connection_shadow_contract_apply_not_authorized", "The capability envelope is not apply-authorized.", 403);
  }

  const connection = await pool.getConnection();
  let lockAcquired = false;
  let insertedContracts = 0;
  let reusedContracts = 0;
  try {
    const [lockRows] = await connection.query("SELECT GET_LOCK(?, 10) AS acquired", [LOCK_KEY]);
    lockAcquired = Number(lockRows?.[0]?.acquired || 0) === 1;
    if (!lockAcquired) fail("tenant_connection_shadow_contract_locked", "Another bootstrap is active.", 409);

    await connection.beginTransaction();
    const [enabledRows] = await connection.query(
      `SELECT COUNT(*) AS enabled_count FROM tenant_platform_endpoint_tools
        WHERE tool_key IN (${placeholders(TOOL_KEYS)}) AND is_enabled=1 FOR UPDATE`,
      [...TOOL_KEYS],
    );
    if (Number(enabledRows?.[0]?.enabled_count || 0) !== 0) {
      fail("tenant_connection_shadow_contract_tools_must_remain_disabled", "All target tenant tools must be disabled before bootstrap.", 409);
    }

    await connection.query(
      `INSERT INTO platform_resource_adapters
        (adapter_key,resource_type,provider_key,adapter_kind,installed_tool_key,
         content_policy,supports_plan,supports_read,supports_write,status,metadata_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         resource_type=VALUES(resource_type),provider_key=VALUES(provider_key),adapter_kind=VALUES(adapter_kind),
         installed_tool_key=VALUES(installed_tool_key),content_policy=VALUES(content_policy),
         supports_plan=VALUES(supports_plan),supports_read=VALUES(supports_read),supports_write=0,
         status=VALUES(status),metadata_json=VALUES(metadata_json),updated_at=CURRENT_TIMESTAMP`,
      [
        ADAPTER_KEY,
        TENANT_CONNECTION_SHADOW_ADAPTER.resource_type,
        null,
        TENANT_CONNECTION_SHADOW_ADAPTER.adapter_kind,
        TENANT_CONNECTION_SHADOW_ADAPTER.installed_tool_key,
        TENANT_CONNECTION_SHADOW_ADAPTER.content_policy,
        1,
        1,
        0,
        TENANT_CONNECTION_SHADOW_ADAPTER.status,
        JSON.stringify(TENANT_CONNECTION_SHADOW_ADAPTER.metadata),
      ],
    );

    for (const contract of TENANT_CONNECTION_SHADOW_CONTRACTS) {
      const [existingRows] = await connection.query(
        `SELECT contract_id,capability_key,adapter_key,expected_effect_class,status,certification_status
           FROM platform_capability_readback_contracts
          WHERE contract_key=? AND is_current=1 LIMIT 1 FOR UPDATE`,
        [contract.contract_key],
      );
      const existing = existingRows?.[0] || null;
      if (existing) {
        const compatible = existing.capability_key === contract.capability_key
          && existing.adapter_key === contract.adapter_key
          && existing.expected_effect_class === contract.expected_effect_class;
        if (!compatible) {
          fail("tenant_connection_shadow_contract_existing_contract_mismatch", "An incompatible current readback contract already exists.", 409, {
            contract_key: contract.contract_key,
          });
        }
        if (!["draft", "shadow"].includes(existing.status) || existing.certification_status !== "pending") {
          fail("tenant_connection_shadow_contract_existing_contract_not_shadow", "Bootstrap refuses to downgrade a non-shadow contract.", 409, {
            contract_key: contract.contract_key,
            status: existing.status,
            certification_status: existing.certification_status,
          });
        }
        await connection.query(
          `UPDATE platform_capability_readback_contracts
              SET verification_type=?,acknowledgement_required=1,verification_required=1,
                  input_schema_json=?,observed_state_schema_json=?,provider_binding_constraints_json=?,
                  source_registry=?,source_key=?,secrets_included=0,updated_at=CURRENT_TIMESTAMP
            WHERE contract_id=?`,
          [
            contract.verification_type,
            JSON.stringify(contract.input_schema),
            JSON.stringify(contract.observed_state_schema),
            JSON.stringify(contract.provider_binding_constraints),
            contract.source_registry,
            contract.source_key,
            existing.contract_id,
          ],
        );
        reusedContracts += 1;
        continue;
      }

      await connection.query(
        `INSERT INTO platform_capability_readback_contracts
          (contract_id,contract_key,contract_version,capability_key,adapter_key,verification_type,
           acknowledgement_required,verification_required,expected_effect_class,input_schema_json,
           observed_state_schema_json,provider_binding_constraints_json,certification_status,status,
           is_current,valid_from,source_registry,source_key,secrets_included)
         VALUES (?,?,?,?,?,?,1,1,?,?,?,?, 'pending','shadow',1,CURRENT_TIMESTAMP,?,?,0)`,
        [
          (deps.uuid || randomUUID)(),
          contract.contract_key,
          contract.contract_version,
          contract.capability_key,
          contract.adapter_key,
          contract.verification_type,
          contract.expected_effect_class,
          JSON.stringify(contract.input_schema),
          JSON.stringify(contract.observed_state_schema),
          JSON.stringify(contract.provider_binding_constraints),
          contract.source_registry,
          contract.source_key,
        ],
      );
      insertedContracts += 1;
    }

    const readback = await loadCurrentState(connection);
    const verified = verifyReadback(readback);
    if (!verified.ok) {
      fail("tenant_connection_shadow_contract_readback_failed", "Transactional readback did not match the fixed shadow bootstrap plan.", 500, verified);
    }

    await connection.commit();
    const markReferenced = deps.markReferenced || markCapabilityEnvelopeReferenced;
    const envelopeReadback = await markReferenced({
      pool,
      envelopeId: capabilityEnvelopeId,
      executionRef: `tenant-connection-shadow-contract-bootstrap:${expectedPlanHash.slice(0, 16)}`,
    });
    if (!envelopeReadback?.ok) {
      fail("tenant_connection_shadow_contract_envelope_readback_failed", "Bootstrap committed but envelope reference readback failed.", 500);
    }

    return {
      ok: true,
      report_type: "tenant_connection_shadow_contract_bootstrap",
      version: TENANT_CONNECTION_SHADOW_CONTRACT_BOOTSTRAP_VERSION,
      mode,
      plan_hash: expectedPlanHash,
      adapter_key: ADAPTER_KEY,
      inserted_contract_count: insertedContracts,
      reused_contract_count: reusedContracts,
      readback: verified,
      envelope_readback: envelopeReadback,
      mutations_performed: insertedContracts > 0 || !before.adapter || reusedContracts > 0,
      provider_calls_performed: false,
      external_writes_performed: false,
      tenant_authority_changed: false,
      callable_tenant_exports_created: false,
      secrets_included: false,
    };
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    if (lockAcquired) {
      try { await connection.query("SELECT RELEASE_LOCK(?) AS released", [LOCK_KEY]); } catch {}
    }
    connection.release();
  }
}

export const _testingTenantConnectionShadowContractBootstrap = Object.freeze({
  ADAPTER_KEY,
  TOOL_KEYS,
  planHash,
  verifyReadback,
});
