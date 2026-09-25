import assert from "node:assert/strict";
import test from "node:test";
import {
  createPlatformRecoveryConvergenceReadExecutors,
  createProductionDeploymentParityReader,
  normalizeFullInspectionForConvergence,
} from "./platformRecoveryConvergenceReadAdapters.js";

const SHA = "a".repeat(40);
const ENV = {
  GITHUB_REPOSITORY: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
  GITHUB_REF_NAME: "Production",
  GITHUB_SHA: SHA,
  DEPLOYMENT_MANIFEST_JSON: JSON.stringify({
    repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    branch: "Production",
    commit_sha: SHA,
    source: "test_fixture",
    secrets_included: false,
  }),
};

const RUN_ID = "run:platform-recovery:test-001";
const TARGET_FINGERPRINT = "f".repeat(64);

function ctx(key = "production_identity", overrides = {}) {
  return {
    expected_sha: SHA,
    run_id: RUN_ID,
    plan_hash: "b".repeat(64),
    step_id: `platform-recovery:test:${key}`,
    idempotency_key: `platform-recovery-idem:${key}`,
    prior_steps: [],
    ...overrides,
  };
}

function backupCtx() {
  return ctx("backup_evidence", {
    prior_steps: [{
      key: "database_full_inspection",
      status: "pass",
      result: {
        durable: true,
        target_fingerprint: TARGET_FINGERPRINT,
        inspection_run_id: "run:inspection:test-001",
        inspection_evidence_hash: "c".repeat(64),
      },
    }],
  });
}

function response(body, status = 200, headers = {}) {
  return {
    status,
    headers: new Headers(headers),
    async json() { return structuredClone(body); },
  };
}

test("fixed Production parity reader verifies only exact /version and /deployment-info evidence", async () => {
  const calls = [];
  const reader = createProductionDeploymentParityReader({
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init.method, redirect: init.redirect });
      if (url.endsWith("/version")) {
        return response({ deployment: { deployed_commit_sha: SHA } });
      }
      if (url.endsWith("/deployment-info")) {
        return response({ commit_sha: SHA, branch: "Production" });
      }
      throw new Error("unexpected URL");
    },
  });

  const result = await reader(SHA);
  assert.equal(result.exact_sha_parity, true);
  assert.equal(result.version_readback, true);
  assert.equal(result.deployment_info_readback, true);
  assert.equal(result.fixed_origin, "https://auth.mad4b.com");
  assert.equal(result.caller_origin_allowed, false);
  assert.deepEqual(calls.map((entry) => entry.url), [
    "https://auth.mad4b.com/version",
    "https://auth.mad4b.com/deployment-info",
  ]);
  assert.ok(calls.every((entry) => entry.method === "GET" && entry.redirect === "manual"));
});

test("fixed Production parity rejects a redirect instead of following another origin", async () => {
  const reader = createProductionDeploymentParityReader({
    fetchImpl: async () => response({}, 302, { location: "https://example.invalid/" }),
  });
  await assert.rejects(
    reader(SHA),
    (error) => error.code === "PLATFORM_RECOVERY_PARITY_REDIRECT_FORBIDDEN",
  );
});

test("full inspection normalization preserves all role zero-object evidence and durability", () => {
  const normalized = normalizeFullInspectionForConvergence({
    run_id: "run:inspection:1",
    inspection_evidence_hash: "c".repeat(64),
    durability: { inspection_durable: true },
    trust: { target_fingerprints: { composite: TARGET_FINGERPRINT } },
    inspection: {
      checks: {
        governance_db_privilege_ready: true,
        mcp_catalog_schema_ready: true,
        runtime_persistence_ready: false,
      },
      role_database_object_classifications: {
        runtime: "nonempty_objects",
        governance: "zero_objects",
        runtime_persistence: "zero_objects",
      },
      role_database_object_counts: {
        runtime: { total: 17 },
        governance: { total: 0 },
        runtime_persistence: { total: 0 },
      },
      role_database_object_count_fingerprints: {
        runtime: "1".repeat(64),
        governance: "2".repeat(64),
        runtime_persistence: "3".repeat(64),
      },
    },
  });
  assert.equal(normalized.durable, true);
  assert.equal(normalized.roles.runtime.zero_object, false);
  assert.equal(normalized.roles.governance.zero_object, true);
  assert.equal(normalized.roles.runtime_persistence.zero_object, true);
  assert.equal(normalized.roles.runtime.object_count_total, 17);
  assert.equal(normalized.target_fingerprint, TARGET_FINGERPRINT);
  assert.equal(normalized.checks.governance_db_privilege_ready, true);
  assert.equal(normalized.checks.mcp_catalog_schema_ready, true);
  assert.equal(normalized.checks.runtime_persistence_ready, false);
});

test("identity adapter combines server identity with fixed public parity", async () => {
  const executors = createPlatformRecoveryConvergenceReadExecutors({
    env: ENV,
    deploymentParityReader: async () => ({
      ok: true,
      exact_sha_parity: true,
      version_readback: true,
      deployment_info_readback: true,
      secrets_included: false,
    }),
  });
  const result = await executors.production_identity(ctx());
  assert.equal(result.status, "pass");
  assert.equal(result.exact_sha_parity, true);
  assert.equal(result.version_readback, true);
  assert.equal(result.deployment_info_readback, true);
  assert.equal(result.expected_sha, SHA);
  assert.equal(result.mutation_performed, false);
  assert.equal(result.secrets_included, false);
});

test("backup adapter fails closed when no server-owned backup evidence reader exists", async () => {
  const executors = createPlatformRecoveryConvergenceReadExecutors({
    env: ENV,
    deploymentParityReader: async () => ({ exact_sha_parity: true }),
  });
  const result = await executors.backup_evidence(ctx("backup_evidence"));
  assert.equal(result.status, "blocked");
  assert.equal(result.error_code, "platform_recovery_backup_evidence_authority_unavailable");
  assert.equal(result.next_safe_action, "capture_and_verify_all_role_backup_evidence");
  assert.equal(result.mutation_performed, false);
});

test("backup adapter requires verified evidence for all three database roles", async () => {
  const executors = createPlatformRecoveryConvergenceReadExecutors({
    env: ENV,
    deploymentParityReader: async () => ({ exact_sha_parity: true }),
    backupEvidenceReader: async () => ({
      backup_verified: true,
      roles: ["runtime", "governance"],
      secrets_included: false,
    }),
  });
  const result = await executors.backup_evidence(backupCtx());
  assert.equal(result.status, "blocked");
  assert.equal(result.error_code, "platform_recovery_backup_evidence_not_ready");
});

test("activation readiness adapter refuses incomplete or mutating evidence", async () => {
  const executors = createPlatformRecoveryConvergenceReadExecutors({
    env: ENV,
    deploymentParityReader: async () => ({ exact_sha_parity: true }),
    productionActivationReadinessReader: async () => ({
      ok: true,
      ready: true,
      read_only_probe: false,
      secrets_included: false,
    }),
  });
  const result = await executors.production_activation_readiness(ctx("production_activation_readiness"));
  assert.equal(result.status, "blocked");
  assert.equal(result.error_code, "platform_recovery_activation_not_ready");
});

test("connector probe classifies 401 and 429 without triggering mutation", async () => {
  for (const [httpStatus, expectedKind] of [[401, "credential_invalid"], [429, "rate_limited"]]) {
    const executors = createPlatformRecoveryConvergenceReadExecutors({
      env: ENV,
      deploymentParityReader: async () => ({ exact_sha_parity: true }),
      connectorAuthProbeReader: async () => ({
        auth_ready: false,
        http_status: httpStatus,
        secrets_included: false,
      }),
    });
    const result = await executors.connector_auth_probe(ctx("connector_auth_probe"));
    assert.equal(result.status, "pass");
    assert.equal(result.auth_ready, false);
    assert.equal(result.failure_kind, expectedKind);
    assert.equal(result.authenticated_operation_http_status, httpStatus);
    assert.equal(result.mutation_performed, false);
  }
});


test("backup evidence must be durable hash-addressed and exact-SHA bound", async () => {
  const base = {
    contract: "mad4b.production-recovery-backup-evidence.v1",
    backup_verified: true,
    verified: true,
    durable: true,
    expected_sha: SHA,
    evidence_sha256: "d".repeat(64),
    evidence_ref: "backup:evidence:test",
    created_at: new Date().toISOString(),
    storage_readback_verified: true,
    restore_test_verified: true,
    artifact_manifest_hash: "e".repeat(64),
    target_fingerprint: TARGET_FINGERPRINT,
    cycle_id: RUN_ID,
    roles: ["runtime", "governance", "runtime_persistence"],
    secrets_included: false,
  };
  const good = createPlatformRecoveryConvergenceReadExecutors({
    env: ENV,
    deploymentParityReader: async () => ({ exact_sha_parity: true }),
    backupEvidenceReader: async () => base,
  });
  assert.equal((await good.backup_evidence(backupCtx())).status, "pass");

  for (const mutation of [
    { durable: false },
    { expected_sha: "f".repeat(40) },
    { evidence_sha256: "short" },
  ]) {
    const bad = createPlatformRecoveryConvergenceReadExecutors({
      env: ENV,
      deploymentParityReader: async () => ({ exact_sha_parity: true }),
      backupEvidenceReader: async () => ({ ...base, ...mutation }),
    });
    const result = await bad.backup_evidence(backupCtx());
    assert.equal(result.status, "blocked");
    assert.equal(result.error_code, "platform_recovery_backup_evidence_not_ready");
  }
});

test("persistent edge rate limit is degraded and resumable without credential rotation", async () => {
  const executors = createPlatformRecoveryConvergenceReadExecutors({
    env: ENV,
    deploymentParityReader: async () => ({ exact_sha_parity: true }),
    localManagerRateLimitRecoveryReader: async () => ({
      http_status_checked_before_json: true,
      retry_after_respected: true,
      backoff_persisted: true,
      rate_limit_source_attributed: true,
      post_recovery_auth_failure_kind: "edge_rate_limited",
      retry_after_seconds: 120,
      request_id: "req-edge-429",
      secrets_included: false,
    }),
  });
  const result = await executors.local_manager_rate_limit_recovery(ctx("local_manager_rate_limit_recovery"));
  assert.equal(result.status, "degraded");
  assert.equal(result.error_code, "platform_recovery_external_rate_limit_still_active");
  assert.equal(result.next_safe_action, "resume_same_run_after_retry_after");
  assert.equal(result.retry_after_seconds, 120);
  assert.equal(result.mutation_performed, false);
});

test("connector verify returns a structured blocker for forbidden or origin failures", async () => {
  for (const [status, kind] of [[403, "authorization_forbidden"], [502, "origin_unavailable"]]) {
    const executors = createPlatformRecoveryConvergenceReadExecutors({
      env: ENV,
      deploymentParityReader: async () => ({ exact_sha_parity: true }),
      connectorAuthProbeReader: async () => ({
        auth_ready: false,
        http_status: status,
        failure_kind: kind,
        request_id: `req-${status}`,
        secrets_included: false,
      }),
    });
    const result = await executors.connector_auth_verify(ctx("connector_auth_verify"));
    assert.equal(result.status, "blocked");
    assert.equal(result.error_code, "platform_recovery_connector_auth_not_ready");
    assert.equal(result.failure_kind, kind);
    assert.equal(result.request_id, `req-${status}`);
  }
});


test("backup evidence rejects stale, wrong-cycle, and untested restore evidence", async () => {
  const base = {
    contract: "mad4b.production-recovery-backup-evidence.v1",
    backup_verified: true,
    verified: true,
    durable: true,
    expected_sha: SHA,
    evidence_sha256: "d".repeat(64),
    evidence_ref: "backup:evidence:test",
    created_at: new Date().toISOString(),
    storage_readback_verified: true,
    restore_test_verified: true,
    artifact_manifest_hash: "e".repeat(64),
    target_fingerprint: TARGET_FINGERPRINT,
    cycle_id: RUN_ID,
    roles: ["runtime", "governance", "runtime_persistence"],
    secrets_included: false,
  };
  for (const mutation of [
    { created_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() },
    { cycle_id: "run:platform-recovery:other-cycle" },
    { target_fingerprint: "9".repeat(64) },
    { restore_test_verified: false },
    { storage_readback_verified: false },
    { artifact_manifest_hash: "bad" },
  ]) {
    const executors = createPlatformRecoveryConvergenceReadExecutors({
      env: ENV,
      deploymentParityReader: async () => ({ exact_sha_parity: true }),
      backupEvidenceReader: async () => ({ ...base, ...mutation }),
    });
    const result = await executors.backup_evidence(backupCtx());
    assert.equal(result.status, "blocked");
    assert.equal(result.error_code, "platform_recovery_backup_evidence_not_ready");
  }
});


test("missing inspection readiness remains unknown instead of becoming a repair finding", () => {
  const normalized = normalizeFullInspectionForConvergence({
    run_id: "run:inspection:missing-readiness",
    inspection_evidence_hash: "c".repeat(64),
    durability: { inspection_durable: true },
    trust: { target_fingerprints: { composite: TARGET_FINGERPRINT } },
    inspection: {
      role_database_object_classifications: {
        runtime: "nonempty_objects",
        governance: "nonempty_objects",
        runtime_persistence: "nonempty_objects",
      },
      role_database_object_counts: {
        runtime: { total: 7 },
        governance: { total: 5 },
        runtime_persistence: { total: 4 },
      },
    },
  });

  assert.equal(normalized.checks.governance_db_privilege_ready, null);
  assert.equal(normalized.checks.mcp_catalog_schema_ready, null);
  assert.equal(normalized.checks.runtime_persistence_ready, null);
  assert.equal(normalized.roles.runtime_persistence.classification, "nonempty_objects");
  assert.equal(normalized.roles.runtime_persistence.object_count_total, 4);
  assert.equal(normalized.roles.runtime_persistence.zero_object, false);
});
