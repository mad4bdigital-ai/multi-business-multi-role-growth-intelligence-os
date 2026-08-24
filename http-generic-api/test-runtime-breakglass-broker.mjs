import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRuntimeBreakglassPlan,
  createRuntimeBreakglassRun,
  getRuntimeBreakglassCatalogStatus,
  getRuntimeBreakglassRun,
  _testingRuntimeBreakglass,
} from "./runtimeBreakglassBroker.js";
import { _testingRuntimeBreakglassRoutes } from "./routes/runtimeBreakglassRoutes.js";

const SHA = "a".repeat(40);

function throwsCode(fn, code) {
  assert.throws(fn, (error) => error?.code === code, `expected error code ${code}`);
}

test("catalog status is DB-independent and secret-free", () => {
  const result = getRuntimeBreakglassCatalogStatus({
    BOOTSTRAP_TARGET_SOURCE: "runtime_env",
    RUNTIME_BOOTSTRAP_HOOK: "",
    DB_NAME: "synthetic-not-emitted",
    DB_USER: "synthetic-not-emitted",
  });
  assert.equal(result.ok, true);
  assert.equal(result.contract, "mad4b.runtime-breakglass-catalog-status.v1");
  assert.equal(result.environments.staging.deployment_provider, "local_device");
  assert.equal(result.environments.staging.runtime_kind, "windows_docker_compose");
  assert.equal(result.environments.production.deployment_provider, "hostinger");
  assert.equal(result.environments.production.runtime_kind, "hostinger_cloud_business_plan");
  assert.equal(result.database_connection_performed, false);
  assert.equal(result.workflow_dispatch_performed, false);
  assert.equal(result.secrets_included, false);
  assert.equal(JSON.stringify(result).includes("synthetic-not-emitted"), false);
});

test("staging plan is local Windows/Docker-only and never dispatches Production workflow", () => {
  const result = buildRuntimeBreakglassPlan({
    environment: "staging",
    contract_key: "empty_database_rebuild",
    mode: "dry_run",
    expected_sha: SHA,
  });
  assert.equal(result.environment, "staging");
  assert.equal(result.deployment.runtime_kind, "windows_docker_compose");
  assert.equal(result.deployment.docker_compose, "http-generic-api/docker-compose.staging.yml");
  assert.equal(result.workflow_dispatch_performed, false);
  assert.equal(result.database_mutation_performed, false);
  assert.equal(result.rebuild_policy.empty_database_only, true);
});

test("production plan is bound to Hostinger Production workflow and hides target database input", () => {
  const result = buildRuntimeBreakglassPlan({
    environment: "production",
    contract_key: "schema_repair",
    mode: "plan",
    migration: "20260815_custom_gpt_mcp_catalog_levels.sql",
  });
  assert.equal(result.deployment.deployment_provider, "hostinger");
  assert.equal(result.deployment.source_branch, "Production");
  assert.equal(result.workflow.file, ".github/workflows/production-runtime-parity-evidence.yml");
  assert.equal(result.workflow.dispatch_ref, "main");
  assert.equal(result.target.database_identifier_supplied_by_caller, false);
  assert.equal(result.secrets_included, false);
});

test("cross-environment and unsafe request fields fail closed", () => {
  throwsCode(() => buildRuntimeBreakglassPlan({
    environment: "staging",
    contract_key: "runtime_diagnose",
    mode: "plan",
    target_source: "repository_allowlist",
  }), "breakglass_staging_target_source_invalid");
  throwsCode(() => buildRuntimeBreakglassPlan({
    environment: "production",
    contract_key: "schema_repair",
    mode: "plan",
    target_key: "staging-local-docker",
  }), "breakglass_target_key_environment_mismatch");
  throwsCode(() => buildRuntimeBreakglassPlan({
    environment: "production",
    contract_key: "schema_repair",
    mode: "plan",
    database_name: "must-not-be-accepted",
  }), "breakglass_request_field_forbidden");
});

test("staging and runtime_env cannot perform mutation through broker", () => {
  throwsCode(() => buildRuntimeBreakglassPlan({
    environment: "staging",
    contract_key: "schema_repair",
    mode: "apply_migration",
    expected_sha: SHA,
    idempotency_key: "staging-apply-blocked",
    confirmation: "not-used",
  }), "breakglass_staging_admin_mutation_forbidden");
  throwsCode(() => buildRuntimeBreakglassPlan({
    environment: "production",
    contract_key: "schema_repair",
    mode: "apply_migration",
    target_source: "runtime_env",
    expected_sha: SHA,
    idempotency_key: "production-runtime-env-apply-blocked",
    confirmation: "not-used",
  }), "breakglass_runtime_env_apply_forbidden");
  throwsCode(() => buildRuntimeBreakglassPlan({
    environment: "production",
    contract_key: "full_database_rebuild",
    mode: "apply_migration",
    expected_sha: SHA,
    idempotency_key: "full-rebuild-apply-blocked",
    confirmation: "not-used",
  }), "breakglass_full_rebuild_apply_forbidden");
});

test("workflow payload is server-controlled and exact-run name is reproducible", () => {
  const request = _testingRuntimeBreakglass.buildNormalizedRequest({
    environment: "production",
    contract_key: "schema_repair",
    mode: "dry_run",
    expected_sha: SHA,
    idempotency_key: "schema-dry-run-1234",
    migration: "20260815_custom_gpt_mcp_catalog_levels.sql",
  });
  const payload = _testingRuntimeBreakglass.workflowInputPayload(request);
  assert.equal(payload.ref, "main");
  assert.equal(payload.inputs.expected_sha, SHA);
  assert.equal(payload.inputs.breakglass_correlation_id, request.correlation_id);
  assert.equal(Object.hasOwn(payload.inputs, "bootstrap_target_database"), false);
  assert.equal(Object.hasOwn(payload.inputs, "MYSQL_BOOTSTRAP_PASSWORD"), false);
  assert.match(_testingRuntimeBreakglass.expectedRunName(request), new RegExp(`${request.correlation_id}-${SHA}$`));
  assert.equal(_testingRuntimeBreakglass.runMatchesRequest({
    path: ".github/workflows/production-runtime-parity-evidence.yml",
    event: "workflow_dispatch",
    head_branch: "main",
    head_sha: SHA,
    run_name: _testingRuntimeBreakglass.expectedRunName(request),
    created_at: new Date().toISOString(),
  }, request, { startedAt: Date.now(), main_sha: SHA }), true);
});

test("host route guard accepts only backend service key identity", async () => {
  const calls = [];
  const guard = _testingRuntimeBreakglassRoutes.makeServiceKeyGuard(async (req, _res, next) => {
    calls.push(req.headers?.authorization || req.headers?.["x-api-key"] || null);
    req.auth = req.testAuth;
    next();
  });
  const accepted = { headers: { "x-api-key": "[redacted]" }, testAuth: { mode: "backend_api_key", is_admin: true } };
  let nextCalled = false;
  await guard(accepted, { headersSent: false, status() { return this; }, json() {} }, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(calls.length, 1);

  const rejected = { headers: {}, testAuth: { mode: "user_jwt", is_admin: false } };
  let rejectionStatus = null;
  await guard(rejected, { headersSent: false, status(code) { rejectionStatus = code; return this; }, json() {} }, () => { throw new Error("user JWT must not reach Breakglass"); });
  assert.equal(rejectionStatus, 403);
});

test("Production dispatch uses fixed workflow/ref and exact SHA parity without caller target data", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null });
    if (String(url).endsWith("/git/ref/heads/main")) {
      return new Response(JSON.stringify({ object: { sha: "b".repeat(40) } }), { status: 200 });
    }
    if (String(url).endsWith("/git/ref/heads/Production")) {
      return new Response(JSON.stringify({ object: { sha: SHA } }), { status: 200 });
    }
    if (String(url).includes("/actions/workflows/.github%2Fworkflows%2Fproduction-runtime-parity-evidence.yml/runs?")) {
      return new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 });
    }
    if (String(url).endsWith("/dispatches")) {
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected URL: ${url}`);
  };
  const result = await createRuntimeBreakglassRun({
    environment: "production",
    contract_key: "schema_repair",
    mode: "dry_run",
    expected_sha: SHA,
    idempotency_key: "dispatch-contract-123",
    migration: "20260815_custom_gpt_mcp_catalog_levels.sql",
  }, { env: {}, fetchImpl, getAppToken: async () => "server-side-test-token", poll: false });
  assert.equal(result.workflow_dispatch_performed, true);
  assert.equal(result.dispatch_ref, "main");
  assert.equal(result.production_sha_verified, undefined);
  assert.equal(result.source_heads.production_sha_verified, SHA);
  const dispatch = calls.find((call) => call.method === "POST");
  assert.equal(dispatch.url.endsWith("/dispatches"), true);
  assert.equal(dispatch.body.ref, "main");
  assert.equal(dispatch.body.inputs.expected_sha, SHA);
  assert.equal(dispatch.body.inputs.breakglass_correlation_id, "bg-dispatch-contract-123");
  assert.equal(Object.hasOwn(dispatch.body.inputs, "bootstrap_target_database"), false);
  assert.equal(Object.hasOwn(dispatch.body.inputs, "MYSQL_BOOTSTRAP_PASSWORD"), false);
  assert.equal(result.database_connection_performed, false);
  assert.equal(result.database_mutation_performed, false);
});

test("readback accepts only the exact workflow run binding and bounded artifacts", async () => {
  const request = _testingRuntimeBreakglass.buildNormalizedRequest({
    environment: "production",
    contract_key: "schema_repair",
    mode: "dry_run",
    expected_sha: SHA,
    idempotency_key: "readback-contract-123",
    migration: "20260815_custom_gpt_mcp_catalog_levels.sql",
  });
  const runName = _testingRuntimeBreakglass.expectedRunName(request);
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(String(url));
    if (String(url).endsWith("/actions/runs/987654")) {
      return new Response(JSON.stringify({
        path: ".github/workflows/production-runtime-parity-evidence.yml",
        event: "workflow_dispatch",
        head_branch: "main",
        head_sha: SHA,
        run_name: runName,
        status: "completed",
        conclusion: "success",
        created_at: "2026-08-24T00:00:00Z",
        updated_at: "2026-08-24T00:00:01Z",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (String(url).includes("/artifacts?per_page=100")) {
      return new Response(JSON.stringify({ artifacts: [{ name: "bounded-evidence", expired: false, size_in_bytes: 123 }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected URL: ${url}`);
  };
  const result = await getRuntimeBreakglassRun({ run_id: "987654", expected_sha: SHA, correlation_id: request.correlation_id }, {
    env: {},
    fetchImpl,
    getAppToken: async () => "server-side-test-token",
  });
  assert.equal(result.workflow_identity_verified, true);
  assert.equal(result.exact_request_binding_verified, true);
  assert.equal(result.exact_sha_binding_source, "workflow_run_name");
  assert.equal(result.raw_logs_read, false);
  assert.equal(result.secrets_included, false);
  assert.equal(result.artifacts[0].name, "bounded-evidence");
  assert.equal(seen.length, 2);

  const mismatchFetch = async (url) => {
    if (String(url).endsWith("/actions/runs/987654")) {
      return new Response(JSON.stringify({ path: ".github/workflows/production-runtime-parity-evidence.yml", event: "workflow_dispatch", head_branch: "main", head_sha: SHA, run_name: "runtime-breakglass-wrong-binding" }), { status: 200 });
    }
    throw new Error("artifacts must not be read after binding mismatch");
  };
  await assert.rejects(
    getRuntimeBreakglassRun({ run_id: "987654", expected_sha: SHA, correlation_id: request.correlation_id }, { env: {}, fetchImpl: mismatchFetch, getAppToken: async () => "server-side-test-token" }),
    (error) => error?.code === "runtime_breakglass_workflow_identity_mismatch",
  );
});

test("run id and migration selectors remain bounded", () => {
  throwsCode(() => _testingRuntimeBreakglass.normalizeRunId("not-a-number"), "breakglass_run_id_invalid");
  assert.equal(_testingRuntimeBreakglass.normalizeRunId("123456"), "123456");
  assert.equal(_testingRuntimeBreakglass.normalizeMigration("225_sprint67_capability_resolution_envelope_ledger.sql", "plan"), "225_sprint67_capability_resolution_envelope_ledger.sql");
});
