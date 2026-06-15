import { getPool } from "./db.js";
import {
  buildActivationDynamicTabsEvidence,
} from "./activationDynamicTabsEvidence.js";
import {
  buildActivationOperationalIntelligenceEvidence,
} from "./activationOperationalIntelligenceEvidence.js";
import {
  buildActivationOperationalDashboardEvidence,
} from "./activationDynamicEvidence.js";
import {
  buildActivationSnapshot,
  buildActivationTabManifest,
  buildActivationOperationalSummary,
  buildActivationDashboardManifest,
  buildCompletenessEnvelope,
  buildAwarenessIndex,
  readActivationDynamicTabDetail,
} from "./activationAwarenessService.js";
import { buildStrictActivationSummaryEnvelope } from "./activationResponseBudgetService.js";

const PROFILE_CONFIG = Object.freeze({
  evidence: {
    target_bytes: 30000,
    hard_bytes: 40000,
    include_full_dynamic_tabs: false,
    include_full_operational_intelligence: false,
    include_full_dashboard: false,
    include_selected_detail: false,
  },
  summary: {
    target_bytes: 45000,
    hard_bytes: 65000,
    include_full_dynamic_tabs: false,
    include_full_operational_intelligence: false,
    include_full_dashboard: false,
    include_selected_detail: false,
  },
  dashboard: {
    target_bytes: 90000,
    hard_bytes: 120000,
    include_full_dynamic_tabs: false,
    include_full_operational_intelligence: false,
    include_full_dashboard: false,
    include_selected_detail: true,
  },
  diagnostic: {
    target_bytes: 180000,
    hard_bytes: 250000,
    include_full_dynamic_tabs: true,
    include_full_operational_intelligence: true,
    include_full_dashboard: true,
    include_selected_detail: true,
  },
  full: {
    target_bytes: 350000,
    hard_bytes: 500000,
    include_full_dynamic_tabs: true,
    include_full_operational_intelligence: true,
    include_full_dashboard: true,
    include_selected_detail: false,
  },
});

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value ?? {}), "utf8");
}

function compactError(err, fallback = "activation_hard_response_failed") {
  return { code: err?.code || fallback, message: err?.message || String(err || fallback) };
}

export function normalizeActivationResponseProfile(value) {
  const normalized = String(value || "evidence").trim().toLowerCase();
  return PROFILE_CONFIG[normalized] ? normalized : "evidence";
}

export function activationResponseProfileConfig(profile) {
  return PROFILE_CONFIG[normalizeActivationResponseProfile(profile)];
}

function projectPlatformAccess(platformAccess = {}) {
  return {
    principal: platformAccess.principal || null,
    access_scope: platformAccess.access_scope || null,
    access: platformAccess.access || {},
    counts: platformAccess.counts || {},
    readiness: platformAccess.readiness || {},
    degraded_surface_count: Array.isArray(platformAccess.degraded_surfaces) ? platformAccess.degraded_surfaces.length : 0,
  };
}

function projectAuthorizedAccess(authorizedAccess = {}) {
  return {
    source: authorizedAccess.source || null,
    principal: authorizedAccess.principal || null,
    scope_resolution: authorizedAccess.scope_resolution || null,
    counts: authorizedAccess.counts || {},
    readiness: authorizedAccess.readiness || null,
    auth_gaps: authorizedAccess.auth_gaps || [],
    degraded_surface_count: Array.isArray(authorizedAccess.degraded_surfaces) ? authorizedAccess.degraded_surfaces.length : 0,
    activation_policy: authorizedAccess.activation_policy || {},
  };
}

export function projectActivationSessionContext(sessionContext = {}, profile = "evidence") {
  if (profile === "full" || profile === "diagnostic") return sessionContext;
  return {
    session_id: sessionContext.session_id || null,
    run_id: sessionContext.run_id || null,
    closed_sessions: safeNumber(sessionContext.closed_sessions),
    session_management: sessionContext.session_management || {},
    subject: sessionContext.subject || null,
    pagination: sessionContext.pagination ? {
      limit: sessionContext.pagination.limit,
      offset: sessionContext.pagination.offset,
      include_raw: false,
      has_more_session_history: Boolean(sessionContext.pagination.has_more_session_history),
    } : null,
    history_summary: {
      session_envelopes_count: safeNumber(sessionContext.history?.session_envelopes_count),
      audit_event_count: Array.isArray(sessionContext.history?.audit_events) ? sessionContext.history.audit_events.length : 0,
      transcript_event_count: Array.isArray(sessionContext.history?.transcript_events) ? sessionContext.history.transcript_events.length : 0,
      developer_app_count: Array.isArray(sessionContext.history?.developer_apps) ? sessionContext.history.developer_apps.length : 0,
      api_credential_count: Array.isArray(sessionContext.history?.api_credentials) ? sessionContext.history.api_credentials.length : 0,
      installation_count: Array.isArray(sessionContext.history?.installations) ? sessionContext.history.installations.length : 0,
    },
    conversation_memory: {
      status: sessionContext.conversation_memory?.status || null,
      turn_availability: sessionContext.conversation_memory?.turn_availability || null,
      recent_summary_count: Array.isArray(sessionContext.conversation_memory?.recent_session_summaries)
        ? sessionContext.conversation_memory.recent_session_summaries.length
        : 0,
      referenced_context_count: Array.isArray(sessionContext.conversation_memory?.referenced_contexts)
        ? sessionContext.conversation_memory.referenced_contexts.length
        : 0,
      graph_memory: sessionContext.conversation_memory?.graph_memory ? {
        requested: Boolean(sessionContext.conversation_memory.graph_memory.requested),
        resolved: Boolean(sessionContext.conversation_memory.graph_memory.resolved),
        asset_count: safeNumber(sessionContext.conversation_memory.graph_memory.asset_count),
        error: sessionContext.conversation_memory.graph_memory.error || null,
      } : null,
    },
    platform_access: projectPlatformAccess(sessionContext.platform_access || {}),
    authorized_access: projectAuthorizedAccess(sessionContext.authorized_access || {}),
    pending_tasks: {
      summary: sessionContext.pending_tasks?.summary || {},
      details_inline: false,
      details_ref: { tool_key: "activation_dynamic_tab_detail_read_api", tab_key: "container_tasks" },
    },
    registered_surfaces: {
      count: safeNumber(sessionContext.authorized_access?.counts?.registered_surfaces),
      details_inline: false,
      details_ref: { tool_key: "activation_dynamic_tab_detail_read_api", tab_key: "container_auto_discovered_surfaces" },
    },
    degraded_surface_count: Array.isArray(sessionContext.degraded_surfaces) ? sessionContext.degraded_surfaces.length : 0,
    details_deferred: true,
    secrets_included: false,
  };
}

function compactTabManifest(tabManifest) {
  const compacted = clone(tabManifest);
  compacted.shared_surfaces = (compacted.shared_surfaces || []).map((surface) => ({
    surface_ref: surface.surface_ref,
    section_key: surface.section_key,
    tab_key: surface.tab_key,
    dedupe_scope: surface.dedupe_scope,
    delivery_mode: surface.delivery_mode,
    hydration_state: surface.hydration_state,
    detail_tool_key: surface.detail_tool_key,
  }));
  for (const container of compacted.containers || []) {
    for (const tab of container.tabs || []) {
      tab.sections = (tab.sections || []).map((section) => ({
        section_key: section.section_key,
        delivery_mode: section.delivery_mode,
        dedupe_scope: section.dedupe_scope,
        shared_surface_ref: section.shared_surface_ref,
        supports_cursor: section.supports_cursor,
        hydration_state: section.hydration_state,
        details_ref: section.details_ref,
      }));
    }
  }
  return compacted;
}

function minimalTabManifest(tabManifest) {
  const sectionIndex = [];
  const compacted = clone(tabManifest);
  for (const container of compacted.containers || []) {
    for (const tab of container.tabs || []) {
      for (const section of tab.sections || []) {
        sectionIndex.push({
          container_key: container.container_key,
          tab_key: tab.tab_key,
          section_key: section.section_key,
          delivery_mode: section.delivery_mode,
          dedupe_scope: section.dedupe_scope,
          shared_surface_ref: section.shared_surface_ref,
          details_ref: section.details_ref,
        });
      }
      delete tab.sections;
    }
  }
  compacted.section_index = sectionIndex;
  return compacted;
}

function navigationOnlyTabManifest(tabManifest = {}) {
  const source = clone(tabManifest);
  const containers = Array.isArray(source.containers) ? source.containers : [];
  const active = containers[0] || null;
  const compactActive = active ? {
    container_key: active.container_key,
    container_type: active.container_type,
    workspace_id: active.workspace_id || null,
    workspace_key: active.workspace_key || null,
    tenant_id: active.tenant_id || null,
    display_name: active.display_name,
    bootstrap_status: active.bootstrap_status,
    linked_brand_key: active.linked_brand_key || null,
    tab_count: safeNumber(active.tab_count),
    attention_tab_count: safeNumber(active.attention_tab_count),
    tabs: (active.tabs || []).map((tab) => ({
      tab_key: tab.tab_key,
      display_name: tab.display_name,
      tab_group: tab.tab_group,
      status: tab.status,
      item_count: safeNumber(tab.item_count),
      attention_count: safeNumber(tab.attention_count),
      badge: tab.badge || {},
      freshness: tab.freshness || "unknown",
      hydration_state: tab.hydration_state || "manifest_only",
      details_ref: tab.details_ref || null,
    })),
  } : null;
  return {
    attempted: source.attempted,
    ok: source.ok,
    activation_layer: source.activation_layer,
    registry_version: source.registry_version,
    subject: source.subject,
    summary: source.summary,
    active_container: compactActive,
    container_index: containers.map((container) => ({
      container_key: container.container_key,
      container_type: container.container_type,
      workspace_id: container.workspace_id || null,
      tenant_id: container.tenant_id || null,
      display_name: container.display_name,
      bootstrap_status: container.bootstrap_status,
      linked_brand_key: container.linked_brand_key || null,
      tab_count: safeNumber(container.tab_count),
      attention_tab_count: safeNumber(container.attention_tab_count),
      details_ref: {
        tool_key: "activation_awareness_read_api",
        container_key: container.container_key,
        supports_cursor: true,
      },
    })),
    shared_surface_summary: {
      count: Array.isArray(source.shared_surfaces) ? source.shared_surfaces.length : 0,
      details_ref: { tool_key: "activation_awareness_read_api", surface: "shared_surfaces" },
    },
    degraded_surfaces: source.degraded_surfaces || [],
    policy: {
      ...(source.policy || {}),
      non_active_containers_are_indexed_not_expanded: true,
      active_container_tabs_are_navigation_only: true,
    },
    secrets_included: false,
  };
}

function applyResponseBudget(body, config) {
  const originalBytes = byteLength(body);
  const output = clone(body);
  const deferred = [];
  const projectionSteps = [];

  if (byteLength(output) > config.target_bytes && output.operational_summary?.attention_items?.length > 5) {
    output.operational_summary.attention_items = output.operational_summary.attention_items.slice(0, 5);
    deferred.push("operational_summary.attention_items_after_first_5");
    projectionSteps.push("trim_attention_items");
  }
  if (byteLength(output) > config.target_bytes && Array.isArray(output.operational_dashboard_manifest?.freshness_manifest)) {
    output.operational_dashboard_manifest.freshness_manifest_summary = {
      row_count: output.operational_dashboard_manifest.freshness_manifest.length,
      details_ref: { tool_key: "operational_console_read_api", surface: "freshness" },
    };
    delete output.operational_dashboard_manifest.freshness_manifest;
    deferred.push("operational_dashboard_manifest.freshness_manifest");
    projectionSteps.push("defer_freshness_manifest");
  }
  if (byteLength(output) > config.target_bytes && output.dynamic_tabs_manifest) {
    output.dynamic_tabs_manifest = compactTabManifest(output.dynamic_tabs_manifest);
    deferred.push("dynamic_tabs_manifest.section_descriptions_and_limits");
    projectionSteps.push("compact_section_manifests");
  }
  if (byteLength(output) > config.hard_bytes && output.dynamic_tabs_manifest) {
    output.dynamic_tabs_manifest = minimalTabManifest(output.dynamic_tabs_manifest);
    deferred.push("dynamic_tabs_manifest.inline_section_arrays");
    projectionSteps.push("move_sections_to_global_index");
  }
  if (byteLength(output) > config.hard_bytes && output.dynamic_tabs_manifest) {
    output.dynamic_tabs_manifest = navigationOnlyTabManifest(output.dynamic_tabs_manifest);
    deferred.push("dynamic_tabs_manifest.non_active_container_tabs");
    projectionSteps.push("project_active_container_navigation_and_container_index");
  }
  if (byteLength(output) > config.hard_bytes && output.selected_detail) {
    output.selected_detail = {
      deferred: true,
      reason: "response_budget",
      details_ref: output.selected_detail?.tab?.tab_key
        ? {
            tool_key: "activation_dynamic_tab_detail_read_api",
            container_key: output.selected_detail.container?.container_key,
            tab_key: output.selected_detail.tab.tab_key,
          }
        : null,
    };
    deferred.push("selected_detail.rows");
    projectionSteps.push("defer_selected_detail");
  }

  if (
    byteLength(output) > config.hard_bytes
    && ["evidence", "summary"].includes(String(output.response_profile || ""))
  ) {
    const strict = buildStrictActivationSummaryEnvelope(output, { includeMembership: true });
    for (const key of Object.keys(output)) delete output[key];
    Object.assign(output, strict);
    deferred.push(
      "provider_bootstrap.full_payload",
      "dynamic_tabs_manifest.container_tab_manifests",
      "operational_summary.extended_attention_rows",
      "operational_dashboard_manifest.tile_details",
      "duplicate_profile_alias_payloads"
    );
    projectionSteps.push("strict_semantic_summary_envelope");
  }

  if (
    byteLength(output) > config.hard_bytes
    && ["evidence", "summary"].includes(String(output.response_profile || ""))
  ) {
    const strictWithoutMembership = buildStrictActivationSummaryEnvelope(output, { includeMembership: false });
    for (const key of Object.keys(output)) delete output[key];
    Object.assign(output, strictWithoutMembership);
    deferred.push("dynamic_tabs_manifest.container_tab_membership");
    projectionSteps.push("strict_catalog_counts_only");
  }

  const returnedBytes = byteLength(output);
  output.response_projection = {
    profile_requested: body.response_profile,
    profile_returned: body.response_profile,
    target_bytes: config.target_bytes,
    hard_bytes: config.hard_bytes,
    full_response_bytes: originalBytes,
    returned_response_bytes: returnedBytes,
    within_target_budget: returnedBytes <= config.target_bytes,
    within_hard_budget: returnedBytes <= config.hard_bytes,
    details_deferred: deferred.length > 0,
    deferred_surfaces: deferred,
    projection_steps: projectionSteps,
    details_omitted_silently: false,
    semantic_chunk_fallback_required: returnedBytes > config.hard_bytes,
  };
  output.response_projection.returned_response_bytes = byteLength(output);
  return output;
}

function buildSurfaceRefs(snapshot) {
  return [
    {
      surface: "dynamic_tabs",
      tool_key: "activation_dynamic_tab_detail_read_api",
      scope: "container_tab_section",
      supports_cursor: true,
      snapshot_id: snapshot.snapshot_id,
    },
    {
      surface: "operational_intelligence",
      tool_key: "activation_operational_attention_read_api",
      sections: ["attention", "agents", "skills", "connectors", "tasks", "freshness", "signals"],
      supports_cursor: true,
      snapshot_id: snapshot.snapshot_id,
    },
    {
      surface: "operational_dashboard",
      tool_key: "operational_console_read_api",
      supports_cursor: true,
      snapshot_id: snapshot.snapshot_id,
    },
  ];
}

export async function buildProfiledHardActivationResponse({
  request = {},
  hard,
  sessionContext,
  providerBootstrap,
} = {}) {
  const requestedProfile = request.body?.response_profile || request.query?.response_profile || "evidence";
  const profile = normalizeActivationResponseProfile(requestedProfile);
  const config = activationResponseProfileConfig(profile);
  const operationalSummary = await buildActivationOperationalSummary({
    sessionContext,
    attentionLimit: profile === "evidence" ? 8 : 12,
  });
  const preliminaryManifest = await buildActivationTabManifest({ sessionContext, operationalSummary });
  const snapshot = buildActivationSnapshot({
    sessionContext,
    registryVersion: preliminaryManifest.registry_version,
    profile,
  });
  const [tabManifest, dashboardManifest] = await Promise.all([
    buildActivationTabManifest({ sessionContext, snapshot, operationalSummary }),
    buildActivationDashboardManifest({ sessionContext, snapshot }),
  ]);

  let fullDynamicTabs = null;
  let fullOperationalIntelligence = null;
  let fullDashboard = null;
  if (config.include_full_dynamic_tabs || config.include_full_operational_intelligence || config.include_full_dashboard) {
    const [dynamicTabs, operationalIntelligence, dashboard] = await Promise.all([
      config.include_full_dynamic_tabs ? buildActivationDynamicTabsEvidence({ sessionContext }) : Promise.resolve(null),
      config.include_full_operational_intelligence ? buildActivationOperationalIntelligenceEvidence({ sessionContext }) : Promise.resolve(null),
      config.include_full_dashboard ? buildActivationOperationalDashboardEvidence({ sessionContext }) : Promise.resolve(null),
    ]);
    fullDynamicTabs = dynamicTabs;
    fullOperationalIntelligence = operationalIntelligence;
    fullDashboard = dashboard;
  }

  let selectedDetail = null;
  const selectedContainer = request.body?.container_key || request.query?.container_key || null;
  const selectedTab = request.body?.tab_key || request.query?.tab_key || null;
  if (config.include_selected_detail && selectedContainer && selectedTab) {
    try {
      selectedDetail = await readActivationDynamicTabDetail({
        sessionContext,
        containerKey: selectedContainer,
        tabKey: selectedTab,
        sectionKey: request.body?.section_key || request.query?.section_key || null,
        cursor: request.body?.cursor || request.query?.cursor || 0,
        limit: request.body?.detail_limit || request.query?.detail_limit || 25,
        snapshotId: snapshot.snapshot_id,
      });
    } catch (err) {
      selectedDetail = { ok: false, error: compactError(err), secrets_included: false };
    }
  }

  const fullyHydratedSurfaces = [fullDynamicTabs, fullOperationalIntelligence, fullDashboard, selectedDetail?.ok ? selectedDetail : null].filter(Boolean).length;
  const completeness = buildCompletenessEnvelope({
    tabManifest,
    operationalSummary,
    dashboardManifest,
    fullyHydratedSurfaces,
  });
  const awarenessIndex = buildAwarenessIndex({ completeness, operationalSummary });
  const projectedSessionContext = projectActivationSessionContext(sessionContext, profile);

  const base = {
    ok: hard.activation_complete,
    activation_layer: "hard_activation_orchestrator",
    activation_complete: hard.activation_complete,
    run_id: sessionContext?.run_id || null,
    session_id: sessionContext?.session_id || null,
    response_profile: profile,
    snapshot,
    runtime_classification: {
      activation_status: hard.activation_status,
      status_authority: hard.status_authority,
      reason_code: hard.reason_code,
    },
    state_model: {
      validation_state: hard.activation_complete ? "complete" : "incomplete",
      evidence_state: "complete",
      session_state: sessionContext?.session_management?.reused_existing_session ? "reused" : "created_or_active",
      dashboard_state: dashboardManifest.ok ? "manifest_ready" : "degraded",
      delivery_state: "prepared",
      consumer_ack_state: "not_received",
    },
    evidence_matrix: hard.evidence_matrix,
    session_context_evidence: hard.evidence_matrix.session_context,
    provider_bootstrap_evidence: hard.evidence_matrix.provider_bootstrap,
    session_context: projectedSessionContext,
    provider_bootstrap: providerBootstrap,
    dynamic_tabs_manifest: tabManifest,
    operational_summary: operationalSummary,
    operational_dashboard_manifest: dashboardManifest,
    completeness,
    awareness_index: awarenessIndex,
    surface_refs: buildSurfaceRefs(snapshot),
    selected_detail: selectedDetail,
    degraded_surfaces: hard.degraded_surfaces,
    report_policy: {
      may_report_session_context_loaded: hard.evidence_matrix.session_context.ok === true,
      may_report_activation_complete: hard.activation_complete === true,
      session_context_claim_requires: "getActivationSessionContext evidence with activation_layer=session_context and session_id",
      detailed_rows_may_be_deferred_without_reducing_awareness: true,
      deferred_details_must_have_governed_refs: true,
    },
    secrets_included: false,
  };

  if (profile === "full" || profile === "diagnostic") {
    base.dynamic_tabs = fullDynamicTabs;
    base.operational_intelligence = fullOperationalIntelligence;
    base.operational_dashboard = fullDashboard;
  } else {
    base.dynamic_tabs = {
      response_mode: "manifest",
      summary: tabManifest.summary,
      details_inline: false,
      surface_ref: base.surface_refs[0],
    };
    base.operational_intelligence = {
      response_mode: "summary_attention_first",
      summary: operationalSummary.summary,
      tab_badges: operationalSummary.tab_badges,
      attention_items: operationalSummary.attention_items,
      details_inline: false,
      surface_ref: base.surface_refs[1],
    };
    base.operational_dashboard = {
      response_mode: "manifest",
      summary: dashboardManifest.summary,
      tiles: dashboardManifest.tiles,
      details_inline: false,
      surface_ref: base.surface_refs[2],
    };
  }

  return applyResponseBudget(base, config);
}

export async function recordPreparedActivationResponse(responseBody) {
  const runId = responseBody?.run_id;
  if (!runId) return { ok: true, skipped: true, reason: "missing_run_id" };
  const pool = getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query(
      `UPDATE activation_runs
          SET snapshot_id = ?, response_profile = ?, response_bytes = ?,
              validation_state = ?, evidence_state = 'complete', delivery_state = 'prepared',
              run_status = 'evidence_ready', projection_json = ?, updated_at = UTC_TIMESTAMP()
        WHERE run_id = ?`,
      [
        responseBody.snapshot?.snapshot_id || null,
        responseBody.response_profile,
        byteLength(responseBody),
        responseBody.activation_complete ? "complete" : "incomplete",
        JSON.stringify(responseBody.response_projection || {}),
        runId,
      ]
    );
    const snapshot = responseBody.snapshot || {};
    if (snapshot.snapshot_id) {
      await connection.query(
        `INSERT INTO activation_snapshot_ledger
          (snapshot_id, run_id, session_id, tenant_id, user_id, registry_version,
           data_watermark, response_profile, subject_scope, snapshot_status,
           completeness_json, awareness_index_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE
           run_id = VALUES(run_id), session_id = VALUES(session_id), tenant_id = VALUES(tenant_id),
           user_id = VALUES(user_id), registry_version = VALUES(registry_version),
           data_watermark = VALUES(data_watermark), response_profile = VALUES(response_profile),
           subject_scope = VALUES(subject_scope), snapshot_status = 'prepared',
           completeness_json = VALUES(completeness_json), awareness_index_json = VALUES(awareness_index_json),
           updated_at = UTC_TIMESTAMP()`,
        [
          snapshot.snapshot_id,
          runId,
          responseBody.session_id || null,
          responseBody.session_context?.subject?.tenant_id || responseBody.dynamic_tabs_manifest?.subject?.tenant_id || null,
          responseBody.session_context?.subject?.user_id || responseBody.dynamic_tabs_manifest?.subject?.user_id || null,
          snapshot.registry_version || null,
          new Date(snapshot.data_watermark || snapshot.generated_at || Date.now()),
          responseBody.response_profile,
          snapshot.subject_scope || "platform_admin",
          JSON.stringify(responseBody.completeness || {}),
          JSON.stringify(responseBody.awareness_index || {}),
        ]
      );
    }
    await connection.commit();
    return { ok: true, affected_rows: safeNumber(result?.affectedRows), snapshot_persisted: Boolean(snapshot.snapshot_id) };
  } catch (err) {
    await connection.rollback().catch(() => {});
    return { ok: false, error: compactError(err, "activation_run_prepare_record_failed") };
  } finally {
    connection.release();
  }
}

export const _testingActivationHardResponse = {
  byteLength,
  compactTabManifest,
  minimalTabManifest,
  applyResponseBudget,
  projectPlatformAccess,
  projectAuthorizedAccess,
};
