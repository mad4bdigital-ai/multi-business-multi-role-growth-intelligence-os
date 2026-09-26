import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";

import { buildHealthRoutes } from "./routes/healthRoutes.js";

const commit = "a".repeat(40);
const policyHash = "b".repeat(64);

const tmp = mkdtempSync(join(tmpdir(), "mad4b-health-provenance-"));
const previousCwd = process.cwd();

function buildDeps(env) {
  return {
    env,
    jobRepository: {
      values: () => [],
      size: () => 0,
    },
    normalizeJobStatus: (value) => value,
    getWaitingCountSafe: async () => ({ ok: true, count: 0 }),
    getRedisRuntimeStatus: () => ({ connected: true }),
    getSqlCacheRuntimeStatus: () => ({
      enabled: false,
      available: false,
      skipped: true,
    }),
    testDbConnection: async () => true,
    SERVICE_VERSION: "test",
    QUEUE_WORKER_ENABLED: true,
  };
}

async function listen(app) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  return server;
}

async function close(server) {
  await new Promise((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()),
  );
}

try {
  process.chdir(tmp);

  const manifestPath = join(tmp, "deployment-manifest.json");
  const policyPath = join(tmp, "staging-route-policy.json");

  writeFileSync(
    manifestPath,
    JSON.stringify({
      repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
      branch: "main",
      commit_sha: commit,
      secrets_included: false,
    }),
  );

  writeFileSync(
    policyPath,
    JSON.stringify({
      policy_key: "activation_gateway_staging",
      content_hash_sha256: policyHash,
    }),
  );

  {
    const app = express();
    app.use(buildHealthRoutes(buildDeps({
      NODE_ENV: "staging",
      DEPLOYMENT_MANIFEST_PATH: manifestPath,
    })));

    const server = await listen(app);
    try {
      const port = server.address().port;
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.sourceCommit, commit);
      assert.equal(body.policyHash, policyHash);
      assert.equal(response.headers.get("x-mad4b-deployment-sha"), commit);
      assert.equal(
        response.headers.get("x-activation-gateway-policy-hash"),
        policyHash,
      );
    } finally {
      await close(server);
    }
  }

  writeFileSync(
    manifestPath,
    JSON.stringify({
      repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
      branch: "main",
      commit_sha: "not-a-sha",
      secrets_included: false,
    }),
  );
  writeFileSync(policyPath, JSON.stringify({ content_hash_sha256: "bad" }));

  {
    const app = express();
    app.use(buildHealthRoutes(buildDeps({
      NODE_ENV: "staging",
      DEPLOYMENT_MANIFEST_PATH: manifestPath,
    })));

    const server = await listen(app);
    try {
      const port = server.address().port;
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(Object.hasOwn(body, "sourceCommit"), false);
      assert.equal(Object.hasOwn(body, "policyHash"), false);
      assert.equal(response.headers.get("x-mad4b-deployment-sha"), null);
      assert.equal(
        response.headers.get("x-activation-gateway-policy-hash"),
        null,
      );
    } finally {
      await close(server);
    }
  }
} finally {
  process.chdir(previousCwd);
  rmSync(tmp, { recursive: true, force: true });
}

console.log("health_gateway_ready_provenance=PASS");
