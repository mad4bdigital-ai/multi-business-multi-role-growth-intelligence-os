import assert from "node:assert/strict";
import test from "node:test";
import { computeRoleSelectionProofHash } from "./roleSelectionProof.js";
import { __hostBreakglassRoleSelectionArtifactTest, resolveDurableRoleSelectionProof } from "./hostBreakglassRoleSelectionArtifact.js";

const SHA = "a".repeat(40);
const TARGET_FP = "b".repeat(64);
const NOW = Date.parse("2026-09-06T09:00:00.000Z");

function fullInspection(overrides = {}) {
  return {
    contract: "mad4b.production-runtime-full-role-inspection-evidence.v1",
    mode: "dry_run",
    operation: "read_only",
    full_inspection: true,
    status: "host_local_inspection_complete",
    expected_sha: SHA,
    expected_production_sha: SHA,
    target_key: "production-runtime",
    target_binding: { target_fingerprint: TARGET_FP },
    source_binding: { expected_sha: SHA },
    role_database_object_counts: {
      runtime: { tables: 5, views: 0, triggers: 0, routines: 0, events: 0, total: 5 },
      governance: { tables: 0, views: 0, triggers: 0, routines: 0, events: 0, total: 0 },
      runtime_persistence: { tables: 0, views: 0, triggers: 0, routines: 0, events: 0, total: 0 },
    },
    role_database_object_classifications: { runtime: "nonempty_objects", governance: "zero_objects", runtime_persistence: "zero_objects" },
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

function zipSingleEntry(name, value) {
  const nameBytes = Buffer.from(name, "utf8");
  const data = Buffer.from(typeof value === "string" ? value : JSON.stringify(value), "utf8");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(0, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  local.writeUInt16LE(0, 28);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(0, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 42);

  const localRecord = Buffer.concat([local, nameBytes, data]);
  const centralRecord = Buffer.concat([central, nameBytes]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralRecord.length, 12);
  eocd.writeUInt32LE(localRecord.length, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([localRecord, centralRecord, eocd]);
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
  assert.equal(proof.composite_target_fingerprint, TARGET_FP);
  assert.equal(proof.selection_hash, computeRoleSelectionProofHash(proof));
  assert.match(proof.inspection_evidence_hash, /^[0-9a-f]{64}$/u);
  assert.equal(proof.finding_ids.length, 2);
});

test("selected role set must exactly equal the durable zero-object role set", () => {
  const result = fullInspection({ selected_rebuild_roles: ["governance"] });
  assert.throws(
    () => __hostBreakglassRoleSelectionArtifactTest.deriveProofFromResult(result, { expectedSha: SHA, targetKey: "production-runtime", runId: "12345", correlationId: "inspection-correlation-001", artifactCreatedAt: "2026-09-06T08:30:00.000Z", now: NOW }),
    (error) => error?.code === "host_breakglass_role_selection_mismatch",
  );
});

test("selected non-zero roles are rejected instead of being trusted from the artifact", () => {
  const result = fullInspection({
    selected_rebuild_roles: ["runtime"],
    role_database_object_classifications: { runtime: "nonempty_objects", governance: "zero_objects", runtime_persistence: "zero_objects" },
  });
  assert.throws(
    () => __hostBreakglassRoleSelectionArtifactTest.deriveProofFromResult(result, { expectedSha: SHA, targetKey: "production-runtime", runId: "12345", correlationId: "inspection-correlation-001", artifactCreatedAt: "2026-09-06T08:30:00.000Z", now: NOW }),
    (error) => ["host_breakglass_role_selection_mismatch", "host_breakglass_role_selection_nonzero_role"].includes(error?.code),
  );
});

test("wrong SHA, missing target binding, stale evidence, and tampered proof hash fail closed", () => {
  assert.throws(
    () => __hostBreakglassRoleSelectionArtifactTest.deriveProofFromResult(fullInspection({ source_binding: { expected_sha: "f".repeat(40) }, expected_sha: "f".repeat(40), expected_production_sha: "f".repeat(40) }), { expectedSha: SHA, targetKey: "production-runtime", runId: "12345", correlationId: "inspection-correlation-001", artifactCreatedAt: "2026-09-06T08:30:00.000Z", now: NOW }),
    (error) => error?.code === "host_breakglass_role_selection_sha_mismatch",
  );
  assert.throws(
    () => __hostBreakglassRoleSelectionArtifactTest.deriveProofFromResult(fullInspection({ target_binding: null, composite_target_fingerprint: null }), { expectedSha: SHA, targetKey: "production-runtime", runId: "12345", correlationId: "inspection-correlation-001", artifactCreatedAt: "2026-09-06T08:30:00.000Z", now: NOW }),
    (error) => error?.code === "host_breakglass_role_selection_target_fingerprint_invalid",
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

test("resolver consumes the exact full_role_inspection artifact and canonical evidence entry", async () => {
  const runId = "12345";
  const artifactName = __hostBreakglassRoleSelectionArtifactTest.expectedFullInspectionArtifactName(SHA, runId);
  assert.equal(artifactName, `production-runtime-bootstrap-full_role_inspection-${SHA}-${runId}`);
  assert.equal(__hostBreakglassRoleSelectionArtifactTest.FULL_INSPECTION_RESULT_ENTRY, "full-role-inspection.json");
  const zip = zipSingleEntry("full-role-inspection.json", fullInspection());
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.endsWith(`/actions/runs/${runId}`)) return new Response(JSON.stringify({ id: Number(runId), path: ".github/workflows/production-runtime-parity-evidence.yml", event: "workflow_dispatch", head_branch: "main", status: "completed", conclusion: "success", display_title: `runtime-breakglass-inspection-correlation-001-${SHA}` }), { status: 200, headers: { "content-type": "application/json" } });
    if (value.includes(`/actions/runs/${runId}/artifacts`)) return new Response(JSON.stringify({ artifacts: [{ id: 77, name: artifactName, expired: false, created_at: "2026-09-06T08:30:00.000Z" }] }), { status: 200, headers: { "content-type": "application/json" } });
    if (value.endsWith("/actions/artifacts/77/zip")) return new Response(zip, { status: 200, headers: { "content-type": "application/zip" } });
    throw new Error(`unexpected URL ${url}`);
  };
  const proof = await resolveDurableRoleSelectionProof({ operation_key: "database.rebuild_empty", action: "apply_migration", expected_sha: SHA, target_key: "production-runtime", inspection_run_id: `run:github:${runId}` }, { env: { RUNTIME_BREAKGLASS_GITHUB_TOKEN: "test-token" }, fetchImpl, now: NOW });
  assert.deepEqual(proof.selected_roles, ["governance", "runtime_persistence"]);
  assert.equal(proof.composite_target_fingerprint, TARGET_FP);
  assert.equal(proof.inspection_run_id, `run:github:${runId}`);
  assert.equal(proof.selection_hash, computeRoleSelectionProofHash(proof));
});

test("legacy dry_run artifact name is not accepted as full-inspection mutation authority", async () => {
  const runId = "12345";
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.endsWith(`/actions/runs/${runId}`)) return new Response(JSON.stringify({ id: Number(runId), path: ".github/workflows/production-runtime-parity-evidence.yml", event: "workflow_dispatch", head_branch: "main", status: "completed", conclusion: "success", display_title: `runtime-breakglass-inspection-correlation-001-${SHA}` }), { status: 200, headers: { "content-type": "application/json" } });
    if (value.includes(`/actions/runs/${runId}/artifacts`)) return new Response(JSON.stringify({ artifacts: [{ id: 76, name: `production-runtime-bootstrap-dry_run-${SHA}-${runId}`, expired: false, created_at: "2026-09-06T08:30:00.000Z" }] }), { status: 200, headers: { "content-type": "application/json" } });
    throw new Error(`unexpected URL ${url}`);
  };
  await assert.rejects(
    resolveDurableRoleSelectionProof({ operation_key: "database.rebuild_empty", action: "apply_migration", expected_sha: SHA, target_key: "production-runtime", inspection_run_id: `run:github:${runId}` }, { env: { RUNTIME_BREAKGLASS_GITHUB_TOKEN: "test-token" }, fetchImpl, now: NOW }),
    (error) => error?.code === "host_breakglass_role_selection_artifact_missing",
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
