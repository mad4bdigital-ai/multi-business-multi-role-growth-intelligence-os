import { GrowthControlPlaneError } from "../../domain/growthControlPlane/growthControlPlane.js";

function requireExecutor(executor) {
  if (!executor || (typeof executor.execute !== "function" && typeof executor.query !== "function")) {
    throw new TypeError("Workflow plan snapshot repository requires a SQL executor.");
  }
  return executor;
}

async function sql(executor, statement, params = []) {
  const target = requireExecutor(executor);
  return typeof target.execute === "function"
    ? target.execute(statement, params)
    : target.query(statement, params);
}

function parseJson(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function snapshotRow(row, replayed = false) {
  if (!row) return null;
  return Object.freeze({
    planSnapshotId: row.plan_snapshot_id,
    policySnapshotId: row.policy_snapshot_id,
    configResolutionId: row.config_resolution_id,
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    brandKey: row.brand_key,
    activityBindingId: row.activity_binding_id,
    activityPackVersionId: row.activity_pack_version_id,
    workflowKey: row.workflow_key,
    workflowVersion: Number(row.workflow_version),
    resolvedVersions: parseJson(row.resolved_versions_json, []),
    planSnapshot: parseJson(row.plan_snapshot_json, null),
    policyVersions: parseJson(row.policy_versions_json, []),
    policySnapshot: parseJson(row.policy_snapshot_json, null),
    configHashSha256: row.config_hash_sha256,
    policyHashSha256: row.policy_hash_sha256,
    planHashSha256: row.plan_hash_sha256,
    versionSetHashSha256: row.version_set_hash_sha256,
    bundleHashSha256: row.bundle_hash_sha256,
    idempotencyKey: row.idempotency_key,
    createdBy: row.created_by,
    createdAt: row.created_at,
    replayed,
    immutable: true,
    providerCalls: false,
    providerDispatchAllowed: false,
    providerApplyAllowed: false,
    externalWrites: false,
    secretsIncluded: false
  });
}

function mismatch(field, expected, actual) {
  throw new GrowthControlPlaneError(
    "GROWTH_CONTROL_PLAN_SNAPSHOT_READBACK_MISMATCH",
    "Persisted workflow plan snapshot did not match the requested immutable bundle.",
    409,
    [{ field, issue: "readback_mismatch", expected, actual }]
  );
}

function verifyReadback(row, input) {
  if (!row) mismatch("planSnapshot", "present", "missing");
  const checks = [
    ["configResolutionId", input.configResolutionId, row.config_resolution_id],
    ["tenantId", input.tenantId, row.tenant_id],
    ["workspaceId", input.workspaceId, row.workspace_id],
    ["brandKey", input.brandKey, row.brand_key],
    ["activityBindingId", input.activityBindingId, row.activity_binding_id],
    ["workflowKey", input.workflowKey, row.workflow_key],
    ["workflowVersion", Number(input.workflowVersion), Number(row.workflow_version)],
    ["configHashSha256", input.configHashSha256, row.config_hash_sha256],
    ["policyHashSha256", input.policyHashSha256, row.policy_hash_sha256],
    ["planHashSha256", input.planHashSha256, row.plan_hash_sha256],
    ["versionSetHashSha256", input.versionSetHashSha256, row.version_set_hash_sha256],
    ["bundleHashSha256", input.bundleHashSha256, row.bundle_hash_sha256],
    ["idempotencyKey", input.idempotencyKey, row.idempotency_key]
  ];
  for (const [field, expected, actual] of checks) {
    if (String(expected ?? "") !== String(actual ?? "")) mismatch(field, expected, actual);
  }
  if (
    Number(row.immutable) !== 1 ||
    Number(row.provider_calls) !== 0 ||
    Number(row.provider_dispatch_allowed) !== 0 ||
    Number(row.provider_apply_allowed) !== 0 ||
    Number(row.external_writes) !== 0 ||
    Number(row.secrets_included) !== 0
  ) {
    mismatch("operationalBoundaries", "immutable_no_effects_no_secrets", "violated");
  }
  return row;
}

function joinedSnapshotSelect(whereClause) {
  return `SELECT
      p.*,
      y.policy_versions_json,
      y.policy_snapshot_json
    FROM growth_control_compiled_plan_snapshots p
    JOIN growth_control_compiled_policy_snapshots y
      ON y.policy_snapshot_id=p.policy_snapshot_id
    WHERE ${whereClause}
    LIMIT 1 FOR UPDATE`;
}

export function createWorkflowPlanSnapshotRepository({ resolvePool } = {}) {
  if (typeof resolvePool !== "function") throw new TypeError("resolvePool is required.");

  async function withTransaction(work) {
    const pool = await resolvePool();
    if (!pool || typeof pool.getConnection !== "function") {
      throw new TypeError("Workflow plan snapshot persistence requires transactional getConnection().");
    }
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

  async function persistWorkflowPlanSnapshot(input) {
    return withTransaction(async (connection) => {
      const [existingRows] = await sql(
        connection,
        joinedSnapshotSelect("p.idempotency_key=?"),
        [input.idempotencyKey]
      );
      if (existingRows?.[0]) {
        const verified = verifyReadback(existingRows[0], input);
        return snapshotRow(verified, true);
      }

      const [configRows] = await sql(
        connection,
        `SELECT resolution_id,resolved_sha256,secrets_included
         FROM growth_control_config_resolution_snapshots
         WHERE resolution_id=?
         LIMIT 1 FOR UPDATE`,
        [input.configResolutionId]
      );
      const config = configRows?.[0];
      if (!config) {
        throw new GrowthControlPlaneError(
          "GROWTH_CONTROL_CONFIG_SNAPSHOT_NOT_FOUND",
          "Configuration resolution snapshot was not found.",
          404
        );
      }
      if (Number(config.secrets_included) !== 0) {
        throw new GrowthControlPlaneError(
          "GROWTH_CONTROL_CONFIG_SNAPSHOT_SENSITIVE",
          "Configuration resolution snapshot is not eligible for plan persistence.",
          409
        );
      }
      if (String(config.resolved_sha256) !== String(input.configHashSha256)) {
        throw new GrowthControlPlaneError(
          "GROWTH_CONTROL_CONFIG_SNAPSHOT_HASH_MISMATCH",
          "Configuration resolution snapshot hash changed or does not match the requested bundle.",
          409,
          [{
            field: "configHashSha256",
            issue: "hash_mismatch",
            expected: input.configHashSha256,
            actual: config.resolved_sha256
          }]
        );
      }

      await sql(
        connection,
        `INSERT INTO growth_control_compiled_policy_snapshots
         (policy_snapshot_id,tenant_id,workspace_id,brand_key,activity_binding_id,
          workflow_key,workflow_version,policy_versions_json,policy_snapshot_json,
          policy_hash_sha256,version_set_hash_sha256,idempotency_key,created_by,
          provider_calls,provider_dispatch_allowed,provider_apply_allowed,external_writes,secrets_included)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,0,0,0)`,
        [
          input.policySnapshotId,
          input.tenantId,
          input.workspaceId,
          input.brandKey,
          input.activityBindingId,
          input.workflowKey,
          input.workflowVersion,
          input.policyVersionsJson,
          input.policySnapshotJson,
          input.policyHashSha256,
          input.versionSetHashSha256,
          `${input.idempotencyKey}:policy`,
          input.createdBy
        ]
      );

      await sql(
        connection,
        `INSERT INTO growth_control_compiled_plan_snapshots
         (plan_snapshot_id,policy_snapshot_id,config_resolution_id,tenant_id,workspace_id,
          brand_key,activity_binding_id,activity_pack_version_id,workflow_key,workflow_version,
          resolved_versions_json,plan_snapshot_json,config_hash_sha256,policy_hash_sha256,
          plan_hash_sha256,version_set_hash_sha256,bundle_hash_sha256,idempotency_key,created_by,
          immutable,provider_calls,provider_dispatch_allowed,provider_apply_allowed,external_writes,secrets_included)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0,0,0,0,0)`,
        [
          input.planSnapshotId,
          input.policySnapshotId,
          input.configResolutionId,
          input.tenantId,
          input.workspaceId,
          input.brandKey,
          input.activityBindingId,
          input.activityPackVersionId,
          input.workflowKey,
          input.workflowVersion,
          input.resolvedVersionsJson,
          input.planSnapshotJson,
          input.configHashSha256,
          input.policyHashSha256,
          input.planHashSha256,
          input.versionSetHashSha256,
          input.bundleHashSha256,
          input.idempotencyKey,
          input.createdBy
        ]
      );

      const [readbackRows] = await sql(
        connection,
        joinedSnapshotSelect("p.plan_snapshot_id=?"),
        [input.planSnapshotId]
      );
      const verified = verifyReadback(readbackRows?.[0], input);
      return snapshotRow(verified, false);
    });
  }

  return Object.freeze({ persistWorkflowPlanSnapshot });
}

export const _testingWorkflowPlanSnapshotRepository = Object.freeze({
  parseJson,
  snapshotRow,
  verifyReadback,
  joinedSnapshotSelect
});
