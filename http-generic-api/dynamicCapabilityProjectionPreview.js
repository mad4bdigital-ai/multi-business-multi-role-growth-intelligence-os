import { getPool } from "./db.js";
import { stableCapabilityHash } from "./dynamicCapabilityGovernanceCompiler.js";

export const DYNAMIC_CAPABILITY_PROJECTION_PREVIEW_VERSION = "dynamic-capability-projection-preview-v1";

const VALID_TARGET_SCOPES = new Set(["all", "admin", "tenant"]);
const BLOCKING_SEVERITIES = new Set(["critical", "high"]);

function rowsOf(result) {
  return Array.isArray(result?.[0]) ? result[0] : [];
}

function bool(value) {
  return value === true || Number(value || 0) === 1 || String(value || "").toLowerCase() === "true";
}

function parseJson(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return { ok: true, value };
  if (!String(value || "").trim()) return { ok: false, value: null };
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { ok: true, value: parsed }
      : { ok: false, value: null };
  } catch {
    return { ok: false, value: null };
  }
}

function previewError(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function normalizeTargetScope(value) {
  const scope = String(value || "all").trim().toLowerCase();
  if (!VALID_TARGET_SCOPES.has(scope)) {
    throw previewError(400, "capability_projection_target_scope_invalid", "target_scope must be all, admin, or tenant.");
  }
  return scope;
}

function scopeRequested(targetScope, scope) {
  return targetScope === "all" || targetScope === scope;
}

function placeholders(values) {
  return values.map(() => "?").join(", ");
}

function targetToolKey(manifest) {
  const sourceKey = String(manifest?.source?.key || "").trim();
  if (sourceKey) return sourceKey;
  const capabilityKey = String(manifest?.capability_key || "").trim();
  const separator = capabilityKey.indexOf(".");
  return separator >= 0 ? capabilityKey.slice(separator + 1) : capabilityKey;
}

function schemaSummary(inputSchema) {
  if (!String(inputSchema || "").trim()) {
    return {
      status: "missing",
      present: false,
      strict_object: false,
      top_level_type: null,
      property_count: 0,
      required_count: 0,
      schema_hash: null,
    };
  }
  const parsed = parseJson(inputSchema);
  if (!parsed.ok) {
    return {
      status: "invalid",
      present: true,
      strict_object: false,
      top_level_type: null,
      property_count: 0,
      required_count: 0,
      schema_hash: null,
    };
  }
  const schema = parsed.value;
  const propertyCount = schema.properties && typeof schema.properties === "object"
    ? Object.keys(schema.properties).length
    : 0;
  const requiredCount = Array.isArray(schema.required) ? schema.required.length : 0;
  const strictObject = schema.type === "object" && schema.additionalProperties === false;
  return {
    status: strictObject ? "strict" : "broad",
    present: true,
    strict_object: strictObject,
    top_level_type: typeof schema.type === "string" ? schema.type : null,
    property_count: propertyCount,
    required_count: requiredCount,
    schema_hash: stableCapabilityHash(schema),
  };
}

function exportScope(row) {
  const explicit = String(row.exposure_scope || "").trim().toLowerCase();
  if (explicit === "admin" || explicit === "tenant") return explicit;
  const surface = String(row.export_surface || "").trim().toLowerCase();
  if (surface.includes("tenant")) return "tenant";
  if (surface.includes("admin")) return "admin";
  return "internal";
}

function exportSummary(rows, scope) {
  const scoped = rows.filter((row) => exportScope(row) === scope);
  const active = scoped.filter((row) => String(row.export_status || "").toLowerCase() === "active");
  return {
    total_count: scoped.length,
    active_count: active.length,
    statuses: [...new Set(scoped.map((row) => String(row.export_status || "unknown")))].sort(),
    export_keys: scoped.map((row) => String(row.export_key || "")).filter(Boolean).sort().slice(0, 10),
  };
}

function catalogSummary(row) {
  if (!row) {
    return {
      present: false,
      enabled: false,
      tool_key: null,
      method: null,
      path: null,
      schema: schemaSummary(null),
    };
  }
  return {
    present: true,
    enabled: bool(row.is_enabled),
    tool_key: String(row.tool_key || "") || null,
    method: String(row.http_method || "") || null,
    path: String(row.http_path || "") || null,
    schema: schemaSummary(row.input_schema),
  };
}

function addGap(gaps, seen, {
  capabilityKey,
  scope,
  code,
  severity,
  description,
  manifestHash,
  targetToolKey: toolKey,
}) {
  const identity = `${capabilityKey}|${scope}|${code}`;
  if (seen.has(identity)) return;
  seen.add(identity);
  gaps.push({
    capability_key: capabilityKey,
    target_scope: scope,
    gap_key: code,
    gap_severity: severity,
    gap_description: description,
    manifest_hash: manifestHash || null,
    target_tool_key: toolKey || null,
    blocks_projection: BLOCKING_SEVERITIES.has(severity),
  });
}

function buildTargetProjection({
  manifest,
  manifestRow,
  scope,
  targetScope,
  catalogRow,
  exports,
  reconciliationRows,
  gaps,
  seen,
}) {
  if (!scopeRequested(targetScope, scope)) {
    return {
      eligibility: "not_evaluated",
      status: "not_evaluated",
      target_tool_key: targetToolKey(manifest),
      catalog: catalogSummary(null),
      exports: { total_count: 0, active_count: 0, statuses: [], export_keys: [] },
      existing_reconciliation: null,
    };
  }

  const capabilityKey = String(manifest.capability_key || manifestRow.capability_key || "");
  const manifestHash = String(manifestRow.manifest_hash || manifest.manifest_hash || "");
  const toolKey = targetToolKey(manifest);
  const eligibility = String(manifest?.projection?.[scope] || "not_applicable");
  const catalog = catalogSummary(catalogRow);
  const exportState = exportSummary(exports, scope);
  const existingReconciliation = reconciliationRows[0]
    ? {
        desired_export_status: reconciliationRows[0].desired_export_status || null,
        actual_export_status: reconciliationRows[0].actual_export_status || null,
        reconciliation_status: reconciliationRows[0].reconciliation_status || null,
        schema_present: bool(reconciliationRows[0].schema_present),
      }
    : null;

  let status = "not_applicable";
  if (eligibility === "blocked") status = "blocked_by_manifest";
  if (eligibility === "candidate") {
    if (!catalog.present) status = "missing_catalog_tool";
    else if (!catalog.enabled) status = "catalog_disabled";
    else if (scope === "tenant" && catalog.schema.status === "missing") status = "tenant_schema_missing";
    else if (scope === "tenant" && catalog.schema.status === "invalid") status = "tenant_schema_invalid";
    else if (scope === "tenant" && !catalog.schema.strict_object) status = "tenant_schema_not_strict";
    else status = "aligned_existing";
  }

  if (eligibility === "candidate" && !catalog.present) {
    addGap(gaps, seen, {
      capabilityKey,
      scope,
      code: scope === "tenant" ? "TENANT_PROJECTION_CATALOG_MISSING" : "ADMIN_PROJECTION_CATALOG_MISSING",
      severity: scope === "tenant" ? "medium" : "low",
      description: `Projection candidate has no matching ${scope} tool catalog row.`,
      manifestHash,
      targetToolKey: toolKey,
    });
  }
  if (eligibility === "candidate" && catalog.present && !catalog.enabled) {
    addGap(gaps, seen, {
      capabilityKey,
      scope,
      code: scope === "tenant" ? "TENANT_PROJECTION_CATALOG_DISABLED" : "ADMIN_PROJECTION_CATALOG_DISABLED",
      severity: "medium",
      description: `Projection candidate matches a disabled ${scope} tool catalog row.`,
      manifestHash,
      targetToolKey: toolKey,
    });
  }
  if (scope === "tenant" && eligibility === "candidate") {
    if (catalog.schema.status === "missing") {
      addGap(gaps, seen, {
        capabilityKey,
        scope,
        code: "TENANT_PROJECTION_SCHEMA_MISSING",
        severity: "high",
        description: "Tenant projection candidate has no bounded input schema.",
        manifestHash,
        targetToolKey: toolKey,
      });
    } else if (catalog.schema.status === "invalid") {
      addGap(gaps, seen, {
        capabilityKey,
        scope,
        code: "TENANT_PROJECTION_SCHEMA_INVALID",
        severity: "high",
        description: "Tenant projection candidate input schema is not valid JSON.",
        manifestHash,
        targetToolKey: toolKey,
      });
    } else if (!catalog.schema.strict_object) {
      addGap(gaps, seen, {
        capabilityKey,
        scope,
        code: "TENANT_PROJECTION_SCHEMA_NOT_STRICT",
        severity: "high",
        description: "Tenant projection candidate schema must be an object with additionalProperties=false.",
        manifestHash,
        targetToolKey: toolKey,
      });
    }
  }

  const sourceTable = String(manifest?.source?.table || "");
  if (
    scope === "tenant"
    && sourceTable === "admin_platform_endpoint_tools"
    && eligibility !== "candidate"
    && (catalog.enabled || exportState.active_count > 0)
  ) {
    status = "admin_source_inheritance_blocked";
    addGap(gaps, seen, {
      capabilityKey,
      scope,
      code: "TENANT_ADMIN_SOURCE_INHERITANCE_BLOCKED",
      severity: "critical",
      description: "Tenant projection cannot inherit authority from an Admin-only source surface.",
      manifestHash,
      targetToolKey: toolKey,
    });
  }

  if (eligibility !== "candidate" && exportState.active_count > 0) {
    status = "unsafe_active_export";
    addGap(gaps, seen, {
      capabilityKey,
      scope,
      code: scope === "tenant" ? "UNSAFE_ACTIVE_TENANT_EXPORT" : "UNSAFE_ACTIVE_ADMIN_EXPORT",
      severity: scope === "tenant" ? "critical" : "high",
      description: `Active ${scope} export exists while the current manifest is not projection-eligible.`,
      manifestHash,
      targetToolKey: toolKey,
    });
  }

  return {
    eligibility,
    status,
    target_tool_key: toolKey || null,
    catalog,
    exports: exportState,
    existing_reconciliation: existingReconciliation,
  };
}

function manifestQuery(args, limit) {
  const conditions = ["is_current = 1"];
  const params = [];
  const capabilityKey = String(args.capability_key || "").trim();
  const afterKey = String(args.after_key || "").trim();
  if (capabilityKey) {
    conditions.push("capability_key = ?");
    params.push(capabilityKey);
  }
  if (afterKey) {
    conditions.push("capability_key > ?");
    params.push(afterKey);
  }
  params.push(limit + 1);
  return {
    sql: `SELECT manifest_id, run_id, capability_key, manifest_version, manifest_hash,
                 source_revision_hash, compiler_version, effect_class, risk_class,
                 authority_requirement_type, status, rollout_mode, manifest_json, created_at
            FROM platform_capability_compiled_manifests
           WHERE ${conditions.join(" AND ")}
           ORDER BY capability_key
           LIMIT ?`,
    params,
  };
}

async function loadCatalog(pool, table, keys) {
  if (!keys.length) return [];
  return rowsOf(await pool.query(
    `SELECT tool_key, display_name, description, http_method, http_path, input_schema, tags, is_enabled
       FROM ${table}
      WHERE tool_key IN (${placeholders(keys)})`,
    keys
  ));
}

async function loadExports(pool, capabilityKeys, sourceKeys) {
  if (!capabilityKeys.length && !sourceKeys.length) return [];
  const conditions = [];
  const params = [];
  if (capabilityKeys.length) {
    conditions.push(`capability_key IN (${placeholders(capabilityKeys)})`);
    params.push(...capabilityKeys);
  }
  if (sourceKeys.length) {
    conditions.push(`source_key IN (${placeholders(sourceKeys)})`);
    params.push(...sourceKeys);
  }
  return rowsOf(await pool.query(
    `SELECT export_key, capability_key, export_surface, source_table, source_key,
            export_status, exposure_scope, http_method, http_path
       FROM platform_plugin_capability_exports
      WHERE ${conditions.join(" OR ")}`,
    params
  ));
}

async function loadExistingReconciliation(pool, capabilityKeys) {
  if (!capabilityKeys.length) return [];
  return rowsOf(await pool.query(
    `SELECT projection_key, capability_key, desired_export_status, schema_present,
            actual_export_key, actual_tool_name, actual_export_status, reconciliation_status
       FROM v_platform_capability_export_reconciliation
      WHERE capability_key IN (${placeholders(capabilityKeys)})`,
    capabilityKeys
  ));
}

function countBy(items, selector) {
  const result = {};
  for (const item of items) {
    const key = String(selector(item) || "unknown");
    result[key] = Number(result[key] || 0) + 1;
  }
  return result;
}

export async function buildDynamicCapabilityProjectionPreview(args = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const targetScope = normalizeTargetScope(args.target_scope);
  const limit = Math.max(1, Math.min(Number(args.limit || 50), 200));
  const gapLimit = Math.max(1, Math.min(Number(args.gap_limit || 200), 500));
  const includeAligned = args.include_aligned === undefined ? true : bool(args.include_aligned);
  const query = manifestQuery(args, limit);
  const manifestRows = rowsOf(await pool.query(query.sql, query.params));
  const hasMore = manifestRows.length > limit;
  const selectedRows = manifestRows.slice(0, limit);

  const parsedRows = selectedRows.map((row) => ({ row, parsed: parseJson(row.manifest_json) }));
  const sourceKeys = [...new Set(parsedRows
    .map(({ row, parsed }) => parsed.ok ? targetToolKey(parsed.value) : String(row.capability_key || "").split(".").slice(1).join("."))
    .filter(Boolean))];
  const capabilityKeys = [...new Set(selectedRows.map((row) => String(row.capability_key || "")).filter(Boolean))];

  const [adminCatalogRows, tenantCatalogRows, exportRows, reconciliationRows] = await Promise.all([
    loadCatalog(pool, "admin_platform_endpoint_tools", sourceKeys),
    loadCatalog(pool, "tenant_platform_endpoint_tools", sourceKeys),
    loadExports(pool, capabilityKeys, sourceKeys),
    loadExistingReconciliation(pool, capabilityKeys),
  ]);

  const adminCatalog = new Map(adminCatalogRows.map((row) => [String(row.tool_key || ""), row]));
  const tenantCatalog = new Map(tenantCatalogRows.map((row) => [String(row.tool_key || ""), row]));
  const reconciliationByCapability = new Map();
  for (const row of reconciliationRows) {
    const key = String(row.capability_key || "");
    if (!reconciliationByCapability.has(key)) reconciliationByCapability.set(key, []);
    reconciliationByCapability.get(key).push(row);
  }

  const gaps = [];
  const seen = new Set();
  const candidates = [];
  for (const { row, parsed } of parsedRows) {
    const capabilityKey = String(row.capability_key || "");
    if (!parsed.ok) {
      addGap(gaps, seen, {
        capabilityKey,
        scope: "manifest",
        code: "PROJECTION_MANIFEST_JSON_INVALID",
        severity: "critical",
        description: "Current persisted manifest JSON is invalid.",
        manifestHash: row.manifest_hash,
        targetToolKey: null,
      });
      candidates.push({
        capability_key: capabilityKey,
        manifest_id: row.manifest_id,
        manifest_hash: row.manifest_hash,
        source_revision_hash: row.source_revision_hash,
        status: "invalid_manifest",
        targets: {},
        blockers: ["PROJECTION_MANIFEST_JSON_INVALID"],
        secrets_included: false,
      });
      continue;
    }

    const manifest = parsed.value;
    const toolKey = targetToolKey(manifest);
    if (String(manifest.capability_key || "") !== capabilityKey) {
      addGap(gaps, seen, {
        capabilityKey,
        scope: "manifest",
        code: "PROJECTION_MANIFEST_IDENTITY_MISMATCH",
        severity: "critical",
        description: "Persisted manifest capability identity does not match its indexed capability key.",
        manifestHash: row.manifest_hash,
        targetToolKey: toolKey,
      });
    }
    if (String(manifest.manifest_hash || "") !== String(row.manifest_hash || "")) {
      addGap(gaps, seen, {
        capabilityKey,
        scope: "manifest",
        code: "PROJECTION_MANIFEST_HASH_MISMATCH",
        severity: "critical",
        description: "Persisted manifest hash does not match the indexed manifest hash.",
        manifestHash: row.manifest_hash,
        targetToolKey: toolKey,
      });
    }

    const relatedExports = exportRows.filter((item) =>
      String(item.capability_key || "") === capabilityKey || String(item.source_key || "") === toolKey
    );
    const relatedReconciliation = reconciliationByCapability.get(capabilityKey) || [];
    const admin = buildTargetProjection({
      manifest,
      manifestRow: row,
      scope: "admin",
      targetScope,
      catalogRow: adminCatalog.get(toolKey),
      exports: relatedExports,
      reconciliationRows: relatedReconciliation,
      gaps,
      seen,
    });
    const tenant = buildTargetProjection({
      manifest,
      manifestRow: row,
      scope: "tenant",
      targetScope,
      catalogRow: tenantCatalog.get(toolKey),
      exports: relatedExports,
      reconciliationRows: relatedReconciliation,
      gaps,
      seen,
    });
    const capabilityGaps = gaps.filter((gap) => gap.capability_key === capabilityKey);
    const blocking = capabilityGaps.some((gap) => gap.blocks_projection);
    const item = {
      capability_key: capabilityKey,
      manifest_id: row.manifest_id,
      manifest_version: Number(row.manifest_version || 0),
      manifest_hash: row.manifest_hash,
      source_revision_hash: row.source_revision_hash,
      display_name: manifest.display_name || null,
      capability_family: manifest.capability_family || null,
      effect_class: row.effect_class,
      risk_class: row.risk_class,
      manifest_status: row.status,
      rollout_mode: row.rollout_mode,
      source: manifest.source || { table: null, key: null },
      requirements: manifest.requirements || {},
      targets: { admin, tenant },
      status: blocking ? "blocked" : "shadow_candidate",
      blockers: capabilityGaps.filter((gap) => gap.blocks_projection).map((gap) => gap.gap_key),
      secrets_included: false,
    };
    const relevantStatuses = targetScope === "admin"
      ? [admin.status]
      : targetScope === "tenant"
        ? [tenant.status]
        : [admin.status, tenant.status];
    if (includeAligned || relevantStatuses.some((status) => !["aligned_existing", "not_applicable", "not_evaluated"].includes(status))) {
      candidates.push(item);
    }
  }

  const returnedGaps = gaps.slice(0, gapLimit);
  const nextCursor = hasMore ? String(selectedRows.at(-1)?.capability_key || "") || null : null;
  const catalogSnapshot = {
    admin: adminCatalogRows.map((row) => ({ tool_key: row.tool_key, is_enabled: bool(row.is_enabled), schema: schemaSummary(row.input_schema) })),
    tenant: tenantCatalogRows.map((row) => ({ tool_key: row.tool_key, is_enabled: bool(row.is_enabled), schema: schemaSummary(row.input_schema) })),
    exports: exportRows.map((row) => ({
      export_key: row.export_key,
      capability_key: row.capability_key,
      source_key: row.source_key,
      export_status: row.export_status,
      exposure_scope: row.exposure_scope,
      export_surface: row.export_surface,
    })),
    reconciliation: reconciliationRows.map((row) => ({
      projection_key: row.projection_key,
      capability_key: row.capability_key,
      desired_export_status: row.desired_export_status,
      actual_export_status: row.actual_export_status,
      reconciliation_status: row.reconciliation_status,
      schema_present: bool(row.schema_present),
    })),
  };
  const catalogSnapshotHash = stableCapabilityHash(catalogSnapshot);
  const projectionRevisionHash = stableCapabilityHash({
    version: DYNAMIC_CAPABILITY_PROJECTION_PREVIEW_VERSION,
    target_scope: targetScope,
    manifest_hashes: selectedRows.map((row) => row.manifest_hash),
    catalog_snapshot_hash: catalogSnapshotHash,
  });

  const relevantTargets = candidates.flatMap((item) => {
    if (targetScope === "admin") return [item.targets.admin];
    if (targetScope === "tenant") return [item.targets.tenant];
    return [item.targets.admin, item.targets.tenant];
  }).filter(Boolean);

  return {
    ok: true,
    report_type: "dynamic_capability_projection_preview",
    preview_version: DYNAMIC_CAPABILITY_PROJECTION_PREVIEW_VERSION,
    mode: "dry_run",
    observed_at: typeof deps.now === "function" ? deps.now() : new Date().toISOString(),
    filters: {
      capability_key: String(args.capability_key || "") || null,
      after_key: String(args.after_key || "") || null,
      target_scope: targetScope,
      limit,
      gap_limit: gapLimit,
      include_aligned: includeAligned,
    },
    counts: {
      manifest_rows: selectedRows.length,
      returned_candidate_count: candidates.length,
      admin_candidate_count: candidates.filter((item) => item.targets?.admin?.eligibility === "candidate").length,
      tenant_candidate_count: candidates.filter((item) => item.targets?.tenant?.eligibility === "candidate").length,
      aligned_target_count: relevantTargets.filter((target) => target.status === "aligned_existing").length,
      blocked_projection_count: candidates.filter((item) => item.status === "blocked").length,
      unsafe_active_export_count: gaps.filter((gap) => gap.gap_key.startsWith("UNSAFE_ACTIVE_")).length,
      gap_count: gaps.length,
      returned_gap_count: returnedGaps.length,
    },
    distributions: {
      target_status: countBy(relevantTargets, (item) => item.status),
      gap_key: countBy(gaps, (item) => item.gap_key),
      target_scope: countBy(gaps, (item) => item.target_scope),
    },
    catalog_snapshot_hash: catalogSnapshotHash,
    projection_revision_hash: projectionRevisionHash,
    page: {
      next_cursor: nextCursor,
      has_more: hasMore,
      final_result_complete: !hasMore,
    },
    candidates,
    gaps: returnedGaps,
    guarantees: {
      registry: "mysql_primary",
      persisted_manifests_only: true,
      admin_and_tenant_authority_separated: true,
      automatic_callable_export_performed: false,
      mutations_performed: false,
      provider_calls_performed: false,
      tenant_authority_changed: false,
      schemas_returned: false,
      fail_closed: true,
      secrets_included: false,
    },
    secrets_included: false,
  };
}
