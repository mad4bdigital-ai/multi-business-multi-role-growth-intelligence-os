import { getPool } from "../db.js";
import { resolvePlatformGraphContext } from "./platformKnowledgeGraphResolver.js";

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

function clamp(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function safeJsonParse(value, fallback = null) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function redactSecrets(value = "") {
  let text = String(value ?? "");
  for (const term of FORBIDDEN_SECRET_TERMS) {
    text = text.replace(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[redacted-secret-term]");
  }
  return text;
}

function safeText(value = "", max = 700) {
  return redactSecrets(String(value ?? "").replace(/\s+/g, " ").trim()).slice(0, max);
}

function isSensitiveKey(key = "") {
  const k = lower(key);
  return ["secret", "token", "password", "credential", "private_key", "api_key", "hash"].some((part) => k.includes(part));
}

function summarizeJson(value, depth = 0) {
  if (value == null) return null;
  if (depth > 2) return "[nested]";
  if (typeof value === "string") return safeText(value, depth === 0 ? 900 : 350);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 8).map((item) => summarizeJson(item, depth + 1));
  }
  if (typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 16)) {
      if (isSensitiveKey(key)) {
        out[key] = "[redacted]";
      } else {
        out[key] = summarizeJson(item, depth + 1);
      }
    }
    return out;
  }
  return safeText(String(value));
}

function assetScore(row = {}) {
  const target = String(row.target_node_id || "");
  const type = lower(row.asset_type);
  let score = 0;
  if (target.startsWith("user.")) score += 100;
  else if (target.startsWith("device.")) score += 95;
  else if (target.startsWith("tenant.")) score += 90;
  else if (target.startsWith("brand.")) score += 80;
  else if (target.startsWith("workflow.")) score += 75;
  else if (target.startsWith("module.")) score += 70;
  else if (target.startsWith("platform.")) score += 45;
  if (type.includes("doctrine")) score += 20;
  if (type.includes("memory")) score += 18;
  if (type.includes("knowledge")) score += 12;
  if (row.validation_status === "validated") score += 8;
  if (Number(row.runtime_enforced || 0) === 1) score += 5;
  return score;
}

function collectSubjectNodes(graphContext = {}, input = {}) {
  const nodes = new Set(["platform.global"]);
  for (const id of graphContext.start_node_ids || []) nodes.add(id);
  for (const node of graphContext.nodes || []) {
    const id = node?.node_id;
    if (!id) continue;
    if (/^(platform|tenant|user|device|brand|workflow|module|business_type|knowledge_profile)\./.test(id)) nodes.add(id);
  }
  if (input.node_id) nodes.add(String(input.node_id));
  return [...nodes];
}

function sanitizeAsset(row = {}) {
  const parsedPayload = safeJsonParse(row.json_payload, null);
  return {
    asset_id: row.asset_id,
    asset_key: row.asset_key,
    asset_type: row.asset_type,
    brand_name: row.brand_name,
    source_mode: row.source_mode,
    validation_status: row.validation_status,
    transport_status: row.transport_status,
    active_status: row.active_status,
    target_node_id: row.target_node_id,
    edge_id: row.edge_id,
    edge_type: row.edge_type,
    runtime_enforced: Boolean(Number(row.runtime_enforced || 0)),
    relevance_score: row.relevance_score,
    notes_excerpt: safeText(row.notes || "", 450),
    payload_summary: summarizeJson(parsedPayload ?? row.json_payload),
    updated_at: row.updated_at,
  };
}

export async function resolveGraphRelevantAssets(input = {}) {
  const pool = getPool();
  const limit = clamp(input.limit, 12, 1, 50);
  const depth = clamp(input.depth, 2, 0, 3);
  const graphContext = input.graph_context || await resolvePlatformGraphContext({ ...input, depth, limit: 200 });
  const subjectNodeIds = collectSubjectNodes(graphContext, input);
  if (!subjectNodeIds.length) {
    return {
      ok: true,
      requested: true,
      resolved: false,
      reason: "no_subject_nodes",
      graph_context_summary: {
        resolved: Boolean(graphContext.resolved),
        node_count: graphContext.node_count || 0,
        edge_count: graphContext.edge_count || 0,
      },
      subject_node_ids: [],
      assets: [],
      asset_count: 0,
      secrets_included: false,
    };
  }

  const [rows] = await pool.query(
    `SELECT DISTINCT
        e.edge_id,
        e.edge_type,
        e.target_node_id,
        e.runtime_enforced,
        ja.asset_id,
        ja.asset_key,
        ja.asset_type,
        ja.brand_name,
        ja.source_mode,
        ja.transport_status,
        ja.validation_status,
        ja.active_status,
        ja.notes,
        ja.json_payload,
        ja.updated_at
      FROM platform_graph_edges e
      JOIN platform_graph_nodes n ON n.node_id = e.source_node_id
      LEFT JOIN json_asset_subject_links l ON l.link_id = e.source_pk OR l.asset_id = n.source_pk OR l.asset_id = n.subject_ref
      JOIN json_assets ja ON ja.asset_id = COALESCE(l.asset_id, n.source_pk, n.subject_ref)
      WHERE e.edge_type = 'attached_to'
        AND e.lifecycle_status = 'active'
        AND e.target_node_id IN (?)
        AND COALESCE(ja.active_status, 'TRUE') IN ('TRUE','true','active','1')
        AND COALESCE(ja.validation_status, '') NOT IN ('rejected','invalid')
      ORDER BY e.runtime_enforced DESC, ja.updated_at DESC
      LIMIT ?`,
    [subjectNodeIds, Math.max(limit * 4, limit)]
  );

  const ranked = rows
    .map((row) => ({ ...row, relevance_score: assetScore(row) }))
    .sort((a, b) => b.relevance_score - a.relevance_score || String(b.updated_at || "").localeCompare(String(a.updated_at || "")))
    .slice(0, limit)
    .map(sanitizeAsset);

  return {
    ok: true,
    requested: true,
    resolved: ranked.length > 0,
    graph_context_summary: {
      resolved: Boolean(graphContext.resolved),
      node_count: graphContext.node_count || 0,
      edge_count: graphContext.edge_count || 0,
      authority_summary: graphContext.authority_summary || {},
    },
    subject_node_ids: subjectNodeIds,
    asset_count: ranked.length,
    assets: ranked,
    secrets_included: false,
  };
}
