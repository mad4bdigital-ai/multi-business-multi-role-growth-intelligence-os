import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  dynamicContainerProjectionApplyConfirmation,
  readDynamicContainerProjectionApply,
  runDynamicContainerProjectionApply,
} from "./dynamicContainerProjectionApplyTool.js";

const SNAPSHOT = "a".repeat(64);
const ENVELOPE_ID = "11111111-2222-4333-8444-555555555555";

function fakePlan() {
  return {
    projectionRunId: "projection-run-1044",
    sourceSnapshotSha256: SNAPSHOT,
    containers: [
      { container_id: "container-1", tenant_id: "tenant-1" },
      { container_id: "container-2", tenant_id: "tenant-1" },
    ],
    relationships: [{ relationship_id: "relationship-1" }],
    roleAssignments: [{ assignment_id: "assignment-1" }],
    resourceBindings: [{ binding_id: "binding-1" }],
    issues: [{ status: "held", severity: "high" }],
    summary: {
      projectedContainerCount: 2,
      projectedRelationshipCount: 1,
      projectedRoleAssignmentCount: 1,
      projectedResourceBindingCount: 1,
      heldIssueCount: 1,
      highRiskIssueCount: 1,
      providerCalls: false,
      credentialPayloadReads: false,
      secretsIncluded: false,
    },
    secretsIncluded: false,
  };
}

function baseInput(mode = "dry_run") {
  return {
    mode,
    expected_source_snapshot_sha256: SNAPSHOT,
    expected_projected_container_count: 2,
    expected_projected_relationship_count: 1,
    expected_projected_role_assignment_count: 1,
    expected_projected_resource_binding_count: 1,
    expected_held_issue_count: 1,
    expected_high_risk_issue_count: 1,
    confirm: mode === "apply" ? dynamicContainerProjectionApplyConfirmation(SNAPSHOT) : undefined,
    capability_envelope_id: mode === "apply" ? ENVELOPE_ID : undefined,
  };
}

assert.equal(
  dynamicContainerProjectionApplyConfirmation(SNAPSHOT),
  "APPLY_DYNAMIC_CONTAINER_PROJECTION_AAAAAAAAAAAA"
);
assert.equal(dynamicContainerProjectionApplyConfirmation("invalid"), "");

{
  let applied = false;
  const result = await runDynamicContainerProjectionApply(baseInput(), {
    buildPlan: async () => fakePlan(),
    applyPlan: async () => { applied = true; },
  });
  assert.equal(result.ok, true);
  assert.equal(result.mode, "dry_run");
  assert.equal(result.applies_projection, false);
  assert.equal(applied, false);
  assert.equal(result.required_confirmation, dynamicContainerProjectionApplyConfirmation(SNAPSHOT));
}

await assert.rejects(
  () => runDynamicContainerProjectionApply({
    ...baseInput(),
    expected_source_snapshot_sha256: "b".repeat(64),
  }, { buildPlan: async () => fakePlan() }),
  (error) => error.code === "dynamic_container_projection_source_snapshot_mismatch"
);

await assert.rejects(
  () => runDynamicContainerProjectionApply({
    ...baseInput(),
    expected_projected_container_count: 3,
  }, { buildPlan: async () => fakePlan() }),
  (error) => error.code === "dynamic_container_projection_expected_counts_mismatch"
);

await assert.rejects(
  () => runDynamicContainerProjectionApply({
    ...baseInput("apply"),
    confirm: "WRONG",
  }, { buildPlan: async () => fakePlan() }),
  (error) => error.code === "dynamic_container_projection_apply_confirmation_required"
);

{
  const calls = [];
  const result = await runDynamicContainerProjectionApply(baseInput("apply"), {
    buildPlan: async () => fakePlan(),
    resolveEnvelope: async ({ envelopeId }) => {
      calls.push(`resolve:${envelopeId}`);
      return { ok: true, apply_allowed: true, envelope_id: envelopeId };
    },
    markReferenced: async ({ envelopeId }) => {
      calls.push(`reference:${envelopeId}`);
      return { ok: true };
    },
    applyPlan: async (plan) => {
      calls.push(`apply:${plan.projectionRunId}`);
      return { ok: true, projectionRunId: plan.projectionRunId, status: "completed" };
    },
    readback: async (plan) => {
      calls.push(`readback:${plan.projectionRunId}`);
      return { ok: true, expected_counts: {}, actual_counts: {}, count_mismatches: [] };
    },
    consumeEnvelope: async ({ envelopeId, executionRef }) => {
      calls.push(`consume:${envelopeId}:${executionRef}`);
      return { ok: true, after: { execution_status: "executed" } };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.applies_projection, true);
  assert.equal(result.envelope.consumed, true);
  assert.deepEqual(calls, [
    `resolve:${ENVELOPE_ID}`,
    `reference:${ENVELOPE_ID}`,
    "apply:projection-run-1044",
    "readback:projection-run-1044",
    `consume:${ENVELOPE_ID}:projection-run-1044`,
  ]);
}

{
  let consumed = false;
  await assert.rejects(
    () => runDynamicContainerProjectionApply(baseInput("apply"), {
      buildPlan: async () => fakePlan(),
      resolveEnvelope: async () => ({ ok: true, apply_allowed: true }),
      applyPlan: async () => ({ ok: true }),
      readback: async () => ({ ok: false, count_mismatches: [{ field: "projectedContainerCount" }] }),
      consumeEnvelope: async () => { consumed = true; return { ok: true }; },
    }),
    (error) => error.code === "dynamic_container_projection_apply_readback_failed"
  );
  assert.equal(consumed, false);
}

{
  const pool = {
    async query(sql) {
      const text = String(sql);
      if (text.includes("FROM container_projection_runs")) {
        return [[{
          projection_run_id: "projection-run-1044",
          mode: "apply",
          status: "completed",
          source_snapshot_sha256: SNAPSHOT,
          projected_container_count: 2,
          projected_relationship_count: 1,
          held_issue_count: 1,
          summary_json: JSON.stringify({ projectedRoleAssignmentCount: 1, projectedResourceBindingCount: 1 }),
          completed_at: "2026-07-11T18:23:45.000Z",
          secrets_included: 0,
        }]];
      }
      if (text.includes("FROM containers WHERE container_id IN")) return [[{ row_count: 2 }]];
      if (text.includes("FROM container_relationships WHERE relationship_id IN")) return [[{ row_count: 1 }]];
      if (text.includes("FROM container_role_assignments WHERE assignment_id IN")) return [[{ row_count: 1 }]];
      if (text.includes("FROM container_resource_bindings WHERE binding_id IN")) return [[{ row_count: 1 }]];
      if (text.includes("FROM container_relationships r")) return [[{ row_count: 0 }]];
      if (text.includes("FROM container_role_assignments a")) return [[{ row_count: 0 }]];
      if (text.includes("FROM container_resource_bindings b")) return [[{ row_count: 0 }]];
      if (text.includes("FROM platform_graph_nodes n")) return [[{ row_count: 1 }]];
      if (text.includes("FROM platform_graph_edges e")) return [[{ row_count: 0 }]];
      if (text.includes("FROM container_closure closure_row")) return [[{ row_count: 0 }]];
      throw new Error(`Unexpected SQL in orphan readback test: ${text}`);
    },
  };
  const readback = await readDynamicContainerProjectionApply(fakePlan(), { pool });
  assert.equal(readback.ok, false);
  assert.deepEqual(readback.count_mismatches, []);
  assert.equal(readback.orphan_references.graph_nodes, 1);
  assert.equal(readback.orphan_references.total, 1);
}

const routeSource = readFileSync("routes/gptToolsRoutes.js", "utf8");
const manifestSource = readFileSync("scripts/test-manifest.mjs", "utf8");
const migrationSource = readFileSync("migrations/1044_sprint69_dynamic_container_projection_apply_governance.sql", "utf8");
const remediationMigrationSource = readFileSync("migrations/1045_sprint69_dynamic_container_canonical_id_remediation.sql", "utf8");
assert.ok(routeSource.includes("dynamic_container_projection_apply"));
assert.ok(routeSource.includes("runDynamicContainerProjectionApply"));
assert.ok(routeSource.includes("acceptedCapabilityKeys: [\"dynamic_container_projection_apply\"]"));
assert.ok(routeSource.includes("action: \"consume\""));
assert.ok(manifestSource.includes("test-dynamic-container-projection-apply-tool.mjs"));
assert.ok(migrationSource.includes("dynamic_container_projection_apply_policy_v1"));
assert.ok(migrationSource.includes("same_cycle_projection_readback_required"));

console.log("dynamic container projection apply tool tests passed");
