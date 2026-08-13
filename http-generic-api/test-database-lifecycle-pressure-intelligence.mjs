import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildDatabaseLifecycleImmutablePlan,
  buildDatabaseLifecyclePressureIntelligence,
  buildDatabaseLifecyclePressureSummary,
  classifyDatabaseLifecycleDomain,
  collectDatabaseLifecyclePressureEvidence,
  resolveDatabaseLifecycleDomainPolicy,
} from "./databaseLifecyclePressureIntelligence.js";

const platformRoutesSource = fs.readFileSync(new URL("./routes/platformEngineRoutes.js", import.meta.url), "utf8");
assert.match(platformRoutesSource, /router\.get\("\/platform\/engines\/database-lifecycle\/pressure-intelligence", \.\.\.requireAdmin/);
assert.doesNotMatch(platformRoutesSource, /router\.post\("\/platform\/engines\/database-lifecycle\/pressure-intelligence"/);

const tables = [
  {
    table_name: "governed_tool_response_chunks",
    approx_rows: 12000,
    size_bytes: 8_000_000,
    data_free_bytes: 500_000,
    eligible_cleanup_bytes: 2_000_000,
    estimated_reclaimable_bytes: 300_000,
    lifecycle_registered: true,
  },
  {
    table_name: "repo_file_audit_findings",
    approx_rows: 2500,
    size_bytes: 4_000_000,
    data_free_bytes: 100_000,
    lifecycle_registered: true,
  },
  {
    table_name: "platform_engine_execution_runs",
    approx_rows: 9000,
    size_bytes: 12_000_000,
    data_free_bytes: 1_000_000,
    lifecycle_registered: false,
  },
];

const pressure = buildDatabaseLifecyclePressureSummary({
  capacity: { used_bytes: 85, free_bytes: 15, quota_bytes: 100, data_free_bytes: 7 },
  tables,
  previous_observation: { used_bytes: 70, free_bytes: 30, observed_at: "2026-08-11T00:00:00Z" },
  observed_at: "2026-08-13T00:00:00Z",
  policy_coverage: { status: "available", observed_table_count: 3, covered_table_count: 2, coverage_percent: 66.666667 },
});
assert.equal(pressure.pressure_report_type, "database_lifecycle_pressure_intelligence_v1");
assert.equal(pressure.capacity.used_percent, 85);
assert.equal(pressure.capacity.pressure_state, "plan_review_required");
assert.equal(pressure.growth.bytes_per_day, 7.5);
assert.equal(pressure.growth.time_to_full_days, 2);
assert.equal(pressure.largest_tables[0].table_name, "platform_engine_execution_runs");
assert.equal(pressure.cleanup_estimates.eligible_cleanup_bytes, 2_000_000);
assert.equal(pressure.cleanup_estimates.estimated_physical_reclaimable_bytes, 1_400_000);
assert.equal(pressure.safety.will_execute, false);
assert.equal(pressure.safety.no_delete, true);
assert.equal(pressure.safety.no_compaction_execution, true);

const unknownCapacity = buildDatabaseLifecyclePressureSummary({ capacity: { used_bytes: 100 }, tables });
assert.equal(unknownCapacity.capacity.used_percent, null);
assert.equal(unknownCapacity.capacity.pressure_state, "capacity_unknown");

const responseDomain = classifyDatabaseLifecycleDomain({ table_name: "governed_tool_response_chunks" });
assert.equal(responseDomain.semantic_class, "authoritative_ttl");
assert.equal(responseDomain.policy_key, "database.response_chunks.expired_cleanup");
assert.equal(responseDomain.execution_allowed, false);

const auditDomain = classifyDatabaseLifecycleDomain({ table_name: "repo_file_audit_findings" });
assert.ok(auditDomain.preservation_rules.includes("preserve_latest_observation_per_file"));

const engineDomain = classifyDatabaseLifecycleDomain({ table_name: "platform_engine_execution_runs" });
assert.equal(engineDomain.semantic_class, "unknown_retention_lineage_sensitive");
assert.equal(engineDomain.execution_allowed, false);

const unknownDomain = classifyDatabaseLifecycleDomain({ table_name: "new_unknown_table" });
assert.equal(unknownDomain.policy_status, "blocked_policy_missing");
assert.equal(unknownDomain.execution_allowed, false);

const missingPolicy = resolveDatabaseLifecycleDomainPolicy({ domain: responseDomain, policies: {} });
assert.equal(missingPolicy.ok, false);
assert.deepEqual(missingPolicy.blockers, ["DATABASE_LIFECYCLE_POLICY_MISSING"]);

const resolvedPolicy = resolveDatabaseLifecycleDomainPolicy({
  domain: responseDomain,
  policies: {
    "database.response_chunks.expired_cleanup": {
      policy_version: "1",
      retention_basis: "authoritative_expires_at",
      cutoff_strategy: "immutable_plan_cutoff",
      preservation_rules: ["preserve_rows_after_immutable_cutoff"],
      approved: true,
    },
  },
});
assert.equal(resolvedPolicy.ok, true);
assert.equal(resolvedPolicy.execution_allowed, false);

const planArgs = {
  resource_uri: "mysql://growthOS/governed_tool_response_chunks",
  resource_version: "registry:v1",
  recipe_key: "database.response_chunks.expired_cleanup",
  policy: resolvedPolicy,
  cutoff_at: "2026-08-13T00:00:00Z",
  candidates: [
    { candidate_key: "chunk-2", expires_at: "2026-08-12T00:00:00Z", payload_bytes: 20 },
    { candidate_key: "chunk-1", expires_at: "2026-08-11T00:00:00Z", payload_bytes: 10 },
  ],
  risk_class: "medium",
  batch_size: 500,
  max_batches: 20,
};
const planA = buildDatabaseLifecycleImmutablePlan(planArgs);
const planB = buildDatabaseLifecycleImmutablePlan({ ...planArgs, candidates: [...planArgs.candidates].reverse() });
assert.equal(planA.ok, true);
assert.equal(planA.status, "ready_for_review");
assert.equal(planA.plan_fingerprint, planB.plan_fingerprint);
assert.equal(planA.candidates[0].candidate_key, "chunk-1");
assert.equal(planA.requires_typed_confirmation, true);
assert.equal(planA.requires_same_cycle_readback, true);
assert.equal(planA.authority_requirement, "exact_resource_and_recipe");
assert.equal(planA.execution_allowed, false);
assert.equal(planA.will_write, false);
assert.equal(planA.no_delete, true);
assert.equal(planA.no_archive_execution, true);
assert.equal(planA.no_compaction_execution, true);
assert.equal(planA.secrets_included, false);

const blockedPlan = buildDatabaseLifecycleImmutablePlan({ ...planArgs, resource_uri: "mysql://growthOS/*", policy: missingPolicy });
assert.equal(blockedPlan.ok, false);
assert.equal(blockedPlan.status, "blocked");
assert.ok(blockedPlan.blockers.includes("DATABASE_RESOURCE_NOT_REGISTERED"));
assert.ok(blockedPlan.blockers.includes("DATABASE_LIFECYCLE_POLICY_MISSING"));
assert.equal(blockedPlan.execution_allowed, false);

const intelligence = buildDatabaseLifecyclePressureIntelligence({
  capacity: { used_bytes: 85, free_bytes: 15, quota_bytes: 100 },
  tables,
  observed_at: "2026-08-13T00:00:00Z",
  policies: {
    "database.response_chunks.expired_cleanup": {
      policy_version: "1",
      retention_basis: "authoritative_expires_at",
      preservation_rules: ["preserve_rows_after_immutable_cutoff"],
      approved: true,
    },
  },
  plan_requests: [{
    domain_key: "governed_tool_response_chunks",
    resource_uri: "mysql://growthOS/governed_tool_response_chunks",
    resource_version: "registry:v1",
    cutoff_at: "2026-08-13T00:00:00Z",
    candidates: [{ candidate_key: "chunk-1" }],
    batch_size: 100,
    max_batches: 5,
  }],
});
assert.equal(intelligence.ok, true);
assert.equal(intelligence.plans.length, 1);
assert.equal(intelligence.plans[0].execution_allowed, false);
assert.equal(intelligence.secrets_included, false);

let queryCount = 0;
const fakePool = {
  async query(sql, params = []) {
    queryCount += 1;
    assert.match(sql, /^\s*SELECT/i, "pressure collector must be SELECT-only");
    assert.ok(!/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|OPTIMIZE)\b/i.test(sql));
    if (params.length) assert.equal(params.length, 1);
    if (/COUNT\(\*\)/i.test(sql)) return [[{ used_bytes: 100, data_free_bytes: 5, table_count: 3 }]];
    return [[...tables]];
  },
};
const collected = await collectDatabaseLifecyclePressureEvidence({ limit: 3, observed_at: "2026-08-13T00:00:00Z" }, { pool: fakePool });
assert.equal(queryCount, 3);
assert.equal(collected.pressure.safety.will_write, false);
assert.equal(collected.pressure.safety.will_execute, false);
assert.equal(collected.pressure.capacity.used_percent, null);
assert.equal(collected.secrets_included, false);

console.log("database lifecycle pressure intelligence tests passed");
