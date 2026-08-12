import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const tenantLifecycleRoute = readFileSync("routes/tenantLifecycleRoutes.js", "utf8");
const credentialRoute = readFileSync("routes/credentialRoutes.js", "utf8");
const routesIndex = readFileSync("routes/index.js", "utf8");
const migration = readFileSync("migrations/191_sprint66_tenant_credential_intake_connection_status.sql", "utf8");

assert(tenantLifecycleRoute.includes('/me/connections/:connection_id/credential-intake-status'), "tenant-safe router must expose connection_id status path");
assert(tenantLifecycleRoute.includes('router.get("/me/connections/:connection_id/credential-intake-status", requireTenantUserJwt'), "status route must use tenant user JWT auth, not admin backend key auth");
assert(tenantLifecycleRoute.includes('c.tenant_id = ?'), "tenant callers must be scoped to their tenant_id");
assert(tenantLifecycleRoute.includes('c.user_id = ?'), "tenant callers must be scoped to their own connection");
assert(tenantLifecycleRoute.includes('c.connected_at') && tenantLifecycleRoute.includes('c.last_validated_at'), "status route must use live user_app_connections timestamp columns");
assert(!tenantLifecycleRoute.includes('c.created_at') && !tenantLifecycleRoute.includes('c.updated_at'), "status route must not query nonexistent user_app_connections created_at/updated_at columns");
assert(tenantLifecycleRoute.includes('secrets_included: false'), "status route must never include secrets");
assert(!tenantLifecycleRoute.includes('decryptCredentials(row.encrypted_credentials)'), "status route must not decrypt credentials");
assert(tenantLifecycleRoute.includes('promoted_to_platform_secrets'), "status route must summarize auto-promotion completion status");

const tenantLifecycleMount = routesIndex.indexOf('app.use(buildTenantLifecycleRoutes())');
const connectedExecutionMount = routesIndex.indexOf('app.use(buildConnectedExecutionRoutes({ ...deps, requireAdminPrincipal }))');
const platformEvolutionMount = routesIndex.indexOf('app.use(buildPlatformEvolutionRoutes({ ...deps, requireAdminPrincipal }))');
const gptToolsMount = routesIndex.indexOf('app.use(buildGptToolsRoutes(deps))');
const credentialMount = routesIndex.indexOf('app.use(buildCredentialRoutes(deps))');
assert(tenantLifecycleMount >= 0, "tenant lifecycle routes must be mounted");
assert(gptToolsMount >= 0, "GPT tools dispatcher routes must be mounted");
assert(connectedExecutionMount >= 0, "connected execution routes must be mounted");
assert(platformEvolutionMount >= 0, "platform evolution routes must be mounted");
assert(credentialMount >= 0, "credential routes must be mounted");
assert(tenantLifecycleMount < connectedExecutionMount, "tenant-safe credential status route must mount before connected execution root admin guard");
assert(tenantLifecycleMount < platformEvolutionMount, "tenant-safe credential status route must mount before platform evolution root admin guard");
assert(tenantLifecycleMount < credentialMount, "tenant-safe credential status route must mount before credential/admin guarded routes");
assert(gptToolsMount < connectedExecutionMount, "tenant GPT tools dispatcher must mount before connected execution root admin guard");
assert(gptToolsMount < platformEvolutionMount, "tenant GPT tools dispatcher must mount before platform evolution root admin guard");
assert(gptToolsMount < credentialMount, "tenant GPT tools dispatcher must mount before credential/admin guarded routes");

assert(!credentialRoute.includes('router.get("/me/connections/:connection_id/credential-intake-status", requireBackendApiKey'), "credential status route must not be admin/backend-key guarded");

assert(migration.includes('credential_intake_connection_status'), "migration must register tenant tool");
assert(migration.includes('/me/connections/{connection_id}/credential-intake-status'), "tenant tool must dispatch by connection_id path");
assert(migration.includes('read_only') && migration.includes('no_secrets') && migration.includes('auth_scoped'), "tenant tool must be read-only/no-secrets/auth-scoped");
assert(migration.includes("JSON_ARRAY('connection_id')"), "tenant tool must require connection_id path parameter");
assert(!migration.includes('/admin/'), "tenant tool must not route to admin path");

console.log("Tenant credential intake connection status guard passed");
