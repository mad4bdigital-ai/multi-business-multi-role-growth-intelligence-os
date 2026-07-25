import assert from "node:assert/strict";

import {
  assertAuthorizedScopeRepository,
  assertCapabilityReadinessRepository,
  assertContextPinRepository,
  assertExactConnectionRepository,
  assertExecutionLedgerRepository,
  assertResourceGraphRepository,
} from "./contextKernel/application/repositoryPorts.js";
import {
  createAuthorizedScopeRepository,
  createCapabilityReadinessRepository,
  createContextPinRepository,
  createExactConnectionRepository,
  createExecutionLedgerRepository,
  createResourceGraphRepository,
} from "./contextKernel/infrastructure/sql/index.js";

function createPool(handler) {
  const calls = [];
  const pool = {
    async execute(sql, params = []) {
      const call = { sql: String(sql), params: [...params] };
      calls.push(call);
      const rows = await handler(call.sql, call.params, calls.length - 1);
      return [rows ?? [], []];
    },
  };
  return { pool, calls };
}

function assertTenantPredicate(call, tenantRef) {
  assert.match(call.sql, /tenant_id\s*=\s*\?/i);
  assert.ok(call.params.includes(tenantRef));
}

async function assertRejectCode(run, expectedCode) {
  let error = null;
  try {
    await run();
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, `Expected ${expectedCode} to be thrown.`);
  assert.equal(error.code, expectedCode);
  return error;
}

const membershipRow = {
  user_id: "user-a",
  tenant_id: "tenant-a",
  role: "owner",
  status: "active",
  granted_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
};
const workspaceRow = {
  workspace_id: "workspace-a",
  tenant_id: "tenant-a",
  workspace_key: "workspace-a-key",
  display_name: "Workspace A",
  workspace_type: "brand",
  bootstrap_status: "ready",
  linked_brand_key: "brand-a",
  updated_at: "2026-01-03T00:00:00.000Z",
};

const authorizedMock = createPool((sql) => {
  if (sql.includes("FROM memberships")) return [membershipRow];
  if (sql.includes("FROM workspace_registry")) return [workspaceRow];
  throw new Error(`Unexpected SQL: ${sql}`);
});
const authorizedRepository = createAuthorizedScopeRepository({ pool: authorizedMock.pool });
assertAuthorizedScopeRepository(authorizedRepository);
const authorizedScope = await authorizedRepository.findAuthorizedScope({
  tenantRef: "tenant-a",
  userRef: "user-a",
});
assert.equal(authorizedScope.membership.role, "owner");
assert.equal(authorizedScope.workspaces[0].workspaceRef, "workspace-a");
assert.ok(Object.isFrozen(authorizedScope));
assert.ok(Object.isFrozen(authorizedScope.workspaces));
assert.equal(authorizedMock.calls.length, 2);
for (const call of authorizedMock.calls) assertTenantPredicate(call, "tenant-a");

const ambiguousMembershipMock = createPool((sql) => {
  if (sql.includes("FROM memberships")) return [membershipRow, { ...membershipRow }];
  return [];
});
await assertRejectCode(
  () => createAuthorizedScopeRepository({ pool: ambiguousMembershipMock.pool }).findAuthorizedScope({
    tenantRef: "tenant-a",
    userRef: "user-a",
  }),
  "authorized_scope_membership_ambiguous",
);

const sqlFailure = new Error("sql unavailable");
const failingMock = createPool(() => {
  throw sqlFailure;
});
let propagated = null;
try {
  await createAuthorizedScopeRepository({ pool: failingMock.pool }).findAuthorizedScope({
    tenantRef: "tenant-a",
    userRef: "user-a",
  });
} catch (error) {
  propagated = error;
}
assert.equal(propagated, sqlFailure);

const resourceMock = createPool((sql) => {
  if (sql.includes("v_workspace_resource_grant_effective")) {
    return [{
      grant_id: "grant-a",
      tenant_id: "tenant-a",
      grantee_user_id: "user-a",
      membership_role: "owner",
      resource_type: "workspace",
      resource_ref: "workspace-a",
      permission: "admin",
      source: "membership_default",
      granted_at: "2026-01-01T00:00:00.000Z",
      expires_at: null,
    }];
  }
  if (sql.includes("v_effective_platform_resource_authority_bindings")) {
    return [{
      binding_id: "binding-a",
      tenant_id: "tenant-a",
      workspace_id: "workspace-a",
      user_id: "user-a",
      resource_type: "repository",
      resource_uri: "github://example/repository",
      resource_ref_json: JSON.stringify({ branch: "feature/example" }),
      recipe_key: "repo_patch_batch_apply",
      permission_level: "patch",
      allowed_modes_json: JSON.stringify(["atomic_change_set"]),
      authority_source: "test",
      expires_at: null,
      updated_at: "2026-01-02T00:00:00.000Z",
    }];
  }
  throw new Error(`Unexpected SQL: ${sql}`);
});
const resourceRepository = createResourceGraphRepository({ pool: resourceMock.pool });
assertResourceGraphRepository(resourceRepository);
const resources = await resourceRepository.listAuthorizedResources({
  tenantRef: "tenant-a",
  userRef: "user-a",
  limit: 10,
});
assert.equal(resources.length, 2);
const platformAuthorityResource = resources.find(
  (resource) => resource.sourceType === "platform_resource_authority",
);
assert.equal(platformAuthorityResource.resourceReference.branch, "feature/example");
assert.ok(Object.isFrozen(resources));
for (const call of resourceMock.calls) assertTenantPredicate(call, "tenant-a");

const connectionRow = {
  connection_id: "connection-a",
  user_id: "user-a",
  tenant_id: "tenant-a",
  app_key: "wordpress",
  display_label: "WordPress A",
  auth_type: "api_key",
  credential_ref: "credential-ref-a",
  token_expires_at: null,
  scopes_granted: JSON.stringify(["read", "write"]),
  account_label: "Account A",
  account_metadata: JSON.stringify({ accountRef: "account-a" }),
  api_base_url: "https://example.invalid",
  is_primary: 1,
  status: "active",
  validation_status: "valid",
  last_validated_at: "2026-01-02T00:00:00.000Z",
  connected_at: "2026-01-01T00:00:00.000Z",
  last_used_at: null,
  link_id: "link-a",
  workspace_id: "workspace-a",
  workspace_key: "workspace-a-key",
  permission_mode: "strict",
  link_status: "active",
};
const grantRow = {
  grant_id: "action-grant-a",
  connection_id: "connection-a",
  workspace_id: "workspace-a",
  agent_id: null,
  app_key: "wordpress",
  action_key: "post.publish",
  grant_mode: "explicit",
  granted_by: "user-a",
  expires_at: null,
  status: "active",
  created_at: "2026-01-02T00:00:00.000Z",
};
const connectionMock = createPool((sql) => {
  if (sql.includes("FROM user_app_connections")) return [connectionRow];
  if (sql.includes("FROM app_action_grants")) return [grantRow];
  throw new Error(`Unexpected SQL: ${sql}`);
});
const connectionRepository = createExactConnectionRepository({ pool: connectionMock.pool });
assertExactConnectionRepository(connectionRepository);
const connection = await connectionRepository.findExactConnection({
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
  connectionRef: "connection-a",
  appKey: "wordpress",
  actionKey: "post.publish",
  userRef: "user-a",
});
assert.equal(connection.connectionRef, "connection-a");
assert.equal(connection.scopesGranted[1], "write");
assert.equal(connection.actionGrant.grantMode, "explicit");
assertTenantPredicate(connectionMock.calls[0], "tenant-a");
assert.ok(connectionMock.calls[0].params.includes("workspace-a"));
assert.ok(connectionMock.calls[0].params.includes("connection-a"));
for (const call of connectionMock.calls) {
  assertTenantPredicate(call, "tenant-a");
  assert.doesNotMatch(call.sql, /encrypted_credentials/i);
}

const duplicateConnectionMock = createPool((sql) => {
  if (sql.includes("FROM user_app_connections")) return [connectionRow, { ...connectionRow, link_id: "link-b" }];
  return [];
});
await assertRejectCode(
  () => createExactConnectionRepository({ pool: duplicateConnectionMock.pool }).findExactConnection({
    tenantRef: "tenant-a",
    workspaceRef: "workspace-a",
    connectionRef: "connection-a",
  }),
  "exact_connection_ambiguous",
);

const readinessRow = {
  capability_key: "wordpress.post.publish",
  display_name: "Publish post",
  capability_family: "wordpress",
  source_table: "actions",
  source_key: "post.publish",
  operation_class: "mutation",
  risk_class: "high",
  runtime_status: "active",
  exposure_scope: "tenant",
  authority_requirement_type: "combined",
  resource_authority_required: 1,
  discoverable: 1,
  registered: 1,
  exported: 1,
  routable: 1,
  authority_model_ready: 1,
  resource_binding_ready: 1,
  dispatchable: 1,
  applyable: 1,
  readback_contract_ready: 1,
  certified: 1,
  provenance_ready: 1,
  evidence_linked: 1,
  dispatch_allowed: 1,
  apply_allowed: 0,
  requires_audit_evidence: 1,
  requires_readback: 1,
  legacy_evidence_ref: null,
  hard_block_count: 0,
};
const manifestRow = {
  manifest_id: "manifest-a",
  run_id: "run-a",
  capability_key: "wordpress.post.publish",
  manifest_version: 2,
  manifest_hash: "manifest-hash",
  source_revision_hash: "source-hash",
  compiler_version: "compiler-v1",
  effect_class: "write",
  risk_class: "H",
  authority_requirement_type: "combined",
  status: "shadow_ready",
  rollout_mode: "shadow",
  created_at: "2026-01-03T00:00:00.000Z",
};
const readinessMock = createPool((sql) => {
  if (sql.includes("v_platform_capability_readiness_vector")) return [readinessRow];
  if (sql.includes("platform_capability_compiled_manifests")) return [manifestRow];
  throw new Error(`Unexpected SQL: ${sql}`);
});
const readinessRepository = createCapabilityReadinessRepository({ pool: readinessMock.pool });
assertCapabilityReadinessRepository(readinessRepository);
const readiness = await readinessRepository.findCapabilityReadiness({
  capabilityKey: "wordpress.post.publish",
});
assert.equal(readiness.dispatchAllowed, true);
assert.equal(readiness.applyAllowed, false);
assert.equal(readiness.currentManifest.manifestVersion, 2);
for (const call of readinessMock.calls) {
  assert.doesNotMatch(call.sql, /manifest_json/i);
}

const pinRow = {
  resolution_id: "pin-a",
  request_id: "request-a",
  idempotency_key: "idem-a",
  principal_type: "user",
  principal_id: "user-a",
  tenant_id: "tenant-a",
  target_container_id: "container-a",
  mode: "shadow",
  decision: "allow",
  authority_epoch: 7,
  resolver_version: "resolver-v1",
  request_sha256: "request-hash",
  container_path_hash: "path-hash",
  registry_snapshot_hash: "registry-hash",
  resolution_sha256: "resolution-hash",
  provider_call_made: 0,
  credential_payload_read: 0,
  secrets_included: 0,
  expires_at: "2030-01-01T00:00:00.000Z",
  created_at: "2026-01-01T00:00:00.000Z",
};
const pinMock = createPool((sql) => {
  if (sql.includes("container_effective_context_ledger")) return [pinRow];
  throw new Error(`Unexpected SQL: ${sql}`);
});
const pinRepository = createContextPinRepository({ pool: pinMock.pool });
assertContextPinRepository(pinRepository);
const pin = await pinRepository.findContextPin({
  tenantRef: "tenant-a",
  pinRef: "pin-a",
  principalType: "user",
  principalRef: "user-a",
});
assert.equal(pin.verified, true);
assert.equal(pin.contextRevision, "resolution-hash");
assertTenantPredicate(pinMock.calls[0], "tenant-a");
assert.doesNotMatch(pinMock.calls[0].sql, /request_context_json/i);
assert.doesNotMatch(pinMock.calls[0].sql, /effective_bindings_json/i);
await assertRejectCode(() => pinRepository.createPin({}), "context_pin_write_unsupported");
await assertRejectCode(() => pinRepository.invalidatePin({}), "context_pin_invalidation_unsupported");

const planRow = {
  plan_id: "plan-a",
  tenant_id: "tenant-a",
  workspace_id: "workspace-a",
  workspace_key: "workspace-a-key",
  user_id: "user-a",
  actor_id: "user-a",
  actor_type: "user",
  brand_id: "brand-a",
  brand_key: "brand-a-key",
  resolution_id: "pin-a",
  intent_key: "wordpress.post.publish",
  request_id: "request-a",
  session_id: "session-a",
  conversation_id: "conversation-a",
  correlation_id: "correlation-a",
  target_key: "post-a",
  workflow_key: "workflow-a",
  workflow_id: "workflow-ref-a",
  agent_id: null,
  route_key: "route-a",
  service_mode: "managed",
  access_decision: "REQUIRE_REVIEW",
  plan_status: "validated",
  runtime_status: "ready",
  has_steps: 1,
  has_preview: 1,
  has_validation_errors: 0,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
};
const eventRow = {
  plan_event_id: "event-a",
  plan_id: "plan-a",
  plan_step_id: "step-a",
  tenant_id: "tenant-a",
  event_type: "validated",
  from_status: "draft",
  to_status: "validated",
  actor_id: "user-a",
  created_at: "2026-01-02T00:00:00.000Z",
};
const ledgerMock = createPool((sql) => {
  if (sql.includes("FROM execution_plans")) return [planRow];
  if (sql.includes("FROM execution_plan_events")) return [eventRow];
  throw new Error(`Unexpected SQL: ${sql}`);
});
const ledgerRepository = createExecutionLedgerRepository({ pool: ledgerMock.pool });
assertExecutionLedgerRepository(ledgerRepository);
const plan = await ledgerRepository.findExecutionPlan({ tenantRef: "tenant-a", planRef: "plan-a" });
const events = await ledgerRepository.listExecutionEvents({
  tenantRef: "tenant-a",
  planRef: "plan-a",
  limit: 999,
});
assert.equal(plan.hasSteps, true);
assert.equal(plan.hasValidationErrors, false);
assert.equal(events[0].eventType, "validated");
assert.match(ledgerMock.calls[1].sql, /LIMIT 500/);
for (const call of ledgerMock.calls) {
  assertTenantPredicate(call, "tenant-a");
  assert.doesNotMatch(call.sql, /execution_context_json/i);
  assert.doesNotMatch(call.sql, /evidence_json/i);
}
await assertRejectCode(() => ledgerRepository.appendExecutionEvent({}), "execution_ledger_write_unsupported");

await assert.rejects(
  () => authorizedRepository.findAuthorizedScope({ tenantRef: "", userRef: "user-a" }),
  TypeError,
);

console.log("context kernel registry adapter tests passed");
