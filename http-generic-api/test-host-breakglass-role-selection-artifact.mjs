import assert from "node:assert/strict";
import test from "node:test";
import { computeRoleSelectionProofHash } from "./roleSelectionProof.js";
import { __hostBreakglassRoleSelectionArtifactTest, resolveDurableRoleSelectionProof } from "./hostBreakglassRoleSelectionArtifact.js";

const SHA = "a".repeat(40);
const TARGET_FP = "b".repeat(64);
const NOW = Date.parse("2026-09-06T09:00:00.000Z");

function fullInspection(overrides = {}) {
  return {
    mode: "dry_run",
    operation: "read_only",
    full_inspection: true,
    status: "dry_run_complete",
    target_key: "production-runtime",
    target_binding: { target_fingerprint: TARGET_FP },
    source_binding: { expected_sha: SHA },
    role_database_object_counts: {
      runtime: { tables: 5, views: 0, triggers: 0, routines: 0, events: 0, total: 5 },
      governance: { tables: 0, views: 0, triggers: 0, routines: 0, events: 0, total: 0 },
      runtime_persistence: { tables: 0, views: 0, triggers: 0, routines: 0, events: 0, total: 0 },
    },
    role_database_object_classifications: { runtime: "nonempty", governance: "zero_objects", runtime_persistence: "zero_objects" },
    role_database_object_count_fingerprints: { runtime: "1".repeat(64), governance: "2".repeat(64), runtime_persistence: "3".repeat(64) },
    selected_rebuild_roles: ["governance", "runtime_persistence"],
    role_selection_source: "inspection_derived_zero_object_roles",
    database_mutation_performed: false,
    migration_apply_performed: false,
    grant_mutation_performed: false,
    secrets_included: false,
    ...overrides,
  };
}

test("durable full-inspection result derives the canonical rich role-selection proof", () => {
  const proof = __hostBreakglassRoleSelectionArtifactTest.deriveProofFromResult(fullInspection(), {
    expectedSha: SHA,
    targetKey: "production-runtime",
    runId: "12345",
    correlationId: "inspection-correlation-001",
    artifactCreatedAt: "2026-09-06T08:30:00.000Z",
    now: NOW,
  });
  assert.equal(proof.source, "durable_full_inspection");
  assert.equal(proof.inspection_run_id, "run:github:12345");
  assert.deepEqual(proof.selected_roles, ["governance", "runtime_persistence"]);
  assert.equal(proof.role_database_object_counts.runtime_persistence.total, 0);
  assert.equal(proof.selection_hash, computeRoleSelectionProofHash(proof));
  assert.match(proof.inspection_evidence_hash, /^[0-9a-f]{64}$/u);
  assert.equal(proof.finding_ids.length, 2);
});

test("selected non-zero roles are rejected instead of being trusted from the artifact", () => {
  const result = fullInspection({
    selected_rebuild_roles: ["runtime"],
    role_database_object_classifications: { runtime: "nonempty", governance: "zero_objects", runtime_persistence: "zero_objects" },
  });
  assert.throws(
    () => __hostBreakglassRoleSelectionArtifactTest.deriveProofFromResult(result, { expectedSha: SHA, targetKey: "production-runtime", runId: "12345", correlationId: "inspection-correlation-001", artifactCreatedAt: "2026-09-06T08:30:00.000Z", now: NOW }),
    (error) => error?.code === "host_breakglass_role_selection_nonzero_role",
  );
});

test("wrong SHA, stale evidence, and tampered canonical proof hash fail closed", () => {
  assert.throws(
    () => __hostBreakglassRoleSelectionArtifactTest.deriveProofFromResult(fullInspection({ source_binding: { expected_sha: "f".repeat(40) } }), { expectedSha: SHA, targetKey: "production-runtime", runId: "12345", correlationId: "inspection-correlation-001", artifactCreatedAt: "2026-09-06T08:30:00.000Z", now: NOW }),
    (error) => error?.code === "host_breakglass_role_selection_sha_mismatch",
  );
  assert.throws(
    () => __hostBreakglassRoleSelectionArtifactTest.deriveProofFromResult(fullInspection(), { expectedSha: SHA, targetKey: "production-runtime", runId: "12345", correlationId: "inspection-correlation-001", artifactCreatedAt: "2026-09-04T08:30:00.000Z", now: NOW }),
    (error) => error?.code === "host_breakglass_role_selection_artifact_expired",
  );
  const proof = __hostBreakglassRoleSelectionArtifactTest.deriveProofFromResult(fullInspection(), { expectedSha: SHA, targetKey: "production-runtime", runId: "12345", correlationId: "inspection-correlation-001", artifactCreatedAt: "2026-09-06T08:30:00.000Z", now: NOW });
  assert.throws(
    () => __hostBreakglassRoleSelectionArtifactTest.validateCanonicalProof({ ...proof, selection_hash: "0".repeat(64) }, { expected_sha: SHA, target_key: "production-runtime", run_id: "12345", correlation_id: "inspection-correlation-001" }, NOW),
    (error) => error?.code === "host_breakglass_role_selection_hash_invalid",
  );
});

test("missing durable GitHub artifact rejects caller-only proof", async () => {
  const callerProof = {
    source: "durable_full_inspection",
    expected_sha: SHA,
    inspection_run_id: "run:github:12345",
    inspection_evidence_hash: "c".repeat(64),
    finding_ids: [`finding:${"d".repeat(32)}`],
    selected_roles: ["runtime_persistence"],
    role_object_count_fingerprints: { runtime_persistence: "e".repeat(64) },
    composite_target_fingerprint: TARGET_FP,
  };
  const fetchImpl = async (url) => {
    if (String(url).endsWith("/actions/runs/12345")) return new Response(JSON.stringify({ id: 12345, path: ".github/workflows/production-runtime-parity-evidence.yml", event: "workflow_dispatch", head_branch: "main", status: "completed", conclusion: "success", display_title: `runtime-breakglass-inspection-correlation-001-${SHA}` }), { status: 200, headers: { "content-type": "application/json" } });
    if (String(url).includes("/actions/runs/12345/artifacts")) return new Response(JSON.stringify({ artifacts: [] }), { status: 200, headers: { "content-type": "application/json" } });
    throw new Error(`unexpected URL ${url}`);
  };
  await assert.rejects(
    resolveDurableRoleSelectionProof({ operation_key: "database.rebuild_empty", action: "apply_migration", expected_sha: SHA, target_key: "production-runtime", role_selection_proof: callerProof }, { env: { RUNTIME_BREAKGLASS_GITHUB_TOKEN: "test-token" }, fetchImpl, now: NOW }),
    (error) => error?.code === "host_breakglass_role_selection_artifact_missing",
  );
});
