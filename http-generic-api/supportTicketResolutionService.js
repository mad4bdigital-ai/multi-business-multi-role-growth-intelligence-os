import { createHash, randomUUID } from "node:crypto";
import { getPool } from "./db.js";

const REQUIRED_ROLE = "tenant_admin_or_owner_or_platform_admin";
const GENERAL_TRIAGE = Object.freeze({
  root_family: "general_operational_review",
  playbook_key: "tenant_resolution_triage_v1",
});
const SENSITIVE_KEY_PATTERN = /(secret|credential|token|password|private_key|cipher|api_key|authorization|cookie|payload_json|raw_prompt|system_prompt)/i;

const TYPE_MAP = Object.freeze({
  brand_authority_missing: { problem_type: "access_and_permissions", ...GENERAL_TRIAGE },
  access_mapping_issue: { problem_type: "access_and_permissions", ...GENERAL_TRIAGE },
  resource_not_visible: { problem_type: "access_and_permissions", ...GENERAL_TRIAGE },
  permission_denied: { problem_type: "access_and_permissions", ...GENERAL_TRIAGE },
  approval_required: { problem_type: "access_and_permissions", ...GENERAL_TRIAGE },
  connector_unreachable: {
    problem_type: "connector",
    root_family: "connector_runtime_readiness",
    playbook_key: "connector_health_repair_v1",
  },
  credential_required: {
    problem_type: "credentials",
    root_family: "connector_runtime_readiness",
    playbook_key: "connector_health_repair_v1",
  },
  workflow_failed: { problem_type: "workflow", ...GENERAL_TRIAGE },
  tenant_onboarding_issue: { problem_type: "tenant_onboarding", ...GENERAL_TRIAGE },
  platform_tool_surface_bug: { problem_type: "platform_bug", ...GENERAL_TRIAGE },
  managed_service_request: { problem_type: "managed_service", ...GENERAL_TRIAGE },
  general_support: { problem_type: "general_support", ...GENERAL_TRIAGE },
});

function safeString(value = "", max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function sha256(value = "") {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function sanitizeValue(value, depth = 0) {
  if (depth > 5) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeValue(item, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SENSITIVE_KEY_PATTERN.test(key))
        .slice(0, 60)
        .map(([key, item]) => [key, sanitizeValue(item, depth + 1)])
    );
  }
  return typeof value === "string" ? value.slice(0, 2000) : value;
}

function normalizeCaseSeverity(value = "sev3") {
  return ({ sev1: "critical", sev2: "high", sev3: "medium", sev4: "low" })[
    safeString(value).toLowerCase()
  ] || "medium";
}

function classificationText(ticket = {}) {
  const metadata = typeof ticket.metadata_json === "string"
    ? ticket.metadata_json
    : JSON.stringify(ticket.metadata_json || {});
  const resource = typeof ticket.resource === "object"
    ? JSON.stringify(ticket.resource)
    : "";
  return [
    ticket.ticket_type,
    ticket.source_event,
    ticket.queue_key,
    ticket.category,
    ticket.title,
    ticket.internal_summary,
    metadata,
    resource,
  ].map((value) => safeString(value, 4000).toLowerCase()).join(" ");
}

export function classifySupportTicketResolution(ticket = {}) {
  const text = classificationText(ticket);
  let classification = null;

  if (/wordpress|wpml|hostinger|hpanel|site health/.test(text)) {
    classification = {
      problem_type: "wordpress_site",
      root_family: "wordpress_site_health",
      playbook_key: "wordpress_site_doctor_v1",
    };
  } else if (/skill approval|tenant_skill|agent skill|skill grant/.test(text)) {
    classification = {
      problem_type: "tenant_skill_approval",
      root_family: "tenant_skill_approval",
      playbook_key: "tenant_skill_approval_decision_v1",
    };
  } else if (/task source|source quality|task_source/.test(text)) {
    classification = {
      problem_type: "task_source_quality",
      root_family: "task_source_quality",
      playbook_key: "task_source_repair_v1",
    };
  } else if (/google ads|ads setup|provider_setup_ads/.test(text)) {
    classification = {
      problem_type: "provider_setup_ads",
      root_family: "provider_setup_ads",
      playbook_key: "google_ads_setup_preflight_v1",
    };
  }

  const ticketType = safeString(
    ticket.ticket_type || ticket.issue_type || ticket.source_event,
    128
  ).toLowerCase();
  classification ||= TYPE_MAP[ticketType] || null;

  if (!classification && safeString(ticket.category).toLowerCase() === "billing") {
    classification = { problem_type: "billing", ...GENERAL_TRIAGE };
  }
  if (!classification && /connector|credential|oauth|connection/.test(text)) {
    classification = {
      problem_type: /credential|oauth/.test(text) ? "credentials" : "connector",
      root_family: "connector_runtime_readiness",
      playbook_key: "connector_health_repair_v1",
    };
  }
  classification ||= { problem_type: "general_support", ...GENERAL_TRIAGE };

  return {
    ...classification,
    severity: normalizeCaseSeverity(ticket.severity),
    required_role: REQUIRED_ROLE,
    solution_availability: "playbook_required",
    classification_version: "support-ticket-resolution-v1",
    secrets_included: false,
  };
}

export function canViewSupportTicketResolution({
  tenant_role = null,
  is_platform_admin = false,
} = {}) {
  return is_platform_admin === true
    || ["admin", "owner"].includes(safeString(tenant_role).toLowerCase());
}

function resolutionSummary({ classification, playbook, row = null, created = false }) {
  return {
    available: Boolean(playbook),
    solution_availability: playbook ? "available" : "unavailable",
    problem_type: classification.problem_type,
    root_family: classification.root_family,
    playbook_key: classification.playbook_key,
    required_role: REQUIRED_ROLE,
    case_id: row?.case_id || null,
    case_status: row?.status || null,
    current_step_key: row?.current_step_key || null,
    readback_status: row?.readback_status || "not_run",
    risk_level: playbook?.risk_level || null,
    approval_required: playbook?.approval_required === 1
      || playbook?.approval_required === true,
    readback_required: playbook
      ? playbook.readback_required !== 0 && playbook.readback_required !== false
      : true,
    created,
    secrets_included: false,
  };
}

async function selectPlaybook(connection, classification) {
  const [rows] = await connection.query(
    `SELECT playbook_key, root_family, display_name, description,
            required_capability_key, risk_level, diagnostic_tool_key,
            decision_tool_key, apply_tool_key, readback_tool_key,
            approval_required, readback_required, status, tenant_visible,
            policy_json
       FROM tenant_resolution_playbooks
      WHERE playbook_key = ?
        AND root_family = ?
        AND status = 'active'
        AND tenant_visible = 1
      LIMIT 1`,
    [classification.playbook_key, classification.root_family]
  );
  return rows[0] || null;
}

export async function ensureSupportTicketResolutionCase({
  connection,
  ticket = {},
  actor_id = "support_ticket_resolution_router",
} = {}) {
  if (!connection || typeof connection.query !== "function") {
    const error = new Error(
      "A transaction connection is required to link a support ticket resolution case."
    );
    error.status = 500;
    error.code = "support_ticket_resolution_connection_required";
    throw error;
  }

  const classification = classifySupportTicketResolution(ticket);
  const playbook = await selectPlaybook(connection, classification);
  if (!playbook) {
    const error = new Error(
      "No active tenant-visible resolution playbook is available for this support problem."
    );
    error.status = 422;
    error.code = "support_ticket_resolution_playbook_unavailable";
    error.details = {
      root_family: classification.root_family,
      playbook_key: classification.playbook_key,
    };
    throw error;
  }

  const resourceRef = `ticket://${ticket.ticket_id}`;
  const fingerprint = sha256([
    ticket.tenant_id,
    ticket.ticket_id,
    classification.problem_type,
    classification.playbook_key,
  ].join("|"));
  const activeCaseKey = `case.${sha256([
    ticket.tenant_id,
    resourceRef,
    classification.root_family,
    classification.playbook_key,
    fingerprint,
  ].join("|"))}`;

  const [existingRows] = await connection.query(
    `SELECT *
       FROM tenant_resolution_cases
      WHERE tenant_id = ?
        AND (active_case_key = ? OR resource_ref = ?)
      ORDER BY created_at DESC
      LIMIT 1`,
    [ticket.tenant_id, activeCaseKey, resourceRef]
  );
  const existing = existingRows[0] || null;
  if (existing) {
    return {
      ok: true,
      created: false,
      classification,
      summary: resolutionSummary({
        classification,
        playbook,
        row: existing,
        created: false,
      }),
      secrets_included: false,
    };
  }

  const caseId = randomUUID();
  await connection.query(
    `INSERT INTO tenant_resolution_cases (
       case_id, tenant_id, workspace_id, resource_ref, root_family,
       playbook_key, status, severity, root_fingerprint_sha256,
       active_case_key, source_alert_keys_json, source_refs_json,
       impact_summary, current_step_key, owner_user_id, readback_status,
       secrets_included
     ) VALUES (?, ?, NULL, ?, ?, ?, 'detected', ?, ?, ?, ?, ?, ?,
               'case_created', NULL, 'not_run', 0)`,
    [
      caseId,
      ticket.tenant_id,
      resourceRef,
      classification.root_family,
      classification.playbook_key,
      classification.severity,
      fingerprint,
      activeCaseKey,
      JSON.stringify([
        safeString(ticket.ticket_type || ticket.source_event || classification.problem_type, 191),
      ]),
      JSON.stringify([resourceRef]),
      safeString(ticket.internal_summary || ticket.customer_message || ticket.title, 2000)
        || null,
    ]
  );

  await connection.query(
    `INSERT INTO tenant_resolution_case_events (
       event_id, case_id, event_type, actor_type, actor_id, from_status,
       to_status, evidence_ref, event_json, secrets_included
     ) VALUES (?, ?, 'case_created', 'system', ?, NULL, 'detected', ?, ?, 0)`,
    [
      randomUUID(),
      caseId,
      actor_id,
      resourceRef,
      JSON.stringify({
        ticket_id: ticket.ticket_id,
        problem_type: classification.problem_type,
        classification_version: classification.classification_version,
        provider_call_allowed: false,
        external_write_allowed: false,
        repair_apply_allowed: false,
        secrets_included: false,
      }),
    ]
  );

  return {
    ok: true,
    created: true,
    classification,
    summary: resolutionSummary({
      classification,
      playbook,
      row: {
        case_id: caseId,
        status: "detected",
        current_step_key: "case_created",
        readback_status: "not_run",
      },
      created: true,
    }),
    secrets_included: false,
  };
}

export async function getSupportTicketResolution({
  tenant_id,
  ticket_id,
  pool = getPool(),
} = {}) {
  const [ticketRows] = await pool.query(
    `SELECT * FROM tickets WHERE tenant_id = ? AND ticket_id = ? LIMIT 1`,
    [tenant_id, ticket_id]
  );
  const ticket = ticketRows[0] || null;
  if (!ticket) return null;

  const classification = classifySupportTicketResolution(ticket);
  const [rows] = await pool.query(
    `SELECT c.*, p.display_name, p.description, p.required_capability_key,
            p.risk_level, p.diagnostic_tool_key, p.decision_tool_key,
            p.apply_tool_key, p.readback_tool_key, p.approval_required,
            p.readback_required, p.policy_json
       FROM tenant_resolution_cases c
       JOIN tenant_resolution_playbooks p
         ON p.playbook_key = c.playbook_key
        AND p.root_family = c.root_family
      WHERE c.tenant_id = ?
        AND c.resource_ref = ?
      ORDER BY c.created_at DESC
      LIMIT 1`,
    [tenant_id, `ticket://${ticket_id}`]
  );
  const row = rows[0] || null;

  if (!row) {
    const playbook = await selectPlaybook(pool, classification);
    return {
      ...resolutionSummary({ classification, playbook, row: null, created: false }),
      solution_availability: playbook ? "playbook_available_case_missing" : "unavailable",
      solution: playbook ? {
        display_name: playbook.display_name,
        description: playbook.description || null,
        required_capability_key: playbook.required_capability_key || null,
        policy: sanitizeValue(parseJson(playbook.policy_json, {})),
        secrets_included: false,
      } : null,
      secrets_included: false,
    };
  }

  return {
    ...resolutionSummary({ classification, playbook: row, row, created: false }),
    solution: {
      display_name: row.display_name,
      description: row.description || null,
      required_capability_key: row.required_capability_key || null,
      diagnostic_tool_key: row.diagnostic_tool_key || null,
      decision_tool_key: row.decision_tool_key || null,
      apply_tool_key: row.apply_tool_key || null,
      readback_tool_key: row.readback_tool_key || null,
      policy: sanitizeValue(parseJson(row.policy_json, {})),
      secrets_included: false,
    },
    secrets_included: false,
  };
}

export const _testingSupportTicketResolutionService = {
  sanitizeValue,
  normalizeCaseSeverity,
  classificationText,
  resolutionSummary,
};
