import { getPool } from "./db.js";
import {
  computeSupportTicketSlaStatusV2,
  reconcileSupportTicketIntegrity as planSupportTicketIntegrityReconciliation,
  resolveSupportTicketLifecyclePatch,
} from "./supportTicketLifecycleIntegrityService.js";

const OPEN_TICKET_STATUSES = new Set(["open", "in_review", "awaiting_approval"]);

function normalizeLower(value, fallback = "") {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized || fallback;
}

export function normalizeReconciliationFindingForEffectiveLifecycle(finding = {}) {
  const effectiveStatus = normalizeLower(finding.lifecycle?.status);
  if (OPEN_TICKET_STATUSES.has(effectiveStatus)) {
    const currentStatus = normalizeLower(finding.sla?.current_status, "on_track");
    const computedStatus = normalizeLower(finding.sla?.computed_status, currentStatus);
    return {
      ...finding,
      sla: {
        ...finding.sla,
        current_status: currentStatus,
        computed_status: computedStatus,
        should_update: currentStatus !== computedStatus,
      },
      should_update: Boolean(finding.should_update),
    };
  }
  const preservedStatus = normalizeLower(finding.sla?.current_status, "on_track");
  return {
    ...finding,
    sla: {
      ...finding.sla,
      current_status: preservedStatus,
      computed_status: preservedStatus,
      reason: "ticket_not_open",
      should_update: false,
      breached_milestones: [],
      warning_milestones: [],
    },
    should_update: Boolean(finding.should_update || finding.lifecycle?.should_update),
  };
}

function schemaNotReadyError(schema) {
  const error = new Error("Support ticket integrity migration is required before apply mode.");
  error.status = 409;
  error.code = "support_ticket_integrity_schema_not_ready";
  error.schema = schema;
  return error;
}

function targetMissingError(finding) {
  const error = new Error("Support ticket changed or disappeared before reconciliation apply.");
  error.status = 409;
  error.code = "support_ticket_integrity_apply_target_missing";
  error.ticket_id = finding?.ticket_id || null;
  error.tenant_id = finding?.tenant_id || null;
  return error;
}

function effectiveFindingFromLockedRow(finding, row, now = new Date()) {
  const lifecycle = resolveSupportTicketLifecyclePatch(row);
  const effectiveRow = {
    ...row,
    status: lifecycle.status || row.status,
    lifecycle_state: lifecycle.lifecycle_state || row.lifecycle_state,
    customer_status: lifecycle.customer_status || row.customer_status,
  };
  const sla = computeSupportTicketSlaStatusV2(effectiveRow, now);
  const currentSlaStatus = normalizeLower(row.sla_status, "on_track");
  return {
    ...finding,
    lifecycle,
    sla: {
      current_status: currentSlaStatus,
      computed_status: sla.status,
      reason: sla.reason,
      should_update: currentSlaStatus !== sla.status,
      breached_milestones: sla.breached_milestones,
      warning_milestones: sla.warning_milestones,
    },
    should_update: Boolean(
      finding.should_update
      || lifecycle.should_update
      || currentSlaStatus !== sla.status
    ),
    secrets_included: false,
  };
}

export async function reconcileSupportTicketIntegrityWithEffectiveLifecycle(input = {}, options = {}) {
  const apply = Boolean(input.apply);
  const planReconciliation = options.planReconciliationFn || planSupportTicketIntegrityReconciliation;
  const { planReconciliationFn: _injectedPlan, ...serviceOptions } = options;
  const plan = await planReconciliation({ ...input, apply: false }, serviceOptions);
  const plannedFindings = (plan.findings || []).map(normalizeReconciliationFindingForEffectiveLifecycle);
  const baseResult = {
    ...plan,
    mode: apply ? "apply" : "dry_run",
    findings: plannedFindings,
    update_count: plannedFindings.filter((finding) => finding.should_update).length,
    secrets_included: false,
  };
  if (!apply) return baseResult;
  if (!plan.schema?.ready) throw schemaNotReadyError(plan.schema);

  const pool = options.pool || getPool();
  const connection = await pool.getConnection();
  const actorId = input.actor_id || "support_ticket_integrity_reconciler";
  const actorType = input.actor_type || "system";
  const appliedFindings = [];
  let transactionStarted = false;
  try {
    await connection.beginTransaction();
    transactionStarted = true;
    for (const plannedFinding of plannedFindings.filter((finding) => finding.should_update)) {
      const [lockedRows] = await connection.query(
        `SELECT status,
                lifecycle_state,
                customer_status,
                sla_status,
                first_response_due_at,
                first_response_at,
                triage_due_at,
                triaged_at,
                resolution_due_at,
                last_seen_at,
                updated_at,
                created_at
           FROM tickets
          WHERE tenant_id = ? AND ticket_id = ?
          FOR UPDATE`,
        [plannedFinding.tenant_id, plannedFinding.ticket_id],
      );
      const [lockedRow = null] = lockedRows;
      if (!lockedRow) throw targetMissingError(plannedFinding);
      const finding = effectiveFindingFromLockedRow(plannedFinding, lockedRow);
      if (!finding.should_update) {
        appliedFindings.push(finding);
        continue;
      }
      const [updateResult] = await connection.query(
        `UPDATE tickets
            SET status = ?,
                lifecycle_state = ?,
                customer_status = ?,
                sla_status = ?,
                last_seen_at = COALESCE(last_seen_at, updated_at, created_at, NOW()),
                first_response_at = COALESCE(first_response_at, ?),
                triaged_at = COALESCE(triaged_at, ?),
                is_test = ?,
                environment = ?,
                visibility_class = ?,
                target_capability = COALESCE(?, target_capability),
                parent_ticket_id = COALESCE(?, parent_ticket_id),
                related_ticket_id = COALESCE(?, related_ticket_id),
                supersedes_ticket_id = COALESCE(?, supersedes_ticket_id),
                updated_at = NOW()
          WHERE tenant_id = ? AND ticket_id = ?`,
        [
          finding.lifecycle.status || lockedRow.status,
          finding.lifecycle.lifecycle_state || lockedRow.lifecycle_state,
          finding.lifecycle.customer_status || lockedRow.customer_status,
          finding.sla.computed_status,
          finding.milestone_evidence?.first_response_at || null,
          finding.milestone_evidence?.triaged_at || null,
          finding.integrity?.is_test ? 1 : 0,
          finding.integrity?.environment || "production",
          finding.integrity?.visibility_class || "customer_visible",
          finding.integrity?.target_capability || null,
          finding.integrity?.parent_ticket_id || null,
          finding.integrity?.related_ticket_id || null,
          finding.integrity?.supersedes_ticket_id || null,
          finding.tenant_id,
          finding.ticket_id,
        ],
      );
      if (Number(updateResult?.affectedRows || 0) !== 1) throw targetMissingError(finding);
      await connection.query(
        `INSERT INTO ticket_lifecycle_events
           (event_id, ticket_id, tenant_id, event_type, from_state, to_state, actor_id, actor_type, visibility, summary, payload_json)
         VALUES (UUID(), ?, ?, 'integrity_reconciled', ?, ?, ?, ?, 'internal_support', ?, ?)`,
        [
          finding.ticket_id,
          finding.tenant_id,
          lockedRow.lifecycle_state || null,
          finding.lifecycle.lifecycle_state || lockedRow.lifecycle_state || null,
          actorId,
          actorType,
          `Ticket integrity reconciled: SLA ${finding.sla.computed_status}; lifecycle ${finding.lifecycle.reason}.`,
          JSON.stringify({
            sla: finding.sla,
            lifecycle: finding.lifecycle,
            integrity: finding.integrity,
            milestone_evidence: finding.milestone_evidence,
            backfill_last_seen_at: finding.backfill_last_seen_at,
            urgent_unassigned: finding.urgent_unassigned,
            secrets_included: false,
          }),
        ],
      );
      appliedFindings.push(finding);
    }
    await connection.commit();
    transactionStarted = false;
    const appliedById = new Map(appliedFindings.map((finding) => [finding.ticket_id, finding]));
    const finalFindings = plannedFindings.map((finding) => appliedById.get(finding.ticket_id) || finding);
    return {
      ...baseResult,
      findings: finalFindings,
      update_count: appliedFindings.filter((finding) => finding.should_update).length,
      applied_update_count: appliedFindings.filter((finding) => finding.should_update).length,
      secrets_included: false,
    };
  } catch (error) {
    if (transactionStarted) {
      try { await connection.rollback(); } catch { /* preserve primary failure */ }
    }
    throw error;
  } finally {
    connection.release();
  }
}
