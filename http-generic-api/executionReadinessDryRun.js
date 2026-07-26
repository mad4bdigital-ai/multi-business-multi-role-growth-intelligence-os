import { getPool } from "./db.js";
import { resolveActionManifestDiagnostic } from "./actionManifestDiagnostic.js";
import { resolvePlatformGraphContext } from "./services/platformKnowledgeGraphResolver.js";

function normalize(value = "") { return String(value ?? "").trim(); }
function lower(value = "") { return normalize(value).toLowerCase(); }
function truthy(value) { return ["true", "1", "yes", "y", "active", "ready", "enabled", "validated"].includes(lower(value)); }
function firstNonEmpty(...values) { for (const value of values) { const v = normalize(value); if (v) return v; } return ""; }
function uniq(values = []) { return [...new Set(values.map(normalize).filter(Boolean))]; }
function blocked(code, message, details = {}) { return { code, message, ...details }; }

function sanitizeRows(rows = [], limit = 20) {
  return (Array.isArray(rows) ? rows : []).slice(0, limit).map((row) => ({ ...row, secrets_included: false }));
}

function summarizeGraphNodes(rows = [], limit = 20) {
  return (Array.isArray(rows) ? rows : []).slice(0, limit).map((row) => ({
    node_id: row.node_id,
    node_type: row.node_type,
    node_label: row.node_label,
    scope_type: row.scope_type,
    authority_status: row.authority_status,
    lifecycle_status: row.lifecycle_status,
    runtime_role: row.runtime_role,
    source_table: row.source_table,
    secrets_included: false,
  }));
}

function summarizeGraphEdges(rows = [], limit = 40) {
  return (Array.isArray(rows) ? rows : []).slice(0, limit).map((row) => ({
    edge_id: row.edge_id,
    source_node_id: row.source_node_id,
    edge_type: row.edge_type,
    target_node_id: row.target_node_id,
    authority_status: row.authority_status,
    lifecycle_status: row.lifecycle_status,
    runtime_role: row.runtime_role,
    runtime_enforced: Number(row.runtime_enforced || 0) === 1,
    source_table: row.source_table,
    secrets_included: false,
  }));
}

async function loadBrandReadiness(pool, input = {}) {
  const brandKey = firstNonEmpty(input.brand_key, input.target_key, input.brand_name);
  if (!brandKey) return { requested: false, status: "not_requested", blocks: [], secrets_included: false };
  const [rows] = await pool.query(
    `SELECT b.target_key, b.brand_name, b.status AS brand_status, b.brand_core_ready,
            bp.business_type_key, bp.knowledge_profile_key, bp.active AS path_active,
            COUNT(bc.id) AS brand_core_assets,
            SUM(CASE WHEN LOWER(COALESCE(bc.active_status,bc.status,'')) IN ('active','ready','true','1','validated') THEN 1 ELSE 0 END) AS active_core_assets
       FROM brands b
       LEFT JOIN brand_paths bp ON bp.target_key=b.target_key OR bp.brand_key=b.target_key OR bp.brand_key=b.brand_name
       LEFT JOIN brand_core bc ON bc.brand_key=bp.brand_key OR bc.brand_key=b.target_key OR bc.brand_name=b.brand_name
      WHERE b.target_key=? OR b.brand_name=? OR bp.brand_key=? OR bp.target_key=?
      GROUP BY b.target_key,b.brand_name,b.status,b.brand_core_ready,bp.business_type_key,bp.knowledge_profile_key,bp.active
      LIMIT 20`,
    [brandKey, brandKey, brandKey, brandKey]
  );
  const records = sanitizeRows(rows);
  const found = records.length > 0;
  const activeCoreAssets = records.reduce((sum, row) => sum + Number(row.active_core_assets || 0), 0);
  const coreReady = records.some((row) => truthy(row.brand_core_ready)) || activeCoreAssets > 0;
  const activePath = records.some((row) => truthy(row.path_active));
  const blocks = [];
  if (!found) blocks.push(blocked("brand_not_found", "Brand was requested but no brand registry row was found.", { brand_key: brandKey }));
  if (found && !activePath) blocks.push(blocked("brand_path_not_active", "Brand path is missing or inactive.", { brand_key: brandKey }));
  return {
    requested: true,
    status: blocks.length ? "blocked" : "ready",
    brand_key: brandKey,
    found,
    core_ready: coreReady,
    active_core_assets: activeCoreAssets,
    inferred_business_type_keys: uniq(records.map((row) => row.business_type_key)),
    inferred_knowledge_profile_keys: uniq(records.map((row) => row.knowledge_profile_key)),
    records,
    blocks,
    secrets_included: false,
  };
}

async function loadBusinessReadiness(pool, input = {}) {
  const businessTypeKey = firstNonEmpty(input.business_type_key);
  const activityKey = firstNonEmpty(input.business_activity_type_key, input.activity_key);
  if (!businessTypeKey && !activityKey) return { requested: false, status: "not_requested", blocks: [], secrets_included: false };
  const where = ["1=1"];
  const params = [];
  if (businessTypeKey) { where.push("business_type_key = ?"); params.push(businessTypeKey); }
  if (activityKey) { where.push("(business_activity_type_key = ? OR activity_key = ?)"); params.push(activityKey, activityKey); }
  const [activities] = await pool.query(
    `SELECT business_activity_type_key, activity_key, business_type_key, label,
            default_knowledge_profile_key, brand_core_required,
            supported_route_keys, supported_workflows, supported_engine_categories,
            status, active
       FROM business_activity_types
      WHERE ${where.join(" AND ")}
      ORDER BY business_type_key, business_activity_type_key
      LIMIT 50`,
    params
  );
  const [profiles] = businessTypeKey
    ? await pool.query(
        `SELECT business_type_key, knowledge_profile_key, compatible_route_keys,
                compatible_workflows, profile_status, active
           FROM business_type_profiles
          WHERE business_type_key=?
          LIMIT 20`,
        [businessTypeKey]
      )
    : [[]];
  const activityRows = sanitizeRows(activities, 50);
  const profileRows = sanitizeRows(profiles, 20);
  const brandCoreRequired = activityRows.some((row) => truthy(row.brand_core_required));
  const blocks = [];
  if (!activityRows.length) blocks.push(blocked("business_activity_not_found", "No matching business activity rows were found.", { business_type_key: businessTypeKey || null, activity_key: activityKey || null }));
  if (businessTypeKey && !profileRows.length) blocks.push(blocked("business_type_profile_not_found", "No business type profile was found.", { business_type_key: businessTypeKey }));
  return {
    requested: true,
    status: blocks.length ? "blocked" : "ready",
    business_type_key: businessTypeKey || null,
    activity_key: activityKey || null,
    brand_core_required: brandCoreRequired,
    activity_count: activityRows.length,
    profile_count: profileRows.length,
    inferred_route_keys: uniq(activityRows.flatMap((row) => String(row.supported_route_keys || "").split(/[;,|\n]+/g))).slice(0, 50),
    inferred_workflow_keys: uniq(activityRows.flatMap((row) => String(row.supported_workflows || "").split(/[;,|\n]+/g))).slice(0, 50),
    activities: activityRows,
    profiles: profileRows,
    blocks,
    secrets_included: false,
  };
}

async function loadWorkflowLogicReadiness(pool, input = {}) {
  const workflowKey = firstNonEmpty(input.workflow_key, input.workflow_id);
  const logicKey = firstNonEmpty(input.logic_key, input.logic_id);
  const packKey = firstNonEmpty(input.logic_pack_key, input.pack_key, input.pack_id);
  if (!workflowKey && !logicKey && !packKey) return { requested: false, status: "not_requested", blocks: [], secrets_included: false };
  const blocks = [];
  let workflows = [];
  let logics = [];
  let packs = [];
  if (workflowKey) {
    const [rows] = await pool.query(
      `SELECT workflow_key, workflow_id, workflow_name, workflow_type, execution_class,
              execution_mode, review_required, status, active, target_module
         FROM workflows
        WHERE workflow_key=? OR workflow_id=?
        LIMIT 20`,
      [workflowKey, workflowKey]
    );
    workflows = sanitizeRows(rows);
    if (!workflows.length) blocks.push(blocked("workflow_not_found", "Workflow was requested but not found.", { workflow_key: workflowKey }));
    if (workflows.length && !workflows.some((row) => truthy(row.active || row.status))) blocks.push(blocked("workflow_not_active", "Workflow exists but is not active.", { workflow_key: workflowKey }));
  }
  if (logicKey) {
    const [rows] = await pool.query(
      `SELECT logic_id, logic_key, display_name, logic_type, parent_logic_id,
              tenant_id, status, version
         FROM logic_definitions
        WHERE logic_key=? OR logic_id=?
        LIMIT 20`,
      [logicKey, logicKey]
    );
    logics = sanitizeRows(rows);
    if (!logics.length) blocks.push(blocked("logic_not_found", "Logic was requested but not found.", { logic_key: logicKey }));
    if (logics.length && !logics.some((row) => row.status === "active")) blocks.push(blocked("logic_not_active", "Logic exists but is not active.", { logic_key: logicKey }));
  }
  if (packKey) {
    const [rows] = await pool.query(
      `SELECT pack_id, pack_key, display_name, pack_type, service_mode,
              parent_pack_id, tenant_id, status
         FROM logic_packs
        WHERE pack_key=? OR pack_id=?
        LIMIT 20`,
      [packKey, packKey]
    );
    packs = sanitizeRows(rows);
    if (!packs.length) blocks.push(blocked("logic_pack_not_found", "Logic pack was requested but not found.", { pack_key: packKey }));
    if (packs.length && !packs.some((row) => row.status === "active")) blocks.push(blocked("logic_pack_not_active", "Logic pack exists but is not active.", { pack_key: packKey }));
  }
  return { requested: true, status: blocks.length ? "blocked" : "ready", workflow_key: workflowKey || null, logic_key: logicKey || null, pack_key: packKey || null, workflows, logics, packs, blocks, secrets_included: false };
}

async function loadSkillReadiness(pool, input = {}) {
  const agentId = firstNonEmpty(input.agent_id, input.agent_key);
  const skillKey = firstNonEmpty(input.skill_key, input.skill_id);
  if (!agentId && !skillKey) return { requested: false, status: "not_requested", blocks: [], secrets_included: false };
  const blocks = [];
  let grants = [];
  if (agentId || skillKey) {
    const where = ["1=1"];
    const params = [];
    if (agentId) { where.push("g.agent_id = ?"); params.push(agentId); }
    if (skillKey) { where.push("(s.skill_key = ? OR s.skill_id = ?)"); params.push(skillKey, skillKey); }
    const [rows] = await pool.query(
      `SELECT a.agent_id, a.name AS agent_name, a.execution_class, a.health_status, a.status AS agent_status,
              s.skill_id, s.skill_key, s.display_name AS skill_name, s.skill_type, s.scope,
              s.requires_approval, s.status AS skill_status,
              g.grant_id, g.tenant_id, g.brand_key, g.expires_at, g.status AS grant_status
         FROM agent_skill_grants g
         LEFT JOIN agents a ON a.agent_id = g.agent_id
         LEFT JOIN agent_skills s ON s.skill_id = g.skill_id
        WHERE ${where.join(" AND ")}
        ORDER BY s.skill_key, g.agent_id
        LIMIT 100`,
      params
    );
    grants = sanitizeRows(rows, 100);
  }
  if (agentId && !grants.some((row) => row.agent_id === agentId)) blocks.push(blocked("agent_skill_grants_not_found", "No matching active/inactive skill grants found for requested agent context.", { agent_id: agentId }));
  if (skillKey && !grants.some((row) => row.skill_key === skillKey || row.skill_id === skillKey)) blocks.push(blocked("skill_grant_not_found", "Requested skill is not granted in the resolved agent context.", { skill_key: skillKey }));
  const activeGrantCount = grants.filter((row) => row.grant_status === "active" && row.skill_status === "active" && row.agent_status === "active").length;
  if ((agentId || skillKey) && activeGrantCount === 0) blocks.push(blocked("active_skill_grant_missing", "No active agent skill grant matched the requested context.", { agent_id: agentId || null, skill_key: skillKey || null }));
  return {
    requested: true,
    status: blocks.length ? "blocked" : "ready",
    agent_id: agentId || null,
    skill_key: skillKey || null,
    grant_count: grants.length,
    active_grant_count: activeGrantCount,
    approval_required_grants: grants.filter((row) => Number(row.requires_approval || 0) === 1).length,
    grants,
    blocks,
    secrets_included: false,
  };
}

export async function resolveExecutionReadinessDryRun(input = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const requested = {
    action_key: firstNonEmpty(input.action_key, input.actionKey, input.parent_action_key) || null,
    endpoint_key: firstNonEmpty(input.endpoint_key, input.endpointKey) || null,
    plugin_key: firstNonEmpty(input.plugin_key, input.pluginKey, input.app_key) || null,
    tool_key: firstNonEmpty(input.tool_key, input.toolKey) || null,
    tenant_id: firstNonEmpty(input.tenant_id, input.tenantId) || null,
    user_id: firstNonEmpty(input.user_id, input.userId) || null,
    brand_key: firstNonEmpty(input.brand_key, input.target_key, input.brand_name) || null,
    business_type_key: firstNonEmpty(input.business_type_key) || null,
    business_activity_type_key: firstNonEmpty(input.business_activity_type_key, input.activity_key) || null,
    workflow_key: firstNonEmpty(input.workflow_key, input.workflow_id) || null,
    logic_key: firstNonEmpty(input.logic_key, input.logic_id) || null,
    logic_pack_key: firstNonEmpty(input.logic_pack_key, input.pack_key, input.pack_id) || null,
    agent_id: firstNonEmpty(input.agent_id, input.agent_key) || null,
    skill_key: firstNonEmpty(input.skill_key, input.skill_id) || null,
    actor_role: firstNonEmpty(input.actor_role, input.actorRole) || null,
    governance_level: firstNonEmpty(input.governance_level, input.governanceLevel) || null,
  };

  const manifest = await (deps.resolveActionManifestDiagnostic || resolveActionManifestDiagnostic)({
    ...input,
    action_key: requested.action_key,
    endpoint_key: requested.endpoint_key,
    plugin_key: requested.plugin_key,
    tool_key: requested.tool_key,
    tenant_id: requested.tenant_id,
    user_id: requested.user_id,
    actor_role: requested.actor_role,
    governance_level: requested.governance_level,
    preview_enforce: input.preview_enforce ?? true,
    require_plugin_connection: input.require_plugin_connection ?? true,
  });

  const [brand, business, workflow_logic, skills, graph_context] = await Promise.all([
    loadBrandReadiness(pool, requested),
    loadBusinessReadiness(pool, requested),
    loadWorkflowLogicReadiness(pool, requested),
    loadSkillReadiness(pool, requested),
    (deps.resolvePlatformGraphContext || resolvePlatformGraphContext)({ ...requested, depth: input.graph_depth || 2, limit: input.graph_limit || 250 }),
  ]);

  const blocks = [];
  if (manifest.execution_authority_guard_preview?.guard_status === "blocked") {
    blocks.push(...(manifest.execution_authority_guard_preview?.error?.details?.blocks || [blocked("execution_authority_guard_blocked", "Execution authority guard would block dispatch.")]));
  }
  for (const section of [brand, business, workflow_logic, skills]) {
    if (section?.blocks?.length) blocks.push(...section.blocks);
  }
  if (business.brand_core_required && brand.requested && !brand.core_ready) {
    blocks.push(blocked("brand_core_required_but_not_ready", "Business activity requires Brand Core but the selected brand is not Brand Core ready.", { brand_key: requested.brand_key, business_type_key: requested.business_type_key }));
  }
  if (graph_context.requested && !graph_context.resolved) {
    blocks.push(blocked("graph_context_not_resolved", "Platform Graph context was requested but no graph nodes were resolved.", { start_node_ids: graph_context.start_node_ids || [] }));
  }

  const blockCodes = uniq(blocks.map((item) => item.code));
  const dispatchReady = blockCodes.length === 0 && manifest.execution_authority_guard_preview?.guard_status === "passed";

  return {
    ok: true,
    diagnostic: "full_execution_readiness_dry_run",
    mode: "dry_run_only",
    will_execute: false,
    dispatch_ready: dispatchReady,
    readiness_status: dispatchReady ? "dispatch_ready" : "blocked",
    requested,
    checks: {
      action_endpoint_tool_manifest: manifest,
      brand,
      business,
      workflow_logic,
      skills,
      graph_context: {
        requested: graph_context.requested,
        resolved: graph_context.resolved,
        validation_state: graph_context.validation_state,
        start_node_ids: graph_context.start_node_ids || [],
        node_count: graph_context.node_count || graph_context.nodes?.length || 0,
        edge_count: graph_context.edge_count || graph_context.edges?.length || 0,
        authority_summary: graph_context.authority_summary || null,
        nodes: summarizeGraphNodes(graph_context.nodes || [], input.detail_limit || 20),
        edges: summarizeGraphEdges(graph_context.edges || [], input.edge_detail_limit || 40),
        detail_truncated: {
          node_limit: Number(input.detail_limit || 20),
          edge_limit: Number(input.edge_detail_limit || 40),
          nodes_available: graph_context.nodes?.length || 0,
          edges_available: graph_context.edges?.length || 0,
        },
        secrets_included: false,
      },
    },
    blocked_reasons: blocks,
    block_codes: blockCodes,
    next_step: dispatchReady ? "dispatch_can_proceed_to_guarded_dispatch_phase" : "resolve_blocked_reasons_before_dispatch",
    secrets_included: false,
  };
}
