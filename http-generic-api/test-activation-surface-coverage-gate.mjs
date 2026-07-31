import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync(new URL("./scripts/activation-surface-coverage-check.mjs", import.meta.url), "utf8");
const manifest = readFileSync(new URL("./scripts/test-manifest.mjs", import.meta.url), "utf8");
const exclusionsReadme = readFileSync(new URL("./activation-surfaces/exclusions/README.md", import.meta.url), "utf8");
const invalidationExclusion = JSON.parse(
  readFileSync(
    new URL("./activation-surfaces/exclusions/growth_control_invalidation_revisions.json", import.meta.url),
    "utf8",
  ),
);
const invalidationMigration = readFileSync(
  new URL("./migrations/20260731_growth_control_typed_invalidation_consumer.sql", import.meta.url),
  "utf8",
);

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

assert.match(invalidationMigration, /CREATE TABLE IF NOT EXISTS `growth_control_invalidation_revisions`/);
assert.equal(invalidationExclusion.surface_key, "growth_control_invalidation_revisions");
assert.equal(invalidationExclusion.source_table, "growth_control_invalidation_revisions");
assert.equal(invalidationExclusion.owner, "platform-governance");
assert.match(invalidationExclusion.reason, /internal revision and cache-invalidation ledger/i);
assert.match(invalidationExclusion.reason, /does not grant authority/i);
assert.match(invalidationExclusion.review_after, /^\d{4}-\d{2}-\d{2}$/);
assert.doesNotMatch(JSON.stringify(invalidationExclusion), /(secret|credential|token|password|private_key)/i);

console.log("Activation surface coverage gate guard passed");
