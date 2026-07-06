import assert from "node:assert/strict";
import {
  CAPABILITY_ENABLEMENT_SYSTEM_TOOLS,
  buildCapabilityEnablementNextActions,
  buildCapabilityEnablementProposals,
  capabilityEnablementDecisionReport,
  capabilityEnablementProposalPreview,
  capabilityEnablementReadinessSmoke,
  capabilityEnablementResolve,
  capabilityEnablementTenantProjection,
  classifyEnablementDecision,
} from "./capabilityEnablementBroker.js";

const READINESS_OBJECTS = [
  "platform_semantic_capabilities",
  "platform_capability_provider_bindings",
  "platform_tool_dispatch_bindings",
  "workspace_resource_grants",
  "credential_bindings",
  "capability_resolution_envelope_ledger",
  "approval_holds",
  "runtime_dispatch_certification_registry",
  "capability_enablement_requests",
  "capability_enablement_steps",
  "v_capability_enablement_decision_rollup",
];

function readyEffective(overrides = {}) {
  return {
    ok: true,
    status: "ready",
    ready: true,
    workspace: { workspace_id: "workspace-1", workspace_key: "workspace-one" },
    membership: { role: "owner", status: "active" },
    capability: { capability_key: "repo_patch_apply", operation_key: "write", risk_class: "high" },
    binding: { app_key: "github", parent_action_key: "repo_patch_apply" },
    authority: { action_grant_present: true, resource_authority_present: true },
    runtime: { certification_key: "cert-repo-patch", dispatch_allowed: true, apply_allowed: false, export_key: "repo_patch_apply" },
    checks: { membership_ready: true, resource_authority_ready: true, connection_ready: true, runtime_certification_ready: true },
    manifest_hash: "hash-ready",
    secrets_included: false,
    ...overrides,
  };
}

function readyDryRun(overrides = {}) {
  return {
    ok: true,
    decision: "ready_for_dispatch",
    request_context: { tenant_id: "tenant-1", user_id: "user-1", operation_intent: "write" },
    capability: { app_key: "github", capability_key: "repo_patch_apply", risk_class: "high" },
    authority: { status: "passed", missing: [], passed: ["workspace_resolved", "dispatch_certification_present"] },
    gates: { dispatch_allowed: true, apply_allowed: false, secrets_included: false },
    blocking_gaps: [],
    maturity: { app_map_rows: 1 },
    secrets_included: false,
    ...overrides,
  };
}

{
  const toolNames = CAPABILITY_ENABLEMENT_SYSTEM_TOOLS.map((tool) => tool.name);
  assert.deepEqual(toolNames, [
    "capability_enablement_resolve",
    "capability_enablement_proposal_preview",
    "capability_enablement_decision_report",
    "capability_enablement_tenant_projection",
    "capability_enablement_readiness_smoke",
  ]);
  assert.equal(CAPABILITY_ENABLEMENT_SYSTEM_TOOLS[0].inputSchema.additionalProperties, false);
  assert.equal(CAPABILITY_ENABLEMENT_SYSTEM_TOOLS[2].requires_admin, true);
  assert.equal(CAPABILITY_ENABLEMENT_SYSTEM_TOOLS[4].requires_admin, true);
}

{
  const classification = classifyEnablementDecision({ effective: readyEffective(), dryRun: readyDryRun(), operationIntent: "write" });
  assert.equal(classification.decision, "ready_for_dispatch");
  assert.equal(classification.next_allowed_mode, "dispatch");
}

{
  const classification = classifyEnablementDecision({
    effective: readyEffective({ status: "runtime_certification_missing", ready: false }),
    dryRun: readyDryRun({ decision: "blocked_missing_authority_or_binding", blocking_gaps: ["dispatch_certification_missing_or_not_allowed"] }),
    operationIntent: "write",
  });
  assert.equal(classification.decision, "needs_certification");
  assert.deepEqual(classification.reason_codes, ["DISPATCH_CERTIFICATION_MISSING"]);
  const actions = buildCapabilityEnablementNextActions(classification, { effective: readyEffective({ status: "runtime_certification_missing" }), dryRun: readyDryRun({ decision: "blocked_missing_authority_or_binding" }) });
  assert.equal(actions[0].action, "run_scenario_readback_and_issue_dispatch_certification");
  const proposals = buildCapabilityEnablementProposals(actions, { capability: { runtime_surface: "repo_patch_apply" } });
  assert.equal(proposals[0].execution_mode, "proposal_only");
  assert.equal(proposals[0].target_tool, "runtime_dispatch_certification_issue");
  assert.equal(proposals[0].secrets_included, false);
}

{
  const classification = classifyEnablementDecision({ effective: readyEffective(), dryRun: readyDryRun(), operationIntent: "apply" });
  assert.equal(classification.decision, "blocked_apply_not_supported");
  assert.deepEqual(classification.reason_codes, ["APPLY_AUTHORITY_NOT_AUTO_GRANTABLE"]);
}

{
  const result = await capabilityEnablementResolve(
    { capability_key: "repo_patch_apply", operation_intent: "write", tenant_id: "tenant-override", user_id: "user-override", app_key: "github", workspace_id: "workspace-1" },
    {
      auth: { is_admin: true, tenant_id: "platform-tenant", user_id: "admin-user" },
      tenantEffectiveCapabilityPreview: async (args) => {
        assert.equal(args.tenant_id, "tenant-override");
        assert.equal(args.user_id, "user-override");
        return readyEffective();
      },
      runCapabilityResolutionDryRun: async (args) => {
        assert.equal(args.tenantId, "tenant-override");
        assert.equal(args.userId, "user-override");
        assert.equal(args.appKey, "github");
        return readyDryRun();
      },
    }
  );
  assert.equal(result.ok, true);
  assert.equal(result.mode, "diagnose_only");
  assert.equal(result.decision, "ready_for_dispatch");
  assert.equal(result.proposals[0].handoff_ready, true);
  assert.equal(result.internal_persistence.executed, false);
  assert.equal(result.auto_actions_taken.length, 0);
  assert.equal(result.provider_calls_made, 0);
  assert.equal(result.apply_allowed, false);
  assert.equal(result.mutations_executed, false);
  assert.equal(result.external_mutations_executed, false);
  assert.equal(result.secrets_included, false);
}

{
  const writes = [];
  const pool = {
    async query(sql, params) {
      writes.push({ sql, params });
      if (sql.startsWith("DELETE")) return [{ affectedRows: 0 }];
      return [{ affectedRows: 1 }];
    },
  };
  const result = await capabilityEnablementResolve(
    { capability_key: "repo_patch_apply", operation_intent: "write", tenant_id: "tenant-override", user_id: "user-override", app_key: "github", workspace_id: "workspace-1", record_decision: true },
    {
      auth: { is_admin: true, tenant_id: "platform-tenant", user_id: "admin-user" },
      pool,
      tenantEffectiveCapabilityPreview: async () => readyEffective(),
      runCapabilityResolutionDryRun: async () => readyDryRun(),
    }
  );
  assert.equal(result.internal_persistence.attempted, true);
  assert.equal(result.internal_persistence.executed, true);
  assert.equal(result.internal_persistence.step_count, 1);
  assert.equal(writes.length, 3);
  assert.match(writes[0].sql, /capability_enablement_requests/);
  assert.match(writes[2].sql, /capability_enablement_steps/);
  assert.equal(writes.some((write) => /CAST\(\? AS JSON\)/.test(write.sql)), false);
}

{
  const result = await capabilityEnablementResolve(
    { capability_key: "repo_patch_apply", operation_intent: "write", api_token: "must-not-be-accepted" },
    {
      auth: { is_admin: false, tenant_id: "tenant-1", user_id: "user-1" },
      tenantEffectiveCapabilityPreview: async () => { throw new Error("resolver should not run when secret-like input is present"); },
      runCapabilityResolutionDryRun: async () => { throw new Error("dry-run should not run when secret-like input is present"); },
    }
  );
  assert.equal(result.ok, false);
  assert.equal(result.decision, "blocked_secret_boundary");
  assert.deepEqual(result.reason_codes, ["SECRET_BOUNDARY_FAILED"]);
  assert.equal(result.secrets_included, false);
}

{
  const preview = await capabilityEnablementProposalPreview(
    { capability_key: "repo_patch_apply", operation_intent: "write", app_key: "github" },
    { auth: { is_admin: false, tenant_id: "tenant-1", user_id: "user-1" }, tenantEffectiveCapabilityPreview: async () => readyEffective(), runCapabilityResolutionDryRun: async () => readyDryRun() }
  );
  assert.equal(preview.ok, true);
  assert.equal(preview.tool, "capability_enablement_proposal_preview");
  assert.equal(preview.proposals.length, 1);
  assert.equal(preview.mutations_executed, false);
}

{
  const poolQueries = [];
  const pool = {
    async query(sql, params) {
      poolQueries.push({ sql, params });
      assert.match(sql, /platform_tool_dispatch_bindings/);
      return [[{
        binding_id: "ptdb_repo_patch_apply_put_contents",
        parent_action_key: "github_api_mcp",
        endpoint_key: "create_or_update_file_contents",
        export_key: "github_api_mcp:create_or_update_file_contents",
        tool_key: "repo_patch_apply",
        surface_class: "virtual_admin_tool",
        scope_class: "admin",
        capability_key: "github_file_patch_apply",
        operation_intent: "github_repo_patch",
        runtime_surface: "repo_patch_apply",
        readback_policy_key: "github_file_sha_readback_v1",
        partial_success_policy_key: "github_file_patch_no_partial_write_v1",
        atomicity_mode: "single_file_mutation",
        status: "active",
        metadata_json: "{\"secrets_included\":false}",
      }]];
    },
  };
  const result = await capabilityEnablementResolve(
    { capability_key: "repo_patch_apply", operation_intent: "write", app_key: "github", runtime_surface: "repo_patch_apply" },
    {
      auth: { is_admin: true, tenant_id: "tenant-1", user_id: "admin-user" },
      pool,
      tenantEffectiveCapabilityPreview: async () => ({ ok: false, status: "blocked", error: { code: "CAPABILITY_NOT_REGISTERED", message: "missing semantic capability" }, secrets_included: false }),
      runCapabilityResolutionDryRun: async () => readyDryRun({ authority: { status: "passed", passed: ["dispatch_certification_present"] } }),
    }
  );
  assert.equal(poolQueries.length, 1);
  assert.equal(result.ok, true);
  assert.equal(result.decision, "ready_for_dispatch");
  assert.equal(result.effective_capability.status, "virtual_admin_tool_ready");
  assert.equal(result.effective_capability.bridge.source, "platform_tool_dispatch_bindings");
  assert.equal(result.effective_capability.binding.tool_key, "repo_patch_apply");
  assert.equal(result.effective_capability.runtime.apply_allowed, false);
  assert.equal(result.provider_calls_made, 0);
  assert.equal(result.external_mutations_executed, false);
  assert.equal(result.secrets_included, false);
}

{
  const result = await capabilityEnablementResolve(
    { capability_key: "repo_patch_apply", operation_intent: "write", app_key: "github", runtime_surface: "repo_patch_apply" },
    {
      auth: { is_admin: false, tenant_id: "tenant-1", user_id: "user-1" },
      pool: { async query() { throw new Error("tenant principals must not query virtual admin bridge"); } },
      tenantEffectiveCapabilityPreview: async () => ({ ok: false, status: "blocked", error: { code: "CAPABILITY_NOT_REGISTERED", message: "missing semantic capability" }, secrets_included: false }),
      runCapabilityResolutionDryRun: async () => readyDryRun(),
    }
  );
  assert.equal(result.decision, "blocked_policy_denied");
  assert.deepEqual(result.reason_codes, ["CAPABILITY_NOT_REGISTERED"]);
  assert.equal(result.secrets_included, false);
}

{
  const pool = {
    async query(sql) {
      if (sql.includes("v_capability_enablement_decision_rollup")) return [[{ tenant_id: "tenant-1", capability_key: "repo_patch_apply", operation_intent: "write", decision: "ready_for_dispatch", request_count: 2 }]];
      return [[{ request_id: "ceb_1", tenant_id: "tenant-1", user_id: "user-1", capability_key: "repo_patch_apply", operation_intent: "write", app_key: "github", decision: "ready_for_dispatch", next_allowed_mode: "dispatch", reason_codes_json: "[]", created_at: "2026-07-05T00:00:00Z" }]];
    },
  };
  const report = await capabilityEnablementDecisionReport({ tenant_id: "tenant-1" }, { auth: { is_admin: true }, pool });
  assert.equal(report.ok, true);
  assert.equal(report.rollup.length, 1);
  assert.equal(report.recent.length, 1);
  const denied = await capabilityEnablementDecisionReport({}, { auth: { is_admin: false }, pool });
  assert.equal(denied.ok, false);
  assert.equal(denied.status, "authorization_gated");
}

{
  const pool = {
    async query() {
      return [[{ request_id: "ceb_1", capability_key: "repo_patch_apply", operation_intent: "write", app_key: "github", decision: "needs_credential", next_allowed_mode: "diagnose", reason_codes_json: "[\"CONNECTION_MISSING\"]", created_at: "2026-07-05T00:00:00Z" }]];
    },
  };
  const projection = await capabilityEnablementTenantProjection({}, { auth: { is_admin: false, tenant_id: "tenant-1", user_id: "user-1" }, pool });
  assert.equal(projection.ok, true);
  assert.equal(projection.items[0].reason_codes[0], "CONNECTION_MISSING");
  assert.equal(projection.secrets_included, false);
}

{
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return [READINESS_OBJECTS.map((table_name) => ({ table_name }))];
    },
  };
  const smoke = await capabilityEnablementReadinessSmoke({}, { pool });
  assert.equal(smoke.ok, true);
  assert.equal(smoke.status, "pass");
  assert.equal(smoke.descriptor_tools.length, 5);
  assert.equal(smoke.provider_calls_made, 0);
  assert.equal(smoke.mutations_executed, false);
  assert.equal(smoke.apply_allowed, false);
  assert.equal(smoke.secrets_included, false);
  assert.equal(calls.length, 1);
}

{
  const classification = classifyEnablementDecision({
    effective: {
      ok: false,
      status: "blocked",
      error: {
        code: "CAPABILITY_BINDING_MISSING",
        message: "No active provider binding exists for the capability.",
        details: { capability_key: "content.article.publish" },
      },
      secrets_included: false,
    },
    dryRun: readyDryRun({ decision: "blocked_requires_setup", blocking_gaps: ["app_integration_missing_or_unresolved"] }),
    operationIntent: "read",
  });
  assert.equal(classification.decision, "needs_execution_enablement");
  assert.deepEqual(classification.reason_codes, ["CAPABILITY_BINDING_MISSING"]);
  const actions = buildCapabilityEnablementNextActions(classification, {
    effective: { ok: false, status: "blocked", error: { code: "CAPABILITY_BINDING_MISSING" }, secrets_included: false },
    dryRun: readyDryRun({ decision: "blocked_requires_setup" }),
  });
  assert.equal(actions[0].action, "request_capability_provider_binding_or_plugin_action_grant");
  assert.equal(actions[0].required_role, "platform_admin");
  assert.equal(actions[0].reason_code, "CAPABILITY_BINDING_MISSING");
}

{
  const classification = classifyEnablementDecision({
    effective: readyEffective({
      status: "connection_not_validated",
      ready: false,
      checks: { membership_ready: true, resource_authority_ready: true, connection_ready: false, runtime_certification_ready: true },
    }),
    dryRun: readyDryRun(),
    operationIntent: "read",
  });
  assert.equal(classification.decision, "needs_credential");
  assert.deepEqual(classification.reason_codes, ["CONNECTION_NOT_VALIDATED"]);
  const actions = buildCapabilityEnablementNextActions(classification, {
    effective: readyEffective({ status: "connection_not_validated", ready: false }),
    dryRun: readyDryRun(),
  });
  assert.equal(actions[0].action, "validate_connection");
}

console.log("capability enablement broker tests passed");
