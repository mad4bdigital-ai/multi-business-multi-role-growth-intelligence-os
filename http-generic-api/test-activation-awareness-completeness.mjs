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

  const synthetic = {
    response_profile: "evidence",
    operational_summary: {
      attention_items: Array.from({ length: 20 }, (_, index) => ({ index, detail: "x".repeat(4000) })),
    },
    operational_dashboard_manifest: {
      freshness_manifest: Array.from({ length: 20 }, (_, index) => ({ index, detail: "x".repeat(1000) })),
    },
    dynamic_tabs_manifest: {
      containers: [{
        container_key: "workspace:test",
        tabs: [{
          tab_key: "agents",
          sections: Array.from({ length: 10 }, (_, index) => ({
            section_key: `section_${index}`,
            display_name: `Section ${index}`,
            delivery_mode: "attention_first",
            dedupe_scope: "tenant",
            supports_cursor: true,
            hydration_state: "manifest_only",
            details_ref: { tool_key: "activation_dynamic_tab_detail_read_api" },
            description: "x".repeat(2000),
          })),
        }],
      }],
      shared_surfaces: [],
    },
  };
  const projected = _testingActivationHardResponse.applyResponseBudget(
    synthetic,
    activationResponseProfileConfig("evidence")
  );
  assert.equal(projected.response_projection.details_omitted_silently, false);
  assert.equal(projected.response_projection.details_deferred, true);
  assert.ok(projected.operational_summary.attention_items.length <= 5);
  assert.ok(Array.isArray(projected.response_projection.deferred_surfaces));
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
