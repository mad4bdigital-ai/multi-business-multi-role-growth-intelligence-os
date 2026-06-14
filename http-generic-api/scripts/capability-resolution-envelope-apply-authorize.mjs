#!/usr/bin/env node
import crypto, { randomUUID } from "node:crypto";
import { getPool } from "../db.js";
import { assertNoSecretBearingFields } from "../capabilityEnvelopeSecretPolicy.js";

function parseArgs(argv = process.argv.slice(2)) {
  const args = { envelopeId: "", authorizedBy: "gpt_admin", decisionNote: "", ttlMinutes: 60 };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--envelope-id") args.envelopeId = argv[++i] || "";
    else if (item.startsWith("--envelope-id=")) args.envelopeId = item.slice("--envelope-id=".length);
    else if (item === "--authorized-by") args.authorizedBy = argv[++i] || args.authorizedBy;
    else if (item.startsWith("--authorized-by=")) args.authorizedBy = item.slice("--authorized-by=".length);
    else if (item === "--decision-note") args.decisionNote = argv[++i] || "";
    else if (item.startsWith("--decision-note=")) args.decisionNote = item.slice("--decision-note=".length);
    else if (item === "--ttl-minutes") args.ttlMinutes = Number(argv[++i] || args.ttlMinutes);
    else if (item.startsWith("--ttl-minutes=")) args.ttlMinutes = Number(item.slice("--ttl-minutes=".length));
  }
  return args;
}

function compact(value = "", max = 255) {
  return String(value || "").trim().slice(0, max);
}

function safeJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function safeJsonArray(value) {
  const parsed = safeJson(value, []);
  return Array.isArray(parsed) ? parsed : [];
}

function enabled(value) {
  return Number(value || 0) === 1;
}

function sha256Json(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function loadEnvelope(pool, envelopeId) {
  const [[row]] = await pool.query(
    `SELECT envelope_id, tenant_id, user_id, workspace_id, workspace_key, app_key, capability_key, operation_intent,
            selected_source_tier, selected_runtime_surface, envelope_status, decision, dispatch_allowed, apply_allowed,
            approval_required, quota_required, audit_required, readback_required, blocking_gap_count, execution_status,
            expires_at, secrets_included, envelope_json
       FROM capability_resolution_envelope_ledger
      WHERE envelope_id = ?
      LIMIT 1`,
    [envelopeId]
  );
  return row || null;
}

async function loadApplyAuthorizationPolicy(pool, row) {
  if (!row) return null;
  const [rows] = await pool.query(
    `SELECT policy_key, app_key, capability_key, operation_intent, runtime_surface, status,
            allow_external_write, allow_credential_binding, allow_no_credential_binding,
            requires_ready_for_dispatch, requires_dispatch_allowed, requires_zero_blocking_gaps,
            requires_audit_evidence, requires_readback, requires_typed_confirmation,
            requires_same_cycle_dry_run, allowed_source_tiers_json, policy_json, notes
       FROM capability_apply_authorization_policy_registry
      WHERE app_key = ?
        AND capability_key = ?
        AND runtime_surface = ?
        AND status = 'active'
        AND (operation_intent IS NULL OR operation_intent = '' OR operation_intent = ?)
      ORDER BY CASE WHEN operation_intent = ? THEN 0 ELSE 1 END, updated_at DESC
      LIMIT 1`,
    [row.app_key, row.capability_key, row.selected_runtime_surface, row.operation_intent || "", row.operation_intent || ""]
  ).catch((err) => {
    err.code = err.code || "capability_apply_authorization_policy_lookup_failed";
    throw err;
  });
  return rows[0] || null;
}

function validationError(code, message, details = undefined) {
  const err = new Error(message);
  err.code = code;
  if (details) err.details = details;
  return err;
}

function validateEnvelopeForApplyAuthorization(row, policy) {
  if (!row) {
    throw validationError("capability_envelope_not_found", "Capability resolution envelope was not found.");
  }
  if (!policy) {
    throw validationError(
      "capability_envelope_apply_capability_not_allowlisted",
      "Envelope capability/app/runtime has no active dynamic apply authorization policy.",
      { app_key: row.app_key, capability_key: row.capability_key, selected_runtime_surface: row.selected_runtime_surface }
    );
  }
  if (Number(row.secrets_included || 0) !== 0) {
    throw validationError("capability_envelope_secret_boundary_failed", "Capability resolution envelope contains secrets marker and cannot be apply-authorized.");
  }
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    throw validationError("capability_envelope_expired", "Capability resolution envelope is expired and cannot be apply-authorized.");
  }
  if (enabled(policy.requires_ready_for_dispatch) && (row.envelope_status !== "ready_for_dispatch" || row.decision !== "ready_for_dispatch")) {
    throw validationError(
      "capability_envelope_not_ready_for_apply_authorization",
      "Only ready_for_dispatch envelopes can be apply-authorized by this policy.",
      { envelope_status: row.envelope_status, decision: row.decision, policy_key: policy.policy_key }
    );
  }
  if (enabled(policy.requires_dispatch_allowed) && Number(row.dispatch_allowed || 0) !== 1) {
    throw validationError(
      "capability_envelope_not_dispatchable",
      "Envelope must have dispatch_allowed=true before apply authorization.",
      { dispatch_allowed: Boolean(row.dispatch_allowed), policy_key: policy.policy_key }
    );
  }
  if (enabled(policy.requires_zero_blocking_gaps) && Number(row.blocking_gap_count || 0) !== 0) {
    throw validationError(
      "capability_envelope_not_dispatchable",
      "Envelope must have zero blocking gaps before apply authorization.",
      { blocking_gap_count: Number(row.blocking_gap_count || 0), policy_key: policy.policy_key }
    );
  }
  if (!["not_executed", "referenced"].includes(String(row.execution_status || "not_executed"))) {
    throw validationError(
      "capability_envelope_execution_status_not_apply_authorizable",
      "Envelope has already been executed, failed, cancelled, or consumed.",
      { execution_status: row.execution_status }
    );
  }
  if (String(row.app_key || "") !== String(policy.app_key || "")) {
    throw validationError("capability_envelope_apply_app_not_allowed", "Apply authorization app does not match dynamic policy.", { app_key: row.app_key, policy_app_key: policy.app_key });
  }
  if (String(row.capability_key || "") !== String(policy.capability_key || "")) {
    throw validationError("capability_envelope_apply_capability_not_allowlisted", "Apply authorization capability does not match dynamic policy.", { capability_key: row.capability_key, policy_capability_key: policy.capability_key });
  }
  if (String(row.selected_runtime_surface || "") !== String(policy.runtime_surface || "")) {
    throw validationError("capability_envelope_apply_runtime_surface_mismatch", "Apply authorization runtime surface mismatch.", { selected_runtime_surface: row.selected_runtime_surface, policy_runtime_surface: policy.runtime_surface });
  }
  if (policy.operation_intent && String(row.operation_intent || "") !== String(policy.operation_intent || "")) {
    throw validationError("capability_envelope_apply_operation_intent_mismatch", "Apply authorization operation intent mismatch.", { operation_intent: row.operation_intent, policy_operation_intent: policy.operation_intent });
  }
  if (enabled(policy.requires_audit_evidence) && Number(row.audit_required || 0) !== 1) {
    throw validationError("capability_envelope_apply_audit_required", "Dynamic apply authorization policy requires audit evidence.", { audit_required: Boolean(row.audit_required), policy_key: policy.policy_key });
  }
  if (enabled(policy.requires_readback) && Number(row.readback_required || 0) !== 1) {
    throw validationError("capability_envelope_apply_readback_required", "Dynamic apply authorization policy requires readback.", { readback_required: Boolean(row.readback_required), policy_key: policy.policy_key });
  }
  const allowedSourceTiers = safeJsonArray(policy.allowed_source_tiers_json).map((tier) => String(tier || ""));
  if (allowedSourceTiers.length && !allowedSourceTiers.includes(String(row.selected_source_tier || ""))) {
    throw validationError(
      "capability_envelope_apply_source_tier_not_allowed",
      "Envelope selected source tier is not allowed by the dynamic apply authorization policy.",
      { selected_source_tier: row.selected_source_tier, allowed_source_tiers: allowedSourceTiers, policy_key: policy.policy_key }
    );
  }
}

function validateCredentialEnvelope(envelopeJson, policy) {
  const selected = envelopeJson.selected_source || {};
  const candidates = Array.isArray(selected.credential_source_candidates) ? selected.credential_source_candidates : [];
  const activeBindingCount = Number(selected.active_credential_binding_count || 0);
  if (activeBindingCount > 0 && !enabled(policy.allow_credential_binding)) {
    throw validationError(
      "capability_envelope_apply_credential_binding_not_allowed",
      "Dynamic apply authorization policy forbids credential-backed envelopes for this capability.",
      { active_credential_binding_count: activeBindingCount, policy_key: policy.policy_key }
    );
  }
  if (activeBindingCount === 0 && !enabled(policy.allow_no_credential_binding)) {
    throw validationError(
      "capability_envelope_apply_requires_credential_binding",
      "Dynamic apply authorization policy requires an active credential binding for this capability.",
      { active_credential_binding_count: activeBindingCount, policy_key: policy.policy_key }
    );
  }
  if (!enabled(policy.allow_credential_binding) && !candidates.includes("none")) {
    throw validationError(
      "capability_envelope_apply_requires_no_credential_binding",
      "Apply authorization requires a no-credential app binding for this capability.",
      { credential_source_candidates: candidates, policy_key: policy.policy_key }
    );
  }
}

export async function authorizeCapabilityResolutionEnvelopeApply(args = parseArgs()) {
  const envelopeId = compact(args.envelopeId, 64);
  if (!envelopeId) {
    throw validationError("capability_envelope_id_required", "--envelope-id is required.");
  }
  const pool = getPool();
  const row = await loadEnvelope(pool, envelopeId);
  const policy = await loadApplyAuthorizationPolicy(pool, row);
  validateEnvelopeForApplyAuthorization(row, policy);
  const envelopeJson = safeJson(row.envelope_json, {});
  validateCredentialEnvelope(envelopeJson, policy);
  const policyJson = safeJson(policy.policy_json, {});
  const allowExternalWrite = enabled(policy.allow_external_write);

  if (Number(row.apply_allowed || 0) === 1) {
    return {
      ok: true,
      envelope_id: row.envelope_id,
      already_apply_authorized: true,
      apply_allowed: true,
      policy_key: policy.policy_key,
      external_write_allowed: allowExternalWrite,
      secrets_included: false,
    };
  }

  const authorizedBy = compact(args.authorizedBy, 64) || "gpt_admin";
  const decisionNote = compact(args.decisionNote, 512) || "Apply-authorized through governed dynamic capability apply authorization policy.";
  const ttl = Math.max(5, Math.min(Number(args.ttlMinutes || 60), 240));
  const holdId = randomUUID();
  const applyAuthorization = {
    evidence_table: "approval_holds",
    hold_id: holdId,
    status: "apply_authorized",
    authorized_by: authorizedBy,
    decision_note: decisionNote,
    authorized_at: new Date().toISOString(),
    policy_key: policy.policy_key,
    app_key: row.app_key,
    capability_key: row.capability_key,
    operation_intent: row.operation_intent,
    runtime_surface: row.selected_runtime_surface,
    allow_external_write: allowExternalWrite,
    no_external_write: !allowExternalWrite,
    no_provider_call: true,
    no_credential_payload_read: true,
    no_spend_change: true,
    requires_typed_confirmation: Boolean(enabled(policy.requires_typed_confirmation)),
    requires_same_cycle_dry_run: Boolean(enabled(policy.requires_same_cycle_dry_run)),
    requires_readback: Boolean(enabled(policy.requires_readback)),
    policy: policyJson,
    secrets_included: false,
  };
  const updatedEnvelope = {
    ...envelopeJson,
    gates: {
      ...(envelopeJson.gates || {}),
      dispatch_allowed: true,
      apply_allowed: true,
      audit_required: true,
      readback_required: Boolean(enabled(policy.requires_readback)) || Boolean(envelopeJson.gates?.readback_required),
      secrets_included: false,
    },
    apply_authorization: applyAuthorization,
    secrets_included: false,
  };
  assertNoSecretKeys(updatedEnvelope);
  const updatedHash = sha256Json(updatedEnvelope);
  await pool.query(
    `INSERT INTO approval_holds
      (hold_id, run_id, tenant_id, workspace_id, workspace_key, hold_type, requested_by, user_id,
       actor_id, actor_type, request_id, correlation_id, execution_context_json, assigned_to,
       required_role, status, decision_by, decision_note, expires_at, decided_at, created_at)
     VALUES
      (?, ?, ?, ?, ?, 'supervisor_approval', ?, ?, ?, 'platform_admin', 'capability_resolution_envelope_apply_authorization', ?, ?, ?, 'admin', 'approved', ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), NOW(), NOW())`,
    [
      holdId,
      row.envelope_id,
      row.tenant_id,
      row.workspace_id || null,
      row.workspace_key || null,
      authorizedBy,
      row.user_id || null,
      authorizedBy,
      row.envelope_id,
      JSON.stringify({
        envelope_id: row.envelope_id,
        app_key: row.app_key,
        capability_key: row.capability_key,
        operation_intent: row.operation_intent,
        policy_key: policy.policy_key,
        apply_authorization_source: "dynamic_capability_apply_authorization_policy",
        allow_external_write: allowExternalWrite,
        no_external_write: !allowExternalWrite,
        no_provider_call: true,
        no_credential_payload_read: true,
        no_spend_change: true,
        secrets_included: false,
      }),
      authorizedBy,
      authorizedBy,
      decisionNote,
      ttl,
    ]
  );
  await pool.query(
    `UPDATE capability_resolution_envelope_ledger
        SET apply_allowed = 1,
            envelope_json = ?,
            envelope_sha256 = ?,
            expires_at = DATE_ADD(NOW(), INTERVAL ? MINUTE),
            updated_at = NOW()
      WHERE envelope_id = ?
        AND envelope_status = 'ready_for_dispatch'
        AND dispatch_allowed = 1
        AND blocking_gap_count = 0
        AND secrets_included = 0`,
    [JSON.stringify(updatedEnvelope), updatedHash, ttl, row.envelope_id]
  );
  return {
    ok: true,
    envelope_id: row.envelope_id,
    envelope_status: "ready_for_dispatch",
    decision: "ready_for_dispatch",
    apply_allowed: true,
    policy_key: policy.policy_key,
    external_write_allowed: allowExternalWrite,
    apply_authorization_hold_id: holdId,
    authorized_by: authorizedBy,
    expires_in_minutes: ttl,
    envelope_sha256: updatedHash,
    no_provider_call: true,
    no_credential_payload_read: true,
    no_spend_change: true,
    secrets_included: false,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  authorizeCapabilityResolutionEnvelopeApply(parseArgs())
    .then(async (result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      await getPool().end().catch(() => {});
    })
    .catch(async (err) => {
      process.stdout.write(`${JSON.stringify({ ok: false, error: { code: err.code || "capability_envelope_apply_authorization_failed", message: err.message, details: err.details || undefined }, secrets_included: false }, null, 2)}\n`);
      await getPool().end().catch(() => {});
      process.exitCode = 1;
    });
}
