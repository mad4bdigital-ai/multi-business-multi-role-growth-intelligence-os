import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync("migrations/137_sprint65_platform_plugin_shared_tool_bindings.sql", "utf8");

assert(sql.includes("credential_intake_session_create"), "migration must bind secure credential intake");
assert(sql.includes("admin_app_connection_create"), "migration must bind encrypted connection creation");
assert(sql.includes("credential_effective_status"), "migration must bind effective credential status");
assert(sql.includes("connector_github"), "migration must bind GitHub local connector bridge");
assert(sql.includes("connector_gcloud"), "migration must bind Google Cloud local connector bridge");
assert(sql.includes("connector_cf"), "migration must preserve Cloudflare local connector bridge");
assert(sql.includes("connector_n8n"), "migration must preserve n8n local connector bridge");

const forbiddenSecretAssignments = [
  "GITHUB_TOKEN",
  "PERSONAL_ACCESS_TOKEN",
  "access_token",
  "refresh_token",
  "client_secret",
  "encrypted_credentials",
  "credential_ref",
];
for (const forbidden of forbiddenSecretAssignments) {
  assert(!sql.toLowerCase().includes(forbidden.toLowerCase()), `migration must not store or reference secret payload fields: ${forbidden}`);
}

for (const role of ["secure_credential_intake", "encrypted_connection_create", "local_cli_bridge", "repo_read", "repo_write", "github_cli_or_rest"]) {
  assert(!sql.includes(`'${role}'`), `migration must not use unsupported binding_role enum value: ${role}`);
}

for (const role of ["connection_management", "credential_status", "dns_control", "workflow_control"]) {
  assert(sql.includes(`'${role}'`), `migration should use supported binding_role value: ${role}`);
}

assert(sql.includes("ON DUPLICATE KEY UPDATE"), "migration must be idempotent");
assert(sql.includes("No secrets are inserted"), "migration must document no-secret boundary");

console.log("platform plugin shared tool binding migration tests passed");
