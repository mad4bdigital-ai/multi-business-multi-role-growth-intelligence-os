import crypto from "node:crypto";
import { getPool } from "./db.js";

export const DYNAMIC_CAPABILITY_GOVERNANCE_COMPILER_VERSION = "dynamic-capability-governance-compiler-v1";

const EFFECT_RANK = Object.freeze({
  unclassified: -1,
  read_only: 0,
  preview_only: 0,
  internal_write: 1,
  workspace_write: 2,
  external_write: 3,
  credential_touching: 4,
  deployment_affecting: 4,
  destructive: 5,
});

const RISK_RANK = Object.freeze({ A: 0, B: 1, C: 2, D: 3, E: 4 });

function rowsOf(result) {
  return Array.isArray(result?.[0]) ? result[0] : [];
}

function bool(value) {
  return value === true || Number(value || 0) === 1 || String(value || "").toLowerCase() === "true";
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
  );
}

export function stableCapabilityHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function rowText(row) {
  return [
    row.capability_key,
    row.display_name,
    row.capability_family,
    row.source_table,
    row.source_key,
    row.operation_class,
    row.runtime_status,
  ].map((value) => String(value || "").toLowerCase()).join(" ");
}

function hasAny(text, patterns) {
  return patterns.some((pattern) => text.includes(pattern));
}

export function classifyCapabilityEffect(row = {}) {
  const text = rowText(row);
  const applyAllowed = bool(row.apply_allowed ?? row.applyable);

  if (hasAny(text, ["purge", "hard_delete", "hard-delete", "destroy", "drop_table", "force_delete"])) {
    return "destructive";
  }
  if (hasAny(text, ["credential", "secret", "token_rotate", "rotate_secret", "promote_tenant_binding", "credential_intake"])) {
    return "credential_touching";
  }
  if (hasAny(text, ["deploy", "deployment", "restart_app", "release_apply", "dns_write", "tunnel_create"])) {
    return "deployment_affecting";
  }

  const mutationHint = hasAny(text, [
    " create", "create_", ".create", " update", "update_", ".update", " write", "write_", ".write",
    "publish", "send", "delete", "revoke", "rotate", "merge", "comment", "label", "install", "activate",
    "approve", "transition", "sync", "promote", "execute", "apply", "dispatch", "enqueue", "assign",
  ]);
  const previewHint = hasAny(text, ["preview", "dry_run", "dry-run", "decision_brief", "plan_only", "preflight"]);
  const readHint = hasAny(text, [
    " read", "read_", ".read", " list", "list_", ".list", " get", "get_", ".get", " search", "search_",
    "inspect", "status", "report", "diagnostic", "health", "audit", "lookup", "resolve", "catalog", "inventory",
  ]);

  if (previewHint && !applyAllowed && !mutationHint) return "preview_only";
  if (readHint && !applyAllowed && !mutationHint) return "read_only";

  if (mutationHint || applyAllowed) {
    const external = hasAny(text, [
      "wordpress", "github", "cloudflare", "hostinger", "google_ads", "google ads", "gmail", "email", "n8n",
      "provider", "connector", "drive", "sheets", "remote_runtime", "remote runtime",
    ]);
    const workspace = hasAny(text, ["workspace", "brand", "tenant_private", "resource_grant", "resource grant"]);
    if (external) return "external_write";
    if (workspace) return "workspace_write";
    return "internal_write";
  }

  return "unclassified";
}

function explicitRiskRank(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (Object.hasOwn(RISK_RANK, normalized)) return RISK_RANK[normalized];
  const lower = normalized.toLowerCase();
  if (lower.includes("critical") || lower.includes("privileged")) return RISK_RANK.D;
  if (lower.includes("high")) return RISK_RANK.C;
  if (lower.includes("medium")) return RISK_RANK.B;
  if (lower.includes("low") || lower.includes("read")) return RISK_RANK.A;
  return -1;
}

export function classifyCapabilityRisk(row = {}, effectClass = classifyCapabilityEffect(row)) {
  const effectFloor = {
    unclassified: RISK_RANK.C,
    read_only: RISK_RANK.A,
    preview_only: RISK_RANK.A,
    internal_write: RISK_RANK.B,
    workspace_write: RISK_RANK.C,
    external_write: RISK_RANK.C,
    credential_touching: RISK_RANK.D,
    deployment_affecting: RISK_RANK.D,
    destructive: RISK_RANK.E,
  }[effectClass] ?? RISK_RANK.C;
  const text = rowText(row);
  const semanticFloor = hasAny(text, ["publish", "send", "spend", "merge", "deploy", "restart", "credential", "secret"])
    ? RISK_RANK.D
    : effectFloor;
  const rank = Math.max(effectFloor, semanticFloor, explicitRiskRank(row.risk_class));
  return Object.entries(RISK_RANK).find(([, value]) => value === rank)?.[0] || "C";
}

export function compileCapabilityRequirements(row = {}, effectClass = classifyCapabilityEffect(row), riskClass = classifyCapabilityRisk(row, effectClass)) {
  const authorityType = String(row.authority_requirement_type || "none").toLowerCase();
  const stateChanging = EFFECT_RANK[effectClass] > 0;
  const external = ["external_write", "credential_touching", "deployment_affecting", "destructive"].includes(effectClass);
  const riskRank = RISK_RANK[riskClass] ?? RISK_RANK.C;
  const text = rowText(row);
  return {
    scope_guard: true,
    resource_binding: bool(row.resource_authority_required) || ["resource", "combined"].includes(authorityType),
    validated_connection: external,
    credential_reference: external,
    approval_mode: riskRank >= RISK_RANK.D
      ? "explicit_scoped"
      : riskRank >= RISK_RANK.C && stateChanging
        ? "per_request_or_policy_bounded"
        : stateChanging
          ? "bounded_policy_or_typed_confirmation"
          : "none",
    typed_confirmation: riskRank >= RISK_RANK.D,
    capability_envelope: stateChanging || authorityType !== "none",
    idempotency: stateChanging,
    certification: external,
    audit: bool(row.requires_audit_evidence) || stateChanging,
    readback: bool(row.requires_readback) || stateChanging,
    rollback: riskRank >= RISK_RANK.D,
    compensation: external,
    quota: ["quota", "combined"].includes(authorityType) || hasAny(text, ["google_ads", "spend", "budget", "quota"]),
  };
}

function severityForRisk(riskClass, fallback = "medium") {
  if (riskClass === "E") return "critical";
  if (riskClass === "D") return "high";
  if (riskClass === "C") return "medium";
  return fallback;
}

function addGap(gaps, seen, row, code, description, severity = "medium") {
  const key = `${String(row.capability_key || "unknown")}|${code}`;
  if (seen.has(key)) return;
  seen.add(key);
  gaps.push({
    capability_key: String(row.capability_key || "unknown"),
    gap_key: code,
    gap_severity: severity,
    gap_description: description,
    source_table: row.source_table || null,
    source_key: row.source_key || null,
    blocks_dispatch: ["critical", "high"].includes(severity),
  });
}

export function compileCapabilityManifest(row = {}) {
  const effectClass = classifyCapabilityEffect(row);
  const riskClass = classifyCapabilityRisk(row, effectClass);
  const requirements = compileCapabilityRequirements(row, effectClass, riskClass);
  const gaps = [];
  const seen = new Set();
  const stateChanging = EFFECT_RANK[effectClass] > 0;
  const authorityType = String(row.authority_requirement_type || "none").toLowerCase();

  if (!String(row.capability_key || "").trim()) {
    addGap(gaps, seen, row, "CAPABILITY_IDENTITY_MISSING", "Surface has no canonical capability identity.", "critical");
  }
  if (effectClass === "unclassified") {
    addGap(gaps, seen, row, "MUTATION_CLASSIFICATION_REQUIRED", "Capability effect could not be classified deterministically.", "high");
  }
  if (stateChanging && authorityType === "none" && !bool(row.requires_audit_evidence) && !bool(row.requires_readback)) {
    addGap(gaps, seen, row, "MUTATION_POLICY_REQUIRED", "State-changing capability lacks explicit authority, audit, and readback declarations.", severityForRisk(riskClass, "high"));
  }
  if (String(row.exposure_scope || "").toLowerCase() === "tenant" && String(row.source_table || "") === "admin_platform_endpoint_tools") {
    addGap(gaps, seen, row, "TENANT_TO_ADMIN_SURFACE_BLOCKED", "Tenant exposure points at an Admin-only tool source.", "critical");
  }
  if (requirements.resource_binding && !bool(row.resource_binding_ready)) {
    addGap(gaps, seen, row, "RESOURCE_AUTHORITY_MISSING", "Capability-specific effective resource authority is missing.", severityForRisk(riskClass, "high"));
  }
  if (requirements.certification && !bool(row.certified)) {
    addGap(gaps, seen, row, "CERTIFICATION_REQUIRED", "External or privileged capability lacks a current generic certification.", severityForRisk(riskClass, "high"));
  }
  if (requirements.readback && !bool(row.readback_contract_ready)) {
    addGap(gaps, seen, row, "READBACK_CONTRACT_REQUIRED", "State-changing capability lacks a current readback contract.", severityForRisk(riskClass, "high"));
  }
  if (!bool(row.provenance_ready)) {
    addGap(gaps, seen, row, "PROVENANCE_MISSING", "Capability has no resolved canonical source link.", "medium");
  }
  if (["admin", "tenant"].includes(String(row.exposure_scope || "").toLowerCase()) && !bool(row.exported)) {
    addGap(gaps, seen, row, "ACTIVE_EXPORT_MISSING", "Exposed capability has no active public export.", "low");
  }
  if (!bool(row.dispatchable ?? row.dispatch_allowed)) {
    addGap(gaps, seen, row, "DISPATCH_NOT_ALLOWED", "Capability is registered but dispatch is not currently allowed.", severityForRisk(riskClass));
  }
  if (Number(row.hard_block_count || 0) > 0) {
    addGap(gaps, seen, row, "HARD_BLOCK_PRESENT", "Current readiness vector contains one or more hard blocks.", "high");
  }

  const blocking = gaps.some((gap) => gap.blocks_dispatch);
  const exposureScope = String(row.exposure_scope || "internal").toLowerCase();
  const projection = {
    admin: exposureScope === "admin" ? (blocking ? "blocked" : "candidate") : "not_applicable",
    tenant: exposureScope === "tenant" && String(row.source_table || "") !== "admin_platform_endpoint_tools"
      ? (blocking ? "blocked" : "candidate")
      : "not_applicable",
  };
  const rolloutMode = bool(row.applyable ?? row.apply_allowed)
    ? "active"
    : bool(row.dispatchable ?? row.dispatch_allowed)
      ? "shadow"
      : "disabled";

  const manifestWithoutHash = {
    capability_key: String(row.capability_key || ""),
    display_name: row.display_name || null,
    capability_family: row.capability_family || null,
    source: {
      table: row.source_table || null,
      key: row.source_key || null,
    },
    effect_class: effectClass,
    risk_class: riskClass,
    authority_requirement_type: authorityType,
    requirements,
    projection,
    rollout_mode: rolloutMode,
    readiness: {
      discoverable: bool(row.discoverable),
      registered: bool(row.registered),
      exported: bool(row.exported),
      routable: bool(row.routable),
      resource_binding_ready: bool(row.resource_binding_ready),
      dispatchable: bool(row.dispatchable ?? row.dispatch_allowed),
      applyable: bool(row.applyable ?? row.apply_allowed),
      readback_contract_ready: bool(row.readback_contract_ready),
      certified: bool(row.certified),
      provenance_ready: bool(row.provenance_ready),
      evidence_linked: bool(row.evidence_linked),
      hard_block_count: Number(row.hard_block_count || 0),
    },
    status: blocking ? "blocked" : "shadow_ready",
    secrets_included: false,
  };
  return {
    manifest: { ...manifestWithoutHash, manifest_hash: stableCapabilityHash(manifestWithoutHash) },
    gaps,
  };
}

function buildQuery(args, limit) {
  const conditions = [];
  const params = [];
  const capabilityKey = String(args.capability_key || "").trim();
  const sourceTable = String(args.source_table || "").trim();
  const afterKey = String(args.after_key || "").trim();
  if (capabilityKey) {
    conditions.push("capability_key = ?");
    params.push(capabilityKey);
  }
  if (sourceTable) {
    conditions.push("source_table = ?");
    params.push(sourceTable);
  }
  if (afterKey) {
    conditions.push("capability_key > ?");
    params.push(afterKey);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit + 1);
  return {
    sql: `SELECT capability_key, display_name, capability_family, source_table, source_key,
                 operation_class, risk_class, runtime_status, exposure_scope, authority_requirement_type,
                 resource_authority_required, discoverable, registered, exported, routable, authority_model_ready,
                 resource_binding_ready, dispatchable, applyable, readback_contract_ready, certified,
                 provenance_ready, evidence_linked, dispatch_allowed, apply_allowed, requires_audit_evidence,
                 requires_readback, legacy_evidence_ref, hard_block_count
            FROM v_platform_capability_readiness_vector
            ${where}
           ORDER BY capability_key
           LIMIT ?`,
    params,
  };
}

export async function buildDynamicCapabilityGovernancePreview(args = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const limit = Math.max(1, Math.min(Number(args.limit || 50), 200));
  const gapLimit = Math.max(1, Math.min(Number(args.gap_limit || 200), 500));
  const query = buildQuery(args, limit);
  const rows = rowsOf(await pool.query(query.sql, query.params));
  const hasMore = rows.length > limit;
  const selected = rows.slice(0, limit);
  const compiled = selected.map(compileCapabilityManifest);
  const manifests = compiled.map((item) => item.manifest);
  const allGaps = compiled.flatMap((item) => item.gaps);
  const gaps = allGaps.slice(0, gapLimit);
  const nextCursor = hasMore ? manifests.at(-1)?.capability_key || null : null;
  const sourceRevisionHash = stableCapabilityHash(selected.map((row) => ({
    capability_key: row.capability_key,
    source_table: row.source_table,
    source_key: row.source_key,
    runtime_status: row.runtime_status,
    dispatch_allowed: bool(row.dispatch_allowed),
    apply_allowed: bool(row.apply_allowed),
    hard_block_count: Number(row.hard_block_count || 0),
  })));

  return {
    ok: true,
    report_type: "dynamic_capability_governance_compile_preview",
    compiler_version: DYNAMIC_CAPABILITY_GOVERNANCE_COMPILER_VERSION,
    mode: "dry_run",
    observed_at: typeof deps.now === "function" ? deps.now() : new Date().toISOString(),
    filters: {
      capability_key: String(args.capability_key || "") || null,
      source_table: String(args.source_table || "") || null,
      after_key: String(args.after_key || "") || null,
      limit,
      gap_limit: gapLimit,
    },
    counts: {
      source_rows: selected.length,
      manifest_count: manifests.length,
      gap_count: allGaps.length,
      returned_gap_count: gaps.length,
      blocked_manifest_count: manifests.filter((item) => item.status === "blocked").length,
      shadow_ready_manifest_count: manifests.filter((item) => item.status === "shadow_ready").length,
    },
    source_revision_hash: sourceRevisionHash,
    page: {
      next_cursor: nextCursor,
      has_more: hasMore,
      final_result_complete: !hasMore,
    },
    manifests,
    gaps,
    guarantees: {
      registry: "mysql_primary",
      runtime_dispatch_performed: false,
      mutations_performed: false,
      provider_calls_performed: false,
      callable_exports_created: false,
      tenant_authority_changed: false,
      fail_closed: true,
      secrets_included: false,
    },
    secrets_included: false,
  };
}
