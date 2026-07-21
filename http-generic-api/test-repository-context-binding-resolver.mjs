import assert from "node:assert/strict";
import {
  __test__,
  repositoryContextBindingCatalog,
  repositoryContextBindingReadinessSmoke,
  resolveRepositoryContextBinding,
} from "./repositoryContextBindingResolver.js";

function readyRow(overrides = {}) {
  return {
    binding_id: "binding-id-1",
    binding_key: "growth_intelligence_platform.github.primary.production",
    tenant_id: "tenant-1",
    workspace_id: "workspace-1",
    brand_target_key: "growth_intelligence_platform",
    brand_name: "Growth Intelligence Platform",
    brand_status: "active",
    brand_core_ready: "Partial",
    app_key: "github",
    app_display_name: "GitHub",
    app_auth_type: "oauth2",
    app_status: "active",
    system_id: "system-1",
    system_key: "github-api",
    system_provider_family: "github_com_connector",
    system_connector_family: "github_com_connector",
    system_status: "active",
    installation_id: null,
    installation_status: null,
    connection_id: "connection-1",
    connection_status: "active",
    connection_validation_status: "promoted_to_platform_secrets",
    repository_provider: "github",
    repository_owner: "mad4bdigital-ai",
    repository_name: "multi-business-multi-role-growth-intelligence-os",
    repository_node_id: null,
    default_branch: "main",
    environment: "production",
    webhook_callback_url: "https://auth.mad4b.com/webhooks/github/repository-main-moved",
    webhook_events_json: '["push"]',
    webhook_secret_ref: "ref:secret:GITHUB_REPOSITORY_MAIN_MOVED_WEBHOOK_SECRET",
    is_primary: 1,
    status: "active",
    readiness_status: "ready",
    issue_code: null,
    brand_rows: 1,
    app_rows: 1,
    workspace_rows: 1,
    workspace_app_link_rows: 1,
    system_rows: 1,
    installation_rows: 1,
    connection_rows: 1,
    secret_reference_rows: 1,
    updated_at: "2026-07-21T00:00:00.000Z",
    ...overrides,
  };
}

function poolFor(rows) {
  return {
    async query(sql) {
      if (sql.includes("information_schema.tables")) return [[{ table_rows: 1, view_rows: 1 }]];
      if (sql.includes("SUM(CASE WHEN readiness_status")) return [[{ ready_bindings: rows.filter((row) => row.readiness_status === "ready").length, issue_bindings: rows.filter((row) => row.readiness_status !== "ready").length }]];
      return [rows];
    },
  };
}

{
  const binding = await resolveRepositoryContextBinding(
    { binding_key: "growth_intelligence_platform.github.primary.production" },
    { auth: { is_admin: true }, pool: poolFor([readyRow()]) },
  );
  assert.equal(binding.brand.target_key, "growth_intelligence_platform");
  assert.equal(binding.application.app_key, "github");
  assert.equal(binding.repository.full_name, "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os");
  assert.equal(binding.resource_uri, "repository-binding://growth_intelligence_platform.github.primary.production");
  assert.match(binding.binding_sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(binding.webhook.events, ["push"]);
  assert.equal(binding.secrets_included, false);
}

{
  const binding = await resolveRepositoryContextBinding(
    { brand_ref: "Growth Intelligence Platform", app_key: "github", repository_ref: "github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os" },
    { auth: { is_admin: true }, pool: poolFor([readyRow()]) },
  );
  assert.equal(binding.binding_key, "growth_intelligence_platform.github.primary.production");
}

{
  await assert.rejects(
    resolveRepositoryContextBinding(
      { app_key: "github" },
      { auth: { is_admin: true }, pool: poolFor([readyRow(), readyRow({ binding_id: "binding-id-2", binding_key: "other.binding" })]) },
    ),
    (error) => error.code === "repository_context_binding_ambiguous",
  );
}

{
  await assert.rejects(
    resolveRepositoryContextBinding(
      { binding_key: "growth_intelligence_platform.github.primary.production" },
      { auth: { is_admin: true }, pool: poolFor([readyRow({ readiness_status: "blocked", issue_code: "repository_context_secret_reference_unresolved", secret_reference_rows: 0 })]) },
    ),
    (error) => error.code === "repository_context_binding_not_ready",
  );
}

{
  const catalog = await repositoryContextBindingCatalog(
    { search: "mad4bdigital", limit: 10 },
    { auth: { is_admin: true }, pool: poolFor([readyRow()]) },
  );
  assert.equal(catalog.items.length, 1);
  assert.equal(catalog.page.total_count, 1);
}

{
  const readiness = await repositoryContextBindingReadinessSmoke({}, { pool: poolFor([readyRow()]) });
  assert.equal(readiness.status, "pass");
  assert.equal(readiness.ready_binding_count, 1);
  assert.equal(readiness.issue_binding_count, 0);
}

{
  const first = __test__.bindingFingerprint(readyRow(), ["push"]);
  const changed = __test__.bindingFingerprint(readyRow({ repository_name: "changed" }), ["push"]);
  assert.notEqual(first, changed, "binding fingerprint must change when repository authority changes");
}

console.log("repository context binding resolver tests passed");
