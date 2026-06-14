function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compactError(err) {
  if (!err) return null;
  return {
    code: err.code || "activation_evidence_error",
    message: err.message || String(err),
  };
}

export function activationResponseByteLength(value) {
  return Buffer.byteLength(JSON.stringify(value ?? {}), "utf8");
}

export function compactActivationEvidenceLayer(layer = {}) {
  return {
    ok: layer?.ok === true,
    status: layer?.status || layer?.classification || layer?.activation_status || null,
    reason_code: layer?.reason_code || layer?.error?.code || null,
    error: compactError(layer?.error),
  };
}

export function compactActivationEvidenceMatrix(matrix = {}) {
  return Object.fromEntries(
    Object.entries(matrix || {}).map(([key, value]) => [key, compactActivationEvidenceLayer(value || {})])
  );
}

export function projectActivationProviderBootstrap(providerBootstrap = {}) {
  return {
    ok: providerBootstrap?.ok === true,
    activation_layer: providerBootstrap?.activation_layer || null,
    status: providerBootstrap?.status || providerBootstrap?.activation_status || null,
    classification: providerBootstrap?.classification || null,
    registry_source: providerBootstrap?.registry_source || providerBootstrap?.source || null,
    counts: providerBootstrap?.counts || {},
    readiness: providerBootstrap?.readiness || {},
    degraded_surface_count: Array.isArray(providerBootstrap?.degraded_surfaces)
      ? providerBootstrap.degraded_surfaces.length
      : safeNumber(providerBootstrap?.degraded_surface_count),
    error: compactError(providerBootstrap?.error),
    evidence_ref: "provider_bootstrap_evidence",
    secrets_included: false,
  };
}

export function compactActivationTabManifest(tabManifest = {}, { includeMembership = true } = {}) {
  const tabCatalog = new Map();
  const containers = [];
  for (const container of tabManifest?.containers || []) {
    const tabKeys = [];
    const attentionTabKeys = [];
    for (const tab of container?.tabs || []) {
      const tabKey = tab?.tab_key || null;
      if (tabKey) tabKeys.push(tabKey);
      const attentionCount = safeNumber(
        tab?.attention_count ?? tab?.badge?.attention_count ?? tab?.counts?.attention ?? tab?.counts?.error
      );
      const attentionStatus = ["attention", "degraded", "error", "blocked"].includes(
        String(tab?.status || "").toLowerCase()
      );
      if (tabKey && (attentionCount > 0 || attentionStatus)) attentionTabKeys.push(tabKey);
      if (tabKey && !tabCatalog.has(tabKey)) {
        tabCatalog.set(tabKey, {
          tab_key: tabKey,
          display_name: tab?.display_name || tab?.label || null,
          tab_group: tab?.tab_group || tab?.group || null,
          visibility: tab?.visibility || null,
          section_count: Array.isArray(tab?.sections) ? tab.sections.length : safeNumber(tab?.section_count),
          supports_cursor: tab?.supports_cursor !== false,
        });
      }
    }
    const row = {
      container_key: container?.container_key || null,
      container_type: container?.container_type || null,
      display_name: container?.display_name || container?.workspace_name || null,
      workspace_key: container?.workspace_key || null,
      bootstrap_status: container?.bootstrap_status || container?.status || null,
      tab_count: tabKeys.length,
      attention_tab_count: attentionTabKeys.length,
    };
    if (includeMembership) {
      row.tab_keys = tabKeys;
      row.attention_tab_keys = attentionTabKeys;
    }
    containers.push(row);
  }

  return {
    ok: tabManifest?.ok !== false,
    activation_layer: tabManifest?.activation_layer || null,
    snapshot_id: tabManifest?.snapshot_id || null,
    registry_version: tabManifest?.registry_version || null,
    generated_at: tabManifest?.generated_at || null,
    subject: tabManifest?.subject || null,
    summary: tabManifest?.summary || {},
    container_count: containers.length,
    containers,
    tab_catalog: [...tabCatalog.values()],
    shared_surfaces: (tabManifest?.shared_surfaces || []).map((surface) => ({
      surface_ref: surface?.surface_ref || null,
      section_key: surface?.section_key || null,
      tab_key: surface?.tab_key || null,
      dedupe_scope: surface?.dedupe_scope || null,
      delivery_mode: surface?.delivery_mode || null,
      detail_tool_key: surface?.detail_tool_key || surface?.details_ref?.tool_key || null,
    })),
    details_ref_template: {
      tool_key: "activation_dynamic_tab_detail_read_api",
      required: ["container_key", "tab_key"],
      optional: ["section_key", "cursor", "limit", "snapshot_id"],
    },
    degraded_surface_count: Array.isArray(tabManifest?.degraded_surfaces)
      ? tabManifest.degraded_surfaces.length
      : 0,
    policy: tabManifest?.policy || {},
    secrets_included: false,
  };
}

export function compactActivationOperationalSummary(operationalSummary = {}) {
  return {
    ok: operationalSummary?.ok !== false,
    activation_layer: operationalSummary?.activation_layer || null,
    subject: operationalSummary?.subject || null,
    summary: operationalSummary?.summary || {},
    tab_badges: operationalSummary?.tab_badges || {},
    attention_by_source: operationalSummary?.attention_by_source || {},
    attention_items: (operationalSummary?.attention_items || []).slice(0, 5).map((item) => ({
      source: item?.source || null,
      item_id: item?.item_id || item?.id || null,
      severity: item?.severity || null,
      title: item?.title || null,
      updated_at: item?.updated_at || null,
    })),
    freshness_status: operationalSummary?.freshness_status || null,
    detail_refs: operationalSummary?.detail_refs || {},
    degraded_surface_count: Array.isArray(operationalSummary?.degraded_surfaces)
      ? operationalSummary.degraded_surfaces.length
      : safeNumber(operationalSummary?.summary?.degraded_surface_count),
    policy: operationalSummary?.policy || {},
    secrets_included: false,
  };
}

export function compactActivationDashboardManifest(dashboardManifest = {}) {
  return {
    ok: dashboardManifest?.ok !== false,
    activation_layer: dashboardManifest?.activation_layer || null,
    subject: dashboardManifest?.subject || null,
    summary: dashboardManifest?.summary || {},
    tiles: (dashboardManifest?.tiles || []).map((tile) => ({
      tile_key: tile?.tile_key || null,
      display_name: tile?.display_name || null,
      category: tile?.category || null,
      status: tile?.status || null,
      risk_level: tile?.risk_level || null,
      counts: tile?.counts || {},
      hydration_state: tile?.hydration_state || null,
    })),
    details_ref_template: {
      tool_key: "operational_console_read_api",
      required: ["tile_key"],
    },
    degraded_surface_count: Array.isArray(dashboardManifest?.degraded_surfaces)
      ? dashboardManifest.degraded_surfaces.length
      : safeNumber(dashboardManifest?.summary?.degraded_surface_count),
    policy: dashboardManifest?.policy || {},
    secrets_included: false,
  };
}

export function buildStrictActivationSummaryEnvelope(output = {}, { includeMembership = true } = {}) {
  const surfaceRefs = output?.surface_refs || [];
  return {
    ok: output?.ok,
    activation_layer: output?.activation_layer,
    activation_complete: output?.activation_complete,
    run_id: output?.run_id || null,
    session_id: output?.session_id || null,
    response_profile: output?.response_profile,
    snapshot: output?.snapshot || null,
    runtime_classification: output?.runtime_classification || {},
    state_model: output?.state_model || {},
    evidence_matrix: compactActivationEvidenceMatrix(output?.evidence_matrix || {}),
    session_context_evidence: compactActivationEvidenceLayer(output?.session_context_evidence || {}),
    provider_bootstrap_evidence: compactActivationEvidenceLayer(output?.provider_bootstrap_evidence || {}),
    session_context: output?.session_context || null,
    provider_bootstrap: projectActivationProviderBootstrap(output?.provider_bootstrap || {}),
    dynamic_tabs_manifest: compactActivationTabManifest(output?.dynamic_tabs_manifest || {}, { includeMembership }),
    operational_summary: compactActivationOperationalSummary(output?.operational_summary || {}),
    operational_dashboard_manifest: compactActivationDashboardManifest(output?.operational_dashboard_manifest || {}),
    completeness: output?.completeness || {},
    awareness_index: output?.awareness_index || {},
    surface_refs: surfaceRefs,
    degraded_surfaces: output?.degraded_surfaces || [],
    report_policy: output?.report_policy || {},
    dynamic_tabs: {
      response_mode: "manifest_ref",
      manifest_ref: "dynamic_tabs_manifest",
      details_inline: false,
      surface_ref: surfaceRefs[0] || null,
    },
    operational_intelligence: {
      response_mode: "summary_ref",
      summary_ref: "operational_summary",
      details_inline: false,
      surface_ref: surfaceRefs[1] || null,
    },
    operational_dashboard: {
      response_mode: "manifest_ref",
      manifest_ref: "operational_dashboard_manifest",
      details_inline: false,
      surface_ref: surfaceRefs[2] || null,
    },
    selected_detail: output?.selected_detail?.deferred ? output.selected_detail : null,
    secrets_included: false,
  };
}
