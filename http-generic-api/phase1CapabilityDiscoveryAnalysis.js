import {
  classifyMutationPolicyRequirement,
  hasDeclaredMutationPolicy,
} from "./governedExecutionPreflight.js";
import { clampDiscoveryInteger } from "./phase1CapabilityDiscoverySources.js";

function first(row, candidates = []) {
  for (const key of candidates) {
    if (row?.[key] !== undefined && row?.[key] !== null && String(row[key]).trim() !== "") return row[key];
  }
  return null;
}

function tagsOf(value) {
  if (Array.isArray(value)) return [...new Set(value.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean))];
  if (value && typeof value === "object") return [...new Set(Object.keys(value).map((item) => item.trim().toLowerCase()).filter(Boolean))];
  const text = String(value || "").trim();
  if (!text) return [];
  if (/^[\[{]/.test(text)) {
    try { return tagsOf(JSON.parse(text)); } catch { /* delimiter fallback */ }
  }
  return [...new Set(text.split(/[|,;]/).map((item) => item.trim().toLowerCase()).filter(Boolean))];
}

function recordOf(source, row) {
  const tags = tagsOf(first(row, source.tag_candidates));
  const method = String(first(row, source.method_candidates) || "").trim().toUpperCase() || null;
  const key = String(first(row, source.key_candidates) || "").trim();
  const parentKey = String(first(row, source.parent_candidates) || "").trim() || null;
  const mutation = classifyMutationPolicyRequirement({ method: method || "", tags });
  const declared = hasDeclaredMutationPolicy({ tags });
  const extras = Object.fromEntries(
    source.extra_candidates
      .filter((candidate) => row?.[candidate] !== undefined && row?.[candidate] !== null)
      .map((candidate) => [candidate, row[candidate]]),
  );
  return {
    source: source.source,
    surface_family: source.surface_family,
    key,
    parent_key: parentKey,
    capability_identity: parentKey || key,
    method,
    path: String(first(row, source.path_candidates) || "").trim() || null,
    tags,
    exposure_scope: String(first(row, source.exposure_candidates) || source.exposure_default || "").trim().toLowerCase() || null,
    mutation_requirement: mutation,
    mutation_policy_declared: declared,
    mutation_policy_gap: mutation.required === true && !declared,
    extras,
  };
}

function policyState(record) {
  if (record.mutation_requirement.required === null) return "unclassified";
  if (!record.mutation_requirement.required) return "read_only";
  return record.mutation_policy_declared ? "declared_mutation" : "undeclared_mutation";
}

function dualSurfaceFindings(records) {
  const groups = new Map();
  for (const record of records) {
    const identity = String(record.capability_identity || "").trim().toLowerCase();
    if (!identity) continue;
    if (!groups.has(identity)) groups.set(identity, []);
    groups.get(identity).push(record);
  }
  return [...groups.entries()].flatMap(([identity, group]) => {
    const families = [...new Set(group.map((item) => item.surface_family))];
    if (families.length < 2) return [];
    const states = [...new Set(group.map(policyState))];
    const parity_status = states.includes("undeclared_mutation")
      ? "mutation_policy_gap"
      : states.includes("read_only") && states.includes("declared_mutation")
        ? "policy_mismatch"
        : states.includes("unclassified")
          ? "classification_incomplete"
          : "aligned";
    return [{
      capability_identity: identity,
      surface_families: families,
      policy_states: states,
      parity_status,
      surfaces: group.map((item) => ({
        source: item.source,
        key: item.key,
        method: item.method,
        path: item.path,
        exposure_scope: item.exposure_scope,
        policy_state: policyState(item),
      })),
    }];
  }).sort((a, b) => a.parity_status.localeCompare(b.parity_status) || a.capability_identity.localeCompare(b.capability_identity));
}

function tenantAdminFindings(records) {
  const admin = records.filter((record) => record.surface_family === "admin_tool");
  const adminKeys = new Set(admin.map((record) => record.key.toLowerCase()).filter(Boolean));
  const adminPaths = new Set(admin.map((record) => String(record.path || "").toLowerCase()).filter(Boolean));
  const findings = [];
  for (const record of records) {
    const exposure = String(record.exposure_scope || "").toLowerCase();
    if (!["tenant", "both"].includes(exposure) && record.surface_family !== "tenant_tool") continue;
    const reasons = [];
    if (record.tags.includes("admin") || record.tags.includes("admin_only")) reasons.push("admin_tag");
    if (adminKeys.has(record.key.toLowerCase())) reasons.push("admin_tool_key_overlap");
    if (record.path && adminPaths.has(record.path.toLowerCase())) reasons.push("admin_http_path_overlap");
    if (
      record.surface_family === "app_tool_binding" &&
      ["admin_platform_tool", "device_tool", "virtual_tool"].includes(String(record.extras.tool_surface || ""))
    ) reasons.push("admin_or_device_tool_bound_to_tenant_scope");
    if (reasons.length) {
      findings.push({
        source: record.source,
        key: record.key,
        parent_key: record.parent_key,
        exposure_scope: record.exposure_scope,
        method: record.method,
        path: record.path,
        reasons: [...new Set(reasons)],
        mutation_policy_gap: record.mutation_policy_gap,
      });
    }
  }
  return findings.sort((a, b) => a.key.localeCompare(b.key));
}

export function analyzePhase1CapabilityRecords(inventories = [], { limit = 100 } = {}) {
  const outputLimit = clampDiscoveryInteger(limit, 100, 1, 500);
  const records = inventories.flatMap((source) => source.rows.map((row) => recordOf(source, row)));
  const complete = inventories.every((source) => source.source_status === "ready" && !source.truncated);
  const dual = dualSurfaceFindings(records);
  const tenantVisibleAdmin = tenantAdminFindings(records);
  const mutationGaps = records.filter((record) => record.mutation_policy_gap).map((record) => ({
    source: record.source,
    key: record.key,
    parent_key: record.parent_key,
    method: record.method,
    path: record.path,
    exposure_scope: record.exposure_scope,
    tags: record.tags,
    classification: record.mutation_requirement.classification,
  })).sort((a, b) => a.key.localeCompare(b.key));
  const unclassified = records.filter((record) => record.mutation_requirement.required === null).map((record) => ({
    source: record.source,
    key: record.key,
    method: record.method,
    tags: record.tags,
    classification: record.mutation_requirement.classification,
  })).sort((a, b) => a.key.localeCompare(b.key));
  const activeCount = inventories.reduce((sum, source) => sum + Number(source.total_active || 0), 0);

  return {
    inventory: {
      complete,
      active_surface_count: activeCount,
      scanned_surface_count: records.length,
      source_count: inventories.length,
      source_truncation_count: inventories.filter((source) => source.truncated).length,
      unavailable_source_count: inventories.filter((source) => source.source_status !== "ready").length,
      sources: inventories.map((source) => ({
        source: source.source,
        table: source.table,
        surface_family: source.surface_family,
        source_status: source.source_status,
        total_active: source.total_active,
        scanned_count: source.scanned_count,
        truncated: source.truncated,
      })),
    },
    task_evidence: {
      T011: { status: complete ? "complete" : "partial", active_alias_surface_count: activeCount, source_count: inventories.length },
      T012: { status: complete ? "complete" : "partial", dual_surface_capability_count: dual.length, mismatch_count: dual.filter((item) => item.parity_status !== "aligned").length, items: dual.slice(0, outputLimit) },
      T013: { status: complete ? "complete" : "partial", tenant_visible_admin_count: tenantVisibleAdmin.length, items: tenantVisibleAdmin.slice(0, outputLimit) },
      T014: { status: complete ? "complete" : "partial", mutation_policy_gap_count: mutationGaps.length, mutation_classification_missing_count: unclassified.length, gaps: mutationGaps.slice(0, outputLimit), unclassified: unclassified.slice(0, outputLimit) },
    },
    records_scanned: records.length,
  };
}
