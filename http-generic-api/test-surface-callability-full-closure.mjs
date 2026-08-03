import assert from "node:assert/strict";
import fs from "node:fs";
import YAML from "yaml";
import { validateDirectRouteCallabilityContracts } from "./scripts/resource-api-callability-contracts.mjs";

// SURFACE_CALLABILITY_FULL_CLOSURE
const manifest = JSON.parse(fs.readFileSync("resource-api-surface-callability.manifest.json", "utf8"));
const coverageManifest = JSON.parse(fs.readFileSync("resource-api-coverage.manifest.json", "utf8"));
const validation = validateDirectRouteCallabilityContracts({ root: process.cwd(), manifest: coverageManifest });
assert.equal(validation.ok, true, JSON.stringify(validation.findings));
assert.deepEqual(validation.covered_tool_keys.filter((key) => manifest.source_queue_tool_keys.includes(key)).sort(), [...manifest.source_queue_tool_keys].sort());
const queue = JSON.parse(fs.readFileSync("../docs/surface-contract-gap-queue.json", "utf8"));
const remainingScopedItems = queue.top_items.filter((item) => (item.remediation || []).some((action) => action.action_key === "verify_tool_registry_binding" && (action.targets || []).some((key) => manifest.source_queue_tool_keys.includes(key))));
assert.deepEqual(remainingScopedItems, [], JSON.stringify(remainingScopedItems));
const lifecycle = fs.readFileSync("routes/tenantLifecycleRoutes.js", "utf8");
const resources = fs.readFileSync("routes/workspaceResourceRoutes.js", "utf8");
const infrastructure = fs.readFileSync("routes/tenantInfrastructureRoutes.js", "utf8");
const agentService = fs.readFileSync("agentSurfaceRuntimeService.js", "utf8");
assert.equal((infrastructure.match(/router\.get\(\"\/me\/infrastructure\/ssh\/cli\/approval-requests\/:request_id\"/g) || []).length, 1);
assert.equal((infrastructure.match(/router\.post\(\"\/me\/infrastructure\/ssh\/cli\/approval-requests\/:request_id\/decision\"/g) || []).length, 1);
assert(!/workspace_invitation_resend[\s\S]{0,5000}token:\s*result/.test(lifecycle));
for (const key of ["tenant_agent_surface_deployment_upsert","tenant_agent_surface_preferences_update","tenant_ssh_cli_approval_request_create","tenant_ssh_cli_approval_request_decide","workspace_access_request_cancel","workspace_invitation_resend","workspace_invitation_revoke","workspace_invitations_expire_stale","workspace_member_remove","workspace_member_update","workspace_ownership_transfer","workspace_resource_grant_create","workspace_resource_grant_revoke"]) {
  const evidence = lifecycle.includes(`MUTATION_TRANSACTION: ${key}`) || resources.includes(`MUTATION_TRANSACTION: ${key}`) || infrastructure.includes(`MUTATION_TRANSACTION: ${key}`) || agentService.includes(`MUTATION_TRANSACTION: ${key}`);
  const readback = lifecycle.includes(`MUTATION_READBACK: ${key}`) || resources.includes(`MUTATION_READBACK: ${key}`) || infrastructure.includes(`MUTATION_READBACK: ${key}`) || agentService.includes(`MUTATION_READBACK: ${key}`);
  assert(evidence, `missing transaction marker for ${key}`);
  assert(readback, `missing readback marker for ${key}`);
}
const runtimeOpenApi = YAML.parse(fs.readFileSync("openapi/frontend-runtime-routes.generated.yaml", "utf8"));
const canonicalOpenApi = YAML.parse(fs.readFileSync("openapi.yaml", "utf8"));
for (const contract of manifest.contracts) {
  const [method, route] = contract.route_signature.split(/\s+/, 2);
  const document = contract.openapi_file === "openapi.yaml" ? canonicalOpenApi : contract.openapi_file === "openapi/frontend-runtime-routes.generated.yaml" ? runtimeOpenApi : null;
  assert(document.paths?.[route]?.[method.toLowerCase()], `OpenAPI operation missing: ${contract.route_signature}`);
}
const classification = JSON.parse(fs.readFileSync("surface-contract-classification-evidence.json", "utf8"));
assert(classification.items.some((item) => item.migration_file === "20260730_hostinger_production_resync_policy.sql" && item.classification_status === "verified_evidence_only"));
const attestations = JSON.parse(fs.readFileSync("../docs/surface-contract-safety-attestations.json", "utf8"));
assert(attestations.items.some((item) => item.migration_file === "20260730_hostinger_production_resync_policy.sql" && item.attestation_status === "verified_static_no_external_side_effects"));
// FULL_CLOSURE_TOOL: brand_workspace_context_resolve
// FULL_CLOSURE_TOOL: connect_credential_intake_wait
// FULL_CLOSURE_TOOL: credential_intake_connection_status
// FULL_CLOSURE_TOOL: platform_resource_context_catalog
// FULL_CLOSURE_TOOL: platform_resource_context_diagnostic_handoff
// FULL_CLOSURE_TOOL: platform_resource_context_related
// FULL_CLOSURE_TOOL: platform_resource_context_resolve
// FULL_CLOSURE_TOOL: tenant_agent_surface_deployment_upsert
// FULL_CLOSURE_TOOL: tenant_agent_surface_preferences_update
// FULL_CLOSURE_TOOL: tenant_agent_surfaces_catalog
// FULL_CLOSURE_TOOL: tenant_agent_surfaces_get
// FULL_CLOSURE_TOOL: tenant_agent_surfaces_readiness
// FULL_CLOSURE_TOOL: tenant_capability_registry_read
// FULL_CLOSURE_TOOL: tenant_database_connection_status
// FULL_CLOSURE_TOOL: tenant_database_preflight
// FULL_CLOSURE_TOOL: tenant_database_query_readonly
// FULL_CLOSURE_TOOL: tenant_database_schema_read
// FULL_CLOSURE_TOOL: tenant_docs_catalog
// FULL_CLOSURE_TOOL: tenant_gpt_operating_guide_read
// FULL_CLOSURE_TOOL: tenant_ssh_cli_allowlisted_dry_run
// FULL_CLOSURE_TOOL: tenant_ssh_cli_allowlisted_execute
// FULL_CLOSURE_TOOL: tenant_ssh_cli_approval_request_create
// FULL_CLOSURE_TOOL: tenant_ssh_cli_approval_request_decide
// FULL_CLOSURE_TOOL: tenant_ssh_cli_approval_request_status
// FULL_CLOSURE_TOOL: tenant_ssh_cli_execute_job_result
// FULL_CLOSURE_TOOL: tenant_ssh_connection_status
// FULL_CLOSURE_TOOL: tenant_ssh_preflight
// FULL_CLOSURE_TOOL: tenant_ssh_probe
// FULL_CLOSURE_TOOL: workspace_access_request_cancel
// FULL_CLOSURE_TOOL: workspace_assets_list
// FULL_CLOSURE_TOOL: workspace_invitation_resend
// FULL_CLOSURE_TOOL: workspace_invitation_revoke
// FULL_CLOSURE_TOOL: workspace_invitations_expire_stale
// FULL_CLOSURE_TOOL: workspace_member_remove
// FULL_CLOSURE_TOOL: workspace_member_update
// FULL_CLOSURE_TOOL: workspace_my_access_requests_list
// FULL_CLOSURE_TOOL: workspace_ownership_transfer
// FULL_CLOSURE_TOOL: workspace_resource_grant_create
// FULL_CLOSURE_TOOL: workspace_resource_grant_revoke
// FULL_CLOSURE_TOOL: workspace_resource_grants_list
// FULL_CLOSURE_TOOL: workspace_vaults_list
// FULL_CLOSURE_ROUTE: GET /connect/api/credential-intake/sessions/{session_id}/wait
// FULL_CLOSURE_ROUTE: GET /me/access-requests
// FULL_CLOSURE_ROUTE: GET /me/agent-surfaces
// FULL_CLOSURE_ROUTE: GET /me/agent-surfaces/catalog
// FULL_CLOSURE_ROUTE: GET /me/agent-surfaces/readiness
// FULL_CLOSURE_ROUTE: GET /me/connections/{connection_id}/credential-intake-status
// FULL_CLOSURE_ROUTE: GET /me/infrastructure/connections/{connection_id}/status
// FULL_CLOSURE_ROUTE: GET /me/infrastructure/database/connections/{connection_id}/schema
// FULL_CLOSURE_ROUTE: GET /me/infrastructure/ssh/cli/approval-requests/{request_id}
// FULL_CLOSURE_ROUTE: GET /me/infrastructure/ssh/connections/{connection_id}/cli/execute-jobs/{job_id}/result
// FULL_CLOSURE_ROUTE: GET /me/workspaces/{tenant_id}/assets
// FULL_CLOSURE_ROUTE: GET /me/workspaces/{tenant_id}/resource-grants
// FULL_CLOSURE_ROUTE: GET /me/workspaces/{tenant_id}/vaults
// FULL_CLOSURE_ROUTE: GET /tenant/docs
// FULL_CLOSURE_ROUTE: GET /tenant/docs/read
// FULL_CLOSURE_ROUTE: PATCH /me/workspaces/{tenant_id}/members/{user_id}
// FULL_CLOSURE_ROUTE: POST /me/infrastructure/connections/{connection_id}/preflight
// FULL_CLOSURE_ROUTE: POST /me/infrastructure/database/connections/{connection_id}/query-readonly
// FULL_CLOSURE_ROUTE: POST /me/infrastructure/ssh/cli/approval-requests/{request_id}/decision
// FULL_CLOSURE_ROUTE: POST /me/infrastructure/ssh/connections/{connection_id}/cli/approval-request
// FULL_CLOSURE_ROUTE: POST /me/infrastructure/ssh/connections/{connection_id}/cli/dry-run
// FULL_CLOSURE_ROUTE: POST /me/infrastructure/ssh/connections/{connection_id}/cli/execute
// FULL_CLOSURE_ROUTE: POST /me/infrastructure/ssh/connections/{connection_id}/probe
// FULL_CLOSURE_ROUTE: POST /me/workspaces/{tenant_id}/access-requests/{request_id}/cancel
// FULL_CLOSURE_ROUTE: POST /me/workspaces/{tenant_id}/invitations/{invitation_id}/resend
// FULL_CLOSURE_ROUTE: POST /me/workspaces/{tenant_id}/invitations/{invitation_id}/revoke
// FULL_CLOSURE_ROUTE: POST /me/workspaces/{tenant_id}/invitations/expire-stale
// FULL_CLOSURE_ROUTE: POST /me/workspaces/{tenant_id}/members/{user_id}/remove
// FULL_CLOSURE_ROUTE: POST /me/workspaces/{tenant_id}/ownership/transfer
// FULL_CLOSURE_ROUTE: POST /me/workspaces/{tenant_id}/resource-grants
// FULL_CLOSURE_ROUTE: POST /me/workspaces/{tenant_id}/resource-grants/{grant_id}/revoke
// FULL_CLOSURE_ROUTE: POST /system/tools/call
// FULL_CLOSURE_ROUTE: PUT /me/agent-surfaces/{surface_key}/deployment
// FULL_CLOSURE_ROUTE: PUT /me/agent-surfaces/{surface_key}/preferences
console.log("surface callability full closure tests passed");
