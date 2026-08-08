import { createHash } from "node:crypto";

const SEVERITIES = new Set(["info", "low", "medium", "high", "critical"]);

function text(value = "", max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function sha256(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function severity(value) {
  const normalized = text(value, 32).toLowerCase();
  return SEVERITIES.has(normalized) ? normalized : "medium";
}

function repairContract(gapKey) {
  switch (gapKey) {
    case "dispatch_not_allowed":
      return { repair_class: "platform_admin_required", recommended_next_action: "capability.review_runtime_dispatch", requires_approval: true };
    case "authority_evidence_missing":
      return { repair_class: "platform_admin_required", recommended_next_action: "capability.review_resource_authority", requires_approval: true };
    case "active_export_missing":
      return { repair_class: "platform_admin_required", recommended_next_action: "capability.review_export_binding", requires_approval: true };
    default:
      return { repair_class: "platform_admin_required", recommended_next_action: "capability.review_registry_gap", requires_approval: true };
  }
}

function customerSummary(row = {}) {
  const name = text(row.display_name || row.capability_key, 191) || "Capability";
  switch (text(row.gap_key, 128).toLowerCase()) {
    case "dispatch_not_allowed": return `${name} is registered but is not currently executable.`;
    case "authority_evidence_missing": return `${name} requires governed authority verification before it can be used for the affected operation.`;
    case "active_export_missing": return `${name} is not currently exposed through an active tenant-safe runtime surface.`;
    default: return `${name} has a capability-readiness gap that requires review.`;
  }
}

export function buildCapabilityDriftSignals(rows = [], {
  principalScope = "admin",
  tenantId = null,
  generatedAt = new Date(),
} = {}) {
  const generatedAtIso = generatedAt instanceof Date ? generatedAt.toISOString() : new Date(generatedAt).toISOString();
  const tenantFacing = principalScope === "tenant";
  const visibleRows = (Array.isArray(rows) ? rows : []).filter((row) => !tenantFacing || text(row.exposure_scope, 64).toLowerCase() === "tenant");

  return visibleRows.map((row) => {
    const capabilityKey = text(row.capability_key, 255);
    const gapKey = text(row.gap_key, 128).toLowerCase() || "capability_gap";
    const dedupeKey = `capability-drift.${sha256([tenantFacing ? tenantId || "tenant" : "admin", capabilityKey, gapKey].join("|"))}`;
    const repair = repairContract(gapKey);
    return Object.freeze({
      signal_id: dedupeKey,
      dedupe_key: dedupeKey,
      tenant_id: tenantFacing ? tenantId || null : null,
      workspace_id: null,
      resource: Object.freeze({ type: "platform_capability", key: capabilityKey }),
      source_domain: "platform_capability_registry",
      source_ref: `capability-gap://${encodeURIComponent(capabilityKey)}/${encodeURIComponent(gapKey)}`,
      evidence_timestamp: generatedAtIso,
      severity: severity(row.gap_severity),
      lifecycle_state: "observed_snapshot",
      first_seen_at: null,
      last_seen_at: generatedAtIso,
      occurrence_count: null,
      safe_customer_summary: customerSummary(row),
      recommended_next_action: repair.recommended_next_action,
      auto_repair: Object.freeze({ eligible: false, repair_class: repair.repair_class, requires_approval: repair.requires_approval, execution_linked: false }),
      persistence: Object.freeze({ status: "snapshot_only", canonical_target: "operational_alerts" }),
      admin_evidence: tenantFacing ? null : Object.freeze({
        capability_family: row.capability_family || null,
        source_table: row.source_table || null,
        source_key: row.source_key || null,
        runtime_status: row.runtime_status || null,
        exposure_scope: row.exposure_scope || null,
        operation_class: row.operation_class || null,
        risk_class: row.risk_class || null,
        maturity_status: row.maturity_status || null,
        maturity_score: row.maturity_score === null || row.maturity_score === undefined ? null : Number(row.maturity_score),
        gap_flags: row.gap_flags || null,
        evidence_ref: row.evidence_ref || null,
      }),
      secrets_included: false,
    });
  });
}

export const _testingCapabilityDriftSignalProjection = { severity, repairContract, customerSummary };
