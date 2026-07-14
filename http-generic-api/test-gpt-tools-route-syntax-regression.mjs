import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import {
  extractGeneratedArtifacts,
  _testingOperationGeneratedArtifactService,
} from "./operationGeneratedArtifactService.js";

const execFileAsync = promisify(execFile);

async function main() {
  for (const routePath of [
    "routes/gptToolsRoutes.js",
    "routes/operationOrchestratorRoutes.js",
    "operationGeneratedArtifactService.js",
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
  assert.match(operationRoutes, /router\.get\("\/operations\/artifacts"/);
  assert.match(operationRoutes, /artifact_registry: artifactRegistry/);

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

  const openapi = readFileSync(
    new URL("./openapi/operation-artifacts.yaml", import.meta.url),
    "utf8",
  );
  assert.match(openapi, /openapi: 3\.1\.0/);
  assert.match(openapi, /\/admin\/operations\/artifacts:/);
  assert.match(openapi, /\/tenant\/operations\/artifacts:/);
  assert.match(openapi, /next_cursor/);
  assert.match(openapi, /secrets_included/);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
