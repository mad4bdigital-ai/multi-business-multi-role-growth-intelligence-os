#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  collectInventory,
  validateEvidence,
  CONTRACT
} from "./production-runtime-env-key-inventory.mjs";

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
  tests: 5,
  secrets_included: false
}));
