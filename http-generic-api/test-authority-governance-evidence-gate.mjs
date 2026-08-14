import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAuthorityGovernanceEvidence } from "./authorityGovernanceEvidenceGate.js";

const inventory = {
  contract: "mad4b.ueacp.authority-path-inventory.v1",
  status: "ready_for_human_closure_review",
  inventory_sha256: "sha256:inventory",
  sources: [{ source_key: "admin-tools" }],
  summary: { source_count: 1, canonical_path_count: 2 },
  closure_state: { t001_complete: false },
  provider_calls: false,
  credential_payload_read: false,
  external_writes: false,
  secrets_included: false,
};

const census = {
  ok: true,
  mode: "read_only_authority_catalog_census",
  schema_name: "growthOS",
  summary: { object_count: 4, absent_revision_table_count: 1 },
  closure_state: { t002_complete: false },
  provider_calls: false,
  credential_payload_read: false,
  external_writes: false,
  secrets_included: false,
};

test("missing T001/T002 evidence fails closed", () => {
  const result = evaluateAuthorityGovernanceEvidence({ observed_at: "2026-08-14T00:00:00Z" });
  assert.equal(result.status, "blocked");
  assert.ok(result.blockers.includes("T001_PATH_INVENTORY_MISSING"));
  assert.ok(result.blockers.includes("T002_CATALOG_CENSUS_MISSING"));
  assert.equal(result.t001_complete, false);
  assert.equal(result.t002_complete, false);
});

test("complete machine evidence remains human/live-review gated", () => {
  const result = evaluateAuthorityGovernanceEvidence({
    path_inventory: inventory,
    catalog_census: census,
    expected_source_keys: ["admin-tools"],
    observed_at: "2026-08-14T00:00:00Z",
  });
  assert.equal(result.status, "ready_for_human_and_live_readback_review");
  assert.equal(result.t001_machine_ready, true);
  assert.equal(result.t002_machine_ready, true);
  assert.equal(result.t001_complete, false);
  assert.equal(result.t002_complete, false);
  assert.equal(result.human_review_required, true);
  assert.equal(result.live_catalog_readback_required, true);
  assert.equal(result.migration_authorized, false);
  assert.equal(result.runtime_enforcement_enabled, false);
});

test("unexpected side effects block the aggregate", () => {
  const result = evaluateAuthorityGovernanceEvidence({
    path_inventory: { ...inventory, external_writes: true },
    catalog_census: census,
    observed_at: "2026-08-14T00:00:00Z",
  });
  assert.equal(result.status, "blocked");
  assert.ok(result.blockers.includes("T001_FORBIDDEN_SIDE_EFFECT_OBSERVED"));
});

test("missing expected sources remain explicit blockers", () => {
  const result = evaluateAuthorityGovernanceEvidence({
    path_inventory: inventory,
    catalog_census: census,
    expected_source_keys: ["admin-tools", "tenant-routes"],
    observed_at: "2026-08-14T00:00:00Z",
  });
  assert.equal(result.status, "blocked");
  assert.ok(result.blockers.includes("T001_EXPECTED_SOURCE_MISSING:tenant-routes"));
});
