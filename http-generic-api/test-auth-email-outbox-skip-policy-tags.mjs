import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/20260723_auth_email_outbox_skip_ineligible_policy_tags.sql", import.meta.url), "utf8");

assert.match(migration, /UPDATE\s+admin_platform_endpoint_tools/i, "migration must update the admin tool registry only");
assert.match(migration, /tool_key\s*=\s*'auth_email_outbox_skip_ineligible'/i, "migration must target the skip-ineligible tool only");
assert.match(migration, /approval_required/, "mutation tool must declare approval_required");
assert.match(migration, /readback/, "mutation tool must declare readback");
assert.match(migration, /same_cycle_readback/, "mutation tool must declare same_cycle_readback");
assert.match(migration, /no_delivery/, "tool must remain no-delivery tagged");
assert.match(migration, /no_secrets/, "tool must remain no-secrets tagged");
assert.doesNotMatch(migration, /\bauth_email_outbox\b/i, "policy tag migration must not mutate outbox rows");
assert.doesNotMatch(migration, /\bDELETE\b|\bDROP\b|\bTRUNCATE\b/i, "migration must not be destructive");

console.log("auth email outbox skip policy tag test passed");
