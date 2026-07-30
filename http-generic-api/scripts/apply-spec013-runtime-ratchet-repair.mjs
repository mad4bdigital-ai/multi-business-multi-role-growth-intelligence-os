#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(scriptDir, "..");
const repositoryRoot = path.resolve(apiRoot, "..");
const routesPath = path.join(apiRoot, "routes", "systemLayerRoutes.js");
const openapiPath = path.join(apiRoot, "openapi.yaml");
const testManifestPath = path.join(apiRoot, "scripts", "test-manifest.mjs");

function replaceExactlyOnce(value, before, after, label) {
  const first = value.indexOf(before);
  if (first < 0) throw new Error(`${label}: expected source block was not found`);
  if (value.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${label}: expected source block is not unique`);
  }
  return `${value.slice(0, first)}${after}${value.slice(first + before.length)}`;
}

function transformFunction(source, startMarker, endMarker, transform, label) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`${label}: start marker not found`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`${label}: end marker not found`);
  const block = source.slice(start, end);
  const updated = transform(block);
  if (updated === block) throw new Error(`${label}: transform produced no change`);
  return `${source.slice(0, start)}${updated}${source.slice(end)}`;
}

let routes = fs.readFileSync(routesPath, "utf8");
routes = transformFunction(
  routes,
  "async function callPlatformEndpointToolIfAvailable",
  "async function callTenantEndpointRegistryToolIfAvailable",
  (block) => {
    let updated = replaceExactlyOnce(block, "      LIMIT 1`,", "      LIMIT 2`,", "platform binding limit");
    updated = replaceExactlyOnce(
      updated,
      "  const row = rows[0];\n\n  if (row.scope_class === \"admin\" && !isAdminPrincipal(auth)) {",
      `  if (rows.length > 1) {\n    const err = new Error(\"The visible platform endpoint tool name resolves to more than one active binding.\");\n    err.status = 409;\n    err.code = \"platform_endpoint_tool_binding_ambiguous\";\n    err.details = {\n      tool_name: String(name || \"\"),\n      candidate_count: rows.length,\n      secrets_included: false,\n    };\n    throw err;\n  }\n\n  const [row] = rows;\n\n  if (row.scope_class === \"admin\" && !isAdminPrincipal(auth)) {`,
      "platform binding uniqueness",
    );
    return updated;
  },
  "platform endpoint tool binding",
);

routes = transformFunction(
  routes,
  "async function getConnectorRegistrySystem",
  "function clampDriveToolLimit",
  (block) => {
    let updated = replaceExactlyOnce(block, "      LIMIT 1`,", "      LIMIT 2`,", "connector system limit");
    updated = replaceExactlyOnce(
      updated,
      "  const row = rows[0];\n  if (auth && !isAdminPrincipal(auth) && row.tenant_id !== principalTenantId(auth)) {",
      `  if (rows.length > 1) {\n    const err = new Error(\`Connector system \${systemId} is ambiguous in the registry.\`);\n    err.status = 409;\n    err.code = \"connector_system_ambiguous\";\n    err.details = {\n      system_id: systemId,\n      candidate_count: rows.length,\n      secrets_included: false,\n    };\n    throw err;\n  }\n\n  const [row] = rows;\n  if (auth && !isAdminPrincipal(auth) && row.tenant_id !== principalTenantId(auth)) {`,
      "connector system uniqueness",
    );
    return updated;
  },
  "connector registry exact read",
);

let openapi = fs.readFileSync(openapiPath, "utf8");
openapi = replaceExactlyOnce(
  openapi,
  '                system_id: { type: string, default: "98d6a18b-5578-11f1-9baf-8e76a7e1749f" }',
  "                system_id: { type: string, description: Governed connected-system registry identifier selected for the promotion target. }",
  "fixed connected-system identifier",
);

const mainManifest = execFileSync(
  "git",
  ["show", "origin/main:http-generic-api/scripts/test-manifest.mjs"],
  { cwd: repositoryRoot, encoding: "utf8" },
);
const manifestAnchor = '  "node test-semantic-capability-effective-resolution.mjs",';
const manifestInsert = [
  manifestAnchor,
  '  "node test-system-tool-catalog-v2.mjs",',
  '  "node test-system-layer-response-fallback.mjs",',
  '  "node test-spec013-runtime-ratchet-contract.mjs",',
].join("\n");
const testManifest = replaceExactlyOnce(
  mainManifest,
  manifestAnchor,
  manifestInsert,
  "Spec 013 test manifest insertion",
);

fs.writeFileSync(routesPath, routes);
fs.writeFileSync(openapiPath, openapi);
fs.writeFileSync(testManifestPath, testManifest);
console.log("Spec 013 runtime ratchet repair and complete test manifest restoration applied");
