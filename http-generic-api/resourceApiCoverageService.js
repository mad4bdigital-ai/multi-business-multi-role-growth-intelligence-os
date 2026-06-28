import { randomUUID } from "node:crypto";

const BACKUP_TABLE_RE = /^(rb_|zz_|collation_backup_|repair_backup_)/i;
const SCOPE_COLUMNS = new Set(["tenant_id", "workspace_id", "workspace_key", "user_id", "brand_id", "brand_key"]);
const EXPOSURE_CLASSES = new Set([
  "resource_source",
  "resource_read_model",
  "resource_tool",
  "internal_runtime",
  "internal_registry",
  "internal_log",
  "internal_read_model",
  "internal_tool",
  "governance_ledger",
  "planned_placeholder",
  "recovery_snapshot",
]);
const DESCRIPTOR_REQUIREMENTS = new Set(["required", "not_applicable"]);
const OPERATION_REQUIREMENTS = new Set(["required", "not_applicable"]);
const ARCHIVE_REQUIREMENTS = new Set(["physical_marker", "lifecycle_policy", "resource_state", "not_applicable"]);
const VERSION_REQUIREMENTS = new Set(["optimistic_concurrency", "resource_state", "not_applicable"]);

function parseJson(value, fallback = {}) {
  try {
    return JSON.parse(value || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function surfacePolicyKey(surfaceKind, surfaceRef) {
  return `${String(surfaceKind)}:${String(surfaceRef)}`;
}

export function isRecoverySnapshotSurface({ surfaceRef, policy = null, lifecycle = null } = {}) {
  const usageStatus = String(lifecycle?.usage_status || "").trim();
  return policy?.exposure_class === "recovery_snapshot"
    || usageStatus === "backup_snapshot"
    || usageStatus === "repair_snapshot"
    || BACKUP_TABLE_RE.test(String(surfaceRef || ""));
}

export function requiresScopedPrimaryKey({
  surfaceRef,
  policy = null,
  lifecycle = null,
  hasScope = false,
  hasPrimaryKey = false,
} = {}) {
  return Number(hasScope) === 1
    && Number(hasPrimaryKey) !== 1
    && !isRecoverySnapshotSurface({ surfaceRef, policy, lifecycle });
}

export function shouldResolvePriorCoverageFindings({ status, findingsTotal } = {}) {
  return status === "complete" && Number(findingsTotal) === 0;
}

function finding(severity, findingType, surfaceKind, surfaceRef, message, resourceKey = null) {
  return {
    severity,
    finding_type: findingType,
    surface_kind: surfaceKind,
    surface_ref: surfaceRef,
    resource_key: resourceKey,
    message,
  };
}

export function evaluateResourceSurfacePolicy({
  surfaceKind,
  surfaceRef,
  policy,
  lifecycle = null,
  descriptor = null,
  coveredRelation = false,
  coveredTool = false,
  hasArchiveMarker = false,
  hasScope = false,
  hasVersion = false,
} = {}) {
  const results = [];
  const resourceKey = policy?.resource_key || descriptor?.resource_key || null;

  if (!policy) {
    if (!BACKUP_TABLE_RE.test(String(surfaceRef || ""))) {
      results.push(finding(
        "high",
        "missing_resource_surface_policy",
        surfaceKind,
        surfaceRef,
        "Surface has no explicit Resource API exposure and requirement policy."
      ));
    }
    return results;
  }

  const invalidFields = [];
  if (!EXPOSURE_CLASSES.has(policy.exposure_class)) invalidFields.push("exposure_class");
  if (!DESCRIPTOR_REQUIREMENTS.has(policy.descriptor_requirement)) invalidFields.push("descriptor_requirement");
  if (!OPERATION_REQUIREMENTS.has(policy.operation_requirement)) invalidFields.push("operation_requirement");
  if (!ARCHIVE_REQUIREMENTS.has(policy.archive_requirement)) invalidFields.push("archive_requirement");
  if (!VERSION_REQUIREMENTS.has(policy.version_requirement)) invalidFields.push("version_requirement");
  if (invalidFields.length) {
    results.push(finding(
      "high",
      "invalid_resource_surface_policy",
      surfaceKind,
      surfaceRef,
      `Surface policy has invalid fields: ${invalidFields.join(", ")}.`,
      resourceKey
    ));
    return results;
  }

  if (policy.descriptor_requirement === "required" && !coveredRelation) {
    results.push(finding(
      "high",
      "missing_resource_descriptor",
      surfaceKind,
      surfaceRef,
      "Surface policy requires a logical resource descriptor, but none covers this relation.",
      resourceKey
    ));
  }
  if (policy.descriptor_requirement === "not_applicable" && coveredRelation) {
    results.push(finding(
      "low",
      "resource_surface_descriptor_policy_conflict",
      surfaceKind,
      surfaceRef,
      "Relation is covered by a resource descriptor while its surface policy says descriptor coverage is not applicable.",
      resourceKey
    ));
  }
  if (policy.resource_key && descriptor?.resource_key && policy.resource_key !== descriptor.resource_key) {
    results.push(finding(
      "high",
      "resource_surface_descriptor_mismatch",
      surfaceKind,
      surfaceRef,
      `Surface policy resolves to ${policy.resource_key}, but descriptor coverage resolves to ${descriptor.resource_key}.`,
      policy.resource_key
    ));
  }

  if (policy.operation_requirement === "required" && !coveredTool) {
    results.push(finding(
      "high",
      "tool_not_linked_to_resource_operation",
      surfaceKind,
      surfaceRef,
      "Surface policy requires a resource operation registry binding, but none is active.",
      resourceKey
    ));
  }
  if (policy.operation_requirement === "not_applicable" && coveredTool) {
    results.push(finding(
      "low",
      "resource_surface_operation_policy_conflict",
      surfaceKind,
      surfaceRef,
      "Tool is linked to a resource operation while its surface policy says operation coverage is not applicable.",
      resourceKey
    ));
  }

  if (policy.archive_requirement === "physical_marker" && !hasArchiveMarker) {
    results.push(finding(
      "low",
      "missing_archive_marker",
      surfaceKind,
      surfaceRef,
      "Surface policy requires a physical archive/revoke/delete marker, but no supported marker column exists.",
      resourceKey
    ));
  }
  if (policy.archive_requirement === "lifecycle_policy") {
    const strategy = String(lifecycle?.archive_strategy || "").trim();
    if (!strategy || strategy === "manual_review") {
      results.push(finding(
        "medium",
        "archive_lifecycle_policy_unresolved",
        surfaceKind,
        surfaceRef,
        "Surface policy requires lifecycle-governed archive semantics, but lifecycle metadata remains unresolved.",
        resourceKey
      ));
    }
  }
  if (policy.archive_requirement === "resource_state" && !descriptor?.operation_policy?.archive) {
    results.push(finding(
      "medium",
      "resource_archive_state_missing",
      surfaceKind,
      surfaceRef,
      "Resource-facing surface has no explicit archive operation state in its descriptor.",
      resourceKey
    ));
  }

  if (policy.version_requirement === "optimistic_concurrency" && hasScope && !hasVersion) {
    results.push(finding(
      "low",
      "scoped_table_missing_version",
      surfaceKind,
      surfaceRef,
      "Surface policy requires optimistic concurrency, but no supported version/etag column exists.",
      resourceKey
    ));
  }
  if (policy.version_requirement === "resource_state") {
    const revisions = descriptor?.operation_policy?.revisions;
    if (!revisions || revisions === "not_yet_versioned") {
      results.push(finding(
        "medium",
        "resource_version_strategy_unresolved",
        surfaceKind,
        surfaceRef,
        "Resource-facing surface has no resolved revisions/version strategy.",
        resourceKey
      ));
    }
  }

  return results;
}

function buildDescriptorRelationMap(resourceRows) {
  const map = new Map();
  for (const row of resourceRows) {
    const descriptor = {
      resource_key: String(row.resource_key),
      operation_policy: parseJson(row.operation_policy_json, {}),
    };
    for (const field of ["source_tables_json", "read_models_json"]) {
      const values = parseJson(row[field], []);
      if (!Array.isArray(values)) continue;
      for (const value of values) map.set(String(value), descriptor);
    }
  }
  return map;
}

export async function runLiveResourceCoverageAudit(pool, {
  triggerSource = "api",
  commitSha = null,
  persist = true,
  findingLimit = 250,
} = {}) {
  const [tableRows] = await pool.query(
    `SELECT t.TABLE_NAME, t.TABLE_TYPE, t.TABLE_ROWS,
            MAX(c.COLUMN_NAME IN ('tenant_id','workspace_id','workspace_key','user_id','brand_id','brand_key')) AS has_scope,
            MAX(c.COLUMN_NAME IN ('status','state','active_status','lifecycle_status')) AS has_status,
            MAX(c.COLUMN_NAME IN ('deleted_at','is_deleted','archived_at','revoked_at')) AS has_archive_marker,
            MAX(c.COLUMN_NAME IN ('version','row_version','etag','revision','lock_version')) AS has_version,
            MAX(c.COLUMN_KEY='PRI') AS has_primary_key
       FROM INFORMATION_SCHEMA.TABLES t
       JOIN INFORMATION_SCHEMA.COLUMNS c
         ON c.TABLE_SCHEMA=t.TABLE_SCHEMA AND c.TABLE_NAME=t.TABLE_NAME
      WHERE t.TABLE_SCHEMA=DATABASE()
      GROUP BY t.TABLE_NAME,t.TABLE_TYPE,t.TABLE_ROWS
      ORDER BY t.TABLE_NAME`
  );

  const [lifecycleRows] = await pool.query(
    `SELECT table_name, usage_status, authority_model, risk_level, status,
            archive_strategy, cleanup_strategy, retention_class
       FROM database_table_lifecycle_registry`
  ).catch(() => [[]]);
  const lifecycle = new Map(lifecycleRows.map((row) => [String(row.table_name), row]));

  const [resourceRows] = await pool.query(
    `SELECT resource_key, scope_class, source_tables_json, read_models_json,
            operation_policy_json, status
       FROM platform_resource_type_registry
      WHERE status='active'`
  ).catch(() => [[]]);
  const descriptorByRelation = buildDescriptorRelationMap(resourceRows);
  const coveredRelations = new Set(descriptorByRelation.keys());

  const [toolRows] = await pool.query(
    `SELECT 'admin' AS actor_scope, tool_key, http_method, http_path
       FROM admin_platform_endpoint_tools WHERE is_enabled=1
     UNION ALL
     SELECT 'tenant', tool_key, http_method, http_path
       FROM tenant_platform_endpoint_tools WHERE is_enabled=1`
  );
  const [operationRows] = await pool.query(
    `SELECT actor_scope, tool_key, resource_key, http_method, http_path,
            implementation_status, status
       FROM platform_resource_operation_registry
      WHERE status='active'`
  ).catch(() => [[]]);
  const coveredTools = new Set(operationRows.map((row) => String(row.tool_key || "")).filter(Boolean));

  const [surfacePolicyRows] = await pool.query(
    `SELECT surface_kind, surface_ref, exposure_class, resource_key,
            descriptor_requirement, operation_requirement,
            archive_requirement, version_requirement, rationale, status
       FROM platform_resource_surface_policy_registry
      WHERE status='active'`
  ).catch(() => [[]]);
  const surfacePolicies = new Map(
    surfacePolicyRows.map((row) => [surfacePolicyKey(row.surface_kind, row.surface_ref), row])
  );

  const findings = [];
  const add = (row) => {
    if (findings.length >= findingLimit) return;
    findings.push({ finding_id: randomUUID(), ...row });
  };

  for (const row of tableRows) {
    const name = String(row.TABLE_NAME);
    const kind = row.TABLE_TYPE === "BASE TABLE" ? "table" : "view";
    const life = lifecycle.get(name) || null;
    const policy = surfacePolicies.get(surfacePolicyKey(kind, name)) || null;
    const descriptor = descriptorByRelation.get(name) || null;

    if (kind === "table" && !life && !BACKUP_TABLE_RE.test(name)) {
      add(finding(
        "high",
        "missing_lifecycle_registration",
        "table",
        name,
        "Base table is not registered in database_table_lifecycle_registry."
      ));
    }
    if (kind === "table" && requiresScopedPrimaryKey({
      surfaceRef: name,
      policy,
      lifecycle: life,
      hasScope: row.has_scope,
      hasPrimaryKey: row.has_primary_key,
    })) {
      add(finding(
        "high",
        "scoped_table_missing_primary_key",
        "table",
        name,
        "Scoped table has no primary key."
      ));
    }

    for (const result of evaluateResourceSurfacePolicy({
      surfaceKind: kind,
      surfaceRef: name,
      policy,
      lifecycle: life,
      descriptor,
      coveredRelation: coveredRelations.has(name),
      hasArchiveMarker: Number(row.has_archive_marker) === 1,
      hasScope: Number(row.has_scope) === 1,
      hasVersion: Number(row.has_version) === 1,
    })) add(result);
  }

  for (const tool of toolRows) {
    const ref = String(tool.tool_key);
    const policy = surfacePolicies.get(surfacePolicyKey("tool", ref)) || null;
    const operation = operationRows.find((row) => String(row.tool_key || "") === ref) || null;
    for (const result of evaluateResourceSurfacePolicy({
      surfaceKind: "tool",
      surfaceRef: ref,
      policy,
      descriptor: operation ? { resource_key: operation.resource_key, operation_policy: {} } : null,
      coveredTool: coveredTools.has(ref),
    })) add(result);
  }

  const counts = {
    relations_total: tableRows.length,
    base_tables: tableRows.filter((row) => row.TABLE_TYPE === "BASE TABLE").length,
    views: tableRows.filter((row) => row.TABLE_TYPE === "VIEW").length,
    lifecycle_registered: lifecycleRows.length,
    lifecycle_unclassified: lifecycleRows.filter((row) => row.usage_status === "runtime_unclassified").length,
    surface_policies_active: surfacePolicyRows.length,
    resources_active: resourceRows.length,
    tools_enabled: toolRows.length,
    resource_operations_active: operationRows.length,
    findings_total: findings.length,
    findings_by_severity: findings.reduce((acc, row) => {
      acc[row.severity] = (acc[row.severity] || 0) + 1;
      return acc;
    }, {}),
  };

  const status = findings.some((row) => row.severity === "critical" || row.severity === "high")
    ? "gaps_detected"
    : findings.length
      ? "debt_detected"
      : "complete";

  let runId = null;
  if (persist) {
    runId = randomUUID();
    try {
      await pool.query(
        `INSERT INTO platform_resource_coverage_runs
           (run_id, trigger_source, commit_sha, status, totals_json, finding_count, secrets_included)
         VALUES (?, ?, ?, ?, ?, ?, 0)`,
        [runId, String(triggerSource).slice(0, 64), commitSha, status, JSON.stringify(counts), findings.length]
      );
      for (const row of findings) {
        await pool.query(
          `INSERT INTO platform_resource_coverage_findings
             (finding_id, run_id, severity, finding_type, surface_kind, surface_ref, resource_key, message, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
          [row.finding_id, runId, row.severity, row.finding_type, row.surface_kind, row.surface_ref, row.resource_key, row.message]
        );
      }
      if (shouldResolvePriorCoverageFindings({ status, findingsTotal: findings.length })) {
        await pool.query(
          `UPDATE platform_resource_coverage_findings
              SET status='resolved', resolved_at=COALESCE(resolved_at,CURRENT_TIMESTAMP)
            WHERE status='open' AND run_id<>?`,
          [runId]
        );
      }
    } catch (error) {
      counts.persistence_warning = error.message;
      runId = null;
    }
  }

  return {
    ok: true,
    status,
    run_id: runId,
    observed_at: new Date().toISOString(),
    counts,
    findings,
    policy: {
      new_feature_gate: "fail_closed",
      surface_policy_required: true,
      internal_surfaces_require_explicit_not_applicable: true,
      tenant_scope: "jwt_membership_server_resolved",
      secret_policy: "allowlisted_fields_only",
      raw_sql_exposure: false,
      secrets_included: false,
    },
    secrets_included: false,
  };
}

export const _testingResourceCoverageService = {
  ARCHIVE_REQUIREMENTS,
  BACKUP_TABLE_RE,
  DESCRIPTOR_REQUIREMENTS,
  EXPOSURE_CLASSES,
  OPERATION_REQUIREMENTS,
  SCOPE_COLUMNS,
  VERSION_REQUIREMENTS,
  isRecoverySnapshotSurface,
  requiresScopedPrimaryKey,
  shouldResolvePriorCoverageFindings,
  surfacePolicyKey,
};
