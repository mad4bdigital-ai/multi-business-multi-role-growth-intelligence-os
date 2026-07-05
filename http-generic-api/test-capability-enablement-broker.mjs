import assert from "node:assert/strict";
import {
  CAPABILITY_ENABLEMENT_SYSTEM_TOOLS,
  buildCapabilityEnablementNextActions,
  capabilityEnablementReadinessSmoke,
  capabilityEnablementResolve,
  classifyEnablementDecision,
} from "./capabilityEnablementBroker.js";

function readyEffective(overrides = {}) {
  return {
    ok: true,
    status: "ready",
    ready: true,
    workspace: { workspace_id: "workspace-1", workspace_key: "workspace-one" },
    membership: { role: "owner", status: "active" },
    capability: {
      capability_key: "repo_patch_apply",
      operation_key: "write",
      risk_class: "high",
    },
    binding: {
      app_key: "github",
      parent_action_key: "repo_patch_apply",
    },
    authority: {
      action_grant_present: true,
      resource_authority_present: true,
    },
    runtime: {
      certification_key: "cert-repo-patch",
      dispatch_allowed: true,
      apply_allowed: false,
    },
    checks: {
      membership_ready: true,
      resource_authority_ready: true,
      connection_ready: true,
      runtime_certification_ready: true,
    },
    manifest_hash: "hash-ready",
    secrets_included: false,
    ...overrides,
  };
}

function readyDryRun(overrides = {}) {
  return {
    ok: true,
    decision: "ready_for_dispatch",
    request_context: {
      tenant_id: "tenant-1",
      user_id: "user-1",
      operation_intent: "write",
    },
    capability: {
      app_key: "github",
      capability_key: "repo_patch_apply",
      risk_class: "high",
    },
    authority: {
      status: "passed",
      missing: [],
      passed: ["workspace_resolved", "dispatch_certification_present"],
    },
    gates: {
      dispatch_allowed: true,
      apply_allowed: false,
      secrets_included: false,
    },
    blocking_gaps: [],
    maturity: { app_map_rows: 1 },
    secrets_included: false,
    ...overrides,
  };
}

{
  const toolNames = CAPABILITY_ENABLEMENT_SYSTEM_TOOLS.map((tool) => tool.name);
  assert.deepEqual(toolNames, ["capability_enablement_resolve", "capability_enablement_readiness_smoke"]);
  assert.equal(CAPABILITY_ENABLEMENT_SYSTEM_TOOLS[0].inputSchema.additionalProperties, false);
  assert.equal(CAPABILITY_ENABLEMENT_SYSTEM_TOOLS[1].requires_admin, true);
}

{
  const classification = classifyEnablementDecision({
    effective: readyEffective(),
    dryRun: readyDryRun(),
    operationIntent: "write",
  });
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
  const actions = buildCapabilityEnablementNextActions(classification, {
    effective: readyEffective({ status: "runtime_certification_missing" }),
    dryRun: readyDryRun({ decision: "blocked_missing_authority_or_binding" }),
  });
  assert.equal(actions[0].action, "run_scenario_readback_and_issue_dispatch_certification");
}

{
  const classification = classifyEnablementDecision({
    effective: readyEffective(),
    dryRun: readyDryRun(),
    operationIntent: "apply",
  });
  assert.equal(classification.decision, "blocked_apply_not_supported");
  assert.deepEqual(classification.reason_codes, ["APPLY_AUTHORITY_NOT_AUTO_GRANTABLE"]);
}

{
  const result = await capabilityEnablementResolve(
    {
      capability_key: "repo_patch_apply",
      operation_intent: "write",
      tenant_id: "tenant-override",
      user_id: "user-override",
      app_key: "github",
      workspace_id: "workspace-1",
    },
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
  assert.equal(result.auto_actions_taken.length, 0);
  assert.equal(result.provider_calls_made, 0);
  assert.equal(result.apply_allowed, false);
  assert.equal(result.mutations_executed, false);
  assert.equal(result.secrets_included, false);
}

{
  const result = await capabilityEnablementResolve(
    {
      capability_key: "repo_patch_apply",
      operation_intent: "write",
      api_token: "must-not-be-accepted",
    },
    {
      auth: { is_admin: false, tenant_id: "tenant-1", user_id: "user-1" },
      tenantEffectiveCapabilityPreview: async () => {
        throw new Error("resolver should not run when secret-like input is present");
      },
      runCapabilityResolutionDryRun: async () => {
        throw new Error("dry-run should not run when secret-like input is present");
      },
    }
  );
  assert.equal(result.ok, false);
  assert.equal(result.decision, "blocked_secret_boundary");
  assert.deepEqual(result.reason_codes, ["SECRET_BOUNDARY_FAILED"]);
  assert.equal(result.secrets_included, false);
}

{
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return [[
        { table_name: "platform_semantic_capabilities" },
        { table_name: "platform_capability_provider_bindings" },
        { table_name: "workspace_resource_grants" },
        { table_name: "credential_bindings" },
        { table_name: "capability_resolution_envelope_ledger" },
        { table_name: "approval_holds" },
        { table_name: "runtime_dispatch_certification_registry" },
      ]];
    },
  };
  const smoke = await capabilityEnablementReadinessSmoke({}, { pool });
  assert.equal(smoke.ok, true);
  assert.equal(smoke.status, "pass");
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
