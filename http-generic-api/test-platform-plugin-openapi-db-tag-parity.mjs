import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const openapi = readFileSync("openapi.yaml", "utf8");
const grantMigration = readFileSync("migrations/144_sprint65_platform_plugin_action_grant_tool.sql", "utf8");
const dispatchMigration = readFileSync("migrations/145_sprint65_platform_plugin_public_rest_dispatch_tool.sql", "utf8");
const templateMigration = readFileSync("migrations/146_sprint65_platform_plugin_action_template_tool.sql", "utf8");

for (const path of [
  "/platform/plugins/action-grants:",
  "/platform/plugins/dispatch-rest:",
  "/platform/plugins/action-templates:",
]) {
  assert(openapi.includes(path), `OpenAPI must include ${path}`);
}

for (const operationId of [
  "operationId: platformPluginActionGrantUpsert",
  "operationId: platformPluginDispatchRest",
  "operationId: platformPluginActionTemplateUpsert",
]) {
  assert(openapi.includes(operationId), `OpenAPI must include ${operationId}`);
}

for (const migration of [grantMigration, dispatchMigration, templateMigration]) {
  assert(migration.includes("platform-plugin"), "DB tool tags should retain legacy singular platform-plugin tag");
  assert(migration.includes("platform-plugins"), "DB tool tags must include OpenAPI platform-plugins tag for parity");
  assert(migration.includes("no_secrets"), "DB tool tags must preserve no_secrets marker");
}

console.log("platform plugin OpenAPI/DB tag parity tests passed");
