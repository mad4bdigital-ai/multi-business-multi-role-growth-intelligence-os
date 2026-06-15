import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { _testingOperationalAlerts } from "./operationalAlertService.js";
import { _testingActivationAwarenessRoutes } from "./routes/activationAwarenessRoutes.js";

function read(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function testKnownIssueCoverage() {
  const keys = _testingOperationalAlerts.KNOWN_ISSUE_KEYS;
  assert.equal(keys.length, 11, "all previously observed issues must be represented");
  assert.equal(new Set(keys).size, keys.length, "known issue keys must be unique");
  for (const required of [
    "known.pr_checks_manual_dispatch",
    "known.deploy_operation_intent_mismatch",
    "known.db_update_result_serialization",
    "known.capability_envelope_lifecycle_tool_gap",
    "known.hostinger_restart_transient_503",
    "known.main_sha_pin_race",
    "known.process_local_feature_flag_scope",
    "known.response_chunk_cache_expiry",
    "known.transient_error_envelope_inconsistency",
    "known.repo_patch_exact_match_fragility",
    "known.github_rest_fallback_coverage_gap",
  ]) assert.ok(keys.includes(required), `${required} must be present`);
}

function testSensitiveEvidenceStripping() {
  const clean = _testingOperationalAlerts.sanitizeEvidence({
    status: "failed",
    api_key: "must-not-appear",
    nested: {
      password: "must-not-appear",
      trace_id: "trace-1",
      payload_json: { token: "must-not-appear" },
    },
  });
  assert.equal(clean.status, "failed");
  assert.equal(clean.api_key, undefined);
  assert.equal(clean.nested.password, undefined);
  assert.equal(clean.nested.payload_json, undefined);
  assert.equal(clean.nested.trace_id, "trace-1");
}

function testStableKeysAndExecutionGrouping() {
  const first = _testingOperationalAlerts.deterministicAlertKey(["execution_log", "failed", "workflow-a"]);
  const second = _testingOperationalAlerts.deterministicAlertKey(["execution_log", "failed", "workflow-a"]);
  assert.equal(first, second);
  assert.match(first, /^alert\.[a-f0-9]{64}$/);

  const grouped = _testingOperationalAlerts.groupExecutionRows([
    {
      id: 1,
      tenant_id: "tenant-1",
      workspace_id: "workspace-1",
      execution_status: "failed",
      entry_type: "workflow",
      app_key: "github",
      workflow_key: "ci",
      route_status: "failed",
      execution_trace_id_writeback: "trace-1",
      created_at: "2026-06-14T10:00:00.000Z",
    },
    {
      id: 2,
      tenant_id: "tenant-1",
      workspace_id: "workspace-1",
      execution_status: "failed",
      entry_type: "workflow",
      app_key: "github",
      workflow_key: "ci",
      route_status: "failed",
      execution_trace_id_writeback: "trace-2",
      created_at: "2026-06-14T11:00:00.000Z",
    },
  ]);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].occurrence_count, 2);
  assert.equal(grouped[0].latest_id, 2);
  assert.equal(grouped[0].execution_trace_id_writeback, "trace-2");
}

function testDedupeAndLifecyclePrecedence() {
  const live = _testingOperationalAlerts.candidate({
    alertKey: "alert.test",
    sourceType: "execution_log",
    title: "Failure",
    reasonCode: "execution_failed",
    severity: "critical",
    occurrenceCount: 3,
    lifecycleStatus: "open",
    verificationState: "verified",
    lastSeenAt: "2026-06-14T12:00:00.000Z",
  });
  const persisted = _testingOperationalAlerts.candidate({
    alertId: "alert-id-1",
    alertKey: "alert.test",
    sourceType: "execution_log",
    title: "Failure",
    reasonCode: "execution_failed",
    severity: "critical",
    occurrenceCount: 2,
    lifecycleStatus: "investigating",
    verificationState: "observed",
    persisted: true,
    lastSeenAt: "2026-06-14T11:00:00.000Z",
  });
  const merged = _testingOperationalAlerts.mergeCandidates([live, persisted]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].alert_id, "alert-id-1");
  assert.equal(merged[0].lifecycle_status, "investigating");
  assert.equal(merged[0].verification_state, "verified");
  assert.equal(merged[0].occurrence_count, 3);

  const resolvedPersisted = _testingOperationalAlerts.candidate({
    alertId: "alert-id-2",
    alertKey: "alert.test",
    sourceType: "execution_log",
    title: "Failure",
    reasonCode: "execution_failed",
    severity: "critical",
    lifecycleStatus: "resolved",
    verificationState: "verified",
    persisted: true,
    lastSeenAt: "2026-06-14T11:00:00.000Z",
  });
  const reopened = _testingOperationalAlerts.mergeCandidates([live, resolvedPersisted]);
  assert.equal(reopened[0].lifecycle_status, "open", "live evidence must reopen a resolved automatic alert");
}

function testSummaryAndRouteInputs() {
  const items = [
    _testingOperationalAlerts.candidate({ alertKey: "known.one", sourceType: "known_issue", title: "One", reasonCode: "one", severity: "high", manualKnownIssue: true }),
    _testingOperationalAlerts.candidate({ alertKey: "live.two", sourceType: "execution_log", title: "Two", reasonCode: "two", severity: "critical" }),
  ];
  const summary = _testingOperationalAlerts.summarize(items);
  assert.equal(summary.total_count, 2);
  assert.equal(summary.known_issue_count, 1);
  assert.equal(summary.current_detected_count, 1);
  assert.equal(summary.by_severity.critical, 1);
  assert.equal(_testingActivationAwarenessRoutes.queryBoolean("true"), true);
  assert.equal(_testingActivationAwarenessRoutes.queryBoolean("0"), false);
}

function testRepositoryContracts() {
  const service = read("./operationalAlertService.js");
  const routes = read("./routes/activationAwarenessRoutes.js");
  const awareness = read("./activationAwarenessService.js");
  const migration = read("./migrations/1009_sprint69_operational_alerting_control_plane.sql");
  const openapi = read("./openapi.yaml");
  const memory = read("../memory_schema.json");
  const auditCanonical = read("../canonicals/system_bootstrap/03_audit_logging_schema.md");
  const repairCanonical = read("../canonicals/system_bootstrap/10_observability_repair.md");
  const guide = read("../AI_Agent_Knowledge_Guide.md");

  assert.match(service, /execution_log_is_evidence_not_alert_queue/);
  assert.match(service, /all_known_issues_visible/);
  assert.match(service, /final_result_complete/);
  assert.match(service, /operational_alert_notification_outbox/);
  assert.match(service, /resolution_skipped_due_to_degraded_sources/);
  assert.match(service, /truncated_sources/);
  assert.match(routes, /\/activation\/operational-attention/);
  assert.match(routes, /\/tenant\/activation\/operational-attention/);
  assert.match(routes, /operational-attention\/:alertId\/lifecycle/);
  assert.match(awareness, /readOperationalAlerts/);
  assert.match(awareness, /all_known_issues_visible/);

  for (const required of [
    "CREATE TABLE IF NOT EXISTS operational_alert_rule_registry",
    "CREATE TABLE IF NOT EXISTS operational_alerts",
    "CREATE TABLE IF NOT EXISTS operational_alert_sync_runs",
    "CREATE TABLE IF NOT EXISTS operational_alert_notification_outbox",
    "activation_operational_attention_read_api",
    "activation_operational_attention_sync_api",
    "activation_operational_alert_lifecycle_api",
    "tenant_activation_operational_attention_read_api",
  ]) assert.ok(migration.includes(required), `migration must include ${required}`);

  for (const key of _testingOperationalAlerts.KNOWN_ISSUE_KEYS) {
    assert.ok(migration.includes(key), `migration must seed ${key}`);
  }

  for (const path of [
    "/activation/operational-attention:",
    "/activation/operational-attention/sync:",
    "/activation/operational-attention/{alertId}/lifecycle:",
    "/tenant/activation/operational-attention:",
  ]) assert.ok(openapi.includes(path), `OpenAPI must include ${path}`);
  assert.match(openapi, /OperationalAlert:/);
  assert.match(openapi, /OperationalAlertReadResponse:/);
  assert.match(memory, /operational_alerting_state/);
  assert.match(auditCanonical, /Operational Alerting Evidence Contract/);
  assert.match(repairCanonical, /Operational Alerting Control Plane/);
  assert.match(guide, /Unified Operational Alerting/);
}

async function main() {
  testKnownIssueCoverage();
  testSensitiveEvidenceStripping();
  testStableKeysAndExecutionGrouping();
  testDedupeAndLifecyclePrecedence();
  testSummaryAndRouteInputs();
  testRepositoryContracts();
  console.log("operational alerting control plane contract tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
