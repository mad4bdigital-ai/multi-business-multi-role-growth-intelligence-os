import assert from "node:assert/strict";
import {
  canViewSupportTicketResolution,
  classifySupportTicketResolution,
  ensureSupportTicketResolutionCase,
  _testingSupportTicketResolutionService,
} from "./supportTicketResolutionService.js";

const connector = classifySupportTicketResolution({
  ticket_type: "connector_unreachable",
  severity: "sev2",
});
assert.equal(connector.problem_type, "connector");
assert.equal(connector.playbook_key, "connector_health_repair_v1");
assert.equal(connector.severity, "high");
assert.equal(classifySupportTicketResolution({ category: "billing" }).problem_type, "billing");
assert.equal(
  classifySupportTicketResolution({ source_event: "hostinger_wordpress_provisioning" }).playbook_key,
  "wordpress_site_doctor_v1"
);
assert.equal(
  classifySupportTicketResolution({ ticket_type: "unknown_type" }).playbook_key,
  "tenant_resolution_triage_v1"
);

assert.equal(canViewSupportTicketResolution({ tenant_role: "admin" }), true);
assert.equal(canViewSupportTicketResolution({ tenant_role: "owner" }), true);
assert.equal(canViewSupportTicketResolution({ tenant_role: "manager" }), false);
assert.equal(canViewSupportTicketResolution({ tenant_role: "member" }), false);
assert.equal(canViewSupportTicketResolution({ is_platform_admin: true }), true);

assert.equal(
  _testingSupportTicketResolutionService.ticketEscalationEvidence({
    metadata_json: { case_status: "escalated", current_step: "diagnostic_escalated" },
  }).escalated,
  true,
);
assert.equal(
  _testingSupportTicketResolutionService.ticketEscalationEvidence({
    metadata_json: { resolution: { case_status: "escalated" } },
  }).escalated,
  true,
);
assert.equal(
  _testingSupportTicketResolutionService.ticketEscalationEvidence({
    category: "support",
    lifecycle_state: "triage_pending",
  }).escalated,
  false,
);

const statements = [];
const connection = {
  async query(sql, params = []) {
    statements.push({ sql, params });
    if (sql.includes("FROM tenant_resolution_playbooks")) {
      return [[{
        playbook_key: "tenant_resolution_triage_v1",
        root_family: "general_operational_review",
        display_name: "Governed support ticket triage",
        risk_level: "medium",
        approval_required: 1,
        readback_required: 1,
        tenant_visible: 1,
        status: "active",
      }]];
    }
    if (sql.includes("FROM tenant_resolution_cases")) return [[]];
    return [{ affectedRows: 1 }];
  },
};

const linked = await ensureSupportTicketResolutionCase({
  connection,
  ticket: {
    ticket_id: "ticket_123",
    tenant_id: "tenant_123",
    ticket_type: "workflow_failed",
    severity: "sev2",
    title: "Workflow failed",
    internal_summary: "A governed workflow failed during execution.",
  },
});
assert.equal(linked.created, true);
assert.equal(linked.summary.available, true);
assert.equal(linked.summary.problem_type, "workflow");
assert.equal(linked.summary.playbook_key, "tenant_resolution_triage_v1");
assert.equal(linked.summary.required_role, "tenant_admin_or_owner_or_platform_admin");
assert.equal(linked.operational_alert.required, false);
assert.ok(statements.some(({ sql }) => sql.includes("INSERT INTO tenant_resolution_cases")));
assert.ok(statements.some(({ sql }) => sql.includes("INSERT INTO tenant_resolution_case_events")));
assert.equal(statements.some(({ sql }) => sql.includes("INSERT INTO operational_alerts")), false);

const escalationStatements = [];
const escalationConnection = {
  async query(sql, params = []) {
    escalationStatements.push({ sql: String(sql), params: [...params] });
    if (String(sql).includes("FROM tenant_resolution_playbooks")) {
      return [[{
        playbook_key: "tenant_resolution_triage_v1",
        root_family: "general_operational_review",
        display_name: "Governed support ticket triage",
        risk_level: "medium",
        approval_required: 1,
        readback_required: 1,
        tenant_visible: 1,
        status: "active",
      }]];
    }
    if (String(sql).includes("information_schema.columns")) return [[{ present: 1 }]];
    if (String(sql).includes("information_schema.tables")) return [[{ present: 1 }]];
    if (String(sql).includes("FROM tenant_resolution_cases")) return [[]];
    return [{ affectedRows: 1 }];
  },
};

const escalated = await ensureSupportTicketResolutionCase({
  connection: escalationConnection,
  ticket: {
    ticket_id: "ticket_escalated_1",
    tenant_id: "tenant_123",
    user_id: "user_123",
    ticket_type: "tenant_onboarding_issue",
    category: "escalation",
    severity: "sev2",
    queue_key: "tenant_support",
    lifecycle_state: "triage_pending",
    title: "Tenant runtime blockers require escalation",
    internal_summary: "Resolution metadata was escalated but the legacy ticket had no operational attention record.",
    occurrence_count: 5,
    metadata_json: {
      case_status: "escalated",
      current_step: "diagnostic_escalated",
    },
  },
});
assert.equal(escalated.created, true);
assert.equal(escalated.operational_alert.required, true);
assert.equal(escalated.operational_alert.available, true);
assert.equal(escalated.operational_alert.created_or_refreshed, true);
assert.match(escalated.operational_alert.alert_key, /^support\.ticket\.escalation\./);
const alertInsert = escalationStatements.find(({ sql }) => sql.includes("INSERT INTO operational_alerts"));
assert(alertInsert, "escalated tickets must create or refresh an operational alert in the same transaction boundary");
assert.match(alertInsert.sql, /ON DUPLICATE KEY UPDATE/);
assert.match(alertInsert.sql, /support_ticket_escalated/);
assert.equal(alertInsert.params.at(-1), 5, "ticket recurrence count must carry into alert evidence without duplicate alert rows");
assert.equal(alertInsert.sql.includes("operational_alert_notification_outbox"), false, "resolution bridging must not enqueue external/in-app notification delivery as a side effect");

await assert.rejects(
  ensureSupportTicketResolutionCase({
    connection: { async query() { return [[]]; } },
    ticket: {
      ticket_id: "ticket_missing",
      tenant_id: "tenant_123",
      ticket_type: "general_support",
    },
  }),
  (error) => error.code === "support_ticket_resolution_playbook_unavailable"
    && error.status === 422
);

console.log("support ticket resolution service tests passed");
