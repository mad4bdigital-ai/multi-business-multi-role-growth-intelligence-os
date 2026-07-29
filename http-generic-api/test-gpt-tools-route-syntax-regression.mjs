import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import {
  extractGeneratedArtifacts,
  _testingOperationGeneratedArtifactService,
} from "./operationGeneratedArtifactService.js";
import {
  buildCapabilityRenewalRequest,
  finalizeOperationCapabilityLifecycle,
  prepareOperationCapabilityLifecycle,
  _testingOperationCapabilityLifecycleService,
} from "./operationCapabilityLifecycleService.js";

const execFileAsync = promisify(execFile);

async function main() {
  for (const routePath of [
    "routes/gptToolsRoutes.js",
    "routes/operationOrchestratorRoutes.js",
    "operationGeneratedArtifactService.js",
    "operationCapabilityLifecycleService.js",
  ]) {
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      "--check",
      routePath,
    ], {
      cwd: new URL(".", import.meta.url),
      timeout: 30_000,
    });

    assert.equal(stdout, "");
    assert.equal(stderr, "");
  }

  const operationRoutes = readFileSync(
    new URL("./routes/operationOrchestratorRoutes.js", import.meta.url),
    "utf8",
  );
  assert.match(operationRoutes, /collectChunkedToolResponse/);
  assert.match(operationRoutes, /dispatchWithChunkCollection/);
  assert.match(operationRoutes, /recordOperationGeneratedArtifacts/);
  assert.match(operationRoutes, /listOperationGeneratedArtifacts/);
  assert.match(operationRoutes, /router\.get\(`\$\{prefix\}\/operations\/artifacts`/);
  assert.match(operationRoutes, /router\.use\(\s*"\/admin\/operations"/s);
  assert.match(operationRoutes, /router\.use\(\s*"\/tenant\/operations"/s);
  assert.match(operationRoutes, /artifact_registry: artifactRegistry/);
  assert.match(operationRoutes, /prepareOperationCapabilityLifecycle/);
  assert.match(operationRoutes, /finalizeOperationCapabilityLifecycle/);
  assert.match(operationRoutes, /capability_lifecycle: lifecycleResult/);

  const artifacts = extractGeneratedArtifacts({
    run_id: "11111111-1111-4111-8111-111111111111",
    generated_artifacts: [
      {
        artifact_type: "pull_request",
        artifact_uri: "github://owner/repo/pull/2551",
        mime_type: "application/vnd.github+json",
        sha256: "a".repeat(64),
        size_bytes: 42,
        redaction_status: "non_secret",
        pull_number: 2551,
        content_text: "must-not-be-persisted",
      },
      {
        artifact_type: "pull_request",
        artifact_uri: "github://owner/repo/pull/2551",
        sha256: "a".repeat(64),
      },
      {
        artifact_type: "unsafe",
        artifact_uri: "data:text/plain,secret",
      },
      {
        artifact_type: "secret",
        artifact_uri: "github://owner/repo/secret",
        secrets_included: true,
      },
    ],
  });
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].artifact_type, "pull_request");
  assert.equal(artifacts[0].checksum_sha256, "a".repeat(64));
  assert.equal(artifacts[0].size_bytes, 42);
  assert.deepEqual(artifacts[0].metadata, { pull_number: 2551 });
  assert.equal(Object.hasOwn(artifacts[0].metadata, "content_text"), false);
  assert.equal(_testingOperationGeneratedArtifactService.safeUri("data:text/plain,secret"), null);
  assert.equal(_testingOperationGeneratedArtifactService.safeUri("https://user:pass@example.com/a"), null);
  assert.equal(_testingOperationGeneratedArtifactService.normalizeSha256("bad"), null);
  assert.equal(_testingOperationGeneratedArtifactService.normalizeSize(-1), null);

  const cursor = _testingOperationGeneratedArtifactService.encodeCursor(
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  );
  assert.equal(
    _testingOperationGeneratedArtifactService.decodeCursor(
      "11111111-1111-4111-8111-111111111111",
      cursor,
    ),
    "22222222-2222-4222-8222-222222222222",
  );
  assert.throws(
    () => _testingOperationGeneratedArtifactService.decodeCursor(
      "33333333-3333-4333-8333-333333333333",
      cursor,
    ),
    (error) => error.code === "OPERATION_ARTIFACT_CURSOR_INVALID",
  );

  const migration = readFileSync(
    new URL("./migrations/20260714_operation_generated_artifacts.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS operation_generated_artifacts/);
  assert.match(migration, /FOREIGN KEY \(run_id\) REFERENCES repository_automation_runs\(run_id\)/);
  assert.match(migration, /UNIQUE KEY uq_operation_generated_artifacts_run_key/);
  assert.match(migration, /CHECK \(secrets_included = 0\)/);
  assert.doesNotMatch(migration, /content_text|content_json|password|token/i);
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/i);

  const artifactOpenApi = readFileSync(
    new URL("./openapi/operation-artifacts.yaml", import.meta.url),
    "utf8",
  );
  assert.match(artifactOpenApi, /openapi: 3\.1\.0/);
  assert.match(artifactOpenApi, /\/admin\/operations\/artifacts:/);
  assert.match(artifactOpenApi, /\/tenant\/operations\/artifacts:/);
  assert.match(artifactOpenApi, /next_cursor/);
  assert.match(artifactOpenApi, /secrets_included/);

  assert.equal(
    _testingOperationCapabilityLifecycleService.operationRequiresCapability(
      "repo.change.preview",
    ),
    false,
  );
  assert.equal(
    _testingOperationCapabilityLifecycleService.operationRequiresCapability(
      "repo.change.execute",
    ),
    true,
  );
  assert.equal(
    _testingOperationCapabilityLifecycleService.repositoryResourceUri({
      owner: "owner",
      repo: "repo",
    }),
    "github://owner/repo",
  );

  const renewalRequest = buildCapabilityRenewalRequest({
    auth: { tenant_id: "tenant-a", user_id: "user-a" },
    input: { owner: "owner", repo: "repo", workspace_id: "workspace-a" },
    operationKey: "repo.change.execute",
    ttlMinutes: 45,
  });
  assert.equal(renewalRequest.ttlMinutes, 45);
  assert.ok(renewalRequest.passthrough.includes("--resource-uri"));
  assert.ok(renewalRequest.passthrough.includes("github://owner/repo"));
  assert.ok(renewalRequest.passthrough.includes("repository_automation_run"));

  {
    let createCalls = 0;
    const prepared = await prepareOperationCapabilityLifecycle({
      pool: {},
      auth: { tenant_id: "tenant-a", user_id: "user-a" },
      input: { operation_key: "repo.change.execute", capability_envelope_id: "env-ready" },
      operationKey: "repo.change.execute",
      resolveEnvelope: async () => ({ ok: true, envelope_id: "env-ready" }),
      transitionEnvelope: async () => ({ ok: true }),
      createEnvelope: async () => { createCalls += 1; return {}; },
    });
    assert.equal(prepared.status, "ready");
    assert.equal(prepared.source, "existing");
    assert.equal(createCalls, 0);
  }

  {
    const transitions = [];
    const prepared = await prepareOperationCapabilityLifecycle({
      pool: {},
      auth: { tenant_id: "tenant-a", user_id: "user-a" },
      input: {
        operation_key: "repo.change.execute",
        capability_envelope_id: "env-expired",
        owner: "owner",
        repo: "repo",
      },
      operationKey: "repo.change.execute",
      resolveEnvelope: async () => ({
        ok: false,
        status: "capability_resolution_envelope_expired",
      }),
      transitionEnvelope: async (input) => {
        transitions.push(input);
        return { ok: true };
      },
      createEnvelope: async () => ({
        ok: true,
        envelope_id: "env-renewed",
        envelope_status: "ready_for_dispatch",
        decision: "ready_for_dispatch",
        dispatch_allowed: true,
        approval_required: false,
        blocking_gap_count: 0,
        expires_in_minutes: 60,
      }),
    });
    assert.equal(prepared.status, "renewed_ready");
    assert.equal(prepared.envelope_id, "env-renewed");
    assert.equal(prepared.input.capability_envelope_id, "env-renewed");
    assert.equal(transitions[0].action, "expire");
  }

  await assert.rejects(
    () => prepareOperationCapabilityLifecycle({
      pool: {},
      auth: { tenant_id: "tenant-a", user_id: "user-a" },
      input: { operation_key: "repo.change.execute", owner: "owner", repo: "repo" },
      operationKey: "repo.change.execute",
      createEnvelope: async () => ({
        ok: true,
        envelope_id: "env-approval",
        envelope_status: "ready_requires_approval",
        decision: "ready_requires_approval",
        dispatch_allowed: false,
        approval_required: true,
        blocking_gap_count: 0,
      }),
    }),
    (error) => error.status === 409
      && error.code === "OPERATION_CAPABILITY_RENEWAL_REQUIRES_APPROVAL",
  );

  {
    const calls = [];
    const finalized = await finalizeOperationCapabilityLifecycle({
      pool: {},
      lifecycle: {
        required: true,
        status: "ready",
        envelope_id: "env-ready",
        operation_key: "repo.change.execute",
      },
      result: { ok: true, run_id: "run-1" },
      transitionEnvelope: async (input) => {
        calls.push(input);
        return { ok: true, status: "consumed" };
      },
    });
    assert.equal(finalized.status, "consumed");
    assert.equal(calls[0].action, "consume");
    assert.equal(calls[0].executionRef, "operation_run:run-1");
  }

  {
    let calls = 0;
    const finalized = await finalizeOperationCapabilityLifecycle({
      pool: {},
      lifecycle: {
        required: true,
        status: "ready",
        envelope_id: "env-ready",
        operation_key: "repo.change.execute",
      },
      result: { ok: false, status: "awaiting_input" },
      transitionEnvelope: async () => { calls += 1; return { ok: true }; },
    });
    assert.equal(finalized.status, "retained_for_bounded_retry");
    assert.equal(calls, 0);
  }

  const lifecycleOpenApi = readFileSync(
    new URL("./openapi/operation-capability-lifecycle.yaml", import.meta.url),
    "utf8",
  );
  assert.match(lifecycleOpenApi, /openapi: 3\.1\.0/);
  assert.match(lifecycleOpenApi, /automatic_capability_renewal/);
  assert.match(lifecycleOpenApi, /capability_ttl_minutes/);
  assert.match(lifecycleOpenApi, /OPERATION_CAPABILITY_RENEWAL_REQUIRES_APPROVAL/);
  assert.match(lifecycleOpenApi, /capability_lifecycle/);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
