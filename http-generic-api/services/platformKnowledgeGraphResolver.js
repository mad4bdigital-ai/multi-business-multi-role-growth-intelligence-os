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

function normalize(value = "") { return String(value ?? "").trim(); }
function lower(value = "") { return normalize(value).toLowerCase(); }
function bool(value) { return value === true || ["true", "1", "yes", "active", "enabled", "ready"].includes(lower(value)); }
function idPart(value = "") {
  return normalize(value)
    .replace(/^(user|tenant|device|workflow|asset|platform):/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "") || "unknown";
}
function nodeId(type, key) { return `${idPart(type)}.${idPart(key)}`.slice(0, 255); }
function edgeId(source, type, target, table = "", pk = "") {
  return `edge.${createHash("sha256").update([source, type, target, table, pk].map(normalize).join("|")).digest("hex").slice(0, 32)}`;
}
function safeJson(value) { try { return value == null ? null : JSON.stringify(value); } catch { return JSON.stringify({ serialization_error: true }); } }
function parseMaybeJson(value, fallback = null) { try { return value && typeof value === "string" ? JSON.parse(value) : value ?? fallback; } catch { return fallback; } }
function splitList(value) {
  const raw = normalize(value);
  if (!raw) return [];
  const json = parseMaybeJson(raw, null);
  if (Array.isArray(json)) return json.map(normalize).filter(Boolean);
  return raw.split(/[;,|\n]+/g).map(normalize).filter(Boolean);
}
function lifecycle(value) {
  const v = lower(value);
  if (["archived", "deprecated", "retired", "revoked", "suspended", "false", "inactive", "draft"].includes(v)) return "archived";
  return "active";
}
function sensitivity(scope) {
  if (scope === "user") return "user_private";
  if (["tenant", "device", "brand"].includes(scope)) return "tenant_private";
  return "internal";
}
function subjectNodeId(subjectType, subjectRef, subjectKey = "") {
  const type = idPart(subjectType || "platform");
  const ref = normalize(subjectRef || subjectKey || "global");
  if (type === "platform") return "platform.global";
  return nodeId(type, ref);
}
async function tableExists(pool, table) {
  const [rows] = await pool.query(`SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`, [table]);
  return Number(rows?.[0]?.c || 0) > 0;
}
async function rowsIfExists(pool, table, sql, params = []) {
  if (!(await tableExists(pool, table))) return [];
  const [rows] = await pool.query(sql, params);
  return Array.isArray(rows) ? rows : [];
}
function addNode(nodes, input) {
  if (!input?.node_id) return null;
  const node = {
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
    sensitivity: input.sensitivity || sensitivity(input.scope_type || "platform"),
    evidence_level: input.evidence_level || "declared",
    runtime_role: input.runtime_role || "advisory",
    source_system: input.source_system || "sql",
    metadata_json: input.metadata_json || null,
  };
  const old = nodes.get(node.node_id);
  if (!old || old.authority_status !== "authoritative") nodes.set(node.node_id, { ...old, ...node });
  return node.node_id;
}
function addEdge(edges, input) {
  if (!input?.source_node_id || !input?.target_node_id) return null;
  const edge_type = input.edge_type || "linked_to";
  const edge = {
    edge_id: input.edge_id || edgeId(input.source_node_id, edge_type, input.target_node_id, input.source_table, input.source_pk),
    source_node_id: input.source_node_id,
    edge_type,
    target_node_id: input.target_node_id,
    scope_type: input.scope_type || "platform",
    authority_status: input.authority_status || "candidate",
    lifecycle_status: input.lifecycle_status || "active",
    visibility_scope: input.visibility_scope || "platform_admin",
    sensitivity: input.sensitivity || sensitivity(input.scope_type || "platform"),
    evidence_level: input.evidence_level || "declared",
    runtime_role: input.runtime_role || "advisory",
    runtime_enforced: input.runtime_enforced ? 1 : 0,
    source_table: input.source_table || null,
    source_pk: input.source_pk || null,
    metadata_json: input.metadata_json || null,
  };
  edges.set(edge.edge_id, edge);
  return edge.edge_id;
}
async function upsertNodes(pool, nodes) {
  const rows = [...nodes.values()];
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const values = [];
    const placeholders = chunk.map((n) => {
      values.push(n.node_id, n.node_type, n.node_label, n.scope_type, n.subject_ref, n.source_table, n.source_pk, n.authority_status, n.lifecycle_status, n.visibility_scope, n.sensitivity, n.evidence_level, n.runtime_role, n.source_system, safeJson(n.metadata_json));
      return "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)";
    }).join(",");
    await pool.query(
      `INSERT INTO platform_graph_nodes (node_id,node_type,node_label,scope_type,subject_ref,source_table,source_pk,authority_status,lifecycle_status,visibility_scope,sensitivity,evidence_level,runtime_role,source_system,metadata_json)
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE node_type=VALUES(node_type), node_label=VALUES(node_label), scope_type=VALUES(scope_type), subject_ref=VALUES(subject_ref), source_table=VALUES(source_table), source_pk=VALUES(source_pk), authority_status=VALUES(authority_status), lifecycle_status=VALUES(lifecycle_status), visibility_scope=VALUES(visibility_scope), sensitivity=VALUES(sensitivity), evidence_level=VALUES(evidence_level), runtime_role=VALUES(runtime_role), source_system=VALUES(source_system), metadata_json=VALUES(metadata_json), updated_at=CURRENT_TIMESTAMP`, values);
  }
  return rows.length;
}
async function upsertEdges(pool, edges) {
  const rows = [...edges.values()];
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const values = [];
    const placeholders = chunk.map((e) => {
      values.push(e.edge_id, e.source_node_id, e.edge_type, e.target_node_id, e.scope_type, e.authority_status, e.lifecycle_status, e.visibility_scope, e.sensitivity, e.evidence_level, e.runtime_role, Number(e.runtime_enforced || 0), e.source_table, e.source_pk, safeJson(e.metadata_json));
      return "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)";
    }).join(",");
    await pool.query(
      `INSERT INTO platform_graph_edges (edge_id,source_node_id,edge_type,target_node_id,scope_type,authority_status,lifecycle_status,visibility_scope,sensitivity,evidence_level,runtime_role,runtime_enforced,source_table,source_pk,metadata_json)
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE source_node_id=VALUES(source_node_id), edge_type=VALUES(edge_type), target_node_id=VALUES(target_node_id), scope_type=VALUES(scope_type), authority_status=VALUES(authority_status), lifecycle_status=VALUES(lifecycle_status), visibility_scope=VALUES(visibility_scope), sensitivity=VALUES(sensitivity), evidence_level=VALUES(evidence_level), runtime_role=VALUES(runtime_role), runtime_enforced=VALUES(runtime_enforced), source_table=VALUES(source_table), source_pk=VALUES(source_pk), metadata_json=VALUES(metadata_json), updated_at=CURRENT_TIMESTAMP`, values);
  }
  return rows.length;
}

export async function ensurePlatformGraphTables() {
  const pool = getPool();
  await pool.query(`CREATE TABLE IF NOT EXISTS platform_graph_nodes (
    node_id VARCHAR(255) NOT NULL PRIMARY KEY, node_type VARCHAR(120) NOT NULL, node_label VARCHAR(500) NULL,
    scope_type VARCHAR(80) NOT NULL DEFAULT 'platform', subject_ref VARCHAR(255) NULL, source_table VARCHAR(120) NULL, source_pk VARCHAR(255) NULL,
    authority_status VARCHAR(80) NOT NULL DEFAULT 'candidate', lifecycle_status VARCHAR(80) NOT NULL DEFAULT 'active', visibility_scope VARCHAR(120) NOT NULL DEFAULT 'platform_admin',
    sensitivity VARCHAR(80) NOT NULL DEFAULT 'internal', evidence_level VARCHAR(80) NOT NULL DEFAULT 'declared', runtime_role VARCHAR(80) NOT NULL DEFAULT 'advisory',
    source_system VARCHAR(80) NOT NULL DEFAULT 'sql', metadata_json JSON NULL, created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_platform_graph_nodes_type (node_type,lifecycle_status), KEY idx_platform_graph_nodes_scope (scope_type,subject_ref), KEY idx_platform_graph_nodes_source (source_table,source_pk)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await pool.query(`CREATE TABLE IF NOT EXISTS platform_graph_edges (
    edge_id VARCHAR(255) NOT NULL PRIMARY KEY, source_node_id VARCHAR(255) NOT NULL, edge_type VARCHAR(120) NOT NULL, target_node_id VARCHAR(255) NOT NULL,
    scope_type VARCHAR(80) NOT NULL DEFAULT 'platform', authority_status VARCHAR(80) NOT NULL DEFAULT 'candidate', lifecycle_status VARCHAR(80) NOT NULL DEFAULT 'active', visibility_scope VARCHAR(120) NOT NULL DEFAULT 'platform_admin',
    sensitivity VARCHAR(80) NOT NULL DEFAULT 'internal', evidence_level VARCHAR(80) NOT NULL DEFAULT 'declared', runtime_role VARCHAR(80) NOT NULL DEFAULT 'advisory', runtime_enforced TINYINT(1) NOT NULL DEFAULT 0,
    source_table VARCHAR(120) NULL, source_pk VARCHAR(255) NULL, metadata_json JSON NULL, created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_platform_graph_edges_source (source_node_id,edge_type,lifecycle_status), KEY idx_platform_graph_edges_target (target_node_id,edge_type,lifecycle_status), KEY idx_platform_graph_edges_type (edge_type,runtime_enforced,lifecycle_status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await pool.query(`CREATE TABLE IF NOT EXISTS platform_graph_projection_runs (run_id VARCHAR(64) NOT NULL PRIMARY KEY, projection_key VARCHAR(160) NOT NULL, projection_mode VARCHAR(80) NOT NULL DEFAULT 'advisory_projection', status ENUM('running','completed','failed') NOT NULL DEFAULT 'running', source_counts_json JSON NULL, result_counts_json JSON NULL, warnings_json JSON NULL, error_json JSON NULL, started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at DATETIME NULL, created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await pool.query(`CREATE TABLE IF NOT EXISTS platform_graph_validation_runs (run_id VARCHAR(64) NOT NULL PRIMARY KEY, validation_key VARCHAR(160) NOT NULL, status ENUM('running','passed','failed','warning') NOT NULL DEFAULT 'running', checked_nodes INT NOT NULL DEFAULT 0, checked_edges INT NOT NULL DEFAULT 0, failure_count INT NOT NULL DEFAULT 0, warning_count INT NOT NULL DEFAULT 0, results_json JSON NULL, started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at DATETIME NULL, created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

export async function projectPlatformKnowledgeGraph({ projectionKey = "runtime_projection", dryRun = false } = {}) {
  const pool = getPool();
  await ensurePlatformGraphTables();
  const runId = randomUUID();
  await pool.query(`INSERT INTO platform_graph_projection_runs (run_id, projection_key, projection_mode, status) VALUES (?, ?, 'advisory_projection', 'running')`, [runId, projectionKey]);
  const nodes = new Map();
  const edges = new Map();
  const sourceCounts = {};
  const warnings = [];

  try {
    addNode(nodes, { node_id: "platform.global", node_type: "platform", node_label: "Platform Global", scope_type: "platform", subject_ref: "platform:global", authority_status: "authoritative", runtime_role: "authority" });

    const tenants = await rowsIfExists(pool, "tenants", `SELECT tenant_id, tenant_type, display_name, status FROM tenants`);
    sourceCounts.tenants = tenants.length;
    for (const r of tenants) {
      const n = addNode(nodes, { node_id: nodeId("tenant", r.tenant_id), node_type: "tenant", node_label: r.display_name || r.tenant_id, scope_type: "tenant", subject_ref: r.tenant_id, source_table: "tenants", source_pk: r.tenant_id, authority_status: "authoritative", lifecycle_status: lifecycle(r.status), runtime_role: "authority", metadata_json: { tenant_type: r.tenant_type, status: r.status } });
      addEdge(edges, { source_node_id: "platform.global", edge_type: "owns", target_node_id: n, source_table: "tenants", source_pk: r.tenant_id, authority_status: "authoritative", runtime_role: "authority" });
    }

    const users = await rowsIfExists(pool, "users", `SELECT user_id, email, display_name, status FROM users`);
    sourceCounts.users = users.length;
    for (const r of users) addNode(nodes, { node_id: nodeId("user", r.user_id), node_type: "user", node_label: r.email || r.display_name || r.user_id, scope_type: "user", subject_ref: r.user_id, source_table: "users", source_pk: r.user_id, authority_status: "authoritative", lifecycle_status: lifecycle(r.status), runtime_role: "authority", sensitivity: "user_private", metadata_json: { email: r.email, status: r.status } });

    const memberships = await rowsIfExists(pool, "memberships", `SELECT id, user_id, tenant_id, role, status FROM memberships`);
    sourceCounts.memberships = memberships.length;
    for (const r of memberships) {
      const u = nodeId("user", r.user_id); const t = nodeId("tenant", r.tenant_id);
      addNode(nodes, { node_id: u, node_type: "user", node_label: r.user_id, scope_type: "user", subject_ref: r.user_id, source_table: "memberships", source_pk: r.user_id, sensitivity: "user_private" });
      addNode(nodes, { node_id: t, node_type: "tenant", node_label: r.tenant_id, scope_type: "tenant", subject_ref: r.tenant_id, source_table: "memberships", source_pk: r.tenant_id });
      addEdge(edges, { source_node_id: u, edge_type: "member_of", target_node_id: t, scope_type: "tenant", source_table: "memberships", source_pk: String(r.id), authority_status: "authoritative", runtime_role: "authority", runtime_enforced: true, metadata_json: { role: r.role, status: r.status } });
    }

    const assets = await rowsIfExists(pool, "json_assets", `SELECT asset_id, asset_key, asset_type, brand_name, active_status, validation_status, source_mode FROM json_assets`);
    sourceCounts.json_assets = assets.length;
    for (const r of assets) addNode(nodes, { node_id: nodeId("json_asset", r.asset_id), node_type: "json_asset", node_label: r.asset_key || r.asset_id, scope_type: "platform", subject_ref: r.asset_id, source_table: "json_assets", source_pk: r.asset_id, authority_status: r.validation_status === "validated" ? "authoritative" : "candidate", lifecycle_status: lifecycle(r.active_status), runtime_role: /doctrine|memory|knowledge/i.test(String(r.asset_type || "")) ? "resolver_input" : "advisory", metadata_json: { asset_key: r.asset_key, asset_type: r.asset_type, brand_name: r.brand_name, validation_status: r.validation_status, source_mode: r.source_mode } });

    const links = await rowsIfExists(pool, "json_asset_subject_links", `SELECT link_id, asset_id, asset_key, subject_type, subject_ref, tenant_id, user_id, subject_key, linkage_type, scope_label, status FROM json_asset_subject_links WHERE status='active'`);
    sourceCounts.json_asset_subject_links = links.length;
    for (const r of links) {
      const asset = nodeId("json_asset", r.asset_id); const target = subjectNodeId(r.subject_type, r.subject_ref, r.subject_key);
      addNode(nodes, { node_id: asset, node_type: "json_asset", node_label: r.asset_key || r.asset_id, scope_type: r.subject_type === "platform" ? "platform" : r.subject_type, source_table: "json_asset_subject_links", source_pk: r.link_id, authority_status: "authoritative" });
      addNode(nodes, { node_id: target, node_type: r.subject_type || "platform", node_label: r.subject_key || r.subject_ref, scope_type: r.subject_type || "platform", subject_ref: r.subject_ref, source_table: "json_asset_subject_links", source_pk: r.link_id, sensitivity: sensitivity(r.subject_type) });
      addEdge(edges, { source_node_id: asset, edge_type: "attached_to", target_node_id: target, scope_type: r.subject_type || "platform", source_table: "json_asset_subject_links", source_pk: r.link_id, authority_status: "authoritative", runtime_role: "resolver_input", runtime_enforced: true, metadata_json: { linkage_type: r.linkage_type, scope_label: r.scope_label, tenant_id: r.tenant_id, user_id: r.user_id } });
    }

    const devices = await rowsIfExists(pool, "local_manager_device_link_sessions", `SELECT session_id, status, device_id, hostname, platform, app_version, user_id, tenant_id FROM local_manager_device_link_sessions`);
    sourceCounts.local_manager_device_link_sessions = devices.length;
    for (const r of devices) {
      const session = nodeId("app_session", r.session_id); const device = nodeId("device", r.device_id || r.hostname || r.session_id);
      addNode(nodes, { node_id: session, node_type: "app_session", node_label: r.session_id, scope_type: "device", source_table: "local_manager_device_link_sessions", source_pk: r.session_id, lifecycle_status: lifecycle(r.status), authority_status: "authoritative", sensitivity: "tenant_private", metadata_json: { status: r.status, app_version: r.app_version } });
      addNode(nodes, { node_id: device, node_type: "device", node_label: r.hostname || r.device_id, scope_type: "device", subject_ref: r.device_id, source_table: "local_manager_device_link_sessions", source_pk: r.session_id, lifecycle_status: lifecycle(r.status), authority_status: "authoritative", runtime_role: "resolver_input", sensitivity: "tenant_private", metadata_json: { hostname: r.hostname, platform: r.platform, app_version: r.app_version, status: r.status } });
      addEdge(edges, { source_node_id: session, edge_type: "linked_to", target_node_id: device, scope_type: "device", source_table: "local_manager_device_link_sessions", source_pk: r.session_id, authority_status: "authoritative", runtime_role: "resolver_input", runtime_enforced: true, metadata_json: { status: r.status } });
      if (r.user_id) { const u = nodeId("user", r.user_id); addNode(nodes, { node_id: u, node_type: "user", node_label: r.user_id, scope_type: "user", subject_ref: r.user_id, authority_status: "candidate", sensitivity: "user_private" }); addEdge(edges, { source_node_id: device, edge_type: "linked_to", target_node_id: u, scope_type: "user", source_table: "local_manager_device_link_sessions", source_pk: r.session_id, authority_status: "authoritative", runtime_role: "resolver_input", runtime_enforced: true }); }
      if (r.tenant_id) { const t = nodeId("tenant", r.tenant_id); addNode(nodes, { node_id: t, node_type: "tenant", node_label: r.tenant_id, scope_type: "tenant", subject_ref: r.tenant_id, authority_status: "candidate" }); addEdge(edges, { source_node_id: device, edge_type: "linked_to", target_node_id: t, scope_type: "tenant", source_table: "local_manager_device_link_sessions", source_pk: r.session_id, authority_status: "authoritative", runtime_role: "resolver_input", runtime_enforced: true }); }
    }

    const releases = await rowsIfExists(pool, "local_app_releases", `SELECT release_id, app_key, platform, release_channel, version, status FROM local_app_releases`);
    sourceCounts.local_app_releases = releases.length;
    for (const r of releases) {
      const app = nodeId("local_app", r.app_key); const rel = nodeId("release", r.release_id);
      addNode(nodes, { node_id: app, node_type: "local_app", node_label: r.app_key, source_table: "local_app_releases", source_pk: r.app_key, authority_status: "authoritative", runtime_role: "resolver_input" });
      addNode(nodes, { node_id: rel, node_type: "release", node_label: `${r.app_key} ${r.version}`, source_table: "local_app_releases", source_pk: r.release_id, lifecycle_status: lifecycle(r.status), authority_status: "authoritative", runtime_role: "resolver_input", metadata_json: { version: r.version, channel: r.release_channel, platform: r.platform } });
      addEdge(edges, { source_node_id: app, edge_type: "released_as", target_node_id: rel, source_table: "local_app_releases", source_pk: r.release_id, authority_status: "authoritative", runtime_role: "resolver_input" });
    }

    const actions = await rowsIfExists(pool, "actions", `SELECT action_key, action_id, action_title, status, module_binding, connector_family, runtime_callable, runtime_capability_class FROM actions`);
    sourceCounts.actions = actions.length;
    for (const r of actions) { const key = r.action_key || r.action_id; if (key) addNode(nodes, { node_id: nodeId("action", key), node_type: "action", node_label: r.action_title || key, source_table: "actions", source_pk: key, authority_status: "authoritative", lifecycle_status: lifecycle(r.status), runtime_role: bool(r.runtime_callable) ? "authority" : "advisory", metadata_json: { module_binding: r.module_binding, connector_family: r.connector_family, runtime_capability_class: r.runtime_capability_class } }); }

    const endpoints = await rowsIfExists(pool, "endpoints", `SELECT endpoint_key, endpoint_id, parent_action_key, endpoint_operation, method, provider_domain, status, execution_readiness, endpoint_role, execution_mode, transport_required FROM endpoints`);
    sourceCounts.endpoints = endpoints.length;
    for (const r of endpoints) {
      const key = r.endpoint_key || r.endpoint_id; if (!key) continue;
      const ep = nodeId("endpoint", key);
      addNode(nodes, { node_id: ep, node_type: "endpoint", node_label: r.endpoint_operation || key, subject_ref: key, source_table: "endpoints", source_pk: key, authority_status: "authoritative", lifecycle_status: lifecycle(r.status), runtime_role: r.execution_readiness === "ready" ? "authority" : "advisory", metadata_json: { method: r.method, provider_domain: r.provider_domain, endpoint_role: r.endpoint_role, execution_mode: r.execution_mode, transport_required: r.transport_required } });
      if (r.parent_action_key) {
        const action = nodeId("action", r.parent_action_key); addNode(nodes, { node_id: action, node_type: "action", node_label: r.parent_action_key, source_table: "endpoints", source_pk: r.parent_action_key });
        addEdge(edges, { source_node_id: action, edge_type: "exposes", target_node_id: ep, source_table: "endpoints", source_pk: key, authority_status: "authoritative", runtime_role: "authority", runtime_enforced: true, metadata_json: { method: r.method, operation: r.endpoint_operation } });
      }
    }

    const routes = await rowsIfExists(pool, "task_routes", `SELECT id, task_key, route_id, intent_key, workflow_key, target_module, active, enabled, route_mode, review_required FROM task_routes`);
    sourceCounts.task_routes = routes.length;
    for (const r of routes) {
      const key = r.route_id || r.task_key || r.id; const route = nodeId("task_route", key);
      addNode(nodes, { node_id: route, node_type: "task_route", node_label: r.task_key || key, subject_ref: key, source_table: "task_routes", source_pk: String(r.id), authority_status: "authoritative", lifecycle_status: lifecycle(r.active || r.enabled), runtime_role: "authority", metadata_json: { route_mode: r.route_mode, review_required: r.review_required } });
      if (r.intent_key) { const intent = nodeId("intent", r.intent_key); addNode(nodes, { node_id: intent, node_type: "intent", node_label: r.intent_key, source_table: "task_routes", source_pk: String(r.id), authority_status: "authoritative", runtime_role: "authority" }); addEdge(edges, { source_node_id: intent, edge_type: "routes_to", target_node_id: route, source_table: "task_routes", source_pk: String(r.id), authority_status: "authoritative", runtime_role: "authority", runtime_enforced: true }); }
      if (r.workflow_key) { const wf = nodeId("workflow", r.workflow_key); addNode(nodes, { node_id: wf, node_type: "workflow", node_label: r.workflow_key, scope_type: "workflow", source_table: "task_routes", source_pk: String(r.id), runtime_role: "authority" }); addEdge(edges, { source_node_id: route, edge_type: "triggers", target_node_id: wf, scope_type: "workflow", source_table: "task_routes", source_pk: String(r.id), authority_status: "authoritative", runtime_role: "authority", runtime_enforced: true }); }
      if (r.target_module) { const mod = nodeId("module", r.target_module); addNode(nodes, { node_id: mod, node_type: "module", node_label: r.target_module, scope_type: "module", source_table: "task_routes", source_pk: String(r.id) }); addEdge(edges, { source_node_id: route, edge_type: "uses", target_node_id: mod, scope_type: "module", source_table: "task_routes", source_pk: String(r.id), authority_status: "authoritative", runtime_role: "authority" }); }
    }

    const workflows = await rowsIfExists(pool, "workflows", `SELECT id, workflow_key, workflow_id, workflow_name, status, active, target_module, execution_class, execution_mode FROM workflows`);
    sourceCounts.workflows = workflows.length;
    for (const r of workflows) { const key = r.workflow_key || r.workflow_id; if (!key) continue; const wf = nodeId("workflow", key); addNode(nodes, { node_id: wf, node_type: "workflow", node_label: r.workflow_name || key, scope_type: "workflow", subject_ref: key, source_table: "workflows", source_pk: key, authority_status: "authoritative", lifecycle_status: lifecycle(r.active || r.status), runtime_role: "authority", metadata_json: { execution_class: r.execution_class, execution_mode: r.execution_mode } }); if (r.target_module) { const mod = nodeId("module", r.target_module); addNode(nodes, { node_id: mod, node_type: "module", node_label: r.target_module, scope_type: "module", source_table: "workflows", source_pk: key }); addEdge(edges, { source_node_id: wf, edge_type: "uses", target_node_id: mod, source_table: "workflows", source_pk: key, authority_status: "authoritative", runtime_role: "authority" }); } }

    const profiles = await rowsIfExists(pool, "business_type_profiles", `SELECT id, business_type_key, knowledge_profile_key, compatible_route_keys, compatible_workflows, profile_status, active FROM business_type_profiles`);
    sourceCounts.business_type_profiles = profiles.length;
    for (const r of profiles) { if (!r.business_type_key) continue; const bt = nodeId("business_type", r.business_type_key); addNode(nodes, { node_id: bt, node_type: "business_type", node_label: r.business_type_key, source_table: "business_type_profiles", source_pk: String(r.id), authority_status: "authoritative", lifecycle_status: lifecycle(r.active || r.profile_status), runtime_role: "resolver_input" }); if (r.knowledge_profile_key) { const kp = nodeId("knowledge_profile", r.knowledge_profile_key); addNode(nodes, { node_id: kp, node_type: "knowledge_profile", node_label: r.knowledge_profile_key, source_table: "business_type_profiles", source_pk: String(r.id), authority_status: "authoritative", runtime_role: "resolver_input" }); addEdge(edges, { source_node_id: bt, edge_type: "activates", target_node_id: kp, source_table: "business_type_profiles", source_pk: String(r.id), authority_status: "authoritative", runtime_role: "resolver_input", runtime_enforced: true }); } for (const routeKey of splitList(r.compatible_route_keys)) { const routeNode = nodeId("task_route", routeKey); addNode(nodes, { node_id: routeNode, node_type: "task_route", node_label: routeKey, source_table: "business_type_profiles", source_pk: String(r.id), authority_status: "candidate" }); addEdge(edges, { source_node_id: bt, edge_type: "uses", target_node_id: routeNode, source_table: "business_type_profiles", source_pk: String(r.id), authority_status: "advisory" }); } for (const wf of splitList(r.compatible_workflows)) { const wfNode = nodeId("workflow", wf); addNode(nodes, { node_id: wfNode, node_type: "workflow", node_label: wf, scope_type: "workflow", source_table: "business_type_profiles", source_pk: String(r.id), authority_status: "candidate" }); addEdge(edges, { source_node_id: bt, edge_type: "uses", target_node_id: wfNode, source_table: "business_type_profiles", source_pk: String(r.id), authority_status: "advisory" }); } }

    const surfaces = await rowsIfExists(pool, "platform_contract_surfaces", `SELECT surface_id, surface_name, surface_type, surface_scope, business_type_scope, active_status, authority_status, runtime_consumption_status, current_runtime_adapter FROM platform_contract_surfaces`);
    sourceCounts.platform_contract_surfaces = surfaces.length;
    for (const r of surfaces) { const s = nodeId("knowledge_surface", r.surface_id); addNode(nodes, { node_id: s, node_type: "knowledge_surface", node_label: r.surface_name || r.surface_id, scope_type: r.surface_scope || "platform", subject_ref: r.surface_id, source_table: "platform_contract_surfaces", source_pk: r.surface_id, authority_status: r.authority_status || "candidate", lifecycle_status: lifecycle(r.active_status), runtime_role: r.runtime_consumption_status === "knowledge_candidate_runtime_enforced" ? "resolver_input" : "advisory", metadata_json: { surface_type: r.surface_type, runtime_adapter: r.current_runtime_adapter, runtime_consumption_status: r.runtime_consumption_status } }); const scopes = splitList(r.business_type_scope); if (!scopes.length) addEdge(edges, { source_node_id: "platform.global", edge_type: "uses", target_node_id: s, source_table: "platform_contract_surfaces", source_pk: r.surface_id, authority_status: "advisory", runtime_role: "resolver_input" }); for (const scope of scopes) { const bt = nodeId("business_type", scope); addNode(nodes, { node_id: bt, node_type: "business_type", node_label: scope, runtime_role: "resolver_input" }); addEdge(edges, { source_node_id: bt, edge_type: "activates", target_node_id: s, source_table: "platform_contract_surfaces", source_pk: r.surface_id, authority_status: "authoritative", runtime_role: "resolver_input", runtime_enforced: r.runtime_consumption_status === "knowledge_candidate_runtime_enforced" }); } }

    const contractNodes = await rowsIfExists(pool, "platform_contract_nodes", `SELECT node_id, node_name, node_type, node_scope, active, authority_status, runtime_consumption_status, promotion_status FROM platform_contract_nodes`);
    sourceCounts.platform_contract_nodes = contractNodes.length;
    for (const r of contractNodes) addNode(nodes, { node_id: idPart(r.node_id).includes(".") ? idPart(r.node_id) : nodeId(r.node_type || "contract", r.node_id), node_type: r.node_type || "contract", node_label: r.node_name || r.node_id, scope_type: r.node_scope || "platform", subject_ref: r.node_id, source_table: "platform_contract_nodes", source_pk: r.node_id, authority_status: r.authority_status || "candidate", lifecycle_status: lifecycle(r.active), runtime_role: r.runtime_consumption_status === "runtime_enforced" ? "authority" : "advisory", metadata_json: { promotion_status: r.promotion_status, runtime_consumption_status: r.runtime_consumption_status } });

    const contractEdges = await rowsIfExists(pool, "platform_contract_relationships", `SELECT relationship_id, source_node_id, relationship_type, target_node_id, is_active, authority_level, relationship_domain, runtime_enforced, enforcement_relevance, promotion_status FROM platform_contract_relationships`);
    sourceCounts.platform_contract_relationships = contractEdges.length;
    for (const r of contractEdges) { const src = idPart(r.source_node_id).includes(".") ? idPart(r.source_node_id) : nodeId("contract", r.source_node_id); const dst = idPart(r.target_node_id).includes(".") ? idPart(r.target_node_id) : nodeId("contract", r.target_node_id); if (!nodes.has(src)) addNode(nodes, { node_id: src, node_type: src.split(".")[0] || "contract", node_label: r.source_node_id, authority_status: "candidate" }); if (!nodes.has(dst)) addNode(nodes, { node_id: dst, node_type: dst.split(".")[0] || "contract", node_label: r.target_node_id, authority_status: "candidate" }); addEdge(edges, { source_node_id: src, edge_type: r.relationship_type || "maps_to", target_node_id: dst, scope_type: r.relationship_domain || "platform", source_table: "platform_contract_relationships", source_pk: r.relationship_id, authority_status: r.authority_level || "advisory", lifecycle_status: lifecycle(r.is_active), runtime_role: bool(r.runtime_enforced) ? "authority" : "advisory", runtime_enforced: bool(r.runtime_enforced), metadata_json: { enforcement_relevance: r.enforcement_relevance, promotion_status: r.promotion_status } }); }

    const logs = await rowsIfExists(pool, "execution_log", `SELECT id, entry_type, execution_class, execution_status, artifact_json_asset_id, target_module_writeback, target_workflow_writeback, execution_trace_id_writeback FROM execution_log WHERE id >= (SELECT GREATEST(0, MAX(id) - 500) FROM execution_log)`);
    sourceCounts.execution_log_tail = logs.length;
    for (const r of logs) { const traceKey = r.execution_trace_id_writeback || `execution_log_${r.id}`; const tr = nodeId("execution_trace", traceKey); addNode(nodes, { node_id: tr, node_type: "execution_trace", node_label: traceKey, subject_ref: traceKey, source_table: "execution_log", source_pk: String(r.id), authority_status: "authoritative", lifecycle_status: lifecycle(r.execution_status), runtime_role: "audit_only", metadata_json: { entry_type: r.entry_type, execution_class: r.execution_class, execution_status: r.execution_status } }); if (r.artifact_json_asset_id) addEdge(edges, { source_node_id: tr, edge_type: "produced", target_node_id: nodeId("json_asset", r.artifact_json_asset_id), source_table: "execution_log", source_pk: String(r.id), authority_status: "authoritative", runtime_role: "audit_only" }); if (r.target_workflow_writeback) addEdge(edges, { source_node_id: tr, edge_type: "uses", target_node_id: nodeId("workflow", r.target_workflow_writeback), source_table: "execution_log", source_pk: String(r.id), authority_status: "advisory", runtime_role: "audit_only" }); if (r.target_module_writeback) addEdge(edges, { source_node_id: tr, edge_type: "uses", target_node_id: nodeId("module", r.target_module_writeback), source_table: "execution_log", source_pk: String(r.id), authority_status: "advisory", runtime_role: "audit_only" }); }

    if (!dryRun) { await upsertNodes(pool, nodes); await upsertEdges(pool, edges); }
    const resultCounts = { nodes: nodes.size, edges: edges.size, dry_run: Boolean(dryRun) };
    await pool.query(`UPDATE platform_graph_projection_runs SET status='completed', source_counts_json=?, result_counts_json=?, warnings_json=?, completed_at=NOW() WHERE run_id=?`, [safeJson(sourceCounts), safeJson(resultCounts), safeJson(warnings), runId]);
    return { ok: true, run_id: runId, source_counts: sourceCounts, result_counts: resultCounts, warnings };
  } catch (error) {
    await pool.query(`UPDATE platform_graph_projection_runs SET status='failed', error_json=?, completed_at=NOW() WHERE run_id=?`, [safeJson({ code: error.code || "projection_failed", message: error.message }), runId]);
    throw error;
  }
}

export async function validatePlatformKnowledgeGraph() {
  const pool = getPool();
  await ensurePlatformGraphTables();
  const runId = randomUUID();
  await pool.query(`INSERT INTO platform_graph_validation_runs (run_id, validation_key, status) VALUES (?, 'platform_graph_integrity', 'running')`, [runId]);
  const [[nodeCounts], [edgeCounts], [missingSource], [missingTarget], [secretRows], [runtimeWeakRows]] = await Promise.all([
    pool.query(`SELECT COUNT(*) AS c FROM platform_graph_nodes WHERE lifecycle_status='active'`),
    pool.query(`SELECT COUNT(*) AS c FROM platform_graph_edges WHERE lifecycle_status='active'`),
    pool.query(`SELECT e.edge_id, e.source_node_id FROM platform_graph_edges e LEFT JOIN platform_graph_nodes n ON n.node_id=e.source_node_id WHERE n.node_id IS NULL LIMIT 50`),
    pool.query(`SELECT e.edge_id, e.target_node_id FROM platform_graph_edges e LEFT JOIN platform_graph_nodes n ON n.node_id=e.target_node_id WHERE n.node_id IS NULL LIMIT 50`),
    pool.query(`SELECT 'node' AS kind, node_id AS id FROM platform_graph_nodes WHERE ${FORBIDDEN_SECRET_TERMS.map(() => "metadata_json LIKE ?").join(" OR ")} UNION ALL SELECT 'edge' AS kind, edge_id AS id FROM platform_graph_edges WHERE ${FORBIDDEN_SECRET_TERMS.map(() => "metadata_json LIKE ?").join(" OR ")} LIMIT 50`, [...FORBIDDEN_SECRET_TERMS.map((term) => `%${term}%`), ...FORBIDDEN_SECRET_TERMS.map((term) => `%${term}%`)]),
    pool.query(`SELECT e.edge_id, e.source_node_id, e.target_node_id FROM platform_graph_edges e LEFT JOIN platform_graph_nodes s ON s.node_id=e.source_node_id LEFT JOIN platform_graph_nodes t ON t.node_id=e.target_node_id WHERE e.runtime_enforced=1 AND (COALESCE(s.lifecycle_status,'') <> 'active' OR COALESCE(t.lifecycle_status,'') <> 'active') LIMIT 50`),
  ]);
  const failures = [];
  const warnings = [];
  if (missingSource.length) failures.push({ code: "missing_source_nodes", rows: missingSource });
  if (missingTarget.length) failures.push({ code: "missing_target_nodes", rows: missingTarget });
  if (secretRows.length) failures.push({ code: "forbidden_secret_terms_in_graph_metadata", rows: secretRows });
  if (runtimeWeakRows.length) warnings.push({ code: "runtime_enforced_edges_with_inactive_nodes", rows: runtimeWeakRows });
  const status = failures.length ? "failed" : warnings.length ? "warning" : "passed";
  await pool.query(`UPDATE platform_graph_validation_runs SET status=?, checked_nodes=?, checked_edges=?, failure_count=?, warning_count=?, results_json=?, completed_at=NOW() WHERE run_id=?`, [status, Number(nodeCounts?.[0]?.c || 0), Number(edgeCounts?.[0]?.c || 0), failures.length, warnings.length, safeJson({ failures, warnings }), runId]);
  return { ok: !failures.length, status, run_id: runId, checked_nodes: Number(nodeCounts?.[0]?.c || 0), checked_edges: Number(edgeCounts?.[0]?.c || 0), failure_count: failures.length, warning_count: warnings.length, failures, warnings };
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
    const [rows] = await pool.query(`SELECT * FROM platform_graph_edges WHERE lifecycle_status='active' AND (source_node_id IN (?) OR target_node_id IN (?)) LIMIT ?`, [frontier, frontier, maxLimit - edges.length]);
    frontier = [];
    for (const row of rows) {
      edges.push(row);
      for (const id of [row.source_node_id, row.target_node_id]) if (!seen.has(id)) { seen.add(id); frontier.push(id); }
    }
  }
  const ids = [...seen];
  const [nodes] = ids.length ? await pool.query(`SELECT * FROM platform_graph_nodes WHERE node_id IN (?)`, [ids]) : [[]];
  return { nodes, edges, start_node_ids: nodeIds, depth: maxDepth };
}

export async function resolvePlatformGraphContext(input = {}) {
  const startNodeIds = guessNodeIds(input);
  if (!startNodeIds.length) return { requested: false, resolved: false, start_node_ids: [], nodes: [], edges: [], reason: "no_graph_subject_declared" };
  const graph = await getGraphNeighborhood({ nodeIds: startNodeIds, depth: input.depth || 2, limit: input.limit || 200 });
  const runtimeEnforcedEdges = graph.edges.filter((e) => Number(e.runtime_enforced || 0) === 1).length;
  return { requested: true, resolved: graph.nodes.length > 0, start_node_ids: startNodeIds, node_count: graph.nodes.length, edge_count: graph.edges.length, authority_summary: { authority_nodes: graph.nodes.filter((n) => n.runtime_role === "authority").length, runtime_enforced_edges: runtimeEnforcedEdges, advisory_edges: graph.edges.length - runtimeEnforcedEdges }, validation_state: graph.nodes.length ? "ready" : "not_found", nodes: graph.nodes, edges: graph.edges };
}

export async function logGraphQuery({ queryType = "resolve", input = {}, result = {} } = {}) {
  try {
    const pool = getPool();
    await pool.query(`INSERT INTO platform_graph_query_log (query_id, query_type, subject_type, subject_ref, input_json, result_summary_json) VALUES (?, ?, ?, ?, ?, ?)`, [randomUUID(), queryType, input.subject_type || null, input.subject_ref || input.node_id || null, safeJson(input), safeJson({ node_count: result.node_count || result.nodes?.length || 0, edge_count: result.edge_count || result.edges?.length || 0, validation_state: result.validation_state || null })]);
  } catch {}
}
