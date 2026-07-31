import { GrowthControlPlaneError } from "../../domain/growthControlPlane/growthControlPlane.js";

function parseJson(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function requireExecutor(executor) {
  if (!executor || (typeof executor.execute !== "function" && typeof executor.query !== "function")) {
    throw new TypeError("Activity binding lifecycle repository requires a SQL executor.");
  }
  return executor;
}

async function sql(executor, statement, params = []) {
  const target = requireExecutor(executor);
  return typeof target.execute === "function"
    ? target.execute(statement, params)
    : target.query(statement, params);
}

function bindingRow(row) {
  if (!row) return null;
  return Object.freeze({
    activityBindingId: row.activity_binding_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    brandKey: row.brand_key,
    activityTypeKey: row.activity_type_key,
    activityPackKey: row.activity_pack_key,
    activityPackVersion: Number(row.activity_pack_version),
    markets: parseJson(row.markets_json, []),
    locales: parseJson(row.locales_json, []),
    channels: parseJson(row.channels_json, []),
    objectives: parseJson(row.objectives_json, []),
    allowedCapabilities: parseJson(row.allowed_capabilities_json, []),
    status: row.status,
    revision: Number(row.revision),
    approvedBy: row.approved_by,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    secretsIncluded: false
  });
}

function readinessRow(row) {
  if (!row) return null;
  return Object.freeze({
    evidenceId: row.evidence_id,
    activityBindingId: row.activity_binding_id,
    bindingRevision: Number(row.binding_revision),
    targetStatus: row.target_status,
    ready: row.target_status === "ready",
    evidenceSha256: row.evidence_sha256,
    checks: parseJson(row.checks_json, []),
    assessedBy: row.assessed_by,
    assessedAt: row.assessed_at,
    providerCalls: false,
    externalWrites: false,
    secretsIncluded: false
  });
}

export function createActivityBindingLifecycleRepository({ resolvePool }) {
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

  async function getActivityBindingReadinessContext({ activityBindingId }, executor = null, forUpdate = false) {
    const db = executor || await resolvePool();
    const [bindingRows] = await sql(db,
      `SELECT * FROM growth_control_brand_activity_bindings
       WHERE activity_binding_id=? LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
      [activityBindingId]
    );
    const binding = bindingRow(bindingRows?.[0]);
    if (!binding) return Object.freeze({ binding: null, brandCore: null, activityPack: null, capabilityStatuses: {} });

    const [brandRows] = await sql(db,
      `SELECT brand_key,status,validation_status,active_status,authoritative_home,asset_class,registry_role,updated_at
       FROM brand_core
       WHERE brand_key=?
       ORDER BY updated_at DESC,id DESC
       LIMIT 1`,
      [binding.brandKey]
    );
    const brand = brandRows?.[0] || null;

    const [packRows] = await sql(db,
      `SELECT v.manifest_json,v.lifecycle,d.activity_type_key
       FROM growth_control_activity_pack_versions v
       JOIN growth_control_activity_pack_definitions d
         ON d.activity_pack_key=v.activity_pack_key
       WHERE v.activity_pack_key=? AND v.version_number=?
       LIMIT 1`,
      [binding.activityPackKey, binding.activityPackVersion]
    );
    const pack = packRows?.[0] || null;
    const capabilityStatuses = {};
    if (binding.allowedCapabilities.length) {
      const placeholders = binding.allowedCapabilities.map(() => "?").join(",");
      const [capabilityRows] = await sql(db,
        `SELECT capability_key,status
         FROM platform_semantic_capabilities
         WHERE capability_key IN (${placeholders})`,
        binding.allowedCapabilities
      );
      for (const row of capabilityRows || []) capabilityStatuses[row.capability_key] = row.status;
    }

    return Object.freeze({
      binding,
      brandCore: brand ? Object.freeze({
        brandKey: brand.brand_key,
        status: brand.status,
        validationStatus: brand.validation_status,
        activeStatus: brand.active_status,
        authoritativeHome: brand.authoritative_home,
        assetClass: brand.asset_class,
        registryRole: brand.registry_role,
        updatedAt: brand.updated_at
      }) : null,
      activityPack: pack ? Object.freeze({
        activityPackKey: binding.activityPackKey,
        version: binding.activityPackVersion,
        activityTypeKey: pack.activity_type_key,
        status: pack.lifecycle,
        capabilities: parseJson(pack.manifest_json, {})?.capabilities || []
      }) : null,
      capabilityStatuses: Object.freeze(capabilityStatuses)
    });
  }

  async function recordActivityBindingReadiness(input) {
    return withTransaction(async (connection) => {
      const context = await getActivityBindingReadinessContext({ activityBindingId: input.activityBindingId }, connection, true);
      if (!context.binding) throw new GrowthControlPlaneError("GROWTH_CONTROL_ACTIVITY_BINDING_NOT_FOUND", "Activity binding was not found.", 404);
      if (context.binding.revision !== Number(input.expectedRevision)) {
        throw new GrowthControlPlaneError(
          "GROWTH_CONTROL_ACTIVITY_BINDING_REVISION_CONFLICT",
          "Activity binding revision changed before readiness persistence.",
          409,
          [{ field: "expectedRevision", issue: "conflict", expected: input.expectedRevision, actual: context.binding.revision }]
        );
      }
      const nextRevision = context.binding.revision + 1;
      const [updateResult] = await sql(connection,
        `UPDATE growth_control_brand_activity_bindings
         SET status=?,revision=?,updated_at=CURRENT_TIMESTAMP
         WHERE activity_binding_id=? AND revision=?`,
        [input.targetStatus, nextRevision, input.activityBindingId, context.binding.revision]
      );
      if (Number(updateResult?.affectedRows ?? 0) !== 1) {
        throw new GrowthControlPlaneError("GROWTH_CONTROL_ACTIVITY_BINDING_REVISION_CONFLICT", "Activity binding revision changed before readiness persistence.", 409);
      }
      await sql(connection,
        `INSERT INTO growth_control_activity_binding_readiness_evidence
         (evidence_id,activity_binding_id,binding_revision,target_status,evidence_sha256,checks_json,
          assessed_by,request_id,correlation_id,assessed_at,provider_calls,external_writes,secrets_included)
         VALUES (?,?,?,?,?,?,?,?,?,?,0,0,0)`,
        [
          input.evidenceId,
          input.activityBindingId,
          nextRevision,
          input.targetStatus,
          input.evidenceSha256,
          JSON.stringify(input.checks || []),
          input.assessedBy,
          input.requestId || null,
          input.correlationId || null,
          input.assessedAt
        ]
      );
      return Object.freeze({ evidenceId: input.evidenceId, revision: nextRevision, status: input.targetStatus });
    });
  }

  async function getLatestActivityBindingReadiness({ activityBindingId }) {
    const pool = await resolvePool();
    const [rows] = await sql(pool,
      `SELECT e.*
       FROM growth_control_activity_binding_readiness_evidence e
       JOIN growth_control_brand_activity_bindings b
         ON b.activity_binding_id=e.activity_binding_id
        AND b.revision=e.binding_revision
       WHERE e.activity_binding_id=?
       ORDER BY e.assessed_at DESC,e.evidence_id DESC
       LIMIT 1`,
      [activityBindingId]
    );
    return readinessRow(rows?.[0]);
  }

  async function applyActivityBindingTransition(input) {
    return withTransaction(async (connection) => {
      const context = await getActivityBindingReadinessContext({ activityBindingId: input.activityBindingId }, connection, true);
      if (!context.binding) throw new GrowthControlPlaneError("GROWTH_CONTROL_ACTIVITY_BINDING_NOT_FOUND", "Activity binding was not found.", 404);
      if (context.binding.revision !== Number(input.expectedRevision)) {
        throw new GrowthControlPlaneError(
          "GROWTH_CONTROL_ACTIVITY_BINDING_REVISION_CONFLICT",
          "Activity binding revision changed before lifecycle persistence.",
          409
        );
      }
      if (input.targetStatus === "active") {
        const [readinessRows] = await sql(connection,
          `SELECT target_status,binding_revision
           FROM growth_control_activity_binding_readiness_evidence
           WHERE activity_binding_id=? AND binding_revision=?
           ORDER BY assessed_at DESC,evidence_id DESC
           LIMIT 1 FOR UPDATE`,
          [input.activityBindingId, context.binding.revision]
        );
        if (readinessRows?.[0]?.target_status !== "ready") {
          throw new GrowthControlPlaneError(
            "GROWTH_CONTROL_ACTIVITY_BINDING_READINESS_REQUIRED",
            "A current passing readiness assessment is required before activation.",
            409
          );
        }
        await sql(connection,
          `UPDATE growth_control_brand_activity_bindings
           SET status='deprecated',effective_to=UTC_TIMESTAMP(),revision=revision+1,updated_at=CURRENT_TIMESTAMP
           WHERE tenant_id=? AND workspace_id=? AND brand_key=? AND activity_type_key=?
             AND status='active' AND activity_binding_id<>?`,
          [
            context.binding.tenantId,
            context.binding.workspaceId,
            context.binding.brandKey,
            context.binding.activityTypeKey,
            input.activityBindingId
          ]
        );
      }
      const [updateResult] = await sql(connection,
        `UPDATE growth_control_brand_activity_bindings
         SET status=?,revision=?,
             approved_by=CASE WHEN ?='active' THEN ? ELSE approved_by END,
             effective_from=CASE WHEN ?='active' THEN COALESCE(effective_from,?) ELSE effective_from END,
             effective_to=CASE WHEN ? IN ('deprecated','archived') THEN COALESCE(effective_to,?) ELSE effective_to END,
             updated_at=CURRENT_TIMESTAMP
         WHERE activity_binding_id=? AND revision=?`,
        [
          input.targetStatus,
          input.update.revision,
          input.targetStatus,
          input.update.approvedBy,
          input.targetStatus,
          input.update.effectiveFrom,
          input.targetStatus,
          input.update.effectiveTo,
          input.activityBindingId,
          input.expectedRevision
        ]
      );
      if (Number(updateResult?.affectedRows ?? 0) !== 1) {
        throw new GrowthControlPlaneError("GROWTH_CONTROL_ACTIVITY_BINDING_REVISION_CONFLICT", "Activity binding revision changed before lifecycle persistence.", 409);
      }
      const [rows] = await sql(connection,
        "SELECT * FROM growth_control_brand_activity_bindings WHERE activity_binding_id=? LIMIT 1",
        [input.activityBindingId]
      );
      return bindingRow(rows?.[0]);
    });
  }

  return Object.freeze({
    getActivityBindingReadinessContext,
    recordActivityBindingReadiness,
    getLatestActivityBindingReadiness,
    applyActivityBindingTransition
  });
}

export const _testingActivityBindingLifecycleRepository = Object.freeze({ parseJson, bindingRow, readinessRow });
