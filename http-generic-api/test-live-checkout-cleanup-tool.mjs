import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync(new URL("./scripts/live-checkout-cleanup.mjs", import.meta.url), "utf8");
const adminCli = readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/240_sprint68_live_checkout_cleanup_tool.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(script, /ALLOWED_CLEANUP_PATHS/);
assert.match(script, /http-generic-api\/test-tenant-gpt-customer-safe-resource-escalation\.mjs/);
assert.match(script, /ALLOWED_ROOT_LOGS/);
assert.match(script, /console\.log/);
assert.match(script, /stderr\.log/);
assert.match(script, /APPLY_LIVE_CHECKOUT_CLEANUP/);
assert.match(script, /git\(\["show", `HEAD:\$\{repoPath\}`\]\)/);
assert.match(script, /update-index/);
assert.match(script, /git_checkout_head_after_refresh_warning/);
assert.match(script, /checkout/);
assert.match(script, /"HEAD"/);
assert.match(script, /blocked_content_diff/);
assert.match(script, /normalized_lf_equal/);
assert.match(script, /metadataDiagnostics/);
assert.match(script, /ls-files/);
assert.match(script, /--eol/);
assert.match(script, /--numstat/);
assert.match(script, /--summary/);
assert.match(script, /diff_cached_numstat/);
assert.match(script, /secrets_included: false/);
assert.doesNotMatch(script, /process\.env\[[^\]]*(TOKEN|SECRET|KEY|PASSWORD)/i);
assert.doesNotMatch(script, /fetch\(|axios|decryptCredentials|private_key|client_secret|refresh_token/i);

assert.match(adminCli, /live_checkout_cleanup/);
assert.match(adminCli, /scripts\/live-checkout-cleanup\.mjs/);
assert.match(migration, /live_checkout_cleanup/);
assert.match(migration, /APPLY_LIVE_CHECKOUT_CLEANUP/);
assert.match(migration, /no_secrets/);
assert.match(migration, /allowlisted_paths/);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);
assert.match(runner, /240_sprint68_live_checkout_cleanup_tool\.sql/);

console.log("live checkout cleanup guard passed");
