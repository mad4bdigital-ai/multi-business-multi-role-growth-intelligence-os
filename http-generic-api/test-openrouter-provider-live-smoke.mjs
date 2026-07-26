import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync(new URL("./scripts/openrouter-provider-smoke.mjs", import.meta.url), "utf8");
const adminCli = readFileSync(new URL("./routes/adminCliRoutes.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/216_sprint67_openrouter_provider_smoke_tool.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(script, /platform_secrets/);
assert.match(script, /openrouter_api_key/);
assert.match(script, /decryptToken/);
assert.match(script, /buildCallModel/);
assert.match(script, /provider: "openrouter"/);
assert.match(script, /max_tokens/);
assert.match(script, /PROMOTE_OPENROUTER_PROVIDER_ACTIVE_AFTER_LIVE_SMOKE/);
assert.match(script, /AbortSignal\.timeout\(timeoutMs\)/);
assert.match(script, /--timeout-ms/);
assert.match(script, /openrouter_live_smoke_timeout/);
assert.match(script, /getPool\(\)\.end\(\)\.catch/);
assert.match(script, /secrets_included: false/);
assert.match(script, /fileURLToPath\(import\.meta\.url\)/);
assert.match(script, /path\.resolve\(process\.argv\[1\]\)/);
assert.match(script, /secrets_returned_to_agent = 0/);
assert.doesNotMatch(script, /console\.log\(apiKey|process\.stdout.*apiKey/s);
assert.doesNotMatch(script, /OPENROUTER_API_KEY\s*[:=]\s*[A-Za-z0-9_\-]{8,}/i);
assert.doesNotMatch(script, /sk-or-v1-[A-Za-z0-9_\-]+/i);

assert.match(adminCli, /openrouter_provider_smoke/);
assert.match(adminCli, /scripts\/openrouter-provider-smoke\.mjs/);
assert.match(migration, /admin_platform_endpoint_tools/);
assert.match(migration, /openrouter_provider_smoke/);
assert.match(migration, /requires_confirmation_for_active/);
assert.match(migration, /no_secrets/);
assert.match(runner, /216_sprint67_openrouter_provider_smoke_tool\.sql/);

console.log("OpenRouter provider live smoke guard passed");
