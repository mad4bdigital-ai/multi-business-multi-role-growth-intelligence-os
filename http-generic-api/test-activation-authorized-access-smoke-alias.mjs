import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync(new URL("./scripts/activation-authorized-access-smoke.mjs", import.meta.url), "utf8");
const adminCli = readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");

assert.match(script, /buildActivationAuthorizedAccess/);
assert.match(script, /registered_surface_keys/);
assert.match(script, /blocked_field_leak_detected/);
assert.match(script, /external_provider_called: false/);
assert.match(script, /session_opened: false/);
assert.match(script, /secrets_included/);
assert.doesNotMatch(script, /getActivationSessionContext|autoOpenGptSession|fetch\(|axios|http\.request|https\.request/);

assert.match(adminCli, /activation_authorized_access_smoke/);
assert.match(adminCli, /activation-authorized-access-smoke\.mjs/);
assert.match(adminCli, /allow_extra_args: false/);

console.log("Activation authorized access smoke alias guard passed");
