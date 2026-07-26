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
const templateHash = "a".repeat(64);
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
  allowed_context_json: JSON.stringify([
    "tenant_id",
    "user_id",
    "workspace_id",
    "expected_commit_sha",
    "resource_uri",
    "binding_sha256",
    "capability_sha256",
  ]),
  defaults_json: JSON.stringify({ ttl_minutes: 90, context: {} }),
  max_ttl_minutes: 180,
  template_hash: templateHash,
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
  allowed_context: [
    "tenant_id",
    "user_id",
    "workspace_id",
    "expected_commit_sha",
    "resource_uri",
    "binding_sha256",
    "capability_sha256",
  ],
  defaults: { ttl_minutes: 90, context: {} },
  max_ttl_minutes: 180,
  template_hash: templateHash,
};

const context = normalizeCapabilityEnvelopeTemplateContext(template, {
  tenant_id: "tenant-1",
  user_id: "user-1",
  workspace_id: "workspace-1",
  expected_commit_sha: "b".repeat(40),
  resource_uri: "repo://mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
  binding_sha256: "c".repeat(64),
  capability_sha256: "d".repeat(64),
});
assert.equal(context.workspace_id, "workspace-1");
assert.equal(context.binding_sha256, "c".repeat(64));
assert.equal(context.capability_sha256, "d".repeat(64));
assert.throws(
  () => normalizeCapabilityEnvelopeTemplateContext(template, { ...context, password: "forbidden" }),
  (error) => error.code === "capability_envelope_template_unknown_context" && error.status === 400,
);
assert.throws(
  () => normalizeCapabilityEnvelopeTemplateContext(template, { tenant_id: "tenant-1" }),
  (error) => error.code === "capability_envelope_template_context_missing" && error.status === 400,
);
assert.throws(
  () => normalizeCapabilityEnvelopeTemplateContext(template, {
    tenant_id: "tenant-1",
    user_id: "user-1",
    workspace_id: "workspace-1",
    expected_commit_sha: "not-a-sha",
  }),
  (error) => error.code === "capability_envelope_template_commit_invalid" && error.status === 400,
);
assert.throws(
  () => normalizeCapabilityEnvelopeTemplateContext(template, { ...context, binding_sha256: "not-a-sha256" }),
  (error) => error.code === "capability_envelope_template_binding_sha256_invalid" && error.status === 400,
);
assert.throws(
  () => normalizeCapabilityEnvelopeTemplateContext(template, { ...context, capability_sha256: "not-a-sha256" }),
  (error) => error.code === "capability_envelope_template_capability_sha256_invalid" && error.status === 400,
);

const passthrough = buildCapabilityEnvelopeTemplatePassthrough(template, context);
assert.ok(passthrough.includes("--tenant-id"));
assert.ok(passthrough.includes("--binding-sha256"));
assert.ok(passthrough.includes("--capability-sha256"));
assert.ok(passthrough.includes("--requested-source-tier"));
assert.deepEqual(passthrough.slice(-8), [
  "--capability-key", "repo_patch_apply",
  "--operation-intent", "repo_patch_apply",
  "--runtime-surface", "repo_patch_batch_apply",
  "--requested-source-tier", "platform_managed_fallback",
]);

const alignedDryRun = {
  ok: true,
  selected_source: { selected_source_tier: "platform_managed_fallback" },
  authority: { status: "passed" },
  gates: { dispatch_allowed: true, approval_required: true },
  blocking_gaps: [],
  decision: "ready_requires_approval",
  secrets_included: false,
};
const hashA = computeCapabilityEnvelopeTemplateResolutionHash({
  template,
  context,
  ttlMinutes: 90,
  dryRun: alignedDryRun,
});
const hashB = computeCapabilityEnvelopeTemplateResolutionHash({
  template,
  context: { ...context },
  ttlMinutes: 90,
  dryRun: alignedDryRun,
});
assert.equal(hashA, hashB);
assert.match(hashA, /^[0-9a-f]{64}$/);

let storedResolution = null;
let createCalls = 0;
const queries = [];
const pool = {
  async query(sql, params = []) {
    const normalizedSql = String(sql);
    queries.push({ sql: normalizedSql, params });
    if (normalizedSql.includes("FROM capability_envelope_templates")) return [[templateRow]];
    if (normalizedSql.includes("FROM capability_envelope_template_resolutions r")) {
      return [storedResolution ? [storedResolution] : []];
    }
    if (normalizedSql.startsWith("INSERT INTO capability_envelope_template_resolutions")) {
      storedResolution = {
        resolution_id: params[0],
        template_key: params[2],
        template_version: params[3],
        template_hash: params[4],
        resolution_hash: params[5],
        envelope_id: params[9],
        resolution_status: "created",
        requested_by: params[10],
        created_at: "2026-07-15T00:00:00.000Z",
        envelope_status: "ready_requires_approval",
        decision: "ready_requires_approval",
        dispatch_allowed: 1,
        apply_allowed: 0,
        approval_required: 1,
        blocking_gap_count: 0,
        expires_at: "2026-07-15T01:30:00.000Z",
      };
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL: ${normalizedSql.slice(0, 160)}`);
  },
};

const runAlignedDryRun = async (input) => ({
  ...alignedDryRun,
  request_context: {
    tenant_id: input.tenantId,
    user_id: input.userId,
    workspace_id: input.workspaceId,
  },
  capability: { app_key: input.appKey, capability_key: input.capabilityKey },
});

const preview = await resolveCapabilityEnvelopeTemplate({
  template_key: template.template_key,
  context,
  expected_template_hash: templateHash,
}, { pool, runCapabilityResolutionDryRun: runAlignedDryRun });
assert.equal(preview.create_allowed, true);
assert.equal(preview.source_tier_alignment, true);
assert.equal(preview.mode, "preview");
assert.equal(preview.secrets_included, false);
assert.equal(Object.prototype.propertyIsEnumerable.call(preview, "_passthrough"), false);
assert.doesNotMatch(JSON.stringify(preview), /_passthrough/);
assert.ok(preview.passthrough_argument_names.every((item) => item.startsWith("--")));

await assert.rejects(
  () => resolveCapabilityEnvelopeTemplate({
    template_key: template.template_key,
    context,
    expected_template_hash: "c".repeat(64),
  }, { pool, runCapabilityResolutionDryRun: runAlignedDryRun }),
  (error) => error.code === "capability_envelope_template_hash_mismatch" && error.status === 409,
);

const sourceMismatch = await resolveCapabilityEnvelopeTemplate({
  template_key: template.template_key,
  context,
}, {
  pool,
  runCapabilityResolutionDryRun: async (input) => ({
    ...(await runAlignedDryRun(input)),
    selected_source: { selected_source_tier: "tenant_managed" },
  }),
});
assert.equal(sourceMismatch.source_tier_alignment, false);
assert.equal(sourceMismatch.create_allowed, false);

const createEnvelope = async () => {
  createCalls += 1;
  return {
    ok: true,
    envelope_id: "33333333-3333-4333-8333-333333333333",
    envelope_status: "ready_requires_approval",
    decision: "ready_requires_approval",
    dispatch_allowed: true,
    apply_allowed: false,
    approval_required: true,
    blocking_gap_count: 0,
    secrets_included: false,
  };
};

const created = await createCapabilityEnvelopeFromTemplate({
  template_key: template.template_key,
  context,
  requested_by: "gpt_admin",
}, {
  pool,
  runCapabilityResolutionDryRun: runAlignedDryRun,
  createCapabilityResolutionEnvelopeLedger: createEnvelope,
});
assert.equal(created.mode, "created");
assert.equal(created.deduplicated, false);
assert.equal(created.resolution.envelope_id, "33333333-3333-4333-8333-333333333333");
assert.equal(createCalls, 1);
assert.ok(queries.some(({ sql }) => sql.startsWith("INSERT INTO capability_envelope_template_resolutions")));

const retry = await createCapabilityEnvelopeFromTemplate({
  template_key: template.template_key,
  context,
  requested_by: "gpt_admin",
}, {
  pool,
  runCapabilityResolutionDryRun: runAlignedDryRun,
  createCapabilityResolutionEnvelopeLedger: createEnvelope,
});
assert.equal(retry.deduplicated, true);
assert.equal(retry.resolution.envelope_id, created.resolution.envelope_id);
assert.equal(createCalls, 1, "deduplicated retry must not create a second envelope");

const migration = fs.readFileSync(
  path.join(__dirname, "migrations", "20260715_capability_envelope_template_resolver.sql"),
  "utf8",
);
assert.match(migration, /CREATE TABLE IF NOT EXISTS capability_envelope_templates/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS capability_envelope_template_resolutions/);
for (const key of [
  "capability_envelope_template_list",
  "capability_envelope_template_get",
  "capability_envelope_template_resolve",
  "capability_envelope_template_create",
]) assert.match(migration, new RegExp(key));
assert.match(migration, /capability_envelope_template_resolver_policy_v1/);
assert.match(migration, /required:tenant_id,user_id,workspace_id/);
assert.match(migration, /allowed:tenant_id,user_id,workspace_id/);
assert.match(migration, /default_ttl:/);
assert.match(migration, /max_ttl:/);
assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE)\b/i);

const openapi = fs.readFileSync(
  path.join(__dirname, "openapi", "capability-envelope-templates.yaml"),
  "utf8",
);
assert.match(openapi, /openapi: 3\.1\.0/);
assert.match(openapi, /operationId: resolveCapabilityEnvelopeTemplate/);
assert.match(openapi, /operationId: createCapabilityEnvelopeFromTemplate/);
assert.match(openapi, /expected_template_hash/);

const routesIndex = fs.readFileSync(path.join(__dirname, "routes", "index.js"), "utf8");
assert.match(routesIndex, /buildCapabilityEnvelopeTemplateRoutes/);
assert.match(routesIndex, /app\.use\(buildCapabilityEnvelopeTemplateRoutes/);
const testManifest = fs.readFileSync(path.join(__dirname, "scripts", "test-manifest.mjs"), "utf8");
assert.match(testManifest, /test-capability-envelope-template-resolver\.mjs/);

console.log("capability envelope template resolver tests passed");
