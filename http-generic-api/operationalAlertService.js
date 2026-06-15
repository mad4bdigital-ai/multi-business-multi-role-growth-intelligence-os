import { createHash, randomUUID } from "node:crypto";
import { getPool } from "./db.js";

const SENSITIVE_KEY_PATTERN = /(secret|credential|token|password|private_key|cipher|api_key|value_ciphertext|system_prompt|raw_prompt|payload_json)/i;
const SEVERITY_WEIGHT = Object.freeze({ critical: 5, high: 4, medium: 3, low: 2, info: 1 });
const VERIFICATION_WEIGHT = Object.freeze({ verified: 4, observed: 3, unverified: 2, not_reproduced: 1 });
const OPEN_LIFECYCLE_STATES = Object.freeze(["open", "acknowledged", "investigating"]);
const ALLOWED_LIFECYCLE_STATES = new Set(["open", "acknowledged", "investigating", "resolved", "ignored"]);
const KNOWN_ISSUE_KEYS = Object.freeze([
  "known.pr_checks_manual_dispatch",
  "known.deploy_operation_intent_mismatch",
  "known.db_update_result_serialization",
  "known.capability_envelope_lifecycle_tool_gap",
  "known.hostinger_restart_transient_503",
  "known.main_sha_pin_race",
  "known.process_local_feature_flag_scope",
  "known.response_chunk_cache_expiry",
  "known.transient_error_envelope_inconsistency",
  "known.repo_patch_exact_match_fragility",
  "known.github_rest_fallback_coverage_gap",
]);

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boundedInt(value, fallback, min, max) {
  return Math.max(min, Math.min(max, Math.floor(safeNumber(value, fallback))));
}

function compactError(error, fallback = "operational_alert_source_failed") {
  return {
    code: error?.code || fallback,
    message: error?.message || String(error || fallback),
  };
}

function sanitizeEvidence(value, depth = 0) {
  if (depth > 5) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeEvidence(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SENSITIVE_KEY_PATTERN.test(key))
        .slice(0, 80)
        .map(([key, item]) => [key, sanitizeEvidence(item, depth + 1)])
    );
  }
  if (typeof value === "string") return value.slice(0, 4000);
  return value;
}

function isoValue(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function sha256(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function deterministicAlertKey(parts = []) {
  return `alert.${sha256(parts.map((part) => String(part ?? "")).join("|"))}`;
}

function resolveSubject(sessionContext = {}, explicit = {}) {
  const subject = sessionContext?.subject || {};
  const principal = sessionContext?.platform_access?.principal || {};
  const isAdmin = explicit.is_admin === true
    || subject.is_admin === true
    || principal.is_admin === true
    || sessionContext?.platform_access?.access_scope === "platform_admin_all";
  return {
    is_admin: isAdmin,
    tenant_id: explicit.tenant_id || subject.tenant_id || principal.tenant_id || null,
    user_id: explicit.user_id || subject.user_id || principal.user_id || null,
    auth_mode: explicit.auth_mode || principal.type || principal.auth_mode || null,
  };
}

async function safeRows(source, sql, params = [], pool = getPool()) {
  try {
    const [rows] = await pool.query(sql, params);
    return { source, ok: true, rows: Array.isArray(rows) ? rows : [] };
  } catch (error) {
    return { source, ok: false, rows: [], error: compactError(error) };
  }
}

function candidate({
  alertKey = null,
  sourceType,
  sourceRef = null,
  sourceRecordId = null,
  tenantId = null,
  userId = null,
  workspaceId = null,
  containerKey = null,
  category = "operational",
  severity = "medium",
  title,
  summary = null,
  reasonCode,
  lifecycleStatus = "open",
  verificationState = "observed",
  evidenceType = null,
  evidenceRef = null,
  evidence = null,
  executionLogId = null,
  traceId = null,
  occurrenceCount = 1,
  firstSeenAt = null,
  lastSeenAt = null,
  recommendedActionKey = null,
  requiresConfirmation = false,
  manualKnownIssue = false,
  persisted = false,
  alertId = null,
} = {}) {
  const stableKey = alertKey || deterministicAlertKey([
    sourceType,
    tenantId || "global",
    workspaceId || "no_workspace",
    reasonCode,
    sourceRecordId || title,
  ]);
  return {
    alert_id: alertId,
    alert_key: stableKey,
    fingerprint_sha256: sha256(stableKey),
    source_type: sourceType,
    source_ref: sourceRef,
    source_record_id: sourceRecordId === null || sourceRecordId === undefined ? null : String(sourceRecordId),
    tenant_id: tenantId,
    user_id: userId,
    workspace_id: workspaceId,
    container_key: containerKey,
    category,
    severity: SEVERITY_WEIGHT[severity] ? severity : "medium",
    title: String(title || reasonCode || "Operational issue").slice(0, 512),
    summary: summary ? String(summary).slice(0, 4000) : null,
    reason_code: reasonCode,
    lifecycle_status: ALLOWED_LIFECYCLE_STATES.has(lifecycleStatus) ? lifecycleStatus : "open",
    verification_state: VERIFICATION_WEIGHT[verificationState] ? verificationState : "observed",
    evidence_type: evidenceType || sourceType,
    evidence_ref: evidenceRef || sourceRef,
    evidence: sanitizeEvidence(evidence || {}),
    execution_log_id: executionLogId === null || executionLogId === undefined ? null : safeNumber(executionLogId),
    trace_id: traceId || null,
    occurrence_count: Math.max(safeNumber(occurrenceCount, 1), 1),
    first_seen_at: isoValue(firstSeenAt || lastSeenAt || new Date()),
    last_seen_at: isoValue(lastSeenAt || firstSeenAt || new Date()),
    recommended_action_key: recommendedActionKey,
    requires_confirmation: requiresConfirmation === true,
    manual_known_issue: manualKnownIssue === true,
    persisted: persisted === true,
    secrets_included: false,
  };
}

function tenantPredicate(subject, alias = "") {
  const prefix = alias ? `${alias}.` : "";
  return subject.is_admin
    ? { sql: "1 = 1", params: [] }
    : { sql: `${prefix}tenant_id = ?`, params: [subject.tenant_id || "__missing_tenant__"] };
}

function userTenantPredicate(subject, alias = "") {
  const prefix = alias ? `${alias}.` : "";
  return subject.is_admin
    ? { sql: "1 = 1", params: [] }
    : {
        sql: `(${prefix}tenant_id = ? OR ${prefix}user_id = ?)`,
        params: [subject.tenant_id || "__missing_tenant__", subject.user_id || "__missing_user__"],
      };
}

function groupExecutionRows(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const key = [
      row.tenant_id || "global",
      row.workspace_id || "no_workspace",
      row.execution_status || "unknown",
      row.entry_type || "execution",
      row.app_key || "no_app",
      row.workflow_key || row.workflow_id || "no_workflow",
      row.route_status || "no_route_status",
    ].join("|");
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        ...row,
        occurrence_count: 1,
        first_seen_at: row.created_at,
        last_seen_at: row.created_at,
        latest_id: row.id,
      });
      continue;
    }
    existing.occurrence_count += 1;
    if (new Date(row.created_at) < new Date(existing.first_seen_at)) existing.first_seen_at = row.created_at;
    if (new Date(row.created_at) >= new Date(existing.last_seen_at)) {
      existing.last_seen_at = row.created_at;
      existing.latest_id = row.id;
      existing.execution_trace_id_writeback = row.execution_trace_id_writeback;
      existing.recovery_status = row.recovery_status;
      existing.recovery_notes = row.recovery_notes;
    }
  }
  return [...groups.values()];
}

function executionSeverity(status) {
  if (["failed", "blocked", "blocked_with_choice_required"].includes(status)) return "critical";
  if (["degraded", "success_with_warnings", "passed_with_follow_up"].includes(status)) return "high";
  return "medium";
}

function mapExecutionAlerts(rows = []) {
  return groupExecutionRows(rows).map((row) => {
    const status = row.execution_status || "unknown";
    const identity = row.workflow_key || row.workflow_id || row.app_key || row.entry_type || "execution";
    return candidate({
      sourceType: "execution_log",
      sourceRef: `execution-log://${row.latest_id}`,
      sourceRecordId: [status, row.entry_type, row.app_key, row.workflow_key || row.workflow_id, row.route_status].filter(Boolean).join(":"),
      tenantId: row.tenant_id,
      userId: row.user_id,
      workspaceId: row.workspace_id,
      containerKey: row.workspace_id ? `workspace:${row.workspace_id}` : null,
      category: "execution",
      severity: executionSeverity(status),
      title: `${identity} execution is ${status}`,
      summary: row.recovery_notes || `Observed ${row.occurrence_count} matching execution result(s) in the selected lookback window.`,
      reasonCode: `execution_${status}`,
      verificationState: "verified",
      evidenceType: "execution_log",
      evidenceRef: `execution-log://${row.latest_id}`,
      executionLogId: row.latest_id,
      traceId: row.execution_trace_id_writeback,
      occurrenceCount: row.occurrence_count,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      recommendedActionKey: status === "blocked_with_choice_required" ? "execution.review_choice" : "execution.review_failure",
      requiresConfirmation: status === "blocked_with_choice_required",
      evidence: {
        entry_type: row.entry_type,
        execution_class: row.execution_class,
        execution_status: status,
        recovery_status: row.recovery_status,
        route_status: row.route_status,
        brand_key: row.brand_key,
        app_key: row.app_key,
        agent_key: row.agent_key,
        skill_key: row.skill_key,
        workflow_key: row.workflow_key,
        engine_key: row.engine_key,
        logic_key: row.logic_key,
      },
    });
  });
}

function mapPersistedAlert(row) {
  let evidence = row.evidence_json;
  if (typeof evidence === "string") {
    try { evidence = JSON.parse(evidence); } catch { evidence = {}; }
  }
  return candidate({
    alertId: row.alert_id,
    alertKey: row.alert_key,
    sourceType: row.source_type,
    sourceRef: row.source_ref,
    sourceRecordId: row.source_record_id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    containerKey: row.container_key,
    category: row.category,
    severity: row.severity,
    title: row.title,
    summary: row.summary,
    reasonCode: row.reason_code,
    lifecycleStatus: row.lifecycle_status,
    verificationState: row.verification_state,
    evidenceType: row.evidence_type,
    evidenceRef: row.evidence_ref,
    evidence,
    executionLogId: row.execution_log_id,
    traceId: row.trace_id,
    occurrenceCount: row.occurrence_count,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    recommendedActionKey: row.recommended_action_key,
    requiresConfirmation: safeNumber(row.requires_confirmation) === 1,
    manualKnownIssue: safeNumber(row.manual_known_issue) === 1,
    persisted: true,
  });
}

function mergeCandidates(items = []) {
  const merged = new Map();
  for (const item of items) {
    const current = merged.get(item.alert_key);
    if (!current) {
      merged.set(item.alert_key, { ...item });
      continue;
    }
    const persisted = current.persisted ? current : item.persisted ? item : null;
    const latest = new Date(item.last_seen_at || 0) >= new Date(current.last_seen_at || 0) ? item : current;
    const earliest = new Date(item.first_seen_at || Date.now()) <= new Date(current.first_seen_at || Date.now()) ? item : current;
    merged.set(item.alert_key, {
      ...current,
      ...latest,
      alert_id: persisted?.alert_id || current.alert_id || item.alert_id,
      lifecycle_status: persisted?.lifecycle_status || current.lifecycle_status || item.lifecycle_status,
      verification_state: VERIFICATION_WEIGHT[item.verification_state] > VERIFICATION_WEIGHT[current.verification_state]
        ? item.verification_state
        : current.verification_state,
      occurrence_count: Math.max(safeNumber(current.occurrence_count), safeNumber(item.occurrence_count)),
      first_seen_at: earliest.first_seen_at,
      last_seen_at: latest.last_seen_at,
      manual_known_issue: current.manual_known_issue || item.manual_known_issue,
      persisted: current.persisted || item.persisted,
      evidence: sanitizeEvidence({ ...(current.evidence || {}), ...(item.evidence || {}) }),
      secrets_included: false,
    });
  }
  return [...merged.values()];
}

async function collectOperationalAlertCandidates({ subject, lookbackHours = 168, includePersisted = true } = {}) {
  const tenant = tenantPredicate(subject);
  const tenantExecution = tenantPredicate(subject, "e");
  const userTenant = userTenantPredicate(subject);
  const boundedLookback = boundedInt(lookbackHours, 168, 1, 24 * 90);

  const queries = [
    safeRows(
      "execution_log",
      `SELECT e.id, e.entry_type, e.execution_class, e.execution_status, e.recovery_status,
              e.recovery_notes, e.route_status, e.execution_trace_id_writeback,
              e.tenant_id, e.workspace_id, e.user_id, e.brand_key, e.app_key,
              e.agent_key, e.skill_key, e.workflow_id, e.workflow_key,
              e.engine_key, e.logic_key, e.created_at
         FROM execution_log e
        WHERE ${tenantExecution.sql}
          AND e.created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
          AND e.execution_status IN ('failed','degraded','blocked','blocked_with_choice_required','success_with_warnings','passed_with_follow_up')
        ORDER BY e.created_at DESC
        LIMIT 1000`,
      [...tenantExecution.params, boundedLookback]
    ),
    safeRows(
      "connected_systems",
      `SELECT system_id, tenant_id, system_key, display_name, provider_family,
              connector_family, status, updated_at
         FROM connected_systems
        WHERE ${tenant.sql} AND status IN ('pending','error')
        ORDER BY FIELD(status,'error','pending'), updated_at DESC
        LIMIT 500`,
      tenant.params
    ),
    safeRows(
      "v_activation_pending_tasks",
      `SELECT task_id, task_key, title, task_type, priority, task_status,
              blocker_level, tenant_id, user_id, source_surface, due_at, updated_at
         FROM v_activation_pending_tasks
        WHERE ${userTenant.sql}
          AND (task_status = 'blocked' OR blocker_level = 'hard' OR priority IN ('critical','high'))
        ORDER BY FIELD(priority,'critical','high','medium','low'), updated_at DESC
        LIMIT 500`,
      userTenant.params
    ),
    safeRows(
      "v_activation_agent_catalog",
      `SELECT tenant_id, agent_id, agent_name, agent_display_name, health_status,
              agent_status, execution_class, execution_layer, updated_at
         FROM v_activation_agent_catalog
        WHERE ${tenant.sql} AND health_status IN ('offline','degraded')
        ORDER BY FIELD(health_status,'offline','degraded'), updated_at DESC
        LIMIT 500`,
      tenant.params
    ),
    safeRows(
      "v_activation_agent_skill_grants",
      `SELECT grant_id, tenant_id, brand_key, agent_id, agent_name, agent_display_name,
              skill_id, skill_key, skill_display_name, skill_type, skill_scope,
              requires_approval, grant_status, expires_at, granted_at
         FROM v_activation_agent_skill_grants
        WHERE ${tenant.sql} AND requires_approval = 1
        ORDER BY granted_at DESC
        LIMIT 1000`,
      tenant.params
    ),
    safeRows(
      "activation_freshness_ledger",
      `SELECT ledger_id, tenant_id, user_id, container_key, surface_key,
              provider_family, connector_family, source_ref, freshness_status,
              last_checked_at, last_success_at, last_failure_at, updated_at
         FROM activation_freshness_ledger
        WHERE ${userTenant.sql} AND freshness_status IN ('stale','failed')
        ORDER BY FIELD(freshness_status,'failed','stale'), updated_at DESC
        LIMIT 500`,
      userTenant.params
    ),
    safeRows(
      "activation_signal_inbox",
      `SELECT signal_id, tenant_id, user_id, container_key, provider_family,
              connector_family, signal_type, severity, signal_status,
              payload_summary_json, source_ref, received_at, processed_at
         FROM activation_signal_inbox
        WHERE ${userTenant.sql}
          AND severity IN ('critical','high')
          AND signal_status IN ('new','failed')
        ORDER BY FIELD(severity,'critical','high'), received_at DESC
        LIMIT 500`,
      userTenant.params
    ),
    safeRows(
      "readiness_checks",
      `SELECT check_id, tenant_id, check_key, check_status, detail, checked_at
         FROM readiness_checks
        WHERE ${tenant.sql} AND check_status IN ('fail','warn','pending')
        ORDER BY FIELD(check_status,'fail','warn','pending'), checked_at DESC
        LIMIT 500`,
      tenant.params
    ),
    safeRows(
      "telemetry_spans",
      `SELECT tenant_id, workspace_id, span_name, span_type, status,
              COUNT(*) AS occurrence_count, MIN(started_at) AS first_seen_at,
              MAX(started_at) AS last_seen_at, MAX(trace_id) AS trace_id,
              MAX(error_message) AS error_message
         FROM telemetry_spans
        WHERE ${tenant.sql}
          AND started_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
          AND status IN ('error','timeout')
        GROUP BY tenant_id, workspace_id, span_name, span_type, status
        ORDER BY FIELD(status,'timeout','error'), last_seen_at DESC
        LIMIT 500`,
      [...tenant.params, boundedLookback]
    ),
  ];

  if (includePersisted) {
    queries.push(safeRows(
      "operational_alerts",
      `SELECT alert_id, alert_key, source_type, source_ref, source_record_id,
              tenant_id, user_id, workspace_id, container_key, category, severity,
              title, summary, reason_code, lifecycle_status, verification_state,
              evidence_type, evidence_ref, evidence_json, execution_log_id, trace_id,
              occurrence_count, first_seen_at, last_seen_at, recommended_action_key,
              requires_confirmation, manual_known_issue
         FROM operational_alerts
        WHERE ${subject.is_admin ? "1 = 1" : "tenant_id = ?"}
        ORDER BY FIELD(severity,'critical','high','medium','low','info'), last_seen_at DESC
        LIMIT 2000`,
      subject.is_admin ? [] : [subject.tenant_id || "__missing_tenant__"]
    ));
  }

  const results = await Promise.all(queries);
  const bySource = new Map(results.map((result) => [result.source, result]));
  const alerts = [];

  alerts.push(...mapExecutionAlerts(bySource.get("execution_log")?.rows || []));

  for (const row of bySource.get("connected_systems")?.rows || []) {
    alerts.push(candidate({
      sourceType: "connected_systems",
      sourceRef: `connected-system://${row.system_id}`,
      sourceRecordId: row.system_id,
      tenantId: row.tenant_id,
      category: "connector",
      severity: row.status === "error" ? "high" : "medium",
      title: `${row.display_name || row.system_key} connector is ${row.status}`,
      reasonCode: `connector_${row.status}`,
      verificationState: "verified",
      evidence: row,
      firstSeenAt: row.updated_at,
      lastSeenAt: row.updated_at,
      recommendedActionKey: row.status === "error" ? "connector.reconnect_or_review" : "connector.complete_setup",
      requiresConfirmation: row.status === "error",
    }));
  }

  for (const row of bySource.get("v_activation_pending_tasks")?.rows || []) {
    const blocked = row.task_status === "blocked" || row.blocker_level === "hard";
    alerts.push(candidate({
      sourceType: "v_activation_pending_tasks",
      sourceRef: `task://${row.task_id}`,
      sourceRecordId: row.task_id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      category: "task",
      severity: blocked || row.priority === "critical" ? "critical" : "high",
      title: row.title,
      summary: blocked ? "Task is blocked and requires review." : "High-priority task requires attention.",
      reasonCode: blocked ? "task_blocked" : "high_priority_task",
      verificationState: "verified",
      evidence: row,
      firstSeenAt: row.updated_at,
      lastSeenAt: row.updated_at,
      recommendedActionKey: blocked ? "task.review_blocker" : "task.review_priority",
    }));
  }

  for (const row of bySource.get("v_activation_agent_catalog")?.rows || []) {
    alerts.push(candidate({
      sourceType: "v_activation_agent_catalog",
      sourceRef: `agent://${row.agent_id}`,
      sourceRecordId: row.agent_id,
      tenantId: row.tenant_id,
      category: "agent",
      severity: row.health_status === "offline" ? "critical" : "high",
      title: `${row.agent_display_name || row.agent_name || row.agent_id} is ${row.health_status}`,
      reasonCode: `agent_${row.health_status}`,
      verificationState: "verified",
      evidence: row,
      firstSeenAt: row.updated_at,
      lastSeenAt: row.updated_at,
      recommendedActionKey: row.health_status === "offline" ? "agent.recover" : "agent.health_review",
      requiresConfirmation: row.health_status === "offline",
    }));
  }

  for (const row of bySource.get("v_activation_agent_skill_grants")?.rows || []) {
    alerts.push(candidate({
      sourceType: "v_activation_agent_skill_grants",
      sourceRef: `skill-grant://${row.grant_id}`,
      sourceRecordId: row.grant_id,
      tenantId: row.tenant_id,
      category: "skill_approval",
      severity: "medium",
      title: `${row.skill_display_name || row.skill_key || row.skill_id} requires approval`,
      summary: `${row.agent_display_name || row.agent_name || row.agent_id} is waiting for skill approval.`,
      reasonCode: "skill_requires_approval",
      verificationState: "verified",
      evidence: row,
      firstSeenAt: row.granted_at,
      lastSeenAt: row.granted_at,
      recommendedActionKey: "skill.review_approval",
      requiresConfirmation: true,
    }));
  }

  for (const row of bySource.get("activation_freshness_ledger")?.rows || []) {
    alerts.push(candidate({
      sourceType: "activation_freshness_ledger",
      sourceRef: row.source_ref || `freshness-ledger://${row.ledger_id}`,
      sourceRecordId: row.ledger_id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      containerKey: row.container_key,
      category: "freshness",
      severity: row.freshness_status === "failed" ? "high" : "medium",
      title: `${row.surface_key || row.provider_family || "Surface"} freshness is ${row.freshness_status}`,
      reasonCode: `freshness_${row.freshness_status}`,
      verificationState: "verified",
      evidence: row,
      firstSeenAt: row.last_failure_at || row.updated_at,
      lastSeenAt: row.updated_at,
      recommendedActionKey: "surface.refresh",
    }));
  }

  for (const row of bySource.get("activation_signal_inbox")?.rows || []) {
    alerts.push(candidate({
      sourceType: "activation_signal_inbox",
      sourceRef: row.source_ref || `activation-signal://${row.signal_id}`,
      sourceRecordId: row.signal_id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      containerKey: row.container_key,
      category: "external_signal",
      severity: row.severity,
      title: `${row.signal_type} signal is ${row.signal_status}`,
      reasonCode: `${row.signal_type}_${row.signal_status}`,
      verificationState: "verified",
      evidence: row,
      firstSeenAt: row.received_at,
      lastSeenAt: row.processed_at || row.received_at,
      recommendedActionKey: "signal.review",
    }));
  }

  for (const row of bySource.get("readiness_checks")?.rows || []) {
    alerts.push(candidate({
      sourceType: "readiness_checks",
      sourceRef: `readiness-check://${row.check_id}`,
      sourceRecordId: row.check_id,
      tenantId: row.tenant_id,
      category: "readiness",
      severity: row.check_status === "fail" ? "high" : "medium",
      title: `${row.check_key} readiness is ${row.check_status}`,
      summary: row.detail,
      reasonCode: `readiness_${row.check_status}`,
      verificationState: "verified",
      evidence: row,
      firstSeenAt: row.checked_at,
      lastSeenAt: row.checked_at,
      recommendedActionKey: "readiness.review",
    }));
  }

  for (const row of bySource.get("telemetry_spans")?.rows || []) {
    alerts.push(candidate({
      sourceType: "telemetry_spans",
      sourceRef: row.trace_id ? `trace://${row.trace_id}` : null,
      sourceRecordId: [row.status, row.span_name, row.workspace_id].filter(Boolean).join(":"),
      tenantId: row.tenant_id,
      workspaceId: row.workspace_id,
      containerKey: row.workspace_id ? `workspace:${row.workspace_id}` : null,
      category: "telemetry",
      severity: row.status === "timeout" ? "high" : "medium",
      title: `${row.span_name || "Runtime span"} has ${row.status} telemetry`,
      summary: row.error_message || `Observed ${row.occurrence_count} matching telemetry span(s).`,
      reasonCode: `telemetry_${row.status}`,
      verificationState: "verified",
      evidence: row,
      traceId: row.trace_id,
      occurrenceCount: row.occurrence_count,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      recommendedActionKey: "telemetry.review_trace",
    }));
  }

  for (const row of bySource.get("operational_alerts")?.rows || []) alerts.push(mapPersistedAlert(row));

  return {
    subject,
    alerts: mergeCandidates(alerts),
    source_health: results.map((result) => ({
      source: result.source,
      ok: result.ok,
      row_count: result.rows.length,
      error: result.error || null,
    })),
  };
}

function summarize(items = []) {
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const bySource = {};
  const byLifecycle = {};
  const byVerification = {};
  let knownIssueCount = 0;
  let currentDetectedCount = 0;
  for (const item of items) {
    bySeverity[item.severity] = safeNumber(bySeverity[item.severity]) + 1;
    bySource[item.source_type] = safeNumber(bySource[item.source_type]) + 1;
    byLifecycle[item.lifecycle_status] = safeNumber(byLifecycle[item.lifecycle_status]) + 1;
    byVerification[item.verification_state] = safeNumber(byVerification[item.verification_state]) + 1;
    if (item.manual_known_issue) knownIssueCount += 1;
    else currentDetectedCount += 1;
  }
  return {
    total_count: items.length,
    open_count: items.filter((item) => OPEN_LIFECYCLE_STATES.includes(item.lifecycle_status)).length,
    known_issue_count: knownIssueCount,
    current_detected_count: currentDetectedCount,
    by_severity: bySeverity,
    by_source: bySource,
    by_lifecycle: byLifecycle,
    by_verification: byVerification,
  };
}

export async function readOperationalAlerts({
  sessionContext = null,
  explicitSubject = {},
  cursor = 0,
  limit = 500,
  lookbackHours = 168,
  includeResolved = false,
  severity = null,
  sourceType = null,
  lifecycleStatus = null,
  q = null,
} = {}) {
  const subject = resolveSubject(sessionContext || {}, explicitSubject);
  const collected = await collectOperationalAlertCandidates({ subject, lookbackHours, includePersisted: true });
  const allMerged = collected.alerts;
  const expectedKnownIssueKeys = subject.is_admin ? KNOWN_ISSUE_KEYS : [];
  const foundKnownIssueKeys = new Set(allMerged.filter((item) => item.manual_known_issue).map((item) => item.alert_key));
  const missingKnownIssueKeys = expectedKnownIssueKeys.filter((key) => !foundKnownIssueKeys.has(key));
  const normalizedSeverity = severity ? String(severity).toLowerCase() : null;
  const normalizedSource = sourceType ? String(sourceType) : null;
  const normalizedLifecycle = lifecycleStatus ? String(lifecycleStatus).toLowerCase() : null;
  const normalizedQuery = q ? String(q).trim().toLowerCase() : null;
  const filtered = allMerged.filter((item) => {
    if (!includeResolved && !OPEN_LIFECYCLE_STATES.includes(item.lifecycle_status)) return false;
    if (normalizedSeverity && item.severity !== normalizedSeverity) return false;
    if (normalizedSource && item.source_type !== normalizedSource) return false;
    if (normalizedLifecycle && item.lifecycle_status !== normalizedLifecycle) return false;
    if (normalizedQuery) {
      const haystack = [item.title, item.summary, item.reason_code, item.source_type, item.alert_key]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(normalizedQuery)) return false;
    }
    return true;
  });
  filtered.sort((a, b) => {
    const severityDiff = safeNumber(SEVERITY_WEIGHT[b.severity]) - safeNumber(SEVERITY_WEIGHT[a.severity]);
    if (severityDiff) return severityDiff;
    return new Date(b.last_seen_at || 0) - new Date(a.last_seen_at || 0);
  });
  const normalizedCursor = boundedInt(cursor, 0, 0, 1000000);
  const normalizedLimit = boundedInt(limit, 500, 1, 1000);
  const items = filtered.slice(normalizedCursor, normalizedCursor + normalizedLimit);
  const hasMore = normalizedCursor + items.length < filtered.length;
  const degradedSources = collected.source_health.filter((source) => !source.ok);
  const summary = summarize(filtered);
  return {
    attempted: true,
    ok: degradedSources.length === 0 && missingKnownIssueKeys.length === 0,
    activation_layer: "operational_alerting_control_plane",
    source_authority: "sql_runtime_evidence_sources_plus_operational_alert_lifecycle",
    subject,
    summary: {
      ...summary,
      returned_count: items.length,
      degraded_source_count: degradedSources.length,
    },
    final_result: items,
    page: {
      cursor: normalizedCursor,
      limit: normalizedLimit,
      returned_count: items.length,
      total_count: filtered.length,
      has_more: hasMore,
      next_cursor: hasMore ? normalizedCursor + items.length : null,
    },
    completeness: {
      all_known_issues_visible: missingKnownIssueKeys.length === 0,
      expected_known_issue_count: KNOWN_ISSUE_KEYS.length,
      visible_known_issue_count: KNOWN_ISSUE_KEYS.length - missingKnownIssueKeys.length,
      missing_known_issue_keys: missingKnownIssueKeys,
      all_matching_problems_returned_in_page: !hasMore,
      details_omitted_silently: false,
      degraded_sources: degradedSources,
      final_result_complete: missingKnownIssueKeys.length === 0 && !hasMore && degradedSources.length === 0,
    },
    source_health: collected.source_health,
    policy: {
      execution_log_is_evidence_not_alert_queue: true,
      known_issues_are_preserved_until_lifecycle_resolution: true,
      dynamic_sources_are_read_live: true,
      dedupe_uses_stable_alert_key: true,
      tenant_scope_enforced: true,
      secret_values_never_returned: true,
    },
    secrets_included: false,
  };
}

function dbDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace("T", " ");
}

async function upsertAlert(connection, item, syncRunId) {
  const alertId = item.alert_id || randomUUID();
  await connection.query(
    `INSERT INTO operational_alerts
      (alert_id, alert_key, fingerprint_sha256, tenant_id, user_id, workspace_id, container_key,
       source_type, source_ref, source_record_id, category, severity, title, summary, reason_code,
       lifecycle_status, verification_state, evidence_type, evidence_ref, evidence_json,
       execution_log_id, trace_id, occurrence_count, first_seen_at, last_seen_at, last_sync_run_id,
       recommended_action_key, requires_confirmation, manual_known_issue, secrets_included)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE
       tenant_id = VALUES(tenant_id), user_id = VALUES(user_id), workspace_id = VALUES(workspace_id),
       container_key = VALUES(container_key), source_ref = VALUES(source_ref), source_record_id = VALUES(source_record_id),
       category = VALUES(category), severity = VALUES(severity), title = VALUES(title), summary = VALUES(summary),
       reason_code = VALUES(reason_code), verification_state = VALUES(verification_state),
       evidence_type = VALUES(evidence_type), evidence_ref = VALUES(evidence_ref), evidence_json = VALUES(evidence_json),
       execution_log_id = VALUES(execution_log_id), trace_id = VALUES(trace_id),
       occurrence_count = VALUES(occurrence_count), first_seen_at = LEAST(first_seen_at, VALUES(first_seen_at)),
       last_seen_at = GREATEST(last_seen_at, VALUES(last_seen_at)), last_sync_run_id = VALUES(last_sync_run_id),
       recommended_action_key = VALUES(recommended_action_key), requires_confirmation = VALUES(requires_confirmation),
       lifecycle_status = IF(lifecycle_status IN ('resolved','ignored'), 'open', lifecycle_status),
       updated_at = CURRENT_TIMESTAMP`,
    [
      alertId,
      item.alert_key,
      item.fingerprint_sha256,
      item.tenant_id,
      item.user_id,
      item.workspace_id,
      item.container_key,
      item.source_type,
      item.source_ref,
      item.source_record_id,
      item.category,
      item.severity,
      item.title,
      item.summary,
      item.reason_code,
      item.lifecycle_status,
      item.verification_state,
      item.evidence_type,
      item.evidence_ref,
      JSON.stringify(sanitizeEvidence(item.evidence || {})),
      item.execution_log_id,
      item.trace_id,
      item.occurrence_count,
      dbDate(item.first_seen_at),
      dbDate(item.last_seen_at),
      syncRunId,
      item.recommended_action_key,
      item.requires_confirmation ? 1 : 0,
      item.manual_known_issue ? 1 : 0,
    ]
  );
  const [rows] = await connection.query(
    "SELECT alert_id, lifecycle_status FROM operational_alerts WHERE alert_key = ? LIMIT 1",
    [item.alert_key]
  );
  return rows[0] || { alert_id: alertId, lifecycle_status: item.lifecycle_status };
}

export async function synchronizeOperationalAlerts({
  sessionContext = null,
  explicitSubject = {},
  lookbackHours = 168,
  requestedBy = "platform_admin",
} = {}) {
  const subject = resolveSubject(sessionContext || {}, explicitSubject);
  const collected = await collectOperationalAlertCandidates({ subject, lookbackHours, includePersisted: false });
  const degradedSources = collected.source_health.filter((source) => !source.ok);
  const runId = randomUUID();
  const connection = await getPool().getConnection();
  let upserted = 0;
  let queued = 0;
  let resolved = 0;
  try {
    await connection.beginTransaction();
    await connection.query(
      `INSERT INTO operational_alert_sync_runs
        (sync_run_id, tenant_id, user_id, requested_by, sync_status, source_health_json,
         candidate_count, started_at, secrets_included)
       VALUES (?, ?, ?, ?, 'running', ?, ?, NOW(), 0)`,
      [runId, subject.tenant_id, subject.user_id, requestedBy, JSON.stringify(collected.source_health), collected.alerts.length]
    );
    for (const item of collected.alerts) {
      const row = await upsertAlert(connection, item, runId);
      upserted += 1;
      if (["critical", "high"].includes(item.severity) && OPEN_LIFECYCLE_STATES.includes(row.lifecycle_status)) {
        const notificationKey = `${item.alert_key}:${item.severity}:open`;
        const [result] = await connection.query(
          `INSERT IGNORE INTO operational_alert_notification_outbox
            (notification_id, notification_key, alert_id, tenant_id, user_id, channel,
             recipient_scope, delivery_status, payload_summary_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'in_app', 'authorized_subject', 'pending', ?, NOW(), NOW())`,
          [randomUUID(), notificationKey, row.alert_id, item.tenant_id, item.user_id, JSON.stringify({ title: item.title, severity: item.severity, reason_code: item.reason_code })]
        );
        queued += safeNumber(result?.affectedRows);
      }
    }
    const staleWhere = subject.is_admin ? "1 = 1" : "tenant_id = ?";
    const staleParams = subject.is_admin ? [] : [subject.tenant_id || "__missing_tenant__"];
    const [staleResult] = await connection.query(
      `UPDATE operational_alerts
          SET lifecycle_status = 'resolved', resolved_at = NOW(), resolution_note = 'Source no longer emitted the alert during the latest successful synchronization.'
        WHERE ${staleWhere}
          AND manual_known_issue = 0
          AND lifecycle_status IN ('open','acknowledged','investigating')
          AND COALESCE(last_sync_run_id, '') <> ?`,
      [...staleParams, runId]
    );
    resolved = safeNumber(staleResult?.affectedRows);
    await connection.query(
      `UPDATE operational_alert_sync_runs
          SET sync_status = ?, upserted_count = ?, resolved_count = ?, notification_queued_count = ?,
              degraded_source_count = ?, completed_at = NOW()
        WHERE sync_run_id = ?`,
      [degradedSources.length ? "completed_degraded" : "completed", upserted, resolved, queued, degradedSources.length, runId]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    try {
      await getPool().query(
        `UPDATE operational_alert_sync_runs
            SET sync_status = 'failed', error_code = ?, error_message = ?, completed_at = NOW()
          WHERE sync_run_id = ?`,
        [error?.code || "operational_alert_sync_failed", String(error?.message || error).slice(0, 1000), runId]
      );
    } catch {
    }
    throw error;
  } finally {
    connection.release();
  }
  const readback = await readOperationalAlerts({
    sessionContext,
    explicitSubject,
    limit: 1000,
    lookbackHours,
    includeResolved: false,
  });
  return {
    ok: readback.ok,
    sync_run_id: runId,
    sync_status: degradedSources.length ? "completed_degraded" : "completed",
    candidate_count: collected.alerts.length,
    upserted_count: upserted,
    resolved_count: resolved,
    notification_queued_count: queued,
    degraded_sources: degradedSources,
    readback,
    secrets_included: false,
  };
}

export async function updateOperationalAlertLifecycle({
  sessionContext = null,
  explicitSubject = {},
  alertId,
  lifecycleStatus,
  actor = "platform_admin",
  note = null,
} = {}) {
  const subject = resolveSubject(sessionContext || {}, explicitSubject);
  const normalizedStatus = String(lifecycleStatus || "").toLowerCase();
  if (!ALLOWED_LIFECYCLE_STATES.has(normalizedStatus)) {
    const error = new Error("Unsupported operational alert lifecycle status.");
    error.code = "invalid_operational_alert_lifecycle_status";
    error.status = 400;
    throw error;
  }
  const where = ["alert_id = ?"];
  const params = [alertId];
  if (!subject.is_admin) {
    where.push("tenant_id = ?");
    params.push(subject.tenant_id || "__missing_tenant__");
  }
  const resolvedAt = normalizedStatus === "resolved" ? new Date() : null;
  const acknowledgedAt = ["acknowledged", "investigating"].includes(normalizedStatus) ? new Date() : null;
  const [result] = await getPool().query(
    `UPDATE operational_alerts
        SET lifecycle_status = ?, lifecycle_actor = ?, lifecycle_note = ?,
            acknowledged_at = COALESCE(?, acknowledged_at),
            resolved_at = ?, resolution_note = CASE WHEN ? = 'resolved' THEN ? ELSE resolution_note END,
            updated_at = CURRENT_TIMESTAMP
      WHERE ${where.join(" AND ")}`,
    [normalizedStatus, actor, note, acknowledgedAt, resolvedAt, normalizedStatus, note, ...params]
  );
  if (!safeNumber(result?.affectedRows)) {
    const error = new Error("Operational alert was not found or is outside the caller scope.");
    error.code = "operational_alert_not_found";
    error.status = 404;
    throw error;
  }
  const [rows] = await getPool().query(
    `SELECT alert_id, alert_key, severity, title, lifecycle_status, verification_state,
            lifecycle_actor, lifecycle_note, acknowledged_at, resolved_at, updated_at
       FROM operational_alerts
      WHERE ${where.join(" AND ")}
      LIMIT 1`,
    params
  );
  return {
    ok: true,
    alert: sanitizeEvidence(rows[0] || {}),
    secrets_included: false,
  };
}

export const _testingOperationalAlerts = {
  KNOWN_ISSUE_KEYS,
  sanitizeEvidence,
  deterministicAlertKey,
  candidate,
  mergeCandidates,
  groupExecutionRows,
  summarize,
  executionSeverity,
};
