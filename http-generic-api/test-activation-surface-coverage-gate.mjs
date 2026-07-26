import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync(new URL("./scripts/activation-surface-coverage-check.mjs", import.meta.url), "utf8");
const manifest = readFileSync(new URL("./scripts/test-manifest.mjs", import.meta.url), "utf8");
const exclusionsReadme = readFileSync(new URL("./activation-surfaces/exclusions/README.md", import.meta.url), "utf8");

assert.match(script, /activation-surfaces/);
assert.match(script, /exclusions/);
assert.match(script, /changedMigrationFiles/);
assert.match(script, /function extractCreateTables/);
assert.match(script, /missing_manifest_or_exclusion/);
assert.match(script, /Tenant-visible activation surface/);
assert.match(script, /SENSITIVE_PATTERN/);
assert.match(script, /credential_ref/);
assert.match(script, /config_json/);
assert.match(script, /external_provider_called: false/);
assert.match(script, /secrets_included: false/);
assert.doesNotMatch(script, /SELECT \*/i);
assert.doesNotMatch(script, /getPool\(|safeQuery|fetch\(|axios|http\.request|https\.request/);

assert.match(manifest, /node scripts\/activation-surface-coverage-check\.mjs --changed/);
assert.match(exclusionsReadme, /activation surface coverage exclusions/i);
assert.match(exclusionsReadme, /reason/);
assert.match(exclusionsReadme, /owner/);

console.log("Activation surface coverage gate guard passed");
