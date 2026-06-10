#!/usr/bin/env node
import crypto, { randomUUID } from "node:crypto";
import { getPool } from "../db.js";

const APPLY_AUTHORIZABLE_CAPABILITIES = new Set([
  "ads_provider_governance_snapshot_record",
]);

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

function sha256Json(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assertNoSecretKeys(value, path = "root") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretKeys(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (/secret|token|api[_-]?key|private[_-]?key|ciphertext|password/i.test(key) && key !== "secrets_included") {
      const err = new Error(`Apply authorization refuses to store sensitive field at ${path}.${key}`);
      err.code = "capability_envelope_sensitive_field_rejected";
      throw err;
    }
    assertNoSecretKeys(nested, `${path}.${key}`);
  }
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

function validateEnvelopeForApplyAuthorization(row) {
  if (!row) {
    const err = new Error("Capability resolution envelope was not found.");
    err.code = "capability_envelope_not_found";
    throw err;
  }
  if (Number(row.secrets_included || 0) !== 0) {
    const err = new Error("Capability resolution envelope contains secrets marker and cannot be apply-authorized.");
    err.code = "capability_envelope_secret_boundary_failed";
    throw err;
  }
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    const err = new Error("Capability resolution envelope is expired and cannot be apply-authorized.");
    err.code = "capability_envelope_expired";
    throw err;
  }
  if (row.envelope_status !== "ready_for_dispatch" || row.decision !== "ready_for_dispatch") {
    const err = new Error("Only ready_for_dispatch envelopes can be apply-authorized.");
    err.code = "capability_envelope_not_ready_for_apply_authorization";
    err.details = { envelope_status: row.envelope_status, decision: row.decision };
    throw err;
  }
  if (Number(row.dispatch_allowed || 0) !== 1 || Number(row.blocking_gap_count || 0) !== 0) {
    const err = new Error("Envelope must have dispatch_allowed=true and zero blocking gaps before apply authorization.");
    err.code = "capability_envelope_not_dispatchable";
    err.details = { dispatch_allowed: Boolean(row.dispatch_allowed), blocking_gap_count: Number(row.blocking_gap_count || 0) };
    throw err;
  }
  if (!["not_executed", "referenced"].includes(String(row.execution_status || "not_executed"))) {
    const err = new Error("Envelope has already been executed, failed, cancelled, or consumed.");
    err.code = "capability_envelope_execution_status_not_apply_authorizable";
    err.details = { execution_status: row.execution_status };
    throw err;
  }
  if (!APPLY_AUTHORIZABLE_CAPABILITIES.has(String(row.capability_key || ""))) {
    const err = new Error("Envelope capability is not allowlisted for apply authorization.");
    err.code = "capability_envelope_apply_capability_not_allowlisted";
    err.details = { capability_key: row.capability_key };
    throw err;
  }
  if (String(row.app_key || "") !== "platform_orchestration") {
    const err = new Error("Apply authorization is limited to the internal platform_orchestration app.");
    err.code = "capability_envelope_apply_app_not_allowed";
    err.details = { app_key: row.app_key };
    throw err;
  }
}

function validateNoCredentialEnvelope(row, envelopeJson) {
  const selected = envelopeJson.selected_source || {};
  const candidates = Array.isArray(selected.credential_source_candidates) ? selected.credential_source_candidates : [];
  if (!candidates.includes("none")) {
    const err = new Error("Apply authorization requires a no-credential app binding.");
    err.code = "capability_envelope_apply_requires_no_credential_binding";
    err.details = { credential_source_candidates: candidates };
    throw err;
  }
  if (Number(selected.active_credential_binding_count || 0) !== 0) {
    const err = new Error("Apply authorization for this surface must not rely on credential bindings.");
    err.code = "capability_envelope_apply_credential_binding_not_allowed";
    err.details = { active_credential_binding_count: selected.active_credential_binding_count };
    throw err;
  }
  if (String(row.selected_runtime_surface || selected.selected_runtime_surface || "") !== "ads_provider_governance_snapshot_record") {
    const err = new Error("Apply authorization runtime surface mismatch.");
    err.code = "capability_envelope_apply_runtime_surface_mismatch";
    err.details = { selected_runtime_surface: row.selected_runtime_surface || selected.selected_runtime_surface || null };
    throw err;
  }
}

export async function authorizeCapabilityResolutionEnvelopeApply(args = parseArgs()) {
  const envelopeId = compact(args.envelopeId, 64);
  if (!envelopeId) {
    const err = new Error("--envelope-id is required.");
    err.code = "capability_envelope_id_required";
    throw err;
  }
  const pool = getPool();
  const row = await loadEnvelope(pool, envelopeId);
  validateEnvelopeForApplyAuthorization(row);
  const envelopeJson = safeJson(row.envelope_json, {});
  validateNoCredentialEnvelope(row, envelopeJson);
  if (Number(row.apply_allowed || 0) === 1) {
    return {
      ok: true,
      envelope_id: row.envelope_id,
      already_apply_authorized: true,
      apply_allowed: true,
      secrets_included: false,
    };
  }
  const authorizedBy = compact(args.authorizedBy, 64) || "gpt_admin";
  const decisionNote = compact(args.decisionNote, 512) || "Apply-authorized through governed capability envelope apply authorization tool.";
  const ttl = Math.max(5, Math.min(Number(args.ttlMinutes || 60), 240));
  const holdId = randomUUID();
  const applyAuthorization = {
    evidence_table: "approval_holds",
    hold_id: holdId,
    status: "apply_authorized",
    authorized_by: authorizedBy,
    decision_note: decisionNote,
    authorized_at: new Date().toISOString(),
    capability_key: row.capability_key,
    runtime_surface: row.selected_runtime_surface,
    no_provider_call: true,
    no_credential_payload_read: true,
    no_spend_change: true,
    no_external_write: true,
    secrets_included: false,
  };
  const updatedEnvelope = {
    ...envelopeJson,
    gates: {
      ...(envelopeJson.gates || {}),
      dispatch_allowed: true,
      apply_allowed: true,
      audit_required: true,
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
        apply_authorization_source: "capability_resolution_envelope_apply_authorize",
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
