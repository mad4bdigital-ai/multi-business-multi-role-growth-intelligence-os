import { getPool } from "./db.js";
import { readSupportTicketLifecycleOrchestrationReadiness } from "./supportTicketLifecycleOrchestrationReadback.js";

function parseJson(value, fallback = null) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function boundedInt(value, fallback = 10, min = 1, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function normalizePluginKey(value) {
  const pluginKey = String(value || "ads_provider_governance_orchestrator").trim();
  if (!pluginKey || pluginKey.length > 191 || !/^[A-Za-z0-9_.:-]+$/.test(pluginKey)) {
    const err = new Error("plugin_key must be a non-empty orchestration plugin key.");
    err.status = 400;
    err.code = "invalid_orchestration_plugin_key";
    throw err;
  }
  return pluginKey;
}

function normalizeRowJson(row = {}, jsonFields = []) {
  const out = { ...row };
  for (const field of jsonFields) {
    if (Object.prototype.hasOwnProperty.call(out, field)) {
      out[field] = parseJson(out[field], null);
    }
  }
  return out;
}

export async function readPlatformOrchestrationReadback(input = {}) {
  const pool = getPool();
  const pluginKey = normalizePluginKey(input.plugin_key || input.pluginKey);
  const includeSnapshots = input.include_snapshots !== false && input.includeSnapshots !== false;
  const includeRecommendations = input.include_recommendations !== false && input.includeRecommendations !== false;
  const limit = boundedInt(input.limit, 10, 1, 50);

  const [pluginRows] = await pool.query(
    `SELECT plugin_key, display_name, domain_key, plugin_type, owner_scope, version,
            lifecycle_stage, engine_key, policy_key, readback_tool_key,
            manifest_json, safety_contract_json, status, notes, secrets_included,
            created_at, updated_at
       FROM platform_orchestration_plugins
      WHERE plugin_key = ?
      LIMIT 1`,
    [pluginKey]
  );

  if (!pluginRows.length) {
    const err = new Error(`Orchestration plugin ${pluginKey} was not found.`);
    err.status = 404;
    err.code = "orchestration_plugin_not_found";
    err.details = { plugin_key: pluginKey, secrets_included: false };
    throw err;
  }

  const plugin = normalizeRowJson(pluginRows[0], ["manifest_json", "safety_contract_json"]);

  const [stageRows] = await pool.query(
    `SELECT stage_key, plugin_key, stage_order, display_name, stage_type,
            required_inputs_json, produced_outputs_json, required_tables_json,
            required_tools_json, required_policies_json, acceptance_criteria_json,
            safety_contract_json, status, notes, secrets_included, created_at, updated_at
       FROM platform_orchestration_stages
      WHERE plugin_key = ?
      ORDER BY stage_order ASC, stage_key ASC`,
    [pluginKey]
  );

  const [edgeRows] = await pool.query(
    `SELECT edge_key, plugin_key, from_stage_key, to_stage_key, edge_type,
            condition_json, safety_contract_json, status, notes, secrets_included,
            created_at, updated_at
       FROM platform_orchestration_edges
      WHERE plugin_key = ?
      ORDER BY edge_key ASC`,
    [pluginKey]
  );

  const stages = stageRows.map((row) => normalizeRowJson(row, [
    "required_inputs_json", "produced_outputs_json", "required_tables_json",
    "required_tools_json", "required_policies_json", "acceptance_criteria_json",
    "safety_contract_json",
  ]));
  const edges = edgeRows.map((row) => normalizeRowJson(row, ["condition_json", "safety_contract_json"]));

  let graphReadiness = null;
  try {
    const [readinessRows] = await pool.query(
      `SELECT * FROM v_platform_orchestration_graph_readiness WHERE plugin_key = ? LIMIT 1`,
      [pluginKey]
    );
    graphReadiness = readinessRows[0] || null;
  } catch {
    graphReadiness = null;
  }

  let adsGovernanceReadiness = null;
  if (pluginKey === "ads_provider_governance_orchestrator") {
    try {
      const [adsRows] = await pool.query(
        `SELECT * FROM v_platform_orchestration_ads_governance_readiness LIMIT 1`
      );
      adsGovernanceReadiness = adsRows[0] || null;
    } catch {
      adsGovernanceReadiness = null;
    }
  }

  let supportTicketLifecycleReadiness = null;
  if (pluginKey === "support_ticket_lifecycle_orchestrator") {
    try {
      supportTicketLifecycleReadiness = await readSupportTicketLifecycleOrchestrationReadiness({
        tenant_id: input.tenant_id || input.tenantId || null,
        limit,
      });
    } catch {
      supportTicketLifecycleReadiness = null;
    }
  }

  let externalDeliveryReadiness = null;
  if (pluginKey === "support_ticket_external_delivery_orchestrator") {
    try {
      const [externalRows] = await pool.query(
        `SELECT * FROM v_platform_orchestration_external_delivery_readiness LIMIT 1`
      );
      externalDeliveryReadiness = externalRows[0] || null;
    } catch {
      externalDeliveryReadiness = null;
    }
  }

  let snapshots = [];
  if (includeSnapshots) {
    const [snapshotRows] = await pool.query(
      `SELECT snapshot_id, snapshot_key, plugin_key, scope_type, scope_id, tenant_id,
              workspace_id, brand_key, subject_key, state_classification, maturity_score,
              input_sources_json, state_json, maturity_json, blockers_json, safety_json,
              decision_run_id, produced_by_engine_key, status, secrets_included,
              created_at, updated_at
         FROM platform_orchestration_state_snapshots
        WHERE plugin_key = ?
        ORDER BY created_at DESC
        LIMIT ?`,
      [pluginKey, limit]
    );
    snapshots = snapshotRows.map((row) => normalizeRowJson(row, [
      "input_sources_json", "state_json", "maturity_json", "blockers_json", "safety_json",
    ]));
  }

  let recommendations = [];
  if (includeRecommendations) {
    const [recommendationRows] = await pool.query(
      `SELECT recommendation_id, recommendation_key, snapshot_id, plugin_key,
              scope_type, scope_id, task_class, recommendation_type, priority,
              recommendation_status, decision_json, blockers_json, next_actions_json,
              safety_contract_json, decision_run_id, produced_by_engine_key,
              accepted_at, completed_at, secrets_included, created_at, updated_at
         FROM platform_orchestration_recommendations
        WHERE plugin_key = ?
        ORDER BY created_at DESC
        LIMIT ?`,
      [pluginKey, limit]
    );
    recommendations = recommendationRows.map((row) => normalizeRowJson(row, [
      "decision_json", "blockers_json", "next_actions_json", "safety_contract_json",
    ]));
  }

  const knownSevenStageGraphs = new Set([
    "ads_provider_governance_orchestrator",
    "support_ticket_lifecycle_orchestrator",
    "support_ticket_external_delivery_orchestrator",
  ]);
  const expectedStages = knownSevenStageGraphs.has(pluginKey) ? 7 : Math.max(1, stages.length);
  const expectedEdges = knownSevenStageGraphs.has(pluginKey) ? 6 : Math.max(0, edges.length);
  const stageCount = stages.length;
  const edgeCount = edges.length;
  const ready = plugin.status === "active" && stageCount >= expectedStages && edgeCount >= expectedEdges;

  return {
    ok: true,
    plugin_key: pluginKey,
    readback_mode: "orchestration_graph_readonly",
    readiness_status: ready ? "ready_readonly_graph_seeded" : "degraded_graph_incomplete",
    graph: {
      expected_stage_count: expectedStages,
      expected_edge_count: expectedEdges,
      stage_count: stageCount,
      edge_count: edgeCount,
      active_stage_count: stages.filter((stage) => stage.status === "active").length,
      active_edge_count: edges.filter((edge) => edge.status === "active").length,
      graph_readiness: graphReadiness,
      ads_governance_readiness: adsGovernanceReadiness,
      support_ticket_lifecycle_readiness: supportTicketLifecycleReadiness,
    },
    plugin,
    stages,
    edges,
    snapshots,
    recommendations,
    execution: {
      will_execute_provider_call: false,
      will_read_credential_payload: false,
      will_change_spend: false,
      will_external_write: false,
      will_deploy: false,
      will_publish: false,
      recommendation_only: true,
    },
    secrets_included: false,
  };
}
