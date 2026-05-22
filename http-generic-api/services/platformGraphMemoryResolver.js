import { getPool } from "../db.js";
import {
  ensurePlatformGraphTables,
  guessNodeIds,
  resolvePlatformGraphContext,
} from "./platformKnowledgeGraphResolver.js";

const MAX_MEMORY_ASSETS = 25;
const DEFAULT_RANK_WEIGHTS = Object.freeze({
  direct_asset_match: 100,
  asset_graph_node_match: 60,
  attached_scope_match: 40,
  validated_asset: 10,
  knowledge_asset_type: 5,
});
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

function sanitizeInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function parseJson(value, fallback = null) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function unique(values = []) {
  return [...new Set(values.map(normalize).filter(Boolean))];
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactSecretTerms(value = "") {
  let text = String(value ?? "");
  for (const term of FORBIDDEN_SECRET_TERMS) {
    text = text.replace(new RegExp(escapeRegExp(term), "gi"), "[redacted-secret-term]");
  }
  return text;
}

function safeText(value = "", max = 500) {
  return redactSecretTerms(String(value ?? "").replace(/\s+/g, " ").trim()).slice(0, max);
}

async function tableExists(pool, tableName) {
  try {
    const [[row]] = await pool.query(
      "SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
      [tableName]
    );
    return Number(row?.cnt || 0) > 0;
  } catch {
    return false;
  }
}

async function loadGraphMemoryRankWeights(pool) {
  const weights = { ...DEFAULT_RANK_WEIGHTS };
  const tableAvailable = await tableExists(pool, "platform_graph_memory_rank_rules");
  if (!tableAvailable) {
    return { weights, source: "fallback_code_defaults", table_available: false };
  }

  try {
    const [rows] = await pool.query(
      `SELECT rule_key, weight
         FROM platform_graph_memory_rank_rules
        WHERE status = 'active'
          AND rule_key IN (?)`,
      [Object.keys(DEFAULT_RANK_WEIGHTS)]
    );
    for (const row of rows || []) {
      if (!Object.prototype.hasOwnProperty.call(weights, row.rule_key)) continue;
      weights[row.rule_key] = sanitizeInt(row.weight, weights[row.rule_key], 0, 1000);
    }
    return { weights, source: "db_rank_rules", table_available: true };
  } catch (err) {
    return {
      weights,
      source: "fallback_code_defaults",
      table_available: true,
      error: err?.message || "rank rule load failed",
    };
  }
}

function selectionPolicy({ limit, rankConfig }) {
  return {
    limit,
    included_payload: "summary_only",
    full_json_payload_included: false,
    raw_secret_values_included: false,
    rank_weights_source: rankConfig?.source || "fallback_code_defaults",
    rank_weights: rankConfig?.weights || DEFAULT_RANK_WEIGHTS,
  };
}

function collectGraphNodeIds({ input = {}, graphContext = {} } = {}) {
  const nodeIds = [];
  nodeIds.push(...guessNodeIds(input));
  if (Array.isArray(graphContext.start_node_ids)) nodeIds.push(...graphContext.start_node_ids);
  if (Array.isArray(graphContext.nodes)) nodeIds.push(...graphContext.nodes.map((node) => node?.node_id));
  return unique(nodeIds).slice(0, 250);
}

function summarizePayload(row = {}) {
  const payload = parseJson(row.json_payload, null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      status: row.payload_status || null,
      topic: row.payload_topic || null,
      scope: row.payload_scope || null,
      rule_count: Number(row.rule_count || 0),
      checklist_count: Number(row.checklist_count || 0),
    };
  }

  return {
    status: payload.status || row.payload_status || null,
    topic: payload.topic || row.payload_topic || null,
    scope: payload.scope || row.payload_scope || null,
    rule_count: Array.isArray(payload.generalized_rules) ? payload.generalized_rules.length : Number(row.rule_count || 0),
    checklist_count: Array.isArray(payload.regression_checklist) ? payload.regression_checklist.length : Number(row.checklist_count || 0),
    evidence: payload.evidence && typeof payload.evidence === "object"
      ? {
          deployed_commit_sha: payload.evidence.deployed_commit_sha || null,
          live_audit_failures: payload.evidence.live_audit_failures ?? null,
          main_ci_conclusion: payload.evidence.main_ci_conclusion || null,
        }
      : null,
  };
}

function mapAssetRow(row = {}) {
  return {
    asset_id: row.asset_id,
    asset_key: row.asset_key,
    asset_type: row.asset_type,
    brand_name: row.brand_name || null,
    mapping_status: row.mapping_status || null,
    validation_status: row.validation_status || null,
    active_status: row.active_status || null,
    source_mode: row.source_mode || null,
    attached_scope_count: Number(row.attached_scope_count || 0),
    graph_rank: Number(row.graph_rank || 0),
    graph_sources: parseJson(row.graph_sources_json, []),
    payload_summary: summarizePayload(row),
    notes_excerpt: safeText(row.notes_excerpt || "", 500),
    updated_at: row.updated_at || null,
  };
}

export async function resolvePlatformGraphMemory({ input = {}, graphContext = null, limit = 8 } = {}) {
  const pool = getPool();
  await ensurePlatformGraphTables();

  const maxLimit = sanitizeInt(limit ?? input.limit, 8, 1, MAX_MEMORY_ASSETS);
  const rankConfig = await loadGraphMemoryRankWeights(pool);
  let effectiveGraphContext = graphContext;
  if (!effectiveGraphContext || !effectiveGraphContext.requested) {
    effectiveGraphContext = await resolvePlatformGraphContext({
      ...input,
      depth: sanitizeInt(input.depth, 2, 0, 3),
      limit: 120,
    });
  }

  const graphNodeIds = collectGraphNodeIds({ input, graphContext: effectiveGraphContext });
  const directAssetIds = unique([
    input.asset_id,
    ...(Array.isArray(effectiveGraphContext.nodes)
      ? effectiveGraphContext.nodes
          .filter((node) => node?.node_type === "json_asset" && node?.source_pk)
          .map((node) => node.source_pk)
      : []),
  ]);

  if (!graphNodeIds.length && !directAssetIds.length) {
    return {
      requested: false,
      resolved: false,
      reason: "no_graph_subject_for_memory_lookup",
      graph_node_ids: [],
      asset_count: 0,
      assets: [],
      selection_policy: selectionPolicy({ limit: maxLimit, rankConfig }),
      secrets_included: false,
    };
  }

  const directIds = directAssetIds.length ? directAssetIds : ["__none__"];
  const nodeIds = graphNodeIds.length ? graphNodeIds : ["__none__"];
  const weights = rankConfig.weights;
  const [rows] = await pool.query(
    `SELECT
        ja.asset_id,
        ja.asset_key,
        ja.asset_type,
        ja.brand_name,
        ja.mapping_status,
        ja.validation_status,
        ja.active_status,
        ja.source_mode,
        LEFT(COALESCE(ja.notes, ''), 500) AS notes_excerpt,
        ja.updated_at,
        JSON_UNQUOTE(JSON_EXTRACT(ja.json_payload, '$.status')) AS payload_status,
        JSON_UNQUOTE(JSON_EXTRACT(ja.json_payload, '$.topic')) AS payload_topic,
        JSON_UNQUOTE(JSON_EXTRACT(ja.json_payload, '$.scope')) AS payload_scope,
        COALESCE(JSON_LENGTH(JSON_EXTRACT(ja.json_payload, '$.generalized_rules')), 0) AS rule_count,
        COALESCE(JSON_LENGTH(JSON_EXTRACT(ja.json_payload, '$.regression_checklist')), 0) AS checklist_count,
        COUNT(DISTINCT l.link_id) AS attached_scope_count,
        MAX(CASE WHEN ja.asset_id IN (?) THEN ? ELSE 0 END)
          + MAX(CASE WHEN asset_node.node_id IN (?) THEN ? ELSE 0 END)
          + MAX(CASE WHEN attached_edge.target_node_id IN (?) THEN ? ELSE 0 END)
          + CASE WHEN ja.validation_status = 'validated' THEN ? ELSE 0 END
          + CASE WHEN ja.asset_type LIKE '%doctrine%' OR ja.asset_type LIKE '%memory%' OR ja.asset_type LIKE '%knowledge%' THEN ? ELSE 0 END
          AS graph_rank,
        JSON_ARRAYAGG(DISTINCT JSON_OBJECT(
          'edge_id', attached_edge.edge_id,
          'edge_type', attached_edge.edge_type,
          'target_node_id', attached_edge.target_node_id,
          'scope_type', attached_edge.scope_type,
          'runtime_role', attached_edge.runtime_role
        )) AS graph_sources_json
      FROM json_assets ja
      LEFT JOIN platform_graph_nodes asset_node
        ON asset_node.source_table = 'json_assets'
       AND asset_node.source_pk = ja.asset_id
      LEFT JOIN platform_graph_edges attached_edge
        ON attached_edge.source_node_id = asset_node.node_id
       AND attached_edge.edge_type = 'attached_to'
       AND attached_edge.lifecycle_status = 'active'
      LEFT JOIN json_asset_subject_links l
        ON l.asset_id = ja.asset_id
       AND l.status = 'active'
      WHERE (ja.active_status IN ('TRUE','true','active','1') OR ja.active_status IS NULL)
        AND (
          ja.asset_id IN (?)
          OR asset_node.node_id IN (?)
          OR attached_edge.target_node_id IN (?)
        )
      GROUP BY ja.asset_id, ja.asset_key, ja.asset_type, ja.brand_name, ja.mapping_status, ja.validation_status, ja.active_status, ja.source_mode, ja.notes, ja.updated_at, ja.json_payload
      ORDER BY graph_rank DESC, ja.updated_at DESC
      LIMIT ?`,
    [
      directIds,
      weights.direct_asset_match,
      nodeIds,
      weights.asset_graph_node_match,
      nodeIds,
      weights.attached_scope_match,
      weights.validated_asset,
      weights.knowledge_asset_type,
      directIds,
      nodeIds,
      nodeIds,
      maxLimit,
    ]
  );

  const assets = Array.isArray(rows) ? rows.map(mapAssetRow) : [];
  return {
    requested: true,
    resolved: assets.length > 0,
    graph_node_ids: graphNodeIds,
    asset_count: assets.length,
    assets,
    selection_policy: selectionPolicy({ limit: maxLimit, rankConfig }),
    secrets_included: false,
  };
}

export async function resolveGraphRelevantAssets(input = {}) {
  return resolvePlatformGraphMemory({ input, limit: input.memory_limit || input.limit || 8 });
}
