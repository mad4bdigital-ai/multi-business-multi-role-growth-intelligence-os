import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import YAML from "yaml";

const execFileAsync = promisify(execFile);
const API_DIR = path.dirname(fileURLToPath(import.meta.url));
const SYNC_SCRIPT = path.join(API_DIR, "scripts", "openapi-precise-contract-registry-sync.mjs");
const SIGNATURE = "POST /tenant/platform/plugins/resolve";
const ROUTE_PATH = "/tenant/platform/plugins/resolve";
const PATH_REF = "./openapi/platform-plugin-tenant-resolve.yaml#/tenantPlatformPluginResolvePath";
const ROUTE_FILE = "routes/tenantPlatformPluginRoutes.js";
const OPERATION_ID = "tenantPlatformPluginResolve";

function legacyOperation(overrides = {}) {
  return {
    "x-openai-isConsequential": false,
    tags: ["platform-plugins"],
    operationId: OPERATION_ID,
    summary: "Resolve tenant readiness for a Platform Plugin action/tool",
    description: "Legacy inline contract before exact workspace ownership became mandatory.",
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["plugin_key"],
            properties: {
              plugin_key: { type: "string" },
              action_key: { type: "string" },
              tool_key: { type: "string" },
            },
          },
        },
      },
    },
    responses: {
      "200": {
        description: "Tenant-scoped plugin readiness result",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                compatibility_telemetry: {
                  type: "object",
                  properties: {
                    contract_version: { type: "string", enum: ["one-selector-v1"] },
                  },
                },
              },
            },
          },
        },
      },
      "401": { description: "Unauthorized" },
    },
    ...overrides,
  };
}

function canonicalOperation() {
  return {
    "x-openai-isConsequential": false,
    "x-runtime-contract-source": ROUTE_FILE,
    "x-runtime-auth-profile": "user_jwt",
    "x-contract-completeness": "precise-runtime-contract",
    tags: ["platform-plugins"],
    operationId: OPERATION_ID,
    summary: "Resolve tenant readiness for a Platform Plugin action/tool in one exact workspace",
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["plugin_key", "workspace_id"],
            properties: {
              plugin_key: { type: "string" },
              workspace_id: { type: "string", minLength: 1, maxLength: 64 },
              action_key: { type: "string" },
              tool_key: { type: "string" },
            },
          },
        },
      },
    },
    responses: {
      "200": {
        description: "Tenant-scoped plugin readiness result",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                compatibility_telemetry: {
                  type: "object",
                  properties: {
                    contract_version: { type: "string", enum: ["one-selector-workspace-v2"] },
                  },
                },
              },
            },
          },
        },
      },
      "400": { description: "Invalid tenant resolve contract" },
      "401": { description: "Unauthorized" },
    },
  };
}

async function createFixture(operation = legacyOperation()) {
  const root = await mkdtemp(path.join(os.tmpdir(), "openapi-precise-inline-transition-"));
  await mkdir(path.join(root, "routes"), { recursive: true });
  await mkdir(path.join(root, "openapi"), { recursive: true });
  await mkdir(path.join(root, "openapi-route-contracts.d"), { recursive: true });
  await writeFile(path.join(root, ROUTE_FILE), 'router.post("/tenant/platform/plugins/resolve", handler);\n', "utf8");
  await writeFile(path.join(root, "openapi-route-contracts.yaml"), "version: 1\ncontracts: {}\n", "utf8");
  await writeFile(path.join(root, "openapi-route-contracts.d", "platform-plugin.yaml"), YAML.stringify({
    version: 1,
    contracts: {
      [SIGNATURE]: {
        path_item_ref: PATH_REF,
        route_file: ROUTE_FILE,
        composition_mode: "inline",
      },
    },
  }), "utf8");
  await writeFile(path.join(root, "openapi", "platform-plugin-tenant-resolve.yaml"), YAML.stringify({
    tenantPlatformPluginResolvePath: { post: canonicalOperation() },
  }), "utf8");
  await writeFile(path.join(root, "openapi.yaml"), YAML.stringify({
    openapi: "3.1.0",
    info: { title: "Fixture", version: "1.0.0" },
    paths: { [ROUTE_PATH]: { post: operation } },
  }), "utf8");
  return root;
}

async function runSync(root, args) {
  try {
    const result = await execFileAsync(process.execPath, [SYNC_SCRIPT, ...args], {
      cwd: root,
      timeout: 30000,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env },
    });
    return { ok: true, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      ok: false,
      stdout: String(error?.stdout || ""),
      stderr: String(error?.stderr || ""),
      exit_code: error?.code ?? null,
    };
  }
}

const validRoot = await createFixture();
try {
  const write = await runSync(validRoot, ["--write"]);
  assert.equal(write.ok, true, write.stderr || write.stdout);
  const summary = JSON.parse(write.stdout);
  assert.equal(summary.ok, true);
  assert.equal(summary.changed, true);
  assert.equal(summary.inline_contract_count, 1);
  assert.equal(summary.applied_registered_path_replacements.length, 1);
  assert.equal(summary.applied_registered_path_replacements[0].composition_mode, "inline");

  const written = YAML.parse(await readFile(path.join(validRoot, "openapi.yaml"), "utf8"));
  const pathItem = written.paths[ROUTE_PATH];
  assert.equal(pathItem.$ref, undefined, "inline composition must not emit an external root path reference");
  assert.deepEqual(pathItem, { post: canonicalOperation() });
  const requestSchema = pathItem.post.requestBody.content["application/json"].schema;
  assert(requestSchema.required.includes("workspace_id"));
  assert.equal(requestSchema.properties.workspace_id.maxLength, 64);
  assert.deepEqual(
    pathItem.post.responses["200"].content["application/json"].schema.properties.compatibility_telemetry.properties.contract_version.enum,
    ["one-selector-workspace-v2"],
  );

  const check = await runSync(validRoot, ["--check"]);
  assert.equal(check.ok, true, check.stderr || check.stdout);
  const checkSummary = JSON.parse(check.stdout);
  assert.equal(checkSummary.ok, true);
  assert.equal(checkSummary.changed, false);
  assert.equal(checkSummary.replaceable_registered_path_count, 0);
  assert.equal(checkSummary.conflict_count, 0);
} finally {
  await rm(validRoot, { recursive: true, force: true });
}

for (const malformed of [
  legacyOperation({ operationId: `${OPERATION_ID}Unexpected` }),
  legacyOperation({ "x-openai-isConsequential": true }),
  legacyOperation({ requestBody: { required: true, content: { "application/json": { schema: {
    type: "object",
    required: ["plugin_key", "workspace_id"],
    properties: { plugin_key: { type: "string" }, workspace_id: { type: "string" } },
  } } } } }),
  legacyOperation({ responses: { "200": { description: "wrong version", content: { "application/json": { schema: {
    type: "object",
    properties: { compatibility_telemetry: { type: "object", properties: { contract_version: { enum: ["unexpected-v9"] } } } },
  } } } } } }),
]) {
  const blockedRoot = await createFixture(malformed);
  try {
    const result = await runSync(blockedRoot, ["--write"]);
    assert.equal(result.ok, false, "Unrecognized inline legacy contract must fail closed.");
    assert.match(result.stderr, /openapi_precise_contract_path_conflict/);
    assert.match(result.stderr, /registered_path_inline_contract_not_replaceable/);
    const unchanged = YAML.parse(await readFile(path.join(blockedRoot, "openapi.yaml"), "utf8"));
    assert.equal(unchanged.paths[ROUTE_PATH].post.operationId, malformed.operationId);
  } finally {
    await rm(blockedRoot, { recursive: true, force: true });
  }
}

console.log(JSON.stringify({
  ok: true,
  contract: "openapi_precise_inline_registered_path_transition.v1",
  signature: SIGNATURE,
  operation_id: OPERATION_ID,
  composition_mode: "inline",
  malformed_variants_blocked: 4,
  idempotency_passed: true,
  secrets_included: false,
}, null, 2));
