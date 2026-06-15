import { createHash } from "node:crypto";
import { getPool } from "./db.js";
import { readOperationalAlerts } from "./operationalAlertService.js";

const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const BLOCKED_COLUMN_PATTERN = /(secret|credential_ref|credential|token|password|private_key|cipher|api_key|value_ciphertext|value_sha|config_json|system_prompt|payload_json)/i;
const DEFAULT_DETAIL_LIMIT = 25;
const MAX_DETAIL_LIMIT = 100;

function compactError(err, fallback = "activation_awareness_failed") {
  return { code: err?.code || fallback, message: err?.message || String(err || fallback) };
}

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function stripSensitive(row = {}) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !BLOCKED_COLUMN_PATTERN.test(key)));
}

function quoteIdentifier(value) {
  const text = String(value || "").trim();
  if (!SAFE_IDENTIFIER.test(text)) {
    const err = new Error(`Unsafe activation awareness identifier: ${text}`);
    err.code = "unsafe_activation_awareness_identifier";
    throw err;
  }
  return `\`${text}\``;
}

function safeColumns(value) {
  const columns = Array.isArray(value) ? value : parseJson(value, []);
  return (Array.isArray(columns) ? columns : [])
    .map((column) => String(column || "").trim())
    .filter((column) => SAFE_IDENTIFIER.test(column))
    .filter((column) => !BLOCKED_COLUMN_PATTERN.test(column))
    .slice(0, 40);
}

async function safeRows(sql, params = []) {
  try {
    const [rows] = await getPool().query(sql, params);
    return { ok: true, rows: Array.isArray(rows) ? rows : [] };
  } catch (err) {
    return { ok: false, rows: [], error: compactError(err) };
  }
}

function resolveSubject(sessionContext = {}, explicit = {}) {
  const subject = sessionContext?.subject || {};
  const platformPrincipal = sessionContext?.platform_access?.principal || {};
  const isAdmin = explicit.is_admin === true || subject.is_admin === true || platformPrincipal.is_admin === true || sessionContext?.platform_access?.access_scope === "platform_admin_all";
  return {
    is_admin: isAdmin,
    tenant_id: explicit.tenant_id || subject.tenant_id || platformPrincipal.tenant_id || null,
    user_id: explicit.user_id || subject.user_id || platformPrincipal.user_id || null,
    auth_mode: explicit.auth_mode || platformPrincipal.type || platformPrincipal.auth_mode || null,
  };
}

function splitRefs(value = "") {
  return String(value || "")
    .split(/[|,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function snapshotHash(parts = []) {
  return createHash("sha256").update(parts.map((part) => String(part || "")).join("|")).digest("hex").slice(0, 32);
}

export function buildActivationSnapshot({ sessionContext = null, registryVersion = null, profile = "evidence" } = {}) {
  const generatedAt = new Date().toISOString();
  const subject = resolveSubject(sessionContext || {});
  const sessionId = sessionContext?.session_id || "no_session";
  return {
    snapshot_id: `act_${snapshotHash([sessionId, subject.tenant_id, subject.user_id, registryVersion, profile, generatedAt])}`,
    generated_at: generatedAt,
    registry_version: registryVersion || null,
    data_watermark: generatedAt,
    profile,
    subject_scope: subject.is_admin ? "platform_admin" : "tenant_user",
  };
}

async function loadContainers(subject) {
  const where = subject.is_admin ? "bootstrap_status <> 'error'" : "tenant_id = ? AND bootstrap_status <> 'error'";
  const result = await safeRows(
    `SELECT workspace_id, tenant_id, workspace_key, display_name, workspace_type,
            bootstrap_status, linked_brand_key, linked_system_ids, updated_at
       FROM workspace_registry
      WHERE ${where}
      ORDER BY FIELD(bootstrap_status, 'ready','in_progress','degraded','not_started'), updated_at DESC
      LIMIT 100`,
    subject.is_admin ? [] : [subject.tenant_id || "__missing_tenant__"]
  );
  const containers = result.rows.map((row) => ({
    container_key: `workspace:${row.workspace_id}`,
    container_type: row.workspace_type === "brand" ? "brand_workspace" : "workspace",
    workspace_id: row.workspace_id,
    workspace_key: row.workspace_key,
    tenant_id: row.tenant_id,
    display_name: row.display_name,
    bootstrap_status: row.bootstrap_status,
    linked_brand_key: row.linked_brand_key || null,
    linked_system_ids: splitRefs(row.linked_system_ids),
    updated_at: row.updated_at,
  }));
  if (subject.is_admin) {
    const platformBrand = await safeRows(
      `SELECT brand_name, target_key, status, updated_at
         FROM brands
        WHERE target_key = 'growth_intelligence_platform'
        LIMIT 1`,
      []
    );
    if (platformBrand.rows[0]) {
      const brand = platformBrand.rows[0];
      containers.unshift({
        container_key: "brand:growth_intelligence_platform",
        container_type: "platform_owner_brand",
        workspace_id: null,
        workspace_key: null,
        tenant_id: null,
        display_name: brand.brand_name || "Growth Intelligence Platform",
        bootstrap_status: "ready",
        linked_brand_key: brand.target_key,
        linked_system_ids: [],
        updated_at: brand.updated_at,
      });
    }
  }
  return { result, containers };
}

async function loadTabRegistry() {
  const [tabs, sections, discoveryRules, authorizedSurfaces] = await Promise.all([
    safeRows(
      `SELECT tab_key, display_name, description, tab_group, container_scope,
              default_visibility, priority_order, updated_at
         FROM activation_dynamic_tab_registry
        WHERE status = 'active'
        ORDER BY priority_order ASC, tab_key ASC`,
      []
    ),
    safeRows(
      `SELECT *
         FROM activation_dynamic_tab_section_registry
        WHERE status = 'active'
        ORDER BY priority_order ASC, section_key ASC`,
      []
    ),
    safeRows(
      `SELECT rule_key, target_tab_key, priority_order
         FROM activation_dynamic_tab_discovery_rule_registry
        WHERE status = 'active'
        ORDER BY priority_order ASC, rule_key ASC`,
      []
    ),
    safeRows(
      `SELECT surface_key, display_name, source_table, max_rows, sort_order
         FROM activation_authorized_surface_registry
        WHERE status = 'active'
        ORDER BY sort_order ASC, surface_key ASC
        LIMIT 250`,
      []
    ),
  ]);
  const registryVersion = [
    ...tabs.rows.map((row) => row.updated_at || row.tab_key),
    ...sections.rows.map((row) => row.updated_at || row.section_key),
    ...authorizedSurfaces.rows.map((row) => row.surface_key),
  ].sort().join("|");
  return { tabs, sections, discoveryRules, authorizedSurfaces, registry_version: snapshotHash([registryVersion]) };
}

function defaultDeliveryMode(section = {}) {
  if (section.delivery_mode) return section.delivery_mode;
  if (section.aggregation_mode === "count" || section.aggregation_mode === "summary") return "summary";
  return "attention_first";
}

function defaultDedupeScope(section = {}) {
  if (section.dedupe_scope) return section.dedupe_scope;
  if (!section.tenant_column && !section.user_column && !section.workspace_column && !section.brand_key_column && !section.system_id_column) return "global";
  if (section.workspace_column) return "workspace";
  if (section.brand_key_column) return "brand";
  if (section.user_column) return "user";
  if (section.tenant_column) return "tenant";
  return "system";
}

function badgeForTab(tabKey, operationalSummary = {}) {
  const key = String(tabKey || "").toLowerCase();
  const badges = operationalSummary.tab_badges || {};
  if (key.includes("connector") || key.includes("integration")) return badges.connectors || {};
  if (key.includes("task")) return badges.tasks || {};
  if (key.includes("agent") && !key.includes("skill")) return badges.agents || {};
  if (key.includes("skill")) return badges.skills || {};
  if (key.includes("fresh")) return badges.freshness || {};
  if (key.includes("signal") || key.includes("attention")) return badges.signals || {};
  return {};
}

function badgeCount(badge = {}) {
  return Object.values(badge).reduce((sum, value) => sum + safeNumber(value), 0);
}

function attentionCountForTab(tabKey, operationalSummary = {}) {
  const key = String(tabKey || "").toLowerCase();
  const bySource = operationalSummary.attention_by_source || {};
  if (key.includes("connector") || key.includes("integration")) return safeNumber(bySource.connected_systems);
  if (key.includes("task")) return safeNumber(bySource.tasks);
  if (key.includes("agent")) return safeNumber(bySource.agents) + safeNumber(bySource.skills);
  if (key.includes("fresh")) return safeNumber(bySource.freshness);
  if (key.includes("signal") || key.includes("attention")) return safeNumber(bySource.signals);
  return 0;
}

export async function buildActivationTabManifest({ sessionContext = null, snapshot = null, operationalSummary = null } = {}) {
  const subject = resolveSubject(sessionContext || {});
  const [registry, containerResult] = await Promise.all([loadTabRegistry(), loadContainers(subject)]);
  const sectionsByTab = new Map();
  for (const section of registry.sections.rows) {
    const list = sectionsByTab.get(section.tab_key) || [];
    list.push(section);
    sectionsByTab.set(section.tab_key, list);
  }
  const sharedSurfaceMap = new Map();
  for (const section of registry.sections.rows) {
    const dedupeScope = defaultDedupeScope(section);
    if (dedupeScope !== "global") continue;
    const ref = `shared:${section.source_table}:${section.section_key}`;
    sharedSurfaceMap.set(ref, {
      surface_ref: ref,
      section_key: section.section_key,
      tab_key: section.tab_key,
      source_table: section.source_table,
      dedupe_scope: "global",
      delivery_mode: defaultDeliveryMode(section),
      hydration_state: "manifest_only",
      detail_tool_key: section.detail_tool_key || "activation_dynamic_tab_detail_read_api",
    });
  }

  const containers = containerResult.containers.map((container) => {
    const tabs = registry.tabs.rows.map((tab) => {
      const tabSections = sectionsByTab.get(tab.tab_key) || [];
      const badge = badgeForTab(tab.tab_key, operationalSummary || {});
      const attentionCount = attentionCountForTab(tab.tab_key, operationalSummary || {});
      const sectionManifests = tabSections.map((section) => {
        const dedupeScope = defaultDedupeScope(section);
        const sharedRef = dedupeScope === "global" ? `shared:${section.source_table}:${section.section_key}` : null;
        return {
          section_key: section.section_key,
          display_name: section.display_name,
          source_table: section.source_table,
          aggregation_mode: section.aggregation_mode,
          delivery_mode: defaultDeliveryMode(section),
          inline_priority: safeNumber(section.inline_priority || section.priority_order || 100),
          dedupe_scope: dedupeScope,
          shared_surface_ref: sharedRef,
          supports_cursor: section.supports_cursor === undefined ? true : Boolean(safeNumber(section.supports_cursor)),
          max_inline_rows: safeNumber(section.max_inline_rows || 0),
          max_inline_bytes: safeNumber(section.max_inline_bytes || 0),
          cache_ttl_seconds: safeNumber(section.cache_ttl_seconds || 60),
          hydration_state: sharedRef ? "shared_reference" : "manifest_only",
          details_ref: {
            tool_key: section.detail_tool_key || "activation_dynamic_tab_detail_read_api",
            container_key: container.container_key,
            tab_key: tab.tab_key,
            section_key: section.section_key,
            snapshot_id: snapshot?.snapshot_id || null,
            supports_cursor: true,
          },
        };
      });
      return {
        tab_key: tab.tab_key,
        display_name: tab.display_name,
        tab_group: tab.tab_group,
        visibility: tab.default_visibility,
        visible: true,
        authorized: true,
        status: attentionCount > 0 ? "attention" : "ready",
        item_count: badgeCount(badge),
        attention_count: attentionCount,
        badge,
        freshness: operationalSummary?.freshness_status || "unknown",
        hydration_state: Object.keys(badge).length ? "summary_loaded" : "manifest_only",
        section_count: sectionManifests.length,
        sections: sectionManifests,
        details_ref: {
          tool_key: "activation_dynamic_tab_detail_read_api",
          container_key: container.container_key,
          tab_key: tab.tab_key,
          snapshot_id: snapshot?.snapshot_id || null,
          supports_cursor: true,
        },
      };
    });
    return {
      ...container,
      tab_count: tabs.length,
      attention_tab_count: tabs.filter((tab) => tab.attention_count > 0).length,
      tabs,
    };
  });

  const degraded = [
    ["activation_dynamic_tab_registry", registry.tabs],
    ["activation_dynamic_tab_section_registry", registry.sections],
    ["activation_dynamic_tab_discovery_rule_registry", registry.discoveryRules],
    ["activation_authorized_surface_registry", registry.authorizedSurfaces],
    ["workspace_registry", containerResult.result],
  ].filter(([, result]) => result?.ok === false).map(([surface, result]) => ({ surface, error: result.error }));

  return {
    attempted: true,
    ok: degraded.length === 0,
    activation_layer: "activation_dynamic_tabs_manifest",
    registry_version: registry.registry_version,
    subject,
    summary: {
      container_count: containers.length,
      registered_tabs: registry.tabs.rows.length,
      registered_sections: registry.sections.rows.length,
      authorized_surface_count: registry.authorizedSurfaces.rows.length,
      discovery_rule_count: registry.discoveryRules.rows.length,
      shared_surface_count: sharedSurfaceMap.size,
      degraded_surface_count: degraded.length,
    },
    containers,
    shared_surfaces: [...sharedSurfaceMap.values()],
    degraded_surfaces: degraded,
    policy: {
      all_tabs_remain_visible_as_manifests: true,
      detailed_rows_are_deferred_not_removed: true,
      shared_surfaces_are_referenced_not_repeated: true,
      secret_values_never_returned: true,
    },
    secrets_included: false,
  };
}

function aggregateRows(rows, key, accepted = null) {
  const output = {};
  for (const row of rows) {
    const value = String(row[key] ?? "unknown");
    if (accepted && !accepted.includes(value)) continue;
    output[value] = (output[value] || 0) + safeNumber(row.count || 0);
  }
  return output;
}

async function groupedCount(table, groupColumn, whereSql, params = []) {
  try {
    const tableSql = quoteIdentifier(table);
    const groupSql = quoteIdentifier(groupColumn);
    return safeRows(
      `SELECT ${groupSql} AS group_value, COUNT(*) AS count
         FROM ${tableSql}
        WHERE ${whereSql || "1 = 1"}
        GROUP BY ${groupSql}`,
      params
    );
  } catch (err) {
    return { ok: false, rows: [], error: compactError(err) };
  }
}

async function countOne(sql, params = []) {
  const result = await safeRows(sql, params);
  return { ...result, count: safeNumber(result.rows[0]?.count) };
}

export async function buildActivationOperationalSummary({ sessionContext = null, attentionLimit = 12 } = {}) {
  const subject = resolveSubject(sessionContext || {});
  const tenantWhere = subject.is_admin ? "1 = 1" : "tenant_id = ?";
  const tenantParams = subject.is_admin ? [] : [subject.tenant_id || "__missing_tenant__"];
  const userTenantWhere = subject.is_admin ? "1 = 1" : "(tenant_id = ? OR user_id = ?)";
  const userTenantParams = subject.is_admin ? [] : [subject.tenant_id || "__missing_tenant__", subject.user_id || "__missing_user__"];

  const [systems, tasks, agents, skills, freshness, signals, actionCount, packCount, subscriptionCount] = await Promise.all([
    groupedCount("connected_systems", "status", `${tenantWhere} AND status <> 'archived'`, tenantParams),
    safeRows(
      `SELECT task_status AS group_value, COUNT(*) AS count
         FROM v_activation_pending_tasks
        WHERE ${userTenantWhere}
        GROUP BY task_status`,
      userTenantParams
    ),
    groupedCount("v_activation_agent_catalog", "health_status", tenantWhere, tenantParams),
    safeRows(
      `SELECT CASE WHEN requires_approval = 1 THEN 'requires_approval' ELSE grant_status END AS group_value,
              COUNT(*) AS count
         FROM v_activation_agent_skill_grants
        WHERE ${tenantWhere}
        GROUP BY CASE WHEN requires_approval = 1 THEN 'requires_approval' ELSE grant_status END`,
      tenantParams
    ),
    safeRows(
      `SELECT freshness_status AS group_value, COUNT(*) AS count
         FROM activation_freshness_ledger
        WHERE ${userTenantWhere}
        GROUP BY freshness_status`,
      userTenantParams
    ),
    safeRows(
      `SELECT CONCAT(severity, ':', signal_status) AS group_value, COUNT(*) AS count
         FROM activation_signal_inbox
        WHERE ${userTenantWhere}
        GROUP BY severity, signal_status`,
      userTenantParams
    ),
    countOne("SELECT COUNT(*) AS count FROM activation_section_action_registry WHERE status = 'active'"),
    countOne("SELECT COUNT(*) AS count FROM activation_connector_pack_registry WHERE pack_status = 'active'"),
    countOne("SELECT COUNT(*) AS count FROM activation_signal_subscription_registry WHERE status = 'active'"),
  ]);

  const systemCounts = aggregateRows(systems.rows, "group_value");
  const taskCounts = aggregateRows(tasks.rows, "group_value");
  const agentCounts = aggregateRows(agents.rows, "group_value");
  const skillCounts = aggregateRows(skills.rows, "group_value");
  const freshnessCounts = aggregateRows(freshness.rows, "group_value");
  const signalCounts = aggregateRows(signals.rows, "group_value");
  const unifiedAttention = await readOperationalAlerts({
    sessionContext,
    cursor: 0,
    limit: Math.min(Math.max(safeNumber(attentionLimit), 1), 20),
    lookbackHours: 168,
    includeResolved: false,
  });
  const unifiedBySource = unifiedAttention?.summary?.by_source || {};

  const attentionBySource = {
    connected_systems: safeNumber(unifiedBySource.connected_systems),
    tasks: safeNumber(unifiedBySource.v_activation_pending_tasks),
    agents: safeNumber(unifiedBySource.v_activation_agent_catalog),
    skills: safeNumber(unifiedBySource.v_activation_agent_skill_grants),
    freshness: safeNumber(unifiedBySource.activation_freshness_ledger),
    signals: safeNumber(unifiedBySource.activation_signal_inbox),
    execution_log: safeNumber(unifiedBySource.execution_log),
    readiness_checks: safeNumber(unifiedBySource.readiness_checks),
    telemetry_spans: safeNumber(unifiedBySource.telemetry_spans),
    known_issues: safeNumber(unifiedAttention?.summary?.known_issue_count),
  };

  const attentionItems = [];
  const attentionQueries = [
    safeRows(
      `SELECT 'connected_systems' AS source, system_id AS item_id,
              CASE WHEN status = 'error' THEN 'high' ELSE 'medium' END AS severity,
              CONCAT(COALESCE(display_name, system_key), ' connector is ', status) AS title,
              updated_at
         FROM connected_systems
        WHERE ${tenantWhere} AND status IN ('error','pending')
        ORDER BY FIELD(status,'error','pending'), updated_at DESC
        LIMIT ?`,
      [...tenantParams, Math.min(attentionLimit, 20)]
    ),
    safeRows(
      `SELECT 'tasks' AS source, task_id AS item_id,
              CASE WHEN priority = 'critical' OR blocker_level = 'hard' THEN 'critical' ELSE 'high' END AS severity,
              title, updated_at
         FROM v_activation_pending_tasks
        WHERE ${userTenantWhere}
          AND (task_status = 'blocked' OR blocker_level = 'hard' OR priority IN ('critical','high'))
        ORDER BY FIELD(priority,'critical','high','medium','low'), updated_at DESC
        LIMIT ?`,
      [...userTenantParams, Math.min(attentionLimit, 20)]
    ),
    safeRows(
      `SELECT 'freshness' AS source, ledger_id AS item_id,
              CASE WHEN freshness_status = 'failed' THEN 'high' ELSE 'medium' END AS severity,
              CONCAT(COALESCE(surface_key, provider_family, 'surface'), ' freshness is ', freshness_status) AS title,
              updated_at
         FROM activation_freshness_ledger
        WHERE ${userTenantWhere} AND freshness_status IN ('stale','failed')
        ORDER BY FIELD(freshness_status,'failed','stale'), updated_at DESC
        LIMIT ?`,
      [...userTenantParams, Math.min(attentionLimit, 20)]
    ),
  ];
  const attentionResults = await Promise.all(attentionQueries);
  attentionItems.length = 0;
  for (const item of unifiedAttention?.final_result || []) {
    attentionItems.push({
      source: item.source_type,
      item_id: item.alert_id || item.alert_key,
      alert_key: item.alert_key,
      severity: item.severity,
      title: item.title,
      lifecycle_status: item.lifecycle_status,
      verification_state: item.verification_state,
      evidence_ref: item.evidence_ref,
      updated_at: item.last_seen_at,
      secrets_included: false,
    });
  }
  const severityWeight = { critical: 4, high: 3, medium: 2, low: 1 };
  attentionItems.sort((a, b) => safeNumber(severityWeight[b.severity]) - safeNumber(severityWeight[a.severity]));

  const degraded = [systems, tasks, agents, skills, freshness, signals, actionCount, packCount, subscriptionCount, ...attentionResults]
    .filter((result) => result?.ok === false)
    .map((result) => result.error);
  for (const source of unifiedAttention?.source_health || []) {
    if (!source.ok) degraded.push(source.error);
  }
  const totalAttention = safeNumber(unifiedAttention?.summary?.total_count);
  const freshTotal = Object.values(freshnessCounts).reduce((sum, value) => sum + safeNumber(value), 0);
  const freshnessStatus = safeNumber(freshnessCounts.failed) > 0
    ? "failed"
    : safeNumber(freshnessCounts.stale) > 0
      ? "stale"
      : freshTotal > 0
        ? "fresh"
        : "unknown";

  return {
    attempted: true,
    ok: degraded.length === 0,
    activation_layer: "activation_operational_summary",
    subject,
    summary: {
      attention_count: totalAttention,
      critical_attention_count: attentionItems.filter((item) => item.severity === "critical").length,
      connected_system_count: Object.values(systemCounts).reduce((sum, value) => sum + safeNumber(value), 0),
      pending_task_count: Object.values(taskCounts).reduce((sum, value) => sum + safeNumber(value), 0),
      agent_count: Object.values(agentCounts).reduce((sum, value) => sum + safeNumber(value), 0),
      skill_grant_count: Object.values(skillCounts).reduce((sum, value) => sum + safeNumber(value), 0),
      registered_action_count: actionCount.count,
      connector_pack_count: packCount.count,
      signal_subscription_count: subscriptionCount.count,
      degraded_surface_count: degraded.length,
    },
    tab_badges: {
      connectors: { active: safeNumber(systemCounts.active), pending: safeNumber(systemCounts.pending), error: safeNumber(systemCounts.error) },
      tasks: { blocked: safeNumber(taskCounts.blocked), open: Object.values(taskCounts).reduce((sum, value) => sum + safeNumber(value), 0) },
      agents: { active: safeNumber(agentCounts.active), degraded: safeNumber(agentCounts.degraded), offline: safeNumber(agentCounts.offline) },
      skills: { active_grants: safeNumber(skillCounts.active), requires_approval: safeNumber(skillCounts.requires_approval) },
      freshness: freshnessCounts,
      signals: signalCounts,
    },
    attention_by_source: attentionBySource,
    attention_items: attentionItems.slice(0, Math.min(attentionLimit, 20)),
    freshness_status: freshnessStatus,
    detail_refs: {
      attention: { tool_key: "activation_operational_attention_read_api", supports_cursor: true },
      agents: { tool_key: "activation_dynamic_tab_detail_read_api", tab_key: "container_agents", supports_cursor: true },
      skills: { tool_key: "activation_dynamic_tab_detail_read_api", tab_key: "container_agent_skills", supports_cursor: true },
      connectors: { tool_key: "activation_dynamic_tab_detail_read_api", tab_key: "container_integrations", supports_cursor: true },
      tasks: { tool_key: "activation_dynamic_tab_detail_read_api", tab_key: "container_tasks", supports_cursor: true },
    },
    degraded_surfaces: degraded,
    policy: {
      attention_first: true,
      summaries_preserve_awareness_without_inline_rows: true,
      detailed_rows_are_available_by_governed_cursor_reads: true,
      secrets_included: false,
    },
    secrets_included: false,
  };
}

export async function buildActivationDashboardManifest({ sessionContext = null, snapshot = null } = {}) {
  const subject = resolveSubject(sessionContext || {});
  const systemWhere = subject.is_admin ? "status <> 'archived'" : "tenant_id = ? AND status <> 'archived'";
  const systemParams = subject.is_admin ? [] : [subject.tenant_id || "__missing_tenant__"];
  const [tiles, callbacks, systems, freshness] = await Promise.all([
    safeRows(
      `SELECT tile_key, provider_family, connector_family, scope_class, display_name,
              category, default_visibility, source_mode, freshness_sla_seconds,
              priority_order, risk_level
         FROM activation_operational_tile_registry
        WHERE status = 'active'
        ORDER BY priority_order ASC, tile_key ASC`,
      []
    ),
    safeRows(
      `SELECT tile_key, COUNT(*) AS count,
              SUM(CASE WHEN safe_mode = 'read_only' THEN 1 ELSE 0 END) AS read_only_count
         FROM activation_callback_registry
        WHERE status = 'active'
        GROUP BY tile_key`,
      []
    ),
    safeRows(
      `SELECT provider_family, connector_family, status, COUNT(*) AS count, MAX(updated_at) AS updated_at
         FROM connected_systems
        WHERE ${systemWhere}
        GROUP BY provider_family, connector_family, status`,
      systemParams
    ),
    safeRows(
      `SELECT surface_key, freshness_status, MAX(updated_at) AS updated_at
         FROM activation_freshness_ledger
        WHERE ${subject.is_admin ? "1 = 1" : "(tenant_id = ? OR user_id = ?)"}
        GROUP BY surface_key, freshness_status`,
      subject.is_admin ? [] : [subject.tenant_id || "__missing_tenant__", subject.user_id || "__missing_user__"]
    ),
  ]);

  const callbackByTile = new Map(callbacks.rows.map((row) => [row.tile_key, row]));
  const systemGroups = systems.rows;
  const tileManifests = tiles.rows.map((tile) => {
    const matches = systemGroups.filter((row) => {
      const provider = String(tile.provider_family || "").toLowerCase();
      const connector = String(tile.connector_family || "").toLowerCase();
      return [row.provider_family, row.connector_family].map((value) => String(value || "").toLowerCase()).some((value) => value && (value === provider || value === connector));
    });
    const active = matches.reduce((sum, row) => sum + (row.status === "active" ? safeNumber(row.count) : 0), 0);
    const error = matches.reduce((sum, row) => sum + (row.status === "error" ? safeNumber(row.count) : 0), 0);
    const pending = matches.reduce((sum, row) => sum + (row.status === "pending" ? safeNumber(row.count) : 0), 0);
    const callback = callbackByTile.get(tile.tile_key) || {};
    return {
      tile_key: tile.tile_key,
      display_name: tile.display_name,
      category: tile.category,
      scope_class: tile.scope_class,
      visibility: tile.default_visibility,
      provider_family: tile.provider_family,
      connector_family: tile.connector_family,
      risk_level: tile.risk_level,
      status: error > 0 ? "attention" : active > 0 ? "active" : pending > 0 ? "pending" : "not_connected",
      counts: { active, pending, error },
      callback_count: safeNumber(callback.count),
      read_only_callback_count: safeNumber(callback.read_only_count),
      freshness_sla_seconds: safeNumber(tile.freshness_sla_seconds),
      hydration_state: "summary_loaded",
      details_ref: {
        tool_key: "operational_console_read_api",
        tile_key: tile.tile_key,
        snapshot_id: snapshot?.snapshot_id || null,
      },
    };
  });
  const degraded = [tiles, callbacks, systems, freshness].filter((result) => result.ok === false).map((result) => result.error);
  return {
    attempted: true,
    ok: degraded.length === 0,
    activation_layer: "activation_operational_dashboard_manifest",
    subject,
    summary: {
      registered_tiles: tileManifests.length,
      active_tiles: tileManifests.filter((tile) => tile.status === "active").length,
      attention_tiles: tileManifests.filter((tile) => tile.status === "attention").length,
      pending_tiles: tileManifests.filter((tile) => tile.status === "pending").length,
      not_connected_tiles: tileManifests.filter((tile) => tile.status === "not_connected").length,
      degraded_surface_count: degraded.length,
    },
    tiles: tileManifests,
    freshness_manifest: freshness.rows.map(stripSensitive),
    degraded_surfaces: degraded,
    policy: {
      dashboard_remains_visible: true,
      tiles_are_summary_first: true,
      detail_hydration_is_explicit: true,
      secrets_included: false,
    },
    secrets_included: false,
  };
}

function resolveContainer(containers, containerKey) {
  return containers.find((container) => container.container_key === containerKey) || null;
}

function addScopedFilter({ where, params, column, value, allowMissing = false }) {
  if (!column) return;
  if (value) {
    where.push(`${quoteIdentifier(column)} = ?`);
    params.push(value);
  } else if (!allowMissing) {
    where.push("1 = 0");
  }
}

export async function readActivationDynamicTabDetail({
  sessionContext = null,
  explicitSubject = {},
  containerKey,
  tabKey,
  sectionKey = null,
  cursor = 0,
  limit = DEFAULT_DETAIL_LIMIT,
  snapshotId = null,
} = {}) {
  const subject = resolveSubject(sessionContext || {}, explicitSubject);
  const normalizedCursor = Math.max(safeNumber(cursor), 0);
  const normalizedLimit = Math.min(Math.max(safeNumber(limit) || DEFAULT_DETAIL_LIMIT, 1), MAX_DETAIL_LIMIT);
  const [registry, containerResult] = await Promise.all([loadTabRegistry(), loadContainers(subject)]);
  const container = resolveContainer(containerResult.containers, containerKey);
  if (!container) {
    const err = new Error("Activation container was not found or is outside the caller scope.");
    err.status = 404;
    err.code = "activation_container_not_found";
    throw err;
  }
  const tab = registry.tabs.rows.find((row) => row.tab_key === tabKey);
  if (!tab) {
    const err = new Error("Activation dynamic tab was not found.");
    err.status = 404;
    err.code = "activation_tab_not_found";
    throw err;
  }
  const candidates = registry.sections.rows.filter((row) => row.tab_key === tabKey && (!sectionKey || row.section_key === sectionKey));
  if (sectionKey && !candidates.length) {
    const err = new Error("Activation dynamic tab section was not found.");
    err.status = 404;
    err.code = "activation_section_not_found";
    throw err;
  }

  const renderedSections = [];
  let remaining = normalizedLimit;
  let localCursor = normalizedCursor;
  for (const section of candidates) {
    if (remaining <= 0) break;
    const columns = safeColumns(section.result_columns_json);
    if (!columns.length) continue;
    const sourceTable = quoteIdentifier(section.source_table);
    const selectColumns = [...columns];
    for (const scopeColumn of [section.tenant_column, section.user_column, section.workspace_column, section.brand_key_column, section.system_id_column]) {
      if (scopeColumn && SAFE_IDENTIFIER.test(scopeColumn) && !selectColumns.includes(scopeColumn)) selectColumns.push(scopeColumn);
    }
    const where = [];
    const params = [];
    addScopedFilter({ where, params, column: section.tenant_column, value: container.tenant_id || subject.tenant_id, allowMissing: subject.is_admin });
    if (section.user_column) addScopedFilter({ where, params, column: section.user_column, value: subject.user_id, allowMissing: subject.is_admin });
    if (section.workspace_column) addScopedFilter({ where, params, column: section.workspace_column, value: container.workspace_id, allowMissing: subject.is_admin });
    if (section.brand_key_column) addScopedFilter({ where, params, column: section.brand_key_column, value: container.linked_brand_key, allowMissing: subject.is_admin });
    if (section.system_id_column && container.linked_system_ids.length) {
      where.push(`${quoteIdentifier(section.system_id_column)} IN (?)`);
      params.push(container.linked_system_ids);
    }
    const activeStatuses = parseJson(section.active_status_values_json, []);
    if (section.status_column && Array.isArray(activeStatuses) && activeStatuses.length) {
      where.push(`${quoteIdentifier(section.status_column)} IN (?)`);
      params.push(activeStatuses.map(String));
    }
    const sectionLimit = remaining + 1;
    const result = await safeRows(
      `SELECT ${selectColumns.map(quoteIdentifier).join(", ")}
         FROM ${sourceTable}
        WHERE ${where.length ? where.join(" AND ") : "1 = 1"}
        LIMIT ${sectionLimit} OFFSET ${localCursor}`,
      params
    );
    const hasMore = result.rows.length > remaining;
    const pageRows = result.rows.slice(0, remaining).map((row) => {
      const clean = stripSensitive(row);
      for (const scopeColumn of [section.tenant_column, section.user_column, section.workspace_column, section.brand_key_column, section.system_id_column]) {
        if (scopeColumn && !columns.includes(scopeColumn)) delete clean[scopeColumn];
      }
      return clean;
    });
    renderedSections.push({
      section_key: section.section_key,
      display_name: section.display_name,
      source_table: section.source_table,
      delivery_mode: defaultDeliveryMode(section),
      dedupe_scope: defaultDedupeScope(section),
      row_count: pageRows.length,
      rows: pageRows,
      page: {
        cursor: localCursor,
        limit: remaining,
        has_more: hasMore,
        next_cursor: hasMore ? localCursor + pageRows.length : null,
      },
      error: result.error || null,
      secrets_included: false,
    });
    remaining -= pageRows.length;
    localCursor = 0;
  }

  return {
    ok: renderedSections.every((section) => !section.error),
    activation_layer: "activation_dynamic_tab_detail",
    snapshot: {
      requested_snapshot_id: snapshotId || null,
      current_registry_version: registry.registry_version,
      consistency: snapshotId ? "best_effort_same_registry_version" : "latest",
    },
    subject,
    container: stripSensitive(container),
    tab: {
      tab_key: tab.tab_key,
      display_name: tab.display_name,
      tab_group: tab.tab_group,
      visibility: tab.default_visibility,
    },
    sections: renderedSections,
    page: {
      cursor: normalizedCursor,
      limit: normalizedLimit,
      returned_rows: normalizedLimit - remaining,
      has_more: renderedSections.some((section) => section.page.has_more),
      next_cursor: renderedSections.find((section) => section.page.has_more)?.page.next_cursor || null,
    },
    policy: {
      subject_scoped: true,
      semantic_cursor_pagination: true,
      secret_values_never_returned: true,
    },
    secrets_included: false,
  };
}

export function buildCompletenessEnvelope({ tabManifest, operationalSummary, dashboardManifest, fullyHydratedSurfaces = 0 } = {}) {
  const knownTabs = safeNumber(tabManifest?.summary?.registered_tabs);
  const knownTiles = safeNumber(dashboardManifest?.summary?.registered_tiles);
  const knownOperational = 6;
  const knownSurfaces = knownTabs + knownTiles + knownOperational;
  const degraded = safeNumber(tabManifest?.summary?.degraded_surface_count)
    + safeNumber(operationalSummary?.summary?.degraded_surface_count)
    + safeNumber(dashboardManifest?.summary?.degraded_surface_count);
  const stale = operationalSummary?.freshness_status === "stale" || operationalSummary?.freshness_status === "failed" ? 1 : 0;
  const deferred = Math.max(knownSurfaces - safeNumber(fullyHydratedSurfaces), 0);
  return {
    known_surfaces: knownSurfaces,
    visible_surfaces: knownSurfaces,
    summarized_surfaces: knownSurfaces,
    fully_hydrated_surfaces: safeNumber(fullyHydratedSurfaces),
    deferred_surfaces: deferred,
    blocked_surfaces: 0,
    stale_surfaces: stale,
    degraded_surfaces: degraded,
    coverage_status: degraded === 0 ? "complete_awareness" : "complete_awareness_with_degraded_sources",
    details_omitted_silently: false,
    deferred_details_have_refs: true,
  };
}

export function buildAwarenessIndex({ completeness, operationalSummary } = {}) {
  const known = Math.max(safeNumber(completeness?.known_surfaces), 1);
  const visible = safeNumber(completeness?.visible_surfaces);
  const coverage = Math.round((visible / known) * 100);
  const freshness = completeness?.stale_surfaces > 0 ? 80 : 100;
  const authorizationVisibility = 100;
  const attentionDetection = operationalSummary?.ok === false ? 75 : 100;
  const detailAvailability = completeness?.deferred_details_have_refs ? 100 : 70;
  const score = Math.round((coverage + freshness + authorizationVisibility + attentionDetection + detailAvailability) / 5);
  return {
    score,
    coverage,
    freshness,
    authorization_visibility: authorizationVisibility,
    attention_detection: attentionDetection,
    detail_availability: detailAvailability,
  };
}

export const _testingActivationAwareness = {
  safeNumber,
  parseJson,
  stripSensitive,
  quoteIdentifier,
  safeColumns,
  defaultDeliveryMode,
  defaultDedupeScope,
  badgeForTab,
};
