import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/1001_sprint68_repository_advisory_comment_v5_tenant_tool_wiring.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");
const routes = readFileSync(new URL("./routes/systemLayerRoutes.js", import.meta.url), "utf8");

for (const key of [
  "tenant_repository_advisory_comment_preview",
  "tenant_repository_advisory_comment_apply",
  "tenant_repository_advisory_comment_readback",
  "tenant_repository_advisory_comment_v5_readiness_smoke",
]) {
  assert.match(migration, new RegExp(key));
  assert.match(routes, new RegExp(key));
}

for (const token of [
  "tenantRepositoryAdvisoryCommentV5ReadinessSmoke",
  "tenantRepositoryAdvisoryCommentPreview",
  "tenantRepositoryAdvisoryCommentApply",
  "tenantRepositoryAdvisoryCommentReadback",
  "repository_advisory_comment_preview_v5",
  "repository_advisory_comment_apply_v5",
  "repository_advisory_comment_readback_v5",
]) {
  assert.match(routes, new RegExp(token));
}

assert.match(migration, /repository_mutations_allowed_by_default', false/);
assert.match(migration, /provider_calls_allowed', false/);
assert.match(migration, /credential_payload_returned', false/);
assert.match(migration, /external_writes_allowed', false/);
assert.match(migration, /apply_requires_future_explicit_authorization', true/);
assert.match(runner, /1001_sprint68_repository_advisory_comment_v5_tenant_tool_wiring\.sql/);

console.log(JSON.stringify({ ok: true, test: "repository_advisory_comment_v5_wiring_static" }));
