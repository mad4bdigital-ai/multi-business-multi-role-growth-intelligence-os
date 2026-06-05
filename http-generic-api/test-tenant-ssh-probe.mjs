import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routes = readFileSync("routes/tenantInfrastructureRoutes.js", "utf8");
const migration = readFileSync("migrations/198_sprint66_tenant_ssh_probe_tool.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");
const pkg = readFileSync("package.json", "utf8");

assert(routes.includes('net from "node:net"'), "SSH probe must use built-in net module");
assert(routes.includes('promises as dns'), "SSH probe must resolve hostnames before connecting");
assert(!pkg.includes('"ssh2"'), "SSH probe phase must not add an SSH dependency");
assert(routes.includes('/me/infrastructure/ssh/connections/:connection_id/probe'), "explicit tenant SSH probe route must exist");
assert(routes.includes('loadTenantConnection(pool, req, connectionId, "ssh_key_pair")'), "SSH probe must load a tenant-scoped SSH connection");
assert(routes.includes('readinessFor(row, "ssh_key_pair")'), "SSH probe must enforce readiness before network probe");
assert(routes.includes('probeSshTcpBanner'), "SSH probe route must call TCP/banner probe helper");
assert(routes.includes('authenticated: false'), "SSH probe must not authenticate");
assert(routes.includes('command_executed: false'), "SSH probe must not execute commands");
assert(routes.includes('private_key_used_for_auth: false'), "SSH probe must not use private key for auth");
assert(routes.includes('isBlockedProbeIp'), "SSH probe must block private/local probe targets");
assert(routes.includes('ssh_probe_target_blocked'), "SSH probe must return stable blocked-target error");
assert(routes.includes('timeout_ms = clampInt(options.timeout_ms, 5000, 1000, 10000)'), "SSH probe timeout must be bounded");
assert(!routes.includes('exec('), "SSH probe must not spawn shell commands");
assert(!routes.includes('spawn('), "SSH probe must not spawn processes");
assert(!routes.includes('ssh -'), "SSH probe must not invoke CLI ssh");
assert(routes.includes('secrets_included: false'), "SSH probe must never return secrets");

assert(migration.includes('tenant_ssh_probe'), "migration must register tenant_ssh_probe");
assert(migration.includes('/me/infrastructure/ssh/connections/{connection_id}/probe'), "migration must use explicit SSH probe path");
assert(migration.includes('tcp_banner'), "migration tags must disclose TCP/banner scope");
assert(migration.includes('no_auth'), "migration tags must disclose no auth");
assert(migration.includes('no_command'), "migration tags must disclose no commands");
assert(migration.includes('no_private_network'), "migration tags must disclose private-network block");
assert(migration.includes('no_secrets'), "migration tags must include no_secrets");
assert(runner.includes('"198_sprint66_tenant_ssh_probe_tool.sql"'), "governed migration runner must allowlist migration 198");

console.log("Tenant SSH probe guard passed");
