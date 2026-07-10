import { createHash, randomUUID } from "node:crypto";

const ROOT_FAMILY_PLAYBOOKS = Object.freeze({
  wordpress_site_health: "wordpress_site_doctor_v1",
  tenant_skill_approval: "tenant_skill_approval_decision_v1",
  task_source_quality: "task_source_repair_v1",
  provider_setup_ads: "google_ads_setup_preflight_v1",
  connector_runtime_readiness: "connector_health_repair_v1",
  general_operational_review: "tenant_resolution_triage_v1",
});

const ALLOWED_ROOT_FAMILIES = new Set(Object.keys(ROOT_FAMILY_PLAYBOOKS));
const ALLOWED_SEVERITIES = new Set(["info", "low", "medium", "high", "critical"]);
const CLOSED_STATUSES = new Set(["resolved", "cancelled"]);
const SENSITIVE_KEY_PATTERN = /(secret|credential|token|password|private_key|cipher|api_key|authorization|cookie|set-cookie|payload_json|raw_prompt|system_prompt)/i;

async function defaultPool() {
  const { getPool } = await import("./db.js");
  return getPool();
}

function sha256(value = "") {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function httpError(status, code, message, details = null) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.details = details;
  return err;
}

function safeString(value = "", max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeArray(value, maxItems = 50, maxLength = 512) {
  const raw = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return [...new Set(raw.map((item) => safeString(item, maxLength)).filter(Boolean))].slice(0, maxItems);
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

function parseJsonValue(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function resolveSubject(sessionContext = {}, explicitSubject = {}) {
  const subject = sessionContext?.subject || {};
  const principal = sessionContext?.platform_access?.principal || {};
  return {
    tenant_id: explicitSubject.tenant_id || subject.tenant_id || principal.tenant_id || null,
    user_id: explicitSubject.user_id || subject.user_id || principal.user_id || null,
    is_admin: explicitSubject.is_admin === true || subject.is_admin === true || principal.is_admin === true,
  };
}

function rootFingerprintFor(input, subject, rootFamily, playbookKey, resourceRef) {
  const provided = safeString(input.root_fingerprint_sha256 || input.problem_fingerprint_sha256, 64).toLowerCase();
  if (/^[a-f0-9]{64}$/.test(provided)) return provided;
  return sha256([
    subject.tenant_id || "tenant",
    input.workspace_id || "workspace",
    rootFamily,
    playbookKey,
    input.problem_key || "problem",
    resourceRef || "resource",
  ].join("|"));
}

function normalizeCaseInput(input = {}, subject = {}) {
  const payload = input.problem_card && typeof input.problem_card === "object" ? input.problem_card : input;
  const rootFamily = safeString(payload.root_family, 128);
  if (!ALLOWED_ROOT_FAMILIES.has(rootFamily)) {
    throw httpError(400, "tenant_resolution_root_family_invalid", "root_family is required and must be supported.", {
      allowed_root_families: [...ALLOWED_ROOT_FAMILIES],
    });
  }
  const playbookKey = safeString(payload.playbook_key || payload.recommended_playbook_key || ROOT_FAMILY_PLAYBOOKS[rootFamily], 191);
  const severity = ALLOWED_SEVERITIES.has(payload.severity) ? payload.severity : "medium";
  const workspaceId = safeString(payload.workspace_id || input.workspace_id, 64) || null;
  const resourceRef = safeString(payload.resource_ref || input.resource_ref || workspaceId && `workspace://${workspaceId}` || rootFamily, 512);
  const rootFingerprint = rootFingerprintFor(payload, { ...subject, workspace_id: workspaceId }, rootFamily, playbookKey, resourceRef);
  const sourceAlertKeys = normalizeArray(payload.source_alert_keys || input.source_alert_keys, 100, 191);
  const sourceRefs = normalizeArray(payload.source_refs || input.source_refs || payload.evidence_refs || input.evidence_refs, 100, 512);
  return {
    rootFamily,
    playbookKey,
    severity,
    workspaceId,
    resourceRef,
    rootFingerprint,
    sourceAlertKeys,
    sourceRefs,
    impactSummary: safeString(payload.impact_summary || input.impact_summary, 2000) || null,
    currentStepKey: "case_created",
    idempotencyKey: safeString(input.idempotency_key || payload.idempotency_key, 191) || null,
    problemKey: safeString(payload.problem_key || input.problem_key, 191) || null,
  };
}

function activeCaseKeyFor(subject, normalized) {
  const digest = sha256([
    subject.tenant_id,
    normalized.workspaceId || "workspace",
    normalized.rootFamily,
    normalized.playbookKey,
    normalized.rootFingerprint,
    normalized.resourceRef || "resource",
  ].join("|"));
  return `case.${digest}`;
}

function caseResponse(row = {}, { created = false, playbook = null, activeCaseKey = null } = {}) {
  return {
    case_id: row.case_id,
    tenant_id: row.tenant_id,
    workspace_id: row.workspace_id || null,
    resource_ref: row.resource_ref || null,
    root_family: row.root_family,
    playbook_key: row.playbook_key,
    status: row.status,
    severity: row.severity,
    root_fingerprint_sha256: row.root_fingerprint_sha256,
    active_case_key: row.active_case_key || activeCaseKey || null,
    source_alert_keys: parseJsonValue(row.source_alert_keys_json, []),
    source_refs: parseJsonValue(row.source_refs_json, []),
    impact_summary: row.impact_summary || null,
    current_step_key: row.current_step_key || null,
    owner_user_id: row.owner_user_id || null,
    readback_status: row.readback_status || "not_run",
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    closed_at: row.closed_at || null,
    playbook: playbook ? {
      playbook_key: playbook.playbook_key,
      root_family: playbook.root_family,
      risk_level: playbook.risk_level,
      approval_required: playbook.approval_required === 1 || playbook.approval_required === true,
      readback_required: playbook.readback_required !== 0 && playbook.readback_required !== false,
    } : null,
    created,
    secrets_included: false,
  };
}

async function selectActivePlaybook(conn, normalized) {
  const [rows] = await conn.query(
    `SELECT playbook_key, root_family, risk_level, approval_required, readback_required, status, tenant_visible
       FROM tenant_resolution_playbooks
      WHERE playbook_key = ?
        AND root_family = ?
        AND status = 'active'
        AND tenant_visible = 1
      LIMIT 1`,
    [normalized.playbookKey, normalized.rootFamily]
  );
  return rows[0] || null;
}

async function runWithConnection(pool, fn) {
  const conn = typeof pool.getConnection === "function" ? await pool.getConnection() : pool;
  const shouldRelease = conn !== pool && typeof conn.release === "function";
  try {
    if (typeof conn.beginTransaction === "function") await conn.beginTransaction();
    const result = await fn(conn);
    if (typeof conn.commit === "function") await conn.commit();
    return result;
  } catch (error) {
    if (typeof conn.rollback === "function") await conn.rollback();
    throw error;
  } finally {
    if (shouldRelease) conn.release();
  }
}

export async function createTenantResolutionCase({
  sessionContext = null,
  explicitSubject = {},
  input = {},
  pool = null,
  uuid = randomUUID,
} = {}) {
  const subject = resolveSubject(sessionContext || {}, explicitSubject || {});
  if (!subject.tenant_id) {
    throw httpError(403, "tenant_resolution_tenant_scope_required", "Tenant scope is required to create a resolution case.");
  }
  const normalized = normalizeCaseInput(input, subject);
  const activeCaseKey = activeCaseKeyFor(subject, normalized);
  const effectivePool = pool || await defaultPool();

  return runWithConnection(effectivePool, async (conn) => {
    const playbook = await selectActivePlaybook(conn, normalized);
    if (!playbook) {
      throw httpError(422, "tenant_resolution_playbook_unavailable", "No active tenant-visible playbook is available for this problem root.", {
        root_family: normalized.rootFamily,
        playbook_key: normalized.playbookKey,
      });
    }

    const [existingRows] = await conn.query(
      `SELECT *
         FROM tenant_resolution_cases
        WHERE active_case_key = ?
        LIMIT 1`,
      [activeCaseKey]
    );
    const existing = existingRows[0] || null;
    if (existing && !CLOSED_STATUSES.has(existing.status)) {
      return {
        ok: true,
        activation_layer: "tenant_resolution_case_create",
        created: false,
        case: caseResponse(existing, { created: false, playbook, activeCaseKey }),
        idempotency: { active_case_key: activeCaseKey, existing_case_returned: true },
        policy: {
          case_creation_only: true,
          provider_call_allowed: false,
          external_write_allowed: false,
          repair_apply_allowed: false,
          secrets_included: false,
        },
        secrets_included: false,
      };
    }

    const caseId = uuid();
    const eventId = uuid();
    const sourceAlertJson = JSON.stringify(normalized.sourceAlertKeys);
    const sourceRefsJson = JSON.stringify(normalized.sourceRefs);
    await conn.query(
      `INSERT INTO tenant_resolution_cases (
         case_id, tenant_id, workspace_id, resource_ref, root_family, playbook_key,
         status, severity, root_fingerprint_sha256, active_case_key, source_alert_keys_json,
         source_refs_json, impact_summary, current_step_key, owner_user_id, readback_status,
         secrets_included
       ) VALUES (?, ?, ?, ?, ?, ?, 'detected', ?, ?, ?, ?, ?, ?, ?, ?, 'not_run', 0)`,
      [
        caseId,
        subject.tenant_id,
        normalized.workspaceId,
        normalized.resourceRef,
        normalized.rootFamily,
        normalized.playbookKey,
        normalized.severity,
        normalized.rootFingerprint,
        activeCaseKey,
        sourceAlertJson,
        sourceRefsJson,
        normalized.impactSummary,
        normalized.currentStepKey,
        subject.user_id || null,
      ]
    );
    await conn.query(
      `INSERT INTO tenant_resolution_case_events (
         event_id, case_id, event_type, actor_type, actor_id, from_status, to_status,
         evidence_ref, event_json, secrets_included
       ) VALUES (?, ?, 'case_created', 'tenant_user', ?, NULL, 'detected', ?, ?, 0)`,
      [
        eventId,
        caseId,
        subject.user_id || null,
        normalized.sourceRefs[0] || normalized.problemKey || null,
        JSON.stringify(sanitizeValue({
          idempotency_key: normalized.idempotencyKey,
          problem_key: normalized.problemKey,
          source_alert_keys: normalized.sourceAlertKeys,
          source_refs: normalized.sourceRefs,
          provider_call_allowed: false,
          repair_apply_allowed: false,
        })),
      ]
    );
    const [caseRows] = await conn.query(
      `SELECT * FROM tenant_resolution_cases WHERE case_id = ? LIMIT 1`,
      [caseId]
    );
    return {
      ok: true,
      activation_layer: "tenant_resolution_case_create",
      created: true,
      case: caseResponse(caseRows[0], { created: true, playbook, activeCaseKey }),
      event: { event_id: eventId, event_type: "case_created", secrets_included: false },
      idempotency: { active_case_key: activeCaseKey, existing_case_returned: false },
      policy: {
        case_creation_only: true,
        provider_call_allowed: false,
        external_write_allowed: false,
        repair_apply_allowed: false,
        secrets_included: false,
      },
      secrets_included: false,
    };
  });
}

export const _testingTenantResolutionCaseService = {
  normalizeCaseInput,
  activeCaseKeyFor,
  sanitizeValue,
  caseResponse,
};
