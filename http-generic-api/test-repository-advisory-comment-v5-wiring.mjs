import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/1001_sprint68_repository_advisory_comment_v5_tenant_tool_wiring.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

const expectedTools = [
  "tenant_repository_advisory_comment_preview",
  "tenant_repository_advisory_comment_apply",
  "tenant_repository_advisory_comment_readback",
  "tenant_repository_advisory_comment_v5_readiness_smoke",
];

for (const key of expectedTools) {
  assert.ok(migration.includes(key), `migration contains ${key}`);
}

for (const requiredSnippet of [
  "tenant_repository_advisory_comment_v5_tool_wiring_policy_v1",
  "repository_mutations_allowed_by_default",
  "provider_calls_allowed",
  "credential_payload_returned",
  "external_writes_allowed",
  "apply_requires_future_explicit_authorization",
  "no_provider_call",
  "no_external_write",
  "no_repository_mutation",
  "no_secrets",
]) {
  assert.ok(migration.includes(requiredSnippet), `migration contains ${requiredSnippet}`);
}

assert.ok(runner.includes("1001_sprint68_repository_advisory_comment_v5_tenant_tool_wiring.sql"), "runner allows migration 1001");

console.log(JSON.stringify({ ok: true, test: "repository_advisory_comment_v5_wiring_static" }));
