import { GrowthControlPlaneError } from "../../domain/growthControlPlane/growthControlPlane.js";

function parseJson(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function requireExecutor(executor) {
  if (!executor || (typeof executor.execute !== "function" && typeof executor.query !== "function")) {
    throw new TypeError("Growth Control Plane repository requires a SQL executor.");
  }
  return executor;
}

async function sql(executor, statement, params = []) {
  const target = requireExecutor(executor);
  return typeof target.execute === "function" ? target.execute(statement, params) : target.query(statement, params);
}

function definitionRow(row) {
  if (!row) return null;
  return Object.freeze({
    configKey: row.config_key,
    schemaVersion: Number(row.schema_version),
    schema: parseJson(row.schema_json, {}),
    defaultValues: parseJson(row.default_values_json, {}),
    allowedScopes: parseJson(row.allowed_scopes_json, []),
    mergeProfile: parseJson(row.merge_profile_json, {}),
    securityClassification: row.security_classification,
    status: row.status,
    revision: Number(row.revision),
    checksumSha256: row.checksum_sha256,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    secretsIncluded: false
  });
}

function versionRow(row) {
  if (!row) return null;
  return Object.freeze({
    configVersionId: row.config_version_id,
    configKey: row.config_key,
    versionNumber: Number(row.version_number),
    scopeType: row.scope_type,
    scopeKey: row.scope_key,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    brandKey: row.brand_key,
    activityTypeKey: row.activity_type_key,
    activityBindingId: row.activity_binding_id,
    profileKey: row.profile_key,
    workflowKey: row.workflow_key,
    workflowVersion: row.workflow_version == null ? null : Number(row.workflow_version),
    workflowNodeId: row.workflow_node_id,
    planId: row.plan_id,
    executionId: row.execution_id,
    values: parseJson(row.values_json, {}),
    lifecycle: row.lifecycle,
    versionRevision: Number(row.version_revision),
    checksumSha256: row.checksum_sha256,
    idempotencyKey: row.idempotency_key,
    createdBy: row.created_by,
    createdAt: row.created_at,
    secretsIncluded: false
  });
}

function packRow(row) {
  if (!row) return null;
  return Object.freeze({
    activityPackKey: row.activity_pack_key,
    activityTypeKey: row.activity_type_key,
    displayName: row.display_name,
    description: row.description,
    status: row.status,
    revision: Number(row.revision),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    secretsIncluded: false
  });
}

export function createGrowthControlPlaneRepository({ resolvePool }) {
  if (typeof resolvePool !== "function") throw new TypeError("resolvePool is required.");

  async function withTransaction(work) {
    const pool = await resolvePool();
    if (typeof pool.getConnection !== "function") return work(requireExecutor(pool));
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async function getConfigurationDefinition(configKey, executor = null, forUpdate = false) {
    const pool = executor || await resolvePool();
    const [rows] = await sql(pool,
      `SELECT * FROM growth_control_config_definitions WHERE config_key=? LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
      [configKey]
    );
    return definitionRow(rows?.[0]);
  }

  async function listConfigurationDefinitions({ limit = 25, offset = 0 } = {}) {
    const pool = await resolvePool();
    const fetchLimit = Math.max(1, Math.min(101, Number(limit)));
    const fetchOffset = Math.max(0, Number(offset));
    const [rows] = await sql(pool,
      "SELECT * FROM growth_control_config_definitions ORDER BY config_key LIMIT ? OFFSET ?",
      [fetchLimit, fetchOffset]
    );
    return rows.map(definitionRow);
  }

  async function createConfigurationDefinition(input) {
    const pool = await resolvePool();
    await sql(pool,
      `INSERT INTO growth_control_config_definitions
       (config_key,schema_version,schema_json,default_values_json,allowed_scopes_json,merge_profile_json,
        security_classification,status,revision,checksum_sha256,created_by,secrets_included)
       VALUES (?,?,?,?,?,?,?,?,1,?,?,0)`,
      [input.configKey, input.schemaVersion, JSON.stringify(input.schema), JSON.stringify(input.defaultValues),
       JSON.stringify(input.allowedScopes), JSON.stringify(input.mergeProfile), input.securityClassification,
       "draft", input.checksumSha256, input.createdBy]
    );
    return getConfigurationDefinition(input.configKey);
  }

  async function createConfigurationVersion(input) {
    return withTransaction(async (connection) => {
      const definition = await getConfigurationDefinition(input.configKey, connection, true);
      if (!definition) throw new GrowthControlPlaneError("GROWTH_CONTROL_CONFIG_NOT_FOUND", "Configuration definition was not found.", 404);
      const [idempotentRows] = await sql(connection,
        "SELECT * FROM growth_control_config_versions WHERE idempotency_key=? LIMIT 1",
        [input.idempotencyKey]
      );
      if (idempotentRows?.[0]) return versionRow(idempotentRows[0]);
      const [stateRows] = await sql(connection,
        `SELECT COALESCE(MAX(version_number),0) AS version_number, COALESCE(MAX(version_revision),0) AS version_revision
           FROM growth_control_config_versions WHERE config_key=? AND scope_key=? FOR UPDATE`,
        [input.configKey, input.scope.scopeKey]
      );
      const currentRevision = Number(stateRows?.[0]?.version_revision || 0);
      if (Number(input.expectedRevision) !== currentRevision) {
        throw new GrowthControlPlaneError(
          "GROWTH_CONTROL_REVISION_CONFLICT",
          "Configuration scope revision changed.",
          409,
          [{ field: "expectedRevision", issue: "stale", expected: currentRevision }]
        );
      }
      const versionNumber = Number(stateRows?.[0]?.version_number || 0) + 1;
      const revision = currentRevision + 1;
      await sql(connection,
        `INSERT INTO growth_control_config_versions
         (config_version_id,config_key,version_number,scope_type,scope_key,tenant_id,workspace_id,brand_key,
          activity_type_key,activity_binding_id,profile_key,workflow_key,workflow_version,workflow_node_id,
          plan_id,execution_id,values_json,lifecycle,version_revision,checksum_sha256,idempotency_key,created_by,secrets_included)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?,?,0)`,
        [input.configVersionId, input.configKey, versionNumber, input.scope.scopeType, input.scope.scopeKey,
         input.scope.tenantId, input.scope.workspaceId, input.scope.brandKey, input.scope.activityTypeKey,
         input.scope.activityBindingId, input.scope.profileKey, input.scope.workflowKey,
         input.scope.workflowVersion, input.scope.workflowNodeId, input.scope.planId, input.scope.executionId,
         JSON.stringify(input.values), revision, input.checksumSha256, input.idempotencyKey, input.createdBy]
      );
      const [rows] = await sql(connection, "SELECT * FROM growth_control_config_versions WHERE config_version_id=?", [input.configVersionId]);
      return versionRow(rows?.[0]);
    });
  }

  async function listResolvableConfigurationVersions({ configKey, scopeKeys, includeDraftVersionIds = [] }) {
    if (!scopeKeys.length) return [];
    const pool = await resolvePool();
    const placeholders = scopeKeys.map(() => "?").join(",");
    const draftPlaceholders = includeDraftVersionIds.map(() => "?").join(",");
    const draftClause = includeDraftVersionIds.length ? ` OR config_version_id IN (${draftPlaceholders})` : "";
    const [rows] = await sql(pool,
      `SELECT * FROM growth_control_config_versions
        WHERE config_key=? AND scope_key IN (${placeholders})
          AND (lifecycle IN ('ready','active')${draftClause})
        ORDER BY version_number,config_version_id`,
      [configKey, ...scopeKeys, ...includeDraftVersionIds]
    );
    return rows.map(versionRow);
  }

  async function recordResolutionSnapshot(input) {
    const pool = await resolvePool();
    await sql(pool,
      `INSERT INTO growth_control_config_resolution_snapshots
       (resolution_id,config_key,tenant_id,workspace_id,brand_key,activity_type_key,activity_binding_id,
        workflow_key,workflow_version,plan_id,execution_id,resolved_values_json,lineage_json,
        revision_vector_json,conflicts_json,resolved_sha256,created_by,secrets_included)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
      [input.resolutionId, input.configKey, input.context.tenantId || null, input.context.workspaceId || null,
       input.context.brandKey || null, input.context.activityTypeKey || null, input.context.activityBindingId || null,
       input.context.workflowKey || null, input.context.workflowVersion || null, input.context.planId || null,
       input.context.executionId || null, JSON.stringify(input.result.values), JSON.stringify(input.result.lineage),
       JSON.stringify(input.result.revisionVector), JSON.stringify(input.result.conflicts), input.result.sha256, input.createdBy]
    );
    return Object.freeze({ resolutionId: input.resolutionId, ...input.result, resolvedAt: new Date().toISOString(), secretsIncluded: false });
  }

  async function listActivityPacks({ limit = 25, offset = 0 } = {}) {
    const pool = await resolvePool();
    const fetchLimit = Math.max(1, Math.min(101, Number(limit)));
    const fetchOffset = Math.max(0, Number(offset));
    const [rows] = await sql(pool,
      "SELECT * FROM growth_control_activity_pack_definitions ORDER BY activity_pack_key LIMIT ? OFFSET ?",
      [fetchLimit, fetchOffset]
    );
    return rows.map(packRow);
  }

  async function getActivityPackDefinition(activityPackKey, executor = null, forUpdate = false) {
    const pool = executor || await resolvePool();
    const [rows] = await sql(pool,
      `SELECT * FROM growth_control_activity_pack_definitions WHERE activity_pack_key=? LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
      [activityPackKey]
    );
    return packRow(rows?.[0]);
  }

  async function createActivityPackDefinition(input) {
    const pool = await resolvePool();
    const [activityRows] = await sql(pool,
      "SELECT business_activity_type_key FROM business_activity_types WHERE business_activity_type_key=? AND (status='active' OR active='true' OR active='1') LIMIT 1",
      [input.activityTypeKey]
    );
    if (!activityRows?.[0]) throw new GrowthControlPlaneError("GROWTH_CONTROL_ACTIVITY_TYPE_NOT_FOUND", "Business activity type is not active.", 422);
    await sql(pool,
      `INSERT INTO growth_control_activity_pack_definitions
       (activity_pack_key,activity_type_key,display_name,description,status,revision,created_by,secrets_included)
       VALUES (?,?,?,?,'draft',1,?,0)`,
      [input.activityPackKey, input.activityTypeKey, input.displayName, input.description || null, input.createdBy]
    );
    return getActivityPackDefinition(input.activityPackKey);
  }

  async function createActivityPackVersion(input) {
    return withTransaction(async (connection) => {
      const definition = await getActivityPackDefinition(input.activityPackKey, connection, true);
      if (!definition) throw new GrowthControlPlaneError("GROWTH_CONTROL_ACTIVITY_PACK_NOT_FOUND", "Activity Pack was not found.", 404);
      const [idempotentRows] = await sql(connection,
        "SELECT * FROM growth_control_activity_pack_versions WHERE idempotency_key=? LIMIT 1",
        [input.idempotencyKey]
      );
      if (idempotentRows?.[0]) return Object.freeze({
        activityPackVersionId: idempotentRows[0].activity_pack_version_id,
        activityPackKey: idempotentRows[0].activity_pack_key,
        versionNumber: Number(idempotentRows[0].version_number),
        manifest: parseJson(idempotentRows[0].manifest_json, {}),
        checksumSha256: idempotentRows[0].checksum_sha256,
        lifecycle: idempotentRows[0].lifecycle,
        secretsIncluded: false
      });
      const [rows] = await sql(connection,
        "SELECT COALESCE(MAX(version_number),0) AS version_number FROM growth_control_activity_pack_versions WHERE activity_pack_key=? FOR UPDATE",
        [input.activityPackKey]
      );
      const versionNumber = Number(rows?.[0]?.version_number || 0) + 1;
      await sql(connection,
        `INSERT INTO growth_control_activity_pack_versions
         (activity_pack_version_id,activity_pack_key,version_number,manifest_json,checksum_sha256,lifecycle,
          idempotency_key,created_by,secrets_included)
         VALUES (?,?,?,?,?,'draft',?,?,0)`,
        [input.activityPackVersionId, input.activityPackKey, versionNumber, JSON.stringify(input.manifest),
         input.checksumSha256, input.idempotencyKey, input.createdBy]
      );
      return Object.freeze({
        activityPackVersionId: input.activityPackVersionId,
        activityPackKey: input.activityPackKey,
        versionNumber,
        manifest: input.manifest,
        checksumSha256: input.checksumSha256,
        lifecycle: "draft",
        secretsIncluded: false
      });
    });
  }

  async function createBrandActivityBinding(input) {
    return withTransaction(async (connection) => {
      const [idempotentRows] = await sql(connection,
        "SELECT * FROM growth_control_brand_activity_bindings WHERE idempotency_key=? LIMIT 1",
        [input.idempotencyKey]
      );
      if (idempotentRows?.[0]) return Object.freeze({ activityBindingId: idempotentRows[0].activity_binding_id, status: idempotentRows[0].status, secretsIncluded: false });
      const [tenantRows] = await sql(connection, "SELECT tenant_id FROM tenants WHERE tenant_id=? AND status='active' LIMIT 1", [input.binding.tenantId]);
      if (!tenantRows?.[0]) throw new GrowthControlPlaneError("GROWTH_CONTROL_TENANT_NOT_FOUND", "Tenant is not active.", 422);
      const [workspaceRows] = await sql(connection,
        "SELECT workspace_id,linked_brand_key FROM workspace_registry WHERE workspace_id=? AND tenant_id=? LIMIT 1",
        [input.binding.workspaceId, input.binding.tenantId]
      );
      if (!workspaceRows?.[0]) throw new GrowthControlPlaneError("GROWTH_CONTROL_WORKSPACE_NOT_FOUND", "Workspace is outside the tenant scope.", 422);
      if (workspaceRows[0].linked_brand_key && String(workspaceRows[0].linked_brand_key) !== input.binding.brandKey) {
        throw new GrowthControlPlaneError("GROWTH_CONTROL_BRAND_SCOPE_MISMATCH", "Workspace is linked to a different brand.", 403);
      }
      const [brandRows] = await sql(connection, "SELECT target_key FROM brands WHERE target_key=? LIMIT 1", [input.binding.brandKey]);
      if (!brandRows?.[0]) throw new GrowthControlPlaneError("GROWTH_CONTROL_BRAND_NOT_FOUND", "Brand was not found.", 422);
      const [activityRows] = await sql(connection, "SELECT business_activity_type_key FROM business_activity_types WHERE business_activity_type_key=? LIMIT 1", [input.binding.activityTypeKey]);
      if (!activityRows?.[0]) throw new GrowthControlPlaneError("GROWTH_CONTROL_ACTIVITY_TYPE_NOT_FOUND", "Activity type was not found.", 422);
      const [packRows] = await sql(connection,
        `SELECT v.activity_pack_version_id FROM growth_control_activity_pack_versions v
          JOIN growth_control_activity_pack_definitions d ON d.activity_pack_key=v.activity_pack_key
         WHERE v.activity_pack_key=? AND v.version_number=? AND d.activity_type_key=? LIMIT 1`,
        [input.binding.activityPackKey, input.binding.activityPackVersion, input.binding.activityTypeKey]
      );
      if (!packRows?.[0]) throw new GrowthControlPlaneError("GROWTH_CONTROL_ACTIVITY_PACK_VERSION_NOT_FOUND", "Activity Pack version is not compatible with the activity.", 422);
      if (input.binding.allowedCapabilities.length) {
        const placeholders = input.binding.allowedCapabilities.map(() => "?").join(",");
        const [capabilityRows] = await sql(connection,
          `SELECT capability_key FROM platform_semantic_capabilities WHERE capability_key IN (${placeholders}) AND status='active'`,
          input.binding.allowedCapabilities
        );
        const found = new Set(capabilityRows.map((row) => row.capability_key));
        const missing = input.binding.allowedCapabilities.filter((key) => !found.has(key));
        if (missing.length) throw new GrowthControlPlaneError("GROWTH_CONTROL_CAPABILITY_NOT_ACTIVE", "One or more capabilities are not active.", 422, missing.map((key) => ({ field: "allowedCapabilities", issue: "not_active", value: key })));
      }
      await sql(connection,
        `INSERT INTO growth_control_brand_activity_bindings
         (activity_binding_id,tenant_id,workspace_id,brand_key,activity_type_key,activity_pack_key,
          activity_pack_version,markets_json,locales_json,channels_json,objectives_json,
          allowed_capabilities_json,status,revision,idempotency_key,created_by,secrets_included)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'draft',1,?,?,0)`,
        [input.activityBindingId, input.binding.tenantId, input.binding.workspaceId, input.binding.brandKey,
         input.binding.activityTypeKey, input.binding.activityPackKey, input.binding.activityPackVersion,
         JSON.stringify(input.binding.markets), JSON.stringify(input.binding.locales), JSON.stringify(input.binding.channels),
         JSON.stringify(input.binding.objectives), JSON.stringify(input.binding.allowedCapabilities),
         input.idempotencyKey, input.createdBy]
      );
      return Object.freeze({ activityBindingId: input.activityBindingId, ...input.binding, status: "draft", secretsIncluded: false });
    });
  }

  return Object.freeze({
    listConfigurationDefinitions, getConfigurationDefinition, createConfigurationDefinition,
    createConfigurationVersion, listResolvableConfigurationVersions, recordResolutionSnapshot,
    listActivityPacks, getActivityPackDefinition, createActivityPackDefinition,
    createActivityPackVersion, createBrandActivityBinding
  });
}

export const _testingGrowthControlPlaneRepository = Object.freeze({ parseJson, definitionRow, versionRow, packRow });
