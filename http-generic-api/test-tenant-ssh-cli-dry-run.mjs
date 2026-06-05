import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routes = readFileSync("routes/tenantInfrastructureRoutes.js", "utf8");
const migration = readFileSync("migrations/199_sprint66_tenant_ssh_cli_dry_run_tool.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

assert(routes.includes('SSH_CLI_DRY_RUN_ALLOWLIST'), "SSH CLI dry-run must use a fixed allowlist");
assert(routes.includes('/me/infrastructure/ssh/connections/:connection_id/cli/dry-run'), "explicit tenant SSH CLI dry-run route must exist");
assert(routes.includes('loadTenantConnection(pool, req, connectionId, "ssh_key_pair")'), "SSH CLI dry-run must load tenant-scoped SSH connection");
assert(routes.includes('readinessFor(row, "ssh_key_pair")'), "SSH CLI dry-run must enforce readiness");
assert(routes.includes('buildSshCliDryRunPlan'), "SSH CLI dry-run must build a validated plan");
assert(routes.includes('ssh_cli_command_not_allowlisted'), "SSH CLI dry-run must reject non-allowlisted command keys");
assert(routes.includes('will_decrypt_credentials: false'), "SSH CLI dry-run must not decrypt credentials");
assert(routes.includes('will_authenticate_ssh: false'), "SSH CLI dry-run must not authenticate SSH");
assert(routes.includes('will_open_network_connection: false'), "SSH CLI dry-run must not open network connections");
assert(routes.includes('will_execute_command: false'), "SSH CLI dry-run must not execute commands");
assert(routes.includes('execution_enabled: false'), "SSH CLI dry-run must not enable execution");
assert(routes.includes('tenant_ssh_cli_allowlisted_execute_not_enabled_yet'), "SSH CLI dry-run must identify the gated future execute tool");
assert(!routes.includes('/cli/execute'), "SSH CLI execute route must not exist in dry-run phase");
assert(!routes.includes('tenant_ssh_cli_allowlisted_execute'), "SSH CLI execute tool must not be implemented in this phase");
assert(routes.includes('secrets_included: false'), "SSH CLI dry-run must never return secrets");

for (const commandKey of ['pwd', 'whoami', 'uname_s', 'uptime']) {
  assert(routes.includes(commandKey), `SSH CLI dry-run allowlist must include ${commandKey}`);
  assert(migration.includes(commandKey), `migration input schema must include ${commandKey}`);
}
assert(migration.includes('tenant_ssh_cli_allowlisted_dry_run'), "migration must register tenant_ssh_cli_allowlisted_dry_run");
assert(migration.includes('/me/infrastructure/ssh/connections/{connection_id}/cli/dry-run'), "migration must use explicit dry-run path");
assert(migration.includes('no_freeform_command'), "migration tags must disclose no freeform command");
assert(migration.includes('no_command'), "migration tags must disclose no command execution");
assert(migration.includes('no_network'), "migration tags must disclose no network connection");
assert(migration.includes('no_auth'), "migration tags must disclose no auth");
assert(migration.includes('no_secrets'), "migration tags must include no_secrets");
assert(runner.includes('"199_sprint66_tenant_ssh_cli_dry_run_tool.sql"'), "governed migration runner must allowlist migration 199");

console.log("Tenant SSH CLI dry-run guard passed");
