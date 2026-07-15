import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCapabilityEnvelopeTemplatePassthrough,
  computeCapabilityEnvelopeTemplateResolutionHash,
  createCapabilityEnvelopeFromTemplate,
  normalizeCapabilityEnvelopeTemplateContext,
  resolveCapabilityEnvelopeTemplate,
} from "./capabilityEnvelopeTemplateResolver.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templateRow = {
  template_id: "11111111-1111-4111-8111-111111111111",
  template_key: "github_repo_patch_apply_v1",
  template_version: 1,
  display_name: "GitHub Repository Patch Apply",
  description: "Test template",
  app_key: "github",
  capability_key: "repo_patch_apply",
  operation_intent: "repo_patch_apply",
  runtime_surface: "repo_patch_batch_apply",
  requested_source_tier: "platform_managed_fallback",
  required_context_json: JSON.stringify(["tenant_id", "user_id", "workspace_id"]),
  allowed_context_json: JSON.stringify(["tenant_id", "user_id", "workspace_id", "expected_commit_sha", "resource_uri"]),
  defaults_json: JSON.stringify({ ttl_minutes: 90, context: {} }),
  max_ttl_minutes: 180,
  template_hash: "a".repeat(64),
  status: "active",
};
const template = {
  template_id: templateRow.template_id,
  template_key: templateRow.template_key,
  template_version: 1,
  app_key: templateRow.app_key,
  capability_key: templateRow.capability_key,
  operation_intent: templateRow.operation_intent,
  runtime_surface: templateRow.runtime_surface,
  requested_source_tier: templateRow.requested_source_tier,
  required_context: ["tenant_id", "user_id", "workspace_id"],
  allowed_context: ["tenant_id", "user_id", "workspace_id", "expected_commit_sha", "resource_uri"],
  defaults: { ttl_minutes: 90, context: {} },
  max_ttl_minutes: 180,
  template_hash: templateRow.template_hash,
};
const context = normalizeCapabilityEnvelopeTemplateContext(template, {
  tenant_id: "tenant-1",
  user_id: "user-1",
  workspace_id: "workspace-1",
  expected_commit_sha: "b".repeat(40),
});
assert.equal(context.workspace_id, "workspace-1");
assert.throws(
  () => normalizeCapabilityEnvelopeTemplateContext(template, { ...context, password: "forbidden" }),
  (error) => error.code === "capability_envelope_template_unknown_context",
);
assert.throws(
  () => normalizeCapabilityEnvelopeTemplateContext(template, { tenant_id: "tenant-1" }),
  (error) => error.code === "capability_envelope_template_context_missing",
);
const passthrough = buildCapabilityEnvelopeTemplatePassthrough(template, context);
assert.deepEqual(passthrough.slice(-8), [
  "--capability-key", "repo_patch_apply",
  "--operation-intent", "repo_patch_apply",
  "--runtime-surface", "repo_patch_batch_apply",
  "--requested-source-tier", "platform_managed_fallback",
]);
const dryRun = {
  decision: "ready_requires_approval",
  blocking_gaps: [],
  selected_source: { selected_source_tier: "platform_managed_fallback" },
};
const hashA = computeCapabilityEnvelopeTemplateResolutionHash({ template, context, ttlMinutes: 90, dryRun });
const hashB = computeCapabilityEnvelopeTemplateResolutionHash({ template, context: { ...context }, ttlMinutes: 90, dryRun });
assert.equal(hashA, hashB);
assert.match(hashA, /^[0-9a-f]{64}$/);

const readbackRow = {
  resolution_id: "22222222-2222-4222-8222-222222222222",
  template_key: template.template_key,
  template_version: 1,
  template_hash: template.template_hash,
  resolution_hash: hashA,
  envelope_id: "33333333-3333-4333-8333-333333333333",
  resolution_status: "created",
  requested_by: "gpt_admin",
  envelope_status: "ready_requires_approval",
  decision: "ready_requires_approval",
  dispatch_allowed: 1,
  apply_allowed: 0,
  approval_required: 1,
  blocking_gap_count: 0,
};
const queries = [];
const pool = {
  async query(sql, params = []) {
    queries.push({ sql: String(sql), params });
    if (String(sql).includes("FROM capability_envelope_templates")) return [[templateRow]];
    if (String(sql).startsWith("INSERT INTO capability_envelope_template_resolutions")) return [{ affectedRows: 1 }];
    if (String(sql).includes("FROM capability_envelope_template_resolutions r")) return [[readbackRow]];
    throw new Error(`Unexpected SQL: ${String(sql).slice(0, 120)}`);
  },
};
const runDryRun = async (input) => ({
  ok: true,
  request_context: { tenant_id: input.tenantId, user_id: input.userId, workspace_id: input.workspaceId },
  capability: { app_key: input.appKey, capability_key: input.capabilityKey },
  selected_source: { selected_source_tier: "platform_managed_fallback" },
  authority: { status: "passed" },
  gates: { dispatch_allowed: true, approval_required: true },
  blocking_gaps: [],
  decision: "ready_requires_approval",
  secrets_included: false,
});
const preview = await resolveCapabilityEnvelopeTemplate({
  template_key: template.template_key,
  context,
  expected_template_hash: template.template_hash,
}, { pool, runCapabilityResolutionDryRun: runDryRun });
assert.equal(preview.create_allowed, true);
assert.equal(preview.mode, "preview");
assert.equal(preview.secrets_included, false);
const created = await createCapabilityEnvelopeFromTemplate({
  template_key: template.template_key,
  context,
  requested_by: "gpt_admin",
}, {
  pool,
  runCapabilityResolutionDryRun: runDryRun,
  createCapabilityResolutionEnvelopeLedger: async () => ({
    ok: true,
    envelope_id: readbackRow.envelope_id,
    envelope_status: "ready_requires_approval",
    decision: "ready_requires_approval",
    secrets_included: false,
  }),
});
assert.equal(created.mode, "created");
assert.equal(created.resolution.envelope_id, readbackRow.envelope_id);
assert.ok(queries.some(({ sql }) => sql.startsWith("INSERT INTO capability_envelope_template_resolutions")));

const migration = fs.readFileSync(path.join(__dirname, "migrations", "20260715_capability_envelope_template_resolver.sql"), "utf8");
assert.match(migration, /CREATE TABLE IF NOT EXISTS capability_envelope_templates/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS capability_envelope_template_resolutions/);
for (const key of ["capability_envelope_template_list", "capability_envelope_template_get", "capability_envelope_template_resolve", "capability_envelope_template_create"]) assert.match(migration, new RegExp(key));
assert.match(migration, /capability_envelope_template_resolver_policy_v1/);
assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE)\b/i);
const openapi = fs.readFileSync(path.join(__dirname, "openapi", "capability-envelope-templates.yaml"), "utf8");
assert.match(openapi, /openapi: 3\.1\.0/);
assert.match(openapi, /operationId: resolveCapabilityEnvelopeTemplate/);
assert.match(openapi, /operationId: createCapabilityEnvelopeFromTemplate/);
console.log("capability envelope template resolver tests passed");
