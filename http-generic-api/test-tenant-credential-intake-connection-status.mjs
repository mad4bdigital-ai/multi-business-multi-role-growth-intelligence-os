import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync("routes/credentialRoutes.js", "utf8");
const migration = readFileSync("migrations/191_sprint66_tenant_credential_intake_connection_status.sql", "utf8");

assert(route.includes('/me/connections/:connection_id/credential-intake-status'), "route must expose connection_id status path");
assert(route.includes('requireBackendApiKey, async (req, res)'), "route must reuse shared auth middleware for user JWT/backend auth parsing");
assert(route.includes('tenantScoped'), "route must distinguish tenant-scoped callers");
assert(route.includes('c.tenant_id = ?'), "tenant callers must be scoped to their tenant_id");
assert(route.includes('c.user_id = ?'), "tenant callers with user_id must be scoped to their own connection");
assert(route.includes('secrets_included: false'), "route must never include secrets");
assert(!route.includes('decryptCredentials(row.encrypted_credentials)'), "status route must not decrypt credentials");
assert(route.includes('promoted_to_platform_secrets'), "route must summarize auto-promotion completion status");

assert(migration.includes('credential_intake_connection_status'), "migration must register tenant tool");
assert(migration.includes('/me/connections/{connection_id}/credential-intake-status'), "tenant tool must dispatch by connection_id path");
assert(migration.includes('read_only') && migration.includes('no_secrets') && migration.includes('auth_scoped'), "tenant tool must be read-only/no-secrets/auth-scoped");
assert(migration.includes("JSON_ARRAY('connection_id')"), "tenant tool must require connection_id path parameter");
assert(!migration.includes('/admin/'), "tenant tool must not route to admin path");

console.log("Tenant credential intake connection status guard passed");
