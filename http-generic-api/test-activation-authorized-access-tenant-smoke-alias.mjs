import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync(new URL("./scripts/activation-authorized-access-tenant-smoke.mjs", import.meta.url), "utf8");
const adminCli = readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");

assert.match(script, /buildActivationAuthorizedAccess/);
assert.match(script, /tenant_user_authorized_only/);
assert.match(script, /admin_tools_visible/);
assert.match(script, /cross_tenant_surface_leaks/);
assert.match(script, /blocked_field_leak_detected/);
assert.match(script, /external_provider_called: false/);
assert.match(script, /session_opened: false/);
assert.match(script, /secrets_included/);
assert.match(script, /--tenant-id/);
assert.match(script, /--user-id/);
assert.doesNotMatch(script, /getActivationSessionContext|autoOpenGptSession|fetch\(|axios|http\.request|https\.request/);

assert.match(adminCli, /activation_authorized_access_tenant_smoke/);
assert.match(adminCli, /activation-authorized-access-tenant-smoke\.mjs/);
assert.match(adminCli, /allow_extra_args: true/);
assert.match(adminCli, /max_extra_args: 4/);

console.log("Tenant activation authorized access smoke alias guard passed");
