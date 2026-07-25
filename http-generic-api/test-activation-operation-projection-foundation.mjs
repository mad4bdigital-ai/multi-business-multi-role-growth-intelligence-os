import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTIVATION_EVIDENCE_MAX_BYTES,
  appendActivationStageAttempt,
  buildActivationEvidenceRecord,
  buildActivationOperationProjectionInsert,
  buildOptimisticActivationOperationUpdate,
  createActivationOperationProjection,
  deriveActivationOperationFingerprint,
  readActivationOperationProjection,
  sanitizeActivationEvidence,
  updateActivationOperationProjection,
} from "./activationOperationProjectionRepository.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.join(
  __dirname,
  "migrations",
  "20260724_activation_operation_projection_foundation.sql",
);
const migration = fs.readFileSync(migrationPath, "utf8");

for (const table of [
  "activation_operation_projections",
  "activation_stage_attempts",
  "activation_evidence_items",
  "activation_deliveries",
  "activation_acknowledgements",
  "activation_reconciliation_attempts",
]) {
  assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
}
assert.match(migration, /FOREIGN KEY \(operation_id\) REFERENCES activation_runs\(run_id\)/);
assert.match(migration, /UNIQUE KEY uq_activation_operation_idempotency/);
assert.match(migration, /UNIQUE KEY uq_activation_stage_attempt/);
assert.match(migration, /UNIQUE KEY uq_activation_delivery_attempt/);
assert.match(migration, /UNIQUE KEY uq_activation_acknowledgement_key/);
assert.match(migration, /UNIQUE KEY uq_activation_reconciliation_attempt/);
assert.match(migration, /optimistic_version BIGINT UNSIGNED NOT NULL DEFAULT 0/);
assert.match(migration, /CHECK \(secrets_included = 0\)/);
assert.doesNotMatch(migration, /^\s*(?:DROP|TRUNCATE|DELETE|ALTER)\b/im);
assert.match(migration, /not authorized for apply by this PR/i);

for (const runtimeFile of [
  "server.js",
  "activationSessionLifecycleService.js",
  "activationHardResponseService.js",
]) {
  const source = fs.readFileSync(path.join(__dirname, runtimeFile), "utf8");
  assert.doesNotMatch(
    source,
    /activationOperationProjectionRepository/,
    `${runtimeFile} must not wire the PR-2 repository foundation`,
  );
}

const operationId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const input = {
  operation_id: operationId,
  tenant_id: tenantId,
  user_id: userId,
  workspace_id: "workspace-alpha",
  idempotency_key: "raw-key-must-not-be-persisted",
  protected_resource: "https://activation.mad4b.com",
  oauth_client_id: "tenant-gpt-client",
  purpose: "tenant_activation",
  activation_mode: "managed",
  operation_fingerprint_material: { b: 2, a: 1 },
};

const fingerprintA = deriveActivationOperationFingerprint(input);
const fingerprintB = deriveActivationOperationFingerprint({
  ...input,
  operation_fingerprint_material: { a: 1, b: 2 },
});
assert.equal(fingerprintA, fingerprintB);
assert.notEqual(
  fingerprintA,
  deriveActivationOperationFingerprint({
    ...input,
    protected_resource: "https://other.example",
  }),
);

const builtInsert = buildActivationOperationProjectionInsert(input);
assert.match(builtInsert.sql, /INSERT INTO activation_operation_projections/);
assert.equal(builtInsert.row.operation_id, operationId);
assert.equal(builtInsert.row.optimistic_version, 0);
assert.match(builtInsert.row.idempotency_key_sha256, /^[0-9a-f]{64}$/);
assert.equal(builtInsert.params.includes(input.idempotency_key), false);
assert.equal(JSON.stringify(builtInsert).includes(input.idempotency_key), false);

const sanitized = sanitizeActivationEvidence({
  status: "verified",
  authorization: "Bearer must disappear",
  nested: {
    password: "drop",
    token: "drop",
    api_key: "drop",
    count: 2,
  },
});
assert.equal(sanitized.authorization, undefined);
assert.equal(sanitized.nested.password, undefined);
assert.equal(sanitized.nested.token, undefined);
assert.equal(sanitized.nested.api_key, undefined);
assert.equal(sanitized.nested.count, 2);

const evidenceA = buildActivationEvidenceRecord({
  operation_id: operationId,
  tenant_id: tenantId,
  evidence_type: "runtime_verification",
  source_type: "platform_native",
  evidence: { b: 2, a: 1, api_key: "drop" },
});
const evidenceB = buildActivationEvidenceRecord({
  operation_id: operationId,
  tenant_id: tenantId,
  evidence_type: "runtime_verification",
  source_type: "platform_native",
  evidence: { a: 1, b: 2 },
});
assert.equal(evidenceA.evidence_sha256, evidenceB.evidence_sha256);
assert.equal(evidenceA.secrets_included, false);
assert(evidenceA.summary_bytes <= ACTIVATION_EVIDENCE_MAX_BYTES);
assert.equal(evidenceA.summary_json.api_key, undefined);
assert.throws(
  () =>
    buildActivationEvidenceRecord({
      operation_id: operationId,
      tenant_id: tenantId,
      evidence_type: "oversized",
      source_type: "platform_native",
      evidence: {
        values: Array.from({ length: 100 }, () => "x".repeat(4000)),
      },
    }),
  (error) => error?.code === "activation_evidence_too_large" && error?.status === 413,
);

const optimistic = buildOptimisticActivationOperationUpdate({
  operation_id: operationId,
  tenant_id: tenantId,
  user_id: userId,
  expected_version: 4,
  patch: {
    current_stage: "validating",
    operation_status: "running",
  },
});
assert.match(optimistic.sql, /optimistic_version = optimistic_version \+ 1/);
assert.match(optimistic.sql, /AND optimistic_version = \?/);
assert.match(optimistic.sql, /BINARY user_id = BINARY \?/);
assert.equal(optimistic.next_version, 5);
assert.throws(
  () =>
    buildOptimisticActivationOperationUpdate({
      operation_id: operationId,
      tenant_id: tenantId,
      user_id: userId,
      expected_version: 0,
      patch: {},
    }),
  (error) => error?.code === "activation_projection_patch_empty",
);

const calls = [];
const successfulPool = {
  async query(sql, params) {
    calls.push({ sql, params });
    if (/^\s*SELECT/i.test(sql)) {
      return [[{ operation_id: operationId, optimistic_version: 1 }]];
    }
    return [{ affectedRows: 1 }];
  },
};

const created = await createActivationOperationProjection(successfulPool, input);
assert.equal(created.affected_rows, 1);
assert.equal(calls[0].params.includes(input.idempotency_key), false);

const updated = await updateActivationOperationProjection(successfulPool, {
  operation_id: operationId,
  tenant_id: tenantId,
  user_id: userId,
  expected_version: 0,
  patch: { current_stage: "validating" },
});
assert.deepEqual(updated, { updated: true, optimistic_version: 1 });

const read = await readActivationOperationProjection(successfulPool, {
  operation_id: operationId,
  tenant_id: tenantId,
  user_id: userId,
});
assert.equal(read.operation_id, operationId);
const readCall = calls.find(({ sql }) => /^\s*SELECT/i.test(sql));
assert.match(readCall.sql, /tenant_id = \?/);
assert.match(readCall.sql, /BINARY user_id = BINARY \?/);
assert.deepEqual(readCall.params, [operationId, tenantId, userId]);

const stageAttempt = await appendActivationStageAttempt(successfulPool, {
  attempt_id: "44444444-4444-4444-8444-444444444444",
  operation_id: operationId,
  tenant_id: tenantId,
  stage_key: "provider_bootstrap",
  attempt_number: 1,
  source_type: "platform_native",
  attempt_status: "started",
});
assert.equal(stageAttempt.affected_rows, 1);

const conflictPool = {
  async query() {
    return [{ affectedRows: 0 }];
  },
};
await assert.rejects(
  () =>
    updateActivationOperationProjection(conflictPool, {
      operation_id: operationId,
      tenant_id: tenantId,
      user_id: userId,
      expected_version: 7,
      patch: { operation_status: "running" },
    }),
  (error) =>
    error?.code === "activation_operation_version_conflict" && error?.status === 409,
);

const duplicatePool = {
  async query() {
    const error = new Error("duplicate");
    error.code = "ER_DUP_ENTRY";
    throw error;
  },
};
await assert.rejects(
  () => createActivationOperationProjection(duplicatePool, input),
  (error) =>
    error?.code === "activation_operation_idempotency_conflict" && error?.status === 409,
);
await assert.rejects(
  () =>
    appendActivationStageAttempt(duplicatePool, {
      operation_id: operationId,
      tenant_id: tenantId,
      stage_key: "provider_bootstrap",
      attempt_number: 1,
    }),
  (error) => error?.code === "activation_stage_attempt_conflict" && error?.status === 409,
);

console.log("activation operation projection foundation tests passed");
