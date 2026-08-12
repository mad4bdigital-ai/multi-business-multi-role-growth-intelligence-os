import crypto, { randomUUID } from "node:crypto";
import { getPool } from "./db.js";

export const BREAK_GLASS_RECONCILIATION_CLOSURE_CONTRACT = "mad4b.runtime-break-glass-reconciliation-closure.v1";
const SHA40 = /^[0-9a-f]{40}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const FOLLOWUP_TRANSITIONS = Object.freeze({
  RECONCILING: "MAIN_COMMITTED",
  MAIN_COMMITTED: "STAGING_VERIFIED",
  STAGING_VERIFIED: "PRODUCTION_PROMOTED",
  PRODUCTION_PROMOTED: "REDEPLOYED",
  REDEPLOYED: "CLEAN_READBACK",
  CLEAN_READBACK: "CLOSED",
});

function text(value = "", max = 1000) { return String(value ?? "").trim().slice(0, max); }
function json(value, fallback = {}) { if (value && typeof value === "object") return value; try { return value ? JSON.parse(String(value)) : fallback; } catch { return fallback; } }
function stable(value) { if (Array.isArray(value)) return value.map(stable); if (!value || typeof value !== "object") return value; return Object.keys(value).sort().reduce((out, key) => ({ ...out, [key]: stable(value[key]) }), {}); }
function sha256(value) { return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function fail(code, message, status = 409, details = {}) { const error = new Error(message); error.code = code; error.status = status; error.details = { ...details, secrets_included: false }; throw error; }
function requireSha(value, field) { const resolved = text(value, 40).toLowerCase(); if (!SHA40.test(resolved)) fail("break_glass_followup_sha_required", `${field} must be a 40-character Git SHA.`, 400, { field }); return resolved; }
function requireSha256(value, field) { const resolved = text(value, 64).toLowerCase(); if (!SHA256.test(resolved)) fail("break_glass_followup_sha256_required", `${field} must be a SHA-256 value.`, 400, { field }); return resolved; }
function bool(value) { return value === true || Number(value || 0) === 1; }

export function requiredBreakGlassFollowupConfirmation(breakGlassId, toState) {
  return `ADVANCE_BREAK_GLASS_${String(breakGlassId || "").replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}_${String(toState || "").toUpperCase()}`;
}

export function assessRuntimeBreakGlassFollowupTransition({ incident = {}, to_state, evidence = {}, confirm } = {}) {
  const from = text(incident.lifecycle_state, 32).toUpperCase();
  const to = text(to_state, 32).toUpperCase();
  const expectedTo = FOLLOWUP_TRANSITIONS[from] || null;
  if (!expectedTo || expectedTo !== to) {
    return { ok: false, ready: false, reason_code: "break_glass_followup_transition_not_allowed", from_state: from, to_state: to, secrets_included: false };
  }
  const requiredConfirm = requiredBreakGlassFollowupConfirmation(incident.break_glass_id, to);
  if (text(confirm, 256) !== requiredConfirm) {
    return { ok: false, ready: false, reason_code: "break_glass_followup_confirmation_required", from_state: from, to_state: to, required_confirmation: requiredConfirm, secrets_included: false };
  }

  const update = { lifecycle_state: to };
  const normalizedEvidence = { ...json(evidence, {}), secrets_included: false };
  delete normalizedEvidence.password; delete normalizedEvidence.secret; delete normalizedEvidence.token; delete normalizedEvidence.credentials;

  if (to === "MAIN_COMMITTED") {
    const mainSha = requireSha(evidence.main_commit_sha, "main_commit_sha");
    if (!text(evidence.repository_reconciliation_plan_id, 64) || Number(evidence.repository_reconciliation_pr_number || 0) < 1 || evidence.repository_reconciliation_readback_verified !== true) {
      return { ok: false, ready: false, reason_code: "break_glass_git_reconciliation_evidence_incomplete", from_state: from, to_state: to, secrets_included: false };
    }
    update.repository_reconciliation_plan_id = text(evidence.repository_reconciliation_plan_id, 64);
    update.repository_reconciliation_plan_sha256 = requireSha256(evidence.repository_reconciliation_plan_sha256, "repository_reconciliation_plan_sha256");
    update.repository_reconciliation_pr_number = Number(evidence.repository_reconciliation_pr_number);
    update.main_commit_sha = mainSha;
    update.main_committed_at = new Date().toISOString();
  }

  if (to === "STAGING_VERIFIED") {
    const mainSha = requireSha(incident.main_commit_sha, "persisted main_commit_sha");
    const stagingSha = requireSha(evidence.staging_commit_sha, "staging_commit_sha");
    if (mainSha !== stagingSha || evidence.staging_verified !== true || evidence.required_checks_complete !== true) {
      return { ok: false, ready: false, reason_code: "break_glass_staging_verification_incomplete", from_state: from, to_state: to, secrets_included: false };
    }
    update.staging_verification_json = { staging_commit_sha: stagingSha, staging_verified: true, required_checks_complete: true, verification_ref: text(evidence.verification_ref, 191) || null, secrets_included: false };
    update.staging_verified_at = new Date().toISOString();
  }

  if (to === "PRODUCTION_PROMOTED") {
    const mainSha = requireSha(incident.main_commit_sha, "persisted main_commit_sha");
    const sourceMainSha = requireSha(evidence.promotion_source_main_sha, "promotion_source_main_sha");
    const productionSha = requireSha(evidence.production_commit_sha, "production_commit_sha");
    if (mainSha !== sourceMainSha || evidence.production_promotion_verified !== true || !text(evidence.production_promotion_authorization_id, 191)) {
      return { ok: false, ready: false, reason_code: "break_glass_production_promotion_evidence_incomplete", from_state: from, to_state: to, secrets_included: false };
    }
    update.production_commit_sha = productionSha;
    update.production_promotion_authorization_id = text(evidence.production_promotion_authorization_id, 191);
    update.production_promoted_at = new Date().toISOString();
  }

  if (to === "REDEPLOYED") {
    const productionSha = requireSha(incident.production_commit_sha, "persisted production_commit_sha");
    const deployedSha = requireSha(evidence.deployed_commit_sha, "deployed_commit_sha");
    if (productionSha !== deployedSha || evidence.deployment_verified !== true || !text(evidence.deployment_attestation_id, 36)) {
      return { ok: false, ready: false, reason_code: "break_glass_redeployment_evidence_incomplete", from_state: from, to_state: to, secrets_included: false };
    }
    update.deployment_attestation_id = text(evidence.deployment_attestation_id, 36);
    update.redeployed_at = new Date().toISOString();
  }

  if (to === "CLEAN_READBACK") {
    const productionSha = requireSha(incident.production_commit_sha, "persisted production_commit_sha");
    const runtimeSha = requireSha(evidence.runtime_commit_sha, "runtime_commit_sha");
    if (runtimeSha !== productionSha || evidence.readback_verified !== true || evidence.working_tree_clean !== true || Number(evidence.unapproved_local_change_count || 0) !== 0) {
      return { ok: false, ready: false, reason_code: "break_glass_clean_runtime_readback_incomplete", from_state: from, to_state: to, secrets_included: false };
    }
    update.clean_runtime_readback_json = { runtime_commit_sha: runtimeSha, readback_verified: true, working_tree_clean: true, unapproved_local_change_count: 0, runtime_integrity_state: "verified_clean", readback_ref: text(evidence.readback_ref, 191) || null, secrets_included: false };
    update.clean_readback_at = new Date().toISOString();
  }

  if (to === "CLOSED") {
    const clean = json(incident.clean_runtime_readback_json, {});
    const complete = Boolean(incident.main_commit_sha && incident.staging_verified_at && incident.production_commit_sha && incident.production_promoted_at && incident.deployment_attestation_id && incident.redeployed_at && incident.clean_readback_at)
      && clean.readback_verified === true && clean.working_tree_clean === true && Number(clean.unapproved_local_change_count || 0) === 0 && clean.runtime_integrity_state === "verified_clean";
    if (!complete || evidence.close_incident === false) {
      return { ok: false, ready: false, reason_code: "break_glass_reconciliation_incomplete", from_state: from, to_state: to, secrets_included: false };
    }
    update.closed_at = new Date().toISOString();
    update.closure_evidence_sha256 = sha256({ break_glass_id: incident.break_glass_id, main_commit_sha: incident.main_commit_sha, production_commit_sha: incident.production_commit_sha, deployment_attestation_id: incident.deployment_attestation_id, clean_runtime_readback: clean });
  }

  return { contract: BREAK_GLASS_RECONCILIATION_CLOSURE_CONTRACT, ok: true, ready: true, from_state: from, to_state: to, update, evidence: normalizedEvidence, required_confirmation: requiredConfirm, secrets_included: false };
}

function updateSql(update) {
  const columns = [];
  const values = [];
  for (const [key, value] of Object.entries(update)) {
    if (key === "lifecycle_state") continue;
    columns.push(`\`${key}\` = ?`);
    values.push(value && typeof value === "object" ? JSON.stringify(value) : value);
  }
  columns.push("`lifecycle_state` = ?", "`updated_at` = NOW(3)");
  values.push(update.lifecycle_state);
  return { sql: columns.join(", "), values };
}

export async function transitionRuntimeBreakGlassReconciliation(args = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const connection = typeof pool.getConnection === "function" ? await pool.getConnection() : pool;
  const transactional = typeof connection.beginTransaction === "function";
  try {
    if (transactional) await connection.beginTransaction();
    const [[incident]] = await connection.query("SELECT * FROM runtime_break_glass_incidents WHERE break_glass_id = ? LIMIT 1 FOR UPDATE", [text(args.break_glass_id, 36)]);
    if (!incident) fail("break_glass_incident_not_found", "Break-glass incident was not found.", 404);
    const assessment = assessRuntimeBreakGlassFollowupTransition({ incident, to_state: args.to_state, evidence: args.evidence, confirm: args.confirm });
    if (!assessment.ready) fail(assessment.reason_code, "Break-glass follow-up transition is not ready.", 409, assessment);
    const patch = updateSql(assessment.update);
    const [write] = await connection.query(`UPDATE runtime_break_glass_incidents SET ${patch.sql} WHERE break_glass_id = ? AND lifecycle_state = ?`, [...patch.values, incident.break_glass_id, assessment.from_state]);
    if (Number(write?.affectedRows || 0) !== 1) fail("break_glass_followup_concurrent_change", "Break-glass incident changed before follow-up transition commit.", 409);
    await connection.query(
      `INSERT INTO runtime_break_glass_audit_events
       (break_glass_event_id, break_glass_id, incident_id, event_type, from_state, to_state, actor, evidence_json, audit_correlation_json, secrets_included)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [randomUUID(), incident.break_glass_id, incident.incident_id, `reconciliation_${assessment.to_state.toLowerCase()}`, assessment.from_state, assessment.to_state, text(args.actor || incident.executing_principal, 191), JSON.stringify(assessment.evidence), incident.audit_correlation_json],
    );
    const [[readback]] = await connection.query("SELECT lifecycle_state, main_commit_sha, staging_verified_at, production_commit_sha, production_promoted_at, deployment_attestation_id, redeployed_at, clean_runtime_readback_json, clean_readback_at, closed_at, closure_evidence_sha256 FROM runtime_break_glass_incidents WHERE break_glass_id = ? LIMIT 1", [incident.break_glass_id]);
    if (text(readback?.lifecycle_state, 32).toUpperCase() !== assessment.to_state) fail("break_glass_followup_readback_failed", "Same-cycle readback did not confirm break-glass follow-up transition.", 502);
    if (transactional) await connection.commit();
    return { ok: true, contract: BREAK_GLASS_RECONCILIATION_CLOSURE_CONTRACT, break_glass_id: incident.break_glass_id, incident_id: incident.incident_id, from_state: assessment.from_state, to_state: assessment.to_state, readback, same_cycle_readback: true, provider_mutation_performed: false, deployment_performed: false, secrets_included: false };
  } catch (error) {
    if (transactional) await connection.rollback().catch(() => {});
    throw error;
  } finally {
    if (connection !== pool && typeof connection.release === "function") connection.release();
  }
}
