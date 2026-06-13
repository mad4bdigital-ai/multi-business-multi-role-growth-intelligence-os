import { getPool } from "./db.js";

const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const BLOCKED_COLUMN_PATTERN = /(secret|credential_ref|credential|token|password|private_key|cipher|api_key|value_ciphertext|value_sha|config_json|system_prompt)/i;
const PLATFORM_BRAND_KEY = "growth_intelligence_platform";

function compactError(err) {
  return { code: err.code || "activation_dynamic_tabs_failed", message: err.message };
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

function splitRefs(value = "") {
  return String(value || "")
    .split(/[|,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function sanitizeKey(value) {
  const text = String(value || "surface")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return text || "surface";
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function likeToRegExp(pattern) {
  const text = String(pattern || "");
  let body = "";
  for (const char of text) {
    if (char === "%") body += ".*";
    else if (char === "_") body += ".";
    else body += escapeRegExp(char);
  }
  return new RegExp(`^${body}$`, "i");
}

function matchesLike(value, pattern) {
  if (!pattern) return false;
  return likeToRegExp(pattern).test(String(value || ""));
}

async function safeRows(sql, params = []) {
  try {
    const [rows] = await getPool().query(sql, params);
    return { ok: true, rows: Array.isArray(rows) ? rows : [] };
  } catch (err) {
    return { ok: false, rows: [], error: compactError(err) };
  }
}

function quoteIdentifier(value) {
  const text = String(value || "").trim();
  if (!SAFE_IDENTIFIER.test(text)) {
    const err = new Error(`Unsafe activation dynamic tabs identifier: ${text}`);
    err.code = "unsafe_activation_dynamic_tabs_identifier";
    throw err;
  }
  return `\`${text}\``;
}

function safeColumns(value) {
  const columns = Array.isArray(value) ? value : parseJsonValue(value, []);
  return (Array.isArray(columns) ? columns : [])
    .map((column) => String(column || "").trim())
    .filter((column) => SAFE_IDENTIFIER.test(column))
    .filter((column) => !BLOCKED_COLUMN_PATTERN.test(column))
    .slice(0, 40);
}

function stripSensitiveFields(row = {}) {
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => !BLOCKED_COLUMN_PATTERN.test(key))
  );
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

async function loadWorkspaceContainers(subject) {
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

  const linkedBrandKeys = [...new Set(workspaces.rows.map((row) => row.linked_brand_key).filter(Boolean))];
  const brands = linkedBrandKeys.length || subject.is_admin
    ? await safeRows(
        `SELECT brand_name, target_key, brand_domain, status, brand_core_ready, maturity,
                evolution_status, governance_readiness_status, runtime_scope_class,
                control_state_last_validated_at, updated_at
           FROM brands
          WHERE ${subject.is_admin ? "status IS NOT NULL" : "target_key IN (?)"}
          LIMIT 200`,
        subject.is_admin ? [] : [linkedBrandKeys.length ? linkedBrandKeys : ["__missing_brand__"]]
      )
    : { ok: true, rows: [] };

  const brandByKey = new Map(brands.rows.map((brand) => [brand.target_key, brand]));
  const containers = workspaces.rows.map((workspace) => {
    const linkedSystemIds = splitRefs(workspace.linked_system_ids);
    const brand = workspace.linked_brand_key ? brandByKey.get(workspace.linked_brand_key) || null : null;
    return {
      container_key: `workspace:${workspace.workspace_id}`,
      container_type: workspace.workspace_type === "brand" ? "brand_workspace" : "workspace",
      workspace_id: workspace.workspace_id,
      workspace_key: workspace.workspace_key,
      tenant_id: workspace.tenant_id,
      display_name: workspace.display_name,
      bootstrap_status: workspace.bootstrap_status,
      linked_brand_key: workspace.linked_brand_key || null,
      linked_system_ids: linkedSystemIds,
      brand: brand ? {
        brand_name: brand.brand_name,
        target_key: brand.target_key,
        brand_domain: brand.brand_domain,
        status: brand.status,
        brand_core_ready: brand.brand_core_ready,
        maturity: brand.maturity,
        evolution_status: brand.evolution_status,
        governance_readiness_status: brand.governance_readiness_status,
        runtime_scope_class: brand.runtime_scope_class,
        control_state_last_validated_at: brand.control_state_last_validated_at,
        updated_at: brand.updated_at,
      } : null,
      updated_at: workspace.updated_at,
    };
  });

  if (subject.is_admin && !containers.some((container) => container.linked_brand_key === PLATFORM_BRAND_KEY)) {
    const platformBrand = brandByKey.get(PLATFORM_BRAND_KEY);
    if (platformBrand) {
      containers.unshift({
        container_key: `brand:${PLATFORM_BRAND_KEY}`,
        container_type: "platform_owner_brand",
        workspace_id: null,
        workspace_key: null,
        tenant_id: null,
        display_name: platformBrand.brand_name || "Growth Intelligence Platform",
        bootstrap_status: "ready",
        linked_brand_key: PLATFORM_BRAND_KEY,
        linked_system_ids: [],
        brand: {
          brand_name: platformBrand.brand_name,
          target_key: platformBrand.target_key,
          brand_domain: platformBrand.brand_domain,
          status: platformBrand.status,
          brand_core_ready: platformBrand.brand_core_ready,
          maturity: platformBrand.maturity,
          evolution_status: platformBrand.evolution_status,
          governance_readiness_status: platformBrand.governance_readiness_status,
          runtime_scope_class: platformBrand.runtime_scope_class,
          control_state_last_validated_at: platformBrand.control_state_last_validated_at,
          updated_at: platformBrand.updated_at,
        },
        updated_at: platformBrand.updated_at,
      });
    }
  }

  return { workspaces, brands, containers };
}

function pickDiscoveryRule(surface, rules = []) {
  for (const rule of rules) {
    const surfaceOk = !rule.surface_key_like || matchesLike(surface.surface_key, rule.surface_key_like);
    const tableOk = !rule.source_table_like || matchesLike(surface.source_table, rule.source_table_like);
    const providerOk = !rule.provider_family_like || matchesLike(surface.provider_family || surface.connector_family || "", rule.provider_family_like);
    if (surfaceOk && tableOk && providerOk) return rule;
  }
  return null;
}

async function loadAutoDiscoveredSections(staticSections = []) {
  const existingKeys = new Set(staticSections.map((section) => section.section_key));
  const [surfaces, rules] = await Promise.all([
    safeRows(
      `SELECT surface_key, display_name, description, source_table, result_columns_json,
              tenant_column, user_column, status_column, active_status_values_json,
              max_rows, sort_order, status
         FROM activation_authorized_surface_registry
        WHERE status = 'active'
        ORDER BY sort_order ASC, surface_key ASC
        LIMIT 200`,
      []
    ),
    safeRows(
      `SELECT rule_key, target_tab_key, surface_key_like, source_table_like,
              provider_family_like, display_name, priority_order, status
         FROM activation_dynamic_tab_discovery_rule_registry
        WHERE status = 'active'
        ORDER BY priority_order ASC, rule_key ASC`,
      []
    ),
  ]);

  if (!surfaces.ok || !rules.ok) {
    return { ok: surfaces.ok && rules.ok, rows: [], surfaces, rules, error: surfaces.error || rules.error || null };
  }

  const discovered = [];
  for (const surface of surfaces.rows) {
    const sectionKey = `auto_${sanitizeKey(surface.surface_key)}`;
    if (existingKeys.has(sectionKey)) continue;
    const columns = safeColumns(surface.result_columns_json);
    if (!columns.length) continue;
    const rule = pickDiscoveryRule(surface, rules.rows);
    discovered.push({
      section_key: sectionKey,
      tab_key: rule?.target_tab_key || "container_auto_discovered_surfaces",
      display_name: surface.display_name || surface.surface_key,
      description: surface.description || "Auto-discovered activation surface.",
      source_table: surface.source_table,
      result_columns_json: surface.result_columns_json,
      tenant_column: surface.tenant_column || null,
      user_column: surface.user_column || null,
      workspace_column: null,
      brand_key_column: null,
      system_id_column: null,
      status_column: surface.status_column || null,
      active_status_values_json: surface.active_status_values_json || null,
      row_limit: Math.min(Math.max(safeNumber(surface.max_rows) || 10, 1), 50),
      aggregation_mode: "rows",
      priority_order: 500 + safeNumber(surface.sort_order),
      status: "active",
      auto_discovered: true,
      discovery_rule_key: rule?.rule_key || null,
    });
  }

  return { ok: true, rows: discovered, surfaces, rules };
}

async function loadTabRegistry() {
  const tabs = await safeRows(
    `SELECT tab_key, display_name, description, tab_group, container_scope,
            default_visibility, priority_order, status
       FROM activation_dynamic_tab_registry
      WHERE status = 'active'
      ORDER BY priority_order ASC, tab_key ASC`,
    []
  );
  const staticSections = await safeRows(
    `SELECT section_key, tab_key, display_name, description, source_table,
            result_columns_json, tenant_column, user_column, workspace_column, brand_key_column,
            system_id_column, status_column, active_status_values_json, row_limit,
            aggregation_mode, priority_order, status
       FROM activation_dynamic_tab_section_registry
      WHERE status = 'active'
      ORDER BY priority_order ASC, section_key ASC`,
    []
  );
  const discovery = staticSections.ok
    ? await loadAutoDiscoveredSections(staticSections.rows)
    : { ok: false, rows: [], error: staticSections.error };

  return {
    tabs,
    sections: {
      ok: staticSections.ok && discovery.ok,
      rows: [...staticSections.rows, ...discovery.rows].sort(
        (a, b) => safeNumber(a.priority_order) - safeNumber(b.priority_order) ||
          String(a.section_key).localeCompare(String(b.section_key))
      ),
      static_count: staticSections.rows.length,
      auto_discovered_count: discovery.rows.length,
      error: staticSections.error || discovery.error || null,
      discovery,
    },
  };
}

function addScopedFilter({ where, params, column, value, adminOptional = false }) {
  if (!column) return;
  if (value) {
    where.push(`${quoteIdentifier(column)} = ?`);
    params.push(value);
  } else if (!adminOptional) {
    where.push("1 = 0");
  }
}

function addInFilter({ where, params, column, values }) {
  if (!column || !Array.isArray(values) || values.length === 0) return;
  where.push(`${quoteIdentifier(column)} IN (?)`);
  params.push(values);
}

async function loadSectionRows(section, container, subject) {
  const columns = safeColumns(section.result_columns_json);
  if (!columns.length) {
    return {
      ok: false,
      section_key: section.section_key,
      rows: [],
      row_count: 0,
      error: { code: "no_safe_dynamic_tab_columns", message: "No safe result columns registered for dynamic tab section." },
    };
  }

  const where = [];
  const params = [];
  const sourceTable = quoteIdentifier(section.source_table);
  const selectSql = columns.map(quoteIdentifier).join(", ");

  if (section.tenant_column) {
    addScopedFilter({ where, params, column: section.tenant_column, value: container.tenant_id || subject.tenant_id, adminOptional: subject.is_admin });
  }
  if (section.user_column && !subject.is_admin) {
    addScopedFilter({ where, params, column: section.user_column, value: subject.user_id, adminOptional: false });
  } else if (section.user_column && subject.user_id) {
    addScopedFilter({ where, params, column: section.user_column, value: subject.user_id, adminOptional: true });
  }
  if (section.workspace_column && container.workspace_id) {
    addScopedFilter({ where, params, column: section.workspace_column, value: container.workspace_id, adminOptional: true });
  }
  if (section.brand_key_column && container.linked_brand_key) {
    addScopedFilter({ where, params, column: section.brand_key_column, value: container.linked_brand_key, adminOptional: true });
  } else if (section.brand_key_column && !subject.is_admin) {
    where.push("1 = 0");
  }
  if (section.system_id_column && container.linked_system_ids.length > 0) {
    addInFilter({ where, params, column: section.system_id_column, values: container.linked_system_ids });
  }
  if (section.status_column) {
    const activeValues = parseJsonValue(section.active_status_values_json, []);
    if (Array.isArray(activeValues) && activeValues.length) {
      addInFilter({ where, params, column: section.status_column, values: activeValues.map(String) });
    }
  }

  const rowLimit = Math.min(Math.max(safeNumber(section.row_limit) || 25, 1), 100);
  const result = await safeRows(
    `SELECT ${selectSql}
       FROM ${sourceTable}
      WHERE ${where.length ? where.join(" AND ") : "1 = 1"}
      LIMIT ${rowLimit}`,
    params
  );

  return {
    ok: result.ok,
    section_key: section.section_key,
    display_name: section.display_name,
    source_table: section.source_table,
    aggregation_mode: section.aggregation_mode,
    auto_discovered: section.auto_discovered === true,
    discovery_rule_key: section.discovery_rule_key || null,
    row_count: result.rows.length,
    rows: result.rows.map(stripSensitiveFields),
    error: result.error || null,
    secrets_included: false,
  };
}

function rowMatchesContainer(row, section, container, subject) {
  if (section.tenant_column) {
    const expected = container.tenant_id || subject.tenant_id;
    if (!expected || String(row[section.tenant_column] || "") !== String(expected)) return false;
  }
  if (section.user_column) {
    if (!subject.user_id || String(row[section.user_column] || "") !== String(subject.user_id)) return false;
  }
  if (section.workspace_column) {
    if (!container.workspace_id || String(row[section.workspace_column] || "") !== String(container.workspace_id)) return false;
  }
  if (section.brand_key_column) {
    if (!container.linked_brand_key || String(row[section.brand_key_column] || "") !== String(container.linked_brand_key)) return false;
  }
  if (section.system_id_column) {
    if (!container.linked_system_ids.length || !container.linked_system_ids.map(String).includes(String(row[section.system_id_column] || ""))) return false;
  }
  return true;
}

async function loadSectionRowsBatch(section, containers, subject) {
  const columns = safeColumns(section.result_columns_json);
  const resultByContainer = new Map();
  if (!columns.length) {
    const error = { code: "no_safe_dynamic_tab_columns", message: "No safe result columns registered for dynamic tab section." };
    for (const container of containers) {
      resultByContainer.set(container.container_key, {
        ok: false,
        section_key: section.section_key,
        rows: [],
        row_count: 0,
        error,
      });
    }
    return { section_key: section.section_key, result_by_container: resultByContainer, query_count: 0 };
  }

  const scopeColumns = [
    section.tenant_column,
    section.user_column,
    section.workspace_column,
    section.brand_key_column,
    section.system_id_column,
  ].filter(Boolean);
  const selectColumns = [...new Set([...columns, ...scopeColumns])];
  const where = [];
  const params = [];

  const tenantValues = [...new Set(containers.map((container) => container.tenant_id || subject.tenant_id).filter(Boolean))];
  const workspaceValues = [...new Set(containers.map((container) => container.workspace_id).filter(Boolean))];
  const brandValues = [...new Set(containers.map((container) => container.linked_brand_key).filter(Boolean))];
  const systemValues = [...new Set(containers.flatMap((container) => container.linked_system_ids || []).filter(Boolean))];

  if (section.tenant_column) {
    if (tenantValues.length) addInFilter({ where, params, column: section.tenant_column, values: tenantValues });
    else if (!subject.is_admin) where.push("1 = 0");
  }
  if (section.user_column) {
    if (subject.user_id) addScopedFilter({ where, params, column: section.user_column, value: subject.user_id, adminOptional: subject.is_admin });
    else where.push("1 = 0");
  }
  if (section.workspace_column) {
    if (workspaceValues.length) addInFilter({ where, params, column: section.workspace_column, values: workspaceValues });
    else where.push("1 = 0");
  }
  if (section.brand_key_column) {
    if (brandValues.length) addInFilter({ where, params, column: section.brand_key_column, values: brandValues });
    else where.push("1 = 0");
  }
  if (section.system_id_column) {
    if (systemValues.length) addInFilter({ where, params, column: section.system_id_column, values: systemValues });
    else where.push("1 = 0");
  }
  if (section.status_column) {
    const activeValues = parseJsonValue(section.active_status_values_json, []);
    if (Array.isArray(activeValues) && activeValues.length) {
      addInFilter({ where, params, column: section.status_column, values: activeValues.map(String) });
    }
  }

  const rowLimit = Math.min(Math.max(safeNumber(section.row_limit) || 25, 1), 100);
  const batchLimit = Math.min(Math.max(rowLimit * Math.max(containers.length, 1), rowLimit), 5000);
  const result = await safeRows(
    `SELECT ${selectColumns.map(quoteIdentifier).join(", ")}
       FROM ${quoteIdentifier(section.source_table)}
      WHERE ${where.length ? where.join(" AND ") : "1 = 1"}
      LIMIT ${batchLimit}`,
    params
  );

  for (const container of containers) {
    const matchedRows = result.ok
      ? result.rows.filter((row) => rowMatchesContainer(row, section, container, subject)).slice(0, rowLimit)
      : [];
    const safeRowsForContainer = matchedRows.map((row) => {
      const clean = stripSensitiveFields(row);
      for (const scopeColumn of scopeColumns) {
        if (!columns.includes(scopeColumn)) delete clean[scopeColumn];
      }
      return clean;
    });
    resultByContainer.set(container.container_key, {
      ok: result.ok,
      section_key: section.section_key,
      display_name: section.display_name,
      source_table: section.source_table,
      aggregation_mode: section.aggregation_mode,
      auto_discovered: section.auto_discovered === true,
      discovery_rule_key: section.discovery_rule_key || null,
      row_count: safeRowsForContainer.length,
      rows: safeRowsForContainer,
      error: result.error || null,
      secrets_included: false,
    });
  }

  return {
    section_key: section.section_key,
    result_by_container: resultByContainer,
    query_count: 1,
    source_table: section.source_table,
    batch_limit: batchLimit,
    returned_row_count: result.rows.length,
  };
}

function tabStatus(sections = []) {
  if (sections.some((section) => section.ok === false)) return "degraded";
  if (sections.some((section) => section.row_count > 0)) return "active";
  return "empty";
}

export async function buildActivationDynamicTabsEvidence({ sessionContext = null } = {}) {
  const subject = resolveSubject(sessionContext || {});
  const [{ tabs, sections }, containerResult] = await Promise.all([
    loadTabRegistry(),
    loadWorkspaceContainers(subject),
  ]);

  const degradedSurfaces = [
    ["activation_dynamic_tab_registry", tabs],
    ["activation_dynamic_tab_section_registry", sections],
    ["activation_dynamic_tab_discovery_rule_registry", sections.discovery?.rules],
    ["activation_authorized_surface_registry", sections.discovery?.surfaces],
    ["workspace_registry", containerResult.workspaces],
    ["brands", containerResult.brands],
  ]
    .filter(([, result]) => result?.ok === false)
    .map(([surface, result]) => ({ surface, error: result.error }));

  const sectionsByTab = new Map();
  for (const section of sections.rows) {
    const list = sectionsByTab.get(section.tab_key) || [];
    list.push(section);
    sectionsByTab.set(section.tab_key, list);
  }

  const sectionBatches = await Promise.all(
    sections.rows.map((section) => loadSectionRowsBatch(section, containerResult.containers, subject))
  );
  const batchBySection = new Map(sectionBatches.map((batch) => [batch.section_key, batch]));
  const containers = [];
  for (const container of containerResult.containers) {
    const renderedTabs = [];
    for (const tab of tabs.rows) {
      const registeredSections = sectionsByTab.get(tab.tab_key) || [];
      const renderedSections = registeredSections.map((section) => {
        const batch = batchBySection.get(section.section_key);
        return batch?.result_by_container?.get(container.container_key) || {
          ok: false,
          section_key: section.section_key,
          display_name: section.display_name,
          source_table: section.source_table,
          aggregation_mode: section.aggregation_mode,
          row_count: 0,
          rows: [],
          error: { code: "dynamic_tab_batch_result_missing", message: "Batched section evidence was not available." },
          secrets_included: false,
        };
      });
      for (const sectionEvidence of renderedSections) {
        if (sectionEvidence.ok === false) {
          degradedSurfaces.push({
            surface: `dynamic_tab:${tab.tab_key}:${sectionEvidence.section_key}`,
            error: sectionEvidence.error,
          });
        }
      }
      renderedTabs.push({
        tab_key: tab.tab_key,
        display_name: tab.display_name,
        tab_group: tab.tab_group,
        visibility: tab.default_visibility,
        status: tabStatus(renderedSections),
        section_count: renderedSections.length,
        auto_discovered_section_count: renderedSections.filter((section) => section.auto_discovered === true).length,
        row_count: renderedSections.reduce((sum, section) => sum + safeNumber(section.row_count), 0),
        sections: renderedSections,
      });
    }
    containers.push({
      ...container,
      tab_count: renderedTabs.length,
      active_tab_count: renderedTabs.filter((tab) => tab.status === "active").length,
      degraded_tab_count: renderedTabs.filter((tab) => tab.status === "degraded").length,
      empty_tab_count: renderedTabs.filter((tab) => tab.status === "empty").length,
      tabs: renderedTabs,
    });
  }

  return {
    attempted: true,
    ok: degradedSurfaces.length === 0,
    activation_layer: "activation_dynamic_tabs",
    awareness_mode: "workspace_brand_container_tabs",
    source_authority: "sql_runtime_dynamic_tab_registry_authorized_surface_discovery_and_subject_scoped_containers",
    subject: {
      is_admin: subject.is_admin,
      tenant_id: subject.tenant_id,
      user_id: subject.user_id,
      auth_mode: subject.auth_mode,
    },
    summary: {
      container_count: containers.length,
      registered_tabs: tabs.rows.length,
      registered_sections: sections.static_count || 0,
      auto_discovered_sections: sections.auto_discovered_count || 0,
      total_sections: sections.rows.length,
      active_containers: containers.filter((container) => container.active_tab_count > 0).length,
      degraded_surface_count: degradedSurfaces.length,
    },
    containers,
    discovery: {
      enabled: true,
      source_registry: "activation_authorized_surface_registry",
      rule_registry: "activation_dynamic_tab_discovery_rule_registry",
      rules_loaded: sections.discovery?.rules?.rows?.length || 0,
      discovered_sections: sections.auto_discovered_count || 0,
      fallback_tab_key: "container_auto_discovered_surfaces",
    },
    degraded_surfaces: degradedSurfaces,
    policy: {
      each_workspace_or_brand_is_a_container: true,
      tabs_are_registry_driven: true,
      authorized_surfaces_auto_discover_into_tabs: true,
      visible_rows_are_subject_scoped: true,
      do_not_return_secret_values: true,
      secrets_included: false,
    },
    secrets_included: false,
  };
}
