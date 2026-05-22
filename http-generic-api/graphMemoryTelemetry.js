import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";

function safeJson(value) {
  try {
    return value == null ? null : JSON.stringify(value);
  } catch {
    return JSON.stringify({ serialization_error: true });
  }
}

function normalize(value = "") {
  return String(value ?? "").trim();
}

async function ensureGraphMemoryUsageLogTable(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS graph_memory_usage_events (
    event_id VARCHAR(64) NOT NULL PRIMARY KEY,
    event_type VARCHAR(96) NOT NULL,
    surface VARCHAR(120) NOT NULL,
    usage_label VARCHAR(120) NOT NULL,
    parent_action_key VARCHAR(160) NULL,
    endpoint_key VARCHAR(160) NULL,
    tenant_id VARCHAR(64) NULL,
    user_id VARCHAR(64) NULL,
    device_id VARCHAR(160) NULL,
    requested TINYINT(1) NOT NULL DEFAULT 0,
    resolved TINYINT(1) NOT NULL DEFAULT 0,
    asset_count INT NOT NULL DEFAULT 0,
    asset_keys_json JSON NULL,
    mode_hints_json JSON NULL,
    selection_policy_json JSON NULL,
    error_json JSON NULL,
    secrets_included TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_graph_memory_usage_surface (surface, usage_label, created_at),
    KEY idx_graph_memory_usage_tenant (tenant_id, created_at),
    KEY idx_graph_memory_usage_endpoint (parent_action_key, endpoint_key, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

export async function logGraphMemoryUsage({
  eventType = "graph_memory_resolved",
  surface = "unknown",
  usage = "advisory",
  parentActionKey = null,
  endpointKey = null,
  tenantId = null,
  userId = null,
  deviceId = null,
  memory = {},
  modeHints = [],
} = {}) {
  try {
    const pool = getPool();
    await ensureGraphMemoryUsageLogTable(pool);
    const assets = Array.isArray(memory.assets) ? memory.assets : [];
    await pool.query(
      `INSERT INTO graph_memory_usage_events
        (event_id, event_type, surface, usage_label, parent_action_key, endpoint_key, tenant_id, user_id, device_id,
         requested, resolved, asset_count, asset_keys_json, mode_hints_json, selection_policy_json, error_json, secrets_included)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
      [
        randomUUID(),
        normalize(eventType || (memory.resolved ? "graph_memory_resolved" : "graph_memory_empty")),
        normalize(surface),
        normalize(usage),
        parentActionKey ? normalize(parentActionKey) : null,
        endpointKey ? normalize(endpointKey) : null,
        tenantId ? normalize(tenantId) : null,
        userId ? normalize(userId) : null,
        deviceId ? normalize(deviceId) : null,
        memory.requested ? 1 : 0,
        memory.resolved ? 1 : 0,
        Number(memory.asset_count || 0),
        safeJson(assets.map((asset) => asset?.asset_key).filter(Boolean).slice(0, 25)),
        safeJson(Array.isArray(modeHints) ? modeHints.slice(0, 25) : []),
        safeJson(memory.selection_policy || {}),
        safeJson(memory.error || null),
      ]
    );
  } catch {
    // Telemetry must never block activation or execution flows.
  }
}
