import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyRuntimeParityWithGovernance } from "./runtimeVerificationService.js";

const verifiedRow = {
  environment_key: "production",
  production_parity: "verified",
  blocking_gap_count: 0,
  expected_commit_sha: "a".repeat(40),
  deployed_commit_sha: "a".repeat(40),
};

const readyGovernance = {
  status: "ready",
  error_code: null,
  configured: true,
  connection_ready: true,
  principal: "governance_writer@%",
  database: "platform",
  required_surfaces: {
    governed_tool_response_chunks: { ready: true, required: ["SELECT", "INSERT", "UPDATE", "DELETE"], missing: [] },
  },
  missing_privileges: [],
  missing_count: 0,
  prohibited_privileges: [],
  prohibited_grant_count: 0,
  raw_grants_included: false,
  secrets_included: false,
};

const ready = classifyRuntimeParityWithGovernance(verifiedRow, readyGovernance);
assert.equal(ready.recorded_production_parity, "verified");
assert.equal(ready.production_parity, "verified");
assert.equal(ready.blocking_gap_count, 0);
assert.equal(ready.readiness_classification, "ready");
assert.equal(ready.governance_db_write_authority_blocks_production_parity, false);
assert.equal(ready.governance_db_write_authority.status, "ready");
assert.equal(ready.governance_db_write_authority.raw_grants_included, false);
assert.equal(ready.secrets_included, false);

const missingInsert = classifyRuntimeParityWithGovernance(verifiedRow, {
  ...readyGovernance,
  status: "degraded",
  error_code: "runtime_db_write_authority_degraded",
  missing_privileges: [{ table: "capability_resolution_envelope_ledger", operation: "INSERT" }],
  missing_count: 1,
});
assert.equal(missingInsert.recorded_production_parity, "verified");
assert.equal(missingInsert.production_parity, "degraded");
assert.equal(missingInsert.recorded_blocking_gap_count, 0);
assert.equal(missingInsert.blocking_gap_count, 1);
assert.equal(missingInsert.readiness_classification, "blocked");
assert.equal(missingInsert.governance_db_write_authority_blocks_production_parity, true);
assert.equal(missingInsert.governance_db_write_authority.error_code, "runtime_db_write_authority_degraded");
assert.deepEqual(missingInsert.governance_db_write_authority.missing_privileges, [
  { table: "capability_resolution_envelope_ledger", operation: "INSERT" },
]);

const broadGrant = classifyRuntimeParityWithGovernance(verifiedRow, {
  ...readyGovernance,
  status: "degraded",
  error_code: "runtime_db_write_authority_degraded",
  prohibited_privileges: [{ privilege: "ALL PRIVILEGES", scope: "*.*", reason: "administrative_or_ddl_privilege_not_allowed" }],
  prohibited_grant_count: 1,
});
assert.equal(broadGrant.production_parity, "degraded");
assert.equal(broadGrant.blocking_gap_count, 1);
assert.equal(broadGrant.governance_db_write_authority.prohibited_grant_count, 1);

const alreadyDegraded = classifyRuntimeParityWithGovernance({
  ...verifiedRow,
  production_parity: "degraded",
  blocking_gap_count: 2,
}, readyGovernance);
assert.equal(alreadyDegraded.production_parity, "degraded");
assert.equal(alreadyDegraded.blocking_gap_count, 2, "ready governance must not erase existing runtime blockers");
assert.equal(alreadyDegraded.readiness_classification, "blocked");

const unknownWithMissingGovernance = classifyRuntimeParityWithGovernance({
  environment_key: "production",
  production_parity: "unknown",
  blocking_gap_count: 0,
}, {
  status: "degraded",
  error_code: "runtime_db_write_authority_degraded",
  configured: false,
  connection_ready: false,
});
assert.equal(unknownWithMissingGovernance.production_parity, "unknown");
assert.equal(unknownWithMissingGovernance.blocking_gap_count, 1);
assert.equal(unknownWithMissingGovernance.readiness_classification, "blocked");

const source = readFileSync(new URL("./runtimeVerificationService.js", import.meta.url), "utf8");
assert.match(source, /getGovernanceDbWriteReadiness/);
assert.match(source, /Promise\.all\(\[/);
assert.match(source, /recorded_production_parity/);
assert.match(source, /governance_db_write_authority_blocks_production_parity/);
assert.match(source, /raw_grants_included: false/);
assert.doesNotMatch(source, /SHOW GRANTS FOR CURRENT_USER/, "runtime parity must consume the bounded readiness contract rather than expose raw grant SQL");

const releaseReadinessSource = readFileSync(new URL("./releaseReadiness.js", import.meta.url), "utf8");
assert.match(releaseReadinessSource, /getRuntimeParity/);
assert.match(releaseReadinessSource, /parity\.production_parity === "verified"/);
assert.match(releaseReadinessSource, /blockingGapCount === 0/);
assert.doesNotMatch(releaseReadinessSource, /releaseReadinessCore/, "release readiness source identity must remain stable");

console.log("Governance DB runtime parity gate tests passed");
