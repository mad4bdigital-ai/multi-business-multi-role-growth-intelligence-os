#!/usr/bin/env node
import { getPool } from "../db.js";
import {
  SUPPORT_TICKET_RESOLUTION_RECONCILIATION_CONFIRMATION,
  applySupportTicketResolutionReconciliation,
  assertSupportTicketResolutionReconciliationApplyAllowed,
  buildSupportTicketResolutionReconciliationPlan,
} from "../supportTicketResolutionReconciliation.js";

function parseArgs(argv = []) {
  const args = { apply: false, confirm: null, limit: 100 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--dry-run") args.apply = false;
    else if (arg === "--confirm") {
      args.confirm = argv[index + 1] || null;
      index += 1;
    } else if (arg === "--limit") {
      args.limit = Math.max(1, Math.min(Number(argv[index + 1] || 100), 500));
      index += 1;
    }
  }
  return args;
}

async function loadSnapshot(pool, limit) {
  const [tickets] = await pool.query(
    `SELECT ticket_id, tenant_id, user_id, title, ticket_type, category, priority, severity,
            status, lifecycle_state, customer_status, queue_key, source_event,
            occurrence_count, customer_message, internal_summary, metadata_json,
            created_at, updated_at, last_seen_at
       FROM tickets
      WHERE status IN ('open','in_review','awaiting_approval')
      ORDER BY updated_at ASC, ticket_id ASC
      LIMIT ?`,
    [Math.max(limit * 4, limit)]
  );
  const [cases] = await pool.query(
    `SELECT case_id, tenant_id, resource_ref, status, updated_at
       FROM tenant_resolution_cases
      WHERE resource_ref LIKE 'ticket://%'
      ORDER BY updated_at DESC
      LIMIT ?`,
    [Math.max(limit * 8, limit)]
  );
  const [alerts] = await pool.query(
    `SELECT alert_key, tenant_id, source_type, source_ref, source_record_id,
            lifecycle_status, updated_at
       FROM operational_alerts
      WHERE source_type = 'support_ticket'
      ORDER BY updated_at DESC
      LIMIT ?`,
    [Math.max(limit * 8, limit)]
  );
  return { tickets, cases, alerts };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const gate = assertSupportTicketResolutionReconciliationApplyAllowed(args);
  const pool = getPool();
  const snapshot = await loadSnapshot(pool, args.limit);
  const plan = buildSupportTicketResolutionReconciliationPlan({ ...snapshot, limit: args.limit });
  const response = {
    ok: plan.ok,
    mode: gate.mode,
    required_confirmation: gate.allowed ? undefined : SUPPORT_TICKET_RESOLUTION_RECONCILIATION_CONFIRMATION,
    plan,
    snapshot: {
      open_tickets_scanned: snapshot.tickets.length,
      resolution_cases_scanned: snapshot.cases.length,
      support_alerts_scanned: snapshot.alerts.length,
    },
    safety: {
      dry_run_default: true,
      canonical_resolution_service_only: true,
      provider_calls_allowed: false,
      credential_payload_reads_allowed: false,
      external_sends_allowed: false,
      external_writes_allowed: false,
      deletes_allowed: false,
      secrets_included: false,
    },
    secrets_included: false,
  };

  if (gate.allowed && plan.candidate_count > 0) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      response.apply = await applySupportTicketResolutionReconciliation({
        connection,
        tickets: snapshot.tickets,
        plan,
      });
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  await pool.end();
  console.log(JSON.stringify(response, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    code: error.code || "SUPPORT_TICKET_RESOLUTION_RECONCILIATION_FAILED",
    message: error.message,
    secrets_included: false,
  }, null, 2));
  process.exit(1);
});
