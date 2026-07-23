import assert from "node:assert/strict";
import {
  __test__,
  loadAuthorizedRepositoryContext,
  repositoryRelatedContext,
  repositoryResourceRecords,
  resolveRepositoryCapabilityAuthority,
} from "./repositoryAuthorityContextResolver.js";

const authority = {
  binding_id: "binding-1",
  binding_key: "brand.github.primary.production",
  tenant_id: "tenant-1",
  workspace_id: "workspace-1",
  brand_target_key: "brand",
  app_key: "github",
  system_id: "system-1",
  installation_id: null,
  connection_id: "connection-1",
  provider_key: "github",
  repository_external_id: "123",
  repository_node_id: "NODE_123",
  canonical_owner: "owner",
  canonical_name: "repo",
  default_branch: "main",
  environment: "production",
  system_binding_mode: "shared_platform_adapter",
  lifecycle_status: "active",
  authority_version: 1,
  lock_version: 1,
  is_primary: 1,
  readiness_status: "ready",
  issue_code: null,
};
const aliasRows = [
  { alias_id: "alias-1", binding_id: "binding-1", alias_type: "node_id", alias_value: "NODE_123", normalized_alias: "node_123", lifecycle_status: "active" },
  { alias_id: "alias-2", binding_id: "binding-1", alias_type: "full_name", alias_value: "owner/repo", normalized_alias: "owner/repo", lifecycle_status: "active" },
];
const capability = {
  repository_binding_id: "binding-1",
  capability_binding_id: "capability-1",
  capability_binding_key: "brand.github.webhook.production",
  capability_key: "github_repository_main_moved_webhook_provision",
  operation_intent: "github_repository_main_moved_webhook_provision",
  business_activity_type_key: "software",
  adapter_key: "github_repository_webhook_v2",
  policy_key: "policy-v2",
  readback_contract_key: "readback-v2",
  credential_ref: "ref:secret:WEBHOOK_SECRET",
  effect_class: "external_write",
  configuration_json: '{"hook_name":"web"}',
  lifecycle_status: "active",
  capability_version: 1,
  lock_version: 1,
  is_primary: 1,
  readiness_status: "ready",
  issue_code: null,
};
const layers = [
  { layer_id: "layer-1", capability_binding_id: "capability-1", scope_type: "platform", scope_ref: "*", precedence: 100, configuration_json: '{"security":{"require_signed_ping":true},"events":["push"]}', lifecycle_status: "active", layer_version: 1, lock_version: 1 },
  { layer_id: "layer-2", capability_binding_id: "capability-1", scope_type: "brand", scope_ref: "brand", precedence: 400, configuration_json: '{"events":["push","workflow_run"]}', lifecycle_status: "active", layer_version: 1, lock_version: 1 },
  { layer_id: "layer-3", capability_binding_id: "capability-1", scope_type: "environment", scope_ref: "production", precedence: 700, configuration_json: '{"active":true}', lifecycle_status: "active", layer_version: 1, lock_version: 1 },
];

function poolFor({ authorityRows = [authority], aliases = aliasRows, capabilities = [capability], policyLayers = layers } = {}) {
  return {
    async query(sql, params) {
      if (sql.includes("v_repository_authority_binding_readiness") && sql.includes("LEFT JOIN brands")) return [authorityRows];
      if (sql.includes("repository_authority_aliases")) {
        const bindingId = params?.[0];
        return [aliases.filter((row) => !bindingId || row.binding_id === bindingId)];
      }
      if (sql.includes("v_repository_capability_binding_readiness")) {
        if (sql.includes("capability_key = ?")) return [capabilities.filter((row) => row.repository_binding_id === params[0] && row.capability_key === params[1])];
        return [capabilities];
      }
      if (sql.includes("repository_capability_policy_layers")) return [policyLayers];
      if (sql.includes("v_repository_authority_binding_readiness") && sql.includes("binding_key = ?")) return [authorityRows.filter((row) => row.binding_key === params[0])];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

{
  const context = await loadAuthorizedRepositoryContext({
    pool: poolFor(),
    scope: { admin: false, tenant_id: "tenant-1", user_id: "user-1" },
    membership: { role: "owner", status: "active" },
    resourceGrants: [],
  });
  assert.equal(context.repositories.length, 1);
  const repository = context.repositories[0];
  assert.equal(repository.full_name, "owner/repo");
  assert.equal(repository.resource_uri, "repository-binding://brand.github.primary.production");
  assert.match(repository.binding_sha256, /^[0-9a-f]{64}$/);
  assert.equal(repository.capabilities.length, 1);
  assert.deepEqual(repository.capabilities[0].configuration.events, ["push", "workflow_run"]);
  assert.equal(repository.capabilities[0].configuration.security.require_signed_ping, true);
  assert.equal(repository.capabilities[0].configuration.active, true);
  assert.equal(repository.capabilities[0].configuration_source_map.events, "brand:brand");
  assert.equal(repository.capabilities[0].configuration_source_map.active, "environment:production");
  assert.match(repository.capabilities[0].capability_sha256, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(repository).includes("WEBHOOK_SECRET"), false, "public context must not expose credential references");
}

{
  const context = await loadAuthorizedRepositoryContext({
    pool: poolFor(),
    scope: { admin: false, tenant_id: "tenant-1", user_id: "user-2" },
    membership: { role: "member", status: "active" },
    resourceGrants: [{ resource_type: "brand", resource_ref: "brand" }],
  });
  assert.equal(context.repositories[0].authorization_source, "inherited_brand_grant");
}

{
  const context = await loadAuthorizedRepositoryContext({
    pool: poolFor(),
    scope: { admin: false, tenant_id: "tenant-1", user_id: "user-2" },
    membership: { role: "member", status: "active" },
    resourceGrants: [{ resource_type: "repository", resource_ref: "NODE_123" }],
  });
  assert.equal(context.repositories[0].authorization_source, "direct_repository_grant");
}

{
  const context = await loadAuthorizedRepositoryContext({
    pool: poolFor(),
    scope: { admin: false, tenant_id: "other-tenant", user_id: "user-2" },
    membership: { role: "owner", status: "active" },
    resourceGrants: [],
  });
  assert.equal(context.repositories.length, 0, "tenant isolation must reject other tenant bindings");
}

{
  const records = repositoryResourceRecords({ repositories: [{
    binding_key: "brand.github.primary.production",
    binding_id: "binding-1",
    repository_node_id: "NODE_123",
    repository_external_id: "123",
    full_name: "owner/repo",
    canonical_owner: "owner",
    canonical_name: "repo",
    aliases: [{ alias_value: "legacy-owner/legacy-repo" }],
  }] });
  assert(records[0].references.includes("legacy-owner/legacy-repo"));
  const related = repositoryRelatedContext({ repositories: [{ ...records[0].row, capabilities: [] }] }, "legacy-owner/legacy-repo");
  assert.equal(related.status, "resolved");
}

{
  const internal = await resolveRepositoryCapabilityAuthority({
    bindingKey: "brand.github.primary.production",
    capabilityKey: "github_repository_main_moved_webhook_provision",
    pool: poolFor(),
  });
  assert.equal(internal.credential_ref, "ref:secret:WEBHOOK_SECRET");
  assert.equal(internal.configuration.active, true);
  assert.match(internal.binding_sha256, /^[0-9a-f]{64}$/);
  assert.match(internal.capability_sha256, /^[0-9a-f]{64}$/);

  await assert.rejects(
    resolveRepositoryCapabilityAuthority({
      bindingKey: "brand.github.primary.production",
      capabilityKey: "github_repository_main_moved_webhook_provision",
      expectedBindingSha256: "0".repeat(64),
      pool: poolFor(),
    }),
    (error) => error.code === "repository_authority_binding_drifted",
  );
}

{
  const base = __test__.resolveCapabilityConfiguration(capability, layers, authority);
  const changed = __test__.resolveCapabilityConfiguration(capability, [...layers, {
    layer_id: "layer-4", capability_binding_id: "capability-1", scope_type: "repository",
    scope_ref: "brand.github.primary.production", precedence: 600,
    configuration_json: '{"hook_name":"changed"}', lifecycle_status: "active", layer_version: 1, lock_version: 1,
  }], authority);
  assert.notDeepEqual(base.configuration, changed.configuration);
}

console.log("repository authority context resolver tests passed");
