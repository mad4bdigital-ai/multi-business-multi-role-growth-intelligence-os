#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "../db.js";
import {
  capabilityEnvelopeError,
  resolveCapabilityExecutionEnvelope,
} from "../capabilityResolutionEnvelopeGuard.js";
import { readDeploymentManifest } from "../deploymentManifest.js";
import { splitMigrationSqlStatements } from "../migrationSqlStatements.js";

const __filename = fileURLToPath(import.meta.url);
const API_DIR = path.resolve(path.dirname(__filename), "..");
const MIGRATION_DIR = path.join(API_DIR, "migrations");

export const READINESS_REPAIR_MIGRATION =
  "20260725_repository_authority_capability_readiness_repair.sql";
export const READINESS_REPAIR_CHECKSUM =
  "d655e9a45b9fd6b0d7b9c7f3069fbc50d5fd5a76ac0d426629b42a5de971c58b";
export const READINESS_REPAIR_APPLY_CONFIRMATION =
  "APPLY_20260725_REPOSITORY_AUTHORITY_CAPABILITY_READINESS_REPAIR";
export const READINESS_REPAIR_RUNNER_VERSION =
  "repository-authority-capability-readiness-repair-runner-v2";

const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const CONNECTED_SYSTEM_TENANT_ID = "f2795a7f-8d06-4053-8bee-35ca9af8b460";
const CONNECTED_SYSTEM_KEY = "github_rest_prod_platform_managed";
const CONNECTED_SYSTEM_ID = "2f4ce77b-0ef8-4d83-aec4-1fca5e332108";
const TARGET_SYSTEM = Object.freeze({
  display_name: "GitHub REST - Production Platform Managed",
  provider_family: "github_com_connector",
  provider_domain: "https://api.github.com",
  connector_family: "github_com_connector",
  service_mode: "managed",
  self_serve_capable: 0,
  assisted_capable: 1,
  managed_capable: 1,
  status: "active",
});
const AUTHORITY_BINDING_KEY = "growth_intelligence_platform.github.primary.production";
const CAPABILITY_BINDING_KEY =
  "growth_intelligence_platform.github.repository_main_moved_webhook.production";
const POLICY_KEY = "github_repository_main_moved_webhook_provision_apply_v1";
const LOCK_NAME = "migration:20260725:repository-authority-capability-readiness-repair";
const PRODUCTION_BRANCH = "Production";
const ENVELOPE_APP_KEY = "platform_orchestration";
const ENVELOPE_CAPABILITY_KEY = "governed_migration_execute";
const ENVELOPE_OPERATION_INTENT = "governed_migration_execute";
const ENVELOPE_RUNTIME_SURFACE = "auth_host";
const TARGET_TABLES = Object.freeze([
  "connected_systems",
  "repository_authority_bindings",
  "repository_capability_bindings",
  "capability_apply_authorization_policy_registry",
  "governed_migration_authorization_registry",
  "governed_migration_ledger",
  "capability_resolution_envelope_ledger",
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

function runnerError(code, message, details = {}, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = { ...details, secrets_included: false };
  return error;
}

function sha256(value = "") {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function normalizeRows(result) {
  return Array.isArray(result?.[0]) ? result[0] : [];
}

function oneRow(rows, name, { allowMissing = false } = {}) {
  if (!Array.isArray(rows) || rows.length > 1) {
    throw runnerError("readiness_repair_row_ambiguous", `${name} matched multiple rows.`, {
      row_kind: name,
      row_count: Array.isArray(rows) ? rows.length : null,
    });
  }
  if (!allowMissing && rows.length !== 1) {
    throw runnerError("readiness_repair_row_missing", `${name} must exist exactly once.`, {
      row_kind: name,
      row_count: rows.length,
    });
  }
  const [row = null] = rows;
  return row;
}

function parseJsonObject(value) {
  if (value === null || value === undefined || value === "") {
    return { valid: true, value: {} };
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return { valid: true, value };
  }
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { valid: true, value: parsed }
      : { valid: false, value: {} };
  } catch {
    return { valid: false, value: {} };
  }
}

function boolNumber(value) {
  return value === true || Number(value || 0) === 1;
}

function equalNullable(left, right) {
  return (left ?? null) === (right ?? null);
}

function publicMetadata(value) {
  const parsed = parseJsonObject(value);
  const metadata = parsed.value;
  return {
    json_valid: parsed.valid,
    readiness_repair_migration: metadata.readiness_repair_migration || null,
    system_authority_source: metadata.system_authority_source || null,
    managed_system_key: metadata.managed_system_key || null,
    policy_authority_source: metadata.policy_authority_source || null,
    provider_call_executed: metadata.provider_call_executed ?? null,
    external_write_executed: metadata.external_write_executed ?? null,
    credential_payload_read: metadata.credential_payload_read ?? null,
    secrets_included: metadata.secrets_included ?? false,
  };
}

function publicState(state = {}) {
  return {
    system: state.system
      ? {
          system_id: state.system.system_id,
          tenant_id: state.system.tenant_id,
          system_key: state.system.system_key,
          display_name: state.system.display_name,
          provider_family: state.system.provider_family,
          provider_domain: state.system.provider_domain,
          connector_family: state.system.connector_family,
          service_mode: state.system.service_mode,
          self_serve_capable: Number(state.system.self_serve_capable || 0),
          assisted_capable: Number(state.system.assisted_capable || 0),
          managed_capable: Number(state.system.managed_capable || 0),
          status: state.system.status,
          config: publicMetadata(state.system.config_json),
        }
      : null,
    authority: state.authority
      ? {
          binding_key: state.authority.binding_key,
          system_id: state.authority.system_id || null,
          installation_id: state.authority.installation_id || null,
          system_binding_mode: state.authority.system_binding_mode,
          lifecycle_status: state.authority.lifecycle_status,
          authority_version: Number(state.authority.authority_version || 0),
          lock_version: Number(state.authority.lock_version || 0),
          metadata: publicMetadata(state.authority.metadata_json),
        }
      : null,
    capability: state.capability
      ? {
          capability_binding_key: state.capability.capability_binding_key,
          capability_key: state.capability.capability_key,
          operation_intent: state.capability.operation_intent,
          policy_key: state.capability.policy_key || null,
          lifecycle_status: state.capability.lifecycle_status,
          capability_version: Number(state.capability.capability_version || 0),
          lock_version: Number(state.capability.lock_version || 0),
          metadata: publicMetadata(state.capability.metadata_json),
        }
      : null,
    policy: state.policy
      ? {
          policy_key: state.policy.policy_key,
          app_key: state.policy.app_key,
          capability_key: state.policy.capability_key,
          operation_intent: state.policy.operation_intent,
          runtime_surface: state.policy.runtime_surface,
          status: state.policy.status,
        }
      : null,
    authorization: state.authorization
      ? {
          migration_file: state.authorization.migration_file,
          authorization_status: state.authorization.authorization_status,
          policy_key: state.authorization.policy_key || null,
          risk_tier: state.authorization.risk_tier || null,
          requires_preflight: Number(state.authorization.requires_preflight || 0),
          requires_confirmation: Number(state.authorization.requires_confirmation || 0),
          allow_apply: Number(state.authorization.allow_apply || 0),
        }
      : null,
    ledger: state.ledger
      ? {
          run_id: state.ledger.run_id,
          mode: state.ledger.mode,
          applied_at: state.ledger.applied_at,
        }
      : null,
    system_id_collision: Boolean(state.system_id_collision),
    collations: Array.isArray(state.collations) ? state.collations : [],
  };
}

async function queryRows(db, sql, params = []) {
  return normalizeRows(await db.query(sql, params));
}

export function detectConnectedSystemIdCollision({
  system = null,
  systemById = null,
} = {}) {
  if (system && String(system.system_id || "") !== CONNECTED_SYSTEM_ID) return true;
  if (!systemById) return false;
  if (String(systemById.tenant_id || "") !== CONNECTED_SYSTEM_TENANT_ID) return true;
  if (String(systemById.system_key || "") !== CONNECTED_SYSTEM_KEY) return true;
  return Boolean(system && String(systemById.system_id || "") !== String(system.system_id || ""));
}

async function readState(db, { forUpdate = false } = {}) {
  const lockSuffix = forUpdate ? " FOR UPDATE" : "";

  const systemRows = await queryRows(
    db,
    `SELECT system_id, tenant_id, system_key, display_name, provider_family, provider_domain,
            connector_family, service_mode, self_serve_capable, assisted_capable,
            managed_capable, status, config_json
       FROM connected_systems
      WHERE tenant_id = ? AND system_key = ?
      LIMIT 2${lockSuffix}`,
    [CONNECTED_SYSTEM_TENANT_ID, CONNECTED_SYSTEM_KEY],
  );
  const systemIdRows = await queryRows(
    db,
    `SELECT system_id, tenant_id, system_key
       FROM connected_systems
      WHERE system_id = ?
      LIMIT 2${lockSuffix}`,
    [CONNECTED_SYSTEM_ID],
  );
  const authorityRows = await queryRows(
    db,
    `SELECT binding_key, system_id, installation_id, system_binding_mode, lifecycle_status,
            authority_version, lock_version, metadata_json
       FROM repository_authority_bindings
      WHERE binding_key = ?
      LIMIT 2${lockSuffix}`,
    [AUTHORITY_BINDING_KEY],
  );
  const capabilityRows = await queryRows(
    db,
    `SELECT capability_binding_key, capability_key, operation_intent, policy_key,
            lifecycle_status, capability_version, lock_version, metadata_json
       FROM repository_capability_bindings
      WHERE capability_binding_key = ?
      LIMIT 2${lockSuffix}`,
    [CAPABILITY_BINDING_KEY],
  );
  const policyRows = await queryRows(
    db,
    `SELECT policy_key, app_key, capability_key, operation_intent, runtime_surface, status
       FROM capability_apply_authorization_policy_registry
      WHERE policy_key = ?
      LIMIT 2${lockSuffix}`,
    [POLICY_KEY],
  );
  const authorizationRows = await queryRows(
    db,
    `SELECT migration_file, authorization_status, authorization_source, policy_key,
            risk_tier, requires_preflight, requires_confirmation, allow_record_only, allow_apply
       FROM governed_migration_authorization_registry
      WHERE migration_file = ?
      LIMIT 2${lockSuffix}`,
    [READINESS_REPAIR_MIGRATION],
  );
  const ledgerRows = await queryRows(
    db,
    `SELECT run_id, mode, applied_at
       FROM governed_migration_ledger
      WHERE migration_file = ? AND migration_checksum_sha256 = ?
      ORDER BY applied_at DESC
      LIMIT 2${lockSuffix}`,
    [READINESS_REPAIR_MIGRATION, READINESS_REPAIR_CHECKSUM],
  );
  const collations = await queryRows(
    db,
    `SELECT table_name, column_name, collation_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND ((table_name = 'repository_authority_bindings' AND column_name = 'system_id')
          OR (table_name = 'connected_systems' AND column_name = 'system_id'))
      ORDER BY table_name, column_name`,
  );

  const system = oneRow(systemRows, "connected_system", { allowMissing: true });
  const systemById = oneRow(systemIdRows, "connected_system_id", { allowMissing: true });

  return {
    system,
    system_id_collision: detectConnectedSystemIdCollision({ system, systemById }),
    authority: oneRow(authorityRows, "repository_authority_binding"),
    capability: oneRow(capabilityRows, "repository_capability_binding"),
    policy: oneRow(policyRows, "capability_policy"),
    authorization: oneRow(authorizationRows, "migration_authorization"),
    ledger: oneRow(ledgerRows, "migration_ledger", { allowMissing: true }),
    collations,
  };
}

function stripLeadingSqlComments(statement = "") {
  let value = String(statement || "").trimStart();
  while (value) {
    const next = value
      .replace(/^--[^\n]*(?:\n|$)/, "")
      .replace(/^#[^\n]*(?:\n|$)/, "")
      .replace(/^\/\*[\s\S]*?\*\//, "")
      .trimStart();
    if (next === value) break;
    value = next;
  }
  return value;
}

export function assertReadinessRepairStatements(statements = []) {
  if (!Array.isArray(statements) || statements.length !== 3) {
    throw runnerError(
      "readiness_repair_statement_count_mismatch",
      "Readiness repair must contain exactly three statements.",
      { statement_count: Array.isArray(statements) ? statements.length : null },
    );
  }
  const unsafe = statements.filter(
    (statement) => !/^(?:INSERT|UPDATE)\b/i.test(stripLeadingSqlComments(statement)),
  );
  if (unsafe.length) {
    throw runnerError(
      "readiness_repair_non_transactional_statement_blocked",
      "Only transaction-safe INSERT and UPDATE statements are permitted.",
      { unsafe_statement_count: unsafe.length },
    );
  }
  return true;
}

function metadataFlagsReady(metadata, expectedSourceKey, expectedSourceValue) {
  return metadata[expectedSourceKey] === expectedSourceValue
    && metadata.provider_call_executed === false
    && metadata.external_write_executed === false
    && metadata.credential_payload_read === false
    && metadata.secrets_included === false;
}

export function assessReadinessRepairState(state = {}) {
  const blocking = [];
  const system = state.system || null;
  const authority = state.authority || null;
  const capability = state.capability || null;
  const policy = state.policy || null;
  const authorization = state.authorization || null;
  const systemConfig = parseJsonObject(system?.config_json);
  const authorityMetadata = parseJsonObject(authority?.metadata_json);
  const capabilityMetadata = parseJsonObject(capability?.metadata_json);

  if (!authority) blocking.push("authority_binding_missing");
  if (!capability) blocking.push("capability_binding_missing");
  if (!policy) blocking.push("policy_missing");
  if (!authorization) blocking.push("migration_authorization_missing");
  if (system && !systemConfig.valid) blocking.push("connected_system_config_json_invalid");
  if (authority && !authorityMetadata.valid) blocking.push("authority_metadata_json_invalid");
  if (capability && !capabilityMetadata.valid) blocking.push("capability_metadata_json_invalid");
  if (authorization && authorization.authorization_status !== "authorized") {
    blocking.push("migration_authorization_not_authorized");
  }
  if (authorization && Number(authorization.allow_apply || 0) !== 1) {
    blocking.push("migration_apply_not_allowed");
  }
  if (authorization && Number(authorization.requires_preflight || 0) !== 1) {
    blocking.push("migration_preflight_requirement_missing");
  }
  if (authorization && Number(authorization.requires_confirmation || 0) !== 1) {
    blocking.push("migration_confirmation_requirement_missing");
  }
  if (policy && policy.status !== "active") blocking.push("policy_not_active");
  if (policy && policy.runtime_surface !== "system_layer") {
    blocking.push("policy_runtime_surface_mismatch");
  }
  if (policy && policy.app_key !== "github") blocking.push("policy_app_key_mismatch");
  if (authority && authority.system_binding_mode !== "shared_platform_adapter") {
    blocking.push("authority_binding_mode_mismatch");
  }
  if (authority && authority.lifecycle_status !== "active") blocking.push("authority_not_active");
  if (capability && capability.lifecycle_status !== "active") blocking.push("capability_not_active");
  if (!Array.isArray(state.collations) || state.collations.length !== 2) {
    blocking.push("system_id_collation_evidence_incomplete");
  }
  if (state.system_id_collision) blocking.push("connected_system_id_collision");
  if (policy && capability && policy.capability_key !== capability.capability_key) {
    blocking.push("policy_capability_key_mismatch");
  }
  if (policy && capability && policy.operation_intent !== capability.operation_intent) {
    blocking.push("policy_operation_intent_mismatch");
  }

  const config = systemConfig.value;
  const systemReady = Boolean(
    system
    && system.system_id === CONNECTED_SYSTEM_ID
    && Object.entries(TARGET_SYSTEM).every(([key, value]) => (
      ["self_serve_capable", "assisted_capable", "managed_capable"].includes(key)
        ? Number(system[key] || 0) === value
        : system[key] === value
    ))
    && systemConfig.valid
    && config.source === "migration:20260725_repository_authority_capability_readiness_repair"
    && config.execution_readiness === "ready"
    && config.authority_role === "repository_shared_platform_adapter"
    && config.provider_transport === "http_generic_api"
    && config.provider_call_executed === false
    && config.external_write_executed === false
    && config.credential_payload_read === false
    && config.secrets_included === false
  );

  const authorityCoreReady = Boolean(
    system && authority
    && equalNullable(authority.system_id, system.system_id)
    && authority.installation_id === null,
  );
  const authorityMetadataReady = Boolean(
    authority
    && authorityMetadata.valid
    && metadataFlagsReady(
      authorityMetadata.value,
      "readiness_repair_migration",
      "20260725_repository_authority_capability_readiness_repair",
    )
    && authorityMetadata.value.system_authority_source === "platform_managed_connected_system"
    && authorityMetadata.value.managed_system_key === CONNECTED_SYSTEM_KEY,
  );
  const capabilityCoreReady = Boolean(
    capability && policy && equalNullable(capability.policy_key, policy.policy_key),
  );
  const capabilityMetadataReady = Boolean(
    capability
    && capabilityMetadata.valid
    && metadataFlagsReady(
      capabilityMetadata.value,
      "readiness_repair_migration",
      "20260725_repository_authority_capability_readiness_repair",
    )
    && capabilityMetadata.value.policy_authority_source
      === "capability_apply_authorization_policy_registry",
  );

  if (authorityCoreReady && !authorityMetadataReady && authorityMetadata.valid) {
    blocking.push("authority_metadata_drift_not_repairable_by_current_sql");
  }
  if (capabilityCoreReady && !capabilityMetadataReady && capabilityMetadata.valid) {
    blocking.push("capability_metadata_drift_not_repairable_by_current_sql");
  }

  const authorityReady = authorityCoreReady && authorityMetadataReady;
  const capabilityReady = capabilityCoreReady && capabilityMetadataReady;
  const targetSatisfied = systemReady && authorityReady && capabilityReady;

  if (state.ledger && !targetSatisfied) {
    blocking.push("matching_migration_ledger_state_drift");
  }

  return {
    status: blocking.length ? "blocked" : targetSatisfied ? "already_satisfied" : "ready",
    recommended_action: blocking.length ? "diagnose" : targetSatisfied ? "record_only" : "apply",
    blocking_reasons: [...new Set(blocking)],
    target_satisfied: targetSatisfied,
    system_ready: systemReady,
    authority_ready: authorityReady,
    authority_core_ready: authorityCoreReady,
    authority_metadata_ready: authorityMetadataReady,
    capability_ready: capabilityReady,
    capability_core_ready: capabilityCoreReady,
    capability_metadata_ready: capabilityMetadataReady,
    ledger_present: Boolean(state.ledger),
    secrets_included: false,
  };
}

function assertApplyReady(state, assessment) {
  if (state.ledger) {
    throw runnerError(
      "readiness_repair_already_recorded",
      "A matching checksum is already present in the migration ledger.",
      { ledger: publicState(state).ledger },
    );
  }
  if (assessment.status === "blocked") {
    throw runnerError(
      "readiness_repair_preflight_blocked",
      "Readiness repair preflight contains blocking gaps.",
      { blocking_reasons: assessment.blocking_reasons },
    );
  }
  if (assessment.status === "already_satisfied") {
    throw runnerError(
      "readiness_repair_record_only_required",
      "Target rows already satisfy the migration contract; do not reapply version increments.",
      { recommended_action: "record_only" },
    );
  }
}

function verifyAfter(before, after) {
  const assessment = assessReadinessRepairState(after);
  if (assessment.status !== "already_satisfied") {
    throw runnerError(
      "readiness_repair_post_apply_state_invalid",
      "Post-apply rows do not satisfy the target contract.",
      { assessment, after: publicState(after) },
    );
  }

  const authorityChanged = Boolean(
    before.authority && (
      !equalNullable(before.authority.system_id, after.authority.system_id)
      || !equalNullable(before.authority.installation_id, after.authority.installation_id)
    ),
  );
  if (authorityChanged) {
    if (Number(after.authority.authority_version || 0)
      <= Number(before.authority.authority_version || 0)) {
      throw runnerError(
        "readiness_repair_authority_version_not_incremented",
        "Authority version did not increment after authority change.",
      );
    }
    if (Number(after.authority.lock_version || 0)
      <= Number(before.authority.lock_version || 0)) {
      throw runnerError(
        "readiness_repair_authority_lock_version_not_incremented",
        "Authority lock version did not increment after authority change.",
      );
    }
  }

  if (before.capability && !equalNullable(before.capability.policy_key, after.capability.policy_key)) {
    if (Number(after.capability.capability_version || 0)
      <= Number(before.capability.capability_version || 0)) {
      throw runnerError(
        "readiness_repair_capability_version_not_incremented",
        "Capability version did not increment after policy change.",
      );
    }
    if (Number(after.capability.lock_version || 0)
      <= Number(before.capability.lock_version || 0)) {
      throw runnerError(
        "readiness_repair_capability_lock_version_not_incremented",
        "Capability lock version did not increment after policy change.",
      );
    }
  }
  return assessment;
}

function migrationResourceUri() {
  return `db-migration://growth_intelligence_platform/${READINESS_REPAIR_MIGRATION}`;
}

function migrationBindingSha() {
  return sha256(JSON.stringify({
    schema_version: "governed_migration_envelope_binding.v1",
    app_key: ENVELOPE_APP_KEY,
    capability_key: ENVELOPE_CAPABILITY_KEY,
    operation_intent: ENVELOPE_OPERATION_INTENT,
    resource_uri: migrationResourceUri(),
    migration_file: READINESS_REPAIR_MIGRATION,
    migration_checksum_sha256: READINESS_REPAIR_CHECKSUM,
    statement_count: 3,
  }));
}

function resolveProductionDeployment(env = process.env) {
  const result = readDeploymentManifest(env);
  if (!result?.ok) {
    throw runnerError(
      "readiness_repair_deployment_manifest_required",
      "Readiness repair apply requires a readable deployment manifest.",
      { error: result?.error || null },
    );
  }
  const branch = String(result.manifest?.branch || "").trim();
  const commitSha = String(result.manifest?.commit_sha || "").trim().toLowerCase();
  if (branch !== PRODUCTION_BRANCH) {
    throw runnerError(
      "readiness_repair_production_branch_required",
      "Readiness repair apply is permitted only from Production.",
      { deployed_branch: branch || null, required_branch: PRODUCTION_BRANCH },
    );
  }
  if (!COMMIT_SHA_PATTERN.test(commitSha)) {
    throw runnerError(
      "readiness_repair_deployed_commit_required",
      "Deployment manifest must contain a full 40-character commit SHA.",
      { deployed_commit_sha: commitSha || null },
    );
  }
  return { branch, commit_sha: commitSha, source: result.manifest?.source || null };
}

export function assertEnvelopeFresh(row = {}, now = Date.now()) {
  const expiresAt = new Date(row.expires_at || "").getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= Number(now)) {
    throw runnerError(
      "readiness_repair_capability_envelope_expired",
      "Capability envelope expired before atomic consumption.",
      { envelope_id: row.envelope_id || null, expires_at: row.expires_at || null },
      403,
    );
  }
  if (row.envelope_status !== "ready_for_dispatch") {
    throw runnerError(
      "readiness_repair_capability_envelope_not_ready",
      "Capability envelope is not ready for dispatch.",
      { envelope_id: row.envelope_id || null, envelope_status: row.envelope_status || null },
      403,
    );
  }
  if (!["not_executed", "referenced"].includes(String(row.execution_status || "not_executed"))) {
    throw runnerError(
      "readiness_repair_capability_envelope_already_consumed",
      "Capability envelope was already consumed or cancelled.",
      { envelope_id: row.envelope_id || null, execution_status: row.execution_status || null },
      403,
    );
  }
  if (!boolNumber(row.apply_allowed) || !boolNumber(row.dispatch_allowed)) {
    throw runnerError(
      "readiness_repair_capability_envelope_not_allowed",
      "Capability envelope no longer permits apply and dispatch.",
      { envelope_id: row.envelope_id || null },
      403,
    );
  }
  return true;
}

async function lockEnvelope(db, envelopeId) {
  const rows = await queryRows(
    db,
    `SELECT envelope_id, envelope_status, execution_status, dispatch_allowed, apply_allowed,
            audit_required, readback_required, expires_at, secrets_included
       FROM capability_resolution_envelope_ledger
      WHERE envelope_id = ?
      LIMIT 2
      FOR UPDATE`,
    [envelopeId],
  );
  const row = oneRow(rows, "capability_resolution_envelope");
  if (boolNumber(row.secrets_included)) {
    throw runnerError(
      "readiness_repair_capability_envelope_secret_boundary_failed",
      "Capability envelope violates the secret boundary.",
      { envelope_id: envelopeId },
      403,
    );
  }
  assertEnvelopeFresh(row);
  return row;
}

async function resolveApplyEnvelope(db, envelopeId, env = process.env) {
  const deployment = resolveProductionDeployment(env);
  const resolved = await resolveCapabilityExecutionEnvelope({
    pool: db,
    envelopeId,
    acceptedAppKeys: [ENVELOPE_APP_KEY],
    acceptedCapabilityKeys: [ENVELOPE_CAPABILITY_KEY],
    acceptedIntents: [ENVELOPE_OPERATION_INTENT],
    expectedTenantId: PLATFORM_TENANT_ID,
    expectedResourceUri: migrationResourceUri(),
    expectedCommitSha: deployment.commit_sha,
    expectedBindingSha256: migrationBindingSha(),
    requireCommitHint: true,
    requireReadyForDispatch: true,
    requireDispatchAllowed: true,
    requireNoBlockingGaps: true,
    requireNoSecrets: true,
    allowReferenced: true,
  });
  if (!resolved.ok) {
    throw capabilityEnvelopeError(
      resolved,
      "Readiness repair apply requires a checksum- and Production-commit-bound capability envelope.",
    );
  }
  if (resolved.selected_runtime_surface !== ENVELOPE_RUNTIME_SURFACE) {
    throw runnerError(
      "readiness_repair_capability_envelope_runtime_surface_mismatch",
      "Capability envelope must use the governed auth-host runtime surface.",
      { envelope_id: resolved.envelope_id, selected_runtime_surface: resolved.selected_runtime_surface },
      403,
    );
  }
  if (resolved.apply_allowed !== true || resolved.readback_required !== true
      || resolved.audit_required !== true) {
    throw runnerError(
      "readiness_repair_capability_envelope_policy_mismatch",
      "Capability envelope must permit apply and require audit plus readback.",
      {
        envelope_id: resolved.envelope_id,
        apply_allowed: resolved.apply_allowed,
        audit_required: resolved.audit_required,
        readback_required: resolved.readback_required,
      },
      403,
    );
  }
  return { ...resolved, deployment };
}

async function consumeEnvelopeAtomically(db, envelopeId, executionRef) {
  const [result] = await db.query(
    `UPDATE capability_resolution_envelope_ledger
        SET execution_status = 'executed',
            execution_ref = COALESCE(NULLIF(?, ''), execution_ref),
            dispatch_allowed = 0,
            apply_allowed = 0,
            updated_at = NOW()
      WHERE envelope_id = ?
        AND envelope_status = 'ready_for_dispatch'
        AND execution_status IN ('not_executed','referenced')
        AND dispatch_allowed = 1
        AND apply_allowed = 1
        AND expires_at > NOW()`,
    [String(executionRef || "").slice(0, 191), envelopeId],
  );
  if (Number(result?.affectedRows || 0) !== 1) {
    const rows = await queryRows(
      db,
      `SELECT envelope_id, envelope_status, execution_status, dispatch_allowed, apply_allowed,
              expires_at
         FROM capability_resolution_envelope_ledger
        WHERE envelope_id = ?
        LIMIT 1`,
      [envelopeId],
    );
    const [current = null] = rows;
    throw runnerError(
      "readiness_repair_capability_envelope_consume_blocked",
      "Capability envelope could not be consumed before commit.",
      { envelope_id: envelopeId, current },
      403,
    );
  }
  return { ok: true, envelope_id: envelopeId, consumed: true };
}

async function ledgerSupportsCapabilityEnvelope(db) {
  const rows = await queryRows(
    db,
    `SELECT COUNT(*) AS count
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'governed_migration_ledger'
        AND column_name = 'capability_envelope_id'`,
  );
  const [evidence = null] = rows;
  return Number(evidence?.count || 0) === 1;
}

async function recordLedger(db, { results, before, after, capabilityEnvelopeId }) {
  const runId = randomUUID();
  const metadata = {
    atomic_transaction: true,
    advisory_lock: LOCK_NAME,
    transaction_scope: "migration_statements+ledger+envelope_consume",
    retry_without_readback_allowed: false,
    before: publicState(before),
    after: publicState(after),
    capability_envelope_id: capabilityEnvelopeId,
    provider_call_executed: false,
    external_write_executed: false,
    credential_payload_read: false,
    secrets_included: false,
  };
  await db.query(
    `INSERT INTO governed_migration_ledger
      (run_id, migration_file, migration_checksum_sha256, applied_by, runner_version, mode,
       statement_count, preflight_status, preflight_risk_count, requirements_json, results_json,
       before_schema_objects_json, after_schema_objects_json, metadata_json, secrets_included)
     VALUES (?, ?, ?, ?, ?, 'apply', 3, 'pass', 0, ?, ?, ?, ?, ?, 0)`,
    [
      runId,
      READINESS_REPAIR_MIGRATION,
      READINESS_REPAIR_CHECKSUM,
      process.env.GOVERNED_MIGRATION_APPLIED_BY || "readiness_repair_atomic_runner",
      READINESS_REPAIR_RUNNER_VERSION,
      JSON.stringify({ target_tables: TARGET_TABLES, row_readback_required: true }),
      JSON.stringify(results),
      JSON.stringify(TARGET_TABLES),
      JSON.stringify(TARGET_TABLES),
      JSON.stringify(metadata),
    ],
  );
  if (await ledgerSupportsCapabilityEnvelope(db)) {
    await db.query(
      "UPDATE governed_migration_ledger SET capability_envelope_id = ? WHERE run_id = ?",
      [capabilityEnvelopeId, runId],
    );
  }
  return runId;
}

async function loadMigration() {
  const migrationPath = path.join(MIGRATION_DIR, READINESS_REPAIR_MIGRATION);
  const sql = await fs.readFile(migrationPath, "utf8");
  const checksum = sha256(sql);
  if (checksum !== READINESS_REPAIR_CHECKSUM) {
    throw runnerError(
      "readiness_repair_checksum_mismatch",
      "Deployed migration checksum differs from the approved checksum.",
      {
        expected_checksum_sha256: READINESS_REPAIR_CHECKSUM,
        actual_checksum_sha256: checksum,
      },
    );
  }
  const statements = splitMigrationSqlStatements(sql);
  assertReadinessRepairStatements(statements);
  return { statements, checksum };
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = { mode: "dry_run", confirm: "", capabilityEnvelopeId: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = String(argv[index] || "");
    if (value === "--dry-run") args.mode = "dry_run";
    else if (value === "--apply") args.mode = "apply";
    else if (value === "--confirm") args.confirm = String(argv[++index] || "");
    else if (value.startsWith("--confirm=")) args.confirm = value.slice("--confirm=".length);
    else if (value === "--capability-envelope-id") {
      args.capabilityEnvelopeId = String(argv[++index] || "");
    } else if (value.startsWith("--capability-envelope-id=")) {
      args.capabilityEnvelopeId = value.slice("--capability-envelope-id=".length);
    } else if (value === `--migration=${READINESS_REPAIR_MIGRATION}`) {
      // Compatibility with governedMigrationExecutionTool arguments.
    } else if (value === "--migration"
      && String(argv[index + 1] || "") === READINESS_REPAIR_MIGRATION) {
      index += 1;
    } else {
      throw runnerError(
        "readiness_repair_argument_unsupported",
        `Unsupported argument: ${value}`,
        {},
        400,
      );
    }
  }
  return args;
}

async function runDryRun(pool, migration) {
  const state = await readState(pool);
  const assessment = assessReadinessRepairState(state);
  return {
    ok: assessment.status !== "blocked",
    mode: "dry_run",
    migration: READINESS_REPAIR_MIGRATION,
    migration_checksum_sha256: migration.checksum,
    statement_count: migration.statements.length,
    applies_sql: false,
    authorization: publicState(state).authorization,
    preflight: assessment,
    requirements: { schema_objects: TARGET_TABLES },
    before_schema_objects: TARGET_TABLES,
    before_state: publicState(state),
    required_confirmation: READINESS_REPAIR_APPLY_CONFIRMATION,
    atomic_transaction_required: true,
    retry_without_readback_allowed: false,
    secrets_included: false,
  };
}

async function acquireLock(connection) {
  const rows = await queryRows(connection, "SELECT GET_LOCK(?, 15) AS acquired", [LOCK_NAME]);
  const [evidence = null] = rows;
  if (Number(evidence?.acquired || 0) !== 1) {
    throw runnerError(
      "readiness_repair_advisory_lock_unavailable",
      "Could not acquire the migration advisory lock.",
      { advisory_lock: LOCK_NAME },
    );
  }
}

async function releaseLock(connection) {
  try {
    await connection.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]);
  } catch {
  }
}

async function runApply(pool, migration, args, env = process.env) {
  if (args.confirm !== READINESS_REPAIR_APPLY_CONFIRMATION) {
    throw runnerError(
      "readiness_repair_confirmation_required",
      `Apply requires --confirm=${READINESS_REPAIR_APPLY_CONFIRMATION}.`,
      { required_confirmation: READINESS_REPAIR_APPLY_CONFIRMATION },
    );
  }
  if (!UUID_PATTERN.test(args.capabilityEnvelopeId)) {
    throw runnerError(
      "readiness_repair_capability_envelope_required",
      "Apply requires a valid capability envelope UUID.",
      {},
      403,
    );
  }

  const connection = await pool.getConnection();
  let committed = false;
  let transactionStarted = false;
  let runId = null;
  try {
    await acquireLock(connection);
    await connection.beginTransaction();
    transactionStarted = true;

    await lockEnvelope(connection, args.capabilityEnvelopeId);
    const envelope = await resolveApplyEnvelope(connection, args.capabilityEnvelopeId, env);
    const before = await readState(connection, { forUpdate: true });
    const beforeAssessment = assessReadinessRepairState(before);
    assertApplyReady(before, beforeAssessment);

    const results = [];
    for (const statement of migration.statements) {
      const [result] = await connection.query(statement);
      results.push({
        statement_sha256: sha256(statement),
        affectedRows: Number(result?.affectedRows || 0),
        changedRows: Number(result?.changedRows || 0),
        warningStatus: Number(result?.warningStatus || 0),
      });
    }

    const after = await readState(connection, { forUpdate: true });
    const afterAssessment = verifyAfter(before, after);
    runId = await recordLedger(connection, {
      results,
      before,
      after,
      capabilityEnvelopeId: envelope.envelope_id,
    });

    const consumed = await consumeEnvelopeAtomically(
      connection,
      envelope.envelope_id,
      `governed_migration:${runId}`,
    );

    await connection.commit();
    committed = true;
    transactionStarted = false;

    const postCommit = await readState(pool);
    const postCommitAssessment = assessReadinessRepairState(postCommit);
    if (postCommitAssessment.status !== "already_satisfied"
      || postCommit.ledger?.run_id !== runId) {
      throw runnerError(
        "readiness_repair_post_commit_readback_failed",
        "Committed migration could not be verified by post-commit readback.",
        {
          committed: true,
          retry_allowed: false,
          run_id: runId,
          assessment: postCommitAssessment,
          ledger: publicState(postCommit).ledger,
        },
        502,
      );
    }

    return {
      ok: true,
      mode: "apply",
      migration: READINESS_REPAIR_MIGRATION,
      migration_checksum_sha256: migration.checksum,
      statement_count: migration.statements.length,
      statements_executed: results.length,
      applies_sql: true,
      atomic_transaction: true,
      advisory_lock: LOCK_NAME,
      results,
      preflight: beforeAssessment,
      post_apply: afterAssessment,
      requirements: { schema_objects: TARGET_TABLES },
      before_schema_objects: TARGET_TABLES,
      after_schema_objects: TARGET_TABLES,
      before_state: publicState(before),
      after_state: publicState(postCommit),
      deployment: envelope.deployment,
      ledger: {
        recorded: true,
        run_id: runId,
        capability_envelope_id: envelope.envelope_id,
      },
      capability_envelope: consumed,
      retry_without_readback_allowed: false,
      same_cycle_row_readback_verified: true,
      secrets_included: false,
    };
  } catch (error) {
    if (transactionStarted && !committed) {
      try {
        await connection.rollback();
      } catch {
      }
    }
    if (committed) {
      error.details = {
        ...(error.details || {}),
        committed: true,
        retry_allowed: false,
        run_id: runId,
        secrets_included: false,
      };
    }
    throw error;
  } finally {
    await releaseLock(connection);
    connection.release();
  }
}

export async function runReadinessRepairMigration(args = parseArgs(), deps = {}) {
  const pool = deps.pool || getPool();
  const migration = await loadMigration();
  return args.mode === "apply"
    ? runApply(pool, migration, args, deps.env || process.env)
    : runDryRun(pool, migration);
}

async function closePoolQuietly() {
  try {
    await getPool().end();
  } catch {
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  runReadinessRepairMigration()
    .then(async (result) => {
      console.log(JSON.stringify(result, null, 2));
      await closePoolQuietly();
      if (result.ok !== true) process.exitCode = 2;
    })
    .catch(async (error) => {
      console.error(JSON.stringify({
        ok: false,
        error: error?.message || String(error),
        code: error?.code || "readiness_repair_runner_failed",
        details: error?.details || undefined,
        retry_allowed: false,
        secrets_included: false,
      }, null, 2));
      await closePoolQuietly();
      process.exit(1);
    });
}
