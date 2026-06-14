#!/usr/bin/env node
import crypto, { randomUUID } from "node:crypto";
import { getPool } from "../db.js";
import { assertNoSecretBearingFields } from "../capabilityEnvelopeSecretPolicy.js";

function parseArgs(argv = process.argv.slice(2)) {
  const args = { envelopeId: "", approvedBy: "gpt_admin", decisionNote: "", ttlMinutes: 120 };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--envelope-id") args.envelopeId = argv[++i] || "";
    else if (item.startsWith("--envelope-id=")) args.envelopeId = item.slice("--envelope-id=".length);
    else if (item === "--approved-by") args.approvedBy = argv[++i] || args.approvedBy;
    else if (item.startsWith("--approved-by=")) args.approvedBy = item.slice("--approved-by=".length);
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

async function loadEnvelope(pool, envelopeId) {
  const [[row]] = await pool.query(
    `SELECT envelope_id, tenant_id, user_id, workspace_id, workspace_key, app_key, capability_key, operation_intent,
            envelope_status, decision, dispatch_allowed, apply_allowed, approval_required, quota_required,
            audit_required, readback_required, blocking_gap_count, execution_status, expires_at,
            secrets_included, envelope_json
       FROM capability_resolution_envelope_ledger
      WHERE envelope_id = ?
      LIMIT 1`,
    [envelopeId]
  );
  return row || null;
}

function validateEnvelopeForApproval(row) {
  if (!row) {
    const err = new Error("Capability resolution envelope was not found.");
    err.code = "capability_envelope_not_found";
    throw err;
  }
  if (Number(row.secrets_included || 0) !== 0) {
    const err = new Error("Capability resolution envelope contains secrets marker and cannot be approved.");
    err.code = "capability_envelope_secret_boundary_failed";
    throw err;
  }
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    const err = new Error("Capability resolution envelope is expired and cannot be approved.");
    err.code = "capability_envelope_expired";
    throw err;
  }
  if (row.envelope_status !== "ready_requires_approval") {
    const err = new Error("Only ready_requires_approval envelopes can be approved by this tool.");
    err.code = "capability_envelope_status_not_approvable";
    err.details = { envelope_status: row.envelope_status };
    throw err;
  }
  if (Number(row.dispatch_allowed || 0) !== 1 || Number(row.blocking_gap_count || 0) !== 0) {
    const err = new Error("Envelope must have dispatch_allowed=true and zero blocking gaps before approval.");
    err.code = "capability_envelope_not_dispatchable";
    err.details = { dispatch_allowed: Boolean(row.dispatch_allowed), blocking_gap_count: Number(row.blocking_gap_count || 0) };
    throw err;
  }
  if (Number(row.approval_required || 0) !== 1) {
    const err = new Error("Envelope does not require approval.");
    err.code = "capability_envelope_approval_not_required";
    throw err;
  }
  if (!["not_executed", "referenced"].includes(String(row.execution_status || "not_executed"))) {
    const err = new Error("Envelope has already been executed, failed, cancelled, or consumed.");
    err.code = "capability_envelope_execution_status_not_approvable";
    err.details = { execution_status: row.execution_status };
    throw err;
  }
}

export async function approveCapabilityResolutionEnvelope(args = parseArgs()) {
  const envelopeId = compact(args.envelopeId, 64);
  if (!envelopeId) {
    const err = new Error("--envelope-id is required.");
    err.code = "capability_envelope_id_required";
    throw err;
  }
  const pool = getPool();
  const row = await loadEnvelope(pool, envelopeId);
  validateEnvelopeForApproval(row);
  const approvedBy = compact(args.approvedBy, 64) || "gpt_admin";
  const decisionNote = compact(args.decisionNote, 512) || "Approved through governed capability envelope approval tool.";
  const ttl = Math.max(5, Math.min(Number(args.ttlMinutes || 120), 1440));
  const holdId = randomUUID();
  const envelopeJson = safeJson(row.envelope_json, {});
  const approval = {
    evidence_table: "approval_holds",
    hold_id: holdId,
    status: "approved",
    approved_by: approvedBy,
    decision_note: decisionNote,
    approved_at: new Date().toISOString(),
    secrets_included: false,
  };
  const updatedEnvelope = {
    ...envelopeJson,
    decision: "ready_for_dispatch",
    gates: {
      ...(envelopeJson.gates || {}),
      approval_required: false,
      dispatch_allowed: true,
      secrets_included: false,
    },
    approval,
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
      (?, ?, ?, ?, ?, 'supervisor_approval', ?, ?, ?, 'platform_admin', 'capability_resolution_envelope_approval', ?, ?, ?, 'admin', 'approved', ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), NOW(), NOW())`,
    [
      holdId,
      row.envelope_id,
      row.tenant_id,
      row.workspace_id || null,
      row.workspace_key || null,
      approvedBy,
      row.user_id || null,
      approvedBy,
      row.envelope_id,
      JSON.stringify({ envelope_id: row.envelope_id, app_key: row.app_key, capability_key: row.capability_key, operation_intent: row.operation_intent, approval_source: "capability_resolution_envelope_approve", secrets_included: false }),
      approvedBy,
      approvedBy,
      decisionNote,
      ttl,
    ]
  );
  await pool.query(
    `UPDATE capability_resolution_envelope_ledger
        SET envelope_status = 'ready_for_dispatch',
            decision = 'ready_for_dispatch',
            approval_required = 0,
            envelope_json = ?,
            envelope_sha256 = ?,
            expires_at = DATE_ADD(NOW(), INTERVAL ? MINUTE),
            updated_at = NOW()
      WHERE envelope_id = ?
        AND envelope_status = 'ready_requires_approval'
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
    approval_hold_id: holdId,
    approved_by: approvedBy,
    expires_in_minutes: ttl,
    envelope_sha256: updatedHash,
    secrets_included: false,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  approveCapabilityResolutionEnvelope(parseArgs())
    .then(async (result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      await getPool().end().catch(() => {});
    })
    .catch(async (err) => {
      process.stdout.write(`${JSON.stringify({ ok: false, error: { code: err.code || "capability_envelope_approval_failed", message: err.message, details: err.details || undefined }, secrets_included: false }, null, 2)}\n`);
      await getPool().end().catch(() => {});
      process.exitCode = 1;
    });
}
