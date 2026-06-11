import { getPool } from "./db.js";

const PLATFORM_BRAND_KEY = "growth_intelligence_platform";
const SENSITIVE_PATTERN = /(secret|credential|token|password|private_key|cipher|api_key|value_ciphertext|value_sha|config_json|system_prompt|payload_json)/i;

function compactError(err) {
  return { code: err.code || "activation_operational_intelligence_failed", message: err.message };
}

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseJsonValue(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function stripSensitive(row = {}) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !SENSITIVE_PATTERN.test(key)));
}

async function safeRows(sql, params = []) {
  try {
    const [rows] = await getPool().query(sql, params);
    return { ok: true, rows: Array.isArray(rows) ? rows : [] };
  } catch (err) {
    return { ok: false, rows: [], error: compactError(err) };
  }
}

function isAdminSubject(sessionContext = {}) {
  return Boolean(
    sessionContext?.subject?.is_admin === true ||
    sessionContext?.platform_access?.principal?.is_admin === true ||
    sessionContext?.platform_access?.access_scope === "platform_admin_all"
  );
}

function resolveSubject(sessionContext = {}) {
  const subject = sessionContext?.subject || {};
  return {
    is_admin: isAdminSubject(sessionContext),
    tenant_id: subject.tenant_id || sessionContext?.platform_access?.principal?.tenant_id || null,
    user_id: subject.user_id || sessionContext?.platform_access?.principal?.user_id || null,
    auth_mode: sessionContext?.platform_access?.principal?.type || sessionContext?.platform_access?.principal?.auth_mode || null,
  };
}

function severityWeight(severity = "info") {
  return { critical: 5, high: 4, medium: 3, low: 2, info: 1 }[String(severity).toLowerCase()] || 1;
}

function makeAttentionItem({ containerKey = null, severity = "info", source = null, reasonCode, title, recommendedActionKey = null, requiresConfirmation = false, evidence = null }) {
  return {
    queue_key: `${containerKey || "global"}:${reasonCode}:${source || "surface"}`,
    container_key: containerKey,
    severity,
    source,
    reason_code: reasonCode,
    title,
    recommended_action_key: recommendedActionKey,
    requires_confirmation: requiresConfirmation === true,
    evidence: evidence ? stripSensitive(evidence) : null,
  };
}

function uniqueBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, item);
  }
  return [...map.values()];
}

async function loadContainers(subject) {
  const workspaceWhere = subject.is_admin
    ? "bootstrap_status <> 'error'"
    : "tenant_id = ? AND bootstrap_status <> 'error'";
  const workspaces = await safeRows(
    `SELECT workspace_id, tenant_id, workspace_key, display_name, workspace_type,
            bootstrap_status, linked_brand_key, linked_system_ids, updated_at
       FROM workspace_registry
      WHERE ${workspaceWhere}
      ORDER BY FIELD(bootstrap_status, 'ready', 'in_progress', 'degraded', 'not_started'), updated_at DESC
      LIMIT 100`,
    subject.is_admin ? [] : [subject.tenant_id || "__missing_tenant__"]
  );
  const containers = workspaces.rows.map((row) => ({
    container_key: `workspace:${row.workspace_id}`,
    tenant_id: row.tenant_id,
    workspace_id: row.workspace_id,
    workspace_key: row.workspace_key,
    display_name: row.display_name,
    linked_brand_key: row.linked_brand_key || null,
    linked_system_ids: String(row.linked_system_ids || "").split(/[|,;\n]/).map((item) => item.trim()).filter(Boolean),
    bootstrap_status: row.bootstrap_status,
  }));
  if (subject.is_admin) {
    containers.unshift({
      container_key: `brand:${PLATFORM_BRAND_KEY}`,
      tenant_id: null,
      workspace_id: null,
      workspace_key: null,
      display_name: "Growth Intelligence Platform",
      linked_brand_key: PLATFORM_BRAND_KEY,
      linked_system_ids: [],
      bootstrap_status: "ready",
    });
  }
  return { workspaces, containers };
}

async function loadScopedRows(subject) {
  const tenantWhere = subject.is_admin ? "1 = 1" : "tenant_id = ?";
  const tenantParams = subject.is_admin ? [] : [subject.tenant_id || "__missing_tenant__"];
  const userTenantWhere = subject.is_admin ? "1 = 1" : "(tenant_id = ? OR user_id = ?)";
  const userTenantParams = subject.is_admin ? [] : [subject.tenant_id || "__missing_tenant__", subject.user_id || "__missing_user__"];

  const [
    systems,
    tasks,
    agents,
    skillGrants,
    freshness,
    signals,
    packs,
    packComponents,
    actions,
    actionRules,
    freshnessPolicies,
    signalSubscriptions,
    preferences,
    relationships,
    relationshipTypes,
  ] = await Promise.all([
    safeRows(
      `SELECT system_id, tenant_id, system_key, display_name, provider_family, connector_family,
              service_mode, status, updated_at
         FROM connected_systems
        WHERE ${tenantWhere} AND status <> 'archived'
        ORDER BY updated_at DESC LIMIT 300`,
      tenantParams
    ),
    safeRows(
      `SELECT task_id, task_key, title, task_type, priority, task_status, owner_scope,
              tenant_id, user_id, source_surface, blocker_level, due_at, updated_at
         FROM v_activation_pending_tasks
        WHERE ${userTenantWhere}
        ORDER BY FIELD(priority, 'critical','high','medium','low'), updated_at DESC LIMIT 300`,
      userTenantParams
    ),
    safeRows(
      `SELECT tenant_id, agent_id, agent_name, agent_display_name, execution_class,
              execution_layer, health_status, agent_status, updated_at
         FROM v_activation_agent_catalog
        WHERE ${tenantWhere}
        ORDER BY updated_at DESC LIMIT 300`,
      tenantParams
    ),
    safeRows(
      `SELECT grant_id, tenant_id, brand_key, agent_id, agent_name, agent_display_name,
              skill_id, skill_key, skill_display_name, skill_type, skill_scope,
              requires_approval, grant_status, expires_at, granted_at
         FROM v_activation_agent_skill_grants
        WHERE ${tenantWhere}
        ORDER BY granted_at DESC LIMIT 300`,
      tenantParams
    ),
    safeRows(
      `SELECT ledger_id, tenant_id, user_id, container_key, surface_key, provider_family,
              connector_family, source_ref, freshness_status, last_checked_at,
              last_success_at, last_failure_at, updated_at
         FROM activation_freshness_ledger
        WHERE ${userTenantWhere}
        ORDER BY updated_at DESC LIMIT 300`,
      userTenantParams
    ),
    safeRows(
      `SELECT signal_id, tenant_id, user_id, container_key, provider_family, connector_family,
              signal_type, severity, signal_status, payload_summary_json, source_ref,
              received_at, processed_at
         FROM activation_signal_inbox
        WHERE ${userTenantWhere}
        ORDER BY FIELD(severity, 'critical','high','medium','low','info'), received_at DESC LIMIT 300`,
      userTenantParams
    ),
    safeRows(
      `SELECT pack_key, provider_family, connector_family, display_name, description,
              pack_category, default_scope_class, webhook_supported, polling_supported,
              chatgpt_app_fallback_supported, manual_fallback_supported, required_scopes_json, pack_status
         FROM activation_connector_pack_registry
        WHERE pack_status = 'active'
        ORDER BY pack_category, pack_key LIMIT 200`,
      []
    ),
    safeRows(
      `SELECT component_key, pack_key, component_type, component_ref, required, priority_order, status
         FROM activation_connector_pack_component_registry
        WHERE status = 'active'
        ORDER BY priority_order ASC, component_key ASC LIMIT 500`,
      []
    ),
    safeRows(
      `SELECT action_ref_key, tab_key, section_key_like, provider_family, connector_family,
              source_table_like, runtime_action_key, endpoint_selector, label, action_mode,
              requires_confirmation, required_capability_key, fallback_prompt_template_key, priority_order, status
         FROM activation_section_action_registry
        WHERE status = 'active'
        ORDER BY priority_order ASC, action_ref_key ASC LIMIT 300`,
      []
    ),
    safeRows(
      `SELECT rule_key, display_name, source_tab_key, source_section_key_like, source_table_like,
              provider_family, signal_field, signal_value_like, severity, reason_code,
              recommended_action_key, requires_confirmation, priority_order, status
         FROM activation_attention_rule_registry
        WHERE status = 'active'
        ORDER BY priority_order ASC, rule_key ASC LIMIT 200`,
      []
    ),
    safeRows(
      `SELECT policy_key, surface_key_like, source_table_like, provider_family, connector_family,
              freshness_sla_seconds, refresh_mode, stale_severity, status
         FROM activation_freshness_policy_registry
        WHERE status = 'active'
        ORDER BY policy_key ASC LIMIT 200`,
      []
    ),
    safeRows(
      `SELECT subscription_key, provider_family, connector_family, signal_type, source_mode,
              webhook_supported, polling_supported, min_poll_interval_seconds, required_scope_json, status
         FROM activation_signal_subscription_registry
        WHERE status = 'active'
        ORDER BY provider_family, signal_type LIMIT 200`,
      []
    ),
    subject.user_id
      ? safeRows(
          `SELECT preference_id, tenant_id, user_id, preference_key, preferred_home_tab,
                  pinned_containers_json, collapsed_tabs_json, hidden_sections_json, layout_json, status
             FROM activation_user_dashboard_preferences
            WHERE user_id = ? AND status = 'active'
            ORDER BY updated_at DESC LIMIT 20`,
          [subject.user_id]
        )
      : { ok: true, rows: [] },
    safeRows(
      `SELECT relationship_id, tenant_id, from_container_key, to_container_key, relationship_type,
              source_surface, evidence_ref, status, updated_at
         FROM activation_container_relationships
        WHERE ${tenantWhere} AND status = 'active'
        ORDER BY updated_at DESC LIMIT 300`,
      tenantParams
    ),
    safeRows(
      `SELECT relationship_type, display_name, description, default_direction, status
         FROM activation_container_relationship_type_registry
        WHERE status = 'active'
        ORDER BY relationship_type ASC LIMIT 100`,
      []
    ),
  ]);

  return { systems, tasks, agents, skillGrants, freshness, signals, packs, packComponents, actions, actionRules, freshnessPolicies, signalSubscriptions, preferences, relationships, relationshipTypes };
}

function buildAttentionQueue(rows, containers) {
  const containerByTenant = new Map(containers.map((container) => [container.tenant_id, container.container_key]).filter(([tenant]) => tenant));
  const items = [];
  for (const system of rows.systems.rows) {
    const containerKey = containerByTenant.get(system.tenant_id) || null;
    if (system.status === "error") {
      items.push(makeAttentionItem({ containerKey, severity: "high", source: "connected_systems", reasonCode: "connector_error", title: `${system.display_name || system.system_key} connector is in error state`, recommendedActionKey: "connector.reconnect_or_review", requiresConfirmation: true, evidence: system }));
    } else if (system.status === "pending") {
      items.push(makeAttentionItem({ containerKey, severity: "medium", source: "connected_systems", reasonCode: "connector_pending", title: `${system.display_name || system.system_key} connector setup is pending`, recommendedActionKey: "connector.complete_setup", evidence: system }));
    }
  }
  for (const task of rows.tasks.rows) {
    const containerKey = containerByTenant.get(task.tenant_id) || null;
    if (task.task_status === "blocked" || task.blocker_level === "hard") {
      items.push(makeAttentionItem({ containerKey, severity: "critical", source: "v_activation_pending_tasks", reasonCode: "task_blocked", title: task.title, recommendedActionKey: "task.review_blocker", evidence: task }));
    } else if (task.priority === "critical" || task.priority === "high") {
      items.push(makeAttentionItem({ containerKey, severity: task.priority === "critical" ? "critical" : "high", source: "v_activation_pending_tasks", reasonCode: "high_priority_task", title: task.title, recommendedActionKey: "task.review_priority", evidence: task }));
    }
  }
  for (const agent of rows.agents.rows) {
    const containerKey = containerByTenant.get(agent.tenant_id) || null;
    if (agent.health_status === "offline" || agent.health_status === "degraded") {
      items.push(makeAttentionItem({ containerKey, severity: agent.health_status === "offline" ? "critical" : "high", source: "v_activation_agent_catalog", reasonCode: `agent_${agent.health_status}`, title: `${agent.agent_display_name || agent.agent_name} is ${agent.health_status}`, recommendedActionKey: agent.health_status === "offline" ? "agent.recover" : "agent.health_review", requiresConfirmation: agent.health_status === "offline", evidence: agent }));
    }
  }
  for (const grant of rows.skillGrants.rows) {
    const containerKey = containerByTenant.get(grant.tenant_id) || null;
    if (safeNumber(grant.requires_approval) === 1) {
      items.push(makeAttentionItem({ containerKey, severity: "medium", source: "v_activation_agent_skill_grants", reasonCode: "skill_requires_approval", title: `${grant.skill_display_name || grant.skill_key} requires approval`, recommendedActionKey: "skill.review_approval", requiresConfirmation: true, evidence: grant }));
    }
  }
  for (const ledger of rows.freshness.rows) {
    if (ledger.freshness_status === "stale" || ledger.freshness_status === "failed") {
      items.push(makeAttentionItem({ containerKey: ledger.container_key || null, severity: ledger.freshness_status === "failed" ? "high" : "medium", source: "activation_freshness_ledger", reasonCode: `freshness_${ledger.freshness_status}`, title: `${ledger.surface_key || ledger.provider_family || "surface"} freshness is ${ledger.freshness_status}`, recommendedActionKey: "surface.refresh", evidence: ledger }));
    }
  }
  for (const signal of rows.signals.rows) {
    if (["critical", "high"].includes(signal.severity) && ["new", "failed"].includes(signal.signal_status)) {
      items.push(makeAttentionItem({ containerKey: signal.container_key || null, severity: signal.severity, source: "activation_signal_inbox", reasonCode: `${signal.signal_type}_${signal.signal_status}`, title: `${signal.signal_type} signal requires attention`, recommendedActionKey: "signal.review", evidence: signal }));
    }
  }
  return uniqueBy(items, (item) => item.queue_key)
    .sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity) || String(a.title).localeCompare(String(b.title)))
    .slice(0, 50);
}

function buildTabBadges(rows) {
  return {
    connectors: {
      active: rows.systems.rows.filter((row) => row.status === "active").length,
      pending: rows.systems.rows.filter((row) => row.status === "pending").length,
      error: rows.systems.rows.filter((row) => row.status === "error").length,
    },
    tasks: {
      blocked: rows.tasks.rows.filter((row) => row.task_status === "blocked" || row.blocker_level === "hard").length,
      high_priority: rows.tasks.rows.filter((row) => ["critical", "high"].includes(row.priority)).length,
      open: rows.tasks.rows.length,
    },
    agents: {
      active: rows.agents.rows.filter((row) => row.health_status === "active").length,
      degraded: rows.agents.rows.filter((row) => row.health_status === "degraded").length,
      offline: rows.agents.rows.filter((row) => row.health_status === "offline").length,
    },
    skills: {
      active_grants: rows.skillGrants.rows.filter((row) => row.grant_status === "active").length,
      requires_approval: rows.skillGrants.rows.filter((row) => safeNumber(row.requires_approval) === 1).length,
    },
    freshness: {
      fresh: rows.freshness.rows.filter((row) => row.freshness_status === "fresh").length,
      stale: rows.freshness.rows.filter((row) => row.freshness_status === "stale").length,
      failed: rows.freshness.rows.filter((row) => row.freshness_status === "failed").length,
      unknown: rows.freshness.rows.filter((row) => row.freshness_status === "unknown").length,
    },
    signals: {
      new: rows.signals.rows.filter((row) => row.signal_status === "new").length,
      critical: rows.signals.rows.filter((row) => row.severity === "critical").length,
      failed: rows.signals.rows.filter((row) => row.signal_status === "failed").length,
    },
  };
}

function buildConnectorPacks(rows) {
  const systemsByProvider = new Map();
  for (const system of rows.systems.rows) {
    for (const key of [system.provider_family, system.connector_family].filter(Boolean)) {
      const normalized = String(key).toLowerCase();
      const list = systemsByProvider.get(normalized) || [];
      list.push(system);
      systemsByProvider.set(normalized, list);
    }
  }
  const componentsByPack = new Map();
  for (const component of rows.packComponents.rows) {
    const list = componentsByPack.get(component.pack_key) || [];
    list.push(component);
    componentsByPack.set(component.pack_key, list);
  }
  return rows.packs.rows.map((pack) => {
    const nativeSystems = systemsByProvider.get(String(pack.provider_family).toLowerCase()) || systemsByProvider.get(String(pack.connector_family || "").toLowerCase()) || [];
    const status = nativeSystems.some((system) => system.status === "active")
      ? "native_connected"
      : pack.chatgpt_app_fallback_supported
        ? "chatgpt_app_fallback_possible"
        : pack.manual_fallback_supported
          ? "manual_prompt_available"
          : "not_connected";
    return {
      pack_key: pack.pack_key,
      provider_family: pack.provider_family,
      connector_family: pack.connector_family,
      display_name: pack.display_name,
      pack_category: pack.pack_category,
      status,
      native_system_count: nativeSystems.length,
      webhook_supported: pack.webhook_supported === 1,
      polling_supported: pack.polling_supported === 1,
      chatgpt_app_fallback_supported: pack.chatgpt_app_fallback_supported === 1,
      manual_fallback_supported: pack.manual_fallback_supported === 1,
      required_scopes: parseJsonValue(pack.required_scopes_json, []),
      components: (componentsByPack.get(pack.pack_key) || []).map(stripSensitive),
    };
  });
}

function buildFallbackNegotiation(connectorPacks) {
  return connectorPacks.map((pack) => ({
    provider_family: pack.provider_family,
    connector_family: pack.connector_family,
    pack_key: pack.pack_key,
    native_platform: pack.status === "native_connected" ? "available" : "not_connected",
    chatgpt_app: pack.chatgpt_app_fallback_supported ? "check_required" : "not_supported_or_not_registered",
    manual_prompt: pack.manual_fallback_supported ? "available" : "not_supported",
    recommended_path: pack.status === "native_connected"
      ? "use_platform_native_connection_for_background_and_conversation_awareness"
      : pack.chatgpt_app_fallback_supported
        ? "check_chatgpt_app_for_conversation_use_or_connect_platform_native_for_background_sync"
        : pack.manual_fallback_supported
          ? "collect_prompt_guided_manual_snapshot_or_connect_platform_native"
          : "connect_platform_native_required",
    background_sync_allowed: pack.status === "native_connected",
  }));
}

function buildContainerGraph(rows, containers) {
  const graph = { nodes: [], edges: [] };
  const nodeKeys = new Set();
  function addNode(key, type, label, extra = {}) {
    if (!key || nodeKeys.has(key)) return;
    nodeKeys.add(key);
    graph.nodes.push({ node_key: key, node_type: type, label, ...extra });
  }
  function addEdge(from, to, type, evidence = null) {
    if (!from || !to) return;
    graph.edges.push({ from, to, relationship_type: type, evidence: evidence ? stripSensitive(evidence) : null });
  }
  for (const container of containers) {
    addNode(container.container_key, "container", container.display_name, { tenant_id: container.tenant_id, workspace_key: container.workspace_key });
    if (container.linked_brand_key) {
      const brandKey = `brand:${container.linked_brand_key}`;
      addNode(brandKey, "brand", container.linked_brand_key);
      addEdge(container.container_key, brandKey, "workspace_owns_brand", { linked_brand_key: container.linked_brand_key });
    }
  }
  const containerByTenant = new Map(containers.map((container) => [container.tenant_id, container.container_key]).filter(([tenant]) => tenant));
  for (const system of rows.systems.rows) {
    const systemKey = `system:${system.system_id}`;
    addNode(systemKey, "connector", system.display_name || system.system_key, { provider_family: system.provider_family, status: system.status });
    addEdge(containerByTenant.get(system.tenant_id), systemKey, "brand_uses_connector", system);
  }
  for (const grant of rows.skillGrants.rows) {
    const agentKey = `agent:${grant.agent_id}`;
    const skillKey = `skill:${grant.skill_id}`;
    addNode(agentKey, "agent", grant.agent_display_name || grant.agent_name || grant.agent_id);
    addNode(skillKey, "skill", grant.skill_display_name || grant.skill_key || grant.skill_id);
    addEdge(agentKey, skillKey, "agent_has_skill", grant);
  }
  for (const task of rows.tasks.rows) {
    const taskKey = `task:${task.task_id}`;
    addNode(taskKey, "task", task.title, { priority: task.priority, status: task.task_status });
    addEdge(taskKey, containerByTenant.get(task.tenant_id), "task_blocks_container", task);
  }
  for (const rel of rows.relationships.rows) {
    addEdge(rel.from_container_key, rel.to_container_key, rel.relationship_type, rel);
  }
  return graph;
}

export async function buildActivationOperationalIntelligenceEvidence({ sessionContext = null } = {}) {
  const subject = resolveSubject(sessionContext || {});
  const containerResult = await loadContainers(subject);
  const rows = await loadScopedRows(subject);
  const degradedSurfaces = [
    ["workspace_registry", containerResult.workspaces],
    ...Object.entries(rows).map(([surface, result]) => [surface, result]),
  ]
    .filter(([, result]) => result?.ok === false)
    .map(([surface, result]) => ({ surface, error: result.error }));

  const attentionQueue = buildAttentionQueue(rows, containerResult.containers);
  const connectorPacks = buildConnectorPacks(rows);
  const fallbackNegotiation = buildFallbackNegotiation(connectorPacks);
  const containerGraph = buildContainerGraph(rows, containerResult.containers);

  return {
    attempted: true,
    ok: degradedSurfaces.length === 0,
    activation_layer: "activation_operational_intelligence",
    awareness_mode: "attention_actions_freshness_signals_graph_packs",
    source_authority: "sql_runtime_activation_intelligence_registries_and_subject_scoped_operational_rows",
    subject: {
      is_admin: subject.is_admin,
      tenant_id: subject.tenant_id,
      user_id: subject.user_id,
      auth_mode: subject.auth_mode,
    },
    summary: {
      attention_count: attentionQueue.length,
      critical_attention_count: attentionQueue.filter((item) => item.severity === "critical").length,
      registered_actions: rows.actions.rows.length,
      connector_pack_count: connectorPacks.length,
      native_connected_pack_count: connectorPacks.filter((pack) => pack.status === "native_connected").length,
      signal_subscription_count: rows.signalSubscriptions.rows.length,
      signal_inbox_count: rows.signals.rows.length,
      freshness_policy_count: rows.freshnessPolicies.rows.length,
      freshness_ledger_count: rows.freshness.rows.length,
      graph_node_count: containerGraph.nodes.length,
      graph_edge_count: containerGraph.edges.length,
      user_preference_count: rows.preferences.rows.length,
      degraded_surface_count: degradedSurfaces.length,
    },
    attention_queue: attentionQueue,
    tab_badges: buildTabBadges(rows),
    section_actions: rows.actions.rows.map(stripSensitive),
    freshness: {
      policies: rows.freshnessPolicies.rows.map(stripSensitive),
      ledger: rows.freshness.rows.map(stripSensitive),
    },
    signals: {
      subscriptions: rows.signalSubscriptions.rows.map((row) => ({ ...stripSensitive(row), required_scope_json: parseJsonValue(row.required_scope_json, []) })),
      inbox: rows.signals.rows.map((row) => ({ ...stripSensitive(row), payload_summary_json: parseJsonValue(row.payload_summary_json, {}) })),
    },
    connector_packs: connectorPacks,
    fallback_negotiation: fallbackNegotiation,
    container_graph: containerGraph,
    preferences: rows.preferences.rows.map((row) => ({
      ...stripSensitive(row),
      pinned_containers_json: parseJsonValue(row.pinned_containers_json, []),
      collapsed_tabs_json: parseJsonValue(row.collapsed_tabs_json, []),
      hidden_sections_json: parseJsonValue(row.hidden_sections_json, []),
      layout_json: parseJsonValue(row.layout_json, {}),
    })),
    degraded_surfaces: degradedSurfaces,
    policy: {
      output_is_advisory_until_action_confirmation: true,
      background_sync_requires_native_platform_connection: true,
      chatgpt_app_fallback_requires_runtime_interface_evidence: true,
      writeback_requires_governed_capability_and_user_confirmation: true,
      secret_values_never_returned: true,
      secrets_included: false,
    },
    secrets_included: false,
  };
}
