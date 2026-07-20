import assert from "node:assert/strict";
import { previewOperation } from "../operationOrchestrator.js";
import { buildOperationObservabilityDashboard } from "../operationObservabilityService.js";

const OWNER = "mad4bdigital-ai";
const REPO = "multi-business-multi-role-growth-intelligence-os";
const BRANCH = "gpt/platform-request-execution-hardening-spec-kit-20260712";
const RESOURCE_URI = `github://${OWNER}/${REPO}`;

class PilotPool {
  constructor({ tenant = false } = {}) {
    this.tenant = tenant;
    this.queries = [];
  }

  async query(sql, params = []) {
    this.queries.push({ sql, params });

    if (/FROM memberships m/.test(sql)) {
      assert.equal(this.tenant, true, "membership lookup must only occur for Tenant pilot");
      return [[{
        tenant_id: "tenant-pilot",
        role: "owner",
        status: "active",
        tenant_status: "active",
      }]];
    }

    if (/FROM platform_resource_authority_bindings/.test(sql)) {
      assert.equal(this.tenant, true, "authority lookup must only occur for Tenant pilot");
      return [[{
        binding_id: "pilot-binding",
        tenant_id: "tenant-pilot",
        workspace_id: null,
        user_id: "user-pilot",
        resource_type: "repository",
        resource_uri: RESOURCE_URI,
        recipe_key: null,
        permission_level: "write",
        allowed_modes_json: JSON.stringify(["read", "write", "apply"]),
        authority_source: "pilot_fixture",
        expires_at: null,
      }]];
    }

    throw new Error(`Unexpected pilot SQL: ${sql}`);
  }
}

const previewInput = {
  operation_key: "repo.change.preview",
  automation_key: "pr_delivery",
  owner: OWNER,
  repo: REPO,
  branch: BRANCH,
  default_branch: "main",
  pull_number: 2551,
  required_checks: [
    "Syntax Check",
    "Architecture Drift Detection",
    "Execution Resolver Gate",
    "Unit & Integration Tests",
  ],
  response_mode: "relevant",
};

const adminPool = new PilotPool();
const tenantPool = new PilotPool({ tenant: true });

const adminPreview = await previewOperation(previewInput, {
  auth: {
    mode: "backend_api",
    is_admin: true,
    admin_id: "admin-pilot",
  },
  pool: adminPool,
});

const tenantPreview = await previewOperation(previewInput, {
  auth: {
    mode: "user_jwt",
    tenant_id: "tenant-pilot",
    user_id: "user-pilot",
    tenant_role: "owner",
  },
  pool: tenantPool,
});

for (const [name, result] of [["admin", adminPreview], ["tenant", tenantPreview]]) {
  assert.equal(result.ok, true, `${name} preview must succeed`);
  assert.equal(result.operation_key, "repo.change.preview");
  assert.equal(result.mutations_executed, false);
  assert.equal(result.secrets_included, false);
  assert.ok(result.plan && typeof result.plan === "object");
  assert.ok(result.context && typeof result.context === "object");
}

assert.equal(adminPreview.context.principal.principal_class, "admin");
assert.equal(tenantPreview.context.principal.principal_class, "tenant");
assert.equal(tenantPreview.context.authority.binding_id, "pilot-binding");
assert.equal(tenantPreview.context.authority.permission_level, "write");
assert.equal(adminPool.queries.length, 0, "Admin preview must not require Tenant SQL");
assert.equal(tenantPool.queries.length, 2, "Tenant preview must perform membership and authority checks only");

const stablePlan = (plan) => ({
  automation_key: plan.automation_key ?? null,
  mode: plan.mode ?? null,
  owner: plan.owner ?? plan.repository?.owner ?? null,
  repo: plan.repo ?? plan.repository?.repo ?? null,
  branch: plan.branch ?? plan.repository?.branch ?? null,
  default_branch: plan.default_branch ?? plan.repository?.default_branch ?? null,
  pull_number: plan.pull_number ?? null,
});

assert.deepEqual(
  stablePlan(adminPreview.plan),
  stablePlan(tenantPreview.plan),
  "Shadow preview plan must remain equivalent across Admin and authorized Tenant principals",
);

const telemetryRows = [
  {
    duration_seconds: "0.10",
    execution_status: "completed",
    parent_action_key: "github_api_mcp",
    endpoint_key: "github_get_git_ref_head",
    tool_key: "runtime_endpoint_call",
    action_key: "repo.change.preview",
    source_layer: "operation_orchestrator",
  },
  {
    duration_seconds: "0.50",
    execution_status: "failed",
    failure_reason: "provider timeout",
    recovery_status: "retrying",
    recovery_action: "retry with backoff",
    parent_action_key: "github_api_mcp",
    endpoint_key: "github_create_tree",
    tool_key: "runtime_endpoint_call",
    action_key: "repo.change.execute",
    source_layer: "operation_orchestrator",
  },
  {
    duration_seconds: "1.00",
    execution_status: "completed",
    recovery_status: "recovered",
    route_status: "success",
    tool_key: "operation_catalog_list",
    action_key: "operation.status.get",
    source_layer: "operation_context",
  },
];

const adminDashboard = buildOperationObservabilityDashboard(telemetryRows, {
  principalScope: "admin",
  hours: 24,
  sampleLimit: 100,
  generatedAt: new Date("2026-07-15T20:00:00Z"),
});
const tenantDashboard = buildOperationObservabilityDashboard(telemetryRows, {
  principalScope: "tenant",
  hours: 24,
  sampleLimit: 100,
  generatedAt: new Date("2026-07-15T20:00:00Z"),
});

assert.equal(adminDashboard.summary.total_events, 3);
assert.equal(adminDashboard.summary.failed_events, 1);
assert.equal(adminDashboard.summary.internal_call_count, 3);
assert.equal(adminDashboard.summary.discovery_call_count, 2);
assert.equal(adminDashboard.summary.retry_count, 2);
assert.deepEqual(adminDashboard.summary, tenantDashboard.summary);
assert.equal(adminDashboard.principal_scope, "admin");
assert.equal(tenantDashboard.principal_scope, "tenant");
assert.equal(adminDashboard.source.raw_payloads_included, false);
assert.equal(tenantDashboard.source.raw_payloads_included, false);
assert.equal(adminDashboard.secrets_included, false);
assert.equal(tenantDashboard.secrets_included, false);

const serialized = JSON.stringify({
  adminPreview,
  tenantPreview,
  adminDashboard,
  tenantDashboard,
});
assert.doesNotMatch(serialized, /pilot-secret-value|authorization\s*:/i);

const evidence = {
  schema_version: 1,
  pilot_key: "platform_request_execution_hardening",
  mode: "shadow_read_only",
  cases: {
    shadow_preview: "passed",
    admin_preview: "passed",
    tenant_preview: "passed",
    tenant_membership_and_authority: "passed",
    admin_observability: "passed",
    tenant_observability: "passed",
    no_provider_mutation: "passed",
    no_secret_or_raw_payload_exposure: "passed",
  },
  provider_writes: false,
  deployment: false,
  migrations_applied: false,
  secrets_included: false,
};

console.log(JSON.stringify(evidence));
