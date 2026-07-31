import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import YAML from "yaml";
import {
  normalizeActivationResponseProfile,
  activationResponseProfileConfig,
  _testingActivationHardResponse,
} from "./activationHardResponseService.js";
import {
  buildCompletenessEnvelope,
  buildAwarenessIndex,
  deriveOperationalBlockedSurfaces,
  _testingActivationAwareness,
} from "./activationAwarenessService.js";
import {
  normalizeActivationSessionPolicy,
  deriveActivationIdempotencyKey,
  ACTIVATION_CONTEXT_LIFECYCLE_CONTRACT,
} from "./activationSessionLifecycleService.js";
import { _testingActivationAwarenessRoutes } from "./routes/activationAwarenessRoutes.js";

function read(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function assertIncludesAll(text, values, label) {
  for (const value of values) {
    assert.ok(text.includes(value), `${label} must include ${value}`);
  }
}

function testProfilesAndBudgets() {
  assert.equal(normalizeActivationResponseProfile(), "evidence");
  assert.equal(normalizeActivationResponseProfile("FULL"), "full");
  assert.equal(normalizeActivationResponseProfile("unknown"), "evidence");
  assert.equal(activationResponseProfileConfig("evidence").target_bytes, 30000);
  assert.equal(activationResponseProfileConfig("evidence").hard_bytes, 40000);
  assert.equal(activationResponseProfileConfig("full").include_full_dynamic_tabs, true);

  const buildSynthetic = (profile) => ({
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
    dynamic_tabs_manifest: {
      ok: true,
      activation_layer: "dynamic_tabs",
      registry_version: "test",
      summary: { registered_tabs: 14, registered_sections: 112, degraded_surface_count: 0 },
      containers: [],
      shared_surfaces: [],
      policy: { details_omitted_silently: false },
      degraded_surfaces: [],
    },
    operational_summary: {
      ok: true,
      activation_layer: "operational_intelligence",
      summary: { attention_count: 2, critical_attention_count: 1, degraded_surface_count: 0 },
      attention_items: [{ title: "critical", detail: "x".repeat(2000) }],
      detail_refs: { tasks: { tool_key: "activation_operational_attention_read_api" } },
      policy: { details_omitted_silently: false },
      degraded_surfaces: [],
    },
    operational_dashboard_manifest: {
      ok: true,
      activation_layer: "operational_dashboard",
      summary: { registered_tiles: 7, active_tiles: 7, degraded_surface_count: 0 },
      tiles: [],
      policy: { details_omitted_silently: false },
      degraded_surfaces: [],
    },
    completeness: {
      known_surfaces: 31,
      visible_surfaces: 31,
      summarized_surfaces: 31,
      details_omitted_silently: false,
      deferred_details_have_refs: true,
      coverage_status: "complete_awareness",
    },
    awareness_index: { score: 100, coverage: 100, freshness: 100, detail_availability: 100 },
    surface_refs: [
      { surface: "dynamic_tabs", tool_key: "activation_dynamic_tab_detail_read_api", supports_cursor: true },
      { surface: "operational_intelligence", tool_key: "activation_operational_attention_read_api", supports_cursor: true },
      { surface: "operational_dashboard", tool_key: "operational_console_read_api", supports_cursor: true },
    ],
    dynamic_tabs: { response_mode: "manifest", payload: {} },
    operational_intelligence: { response_mode: "summary_attention_first", payload: {} },
    operational_dashboard: { response_mode: "manifest", payload: {} },
    degraded_surfaces: [],
    report_policy: { deferred_details_must_have_governed_refs: true },
    secrets_included: false,
  });

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
    assert.equal(projected.surface_refs.length, 3);
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
  assert.equal(index.authorization_visibility, 100);
  assert.equal(index.detail_availability, 100);
  assert.ok(index.score >= 95);

  const blockedCompleteness = buildCompletenessEnvelope({
    tabManifest: { summary: { registered_tabs: 14, degraded_surface_count: 0 } },
    operationalSummary: { summary: { blocked_surface_count: 3, degraded_surface_count: 0 }, freshness_status: "fresh", ok: true },
    dashboardManifest: { summary: { registered_tiles: 7, degraded_surface_count: 0 } },
    fullyHydratedSurfaces: 1,
  });
  assert.equal(blockedCompleteness.blocked_surfaces, 3);
  assert.equal(blockedCompleteness.coverage_status, "complete_awareness_with_blocked_surfaces");
  const blockedIndex = buildAwarenessIndex({ completeness: blockedCompleteness, operationalSummary: { ok: true } });
  assert.equal(blockedIndex.coverage, 100);
  assert.ok(blockedIndex.authorization_visibility < 100);
  assert.ok(blockedIndex.score < index.score);
}

function testOperationalCountIntegrityAndBlockedSurfaceDetails() {
  const skillProjection = _testingActivationAwareness.deriveSkillGrantProjection([
    { grant_status: "active", requires_approval: 1, count: 10 },
    { grant_status: "active", requires_approval: 0, count: 69 },
    { grant_status: "revoked", requires_approval: 1, count: 2 },
  ]);
  assert.equal(skillProjection.total, 81);
  assert.deepEqual(skillProjection.grant_status, { active: 79, revoked: 2 });
  assert.deepEqual(skillProjection.approval, { requires_approval: 10, no_approval_required: 69 });

  const blocked = deriveOperationalBlockedSurfaces({
    results: { systems: { ok: true }, tasks: { ok: true }, agents: { ok: true }, skills: { ok: true }, freshness: { ok: true }, signals: { ok: true } },
    counts: {
      systems: { active: 3, pending: 28, error: 0 },
      tasks: { blocked: 3, open: 17 },
      agents: { active: 252, degraded: 0, offline: 0 },
      skills: { active: 79, revoked: 2 },
      skillApprovals: { requires_approval: 10, no_approval_required: 69 },
      freshness: {},
      signals: {},
    },
  });
  assert.deepEqual(blocked.map((item) => item.surface_key), ["connectors", "tasks"]);
  assert.deepEqual(blocked[0].reasons, ["pending_installations"]);
  assert.deepEqual(blocked[1].reasons, ["blocked_tasks"]);
  assert.equal(blocked.every((item) => item.secrets_included === false), true);

  const unavailableSkills = deriveOperationalBlockedSurfaces({
    results: { skills: { ok: false } },
    counts: { skills: {}, skillApprovals: {} },
  });
  const unavailableSkillSurface = unavailableSkills.find((item) => item.surface_key === "skills");
  assert.ok(unavailableSkillSurface);
  assert.deepEqual(unavailableSkillSurface.metrics, { active_grants: null, requires_approval: null });
  assert.deepEqual(unavailableSkillSurface.reasons, ["source_unavailable"]);
}

function testIdempotencyAndInputNormalization() {
  assert.equal(normalizeActivationSessionPolicy("reuse_only"), "reuse_only");
  assert.equal(normalizeActivationSessionPolicy("invalid"), "reuse_or_create");
  const first = deriveActivationIdempotencyKey({ tenantId: "tenant-1", userId: "user-1", conversationRef: "conversation-1" });
  const second = deriveActivationIdempotencyKey({ tenantId: "tenant-1", userId: "user-1", conversationRef: "conversation-1" });
  assert.equal(first, second);
  assert.equal(first.length, 64);
  assert.equal(first, deriveActivationIdempotencyKey({
    tenantId: "tenant-1",
    userId: "user-1",
    workspaceKey: "workspace-2",
    brandKey: "brand-1",
    conversationRef: "conversation-1",
  }));
  assert.equal(
    deriveActivationIdempotencyKey({ tenantId: "tenant-1", userId: "user-1", workspaceKey: "workspace-1", brandKey: "brand-1", conversationRef: "conversation-1" }),
    deriveActivationIdempotencyKey({ tenantId: "tenant-1", userId: "user-1", workspaceKey: "workspace-1", brandKey: "brand-2", conversationRef: "conversation-1" })
  );
  assert.equal(deriveActivationIdempotencyKey({ explicitKey: "explicit-key" }), "explicit-key");

  assert.equal(_testingActivationAwarenessRoutes.profileValue("diagnostic"), "diagnostic");
  assert.equal(_testingActivationAwarenessRoutes.profileValue("invalid"), "evidence");
  assert.equal(_testingActivationAwarenessRoutes.boundedInt("500", 25, 1, 100), 100);
  assert.equal(_testingActivationAwarenessRoutes.queryText([" tab "], 20), "tab");
  assert.equal(_testingActivationAwareness.defaultDeliveryMode({ aggregation_mode: "summary" }), "summary");
  assert.equal(_testingActivationAwareness.defaultDedupeScope({}), "global");
  assert.equal(ACTIVATION_CONTEXT_LIFECYCLE_CONTRACT.session_container_scope, "conversation");
  assert.equal(ACTIVATION_CONTEXT_LIFECYCLE_CONTRACT.turn_context_scope, "operation_resolution");
  assert.ok(ACTIVATION_CONTEXT_LIFECYCLE_CONTRACT.inherited_brand_context.includes("business_type_key"));
  assert.ok(ACTIVATION_CONTEXT_LIFECYCLE_CONTRACT.inherited_brand_context.includes("business_activity_type_key"));
  assert.ok(ACTIVATION_CONTEXT_LIFECYCLE_CONTRACT.inherited_brand_context.includes("knowledge_profile_key"));
  assert.equal(ACTIVATION_CONTEXT_LIFECYCLE_CONTRACT.admin_surface_required, true);
  assert.equal(ACTIVATION_CONTEXT_LIFECYCLE_CONTRACT.tenant_surface_required, true);
}

function testRepositoryContracts() {
  const index = read("./routes/index.js");
  const hardRoutes = read("./routes/activationHardRunRoutes.js");
  const activationRoutes = read("./routes/activationRoutes.js");
  const awarenessRoutes = read("./routes/activationAwarenessRoutes.js");
  const tenantOverlayRoutes = read("./routes/tenantActivationOverlayRoutes.js");
  const sessionRoutes = read("./routes/sessionRoutes.js");
  const gptSessionRoutes = read("./routes/gptSessionRoutes.js");
  const gptToolsRoutes = read("./routes/gptToolsRoutes.js");
  const sessionSummaryService = read("./sessionSummaryService.js");
  const sessionArchiveService = read("./sessionArchiveService.js");
  const lifecycleService = read("./activationSessionLifecycleService.js");
  const mcpRuntime = read("./mcpRuntime.js");
  const dynamicTabs = read("./activationDynamicTabsEvidence.js");
  const awarenessService = read("./activationAwarenessService.js");
  const migration = read("./migrations/310_sprint69_activation_awareness_completeness_control_plane.sql");
  const contextIndexMigration = read("./migrations/1042_sprint69_activation_session_context_indexes.sql");
  const openapi = read("./openapi.yaml");

  assert.match(index, /buildActivationHardRunRoutes/);
  assert.match(index, /buildActivationAwarenessRoutes/);
  assert.ok(index.indexOf("buildActivationHardRunRoutes") < index.indexOf("buildActivationRoutes(deps)"));
  assert.match(hardRoutes, /response_profile/);
  assert.match(hardRoutes, /maybeChunkToolResponseBody/);
  assert.match(hardRoutes, /auth: req\?\.auth \|\| null/);
  assert.match(hardRoutes, /source_surface: "activation_hard_run"/);
  assert.match(hardRoutes, /markActivationRunDelivered/);
  assert.match(awarenessRoutes, /\/tenant\/activation\/awareness/);
  assert.match(awarenessRoutes, /active_tenant_membership_required/);
  assert.match(awarenessRoutes, /container_key and tab_key are required/);
  assert.match(awarenessRoutes, /chunkActivationAwarenessResponse/);
  assert.match(awarenessRoutes, /auth: req\?\.auth \|\| null/);
  assert.match(awarenessRoutes, /source_surface: "activation_awareness"/);
  assert.match(activationRoutes, /activation_session_context_read_api/);
  assert.match(activationRoutes, /maybeChunkToolResponseBody/);
  assert.match(activationRoutes, /auth: req\?\.auth \|\| null/);
  assert.match(activationRoutes, /source_surface: "activation_session_context_read_api"/);
  assert.match(activationRoutes, /workspace_key: workspaceKey/);
  assert.match(activationRoutes, /brand_key: brandKey/);
  assert.match(tenantOverlayRoutes, /tenant_activation_session_context/);
  assert.match(tenantOverlayRoutes, /auth: req\.auth/);
  assert.match(tenantOverlayRoutes, /source_surface: "tenant_activation_session_context"/);
  assert.match(tenantOverlayRoutes, /chunk_ttl_minutes/);

  assert.match(sessionRoutes, /context_scope = "session"/);
  assert.match(sessionRoutes, /invalid_context_scope/);
  assert.match(sessionRoutes, /gpt_session_turns/);
  assert.match(sessionRoutes, /gst\.session_id = cs\.session_id/);
  assert.match(sessionRoutes, /turnClauses\.join\(" AND "\)/);
  assert.match(sessionRoutes, /context_scope: normalizedContextScope/);
  assert.match(sessionRoutes, /turn_contexts: turnContexts/);
  assert.match(sessionRoutes, /context_granularity: turnContexts\.length \? "turn_level" : "session_default"/);

  assert.match(gptToolsRoutes, /shouldChunkDispatchedToolResponse/);
  assert.match(gptToolsRoutes, /response_chunk_read/);
  assert.match(gptToolsRoutes, /resolveGptSessionContext/);
  assert.match(gptToolsRoutes, /x-workspace-key/);
  assert.match(gptToolsRoutes, /x-brand-key/);
  assert.doesNotMatch(gptToolsRoutes, /CASE WHEN \(\? IS NOT NULL AND workspace_key = \?\)/);
  assert.doesNotMatch(gptToolsRoutes, /CASE WHEN \(\? IS NOT NULL AND brand_key = \?\)/);
  assert.match(gptToolsRoutes, /ORDER BY started_at DESC/);
  assert.match(gptToolsRoutes, /business_type_key: businessTypeKey/);
  assert.match(gptToolsRoutes, /business_activity_type_key: businessActivityTypeKey/);
  assert.match(gptToolsRoutes, /x-business-type-key/);
  assert.match(gptToolsRoutes, /x-business-activity-type-key/);
  assert.match(gptToolsRoutes, /x-knowledge-profile-key/);

  assert.match(gptSessionRoutes, /workspace_key = String\(turn\.workspace_key/);
  assert.match(gptSessionRoutes, /brand_key = String\(turn\.brand_key/);
  assert.match(gptSessionRoutes, /workspace_key,\n\s*brand_key,/);
  assert.match(gptSessionRoutes, /workspace_key: turn\.workspace_key/);
  assert.match(gptSessionRoutes, /brand_key: turn\.brand_key/);
  assert.match(gptSessionRoutes, /session_not_found/);
  assert.match(gptSessionRoutes, /session_closed/);

  assert.match(sessionArchiveService, /turnWorkspaceKey = String\(workspace_key \|\| session\.workspace_key/);
  assert.match(sessionArchiveService, /turnBrandKey = String\(brand_key \|\| session\.brand_key/);
  assert.match(sessionArchiveService, /resolveInheritedBusinessContext/);
  assert.match(sessionArchiveService, /brand_paths/);
  assert.match(sessionArchiveService, /business_activity_types/);
  assert.match(sessionArchiveService, /business_type_profiles/);
  assert.match(sessionArchiveService, /context_stack: turnContextStack/);
  assert.match(sessionArchiveService, /business_context: businessContext/);
  assert.match(sessionSummaryService, /gpt_session_turns/);
  assert.match(sessionSummaryService, /gst\.workspace_key = \?/);
  assert.match(sessionSummaryService, /gst\.brand_key = \?/);
  assert.match(sessionSummaryService, /COALESCE\(/);
  assert.equal(sessionSummaryService.includes("LEFT JOIN \\`customer_sessions\\` cs ON cs.session_id = ss.session_id"), true);

  assert.doesNotMatch(lifecycleService, /workspaceKey \|\| "workspace:unspecified"/);
  assert.doesNotMatch(lifecycleService, /brandKey \|\| "brand:unspecified"/);
  assert.doesNotMatch(lifecycleService, /AND \(\? IS NULL OR s\.workspace_key = \?\)/);
  assert.doesNotMatch(lifecycleService, /AND \(\? IS NULL OR s\.brand_key = \?\)/);

  assert.match(mcpRuntime, /workspace_key: \{ type: "string"/);
  assert.match(mcpRuntime, /brand_key: \{ type: "string"/);
  assert.match(mcpRuntime, /gpt_session_turns/);
  assert.match(mcpRuntime, /gst\.workspace_key = \?/);
  assert.match(mcpRuntime, /gst\.brand_key = \?/);

  assert.match(dynamicTabs, /loadSectionRowsBatch/);
  assert.match(dynamicTabs, /batch_query_count/);
  assert.match(dynamicTabs, /legacy_estimated_query_count/);
  assert.doesNotMatch(dynamicTabs, /for \(const section of registeredSections\) \{\s*const sectionEvidence = await loadSectionRows/);

  assert.match(awarenessService, /LEFT JOIN installations i/);
  assert.match(awarenessService, /i\.status = 'active'/);
  assert.match(awarenessService, /i\.expires_at IS NULL OR i\.expires_at > UTC_TIMESTAMP\(\)/);
  assert.match(awarenessService, /blocked_surface_count: blockedSurfaceCount/);
  assert.match(awarenessService, /connected_system_count: connectedSystemCount/);
  assert.match(awarenessService, /GROUP BY grant_status, requires_approval/);
  assert.match(awarenessService, /complete_awareness_with_blocked_surfaces/);
  assert.doesNotMatch(awarenessService, /const authorizationVisibility = 100;/);
  assert.doesNotMatch(awarenessService, /blocked_surfaces: 0,/);

  assertIncludesAll(migration, [
    "CREATE TABLE IF NOT EXISTS activation_runs",
    "CREATE TABLE IF NOT EXISTS activation_snapshot_ledger",
    "CREATE TABLE IF NOT EXISTS activation_response_profile_registry",
    "CREATE TABLE IF NOT EXISTS activation_delivery_policy_registry",
    "activation_dynamic_tab_detail_read_api",
    "tenant_activation_awareness_read_api",
    "tenant_activation_dynamic_tab_detail_read_api",
    "activation_awareness_coverage",
  ], "activation awareness migration");

  assertIncludesAll(contextIndexMigration, [
    "idx_cs_gpt_context_active_started",
    "idx_ar_context_reuse_session",
    "idx_ss_context_created",
    "idx_gst_context_scope_created",
    "idx_gst_session_context_created",
    "workspace_key",
    "brand_key",
  ], "activation context index migration");
  assert.doesNotMatch(contextIndexMigration, /idx_gst_session_context_lookup/);

  assert.ok(openapi.includes("/sessions:"), "OpenAPI must include /sessions");
  const openapiDocument = YAML.parse(openapi);
  const listSessionsOperation = openapiDocument.paths?.["/sessions"]?.get;
  assert.ok(listSessionsOperation, "OpenAPI must include GET /sessions");
  const contextScopeParameter = (listSessionsOperation.parameters || []).find(
    (parameter) =>
      parameter?.in === "query" &&
      parameter?.name === "context_scope"
  );
  assert.ok(
    contextScopeParameter,
    "GET /sessions must include context_scope as a query parameter"
  );
  assert.deepEqual(contextScopeParameter.schema?.enum, ["session", "turn", "any"]);
  assert.equal(contextScopeParameter.schema?.default, "session");
  assert.ok(openapi.includes("/gpt/sessions/{id}/turn:"), "OpenAPI must include single GPT turn writer");
  assert.ok(openapi.includes("/gpt/sessions/{id}/turns:"), "OpenAPI must include GPT turns collection");
  assert.match(openapi, /operationId: writeGptSessionTurn/);
  assert.match(openapi, /operationId: writeGptSessionTurns/);
  assert.match(openapi, /workspace_key:\n\s+type: string\n\s+description: Optional turn-level workspace context/);
  assert.match(openapi, /brand_key:\n\s+type: string\n\s+description: Optional turn-level brand context/);
  assert.match(openapi, /target_key:\n\s+type: string\n\s+description: Alias for brand_key/);

  assertIncludesAll(openapi, [
    "/activation/hard-run:",
    "/activation/hard-run/legacy-full:",
    "/activation/awareness:",
    "/activation/dynamic-tabs/detail:",
    "/activation/runs/{runId}/ack:",
    "/tenant/activation/awareness:",
    "/tenant/activation/dynamic-tabs/detail:",
    "ActivationAwarenessResponse:",
    "ActivationDynamicTabDetailResponse:",
    "response_profile:",
    "idempotency_key:",
  ], "OpenAPI activation contract");
}

async function main() {
  testProfilesAndBudgets();
  testCompletenessAndAwareness();
  testOperationalCountIntegrityAndBlockedSurfaceDetails();
  testIdempotencyAndInputNormalization();
  testRepositoryContracts();
  console.log("activation awareness completeness contract tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
