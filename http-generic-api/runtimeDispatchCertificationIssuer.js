import { getPool } from "./db.js";

const KEY_PATTERN = /^[A-Za-z0-9_.:-]{3,191}$/;
const RISK_CLASS_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
const DEFAULT_EXPIRY_DAYS = 30;
const MAX_EXPIRY_DAYS = 90;

function compact(value = "", max = 191) {
  return String(value ?? "").trim().slice(0, max);
}

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || value === 1 || String(value).toLowerCase() === "true";
}

function issueError(status, code, message, details = {}) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.details = { ...details, secrets_included: false };
  return err;
}

export function runtimeDispatchCertificationIssueConfirmation(certificationKey = "") {
  const slug = compact(certificationKey, 191)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug ? `ISSUE_RUNTIME_DISPATCH_CERTIFICATION_${slug}` : "";
}

function normalizeIssueArgs(args = {}) {
  const certificationKey = compact(args.certification_key || args.certificationKey, 191);
  const surfaceKey = compact(args.surface_key || args.surfaceKey, 191);
  const surfaceFamily = compact(args.surface_family || args.surfaceFamily, 128);
  const toolOrActionKey = compact(args.tool_or_action_key || args.toolOrActionKey, 191);
  const riskClass = compact(args.risk_class || args.riskClass || "D", 64);
  const certificationStatus = compact(args.certification_status || args.certificationStatus || "ci_certified", 128);
  const smokeStrategy = compact(args.smoke_strategy || args.smokeStrategy || "bounded_evidence_readback", 191);
  const lastEvidenceRef = compact(args.last_evidence_ref || args.lastEvidenceRef, 1000);
  const notes = compact(args.notes || "Issued through runtime_dispatch_certification_issue.", 1000);
  const expiresInDays = Math.max(1, Math.min(MAX_EXPIRY_DAYS, Math.trunc(Number(args.expires_in_days ?? args.expiresInDays ?? DEFAULT_EXPIRY_DAYS)) || DEFAULT_EXPIRY_DAYS));
  return {
    certification_key: certificationKey,
    surface_key: surfaceKey,
    surface_family: surfaceFamily,
    tool_or_action_key: toolOrActionKey,
    risk_class: riskClass,
    certification_status: certificationStatus,
    smoke_strategy: smokeStrategy,
    dispatch_allowed: toBool(args.dispatch_allowed ?? args.dispatchAllowed, true) ? 1 : 0,
    apply_allowed: toBool(args.apply_allowed ?? args.applyAllowed, false) ? 1 : 0,
    requires_resource_authority: toBool(args.requires_resource_authority ?? args.requiresResourceAuthority, true) ? 1 : 0,
    requires_dry_run: toBool(args.requires_dry_run ?? args.requiresDryRun, true) ? 1 : 0,
    requires_audit_evidence: toBool(args.requires_audit_evidence ?? args.requiresAuditEvidence, true) ? 1 : 0,
    requires_readback: toBool(args.requires_readback ?? args.requiresReadback, true) ? 1 : 0,
    last_evidence_ref: lastEvidenceRef,
    expires_in_days: expiresInDays,
    notes,
    confirm: compact(args.confirm, 255),
  };
}

function validateIssueInput(input) {
  for (const field of ["certification_key", "surface_key", "surface_family", "tool_or_action_key"]) {
    if (!KEY_PATTERN.test(input[field] || "")) {
      throw issueError(400, "runtime_dispatch_certification_invalid_key", `${field} is required and must use a stable registry key format.`, { field });
    }
  }
  if (!RISK_CLASS_PATTERN.test(input.risk_class || "")) {
    throw issueError(400, "runtime_dispatch_certification_invalid_risk_class", "risk_class is required.");
  }
  if (!input.dispatch_allowed) {
    throw issueError(400, "runtime_dispatch_certification_dispatch_required", "The issuer only creates dispatch-allowed certifications.");
  }
  if (input.apply_allowed) {
    throw issueError(400, "runtime_dispatch_certification_apply_not_allowed", "The issuer cannot grant apply_allowed=true. Runtime tools must keep their own apply gate.");
  }
  if (input.last_evidence_ref.length < 20) {
    throw issueError(400, "runtime_dispatch_certification_evidence_required", "last_evidence_ref must describe bounded CI, smoke, or readiness evidence.");
  }
  const expectedConfirm = runtimeDispatchCertificationIssueConfirmation(input.certification_key);
  if (input.confirm !== expectedConfirm) {
    throw issueError(400, "runtime_dispatch_certification_confirmation_required", `Certification issue requires confirm=${expectedConfirm}.`, {
      expected_confirm: expectedConfirm,
    });
  }
}

async function assertToolOrActionExists(pool, toolOrActionKey, allowedToolKeys = []) {
  if (allowedToolKeys.includes(toolOrActionKey)) return { source: "virtual_admin_tool_catalog" };
  const [rows] = await pool.query(
    `SELECT 'admin_platform_endpoint_tools' AS source FROM admin_platform_endpoint_tools WHERE tool_key = ? LIMIT 1
     UNION ALL
     SELECT 'tenant_platform_endpoint_tools' AS source FROM tenant_platform_endpoint_tools WHERE tool_key = ? LIMIT 1
     UNION ALL
     SELECT 'endpoints' AS source FROM endpoints WHERE endpoint_key = ? LIMIT 1`,
    [toolOrActionKey, toolOrActionKey, toolOrActionKey]
  );
  if (!rows?.length) {
    throw issueError(404, "runtime_dispatch_certification_target_missing", "tool_or_action_key does not resolve to a governed tool or endpoint.", {
      tool_or_action_key: toolOrActionKey,
    });
  }
  return { source: rows[0].source };
}

export async function issueRuntimeDispatchCertification(args = {}, options = {}) {
  const pool = options.pool || getPool();
  const allowedToolKeys = Array.isArray(options.allowedToolKeys) ? options.allowedToolKeys.map(String) : [];
  const input = normalizeIssueArgs(args);
  validateIssueInput(input);
  const target = await assertToolOrActionExists(pool, input.tool_or_action_key, allowedToolKeys);

  await pool.query(
    `INSERT INTO runtime_dispatch_certification_registry (
       certification_key, surface_key, surface_family, tool_or_action_key, risk_class,
       certification_status, smoke_strategy, dispatch_allowed, apply_allowed,
       requires_resource_authority, requires_dry_run, requires_audit_evidence,
       requires_readback, last_evidence_ref, last_certified_at, expires_at, notes
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, DATE_ADD(NOW(), INTERVAL ${input.expires_in_days} DAY), ?)
     ON DUPLICATE KEY UPDATE
       surface_key = VALUES(surface_key),
       surface_family = VALUES(surface_family),
       tool_or_action_key = VALUES(tool_or_action_key),
       risk_class = VALUES(risk_class),
       certification_status = VALUES(certification_status),
       smoke_strategy = VALUES(smoke_strategy),
       dispatch_allowed = VALUES(dispatch_allowed),
       apply_allowed = VALUES(apply_allowed),
       requires_resource_authority = VALUES(requires_resource_authority),
       requires_dry_run = VALUES(requires_dry_run),
       requires_audit_evidence = VALUES(requires_audit_evidence),
       requires_readback = VALUES(requires_readback),
       last_evidence_ref = VALUES(last_evidence_ref),
       last_certified_at = VALUES(last_certified_at),
       expires_at = VALUES(expires_at),
       notes = VALUES(notes),
       updated_at = CURRENT_TIMESTAMP`,
    [
      input.certification_key,
      input.surface_key,
      input.surface_family,
      input.tool_or_action_key,
      input.risk_class,
      input.certification_status,
      input.smoke_strategy,
      input.dispatch_allowed,
      input.apply_allowed,
      input.requires_resource_authority,
      input.requires_dry_run,
      input.requires_audit_evidence,
      input.requires_readback,
      input.last_evidence_ref,
      input.notes,
    ]
  );

  const [rows] = await pool.query(
    `SELECT certification_key, surface_key, surface_family, tool_or_action_key, risk_class,
            certification_status, smoke_strategy, dispatch_allowed, apply_allowed,
            requires_resource_authority, requires_dry_run, requires_audit_evidence,
            requires_readback, last_evidence_ref, last_certified_at, expires_at, notes
       FROM runtime_dispatch_certification_registry
      WHERE certification_key = ?
      LIMIT 1`,
    [input.certification_key]
  );
  const row = rows?.[0] || null;
  if (!row || row.tool_or_action_key !== input.tool_or_action_key || Number(row.dispatch_allowed || 0) !== 1 || Number(row.apply_allowed || 0) !== 0) {
    throw issueError(502, "runtime_dispatch_certification_readback_failed", "Certification write did not pass same-cycle readback.", {
      certification_key: input.certification_key,
    });
  }
  return {
    ok: true,
    status: "runtime_dispatch_certification_issued",
    certification_key: row.certification_key,
    target_source: target.source,
    certification: row,
    readback_verified: true,
    secrets_included: false,
  };
}
