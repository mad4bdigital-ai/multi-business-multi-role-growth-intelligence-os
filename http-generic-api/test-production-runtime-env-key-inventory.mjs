#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  collectInventory,
  validateEvidence,
  CONTRACT
} from "./scripts/production-runtime-env-key-inventory.mjs";

const SHA = "e0c07f6fba431650b87d7a6f3dde76a364be6223";

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

{
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method });
    if (calls.length === 1) {
      return response({
        ok: true,
        tool: "env",
        result: {
          action: "list",
          keys: ["NODE_ENV", "REMOTE_MCP_ENVIRONMENT", "DEPLOYMENT_ENVIRONMENT", "DB_NAME"]
        }
      });
    }
    return response([
      { key: "NODE_ENV", value: "********" },
      { key: "REMOTE_MCP_ENVIRONMENT", value: "********" },
      { key: "DEPLOYMENT_ENVIRONMENT", value: "********" }
    ]);
  };
  const report = validateEvidence(await collectInventory({
    expectedProductionSha: SHA,
    backendApiKey: "backend-test-key",
    hostingerApiToken: "hostinger-test-token",
    fetchImpl
  }));
  assert.equal(report.contract, CONTRACT);
  assert.equal(report.selection.required_key, "DEPLOYMENT_ENVIRONMENT");
  assert.equal(report.selection.runtime_key_present, true);
  assert.equal(report.selection.provider_key_present, true);
  assert.equal(report.selection.provider_occurrences, 1);
  assert.equal(report.selection.action_class, "update_existing_key");
  assert.equal(report.raw_values_exposed, false);
  assert.equal(report.secrets_included, false);
  assert.equal(JSON.stringify(report).includes("backend-test-key"), false);
  assert.equal(JSON.stringify(report).includes("hostinger-test-token"), false);
  assert.deepEqual(calls.map((entry) => entry.method), ["POST", "GET"]);
}

{
  const fetchImpl = async (_url, options = {}) => {
    if (options.method === "POST") {
      return response({
        ok: true,
        tool: "env",
        result: { action: "list", keys: ["NODE_ENV", "REMOTE_MCP_ENVIRONMENT"] }
      });
    }
    return response([
      { key: "NODE_ENV", value: "********" },
      { key: "REMOTE_MCP_ENVIRONMENT", value: "********" }
    ]);
  };
  const report = await collectInventory({
    expectedProductionSha: SHA,
    backendApiKey: "backend-test-key",
    hostingerApiToken: "hostinger-test-token",
    fetchImpl
  });
  assert.equal(report.selection.provider_key_present, false);
  assert.equal(report.selection.runtime_key_present, false);
  assert.equal(report.selection.action_class, "create_missing_key_once");
}

{
  const fetchImpl = async (_url, options = {}) => {
    if (options.method === "POST") {
      return response({
        ok: true,
        tool: "env",
        result: { action: "list", keys: ["DEPLOYMENT_ENVIRONMENT"] }
      });
    }
    return response([
      { key: "DEPLOYMENT_ENVIRONMENT", value: "********" },
      { key: "DEPLOYMENT_ENVIRONMENT", value: "********" }
    ]);
  };
  const report = await collectInventory({
    expectedProductionSha: SHA,
    backendApiKey: "backend-test-key",
    hostingerApiToken: "hostinger-test-token",
    fetchImpl
  });
  assert.equal(report.selection.provider_occurrences, 2);
  assert.deepEqual(report.provider.duplicate_keys, [{ key: "DEPLOYMENT_ENVIRONMENT", count: 2 }]);
}

{
  const fetchImpl = async (_url, options = {}) => {
    if (options.method === "POST") {
      return response({
        ok: true,
        tool: "env",
        result: { action: "list", keys: ["DEPLOYMENT_ENVIRONMENT"] }
      });
    }
    return response([{ key: "DEPLOYMENT_ENVIRONMENT", value: "production_hostinger_autodeploy" }]);
  };
  await assert.rejects(
    collectInventory({
      expectedProductionSha: SHA,
      backendApiKey: "backend-test-key",
      hostingerApiToken: "hostinger-test-token",
      fetchImpl
    }),
    /unmasked environment value/
  );
}

{
  const fetchImpl = async (_url, options = {}) => {
    if (options.method === "POST") {
      return response({
        ok: true,
        tool: "env",
        result: {
          action: "list",
          keys: ["DEPLOYMENT_ENVIRONMENT"],
          values: { DEPLOYMENT_ENVIRONMENT: "[masked]" }
        }
      });
    }
    throw new Error("provider request should not execute after unsafe runtime evidence");
  };
  await assert.rejects(
    collectInventory({
      expectedProductionSha: SHA,
      backendApiKey: "backend-test-key",
      hostingerApiToken: "hostinger-test-token",
      fetchImpl
    }),
    /unexpectedly returned values/
  );
}

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.production-runtime-env-key-inventory-tests.v1",
  tests: 6,
  secrets_included: false
}));


{
  const bridgeWorkflow = readFileSync(new URL("../.github/workflows/governed-production-promotion-dispatch-bridge.yml", import.meta.url), "utf8");
  assert.equal(bridgeWorkflow.includes("  env-key-inventory:"), true);
  assert.equal(bridgeWorkflow.includes("READ_PRODUCTION_ENV_KEY_INVENTORY:([0-9a-f]{40})"), true);
  assert.equal(bridgeWorkflow.includes("name: Production"), true);
  assert.equal(bridgeWorkflow.includes("HOSTINGER_API_TOKEN: ${{ secrets.HOSTINGER_API_TOKEN }}"), true);
  assert.equal(bridgeWorkflow.includes("BACKEND_API_KEY: ${{ secrets.HOSTINGER_PRODUCTION_BACKEND_API_KEY }}"), true);
  assert.equal(bridgeWorkflow.includes("node scripts/production-runtime-env-key-inventory.mjs"), true);
  const inventoryJob = bridgeWorkflow.slice(bridgeWorkflow.indexOf("  env-key-inventory:"));
  assert.equal(/--request\s+(?:PUT|PATCH|DELETE)/u.test(inventoryJob), false);
  assert.equal(inventoryJob.includes('test("(^|_)(password|private_key|access_token|refresh_token|credential_value|raw_value)(_|$)"; "i")'), true);
  assert.equal(inventoryJob.includes('test("password|private_key|access_token|refresh_token|credential_value|raw_value"; "i")'), false);
  const sensitiveEvidenceKey = /(^|_)(password|private_key|access_token|refresh_token|credential_value|raw_value)(_|$)/iu;
  assert.equal(sensitiveEvidenceKey.test("raw_values_exposed"), false);
  assert.equal(sensitiveEvidenceKey.test("raw_value"), true);
}
