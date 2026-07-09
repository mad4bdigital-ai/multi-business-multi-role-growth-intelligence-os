import { createHash } from "node:crypto";

async function defaultReadOperationalAlerts(args) {
  const { readOperationalAlerts } = await import("./operationalAlertService.js");
  return readOperationalAlerts(args);
}

const SEVERITY_WEIGHT = Object.freeze({ critical: 5, high: 4, medium: 3, low: 2, info: 1 });
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const SENSITIVE_KEY_PATTERN = /(secret|credential|token|password|private_key|cipher|api_key|authorization|cookie|set-cookie|payload_json|raw_prompt|system_prompt)/i;

const PLAYBOOK_BY_ROOT_FAMILY = Object.freeze({
  wordpress_site_health: "wordpress_site_doctor_v1",
  tenant_skill_approval: "tenant_skill_approval_decision_v1",
  task_source_quality: "task_source_repair_v1",
  provider_setup_ads: "google_ads_setup_preflight_v1",
  connector_runtime_readiness: "connector_health_repair_v1",
  general_operational_review: "tenant_resolution_triage_v1",
});

const ROOT_FAMILY_DISPLAY = Object.freeze({
  wordpress_site_health: "WordPress / WPML site health",
  tenant_skill_approval: "Tenant skill approval",
  task_source_quality: "Task source quality",
  provider_setup_ads: "Provider setup: Google Ads",
  connector_runtime_readiness: "Connector runtime readiness",
  general_operational_review: "Operational review",
});

function sha256(value = "") {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function boundedInt(value, fallback = DEFAULT_LIMIT, min = 1, max = MAX_LIMIT) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function safeString(value = "", max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function isoValue(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function dedupe(values = []) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && String(value).trim() !== "").map((value) => String(value)))];
}

function sanitizeValue(value, depth = 0) {
  if (depth > 4) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 25).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SENSITIVE_KEY_PATTERN.test(key))
        .slice(0, 40)
        .map(([key, item]) => [key, sanitizeValue(item, depth + 1)])
    );
  }
  if (typeof value === "string") return value.slice(0, 1000);
  return value;
}

function alertText(alert = {}) {
  const evidence = alert.evidence && typeof alert.evidence === "object" ? alert.evidence : {};
  return [
    alert.source_type,
    alert.category,
    alert.title,
    alert.summary,
    alert.reason_code,
    alert.recommended_action_key,
    evidence.operation_key,
    evidence.app_key,
    evidence.failure_reason,
    evidence.provider_family,
    evidence.connector_family,
    evidence.source_surface,
  ].filter(Boolean).join(" ").toLowerCase();
}

export function classifyTenantProblemRootFamily(alert = {}) {
  const text = alertText(alert);
  if (/\b(wpml|wordpress|wordpress_create_media|wordpress_publish|wp_)/i.test(text)) return "wordpress_site_health";
  if (alert.source_type === "v_activation_agent_skill_grants" || /skill.*approval|skill_requires_approval|review_approval/.test(text)) return "tenant_skill_approval";
  if (alert.source_type === "source_data_quality" || /source_data_quality|malformed|task_source|task_state_inconsistent/.test(text)) return "task_source_quality";
  if (/google_ads|google ads|ads_governance|budget_preflight|ads provider|provider_setup_ads/.test(text)) return "provider_setup_ads";
  if (alert.source_type === "connected_systems" || /connector|local_connector|runtime_readiness|pending install|heartbeat|tunnel/.test(text)) return "connector_runtime_readiness";
  return "general_operational_review";
}

function severityMax(a = "info", b = "info") {
  return (SEVERITY_WEIGHT[b] || 0) > (SEVERITY_WEIGHT[a] || 0) ? b : a;
}

function resourceRefForAlert(alert = {}) {
  const evidence = alert.evidence && typeof alert.evidence === "object" ? alert.evidence : {};
  if (evidence.resource_ref) return evidence.resource_ref;
  if (evidence.system_id) return `connected-system://${evidence.system_id}`;
  if (evidence.task_id) return `task://${evidence.task_id}`;
  if (alert.workspace_id) return `workspace://${alert.workspace_id}`;
  if (alert.source_type && alert.source_type !== "execution_log") return alert.source_ref || alert.evidence_ref || evidence.source_ref || alert.source_type;
  return alert.source_type || "tenant-operational-attention";
}

function buildImpactSummary(alert = {}, rootFamily = "general_operational_review") {
  const title = safeString(alert.title || ROOT_FAMILY_DISPLAY[rootFamily], 300);
  const summary = safeString(alert.summary || "", 500);
  const count = Number(alert.occurrence_count || 1);
  const occurrenceText = count > 1 ? ` (${count} occurrences)` : "";
  return summary ? `${title}${occurrenceText}: ${summary}`.slice(0, 1000) : `${title}${occurrenceText}`.slice(0, 1000);
}

export function projectOperationalAlertToProblemCard(alert = {}) {
  const rootFamily = classifyTenantProblemRootFamily(alert);
  const playbookKey = PLAYBOOK_BY_ROOT_FAMILY[rootFamily] || PLAYBOOK_BY_ROOT_FAMILY.general_operational_review;
  const resourceRef = resourceRefForAlert(alert);
  const tenantId = alert.tenant_id || null;
  const workspaceId = alert.workspace_id || null;
  const problemFingerprint = sha256([
    tenantId || "tenant",
    workspaceId || "workspace",
    rootFamily,
    playbookKey,
    alert.operation_fingerprint_sha256 || "no_operation",
    alert.resource_fingerprint_sha256 || resourceRef,
    alert.source_record_id || alert.alert_key || alert.reason_code || "alert",
  ].join("|"));
  return {
    problem_key: `problem.${problemFingerprint}`,
    root_fingerprint_sha256: problemFingerprint,
    tenant_id: tenantId,
    workspace_id: workspaceId,
    resource_ref: resourceRef,
    root_family: rootFamily,
    root_family_display: ROOT_FAMILY_DISPLAY[rootFamily] || ROOT_FAMILY_DISPLAY.general_operational_review,
    severity: alert.severity || "medium",
    impact_summary: buildImpactSummary(alert, rootFamily),
    recommended_playbook_key: playbookKey,
    status: "detected",
    source_alert_keys: dedupe([alert.alert_key]),
    source_refs: dedupe([alert.source_ref, alert.evidence_ref]),
    evidence_refs: dedupe([alert.evidence_ref, alert.source_ref]),
    allowed_next_actions: ["diagnose", "create_case", "escalate"],
    blocked_reasons: rootFamily === "general_operational_review" ? ["no_specific_playbook_yet"] : [],
    alert_count: 1,
    occurrence_count: Math.max(Number(alert.occurrence_count || 1), 1),
    first_seen_at: isoValue(alert.first_seen_at),
    last_seen_at: isoValue(alert.last_seen_at),
    sample_alert: sanitizeValue({
      alert_key: alert.alert_key,
      source_type: alert.source_type,
      category: alert.category,
      title: alert.title,
      reason_code: alert.reason_code,
      lifecycle_status: alert.lifecycle_status,
      verification_state: alert.verification_state,
      recommended_action_key: alert.recommended_action_key,
      requires_confirmation: alert.requires_confirmation === true,
    }),
    apply_enabled: false,
    provider_call_allowed: false,
    secrets_included: false,
  };
}

export function mergeProblemCards(cards = []) {
  const merged = new Map();
  for (const card of cards) {
    const key = [card.tenant_id || "tenant", card.workspace_id || "workspace", card.root_family, card.recommended_playbook_key, card.resource_ref].join("|");
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...card });
      continue;
    }
    const first = new Date(card.first_seen_at || Date.now()) < new Date(existing.first_seen_at || Date.now()) ? card.first_seen_at : existing.first_seen_at;
    const latest = new Date(card.last_seen_at || 0) >= new Date(existing.last_seen_at || 0) ? card : existing;
    merged.set(key, {
      ...existing,
      severity: severityMax(existing.severity, card.severity),
      impact_summary: latest.impact_summary,
      source_alert_keys: dedupe([...(existing.source_alert_keys || []), ...(card.source_alert_keys || [])]),
      source_refs: dedupe([...(existing.source_refs || []), ...(card.source_refs || [])]),
      evidence_refs: dedupe([...(existing.evidence_refs || []), ...(card.evidence_refs || [])]),
      alert_count: Number(existing.alert_count || 0) + Number(card.alert_count || 0),
      occurrence_count: Number(existing.occurrence_count || 0) + Number(card.occurrence_count || 0),
      first_seen_at: first,
      last_seen_at: latest.last_seen_at,
      sample_alert: latest.sample_alert,
      secrets_included: false,
    });
  }
  return [...merged.values()].map((card) => ({
    ...card,
    problem_key: `problem.${sha256([card.tenant_id || "tenant", card.workspace_id || "workspace", card.root_family, card.recommended_playbook_key, card.resource_ref, card.source_alert_keys.join(",")].join("|"))}`,
  }));
}

function matchesCardFilters(card = {}, { rootFamily = null, severity = null, q = null } = {}) {
  if (rootFamily && card.root_family !== rootFamily) return false;
  if (severity && card.severity !== severity) return false;
  if (q) {
    const query = String(q).toLowerCase();
    const haystack = [card.problem_key, card.root_family, card.root_family_display, card.impact_summary, card.recommended_playbook_key, card.resource_ref].join(" ").toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  return true;
}

export async function readTenantResolutionProblemCards({
  sessionContext = null,
  explicitSubject = {},
  cursor = 0,
  limit = DEFAULT_LIMIT,
  lookbackHours = 168,
  rootFamily = null,
  severity = null,
  q = null,
  readAlerts = readOperationalAlerts,
} = {}) {
  const normalizedCursor = boundedInt(cursor, 0, 0, 1000000);
  const normalizedLimit = boundedInt(limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const alerts = await readAlerts({
    sessionContext,
    explicitSubject,
    cursor: 0,
    limit: 1000,
    lookbackHours,
    includeResolved: false,
  });
  const cards = mergeProblemCards((alerts.final_result || []).map(projectOperationalAlertToProblemCard))
    .filter((card) => matchesCardFilters(card, { rootFamily, severity, q }));
  cards.sort((a, b) => {
    const severityDiff = (SEVERITY_WEIGHT[b.severity] || 0) - (SEVERITY_WEIGHT[a.severity] || 0);
    if (severityDiff) return severityDiff;
    return new Date(b.last_seen_at || 0) - new Date(a.last_seen_at || 0);
  });
  const items = cards.slice(normalizedCursor, normalizedCursor + normalizedLimit);
  const hasMore = normalizedCursor + items.length < cards.length;
  return {
    ok: alerts.ok !== false,
    activation_layer: "tenant_resolution_problem_cards",
    source_authority: "tenant_scoped_operational_alerts_projection",
    subject: alerts.subject || explicitSubject,
    summary: {
      total_count: cards.length,
      returned_count: items.length,
      by_root_family: items.reduce((acc, item) => ({ ...acc, [item.root_family]: Number(acc[item.root_family] || 0) + 1 }), {}),
      by_severity: items.reduce((acc, item) => ({ ...acc, [item.severity]: Number(acc[item.severity] || 0) + 1 }), {}),
    },
    items,
    page: {
      cursor: normalizedCursor,
      limit: normalizedLimit,
      returned_count: items.length,
      total_count: cards.length,
      has_more: hasMore,
      next_cursor: hasMore ? normalizedCursor + items.length : null,
    },
    policy: {
      tenant_scope_enforced_by_source: true,
      diagnostic_only: true,
      apply_enabled: false,
      provider_call_allowed: false,
      case_creation_deferred_to_next_child_pr: true,
      secrets_included: false,
    },
    source_health: alerts.source_health || [],
    secrets_included: false,
  };
}

export const _testingTenantResolutionProjection = {
  sanitizeValue,
  classifyTenantProblemRootFamily,
  projectOperationalAlertToProblemCard,
  mergeProblemCards,
  matchesCardFilters,
};
