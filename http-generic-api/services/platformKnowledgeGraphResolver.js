import { createHash, randomUUID } from "node:crypto";
import { getPool } from "../db.js";

const FORBIDDEN_SECRET_TERMS = [
  "BACKEND_API_KEY",
  "JWT_SECRET",
  "connector_secret",
  "cf_token",
  "device_access_token",
  "poll_token_hash",
  "api_key_value",
  "oauth_client_secret",
  "password_hash",
];

function normalize(value = "") {
  return String(value ?? "").trim();
}

function lower(value = "") {
  return normalize(value).toLowerCase();
}

function bool(value) {
  if (value === true || value === false) return value;
  return ["true", "1", "yes", "active", "enabled"].includes(lower(value));
}

function idPart(value = "") {
  const cleaned = normalize(value)
    .replace(/^user:/i, "")
    .replace(/^tenant:/i, "")
    .replace(/^device:/i, "")
    .replace(/^workflow:/i, "")
    .replace(/^asset:/i, "")
    .replace(/^platform:/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return cleaned || "unknown";
}

function nodeId(type, key) {
  return `${idPart(type)}.${idPart(key)}`.slice(0, 255);
}

function edgeId(source, edgeType, target, sourceTable = "", sourcePk = "") {
  const hash = createHash("sha256")
    .update([source, edgeType, target, sourceTable, sourcePk].map(normalize).join("|"))
    .digest("hex")
    .slice(0, 32);
  return `edge.${hash}`;
}

function safeJson(value) {
  if (value == null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ serialization_error: true });
  }
}

function parseMaybeJson(value, fallback = null) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function splitList(value) {
  const raw = normalize(value);
  if (!raw) return [];
  const json = parseMaybeJson(raw, null);
  if (Array.isArray(json)) return json.map(normalize).filter(Boolean);
  return raw
    .split(/[;,|\n]+/g)
    .map(normalize)
    .filter(Boolean);
}

function pickStatus(value, fallback = "active") {
  const v = lower(value);
  if (["active", "enabled", "true", "ready", "completed", "approved"].includes(v)) return "active";
  if (["archived", "deprecated", "retired", "revoked", "suspended", "false", "inactive"].includes(v)) return "archived";
  return fallback;
}

function sensitivityForScope(scopeType) {
  if (scopeType === "user") return "user_private";
  if (scopeType === "tenant" || scopeType === "device" || scopeType === "brand") return "tenant_private";
  return "internal";
}

function subjectNodeId(subjectType, subjectRef, subjectKey = "") {
  const type = idPart(subjectType || "platform");
  const ref = normalize(subjectRef || subjectKey || "global");
  if (type === "platform") return "platform.global";
  if (type === "tenant") return nodeId("tenant", ref);
  if (type === "user") return nodeId("user", ref);
  if (type === "device") return nodeId("device", ref);
  if (type === "workflow") return nodeId("workflow", ref);
  if (type === "module") return nodeId("module", ref);
  if (type === "conversation") return nodeId("conversation", ref);
  if (type === "execution_trace") return nodeId("execution_trace", ref);
  if (type === "brand") return nodeId("brand", ref);
  return nodeId(type, ref);
}

async function queryIfTableExists(pool, tableName, sql, params = []) {
  const [exists] = await pool.query(
    `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName]
  );
  if (!Number(exists?.[0]?.c || 0)) return [];
  const [rows] = await pool.query(sql, params);
  return Array.isArray(rows) ? rows : [];
}

function makeNode(input) {
  return {
    node_id: input.node_id,
    node_type: input.node_type || "contract",
    node_label: input.node_label || input.node_id,
    scope_type: input.scope_type || "platform",
    subject_ref: input.subject_ref || null,
    source_table: input.source_table || null,
    source_pk: input.source_pk || null,
    authority_status: input.authority_status || "candidate",
    lifecycle_status: input.lifecycle_status || "active",
    visibility_scope: input.visibility_scope || "platform_admin",
    sensitivity: input.sensitivity || sensitivityForScope(input.scope_type || "platform"),
    evidence_level: input.evidence_level || "declared",
    runtime_role: input.runtime_role || "advisory",
    source_system: input.source_system || "sql",
    metadata_json: input.metadata_json || null,
  };
}

function makeEdge(input) {
  const edge_type = input.edge_type || "linked_to";
  return {
    edge_id: input.edge_id || edgeId(input.source_node_id, edge_type, input.target_node_id, input.source_table, input.source_pk),
    source_node_id: input.source_node_id,
    edge_type,
    target_node_id: input.target_node_id,
    scope_type: input.scope_type || "platform",
    authority_status: input.authority_status || "candidate",
    lifecycle_status: input.lifecycle_status || "active",
    visibility_scope: input.visibility_scope || "platform_admin",
    sensitivity: input.sensitivity || sensitivityForScope(input.scope_type || "platform"),
    evidence_level: input.evidence_level || "declared",
    runtime_role: input.runtime_role || "advisory",
    runtime_enforced: input.runtime_enforced ? 1 : 0,
    source_table: input.source_table || null,
    source_pk: input.source_pk || null,
    metadata_json: input.metadata_json || null,
  };
}

function addNode(map, input) {
  if (!input?.node_id) return null;
  const node = makeNode(input);
  const existing = map.get(node.node_id);
  if (!existing || existing.authority_status !== "authoritative") map.set(node.node_id, { ...existing, ...node });
  return node.node_id;
}

function addEdge(map, input) {
  if (!input?.source_node_id || !input?.target_node_id) return null;
  const edge = makeEdge(input);
  map.set(edge.edge_id, edge);
  return edge.edge_id;
}

async function upsertNodes(pool, nodes) {
  const rows = [...nodes.values()];
  const chunkSize = 250;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const values = [];
    const placeholders = chunk.map((node) => {
      values.push(
        node.node_id,
        node.node_type,
        node.node_label,
        node.scope_type,
        node.subject_ref,
        node.source_table,
        node.source_pk,
        node.authority_status,
        node.lifecycle_status,
        node.visibility_scope,
        node.sensitivity,
        node.evidence_level,
        node.runtime_role,
        node.source_system,
        safeJson(node.metadata_json)
      );
      return "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,CAST(? AS JSON))";
    }).join(",");
    await pool.query(
      `INSERT INTO platform_graph_nodes
       (node_id,node_type,node_label,scope_type,subject_ref,source_table,source_pk,authority_status,lifecycle_status,visibility_scope,sensitivity,evidence_level,runtime_role,source_system,metadata_json)
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE
        node_type=VALUES(node_type), node_label=VALUES(node_label), scope_type=VALUES(scope_type), subject_ref=VALUES(subject_ref),
        source_table=VALUES(source_table), source_pk=VALUES(source_pk), authority_status=VALUES(authority_status), lifecycle_status=VALUES(lifecycle_status),
        visibility_scope=VALUES(visibility_scope), sensitivity=VALUES(sensitivity), evidence_level=VALUES(evidence_level), runtime_role=VALUES(runtime_role),
        source_system=VALUES(source_system), metadata_json=VALUES(metadata_json), updated_at=CURRENT_TIMESTAMP`,
      values
    );
  }
  return rows.length;
}

async function upsertEdges(pool, edges) {
  const rows = [...edges.values()];
  const chunkSize = 250;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const values = [];
    const placeholders = chunk.map((edge) => {
      values.push(
        edge.edge_id,
        edge.source_node_id,
        edge.edge_type,
        edge.target_node_id,
        edge.scope_type,
        edge.authority_status,
        edge.lifecycle_status,
        edge.visibility_scope,
        edge.sensitivity,
        edge.evidence_level,
        edge.runtime_role,
        Number(edge.runtime_enforced || 0),
        edge.source_table,
        edge.source_pk,
        safeJson(edge.metadata_json)
      );
      return "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,CAST(? AS JSON))";
    }).join(",");
    await pool.query(
      `INSERT INTO platform_graph_edges
       (edge_id,source_node_id,edge_type,target_node_id,scope_type,authority_status,lifecycle_status,visibility_scope,sensitivity,evidence_level,runtime_role,runtime_enforced,source_table,source_pk,metadata_json)
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE
        source_node_id=VALUES(source_node_id), edge_type=VALUES(edge_type), target_node_id=VALUES(target_node_id), scope_type=VALUES(scope_type),
        authority_status=VALUES(authority_status), lifecycle_status=VALUES(lifecycle_status), visibility_scope=VALUES(visibility_scope), sensitivity=VALUES(sensitivity),
        evidence_level=VALUES(evidence_level), runtime_role=VALUES(runtime_role), runtime_enforced=VALUES(runtime_enforced), source_table=VALUES(source_table),
        source_pk=VALUES(source_pk), metadata_json=VALUES(metadata_json), updated_at=CURRENT_TIMESTAMP`,
      values
    );
  }
  return rows.length;
}

export async function ensurePlatformGraphTables() {
  const pool = getPool();
  await pool.query(`CREATE TABLE IF NOT EXISTS platform_graph_nodes (
    node_id VARCHAR(255) NOT NULL PRIMARY KEY,
    node_type VARCHAR(120) NOT NULL,
    node_label VARCHAR(500) NULL,
    scope_type VARCHAR(80) NOT NULL DEFAULT 'platform',
    subject_ref VARCHAR(255) NULL,
    source_table VARCHAR(120) NULL,
    source_pk VARCHAR(255) NULL,
    authority_status VARCHAR(80) NOT NULL DEFAULT 'candidate',
    lifecycle_status VARCHAR(80) NOT NULL DEFAULT 'active',
    visibility_scope VARCHAR(120) NOT NULL DEFAULT 'platform_admin',
    sensitivity VARCHAR(80) NOT NULL DEFAULT 'internal',
    evidence_level VARCHAR(80) NOT NULL DEFAULT 'declared',
    runtime_role VARCHAR(80) NOT NULL DEFAULT 'advisory',
    source_system VARCHAR(80) NOT NULL DEFAULT 'sql',
    metadata_json JSON NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await pool.query(`CREATE TABLE IF NOT EXISTS platform_graph_edges (
    edge_id VARCHAR(255) NOT NULL PRIMARY KEY,
    source_node_id VARCHAR(255) NOT NULL,
    edge_type VARCHAR(120) NOT NULL,
    target_node_id VARCHAR(255) NOT NULL,
    scope_type VARCHAR(80) NOT NULL DEFAULT 'platform',
    authority_status VARCHAR(80) NOT NULL DEFAULT 'candidate',
    lifecycle_status VARCHAR(80) NOT NULL DEFAULT 'active',
    visibility_scope VARCHAR(120) NOT NULL DEFAULT 'platform_admin',
    sensitivity VARCHAR(80) NOT NULL DEFAULT 'internal',
    evidence_level VARCHAR(80) NOT NULL DEFAULT 'declared',
    runtime_role VARCHAR(80) NOT NULL DEFAULT 'advisory',
    runtime_enforced TINYINT(1) NOT NULL DEFAULT 0,
    source_table VARCHAR(120) NULL,
    source_pk VARCHAR(255) NULL,
    metadata_json JSON NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_platform_graph_edges_source (source_node_id, edge_type, lifecycle_status),
    KEY idx_platform_graph_edges_target (target_node_id, edge_type, lifecycle_status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await pool.query(`CREATE TABLE IF NOT EXISTS platform_graph_projection_runs (
    run_id VARCHAR(64) NOT NULL PRIMARY KEY,
    projection_key VARCHAR(160) NOT NULL,
    projection_mode VARCHAR(80) NOT NULL DEFAULT 'advisory_projection',
    status ENUM('running','completed','failed') NOT NULL DEFAULT 'running',
    source_counts_json JSON NULL,
    result_counts_json JSON NULL,
    warnings_json JSON NULL,
    error_json JSON NULL,
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await pool.query(`CREATE TABLE IF NOT EXISTS platform_graph_validation_runs (
    run_id VARCHAR(64) NOT NULL PRIMARY KEY,
    validation_key VARCHAR(160) NOT NULL,
    status ENUM('running','passed','failed','warning') NOT NULL DEFAULT 'running',
    checked_nodes INT NOT NULL DEFAULT 0,
    checked_edges INT NOT NULL DEFAULT 0,
    failure_count INT NOT NULL DEFAULT 0,
    warning_count INT NOT NULL DEFAULT 0,
    results_json JSON NULL,
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

export async function projectPlatformKnowledgeGraph({ projectionKey = "runtime_projection", dryRun = false } = {}) {
  const pool = getPool();
  await ensurePlatformGraphTables();
  const runId = randomUUID();
  await pool.query(
    `INSERT INTO platform_graph_projection_runs (run_id, projection_key, projection_mode, status) VALUES (?, ?, 'advisory_projection', 'running')`,
    [runId, projectionKey]
  );

  const nodes = new Map();
  const edges = new Map();
  const sourceCounts = {};
  const warnings = [];

  try {
    addNode(nodes, { node_id: "platform.global", node_type: "platform", node_label: "Platform Global", scope_type: "platform", subject_ref: "platform:global", authority_status: "authoritative", runtime_role: "authority" });

    const tenants = await queryIfTableExists(pool, "tenants", `SELECT tenant_id, tenant_type, display_name, status FROM tenants`);
    sourceCounts.tenants = tenants.length;
    for (const row of tenants) {
      const nid = addNode(nodes, { node_id: nodeId("tenant", row.tenant_id), node_type: "tenant", node_label: row.display_name || row.tenant_id, scope_type: "tenant", subject_ref: row.tenant_id, source_table: "tenants", source_pk: row.tenant_id, authority_status: "authoritative", lifecycle_status: pickStatus(row.status), runtime_role: "authority", metadata_json: { tenant_type: row.tenant_type, status: row.status } });
      addEdge(edges, { source_node_id: "platform.global", edge_type: "owns", target_node_id: nid, source_table: "tenants", source_pk: row.tenant_id, authority_status: "authoritative", runtime_role: "authority" });
    }

    const users = await queryIfTableExists(pool, "users", `SELECT user_id, email, display_name, status FROM users`);
    sourceCounts.users = users.length;
    for (const row of users) {
      addNode(nodes, { node_id: nodeId("user", row.user_id), node_type: "user", node_label: row.email || row.display_name || row.user_id, scope_type: "user", subject_ref: row.user_id, source_table: "users", source_pk: row.user_id, authority_status: "authoritative", lifecycle_status: pickStatus(row.status), runtime_role: "authority", sensitivity: "user_private", metadata_json: { email: row.email, status: row.status } });
    }

    const memberships = await queryIfTableExists(pool, "memberships", `SELECT id, user_id, tenant_id, role, status FROM memberships`);
    sourceCounts.memberships = memberships.length;
    for (const row of memberships) {
      const userNode = nodeId("user", row.user_id);
      const tenantNode = nodeId("tenant", row.tenant_id);
      addNode(nodes, { node_id: userNode, node_type: "user", node_label: row.user_id, scope_type: "user", subject_ref: row.user_id, source_table: "memberships", source_pk: row.user_id, authority_status: "candidate", sensitivity: "user_private" });
      addNode(nodes, { node_id: tenantNode, node_type: "tenant", node_label: row.tenant_id, scope_type: "tenant", subject_ref: row.tenant_id, source_table: "memberships", source_pk: row.tenant_id, authority_status: "candidate" });
      addEdge(edges, { source_node_id: userNode, edge_type: "member_of", target_node_id: tenantNode, scope_type: "tenant", source_table: "memberships", source_pk: String(row.id), authority_status: "authoritative", runtime_role: "authority", runtime_enforced: true, metadata_json: { role: row.role, status: row.status } });
    }

    const assets = await queryIfTableExists(pool, "json_assets", `SELECT asset_id, asset_key, asset_type, brand_name, active_status, validation_status, source_mode FROM json_assets`);
    sourceCounts.json_assets = assets.length;
    for (const row of assets) {
      addNode(nodes, { node_id: nodeId("json_asset", row.asset_id), node_type: "json_asset", node_label: row.asset_key || row.asset_id, scope_type: "platform", subject_ref: row.asset_id, source_table: "json_assets", source_pk: row.asset_id, authority_status: row.validation_status === "validated" ? "authoritative" : "candidate", lifecycle_status: pickStatus(row.active_status), runtime_role: String(row.asset_type || "").includes("doctrine") || String(row.asset_type || "").includes("memory") ? "resolver_input" : "advisory", metadata_json: { asset_key: row.asset_key, asset_type: row.asset_type, brand_name: row.brand_name, validation_status: row.validation_status, source_mode: row.source_mode } });
    }

    const subjectLinks = await queryIfTableExists(pool, "json_asset_subject_links", `SELECT link_id, asset_id, asset_key, subject_type, subject_ref, tenant_id, user_id, subject_key, linkage_type, scope_label, status FROM json_asset_subject_links WHERE status='active'`);
    sourceCounts.json_asset_subject_links = subjectLinks.length;
    for (const row of subjectLinks) {
      const assetNode = nodeId("json_asset", row.asset_id);
      const targetNode = subjectNodeId(row.subject_type, row.subject_ref, row.subject_key);
      addNode(nodes, { node_id: assetNode, node_type: "json_asset", node_label: row.asset_key || row.asset_id, scope_type: row.subject_type === "platform" ? "platform" : row.subject_type, subject_ref: row.asset_id, source_table: "json_asset_subject_links", source_pk: row.link_id, authority_status: "authoritative" });
      addNode(nodes, { node_id: targetNode, node_type: row.subject_type || "platform", node_label: row.subject_key || row.subject_ref, scope_type: row.subject_type || "platform", subject_ref: row.subject_ref, source_table: "json_asset_subject_links", source_pk: row.link_id, authority_status: "candidate", sensitivity: sensitivityForScope(row.subject_type) });
      addEdge(edges, { source_node_id: assetNode, edge_type: "attached_to", target_node_id: targetNode, scope_type: row.subject_type || "platform", source_table: "json_asset_subject_links", source_pk: row.link_id, authority_status: "authoritative", runtime_role: "resolver_input", runtime_enforced: true, metadata_json: { linkage_type: row.linkage_type, scope_label: row.scope_label, tenant_id: row.tenant_id, user_id: row.user_id } });
    }

    const devices = await queryIfTableExists(pool, "local_manager_device_link_sessions", `SELECT session_id, status, device_id, hostname, platform, app_version, user_id, tenant_id, approved_at, completed_at FROM local_manager_device_link_sessions`);
    sourceCounts.local_manager_device_link_sessions = devices.length;
    for (const row of devices) {
      const sessionNode = nodeId("app_session", row.session_id);
      const deviceNode = nodeId("device", row.device_id || row.hostname || row.session_id);
      addNode(nodes, { node_id: sessionNode, node_type: "app_session", node_label: row.session_id, scope_type: "device", subject_ref: row.session_id, source_table: "local_manager_device_link_sessions", source_pk: row.session_id, lifecycle_status: pickStatus(row.status), authority_status: "authoritative", sensitivity: "tenant_private", metadata_json: { status: row.status, app_version: row.app_version } });
      addNode(nodes, { node_id: deviceNode, node_type: "device", node_label: row.hostname || row.device_id, scope_type: "device", subject_ref: row.device_id, source_table: "local_manager_device_link_sessions", source_pk: row.session_id, lifecycle_status: pickStatus(row.status), authority_status: "authoritative", runtime_role: "resolver_input", sensitivity: "tenant_private", metadata_json: { hostname: row.hostname, platform: row.platform, app_version: row.app_version, status: row.status } });
      addEdge(edges, { source_node_id: sessionNode, edge_type: "linked_to", target_node_id: deviceNode, scope_type: "device", source_table: "local_manager_device_link_sessions", source_pk: row.session_id, authority_status: "authoritative", runtime_role: "resolver_input", runtime_enforced: true, metadata_json: { status: row.status } });
      if (row.user_id) {
        const userNode = nodeId("user", row.user_id);
        addNode(nodes, { node_id: userNode, node_type: "user", node_label: row.user_id, scope_type: "user", subject_ref: row.user_id, authority_status: "candidate", sensitivity: "user_private" });
        addEdge(edges, { source_node_id: deviceNode, edge_type: "linked_to", target_node_id: userNode, scope_type: "user", source_table: "local_manager_device_link_sessions", source_pk: row.session_id, authority_status: "authoritative", runtime_role: "resolver_input", runtime_enforced: true });
      }
      if (row.tenant_id) {
        const tenantNode = nodeId("tenant", row.tenant_id);
        addNode(nodes, { node_id: tenantNode, node_type: "tenant", node_label: row.tenant_id, scope_type: "tenant", subject_ref: row.tenant_id, authority_status: "candidate" });
        addEdge(edges, { source_node_id: deviceNode, edge_type: "linked_to", target_node_id: tenantNode, scope_type: "tenant", source_table: "local_manager_device_link_sessions", source_pk: row.session_id, authority_status: "authoritative", runtime_role: "resolver_input", runtime_enforced: true });
      }
    }

    const releases = await queryIfTableExists(pool, "local_app_releases", `SELECT release_id, app_key, platform, release_channel, version, status, published_at FROM local_app_releases`);
    sourceCounts.local_app_releases = releases.length;
    for (const row of releases) {
      const appNode = nodeId("local_app", row.app_key);
      const releaseNode = nodeId("release", row.release_id);
      addNode(nodes, { node_id: appNode, node_type: "local_app", node_label: row.app_key, scope_type: "platform", source_table: "local_app_releases", source_pk: row.app_key, authority_status: "authoritative", runtime_role: "resolver_input" });
      addNode(nodes, { node_id: releaseNode, node_type: "release", node_label: `${row.app_key} ${row.version}`, scope_type: "platform", source_table: "local_app_releases", source_pk: row.release_id, lifecycle_status: pickStatus(row.status), authority_status: "authoritative", runtime_role: "resolver_input", metadata_json: { version: row.version, channel: row.release_channel, platform: row.platform } });
      addEdge(edges, { source_node_id: appNode, edge_type: "released_as", target_node_id: releaseNode, source_table: "local_app_releases", source_pk: row.release_id, authority_status: "authoritative", runtime_role: "resolver_input" });
    }

    const actions = await queryIfTableExists(pool, "actions", `SELECT action_key, action_id, action_title, status, module_binding, connector_family, runtime_callable, runtime_capability_class FROM actions`);
    sourceCounts.actions = actions.length;
    for (const row of actions) {
      const key = row.action_key || row.action_id;
      if (!key) continue;
      addNode(nodes, { node_id: nodeId("action", key), node_type: "action", node_label: row.action_title || key, scope_type: "platform", subject_ref: key, source_table: "actions", source_pk: key, authority_status: "authoritative", lifecycle_status: pickStatus(row.status), runtime_role: bool(row.runtime_callable) ? "authority" : "advisory", metadata_json: { module_binding: row.module_binding, connector_family: row.connector_family, runtime_capability_class: row.runtime_capability_class } });
    }

    const endpoints = await queryIfTableExists(pool, "endpoints", `SELECT endpoint_key, endpoint_id, parent_action_key, endpoint_operation, method, provider_domain, status, execution_readiness, endpoint_role, execution_mode, transport_required FROM endpoints`);
    sourceCounts.endpoints = endpoints.length;
    for (const row of endpoints) {
      const key = row.endpoint_key || row.endpoint_id;
      if (!key) continue;
      const endpointNode = nodeId("endpoint", key);
      addNode(nodes, { node_id: endpointNode, node_type: "endpoint", node_label: row.endpoint_operation || key, scope_type: "platform", subject_ref: key, source_table: "endpoints", source_pk: key, authority_status: "authoritative", lifecycle_status: pickStatus(row.status), runtime_role: row.execution_readiness === "ready" ? "authority" : "advisory", metadata_json: { method: row.method, provider_domain: row.provider_domain, endpoint_role: row.endpoint_role, execution_mode: row.execution_mode, transport_required: row.transport_required } });
      if (row.parent_action_key) {
        const actionNode = nodeId("action", row.parent_action_key);
        addNode(nodes, { node_id: actionNode, node_type: "action", node_label: row.parent_action_key, scope_type: "platform", source_table: "endpoints", source_pk: row.parent_action_key, authority_status: "candidate" });
        addEdge(edges, { source_node_id: actionNode, edge_type: "exposes", target_node_id: endpointNode, source_table: "endpoints", source_pk: key, authority_status: "authoritative", runtime_role: "authority", runtime_enforced: true, metadata_json: { method: row.method, operation: row.endpoint_operation } });
      }
    }

    const routes = await queryIfTableExists(pool, "task_routes", `SELECT id, task_key, route_id, intent_key, workflow_key, target_module, active, enabled, route_mode, review_required FROM task_routes`);
    sourceCounts.task_routes = routes.length;
    for (const row of routes) {
      const routeKey = row.route_id || row.task_key || row.id;
      const routeNode = nodeId("task_route", routeKey);
      addNode(nodes, { node_id: routeNode, node_type: "task_route", node_label: row.task_key || routeKey, scope_type: "platform", subject_ref: routeKey, source_table: "task_routes", source_pk: String(row.id), authority_status: "authoritative", lifecycle_status: pickStatus(row.active || row.enabled), runtime_role: "authority", metadata_json: { route_mode: row.route_mode, review_required: row.review_required } });
      if (row.intent_key) {
        const intentNode = nodeId("intent", row.intent_key);
        addNode(nodes, { node_id: intentNode, node_type: "intent", node_label: row.intent_key, scope_type: "platform", source_table: "task_routes", source_pk: String(row.id), authority_status: "authoritative", runtime_role: "authority" });
        addEdge(edges, { source_node_id: intentNode, edge_type: "routes_to", target_node_id: routeNode, source_table: "task_routes", source_pk: String(row.id), authority_status: "authoritative", runtime_role: "authority", runtime_enforced: true });
      }
      if (row.workflow_key) {
        const workflowNode = nodeId("workflow", row.workflow_key);
        addNode(nodes, { node_id: workflowNode, node_type: "workflow", node_label: row.workflow_key, scope_type: "workflow", source_table: "task_routes", source_pk: String(row.id), authority_status: "candidate", runtime_role: "authority" });
        addEdge(edges, { source_node_id: routeNode, edge_type: "triggers", target_node_id: workflowNode, scope_type: "workflow", source_table: "task_routes", source_pk: String(row.id), authority_status: "authoritative", runtime_role: "authority", runtime_enforced: true });
      }
      if (row.target_module) {
        const moduleNode = nodeId("module", row.target_module);
        addNode(nodes, { node_id: moduleNode, node_type: "module", node_label: row.target_module, scope_type: "module", source_table: "task_routes", source_pk: String(row.id), authority_status: "candidate" });
        addEdge(edges, { source_node_id: routeNode, edge_type: "uses", target_node_id: moduleNode, scope_type: "module", source_table: "task_routes", source_pk: String(row.id), authority_status: "authoritative", runtime_role: "authority" });
      }
    }

    const workflows = await queryIfTableExists(pool, "workflows", `SELECT id, workflow_key, workflow_id, workflow_name, status, active, target_module, execution_class, execution_mode FROM workflows`);
    sourceCounts.workflows = workflows.length;
    for (const row of workflows) {
      const key = row.workflow_key || row.workflow_id;
      if (!key) continue;
      const workflowNode = nodeId("workflow", key);
      addNode(nodes, { node_id: workflowNode, node_type: "workflow", node_label: row.workflow_name || key, scope_type: "workflow", subject_ref: key, source_table: "workflows", source_pk: key, authority_status: "authoritative", lifecycle_status: pickStatus(row.active || row.status), runtime_role: "authority", metadata_json: { execution_class: row.execution_class, execution_mode: row.execution_mode } });
      if (row.target_module) {
        const moduleNode = nodeId("module", row.target_module);
        addNode(nodes, { node_id: moduleNode, node_type: "module", node_label: row.target_module, scope_type: "module", source_table: "workflows", source_pk: key, authority_status: "candidate" });
        addEdge(edges, { source_node_id: workflowNode, edge_type: "uses", target_node_id: moduleNode, source_table: "workflows", source_pk: key, authority_status: "authoritative", runtime_role: "authority" });
      }
    }

    const profiles = await queryIfTableExists(pool, "business_type_profiles", `SELECT id, business_type_key, knowledge_profile_key, compatible_route_keys, compatible_workflows, profile_status, active FROM business_type_profiles`);
    sourceCounts.business_type_profiles = profiles.length;
    for (const row of profiles) {
      if (!row.business_type_key) continue;
      const btNode = nodeId("business_type", row.business_type_key);
      addNode(nodes, { node_id: btNode, node_type: "business_type", node_label: row.business_type_key, scope_type: "platform", source_table: "business_type_profiles", source_pk: String(row.id), authority_status: "authoritative", lifecycle_status: pickStatus(row.active || row.profile_status), runtime_role: "resolver_input" });
      if (row.knowledge_profile_key) {
        const kpNode = nodeId("knowledge_profile", row.knowledge_profile_key);
        addNode(nodes, { node_id: kpNode, node_type: "knowledge_profile", node_label: row.knowledge_profile_key, scope_type: "platform", source_table: "business_type_profiles", source_pk: String(row.id), authority_status: "authoritative", runtime_role: "resolver_input" });
        addEdge(edges, { source_node_id: btNode, edge_type: "activates", target_node_id: kpNode, source_table: "business_type_profiles", source_pk: String(row.id), authority_status: "authoritative", runtime_role: "resolver_input", runtime_enforced: true });
      }
      for (const routeKey of splitList(row.compatible_route_keys)) {
        addEdge(edges, { source_node_id: btNode, edge_type: "uses", target_node_id: nodeId("task_route", routeKey), source_table: "business_type_profiles", source_pk: String(row.id), authority_status: "advisory", runtime_role: "advisory" });
      }
      for (const workflowKey of splitList(row.compatible_workflows)) {
        addEdge(edges, { source_node_id: btNode, edge_type: "uses", target_node_id: nodeId("workflow", workflowKey), source_table: "business_type_profiles", source_pk: String(row.id), authority_status: "advisory", runtime_role: "advisory" });
      }
    }

    const surfaces = await queryIfTableExists(pool, "platform_contract_surfaces", `SELECT surface_id, surface_name, surface_type, surface_scope, business_type_scope, active_status, authority_status, runtime_consumption_status, current_runtime_adapter FROM platform_contract_surfaces`);
    sourceCounts.platform_contract_surfaces = surfaces.length;
    for (const row of surfaces) {
      const surfaceNode = nodeId("knowledge_surface", row.surface_id);
      addNode(nodes, { node_id: surfaceNode, node_type: "knowledge_surface", node_label: row.surface_name || row.surface_id, scope_type: row.surface_scope || "platform", subject_ref: row.surface_id, source_table: "platform_contract_surfaces", source_pk: row.surface_id, authority_status: row.authority_status || "candidate", lifecycle_status: pickStatus(row.active_status), runtime_role: row.runtime_consumption_status === "knowledge_candidate_runtime_enforced" ? "resolver_input" : "advisory", metadata_json: { surface_type: row.surface_type, runtime_adapter: row.current_runtime_adapter, runtime_consumption_status: row.runtime_consumption_status } });
      const scopes = splitList(row.business_type_scope);
      if (!scopes.length) {
        addEdge(edges, { source_node_id: "platform.global", edge_type: "uses", target_node_id: surfaceNode, source_table: "platform_contract_surfaces", source_pk: row.surface_id, authority_status: "advisory", runtime_role: "resolver_input" });
      } else {
        for (const businessType of scopes) {
          const btNode = nodeId("business_type", businessType);
          addNode(nodes, { node_id: btNode, node_type: "business_type", node_label: businessType, scope_type: "platform", authority_status: "candidate", runtime_role: "resolver_input" });
          addEdge(edges, { source_node_id: btNode, edge_type: "activates", target_node_id: surfaceNode, source_table: "platform_contract_surfaces", source_pk: row.surface_id, authority_status: "authoritative", runtime_role: "resolver_input", runtime_enforced: row.runtime_consumption_status === "knowledge_candidate_runtime_enforced" });
        }
      }
    }

    const contractNodes = await queryIfTableExists(pool, "platform_contract_nodes", `SELECT node_id, node_name, node_type, node_scope, active, authority_status, runtime_consumption_status, promotion_status FROM platform_contract_nodes`);
    sourceCounts.platform_contract_nodes = contractNodes.length;
    for (const row of contractNodes) {
      addNode(nodes, { node_id: idPart(row.node_id).includes(".") ? idPart(row.node_id) : nodeId(row.node_type || "contract", row.node_id), node_type: row.node_type || "contract", node_label: row.node_name || row.node_id, scope_type: row.node_scope || "platform", subject_ref: row.node_id, source_table: "platform_contract_nodes", source_pk: row.node_id, authority_status: row.authority_status || "candidate", lifecycle_status: pickStatus(row.active), runtime_role: row.runtime_consumption_status === "runtime_enforced" ? "authority" : "advisory", metadata_json: { promotion_status: row.promotion_status, runtime_consumption_status: row.runtime_consumption_status } });
    }

    const contractEdges = await queryIfTableExists(pool, "platform_contract_relationships", `SELECT relationship_id, source_node_id, relationship_type, target_node_id, is_active, authority_level, relationship_domain, runtime_enforced, enforcement_relevance, promotion_status FROM platform_contract_relationships`);
    sourceCounts.platform_contract_relationships = contractEdges.length;
    for (const row of contractEdges) {
      const src = idPart(row.source_node_id).includes(".") ? idPart(row.source_node_id) : nodeId("contract", row.source_node_id);
      const dst = idPart(row.target_node_id).includes(".") ? idPart(row.target_node_id) : nodeId("contract", row.target_node_id);
      if (!nodes.has(src)) addNode(nodes, { node_id: src, node_type: src.split(".")[0] || "contract", node_label: row.source_node_id, scope_type: row.relationship_domain || "platform", authority_status: "candidate", lifecycle_status: "active", runtime_role: "advisory" });
      if (!nodes.has(dst)) addNode(nodes, { node_id: dst, node_type: dst.split(".")[0] || "contract", node_label: row.target_node_id, scope_type: row.relationship_domain || "platform", authority_status: "candidate", lifecycle_status: "active", runtime_role: "advisory" });
      addEdge(edges, { source_node_id: src, edge_type: row.relationship_type || "maps_to", target_node_id: dst, scope_type: row.relationship_domain || "platform", source_table: "platform_contract_relationships", source_pk: row.relationship_id, authority_status: row.authority_level || "advisory", lifecycle_status: pickStatus(row.is_active), runtime_role: bool(row.runtime_enforced) ? "authority" : "advisory", runtime_enforced: bool(row.runtime_enforced), metadata_json: { enforcement_relevance: row.enforcement_relevance, promotion_status: row.promotion_status } });
    }

    const logs = await queryIfTableExists(pool, "execution_log", `SELECT id, entry_type, execution_class, execution_status, artifact_json_asset_id, target_module_writeback, target_workflow_writeback, execution_trace_id_writeback FROM execution_log WHERE id >= (SELECT GREATEST(0, MAX(id) - 500) FROM execution_log)`);
    sourceCounts.execution_log_tail = logs.length;
    for (const row of logs) {
      const traceKey = row.execution_trace_id_writeback || `execution_log_${row.id}`;
      const traceNode = nodeId("execution_trace", traceKey);
      addNode(nodes, { node_id: traceNode, node_type: "execution_trace", node_label: traceKey, scope_type: "platform", subject_ref: traceKey, source_table: "execution_log", source_pk: String(row.id), authority_status: "authoritative", lifecycle_status: pickStatus(row.execution_status), runtime_role: "audit_only", metadata_json: { entry_type: row.entry_type, execution_class: row.execution_class, execution_status: row.execution_status } });
      if (row.artifact_json_asset_id) {
        const assetNode = nodeId("json_asset", row.artifact_json_asset_id);
        addNode(nodes, { node_id: assetNode, node_type: "json_asset", node_label: row.artifact_json_asset_id, scope_type: "platform", source_table: "execution_log", source_pk: String(row.id), authority_status: "candidate" });
        addEdge(edges, { source_node_id: traceNode, edge_type: "produced", target_node_id: assetNode, source_table: "execution_log", source_pk: String(row.id), authority_status: "authoritative", runtime_role: "audit_only" });
      }
      if (row.target_workflow_writeback) {
        addEdge(edges, { source_node_id: traceNode, edge_type: "uses", target_node_id: nodeId("workflow", row.target_workflow_writeback), source_table: "execution_log", source_pk: String(row.id), authority_status: "advisory", runtime_role: "audit_only" });
      }
      if (row.target_module_writeback) {
        addEdge(edges, { source_node_id: traceNode, edge_type: "uses", target_node_id: nodeId("module", row.target_module_writeback), source_table: "execution_log", source_pk: String(row.id), authority_status: "advisory", runtime_role: "audit_only" });
      }
    }

    if (!dryRun) {
      await upsertNodes(pool, nodes);
      await upsertEdges(pool, edges);
    }

    const resultCounts = { nodes: nodes.size, edges: edges.size, dry_run: Boolean(dryRun) };
    await pool.query(
      `UPDATE platform_graph_projection_runs SET status='completed', source_counts_json=CAST(? AS JSON), result_counts_json=CAST(? AS JSON), warnings_json=CAST(? AS JSON), completed_at=NOW() WHERE run_id=?`,
      [safeJson(sourceCounts), safeJson(resultCounts), safeJson(warnings), runId]
    );
    return { ok: true, run_id: runId, source_counts: sourceCounts, result_counts: resultCounts, warnings };
  } catch (error) {
    await pool.query(
      `UPDATE platform_graph_projection_runs SET status='failed', error_json=CAST(? AS JSON), completed_at=NOW() WHERE run_id=?`,
      [safeJson({ code: error.code || "projection_failed", message: error.message }), runId]
    );
    throw error;
  }
}

export async function validatePlatformKnowledgeGraph() {
  const pool = getPool();
  await ensurePlatformGraphTables();
  const runId = randomUUID();
  await pool.query(`INSERT INTO platform_graph_validation_runs (run_id, validation_key, status) VALUES (?, 'platform_graph_integrity', 'running')`, [runId]);

  const [nodeCountRows] = await pool.query(`SELECT COUNT(*) AS c FROM platform_graph_nodes WHERE lifecycle_status='active'`);
  const [edgeCountRows] = await pool.query(`SELECT COUNT(*) AS c FROM platform_graph_edges WHERE lifecycle_status='active'`);
  const [missingSource] = await pool.query(`SELECT e.edge_id, e.source_node_id FROM platform_graph_edges e LEFT JOIN platform_graph_nodes n ON n.node_id=e.source_node_id WHERE n.node_id IS NULL LIMIT 50`);
  const [missingTarget] = await pool.query(`SELECT e.edge_id, e.target_node_id FROM platform_graph_edges e LEFT JOIN platform_graph_nodes n ON n.node_id=e.target_node_id WHERE n.node_id IS NULL LIMIT 50`);
  const [secretRows] = await pool.query(
    `SELECT 'node' AS kind, node_id AS id FROM platform_graph_nodes WHERE ${FORBIDDEN_SECRET_TERMS.map(() => "metadata_json LIKE ?").join(" OR ")}
     UNION ALL
     SELECT 'edge' AS kind, edge_id AS id FROM platform_graph_edges WHERE ${FORBIDDEN_SECRET_TERMS.map(() => "metadata_json LIKE ?").join(" OR ")}
     LIMIT 50`,
    [...FORBIDDEN_SECRET_TERMS.map((term) => `%${term}%`), ...FORBIDDEN_SECRET_TERMS.map((term) => `%${term}%`)]
  );
  const [runtimeWeakRows] = await pool.query(
    `SELECT e.edge_id, e.source_node_id, e.target_node_id
       FROM platform_graph_edges e
       LEFT JOIN platform_graph_nodes s ON s.node_id=e.source_node_id
       LEFT JOIN platform_graph_nodes t ON t.node_id=e.target_node_id
      WHERE e.runtime_enforced=1
        AND (COALESCE(s.lifecycle_status,'') <> 'active' OR COALESCE(t.lifecycle_status,'') <> 'active')
      LIMIT 50`
  );

  const failures = [];
  const warnings = [];
  if (missingSource.length) failures.push({ code: "missing_source_nodes", rows: missingSource });
  if (missingTarget.length) failures.push({ code: "missing_target_nodes", rows: missingTarget });
  if (secretRows.length) failures.push({ code: "forbidden_secret_terms_in_graph_metadata", rows: secretRows });
  if (runtimeWeakRows.length) warnings.push({ code: "runtime_enforced_edges_with_inactive_nodes", rows: runtimeWeakRows });

  const status = failures.length ? "failed" : warnings.length ? "warning" : "passed";
  await pool.query(
    `UPDATE platform_graph_validation_runs
        SET status=?, checked_nodes=?, checked_edges=?, failure_count=?, warning_count=?, results_json=CAST(? AS JSON), completed_at=NOW()
      WHERE run_id=?`,
    [status, Number(nodeCountRows?.[0]?.c || 0), Number(edgeCountRows?.[0]?.c || 0), failures.length, warnings.length, safeJson({ failures, warnings }), runId]
  );
  return {
    ok: !failures.length,
    status,
    run_id: runId,
    checked_nodes: Number(nodeCountRows?.[0]?.c || 0),
    checked_edges: Number(edgeCountRows?.[0]?.c || 0),
    failure_count: failures.length,
    warning_count: warnings.length,
    failures,
    warnings,
  };
}

export function guessNodeIds(input = {}) {
  const ids = [];
  const add = (id) => { if (id && !ids.includes(id)) ids.push(id); };
  add(input.node_id);
  if (input.subject_type && input.subject_ref) add(subjectNodeId(input.subject_type, input.subject_ref, input.subject_key));
  if (input.tenant_id) add(nodeId("tenant", input.tenant_id));
  if (input.user_id) add(nodeId("user", input.user_id));
  if (input.device_id) add(nodeId("device", input.device_id));
  if (input.asset_id) add(nodeId("json_asset", input.asset_id));
  if (input.intent_key) add(nodeId("intent", input.intent_key));
  if (input.route_id || input.task_key) add(nodeId("task_route", input.route_id || input.task_key));
  if (input.workflow_key || input.workflow_id) add(nodeId("workflow", input.workflow_key || input.workflow_id));
  if (input.action_key) add(nodeId("action", input.action_key));
  if (input.endpoint_key) add(nodeId("endpoint", input.endpoint_key));
  if (input.business_type_key) add(nodeId("business_type", input.business_type_key));
  if (input.knowledge_profile_key) add(nodeId("knowledge_profile", input.knowledge_profile_key));
  return ids;
}

export async function getGraphNeighborhood({ nodeIds = [], depth = 1, limit = 200 } = {}) {
  const pool = getPool();
  await ensurePlatformGraphTables();
  const maxDepth = Math.max(0, Math.min(Number(depth) || 1, 3));
  const maxLimit = Math.max(1, Math.min(Number(limit) || 200, 500));
  const seen = new Set(nodeIds.filter(Boolean));
  let frontier = [...seen];
  const edges = [];

  for (let level = 0; level < maxDepth && frontier.length && edges.length < maxLimit; level += 1) {
    const [rows] = await pool.query(
      `SELECT * FROM platform_graph_edges
        WHERE lifecycle_status='active'
          AND (source_node_id IN (?) OR target_node_id IN (?))
        LIMIT ?`,
      [frontier, frontier, maxLimit - edges.length]
    );
    frontier = [];
    for (const row of rows) {
      edges.push(row);
      for (const id of [row.source_node_id, row.target_node_id]) {
        if (!seen.has(id)) {
          seen.add(id);
          frontier.push(id);
        }
      }
    }
  }

  const ids = [...seen];
  const [nodes] = ids.length
    ? await pool.query(`SELECT * FROM platform_graph_nodes WHERE node_id IN (?)`, [ids])
    : [[]];
  return { nodes, edges, start_node_ids: nodeIds, depth: maxDepth };
}

export async function resolvePlatformGraphContext(input = {}) {
  const startNodeIds = guessNodeIds(input);
  if (!startNodeIds.length) {
    return { requested: false, resolved: false, start_node_ids: [], nodes: [], edges: [], reason: "no_graph_subject_declared" };
  }
  const graph = await getGraphNeighborhood({ nodeIds: startNodeIds, depth: input.depth || 2, limit: input.limit || 200 });
  const runtimeEnforcedEdges = graph.edges.filter((edge) => Number(edge.runtime_enforced || 0) === 1).length;
  const advisoryEdges = graph.edges.length - runtimeEnforcedEdges;
  const authorityNodes = graph.nodes.filter((node) => node.runtime_role === "authority").length;
  return {
    requested: true,
    resolved: graph.nodes.length > 0,
    start_node_ids: startNodeIds,
    node_count: graph.nodes.length,
    edge_count: graph.edges.length,
    authority_summary: {
      authority_nodes: authorityNodes,
      runtime_enforced_edges: runtimeEnforcedEdges,
      advisory_edges: advisoryEdges,
    },
    validation_state: graph.nodes.length ? "ready" : "not_found",
    nodes: graph.nodes,
    edges: graph.edges,
  };
}

export async function logGraphQuery({ queryType = "resolve", input = {}, result = {} } = {}) {
  try {
    const pool = getPool();
    await pool.query(
      `INSERT INTO platform_graph_query_log (query_id, query_type, subject_type, subject_ref, input_json, result_summary_json)
       VALUES (?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON))`,
      [
        randomUUID(),
        queryType,
        input.subject_type || null,
        input.subject_ref || input.node_id || null,
        safeJson(input),
        safeJson({ node_count: result.node_count || result.nodes?.length || 0, edge_count: result.edge_count || result.edges?.length || 0, validation_state: result.validation_state || null }),
      ]
    );
  } catch {
    // Query logging must never block graph resolution.
  }
}
