import { randomUUID } from "node:crypto";
import {
  decodePageToken,
  descriptor,
  encodePageToken,
  isOwnerRole,
  parsePageSize,
  resourceTimestamp,
} from "../../domain/resourceApi/resourceCatalog.js";
import {
  assertWorkspaceAssetBrandPatchSafe,
  resolveWorkspaceAssetBrandRef,
} from "../../../workspaceAssetBrandAuthority.js";

function buildQueryParts(resourceDescriptor, query = {}, context = null) {
  const params = [];
  const clauses = [];
  if (context) {
    clauses.push(`r.${resourceDescriptor.tenant}=?`);
    params.push(context.tenantId);
    if (resourceDescriptor.memberOwnOnly && !isOwnerRole(context.member?.role)) {
      clauses.push(`r.${resourceDescriptor.user}=?`);
      params.push(context.auth.user_id);
    }
  } else {
    if (query.tenant_id) {
      clauses.push(`r.${resourceDescriptor.tenant}=?`);
      params.push(String(query.tenant_id).slice(0, 128));
    }
    if (query.user_id) {
      clauses.push(`r.${resourceDescriptor.user}=?`);
      params.push(String(query.user_id).slice(0, 128));
    }
  }

  for (const [input, column] of Object.entries(resourceDescriptor.filters || {})) {
    if (query[input] === undefined || query[input] === "") continue;
    clauses.push(`${column}=?`);
    params.push(String(query[input]).slice(0, 255));
  }

  const term = String(query.q || "").trim();
  if (term && resourceDescriptor.search.length) {
    const pattern = `%${term.slice(0, 200).replace(/[%_]/g, "\\$&")}%`;
    clauses.push(`(${resourceDescriptor.search.map((field) => `${field} LIKE ? ESCAPE '\\\\'`).join(" OR ")})`);
    resourceDescriptor.search.forEach(() => params.push(pattern));
  }

  const token = decodePageToken(query.pageToken);
  if (token?.time) {
    clauses.push(`${resourceDescriptor.time}<?`);
    params.push(token.time);
  }
  return { clauses, params };
}

function resourceRepositoryInvariantError(code, message, status = 409) {
  return Object.assign(new Error(message), { code, status });
}

export function createResourceRepository({ pool = null, resolvePool = null, transactionConnection = false }) {
  if (!pool?.query && typeof resolvePool !== "function") {
    throw new TypeError("Resource repository requires a SQL pool or lazy pool resolver.");
  }
  const activeExecutor = () => {
    const executor = pool || resolvePool();
    if (!executor?.query) throw new TypeError("Resource repository pool resolver returned an invalid SQL pool.");
    return executor;
  };
  const executeQuery = (...args) => {
    return activeExecutor().query(...args);
  };

  let repository = null;

  async function withTransaction(operation) {
    if (typeof operation !== "function") {
      throw new TypeError("Resource repository transaction requires an operation callback.");
    }
    if (transactionConnection) return operation(repository);

    const activePool = activeExecutor();
    if (typeof activePool.getConnection !== "function") {
      const error = new Error("Resource mutation requires a transaction-capable SQL pool.");
      error.code = "resource_transaction_unavailable";
      error.status = 503;
      throw error;
    }

    const connection = await activePool.getConnection();
    let transactionStarted = false;
    try {
      await connection.beginTransaction();
      transactionStarted = true;
      const transactionalRepository = createResourceRepository({
        pool: connection,
        transactionConnection: true,
      });
      const result = await operation(transactionalRepository);
      await connection.commit();
      transactionStarted = false;
      return result;
    } catch (error) {
      if (transactionStarted) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          const failure = new Error("Resource transaction rollback could not be verified.");
          failure.code = "resource_transaction_rollback_failed";
          failure.status = 500;
          failure.details = {
            original_code: error?.code || null,
            rollback_code: rollbackError?.code || null,
            state: "indeterminate",
          };
          failure.cause = error;
          throw failure;
        }
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  async function findMembership(userId, tenantId) {
    const [rows] = await executeQuery(
      `SELECT m.user_id,m.tenant_id,m.role,m.status,t.status AS tenant_status
         FROM memberships m
         JOIN tenants t ON t.tenant_id=m.tenant_id
        WHERE m.user_id=? AND m.tenant_id=?
        LIMIT 1`,
      [userId, tenantId]
    );
    return rows[0] || null;
  }

  async function listResource(resourceKey, query = {}, context = null) {
    const resourceDescriptor = descriptor(resourceKey);
    if (!resourceDescriptor) return null;
    const { clauses, params } = buildQueryParts(resourceDescriptor, query, context);
    const limit = parsePageSize(query.pageSize || query.limit);
    params.push(limit + 1);
    const [rows] = await executeQuery(
      `SELECT ${resourceDescriptor.fields}
         FROM ${resourceDescriptor.table} r
         ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
        ORDER BY ${resourceDescriptor.order}
        LIMIT ?`,
      params
    );
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items,
      count: items.length,
      nextPageToken: hasMore ? encodePageToken(items.at(-1), resourceDescriptor) : null,
    };
  }

  async function getResource(resourceKey, resourceId, context = null) {
    const resourceDescriptor = descriptor(resourceKey);
    if (!resourceDescriptor) return null;
    const params = [String(resourceId)];
    const clauses = [`r.${resourceDescriptor.id}=?`];
    if (context) {
      clauses.push(`r.${resourceDescriptor.tenant}=?`);
      params.push(context.tenantId);
      if (resourceDescriptor.memberOwnOnly && !isOwnerRole(context.member?.role)) {
        clauses.push(`r.${resourceDescriptor.user}=?`);
        params.push(context.auth.user_id);
      }
    }
    const [rows] = await executeQuery(
      `SELECT ${resourceDescriptor.fields}
         FROM ${resourceDescriptor.table} r
        WHERE ${clauses.join(" AND ")}
        LIMIT 1`,
      params
    );
    return rows[0] || null;
  }

  async function insertAsset({ tenantId, actorId, input }) {
    const assetId = String(input.asset_id || randomUUID()).slice(0, 64);
    const canonicalBrandRef = await resolveWorkspaceAssetBrandRef(activeExecutor(), {
      tenantId,
      actorId: actorId || "platform_admin",
      brandRef: input.brand_ref,
    });
    await executeQuery(
      `INSERT INTO workspace_assets
        (asset_id,tenant_id,vault_id,asset_type,asset_ref,display_name,brand_ref,site_ref,
         workflow_ref,session_ref,visibility,lifecycle_status,metadata_json,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        assetId,
        tenantId,
        input.vault_id || null,
        String(input.asset_type),
        input.asset_ref || null,
        String(input.display_name),
        canonicalBrandRef,
        input.site_ref || null,
        input.workflow_ref || null,
        input.session_ref || null,
        input.visibility || "workspace",
        input.lifecycle_status || "active",
        input.metadata_json && typeof input.metadata_json === "object" ? JSON.stringify(input.metadata_json) : null,
        actorId || "platform_admin",
      ]
    );
    const [readbackRows] = await executeQuery(
      `SELECT asset_id,tenant_id,brand_ref
         FROM workspace_assets
        WHERE asset_id=? AND tenant_id=?
        LIMIT 2 FOR UPDATE`,
      [assetId, tenantId]
    );
    if (!Array.isArray(readbackRows) || readbackRows.length !== 1) {
      throw resourceRepositoryInvariantError(
        "workspace_asset_brand_readback_invalid",
        "Created workspace asset did not resolve exactly once before commit."
      );
    }
    const [readback] = readbackRows;
    const persistedBrandRef = String(readback.brand_ref || "").trim();
    const expectedBrandRef = String(canonicalBrandRef || "").trim();
    if (persistedBrandRef !== expectedBrandRef) {
      throw resourceRepositoryInvariantError(
        "workspace_asset_brand_readback_mismatch",
        "Created workspace asset Brand attachment did not match canonical authority before commit."
      );
    }
    return assetId;
  }

  async function updateAssetFields(assetId, input = {}) {
    assertWorkspaceAssetBrandPatchSafe(input);
    const allowed = [
      "display_name",
      "asset_ref",
      "site_ref",
      "workflow_ref",
      "session_ref",
      "visibility",
      "lifecycle_status",
    ];
    const sets = [];
    const params = [];
    for (const field of allowed) {
      if (input[field] === undefined) continue;
      sets.push(`${field}=?`);
      params.push(input[field] === null ? null : String(input[field]).slice(0, 512));
    }
    if (input.metadata_json && typeof input.metadata_json === "object") {
      sets.push("metadata_json=?");
      params.push(JSON.stringify(input.metadata_json));
    }
    if (!sets.length) return false;
    params.push(assetId);
    await executeQuery(
      `UPDATE workspace_assets
          SET ${sets.join(",")},updated_at=NOW()
        WHERE asset_id=?`,
      params
    );
    return true;
  }

  async function setAssetLifecycle(assetId, lifecycleStatus) {
    await executeQuery(
      "UPDATE workspace_assets SET lifecycle_status=?,updated_at=NOW() WHERE asset_id=?",
      [lifecycleStatus, assetId]
    );
  }

  async function listRevisions(resourceKey, resourceId, context = null) {
    const item = await getResource(resourceKey, resourceId, context);
    if (!item) return null;
    if (resourceKey !== "sessions") return { supported: false, revisions: [] };
    const params = [resourceId];
    let scope = "";
    if (context) {
      scope = " AND tenant_id=?";
      params.push(context.tenantId);
    }
    const [rows] = await executeQuery(
      `SELECT summary_id AS revision_id,created_at,analyzed_at,analyzed,turn_count,complexity,session_model
         FROM session_summaries
        WHERE session_id=?${scope}
        ORDER BY created_at DESC
        LIMIT 100`,
      params
    );
    return { supported: true, revisions: rows };
  }

  async function listChanges(resourceKey, query = {}, context = null, resourceId = null) {
    if (resourceId) {
      const item = await getResource(resourceKey, resourceId, context);
      return {
        items: item
          ? [{
              resourceKey,
              resourceId: String(resourceId),
              changedAt: resourceTimestamp(item),
              changeType: "snapshot",
            }]
          : [],
        nextPageToken: null,
      };
    }
    const page = await listResource(resourceKey, { ...query, pageSize: query.pageSize || 100 }, context);
    if (!page) return null;
    const resourceDescriptor = descriptor(resourceKey);
    return {
      ...page,
      items: page.items.map((item) => ({
        resourceKey,
        resourceId: String(item[resourceDescriptor.id]),
        changedAt: resourceTimestamp(item),
        changeType: "upsert",
      })),
    };
  }

  async function getSessionSummary(sessionId) {
    const session = await getResource("sessions", sessionId);
    if (!session) return null;
    const [rows] = await executeQuery(
      `SELECT summary_id,session_id,summary_text,tasks_completed,blockers,feature_requests,integration_needs,
              complexity,session_model,turn_count,analyzed,analyzed_at,created_at
         FROM session_summaries
        WHERE session_id=?
        ORDER BY created_at DESC
        LIMIT 1`,
      [sessionId]
    );
    return { session, summary: rows[0] || null };
  }

  async function listSessionTurns(sessionId, query = {}) {
    const session = await getResource("sessions", sessionId);
    if (!session) return null;
    const limit = parsePageSize(query.pageSize || query.limit);
    const parsedAfter = Number.parseInt(String(query.after || "-1"), 10);
    const after = Math.max(-1, Number.isFinite(parsedAfter) ? parsedAfter : -1);
    const params = [sessionId, after];
    let roleClause = "";
    if (query.role) {
      roleClause = " AND role=?";
      params.push(String(query.role).slice(0, 32));
    }
    params.push(limit + 1);
    const [rows] = await executeQuery(
      `SELECT turn_id,turn_index,role,content_preview,content_sha256,storage_mode,action_key,
              drive_doc_part,drive_anchor,created_at
         FROM gpt_session_turns
        WHERE session_id=? AND turn_index>?${roleClause}
        ORDER BY turn_index ASC
        LIMIT ?`,
      params
    );
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return { session, items, nextAfter: hasMore ? items.at(-1).turn_index : null };
  }

  async function listSessionEvents(sessionId, query = {}) {
    const session = await getResource("sessions", sessionId);
    if (!session) return null;
    const params = [sessionId];
    let eventClause = "";
    if (query.event_type) {
      eventClause = " AND event_type=?";
      params.push(String(query.event_type).slice(0, 128));
    }
    params.push(parsePageSize(query.pageSize || query.limit));
    const [rows] = await executeQuery(
      `SELECT event_id,session_id,turn_id,record_type,event_type,tool_name,status,payload_preview,
              payload_sha256,redaction_status,event_timestamp,created_at
         FROM session_events
        WHERE session_id=?${eventClause}
        ORDER BY COALESCE(event_timestamp,created_at) DESC,id DESC
        LIMIT ?`,
      params
    );
    return { session, items: rows };
  }

  repository = {
    withTransaction,
    findMembership,
    listResource,
    getResource,
    insertAsset,
    updateAssetFields,
    setAssetLifecycle,
    listRevisions,
    listChanges,
    getSessionSummary,
    listSessionTurns,
    listSessionEvents,
  };
  return repository;
}

export const _testingResourceRepository = { buildQueryParts };
