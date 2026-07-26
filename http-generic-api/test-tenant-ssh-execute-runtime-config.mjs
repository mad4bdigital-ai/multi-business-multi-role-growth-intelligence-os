import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routes = readFileSync("routes/tenantInfrastructureRoutes.js", "utf8");
const migration = readFileSync("migrations/203_sprint66_tenant_ssh_execute_runtime_config.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

assert(routes.includes('loadSshCliExecuteRuntimeConfig'), "SSH execute must load runtime config from SQL");
assert(routes.includes('platform_runtime_config'), "SSH execute runtime gate must use platform_runtime_config");
assert(routes.includes("tenant_ssh_cli_execute_runtime"), "SSH execute runtime gate must use stable config key");
assert(routes.includes('ssh_cli_execute_driver_blocked_on_web_host'), "host_ssh_spawn must be blocked on the web runtime after live 502 validation");
assert(routes.includes('host_ssh_spawn_caused_cloudflare_502_on_web_host'), "blocked host driver response must record the live 502 reason");
assert(routes.includes('required_config_json'), "disabled runtime response must explain required config JSON");
assert(routes.includes('current_driver'), "disabled runtime response must include current driver safely");
assert(routes.includes('required_driver: "dedicated_worker_or_connector_runtime"'), "runtime gate must require dedicated worker or connector runtime");
assert(routes.includes('ssh_cli_execute_dedicated_driver_not_implemented'), "web runtime must not pretend the dedicated driver is implemented");
assert(routes.includes('recommended_runtime: "dedicated_worker_or_connector_runtime"'), "disabled runtime response must recommend dedicated runtime");
assert(!routes.includes('TENANT_SSH_CLI_EXECUTE_ENABLED'), "SSH execute runtime gate must not depend on transient env flag");
assert(!routes.includes('TENANT_SSH_CLI_EXECUTE_DRIVER'), "SSH execute runtime gate must not depend on transient env driver");

assert(migration.includes("tenant_ssh_cli_execute_runtime"), "migration must seed SSH execute runtime config key");
assert(migration.includes("JSON_OBJECT('enabled', false"), "runtime config must default to disabled");
assert(migration.includes("'driver', 'disabled'"), "runtime config must default driver to disabled");
assert(migration.includes("default_disabled_until_dedicated_runtime_or_explicit_host_spawn_approval"), "runtime config must record disabled reason");
assert(runner.includes('"203_sprint66_tenant_ssh_execute_runtime_config.sql"'), "governed migration runner must allowlist migration 203");

console.log("Tenant SSH execute runtime config guard passed");
