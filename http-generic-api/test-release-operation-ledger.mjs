import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertReleaseOperationTransition,
  buildReleaseEvidenceRecord,
  normalizeReleaseOperationInput,
  sanitizeReleaseEvidence,
} from "./releaseOperationService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const normalized = normalizeReleaseOperationInput({ operation_type: "deploy_release", environment_key: "production", expected_commit_sha: "abcdef1234567890", reason: "Production is behind main" });
assert.equal(normalized.operation_type, "deploy_release");
assert.equal(normalized.current_status, "accepted");
assert.equal(normalized.expected_commit_sha, "abcdef1234567890");
assert.match(normalized.operation_id, /^[0-9a-f-]{36}$/i);

assert.equal(assertReleaseOperationTransition("accepted", "planning"), true);
assert.equal(assertReleaseOperationTransition("deploy_started", "restart_in_progress"), true);
assert.equal(assertReleaseOperationTransition("restart_in_progress", "readback_pending"), true);
assert.equal(assertReleaseOperationTransition("readback_pending", "verified"), true);
assert.throws(() => assertReleaseOperationTransition("verified", "deploy_started"), /terminal/i);
assert.throws(() => assertReleaseOperationTransition("accepted", "verified"), /Invalid release operation transition/i);

const sanitized = sanitizeReleaseEvidence({ status: "verified", authorization: "Bearer should-not-survive", nested: { password: "should-not-survive", no_secrets: true }, secrets_included: false });
assert.equal(sanitized.authorization, undefined);
assert.equal(sanitized.nested.password, undefined);
assert.equal(sanitized.nested.no_secrets, true);
assert.equal(sanitized.secrets_included, false);

const evidenceA = buildReleaseEvidenceRecord({ evidence_type: "runtime_verification", evidence: { b: 2, a: 1, token: "drop" } });
const evidenceB = buildReleaseEvidenceRecord({ evidence_type: "runtime_verification", evidence: { a: 1, b: 2 } });
assert.equal(evidenceA.evidence_sha256, evidenceB.evidence_sha256);
assert.equal(evidenceA.secrets_included, false);
assert.equal(evidenceA.evidence_json.token, undefined);

const migration = fs.readFileSync(path.join(__dirname, "migrations", "20260712_release_operation_ledger.sql"), "utf8");
for (const table of ["release_operations", "release_operation_steps", "release_operation_evidence", "release_gate_events"]) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
for (const toolKey of ["release_operation_create", "release_operation_list", "release_operation_get", "release_operation_step_append", "release_operation_evidence_append", "release_operation_gate_event_append", "release_operation_finalize"]) assert.match(migration, new RegExp(toolKey));
assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE TABLE|DELETE FROM/i);

const openapi = fs.readFileSync(path.join(__dirname, "openapi", "release-operations.yaml"), "utf8");
assert.match(openapi, /openapi: 3\.1\.0/);
assert.match(openapi, /\/admin\/release-operations:/);
assert.match(openapi, /operationId: createReleaseOperation/);
assert.match(openapi, /operationId: finalizeReleaseOperation/);
console.log("release operation ledger tests passed");
