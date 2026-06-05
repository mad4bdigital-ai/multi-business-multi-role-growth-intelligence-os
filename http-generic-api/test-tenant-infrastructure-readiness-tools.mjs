import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routes = readFileSync("routes/tenantInfrastructureRoutes.js", "utf8");
const index = readFileSync("routes/index.js", "utf8");
const migration = readFileSync("migrations/194_sprint66_tenant_infrastructure_readiness_tools.sql", "utf8");

assert(routes.includes('/me/infrastructure/database/connections/:connection_id/status'), "tenant database status route must use explicit database path");
assert(routes.includes('/me/infrastructure/database/connections/:connection_id/preflight'), "tenant database preflight route must use explicit database path");
assert(routes.includes('/me/infrastructure/ssh/connections/:connection_id/status'), "tenant SSH status route must use explicit SSH path");
assert(routes.includes('/me/infrastructure/ssh/connections/:connection_id/preflight'), "tenant SSH preflight route must use explicit SSH path");
assert(routes.includes('/me/infrastructure/connections/:connection_id/status'), "legacy generic tenant infrastructure status route may remain for direct callers");
assert(routes.includes('/me/infrastructure/connections/:connection_id/preflight'), "legacy generic tenant infrastructure preflight route may remain for direct callers");
assert(routes.includes('requireUserJwt'), "routes must require tenant user JWT");
assert(routes.includes('tenant_id = ?') && routes.includes('user_id = ?'), "routes must scope by tenant_id and user_id");
assert(routes.includes('encrypted_credentials'), "routes may check credential presence");
assert(routes.includes('will_decrypt_credentials: false'), "preflight must promise no credential decryption");
assert(routes.includes('will_open_network_connection: false'), "preflight must promise no network connection");
assert(routes.includes('will_execute_command: false'), "preflight must promise no SSH command execution");
assert(routes.includes('will_query_database: false'), "preflight must promise no database query execution");
assert(routes.includes('secrets_included: false'), "routes must never return secrets");
assert(routes.includes('tenant_database_runtime_tools_not_enabled_yet'), "database runtime execution must remain blocked in this phase");
assert(routes.includes('tenant_ssh_allowlisted_runtime_tools_not_enabled_yet'), "SSH runtime execution must remain blocked in this phase");

assert(index.includes('buildTenantInfrastructureRoutes'), "tenant infrastructure routes must be imported/mounted");
const infraMount = index.indexOf('app.use(buildTenantInfrastructureRoutes(deps))');
const connectedExecutionMount = index.indexOf('app.use(buildConnectedExecutionRoutes({ ...deps, requireAdminPrincipal }))');
const credentialMount = index.indexOf('app.use(buildCredentialRoutes(deps))');
assert(infraMount >= 0, "tenant infrastructure routes must be mounted");
assert(infraMount < connectedExecutionMount, "tenant infrastructure routes must mount before connected execution admin guard");
assert(infraMount < credentialMount, "tenant infrastructure routes must mount before credential/admin guard");

for (const key of ['tenant_database_connection_status','tenant_database_preflight','tenant_ssh_connection_status','tenant_ssh_preflight']) {
  assert(migration.includes(key), `migration must register ${key}`);
}
assert(migration.includes('no_secrets'), "migration tags must include no_secrets");
assert(migration.includes('no_command'), "SSH tools must be tagged no_command");
assert(migration.includes('no_query'), "DB tools must be tagged no_query");

console.log("Tenant infrastructure readiness tools guard passed");
