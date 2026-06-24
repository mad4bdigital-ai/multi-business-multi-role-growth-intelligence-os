import { randomUUID } from "node:crypto";

const BACKUP_TABLE_RE = /^(rb_|zz_|collation_backup_|repair_backup_)/i;
const SCOPE_COLUMNS = new Set(["tenant_id", "workspace_id", "workspace_key", "user_id", "brand_id", "brand_key"]);

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
    `SELECT table_name, usage_status, authority_model, risk_level, status
       FROM database_table_lifecycle_registry`
  ).catch(() => [[]]);
  const lifecycle = new Map(lifecycleRows.map((row) => [String(row.table_name), row]));

  const [resourceRows] = await pool.query(
    `SELECT resource_key, scope_class, source_tables_json, read_models_json, operation_policy_json, status
       FROM platform_resource_type_registry
      WHERE status='active'`
  ).catch(() => [[]]);
  const coveredRelations = new Set();
  for (const row of resourceRows) {
    for (const field of ["source_tables_json", "read_models_json"]) {
      try {
        const values = JSON.parse(row[field] || "[]");
        for (const value of values) coveredRelations.add(String(value));
      } catch {}
    }
  }

  const [toolRows] = await pool.query(
    `SELECT 'admin' AS actor_scope, tool_key, http_method, http_path
       FROM admin_platform_endpoint_tools WHERE is_enabled=1
     UNION ALL
     SELECT 'tenant', tool_key, http_method, http_path
       FROM tenant_platform_endpoint_tools WHERE is_enabled=1`
  );
  const [operationRows] = await pool.query(
    `SELECT actor_scope, tool_key, http_method, http_path, implementation_status, status
       FROM platform_resource_operation_registry
      WHERE status='active'`
  ).catch(() => [[]]);
  const coveredTools = new Set(operationRows.map((row) => String(row.tool_key || "")).filter(Boolean));

  const findings = [];
  const add = (severity, findingType, surfaceKind, surfaceRef, message, resourceKey = null) => {
    if (findings.length >= findingLimit) return;
    findings.push({
      finding_id: randomUUID(),
      severity,
      finding_type: findingType,
      surface_kind: surfaceKind,
      surface_ref: surfaceRef,
      resource_key: resourceKey,
      message,
    });
  };

  for (const row of tableRows) {
    const name = String(row.TABLE_NAME);
    if (row.TABLE_TYPE === "BASE TABLE") {
      const life = lifecycle.get(name);
      if (!life && !BACKUP_TABLE_RE.test(name)) {
        add("high", "missing_lifecycle_registration", "table", name, "Base table is not registered in database_table_lifecycle_registry.");
      } else if (life?.usage_status === "runtime_unclassified") {
        add("medium", "runtime_table_unclassified", "table", name, "Runtime table is registered but remains runtime_unclassified.");
      }
      if (!coveredRelations.has(name) && !BACKUP_TABLE_RE.test(name) && !["planned_placeholder", "backup_snapshot"].includes(life?.usage_status)) {
        add("medium", "missing_resource_descriptor", "table", name, "Runtime relation is not mapped to a logical resource descriptor.");
      }
      if (Number(row.has_scope) === 1 && Number(row.has_primary_key) !== 1) {
        add("high", "scoped_table_missing_primary_key", "table", name, "Scoped table has no primary key.");
      }
      if (Number(row.has_scope) === 1 && Number(row.has_version) !== 1) {
        add("low", "scoped_table_missing_version", "table", name, "Scoped table has no version/etag column; optimistic concurrency is unavailable.");
      }
      if (Number(row.has_archive_marker) !== 1 && !BACKUP_TABLE_RE.test(name)) {
        add("low", "missing_archive_marker", "table", name, "No archive/revoke/delete lifecycle marker was detected.");
      }
    } else if (row.TABLE_TYPE === "VIEW" && !coveredRelations.has(name)) {
      add("low", "unexported_read_model", "view", name, "View exists but is not linked to a logical resource descriptor.");
    }
  }

  for (const tool of toolRows) {
    if (!coveredTools.has(String(tool.tool_key))) {
      add("low", "tool_not_linked_to_resource_operation", "tool", `${tool.actor_scope}:${tool.tool_key}`, "Enabled tool is not linked to platform_resource_operation_registry.");
    }
  }

  const counts = {
    relations_total: tableRows.length,
    base_tables: tableRows.filter((row) => row.TABLE_TYPE === "BASE TABLE").length,
    views: tableRows.filter((row) => row.TABLE_TYPE === "VIEW").length,
    lifecycle_registered: lifecycleRows.length,
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
      for (const finding of findings) {
        await pool.query(
          `INSERT INTO platform_resource_coverage_findings
             (finding_id, run_id, severity, finding_type, surface_kind, surface_ref, resource_key, message, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
          [finding.finding_id, runId, finding.severity, finding.finding_type, finding.surface_kind, finding.surface_ref, finding.resource_key, finding.message]
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
      tenant_scope: "jwt_membership_server_resolved",
      secret_policy: "allowlisted_fields_only",
      raw_sql_exposure: false,
      secrets_included: false,
    },
    secrets_included: false,
  };
}

export const _testingResourceCoverageService = {
  BACKUP_TABLE_RE,
  SCOPE_COLUMNS,
};
