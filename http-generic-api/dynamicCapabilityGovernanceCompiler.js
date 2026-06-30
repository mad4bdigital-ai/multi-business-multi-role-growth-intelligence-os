import crypto from "node:crypto";
import { getPool } from "./db.js";

export const DYNAMIC_CAPABILITY_GOVERNANCE_COMPILER_VERSION = "dynamic-capability-governance-compiler-v2";

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

const READ_TOKENS = Object.freeze([
  "read", "list", "get", "search", "inspect", "status", "report", "diagnostic", "health",
  "audit", "lookup", "resolve", "catalog", "inventory", "validate", "probe", "extract", "check",
]);
const MUTATION_TOKENS = Object.freeze([
  "create", "update", "upsert", "write", "publish", "send", "delete", "revoke", "rotate", "merge",
  "comment", "label", "install", "activate", "approve", "transition", "sync", "promote", "execute",
  "apply", "dispatch", "enqueue", "assign", "record", "consume", "repair", "link", "request", "ack",
  "acknowledge", "escalate", "disable", "enable", "finalize", "cleanup", "reset", "set", "close",
]);
const DESTRUCTIVE_TOKENS = Object.freeze(["purge", "delete", "destroy", "drop", "wipe", "erase"]);
const CREDENTIAL_TOKENS = Object.freeze(["credential", "credentials", "secret", "secrets", "token", "password", "oauth"]);
const DEPLOYMENT_TOKENS = Object.freeze(["deploy", "deployment", "restart", "release", "dns", "tunnel", "traffic"]);
const EXTERNAL_TOKENS = Object.freeze([
  "wordpress", "github", "cloudflare", "hostinger", "google", "ads", "gmail", "email", "n8n",
  "provider", "connector", "drive", "sheets", "remote", "browser",
]);
const WORKSPACE_TOKENS = Object.freeze(["workspace", "brand", "tenant", "resource", "grant", "membership", "site"]);

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

function normalizeSemanticText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value) {
  const normalized = normalizeSemanticText(value);
  return new Set(normalized ? normalized.split(" ") : []);
}

function hasAnyToken(tokens, candidates) {
  return candidates.some((candidate) => tokens.has(candidate));
}

function hasAnyPhrase(text, phrases) {
  return phrases.some((phrase) => text === phrase || text.startsWith(`${phrase} `) || text.endsWith(` ${phrase}`) || text.includes(` ${phrase} `));
}

export function classifyCapabilityEffect(row = {}) {
  const semanticText = normalizeSemanticText(rowText(row));
  const operationText = normalizeSemanticText(row.operation_class);
  const combinedText = `${operationText} ${semanticText}`.trim();
  const tokens = tokenSet(combinedText);
  const applyAllowed = bool(row.apply_allowed ?? row.applyable);

  const previewHint = hasAnyPhrase(combinedText, ["dry run", "plan only", "decision brief"])
    || hasAnyToken(tokens, ["preview", "preflight", "simulation", "blueprint"]);
  const mutationHint = applyAllowed
    || hasAnyPhrase(combinedText, ["state changing"])
    || hasAnyToken(tokens, MUTATION_TOKENS);
  const readHint = hasAnyToken(tokens, READ_TOKENS);
  const destructiveHint = hasAnyToken(tokens, DESTRUCTIVE_TOKENS);
  const credentialHint = hasAnyToken(tokens, CREDENTIAL_TOKENS);
  const deploymentHint = hasAnyToken(tokens, DEPLOYMENT_TOKENS);

  if (previewHint && !applyAllowed) return "preview_only";
  if (readHint && !applyAllowed && !mutationHint) return "read_only";

  if (mutationHint) {
    if (destructiveHint) return "destructive";
    if (credentialHint) return "credential_touching";
    if (deploymentHint) return "deployment_affecting";
    if (hasAnyToken(tokens, EXTERNAL_TOKENS)) return "external_write";
    if (hasAnyToken(tokens, WORKSPACE_TOKENS)) return "workspace_write";
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
  const tokens = tokenSet(rowText(row));
  const semanticFloor = hasAnyToken(tokens, ["publish", "send", "spend", "merge", "deploy", "restart", "credential", "secret"])
    ? RISK_RANK.D
    : effectFloor;
  const rank = Math.max(effectFloor, semanticFloor, explicitRiskRank(row.risk_class));
  return Object.entries(RISK_RANK).find(([, value]) => value === rank)?.[0] || "C";
}

export function compileCapabilityRequirements(row = {}, effectClass = classifyCapabilityEffect(row), riskClass = classifyCapabilityRisk(row, effectClass)) {
  const authorityType = String(row.authority_requirement_type || "none").toLowerCase();
  const stateChanging = EFFECT_RANK[effectClass] > 0;
  const external = stateChanging && ["external_write", "credential_touching", "deployment_affecting", "destructive"].includes(effectClass);
  const riskRank = RISK_RANK[riskClass] ?? RISK_RANK.C;
  const tokens = tokenSet(rowText(row));
  const resourceBinding = bool(row.resource_authority_required) || ["resource", "combined"].includes(authorityType);

  return {
    scope_guard: true,
    resource_binding: resourceBinding,
    validated_connection: external,
    credential_reference: external,
    approval_mode: !stateChanging
      ? "none"
      : riskRank >= RISK_RANK.D
        ? "explicit_scoped"
        : riskRank >= RISK_RANK.C
          ? "per_request_or_policy_bounded"
          : "bounded_policy_or_typed_confirmation",
    typed_confirmation: stateChanging && riskRank >= RISK_RANK.D,
    capability_envelope: stateChanging || resourceBinding || ["approval", "quota", "combined"].includes(authorityType),
    idempotency: stateChanging,
    certification: external,
    audit: stateChanging || bool(row.requires_audit_evidence),
    readback: stateChanging,
    rollback: stateChanging && riskRank >= RISK_RANK.D,
    compensation: external,
    quota: stateChanging && (["quota", "combined"].includes(authorityType) || hasAnyToken(tokens, ["google", "ads", "spend", "budget", "quota"])),
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

function countBy(items, selector) {
  const counts = {};
  for (const item of items) {
    const key = String(selector(item) || "unknown");
    counts[key] = Number(counts[key] || 0) + 1;
  }
  return counts;
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
    distributions: {
      effect_class: countBy(manifests, (item) => item.effect_class),
      risk_class: countBy(manifests, (item) => item.risk_class),
      gap_key: countBy(allGaps, (item) => item.gap_key),
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
