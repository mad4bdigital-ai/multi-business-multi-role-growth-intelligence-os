import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { _testingOperationalAlerts } from "./operationalAlertService.js";
import { CAPABILITY_DRIFT_SOURCE, buildCapabilityDriftAlertInputs } from "./capabilityDriftAlertAdapter.js";
import { CAPABILITY_DRIFT_ESCALATION_POLICY, evaluateCapabilityDriftAgeEscalation } from "./capabilityDriftAlertEscalationPolicy.js";
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

  const preAggregated = _testingOperationalAlerts.groupExecutionRows([
    {
      id: 7,
      tenant_id: "tenant-1",
      workspace_id: "workspace-1",
      execution_status: "failed",
      entry_type: "workflow",
      app_key: "github",
      workflow_key: "ci",
      route_status: "failed",
      failure_reason: "failed_validation",
      occurrence_count: 23,
      created_at: "2026-06-14T12:00:00.000Z",
    },
  ]);
  assert.equal(preAggregated.length, 1);
  assert.equal(preAggregated[0].occurrence_count, 23, "SQL pre-aggregated execution counts must be preserved");
}

function testP0ReconciliationSemantics() {
  const duplicateGrants = Array.from({ length: 19 }, (_, index) => ({
    grant_id: `grant-${index + 1}`,
    tenant_id: null,
    brand_key: null,
    agent_id: "agent-1",
    agent_name: "agent_one",
    agent_display_name: "Agent One",
    skill_id: "skill-1",
    skill_key: "api.wordpress_write",
    skill_display_name: "WordPress Write",
    requires_approval: 1,
    granted_at: `2026-05-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
  }));
  const groupedGrants = _testingOperationalAlerts.groupSkillApprovalRows(duplicateGrants);
  assert.equal(groupedGrants.length, 1, "duplicate active grants must collapse to one effective approval decision");
  assert.equal(groupedGrants[0].active_grant_count, 19);
  assert.equal(groupedGrants[0].effective_key, "global|global|agent-1|skill-1");

  const executionRows = [
    {
      id: 10,
      entry_type: "sync_execution",
      execution_status: "failed",
      failure_reason: "external_credential_connection_not_found",
      output_summary: "github_get_contents failed: external_credential_connection_not_found",
      created_at: "2026-06-12T17:14:09.000Z",
    },
    {
      id: 11,
      entry_type: "sync_execution",
      execution_status: "success",
      output_summary: "github_get_contents completed with status success (200)",
      created_at: "2026-06-12T17:14:17.000Z",
    },
    {
      id: 12,
      entry_type: "sync_execution",
      execution_status: "failed",
      failure_reason: "endpoint_not_found",
      output_summary: "posts_create failed: endpoint_not_found",
      created_at: "2026-06-13T19:51:38.000Z",
    },
    {
      id: 13,
      entry_type: "sync_execution",
      execution_status: "failed",
      failure_reason: "parent_action_not_found",
      output_summary: "unknown_endpoint_smoke failed: parent_action_not_found",
      created_at: "2026-06-13T20:00:00.000Z",
    },
  ];
  const executionAlerts = _testingOperationalAlerts.mapExecutionAlerts(executionRows);
  assert.equal(executionAlerts.length, 1, "a later success must resolve only the matching operation fingerprint");
  assert.equal(executionAlerts[0].evidence.operation_key, "posts_create");
  assert.equal(executionAlerts[0].evidence.failure_reason, "endpoint_not_found");
  assert.match(executionAlerts[0].source_record_id, /^execution:[a-f0-9]{64}$/, "execution source identity must fit the SQL column");

  assert.equal(
    _testingOperationalAlerts.executionSeverity("failed", { route_status: "resolved", recovery_status: "fallback_summary_used" }),
    "high",
    "fallback-backed resolved executions must not remain critical"
  );
  assert.equal(
    _testingOperationalAlerts.notificationEligible({
      severity: "high",
      lifecycle_status: "open",
      verification_state: "observed",
      source_record_id: "task-1",
      reason_code: "task_state_inconsistent",
    }),
    false,
    "observed data-quality mismatches must not enter the notification outbox"
  );
}

function executionRow(overrides = {}) {
  return {
    id: 100,
    tenant_id: "tenant-1",
    workspace_id: "workspace-1",
    entry_type: "sync_execution",
    execution_status: "failed",
    app_key: "github",
    workflow_key: "repo_sync",
    output_summary: "github_get_contents failed: upstream_error",
    failure_reason: "upstream_error",
    route_status: "failed",
    target_type: "repository",
    target_id: "repo-a",
    resource_type: "github_repository",
    resource_id: "repo-a",
    created_at: "2026-07-04T10:00:00.000Z",
    ...overrides,
  };
}

function testOperationalAlertLifecycleFingerprintFoundation() {
  const row = executionRow();
  assert.match(_testingOperationalAlerts.executionOperationFingerprint(row), /^[a-f0-9]{64}$/);
  assert.match(_testingOperationalAlerts.executionResourceFingerprint(row), /^[a-f0-9]{64}$/);

  const repoAFailure = executionRow({ id: 101, target_id: "repo-a", resource_id: "repo-a", created_at: "2026-07-04T10:00:00.000Z" });
  const repoBSuccess = executionRow({
    id: 102,
    execution_status: "success",
    output_summary: "github_get_contents completed with status success (200)",
    failure_reason: null,
    route_status: "resolved",
    target_id: "repo-b",
    resource_id: "repo-b",
    created_at: "2026-07-04T10:05:00.000Z",
  });
  const unrelatedResourceAlerts = _testingOperationalAlerts.mapExecutionAlerts([repoAFailure, repoBSuccess]);
  assert.equal(unrelatedResourceAlerts.length, 1, "success on repo-b must not resolve failure on repo-a");
  assert.equal(unrelatedResourceAlerts[0].evidence.resource_id, "repo-a");
  assert.match(unrelatedResourceAlerts[0].operation_fingerprint_sha256, /^[a-f0-9]{64}$/);
  assert.match(unrelatedResourceAlerts[0].resource_fingerprint_sha256, /^[a-f0-9]{64}$/);
  assert.equal(unrelatedResourceAlerts[0].operation_fingerprint_sha256, unrelatedResourceAlerts[0].evidence.operation_fingerprint_sha256);
  assert.equal(unrelatedResourceAlerts[0].resource_fingerprint_sha256, unrelatedResourceAlerts[0].evidence.resource_fingerprint_sha256);
  assert.match(unrelatedResourceAlerts[0].evidence.operation_fingerprint_sha256, /^[a-f0-9]{64}$/);
  assert.match(unrelatedResourceAlerts[0].evidence.resource_fingerprint_sha256, /^[a-f0-9]{64}$/);

  const repoASuccess = executionRow({
    id: 103,
    execution_status: "success",
    output_summary: "github_get_contents completed with status success (200)",
    failure_reason: null,
    route_status: "resolved",
    target_id: "repo-a",
    resource_id: "repo-a",
    created_at: "2026-07-04T10:06:00.000Z",
  });
  const matchingResourceAlerts = _testingOperationalAlerts.mapExecutionAlerts([repoAFailure, repoASuccess]);
  assert.equal(matchingResourceAlerts.length, 0, "later success on repo-a must resolve failure on repo-a");
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
    lifecycleUpdatedAt: "2026-06-14T13:00:00.000Z",
    verificationState: "verified",
    persisted: true,
    lastSeenAt: "2026-06-14T11:00:00.000Z",
  });
  const preserved = _testingOperationalAlerts.mergeCandidates([live, resolvedPersisted]);
  assert.equal(preserved[0].lifecycle_status, "resolved", "evidence older than the lifecycle resolution must not reopen the alert");

  const newerLive = _testingOperationalAlerts.candidate({
    alertKey: "alert.test",
    sourceType: "execution_log",
    title: "Failure",
    reasonCode: "execution_failed",
    severity: "critical",
    lifecycleStatus: "open",
    verificationState: "verified",
    lastSeenAt: "2026-06-14T14:00:00.000Z",
  });
  const reopened = _testingOperationalAlerts.mergeCandidates([newerLive, resolvedPersisted]);
  assert.equal(reopened[0].lifecycle_status, "open", "an occurrence newer than the lifecycle resolution must reopen the alert");
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

function testCapabilityDriftAgeSeverityEscalationPolicy() {
  const firstSeenAt = "2026-08-01T00:00:00.000Z";
  assert.equal(CAPABILITY_DRIFT_ESCALATION_POLICY.high_after_hours, 24);
  assert.equal(CAPABILITY_DRIFT_ESCALATION_POLICY.critical_after_hours, 72);

  const beforeHigh = evaluateCapabilityDriftAgeEscalation({
    baseSeverity: "medium",
    currentSeverity: "medium",
    firstSeenAt,
    observedAt: "2026-08-01T23:59:59.000Z",
  });
  assert.equal(beforeHigh.effective_severity, "medium");
  assert.equal(beforeHigh.age_escalated, false);
  assert.equal(beforeHigh.next_escalation_at, "2026-08-02T00:00:00.000Z");

  const high = evaluateCapabilityDriftAgeEscalation({
    baseSeverity: "medium",
    currentSeverity: "medium",
    firstSeenAt,
    observedAt: "2026-08-02T00:00:00.000Z",
  });
  assert.equal(high.effective_severity, "high");
  assert.equal(high.age_floor_severity, "high");
  assert.equal(high.age_escalated, true);
  assert.equal(high.blocker_age_hours, 24);

  const highAlreadyPersisted = evaluateCapabilityDriftAgeEscalation({
    baseSeverity: "medium",
    currentSeverity: "high",
    firstSeenAt,
    observedAt: "2026-08-03T00:00:00.000Z",
  });
  assert.equal(highAlreadyPersisted.effective_severity, "high");
  assert.equal(highAlreadyPersisted.age_escalated, false, "the same age floor must not emit duplicate escalation transitions");

  const critical = evaluateCapabilityDriftAgeEscalation({
    baseSeverity: "medium",
    currentSeverity: "high",
    firstSeenAt,
    observedAt: "2026-08-04T00:00:00.000Z",
  });
  assert.equal(critical.effective_severity, "critical");
  assert.equal(critical.age_floor_severity, "critical");
  assert.equal(critical.age_escalated, true);
  assert.equal(critical.blocker_age_hours, 72);
  assert.equal(critical.next_escalation_at, null);

  const strongerSource = evaluateCapabilityDriftAgeEscalation({
    baseSeverity: "critical",
    currentSeverity: "high",
    firstSeenAt,
    observedAt: "2026-08-01T01:00:00.000Z",
  });
  assert.equal(strongerSource.effective_severity, "critical");
  assert.equal(strongerSource.age_escalated, false, "source severity increases must not be misclassified as age escalation");

  const monotonic = evaluateCapabilityDriftAgeEscalation({
    baseSeverity: "medium",
    currentSeverity: "critical",
    firstSeenAt,
    observedAt: "2026-08-01T02:00:00.000Z",
  });
  assert.equal(monotonic.effective_severity, "critical", "an unresolved blocker must not be downgraded by a weaker source observation");
}

function testCapabilityDriftAlertLifecycleProjection() {
  const tenantVisible = {
    capability_key: "tenant_tool.wordpress_publish",
    gap_key: "active_export_missing",
    gap_severity: "high",
    display_name: "WordPress Publish",
    capability_family: "tenant_tool",
    source_table: "tenant_platform_endpoint_tools",
    source_key: "wordpress_publish",
    runtime_status: "active",
    exposure_scope: "tenant",
    operation_class: "tenant_tool_dispatch",
    risk_class: "B",
    maturity_status: "runtime_exists",
    maturity_score: 4,
    gap_flags: "active_export_missing",
    evidence_ref: null,
    observed_at: "2026-08-08T15:00:00.000Z",
  };
  const internalOnly = {
    ...tenantVisible,
    capability_key: "admin_tool.internal_repair",
    source_key: "internal_repair",
    exposure_scope: "admin",
  };
  const tenantOne = buildCapabilityDriftAlertInputs([tenantVisible, internalOnly], {
    subject: { is_admin: false, tenant_id: "tenant-1" },
  });
  assert.equal(tenantOne.length, 1, "tenant alert projection must exclude admin-only capability gaps");
  const first = tenantOne[0];
  assert.match(first.alertKey, /^capability-drift-alert\.[a-f0-9]{64}$/);
  assert.equal(first.sourceType, CAPABILITY_DRIFT_SOURCE);
  assert.equal(first.tenantId, "tenant-1");
  assert.equal(first.reasonCode, "capability_drift_active_export_missing");
  assert.equal(first.occurrenceCount, 1);
  assert.equal(first.verificationState, "verified");
  assert.equal(first.requiresConfirmation, false);
  assert.equal(first.evidence.tenant_visible, true);
  assert.equal(first.evidence.auto_repair_eligible, false);
  assert.equal(first.evidence.repair_class, "platform_admin_required");
  assert.equal(first.evidence.admin_evidence, undefined);

  const tenantTwoLater = buildCapabilityDriftAlertInputs([
    { ...tenantVisible, observed_at: "2026-08-08T16:00:00.000Z" },
  ], {
    subject: { is_admin: false, tenant_id: "tenant-2" },
  });
  assert.equal(tenantTwoLater[0].alertKey, first.alertKey, "platform-global capability drift must dedupe across tenant projections and observation times");
  assert.notEqual(tenantTwoLater[0].lastSeenAt, first.lastSeenAt);

  const persistenceInput = buildCapabilityDriftAlertInputs([tenantVisible], {
    subject: { is_admin: true },
    persistenceMode: true,
  })[0];
  assert.equal(persistenceInput.alertKey, first.alertKey);
  assert.equal(persistenceInput.tenantId, null, "Admin sync must persist one global tenant-visible capability alert, not one row per tenant");
  assert.equal(persistenceInput.evidence.admin_evidence.source_table, "tenant_platform_endpoint_tools");

  const persistedRow = {
    alert_id: "alert-capability-1",
    alert_key: first.alertKey,
    fingerprint_sha256: "a".repeat(64),
    operation_fingerprint_sha256: null,
    resource_fingerprint_sha256: null,
    source_type: CAPABILITY_DRIFT_SOURCE,
    source_ref: first.sourceRef,
    source_record_id: first.sourceRecordId,
    tenant_id: null,
    user_id: null,
    workspace_id: null,
    container_key: null,
    category: "capability_drift",
    severity: "high",
    title: first.title,
    summary: first.summary,
    reason_code: first.reasonCode,
    lifecycle_status: "investigating",
    verification_state: "verified",
    evidence_type: "platform_capability_gap",
    evidence_ref: first.evidenceRef,
    evidence_json: JSON.stringify({
      tenant_visible: true,
      capability_key: tenantVisible.capability_key,
      gap_key: tenantVisible.gap_key,
      admin_evidence: { source_table: "tenant_platform_endpoint_tools", source_key: "wordpress_publish" },
    }),
    occurrence_count: 7,
    first_seen_at: "2026-08-08T12:00:00.000Z",
    last_seen_at: "2026-08-08T15:00:00.000Z",
    updated_at: "2026-08-08T15:00:00.000Z",
    recommended_action_key: first.recommendedActionKey,
    requires_confirmation: 0,
    manual_known_issue: 0,
  };
  const tenantPersisted = _testingOperationalAlerts.mapPersistedAlert(persistedRow, {
    subject: { is_admin: false, tenant_id: "tenant-1" },
  });
  assert.equal(tenantPersisted.tenant_id, "tenant-1");
  assert.equal(tenantPersisted.lifecycle_status, "investigating");
  assert.equal(tenantPersisted.occurrence_count, 7);
  assert.equal(tenantPersisted.evidence.admin_evidence, undefined, "tenant persisted projection must strip Admin registry evidence");
  const adminPersisted = _testingOperationalAlerts.mapPersistedAlert(persistedRow, {
    subject: { is_admin: true },
  });
  assert.equal(adminPersisted.tenant_id, null);
  assert.equal(adminPersisted.evidence.admin_evidence.source_table, "tenant_platform_endpoint_tools");

  const newerLiveBaseSeverity = _testingOperationalAlerts.candidate({
    alertKey: first.alertKey,
    sourceType: CAPABILITY_DRIFT_SOURCE,
    sourceRef: first.sourceRef,
    sourceRecordId: first.sourceRecordId,
    tenantId: "tenant-1",
    category: "capability_drift",
    severity: "medium",
    title: first.title,
    summary: first.summary,
    reasonCode: first.reasonCode,
    lifecycleStatus: "open",
    verificationState: "verified",
    evidence: { tenant_visible: true, capability_key: tenantVisible.capability_key },
    firstSeenAt: "2026-08-08T12:00:00.000Z",
    lastSeenAt: "2026-08-08T16:30:00.000Z",
  });
  const persistedEscalated = _testingOperationalAlerts.candidate({
    alertId: "alert-capability-escalated",
    alertKey: first.alertKey,
    sourceType: CAPABILITY_DRIFT_SOURCE,
    sourceRef: first.sourceRef,
    sourceRecordId: first.sourceRecordId,
    category: "capability_drift",
    severity: "critical",
    title: first.title,
    summary: first.summary,
    reasonCode: first.reasonCode,
    lifecycleStatus: "investigating",
    verificationState: "verified",
    evidence: { tenant_visible: true, age_escalation: { policy_key: "capability_drift_age_escalation_v1" } },
    occurrenceCount: 9,
    firstSeenAt: "2026-08-05T12:00:00.000Z",
    lastSeenAt: "2026-08-08T16:00:00.000Z",
    persisted: true,
  });
  const mergedEscalated = _testingOperationalAlerts.mergeCandidates([newerLiveBaseSeverity, persistedEscalated]);
  assert.equal(mergedEscalated.length, 1);
  assert.equal(mergedEscalated[0].severity, "critical", "a newer live capability snapshot must not downgrade persisted age escalation");
  assert.equal(mergedEscalated[0].last_seen_at, newerLiveBaseSeverity.last_seen_at, "newer live freshness must still win");
  assert.equal(mergedEscalated[0].alert_id, "alert-capability-escalated");
  assert.equal(mergedEscalated[0].lifecycle_status, "investigating");

  const resolvedPriorEpisode = _testingOperationalAlerts.candidate({
    alertId: "alert-capability-resolved",
    alertKey: first.alertKey,
    sourceType: CAPABILITY_DRIFT_SOURCE,
    sourceRef: first.sourceRef,
    sourceRecordId: first.sourceRecordId,
    category: "capability_drift",
    severity: "critical",
    title: first.title,
    summary: first.summary,
    reasonCode: first.reasonCode,
    lifecycleStatus: "resolved",
    lifecycleUpdatedAt: "2026-08-08T16:00:00.000Z",
    verificationState: "verified",
    evidence: { tenant_visible: true, age_escalation: { policy_key: "capability_drift_age_escalation_v1" } },
    occurrenceCount: 12,
    firstSeenAt: "2026-08-01T12:00:00.000Z",
    lastSeenAt: "2026-08-08T15:00:00.000Z",
    persisted: true,
  });
  const reopenedEpisode = _testingOperationalAlerts.mergeCandidates([newerLiveBaseSeverity, resolvedPriorEpisode]);
  assert.equal(reopenedEpisode[0].lifecycle_status, "open", "a live occurrence newer than resolution must reopen the capability alert");
  assert.equal(reopenedEpisode[0].severity, "medium", "a new lifecycle episode must not inherit age-escalated severity from a resolved episode");
  assert.equal(reopenedEpisode[0].first_seen_at, newerLiveBaseSeverity.first_seen_at, "a new lifecycle episode must expose the new episode start instead of the resolved episode age");
  assert.equal(reopenedEpisode[0].last_seen_at, newerLiveBaseSeverity.last_seen_at);
  assert.equal(reopenedEpisode[0].alert_id, "alert-capability-resolved");
  assert.equal(_testingOperationalAlerts.notificationEligible({
    ...tenantPersisted,
    source_type: CAPABILITY_DRIFT_SOURCE,
    severity: "high",
    lifecycle_status: "open",
    verification_state: "verified",
    source_record_id: first.sourceRecordId,
  }), false, "global capability-drift alerts must not fan out notifications before an explicit policy exists");
}

function testRepositoryContracts() {
  const service = read("./operationalAlertService.js");
  const escalationPolicy = read("./capabilityDriftAlertEscalationPolicy.js");
  const routes = read("./routes/activationAwarenessRoutes.js");
  const awareness = read("./activationAwarenessService.js");
  const migration = read("./migrations/1013_sprint69_operational_alerting_control_plane.sql");
  const reconciliationMigration = read("./migrations/1015_sprint69_operational_alerting_p0_reconciliation.sql");
  const mutationReadbackMigration = read("./migrations/1031_sprint69_operational_alert_mutation_readback_policy.sql");
  const lifecycleFingerprintMigration = read("./migrations/20260704_operational_alert_lifecycle_fingerprints.sql");
  const governedMigrationRunner = read("./scripts/governed-migration-runner.mjs");
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
  assert.match(service, /collectExecutionLogSource/);
  assert.match(service, /v_platform_capability_gaps/);
  assert.match(service, /WHERE c\.exposure_scope = 'tenant'/);
  assert.match(service, /mysql_primary_capability_gap_view/);
  assert.match(service, /persistenceMode: true/);
  assert.match(service, /tenant_id IS NULL AND source_type = 'v_platform_capability_gaps'/);
  assert.match(service, /WHEN VALUES\(source_type\) = 'v_platform_capability_gaps' THEN occurrence_count \+ 1/);
  assert.match(service, /item\.source_type === CAPABILITY_DRIFT_SOURCE/);
  assert.match(service, /evaluateCapabilityDriftAgeEscalation/);
  assert.match(service, /severity_escalated/);
  assert.match(service, /system_age_escalation/);
  assert.match(service, /const capabilityDriftMerge/);
  assert.match(service, /preservePersistedCapabilitySeverity/);
  assert.match(service, /const mergedFirstSeenAt/);
  assert.match(service, /first_seen_at: mergedFirstSeenAt/);
  assert.match(service, /severity: mergedSeverity/);
  assert.match(service, /lifecycle_status IN \('resolved','ignored'\)/);
  assert.match(escalationPolicy, /capability_drift_age_escalation_v1/);
  assert.match(escalationPolicy, /high_after_hours: 24/);
  assert.match(escalationPolicy, /critical_after_hours: 72/);
  assert.doesNotMatch(service, /EXECUTION_LOG_MAX_ROWS/);
  assert.doesNotMatch(service, /execution_log: EXECUTION_LOG_MAX_ROWS/);
  assert.match(service, /COUNT\(\*\) AS occurrence_count/);
  assert.match(service, /WHERE NOT EXISTS/);
  assert.match(service, /sql_primary_execution_log_aggregate/);
  assert.match(service, /aggregation: "operation_resource_failure_groups"/);
  assert.match(service, /source_authority: "sql_primary_runtime_tables_plus_operational_alert_lifecycle"/);
  assert.match(service, /sheets_recovery_not_used_for_operational_alerts/);
  assert.match(service, /groupSkillApprovalRows/);
  assert.match(service, /notification_skipped_count/);
  assert.match(openapi, /notification_skipped_count/);
  assert.match(service, /alert_reconciled_before_delivery/);
  assert.match(service, /autoResolveStaleAlerts/);
  assert.match(service, /system_auto_resolution/);
  assert.match(service, /sync:\$\{runId\}:auto_resolve/);
  assert.match(service, /auto_resolution_reason: "source_no_longer_emitted"/);
  assert.match(service, /operation_fingerprint_sha256, resource_fingerprint_sha256/);
  assert.match(service, /operation_fingerprint_sha256 = VALUES\(operation_fingerprint_sha256\)/);
  assert.match(service, /resource_fingerprint_sha256 = VALUES\(resource_fingerprint_sha256\)/);
  assert.match(service, /operationFingerprintSha256: row\.operation_fingerprint_sha256/);
  assert.match(service, /resourceFingerprintSha256: row\.resource_fingerprint_sha256/);
  assert.match(service, /FOR UPDATE/);
  assert.match(service, /lifecycle_revision = lifecycle_revision \+ 1/);
  assert.match(service, /INSERT INTO operational_alert_lifecycle_events/);
  assert.match(service, /idempotency_key = \?/);
  assert.match(service, /idempotent_replay: true/);
  assert.match(service, /event: sanitizeEvidence/);
  assert.match(routes, /actorType: queryText\(req\.body\?\.actor_type/);
  assert.match(routes, /idempotencyKey: queryText\(req\.body\?\.idempotency_key/);
  assert.match(reconciliationMigration, /active_effective_scope_key/);
  assert.match(reconciliationMigration, /uq_agent_skill_grants_active_effective_scope/);
  assert.match(reconciliationMigration, /p0_reconciliation_required/);
  assert.match(reconciliationMigration, /no later success for the same operation fingerprint/);
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

  assert.match(
    migration,
    /activation_operational_attention_sync_api[\s\S]*state_changing[\s\S]*readback,same_cycle_readback/,
    "fresh installs must declare same-cycle readback for operational alert synchronization"
  );
  assert.match(
    migration,
    /activation_operational_alert_lifecycle_api[\s\S]*state_changing[\s\S]*readback,same_cycle_readback/,
    "fresh installs must declare same-cycle readback for alert lifecycle mutation"
  );
  assert.match(mutationReadbackMigration, /UPDATE admin_platform_endpoint_tools/);
  assert.match(mutationReadbackMigration, /activation_operational_attention_sync_api/);
  assert.match(mutationReadbackMigration, /activation_operational_alert_lifecycle_api/);
  assert.match(mutationReadbackMigration, /readback,same_cycle_readback/);
  assert.match(lifecycleFingerprintMigration, /operational_alert_lifecycle_events/);
  assert.match(lifecycleFingerprintMigration, /operation_fingerprint_sha256/);
  assert.match(lifecycleFingerprintMigration, /resource_fingerprint_sha256/);
  assert.match(lifecycleFingerprintMigration, /no later success for the same operation and resource fingerprints/);
  assert.match(governedMigrationRunner, /1031_sprint69_operational_alert_mutation_readback_policy\.sql/);
  assert.match(governedMigrationRunner, /20260704_operational_alert_lifecycle_fingerprints\.sql/);

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
  assert.match(openapi, /operation_fingerprint_sha256/);
  assert.match(openapi, /resource_fingerprint_sha256/);
  assert.match(openapi, /OperationalAlertReadResponse:/);
  assert.match(memory, /operational_alerting_state/);
  assert.match(auditCanonical, /Operational Alerting Evidence Contract/);
  assert.match(repairCanonical, /Operational Alerting Control Plane/);
  assert.match(guide, /Unified Operational Alerting/);

  const highAttentionClosureMigration = read("./migrations/20260722_close_verified_high_operational_attention.sql");
  assert.equal((highAttentionClosureMigration.match(/UPDATE platform_pending_tasks/g) || []).length, 7);
  assert.equal((highAttentionClosureMigration.match(/UPDATE operational_alerts/g) || []).length, 2);
  for (const taskId of [
    "12c6a37f-838b-11f1-9a4d-d342cf4a053c",
    "3fa74909-64af-11f1-8ecd-456940024c79",
    "8fbb84a1-61a9-11f1-8ecd-456940024c79",
    "b7667095-61cd-11f1-8ecd-456940024c79",
    "527cafca-61b9-11f1-8ecd-456940024c79",
    "22a15347-619d-11f1-8ecd-456940024c79",
    "90cb38e5-618e-11f1-8ecd-456940024c79",
  ]) assert.ok(highAttentionClosureMigration.includes(taskId), `closure migration must target task ${taskId}`);
  for (const alertId of [
    "150a4ebd-6b16-11f1-8ecd-456940024c79",
    "150a48ac-6b16-11f1-8ecd-456940024c79",
  ]) assert.ok(highAttentionClosureMigration.includes(alertId), `closure migration must target alert ${alertId}`);
  assert.match(highAttentionClosureMigration, /status = 'done'/);
  assert.match(highAttentionClosureMigration, /lifecycle_status = 'resolved'/);
  assert.match(highAttentionClosureMigration, /github_repository_main_moved_webhook_configured_and_verified/);
  assert.match(highAttentionClosureMigration, /webhook_hook_id', 655391973/);
  assert.match(highAttentionClosureMigration, /ping_delivery_status_code', 200/);
  assert.match(highAttentionClosureMigration, /production_uses_github_main_auto_deploy/);
  assert.match(highAttentionClosureMigration, /ssh_break_glass_only', TRUE/);
  assert.match(highAttentionClosureMigration, /ready_for_live_provider_dispatch/);
  assert.match(highAttentionClosureMigration, /policy_disabled_by_design/);
  assert.match(highAttentionClosureMigration, /release-operation:\/\/5cdc3adc-2022-4f37-908c-eb5cb3c7339d/);
  assert.match(highAttentionClosureMigration, /policy:\/\/hostinger_deploy_release_apply_policy_v1/);
  assert.match(highAttentionClosureMigration, /migration_provider_call_executed', FALSE/);
  assert.match(highAttentionClosureMigration, /migration_external_write_executed', FALSE/);
  assert.match(highAttentionClosureMigration, /secrets_included', FALSE/);
  assert.doesNotMatch(highAttentionClosureMigration, /\bDELETE\s+FROM\b|\bDROP\s+(TABLE|VIEW|DATABASE)\b|\bTRUNCATE\b|\bALTER\s+TABLE\b/i);

  const persistedAlertClosureMigration = read("./migrations/20260722_resolve_persisted_completed_task_alerts.sql");
  assert.equal((persistedAlertClosureMigration.match(/UPDATE operational_alerts/g) || []).length, 6);
  for (const alertId of [
    "0caaa888-3da1-4db1-93fe-07ba2b00cc13",
    "239736b0-26e0-492b-8cef-f77731b263b2",
    "52f68ac6-7e1d-4d31-977b-cb74085b43f2",
    "5efecea9-bb01-49ea-99fd-534dba5bbc5e",
    "8e36b98d-0424-4600-b3b8-e662fcb56baa",
    "9f1d3538-76f9-4579-9308-16b7a2fb7a97",
  ]) assert.ok(persistedAlertClosureMigration.includes(alertId), `persisted alert closure migration must target alert ${alertId}`);
  for (const sourceTaskId of [
    "8fbb84a1-61a9-11f1-8ecd-456940024c79",
    "527cafca-61b9-11f1-8ecd-456940024c79",
    "90cb38e5-618e-11f1-8ecd-456940024c79",
    "b7667095-61cd-11f1-8ecd-456940024c79",
    "3fa74909-64af-11f1-8ecd-456940024c79",
    "22a15347-619d-11f1-8ecd-456940024c79",
  ]) assert.ok(persistedAlertClosureMigration.includes(sourceTaskId), `persisted alert closure migration must bind source task ${sourceTaskId}`);
  assert.match(persistedAlertClosureMigration, /lifecycle_status = 'resolved'/);
  assert.match(persistedAlertClosureMigration, /verification_state = 'verified'/);
  assert.match(persistedAlertClosureMigration, /completed_source_task_readback/);
  assert.match(persistedAlertClosureMigration, /source_task_status', 'done'/);
  assert.match(persistedAlertClosureMigration, /policy_disabled_by_design/);
  assert.match(persistedAlertClosureMigration, /verified_complete/);
  assert.match(persistedAlertClosureMigration, /superseded/);
  assert.match(persistedAlertClosureMigration, /migration_provider_call_executed', FALSE/);
  assert.match(persistedAlertClosureMigration, /migration_external_write_executed', FALSE/);
  assert.match(persistedAlertClosureMigration, /secrets_included', FALSE/);
  assert.doesNotMatch(persistedAlertClosureMigration, /\bDELETE\s+FROM\b|\bDROP\s+(TABLE|VIEW|DATABASE)\b|\bTRUNCATE\b|\bALTER\s+TABLE\b/i);

  const criticalClosureMigration = read("./migrations/20260722_resolve_remaining_critical_operational_attention.sql");
  assert.equal((criticalClosureMigration.match(/UPDATE platform_pending_tasks/g) || []).length, 3);
  assert.equal((criticalClosureMigration.match(/UPDATE operational_alerts/g) || []).length, 5);
  for (const taskId of [
    "3fa74049-64af-11f1-8ecd-456940024c79",
    "3fa74621-64af-11f1-8ecd-456940024c79",
    "1874d119-5890-11f1-9baf-8e76a7e1749f",
  ]) assert.ok(criticalClosureMigration.includes(taskId), `critical closure migration must target task ${taskId}`);
  for (const alertId of [
    "794d27b0-4e22-4098-bed9-662787393255",
    "2f9b466d-10a6-40a6-a652-3dc05e4a76fd",
    "6216cf2b-96e3-4cc4-8bc8-4e6b8ae7cf4d",
    "0a46b352-18d6-49e2-b8f8-147558d62768",
    "6b1cb6c7-032a-4911-bd37-731064d4073f",
  ]) assert.ok(criticalClosureMigration.includes(alertId), `critical closure migration must target alert ${alertId}`);
  assert.match(criticalClosureMigration, /status = 'done'/);
  assert.match(criticalClosureMigration, /lifecycle_status = 'resolved'/);
  assert.match(criticalClosureMigration, /verification_state = 'verified'/);
  assert.match(criticalClosureMigration, /policy_disabled_by_design/);
  assert.match(criticalClosureMigration, /google_ads_execution_enablement_intentionally_disabled/);
  assert.match(criticalClosureMigration, /production_uses_github_main_auto_deploy/);
  assert.match(criticalClosureMigration, /ssh_normal_updates_allowed', FALSE/);
  assert.match(criticalClosureMigration, /ssh_break_glass_only', TRUE/);
  assert.match(criticalClosureMigration, /openclaude_bridge_ready_for_live_provider_dispatch/);
  assert.match(criticalClosureMigration, /ready_for_live_provider_dispatch/);
  assert.match(criticalClosureMigration, /apply_allowed', FALSE/);
  assert.match(criticalClosureMigration, /migration_provider_call_executed', FALSE/);
  assert.match(criticalClosureMigration, /migration_external_write_executed', FALSE/);
  assert.match(criticalClosureMigration, /migration_external_send_executed', FALSE/);
  assert.match(criticalClosureMigration, /credential_payload_read', FALSE/);
  assert.match(criticalClosureMigration, /raw_secrets_included', FALSE/);
  assert.match(criticalClosureMigration, /secrets_included', FALSE/);
  assert.doesNotMatch(criticalClosureMigration, /\bDELETE\s+FROM\b|\bDROP\s+(TABLE|VIEW|DATABASE)\b|\bTRUNCATE\b|\bALTER\s+TABLE\b/i);

  const mediumClosureMigration = read("./migrations/20260722_resolve_verified_medium_readiness_and_connector_attention.sql");
  assert.equal((mediumClosureMigration.match(/UPDATE readiness_checks/g) || []).length, 4);
  assert.equal((mediumClosureMigration.match(/UPDATE connected_systems/g) || []).length, 1);
  assert.equal((mediumClosureMigration.match(/UPDATE operational_alerts/g) || []).length, 6);
  for (const checkId of [
    "4226f266-6287-11f1-8ecd-456940024c79",
    "84d2dc4c-627a-11f1-8ecd-456940024c79",
    "07f00750-6267-11f1-8ecd-456940024c79",
    "eb8b482f-625b-11f1-8ecd-456940024c79",
    "c43d3458-61c6-11f1-8ecd-456940024c79",
    "3efd554e-61b5-11f1-8ecd-456940024c79",
    "openclaude-provider-bridge-contract-",
    "9346bcab-4b65-11f1-b256-614c56cd019b",
    "e36d7196-4b64-11f1-b256-614c56cd019b",
    "a7e37ab2-4b63-11f1-b256-614c56cd019b",
  ]) assert.ok(mediumClosureMigration.includes(checkId), `medium closure migration must target readiness check ${checkId}`);
  for (const alertId of [
    "a1035373-9ab4-4cc1-93f5-54f4a66d84b6",
    "a8c8f20e-cba7-4318-b778-0295f589da3c",
    "9c6ea599-f149-47f0-929b-7eb08dc497db",
    "e964acba-6684-4bb2-98aa-a8a15eca8fae",
    "546b79a1-e2fc-48d7-bf4e-297582b4a0ff",
    "be604cb0-e550-4b71-93e6-948028c410ae",
    "8858b083-5afd-4d1d-b878-68c90ba825a2",
    "2c18a318-22aa-4e33-97a4-cc7d93ff1fdb",
    "b812e948-2e57-4a4d-aa1c-823c99ec529c",
    "191fc2a7-e864-4c7a-81d2-ac8a416173b8",
    "150a5110-6b16-11f1-8ecd-456940024c79",
    "aa5ad403-92f1-4ffd-bf04-9ec7b49b43b1",
  ]) assert.ok(mediumClosureMigration.includes(alertId), `medium closure migration must target alert ${alertId}`);
  assert.match(mediumClosureMigration, /check_status = 'pass'/);
  assert.match(mediumClosureMigration, /status = 'archived'/);
  assert.match(mediumClosureMigration, /lifecycle_status = 'resolved'/);
  assert.match(mediumClosureMigration, /github_main_auto_deploy/);
  assert.match(mediumClosureMigration, /credential_intake_contract_and_test_readback/);
  assert.match(mediumClosureMigration, /ready_for_live_provider_dispatch/);
  assert.match(mediumClosureMigration, /system_facade_callability_readback/);
  assert.match(mediumClosureMigration, /durable_response_chunk_contract_readback/);
  assert.match(mediumClosureMigration, /active_connector_replacement_readback/);
  assert.match(mediumClosureMigration, /migration_provider_call_executed', FALSE/);
  assert.match(mediumClosureMigration, /migration_external_write_executed', FALSE/);
  assert.match(mediumClosureMigration, /migration_external_send_executed', FALSE/);
  assert.match(mediumClosureMigration, /credential_payload_read', FALSE/);
  assert.match(mediumClosureMigration, /secrets_included', FALSE/);
  assert.doesNotMatch(mediumClosureMigration, /\bDELETE\s+FROM\b|\bDROP\s+(TABLE|VIEW|DATABASE)\b|\bTRUNCATE\b|\bALTER\s+TABLE\b/i);

  const hostingerOccurrenceRefreshMigration = read("./migrations/20260723_refresh_hostinger_ssh_deploy_policy_occurrence_resolution.sql");
  assert.equal((hostingerOccurrenceRefreshMigration.match(/UPDATE operational_alerts/g) || []).length, 1);
  assert.match(hostingerOccurrenceRefreshMigration, /c916daf6-32d9-46f1-ba95-2c718900f3f0/);
  assert.match(hostingerOccurrenceRefreshMigration, /execution:060bda5fdc0941a2efa4c09f1c293e7d5bd0f2bfead4d8b1825208ff7026deeb/);
  assert.match(hostingerOccurrenceRefreshMigration, /lifecycle_status = 'resolved'/);
  assert.match(hostingerOccurrenceRefreshMigration, /resolved_at < '2026-07-22 23:30:20'/);
  assert.match(hostingerOccurrenceRefreshMigration, /execution-log:\/\/33325/);
  assert.match(hostingerOccurrenceRefreshMigration, /root_fix_merge_sha', '3507f4098ef56179fd35d732b8890983ec14924a'/);
  assert.match(hostingerOccurrenceRefreshMigration, /future_newer_occurrence_reopens', TRUE/);
  assert.match(hostingerOccurrenceRefreshMigration, /migration_provider_call_executed', FALSE/);
  assert.match(hostingerOccurrenceRefreshMigration, /migration_external_write_executed', FALSE/);
  assert.match(hostingerOccurrenceRefreshMigration, /credential_payload_read', FALSE/);
  assert.match(hostingerOccurrenceRefreshMigration, /secrets_included', FALSE/);
  assert.doesNotMatch(hostingerOccurrenceRefreshMigration, /\bDELETE\s+FROM\b|\bDROP\s+(TABLE|VIEW|DATABASE)\b|\bTRUNCATE\b|\bALTER\s+TABLE\b/i);
}

async function main() {
  testKnownIssueCoverage();
  testSensitiveEvidenceStripping();
  testStableKeysAndExecutionGrouping();
  testP0ReconciliationSemantics();
  testOperationalAlertLifecycleFingerprintFoundation();
  testDedupeAndLifecyclePrecedence();
  testCapabilityDriftAgeSeverityEscalationPolicy();
  testCapabilityDriftAlertLifecycleProjection();
  testSummaryAndRouteInputs();
  testRepositoryContracts();
  console.log("operational alerting control plane contract tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
