import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const server = read("local-connector/server.mjs");
const agent = read("http-generic-api/routes/connectorAgentRoutes.js");
const legacy = read("http-generic-api/routes/localConnectorInstallRoutes.js");
const upgrader = read("local-connector/connector-safe-upgrade.ps1");
const staging = read("autopilot-portable-staging/Repair-LocalConnectorTunnel.ps1");
const smoke = read("http-generic-api/scripts/connector-agent-smoke-test.mjs");
const canonical = read("canonicals/openapi/local-connector.openapi.yaml");
const generated = read("http-generic-api/openapi/openapi.gpt-action.local-connector.yaml");
for (const file of ["connector-staging-recovery.mjs", "connector-developer-sessions.mjs", "device-files-engine.mjs", "device-terminal-engine.mjs"]) {
  assert.ok(server.includes(file), "Local Connector server must import " + file);
  assert.ok(agent.includes("local-connector/" + file), "Agent manifest must package " + file);
  assert.ok(agent.includes("Get-Mad4BManifestFile -Name '" + file + "'"), "Signed installer must fetch " + file);
  assert.ok(legacy.includes("Get-Mad4BManifestFile -Name '" + file + "'"), "Legacy installer must fetch " + file);
  assert.ok(upgrader.includes('Name = "' + file + '"'), "Safe upgrade must version and restore " + file);
  assert.ok(staging.includes('"' + file + '"'), "Staging bootstrap must carry " + file);
  assert.ok(smoke.includes('"' + file + '"'), "Release smoke test must require " + file);
}
assert.ok(agent.includes("connector-admin-recovery.openapi.yaml"), "Agent must ship signed OpenAPI schema");
assert.ok(legacy.includes("Get-Mad4BManifestFile -Name 'connector-admin-recovery.openapi.yaml'"));
assert.ok(upgrader.includes('Name = "connector-admin-recovery.openapi.yaml"'));
assert.ok(server.includes("installedSchema"), "Connector must serve packaged schema");
assert.ok(smoke.includes('"connector-admin-recovery.openapi.yaml"'));
for (const marker of ["/recovery/capabilities:", "/recovery/staging:", "/developer/sessions:", "/device/files:", "/device/terminal:"]) {
  assert.ok(canonical.includes(marker), "Canonical schema missing " + marker);
  assert.ok(generated.includes(marker), "Generated schema missing " + marker);
  assert.ok(server.includes(marker.slice(0, -1)), "Server route missing " + marker);
}
assert.equal(canonical, generated, "Canonical and generated schema projection must match exactly");
for (const route of ["/recovery/capabilities:", "/recovery/staging:", "/developer/sessions:"]) {
  const from = canonical.indexOf("  " + route);
  const next = canonical.indexOf("\n  /", from + 2);
  const section = canonical.slice(from, next === -1 ? canonical.length : next);
  assert.ok(section.includes("additionalProperties: true\n                properties:"),
    "Builder-safe top-level response properties required for " + route);
}
assert.equal(canonical.split("\n  /github:\n").length - 1, 1, "GitHub route must have one key");
assert.equal(canonical.split("\nx-gpt-action-auth-preset:\n").length - 1, 1, "Auth preset must not be duplicated");
assert.ok(canonical.includes("pattern: '^[a-f0-9]{40}$'"), "Developer exact HEAD pattern must be complete");
assert.ok(canonical.includes("session_id: { type: string"), "Developer session ID must be declared");
assert.ok(canonical.includes("cursor: { type: integer"), "Developer session cursor must be declared");
assert.match(server, /requireRecoveryAuth/);
assert.match(server, /createStagingRecoveryBridge/);
assert.match(server, /createDeveloperSessionManager/);
assert.match(server, /createDeviceFilesEngine/);
assert.match(server, /createDeviceTerminalManager/);
assert.match(server, /x-mad4b-device-terminal-approval/);
assert.match(server, /DEVICE_SCOPE_REQUIRED/);
assert.match(server, /x-mad4b-device-write-approval/);
assert.match(server, /readDeviceBody/);
console.log(JSON.stringify({ ok: true, test: "connector_staging_mcp_developer_distribution",
  signed_assets: 2, openapi_routes: 3, production_mutation: false }));
