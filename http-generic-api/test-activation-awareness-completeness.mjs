import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizeActivationResponseProfile,
  activationResponseProfileConfig,
  _testingActivationHardResponse,
} from "./activationHardResponseService.js";
import {
  buildCompletenessEnvelope,
  buildAwarenessIndex,
  _testingActivationAwareness,
} from "./activationAwarenessService.js";
import {
  normalizeActivationSessionPolicy,
  deriveActivationIdempotencyKey,
} from "./activationSessionLifecycleService.js";
import { _testingActivationAwarenessRoutes } from "./routes/activationAwarenessRoutes.js";

function read(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function testProfilesAndBudgets() {
  assert.equal(normalizeActivationResponseProfile(), "evidence");
  assert.equal(normalizeActivationResponseProfile("FULL"), "full");
  assert.equal(normalizeActivationResponseProfile("unknown"), "evidence");
  assert.equal(activationResponseProfileConfig("evidence").target_bytes, 30000);
  assert.equal(activationResponseProfileConfig("evidence").hard_bytes, 40000);
  assert.equal(activationResponseProfileConfig("full").include_full_dynamic_tabs, true);

  const buildSynthetic = (profile) => {
    const surfaceRefs = [
      { surface: "dynamic_tabs", tool_key: "activation_dynamic_tab_detail_read_api", supports_cursor: true },
      { surface: "operational_intelligence", tool_key: "activation_operational_attention_read_api", supports_cursor: true },
      { surface: "operational_dashboard", tool_key: "operational_console_read_api", supports_cursor: true },
    ];
    const tabs = Array.from({ length: 14 }, (_, tabIndex) => ({
      tab_key: `tab_${tabIndex}`,
      display_name: `Tab ${tabIndex}`,
      status: tabIndex % 5 === 0 ? "attention" : "active",
      sections: Array.from({ length: 8 }, (_, sectionIndex) => ({
        section_key: `section_${sectionIndex}`,
        display_name: `Section ${sectionIndex}`,
        delivery_mode: "attention_first",
        dedupe_scope: "tenant",
        supports_cursor: true,
        hydration_state: "manifest_only",
        details_ref: { tool_key: "activation_dynamic_tab_detail_read_api" },
        description: "section-detail-".repeat(500),
      })),
    }));
    const dynamicTabsManifest = {
      ok: true,
      activation_layer: "dynamic_tabs",
      registry_version: "test",
      summary: { registered_tabs: 14, registered_sections: 112, degraded_surface_count: 0 },
      containers: Array.from({ length: 30 }, (_, containerIndex) => ({
        container_key: `workspace:${containerIndex}`,
        container_type: "workspace",
        display_name: `Workspace ${containerIndex}`,
        workspace_key: `workspace_${containerIndex}`,
        bootstrap_status: "active",
        tabs,
      })),
      shared_surfaces: tabs.map((tab) => ({
        surface_ref: `surface:${tab.tab_key}`,
        section_key: "summary",
        tab_key: tab.tab_key,
        dedupe_scope: "global",
        delivery_mode: "summary",
        detail_tool_key: "activation_dynamic_tab_detail_read_api",
      })),
      policy: { details_omitted_silently: false },
      degraded_surfaces: [],
    };
    const operationalSummary = {
      ok: true,
      activation_layer: "operational_intelligence",
      summary: { attention_count: 200, critical_attention_count: 2, degraded_surface_count: 0 },
      tab_badges: { connectors: { active: 26, pending: 5, error: 0 } },
      attention_items: Array.from({ length: 200 }, (_, index) => ({
        source: "tasks",
        item_id: `task_${index}`,
        severity: index < 2 ? "critical" : "high",
        title: `Attention ${index} ${"detail ".repeat(500)}`,
        detail: "x".repeat(4000),
        updated_at: "2026-06-14T00:00:00.000Z",
      })),
      detail_refs: { tasks: { tool_key: "activation_operational_attention_read_api" } },
      policy: { details_omitted_silently: false },
      degraded_surfaces: [],
    };
    const dashboardManifest = {
      ok: true,
      activation_layer: "operational_dashboard",
      summary: { registered_tiles: 30, active_tiles: 30, degraded_surface_count: 0 },
      tiles: Array.from({ length: 30 }, (_, index) => ({
        tile_key: `tile_${index}`,
        display_name: `Tile ${index}`,
        category: "operations",
        status: "active",
        risk_level: index % 2 ? "low" : "medium",
        counts: { active: index + 1, pending: 0, error: 0 },
        hydration_state: "summary_loaded",
        details_ref: { tool_key: "operational_console_read_api", tile_key: `tile_${index}` },
        detail: "dashboard-detail-".repeat(500),
      })),
      freshness_manifest: Array.from({ length: 100 }, (_, index) => ({ index, detail: "x".repeat(2000) })),
      policy: { details_omitted_silently: false },
      degraded_surfaces: [],
    };
    return {
      ok: true,
      activation_layer: "hard_activation_orchestrator",
      activation_complete: true,
      run_id: "run_test",
      session_id: "session_test",
      response_profile: profile,
      snapshot: { snapshot_id: "snapshot_test", registry_version: "test" },
      runtime_classification: { activation_status: "active", reason_code: "validated" },
      state_model: { validation_state: "complete", evidence_state: "complete", delivery_state: "prepared" },
      evidence_matrix: {
        session_context: { ok: true, status: "complete", raw: "x".repeat(20000) },
        provider_bootstrap: { ok: true, status: "complete", raw: "x".repeat(20000) },
      },
      session_context_evidence: { ok: true, status: "complete", raw: "x".repeat(20000) },
      provider_bootstrap_evidence: { ok: true, status: "complete", raw: "x".repeat(20000) },
      session_context: {
        session_id: "session_test",
        run_id: "run_test",
        subject: { tenant_id: "tenant_test", user_id: "platform_admin" },
        platform_access: { counts: { brands: 8, actions: 38 } },
        authorized_access: { auth_gaps: [], counts: { registered_surfaces: 31 } },
        details_deferred: true,
        secrets_included: false,
      },
      provider_bootstrap: {
        ok: true,
        status: "active",
        counts: { brands: 8, actions: 38 },
        readiness: { brands: "active", actions: "active" },
        raw_provider_payload: "provider-detail-".repeat(10000),
        degraded_surfaces: [],
      },
      dynamic_tabs_manifest: dynamicTabsManifest,
      operational_summary: operationalSummary,
      operational_dashboard_manifest: dashboardManifest,
      completeness: {
        known_surfaces: 31,
        visible_surfaces: 31,
        summarized_surfaces: 31,
        details_omitted_silently: false,
        deferred_details_have_refs: true,
        coverage_status: "complete_awareness",
      },
      awareness_index: { score: 100, coverage: 100, freshness: 100, detail_availability: 100 },
      surface_refs: surfaceRefs,
      dynamic_tabs: { response_mode: "manifest", payload: dynamicTabsManifest },
      operational_intelligence: { response_mode: "summary_attention_first", payload: operationalSummary },
      operational_dashboard: { response_mode: "manifest", payload: dashboardManifest },
      degraded_surfaces: [],
      report_policy: { deferred_details_must_have_governed_refs: true },
      secrets_included: false,
    };
  };

  for (const profile of ["evidence", "summary"]) {
    const config = activationResponseProfileConfig(profile);
    const projected = _testingActivationHardResponse.applyResponseBudget(buildSynthetic(profile), config);
    const finalBytes = Buffer.byteLength(JSON.stringify(projected), "utf8");
    assert.ok(finalBytes <= config.hard_bytes, `${profile} response must remain within hard byte budget`);
    assert.equal(projected.response_projection.within_hard_budget, true);
    assert.equal(projected.response_projection.semantic_chunk_fallback_required, false);
    assert.equal(projected.response_projection.details_omitted_silently, false);
    assert.equal(projected.response_projection.details_deferred, true);
    assert.equal(projected.completeness.details_omitted_silently, false);
    assert.equal(projected.completeness.deferred_details_have_refs, true);
    assert.equal(projected.dynamic_tabs.details_inline, false);
    assert.equal(projected.operational_intelligence.details_inline, false);
    assert.equal(projected.operational_dashboard.details_inline, false);
    assert.equal(projected.surface_refs.length, 3);
    assert.ok(projected.response_projection.projection_steps.includes("strict_semantic_summary_envelope"));
    assert.ok(Array.isArray(projected.response_projection.deferred_surfaces));
  }
}

function testCompletenessAndAwareness() {
  const completeness = buildCompletenessEnvelope({
    tabManifest: { summary: { registered_tabs: 14, degraded_surface_count: 0 } },
    operationalSummary: { summary: { degraded_surface_count: 0 }, freshness_status: "fresh", ok: true },
    dashboardManifest: { summary: { registered_tiles: 7, degraded_surface_count: 0 } },
    fullyHydratedSurfaces: 1,
  });
  assert.equal(completeness.known_surfaces, 27);
  assert.equal(completeness.visible_surfaces, 27);
  assert.equal(completeness.details_omitted_silently, false);
  assert.equal(completeness.deferred_details_have_refs, true);
  assert.equal(completeness.coverage_status, "complete_awareness");

  const index = buildAwarenessIndex({ completeness, operationalSummary: { ok: true } });
  assert.equal(index.coverage, 100);
  assert.equal(index.detail_availability, 100);
  assert.ok(index.score >= 95);
}

function testIdempotencyAndInputNormalization() {
  assert.equal(normalizeActivationSessionPolicy("reuse_only"), "reuse_only");
  assert.equal(normalizeActivationSessionPolicy("invalid"), "reuse_or_create");
  const first = deriveActivationIdempotencyKey({
    tenantId: "tenant-1",
    userId: "user-1",
    conversationRef: "conversation-1",
  });
  const second = deriveActivationIdempotencyKey({
    tenantId: "tenant-1",
    userId: "user-1",
    conversationRef: "conversation-1",
  });
  assert.equal(first, second);
  assert.equal(first.length, 64);
  assert.equal(deriveActivationIdempotencyKey({ explicitKey: "explicit-key" }), "explicit-key");

  assert.equal(_testingActivationAwarenessRoutes.profileValue("diagnostic"), "diagnostic");
  assert.equal(_testingActivationAwarenessRoutes.profileValue("invalid"), "evidence");
  assert.equal(_testingActivationAwarenessRoutes.boundedInt("500", 25, 1, 100), 100);
  assert.equal(_testingActivationAwarenessRoutes.queryText([" tab "], 20), "tab");
  assert.equal(_testingActivationAwareness.defaultDeliveryMode({ aggregation_mode: "summary" }), "summary");
  assert.equal(_testingActivationAwareness.defaultDedupeScope({}), "global");
}

function testRepositoryContracts() {
  const index = read("./routes/index.js");
  const hardRoutes = read("./routes/activationHardRunRoutes.js");
  const awarenessRoutes = read("./routes/activationAwarenessRoutes.js");
  const dynamicTabs = read("./activationDynamicTabsEvidence.js");
  const migration = read("./migrations/310_sprint69_activation_awareness_completeness_control_plane.sql");
  const openapi = read("./openapi.yaml");

  assert.match(index, /buildActivationHardRunRoutes/);
  assert.match(index, /buildActivationAwarenessRoutes/);
  assert.ok(index.indexOf("buildActivationHardRunRoutes") < index.indexOf("buildActivationRoutes(deps)"));
  assert.match(hardRoutes, /response_profile/);
  assert.match(hardRoutes, /maybeChunkToolResponseBody/);
  assert.match(hardRoutes, /markActivationRunDelivered/);
  assert.match(awarenessRoutes, /\/tenant\/activation\/awareness/);
  assert.match(awarenessRoutes, /active_tenant_membership_required/);
  assert.match(awarenessRoutes, /container_key and tab_key are required/);

  assert.match(dynamicTabs, /loadSectionRowsBatch/);
  assert.match(dynamicTabs, /batch_query_count/);
  assert.match(dynamicTabs, /legacy_estimated_query_count/);
  assert.doesNotMatch(dynamicTabs, /for \(const section of registeredSections\) \{\s*const sectionEvidence = await loadSectionRows/);

  for (const required of [
    "CREATE TABLE IF NOT EXISTS activation_runs",
    "CREATE TABLE IF NOT EXISTS activation_snapshot_ledger",
    "CREATE TABLE IF NOT EXISTS activation_response_profile_registry",
    "CREATE TABLE IF NOT EXISTS activation_delivery_policy_registry",
    "activation_dynamic_tab_detail_read_api",
    "tenant_activation_awareness_read_api",
    "tenant_activation_dynamic_tab_detail_read_api",
    "activation_awareness_coverage",
  ]) assert.match(migration, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  for (const path of [
    "/activation/hard-run:",
    "/activation/hard-run/legacy-full:",
    "/activation/awareness:",
    "/activation/dynamic-tabs/detail:",
    "/activation/runs/{runId}/ack:",
    "/tenant/activation/awareness:",
    "/tenant/activation/dynamic-tabs/detail:",
  ]) assert.ok(openapi.includes(path), `OpenAPI must include ${path}`);
  assert.match(openapi, /ActivationAwarenessResponse:/);
  assert.match(openapi, /ActivationDynamicTabDetailResponse:/);
  assert.match(openapi, /response_profile:/);
  assert.match(openapi, /idempotency_key:/);
}

async function main() {
  testProfilesAndBudgets();
  testCompletenessAndAwareness();
  testIdempotencyAndInputNormalization();
  testRepositoryContracts();
  console.log("activation awareness completeness contract tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
