import assert from "node:assert/strict";
import fs from "node:fs";

const { tenantEffectiveCapabilityReadinessSmoke } = await import(
  "./tenantEffectiveCapabilityResolver.js"
);

const migration = fs.readFileSync(
  new URL("./migrations/311_sprint69_semantic_capability_effective_resolution.sql", import.meta.url),
  "utf8"
);
const resolver = fs.readFileSync(
  new URL("./tenantEffectiveCapabilityResolver.js", import.meta.url),
  "utf8"
);
const systemLayer = fs.readFileSync(
  new URL("./routes/systemLayerRoutes.js", import.meta.url),
  "utf8"
);
const governedMigrationRunner = fs.readFileSync(
  new URL("./scripts/governed-migration-runner.mjs", import.meta.url),
  "utf8"
);
const docs = fs.readFileSync(
  new URL("../docs/semantic-capability-effective-resolution.md", import.meta.url),
  "utf8"
);
const activationAccessMap = fs.readFileSync(
  new URL("../docs/work-maps/activation-access-map.md", import.meta.url),
  "utf8"
);
const dataModelDomainMap = fs.readFileSync(
  new URL("../docs/work-maps/data-model-domain-map.md", import.meta.url),
  "utf8"
);

for (const tableName of [
  "platform_semantic_capabilities",
  "platform_capability_provider_bindings",
  "platform_endpoint_aliases",
  "tenant_capability_shadow_decisions",
]) {
  assert(
    migration.includes(`CREATE TABLE IF NOT EXISTS \`${tableName}\``),
    `${tableName} must be created additively`
  );
  assert(docs.includes(`\`${tableName}\``), `${tableName} must be documented`);
}

for (const surfaceName of [
  "platform_capability_provider_bindings",
  "tenant_capability_shadow_decisions",
]) {
  assert(
    activationAccessMap.includes(`\`${surfaceName}\``),
    `activation access map must include ${surfaceName}`
  );
}
assert(
  activationAccessMap.includes("admin + tenant"),
  "tenant shadow decision surface must retain tenant visibility in generated activation docs"
);
for (const modelName of [
  "platform_semantic_capabilities",
  "platform_capability_provider_bindings",
  "platform_endpoint_aliases",
  "tenant_capability_shadow_decisions",
  "v_tenant_effective_capability_candidates",
]) {
  assert(
    dataModelDomainMap.includes(`\`${modelName}\``),
    `data model domain map must include ${modelName}`
  );
}

for (const viewName of [
  "v_platform_endpoint_canonical_identity",
  "v_platform_capability_export_projection",
  "v_platform_capability_export_reconciliation",
  "v_tenant_effective_capability_candidates",
]) {
  assert(
    migration.includes(`CREATE OR REPLACE VIEW \`${viewName}\``),
    `${viewName} must be created`
  );
  assert(docs.includes(`\`${viewName}\``), `${viewName} must be documented`);
}

for (const capabilityKey of [
  "content.article.create_draft",
  "content.article.publish",
  "files.object.read",
  "email.message.send",
  "repository.read",
  "workflow.run",
  "hosting.release.deploy",
  "analytics.read",
]) {
  assert(migration.includes(`'${capabilityKey}'`), `${capabilityKey} must be registered`);
}

for (const expected of [
  "semantic-wordpress-create-draft-v1",
  "wordpress_rest",
  "wordpress_api",
  "wordpress_create_post",
  "wordpress_draft_only_v1",
  "wordpress_article_draft_adapter_v1",
]) {
  assert(migration.includes(expected), `WordPress shadow pilot must include ${expected}`);
}
assert.match(
  migration,
  /'semantic-wordpress-create-draft-v1'[\s\S]*?'shadow'/,
  "the initial WordPress capability binding must remain shadow-only"
);
assert.match(migration, /'status'\s*,\s*'draft'/, "draft capability must force status=draft");
assert(migration.includes("postWpV2Posts"), "imported WordPress endpoint key must be aliased");
assert(migration.includes("wordpressCreatePost"), "historical WordPress operationId must be aliased");

for (const sourceTable of [
  "workspace_registry",
  "memberships",
  "workspace_app_links",
  "user_app_connections",
  "app_action_grants",
  "workspace_resource_grants",
  "endpoints",
  "platform_endpoint_aliases",
  "runtime_dispatch_certification_registry",
  "platform_endpoint_tool_exports",
]) {
  assert(resolver.includes(sourceTable), `resolver must read ${sourceTable}`);
}

for (const score of [1000, 900, 800, 600, 500]) {
  assert(resolver.includes(String(score)), `connection selection score ${score} must be explicit`);
}
for (const status of [
  "workspace_not_registered",
  "workspace_not_ready",
  "workspace_membership_required",
  "capability_not_registered",
  "capability_binding_missing",
  "connection_not_found",
  "ambiguous_connection",
  "connection_not_validated",
  "capability_not_granted",
  "resource_authority_missing",
  "canonical_endpoint_unavailable",
  "ambiguous_canonical_endpoint",
  "runtime_certification_missing",
  "capability_export_missing",
  "shadow_ready",
  "canary_ready",
  "ready",
]) {
  assert(resolver.includes(`"${status}"`), `resolver must expose status ${status}`);
  assert(docs.includes(`\`${status}\``), `status ${status} must be documented`);
}

for (const toolName of [
  "tenant_effective_capability_preview",
  "tenant_effective_capability_readiness_smoke",
  "tenant_capability_shadow_compare",
]) {
  assert(resolver.includes(`name: "${toolName}"`), `${toolName} descriptor must exist`);
  assert(systemLayer.includes("TENANT_EFFECTIVE_CAPABILITY_SYSTEM_TOOLS"), "system layer must import capability descriptors");
}

assert(
  systemLayer.includes('source_key: "tenant_effective_capability_resolver_v1"'),
  "system layer must register the direct resolver descriptor source"
);
assert.equal(
  systemLayer.split('source_key: "tenant_effective_capability_resolver_v1"').length - 1,
  1,
  "semantic capability descriptor source must be registered exactly once"
);
assert(systemLayer.includes("tenantEffectiveCapabilityPreview"), "preview handler must be wired");
assert(
  systemLayer.includes("tenantEffectiveCapabilityReadinessSmoke"),
  "readiness handler must be wired"
);
assert(systemLayer.includes("tenantCapabilityShadowCompare"), "shadow handler must be wired");
assert(
  systemLayer.includes('readiness_tool: "tenant_effective_capability_readiness_smoke"'),
  "semantic capability descriptor source must declare its readiness tool"
);
assert(
  systemLayer.includes("...TENANT_EFFECTIVE_CAPABILITY_SYSTEM_TOOLS"),
  "capability descriptors must appear in the system-layer tool catalog"
);

assert(!resolver.includes("/system/tools/call"), "resolver must not recursively dispatch through /system/tools/call");
assert(!resolver.includes("/gpt/tools/call"), "resolver must not recursively dispatch through /gpt/tools/call");
assert(!resolver.includes("encrypted_credentials"), "resolver must not select encrypted credentials");
assert(!resolver.includes("access_token"), "resolver must not select access tokens");
assert(!resolver.includes("refresh_token"), "resolver must not select refresh tokens");
assert(!resolver.includes("private_key"), "resolver must not select private keys");

assert(
  resolver.includes("admin_override_used"),
  "resolver output must disclose admin diagnostic overrides"
);
assert(
  resolver.includes("auth?.tenant_id") && resolver.includes("auth?.user_id"),
  "tenant principal identity must be derived from authenticated context"
);
assert(
  resolver.includes("connectionResult?.ambiguous"),
  "equal top-score connection candidates must block execution"
);
assert(
  resolver.includes("active_candidate_count > 1"),
  "multiple active canonical endpoint rows must block execution"
);
assert(
  resolver.includes("manifest_hash") && resolver.includes("sha256"),
  "derived projections must carry a deterministic manifest hash"
);
assert(
  resolver.includes("tenant_capability_shadow_decisions"),
  "shadow comparison must write the no-secret decision ledger"
);
assert(
  resolver.includes("secrets_included: false"),
  "resolver responses must explicitly state that secrets are not included"
);

const expectedSchemaObjects = [
  ["platform_semantic_capabilities", "BASE TABLE"],
  ["platform_capability_provider_bindings", "BASE TABLE"],
  ["platform_endpoint_aliases", "BASE TABLE"],
  ["tenant_capability_shadow_decisions", "BASE TABLE"],
  ["v_platform_endpoint_canonical_identity", "VIEW"],
  ["v_platform_capability_export_projection", "VIEW"],
  ["v_platform_capability_export_reconciliation", "VIEW"],
  ["v_tenant_effective_capability_candidates", "VIEW"],
];

{
  const queries = [];
  const pool = {
    async query(sql) {
      queries.push(String(sql));
      if (String(sql).includes("information_schema.tables")) {
        return [
          expectedSchemaObjects.map(([table_name, table_type]) => ({
            table_name,
            table_type,
          })),
        ];
      }
      if (String(sql).includes("platform_semantic_capabilities")) return [[{ c: 8 }]];
      if (
        String(sql).includes("platform_capability_provider_bindings")
        && String(sql).includes("rollout_mode = 'shadow'")
      ) return [[{ c: 1 }]];
      if (String(sql).includes("platform_capability_provider_bindings")) return [[{ c: 1 }]];
      if (String(sql).includes("platform_endpoint_aliases")) return [[{ c: 2 }]];
      throw new Error(`Unexpected readiness query: ${sql}`);
    },
  };
  const result = await tenantEffectiveCapabilityReadinessSmoke({}, { pool });
  assert.equal(result.ok, true);
  assert.equal(result.status, "pass");
  assert.equal(result.schema_objects.present.length, 8);
  assert.equal(result.provider_calls_made, 0);
  assert.equal(result.mutations_executed, false);
  assert.equal(result.secrets_included, false);
  assert.equal(
    queries.some((sql) => /^\s*(INSERT|UPDATE|DELETE|REPLACE|ALTER|CREATE|DROP)\b/i.test(sql)),
    false,
    "readiness smoke must remain read-only"
  );
}

{
  const pool = {
    async query(sql) {
      if (String(sql).includes("information_schema.tables")) {
        return [
          expectedSchemaObjects.slice(0, 7).map(([table_name, table_type]) => ({
            table_name,
            table_type,
          })),
        ];
      }
      throw new Error(`Seed queries must not run while schema is incomplete: ${sql}`);
    },
  };
  const result = await tenantEffectiveCapabilityReadinessSmoke({}, { pool });
  assert.equal(result.ok, false);
  assert.equal(result.status, "fail");
  assert.equal(result.reason_code, "semantic_capability_schema_not_applied");
  assert.deepEqual(result.schema_objects.missing, [
    "v_tenant_effective_capability_candidates",
  ]);
  assert.equal(result.provider_calls_made, 0);
  assert.equal(result.mutations_executed, false);
  assert.equal(result.secrets_included, false);
}

for (const destructiveSql of [
  /^\s*DROP\s+TABLE\b/mi,
  /^\s*TRUNCATE\s+TABLE\b/mi,
  /^\s*DELETE\s+FROM\b/mi,
]) {
  assert(!destructiveSql.test(migration), `migration must not contain destructive SQL ${destructiveSql}`);
}
assert(
  !/INSERT\s+INTO\s+`?platform_endpoint_tool_exports`?/i.test(migration),
  "shadow foundation must not create endpoint tool exports"
);
assert(
  !/UPDATE\s+`?platform_endpoint_tool_exports`?/i.test(migration),
  "shadow foundation must not activate or mutate endpoint tool exports"
);
assert(
  !/INSERT\s+INTO\s+`?tenant_platform_endpoint_tools`?/i.test(migration),
  "shadow foundation must not create manual tenant tools"
);
assert(
  !/UPDATE\s+`?tenant_platform_endpoint_tools`?/i.test(migration),
  "shadow foundation must not change current tenant tool exposure"
);
assert(
  !migration.includes("governed_migration_authorization_registry"),
  "semantic capability migration must not self-authorize"
);
assert(
  !governedMigrationRunner.includes("311_sprint69_semantic_capability_effective_resolution.sql"),
  "semantic capability migration must not use the legacy bootstrap allowlist"
);

for (const phrase of [
  "Shadow foundation",
  "No provider mutation is enabled",
  "does not create an active tenant export",
  "direct system-layer descriptor tools",
  "avoiding recursive dispatch",
  "A shadow binding must not produce an active export",
  "separately approved operational change",
  "APPLY_311_SPRINT69_SEMANTIC_CAPABILITY_EFFECTIVE_RESOLUTION",
  "must not be added to the legacy bootstrap allowlist",
]) {
  assert(docs.includes(phrase), `documentation must state: ${phrase}`);
}

console.log("semantic capability effective resolution contract tests passed");
