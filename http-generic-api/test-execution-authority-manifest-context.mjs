import assert from "node:assert/strict";
import { resolveExecutionAuthorityManifestContext } from "./executionAuthorityManifestContext.js";

{
  const calls = [];
  const result = await resolveExecutionAuthorityManifestContext(
    {
      requestPayload: {
        tenant_id: "tenant_1",
        user_id: "user_1",
        actor_role: "member",
        governance_level: "standard",
        team_key: "growth",
      },
      action: { action_key: "crm.contact.list" },
      endpoint: { endpoint_key: "crm.contact.list" },
      parent_action_key: "crm.contact.list",
      endpoint_key: "crm.contact.list",
    },
    {
      async resolveActionEndpointToolManifest(args) {
        calls.push(args);
        return {
          ok: true,
          resolver: "shared_action_endpoint_tool_manifest_resolver",
          mode: "read_model_only",
          requested: args,
          count: 1,
          surface_authority: {
            action_registry: { ok: true, resolved_surface_key: "surface.actions_registry_sheet", secrets_included: false },
            endpoint_registry: { ok: true, resolved_surface_key: "surface.endpoint_registry_sheet", secrets_included: false },
            tool_manifest: { ok: true, resolved_surface_key: "surface.platform_tool_manifest", secrets_included: false },
          },
          authority_chain: [
            "task_route_authority_resolver",
            "workflow_registry_authority_resolver",
            "action_registry_authority_resolver",
            "endpoint_registry",
            "platform_tool_manifest",
          ],
          manifests: [
            {
              action: {
                action_key: "crm.contact.list",
                plugin: { plugin_key: "tenant.nagy_sample_crm_20260525" },
                evaluation: { allowed: true, reasons: [] },
              },
              endpoints: [{ endpoint_key: "crm.contact.list" }],
              tools: [{ tool_key: "admin_app_connection_create" }],
              readiness: {
                endpoint_count: 1,
                tool_count: 1,
                manifest_complete: true,
              },
              secrets_included: false,
            },
          ],
          secrets_included: false,
        };
      },
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].action_key, "crm.contact.list");
  assert.equal(calls[0].endpoint_key, "crm.contact.list");
  assert.equal(calls[0].tenant_id, "tenant_1");
  assert.equal(calls[0].include_denied, true);
  assert.equal(result.requested, true);
  assert.equal(result.attempted, true);
  assert.equal(result.resolution_status, "ready");
  assert.equal(result.first_manifest_complete, true);
  assert.equal(result.action_allowed, true);
  assert.equal(result.endpoint_count, 1);
  assert.equal(result.tool_count, 1);
  assert.equal(result.manifests[0].action_key, "crm.contact.list");
  assert.equal(result.manifests[0].plugin_key, "tenant.nagy_sample_crm_20260525");
  assert.equal(result.secrets_included, false);
}

{
  const result = await resolveExecutionAuthorityManifestContext(
    {
      requestPayload: {},
      action: { action_key: "github_api_mcp" },
      endpoint: { endpoint_key: "repo_inspect" },
      parent_action_key: "github_api_mcp",
      endpoint_key: "repo_inspect",
    },
    {}
  );

  assert.equal(result.requested, true);
  assert.equal(result.attempted, false);
  assert.equal(result.resolution_status, "not_loaded");
  assert.equal(result.reason, "execution_authority_manifest_resolver_not_provided");
  assert.equal(result.secrets_included, false);
}

{
  const result = await resolveExecutionAuthorityManifestContext(
    {
      requestPayload: { execution_authority_manifest_enabled: false },
      action: { action_key: "github_api_mcp" },
      endpoint: { endpoint_key: "repo_inspect" },
      parent_action_key: "github_api_mcp",
      endpoint_key: "repo_inspect",
    },
    {
      async resolveActionEndpointToolManifest() {
        throw new Error("should not be called");
      },
    }
  );

  assert.equal(result.requested, true);
  assert.equal(result.attempted, false);
  assert.equal(result.resolution_status, "not_loaded");
}

{
  const result = await resolveExecutionAuthorityManifestContext(
    {
      requestPayload: {},
      action: { action_key: "broken.action" },
      endpoint: { endpoint_key: "broken.endpoint" },
      parent_action_key: "broken.action",
      endpoint_key: "broken.endpoint",
    },
    {
      async resolveActionEndpointToolManifest() {
        const err = new Error("surface missing");
        err.code = "surface_authority_check_failed";
        err.status = 403;
        throw err;
      },
    }
  );

  assert.equal(result.requested, true);
  assert.equal(result.attempted, true);
  assert.equal(result.resolution_status, "degraded");
  assert.equal(result.error_code, "surface_authority_check_failed");
  assert.equal(result.error_status, 403);
  assert.equal(result.secrets_included, false);
}

console.log("execution authority manifest context tests passed");
