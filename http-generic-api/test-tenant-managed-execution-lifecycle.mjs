import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertManagedExecutionApprovalAuthority,
  assertManagedExecutionPayloadSecretFree,
  assertManagedExecutionStepEligibility,
  assertManagedExecutionTransition,
  buildManagedAuthoritySnapshot,
  normalizeManagedExecutionEnvelope,
  projectManagedExecutionState,
  resolveManagedExecutionAuthority,
  resolveManagedExecutionGate,
} from "./managedExecutionLifecycleService.js";

const base = {
  tenant_id: "tenant-1",
  user_id: "user-1",
  parent_ticket_id: "ticket-parent",
  workflow_key: "wordpress_health_check",
  capability_key: "tenant_tool.wordpress_health_check",
  resource_type: "site",
  resource_ref: "site:wovacation.com",
  effect_class: "read_only",
  idempotency_key: "request-12345678",
  input_json: { mode: "dry_run" },
};

const envelope = normalizeManagedExecutionEnvelope(base);
assert.equal(envelope.capability_key, base.capability_key);
assert.equal(envelope.policy.risk_level, "low");
assert.throws(
  () => normalizeManagedExecutionEnvelope({ ...base, capability_key: "" }),
  (error) => error.code === "managed_execution_missing_field",
);
assert.throws(
  () =>
    normalizeManagedExecutionEnvelope({
      ...base,
      input_json: { api_token: "value" },
    }),
  (error) => error.code === "managed_execution_secret_field_rejected",
);
assert.throws(
  () =>
    assertManagedExecutionPayloadSecretFree({
      value: "Bearer abc.def.ghi",
    }),
  (error) => error.code === "managed_execution_secret_value_rejected",
);

const readGate = resolveManagedExecutionGate({
  access_decision: "ALLOW_SELF_SERVE",
  effect_class: "read_only",
});
assert.equal(readGate.requires_approval, false);
assert.equal(
  resolveManagedExecutionGate({
    access_decision: "ALLOW_SELF_SERVE",
    effect_class: "destructive",
  }).hold_type,
  "supervisor_approval",
);
assert.equal(
  resolveManagedExecutionGate({
    access_decision: "ROUTE_TO_MANAGED_SERVICE",
    effect_class: "read_only",
  }).hold_type,
  "managed_handoff",
);

function authorityConnection({
  permission = "operate",
  dispatchAllowed = 1,
  runtimeStatus = "certified",
} = {}) {
  return {
    async query(sql) {
      if (sql.includes("v_platform_capabilities_effective_evidence")) {
        return [
          [
            {
              capability_key: base.capability_key,
              operation_class: "diagnostic",
              risk_class: "low",
              runtime_status: runtimeStatus,
              exposure_scope: "tenant",
              resource_authority_required: 1,
              dispatch_allowed: dispatchAllowed,
              apply_allowed: 1,
              requires_audit_evidence: 1,
              requires_readback: 1,
              evidence_ref:
                "tool_dispatch_binding:binding-1:readback:wordpress-health",
            },
          ],
        ];
      }
      if (sql.includes("v_workspace_resource_grant_effective")) {
        return [
          [
            {
              grant_id: "grant-1",
              tenant_id: base.tenant_id,
              grantee_user_id: base.user_id,
              resource_type: base.resource_type,
              resource_ref: base.resource_ref,
              permission,
              grant_status: "active",
              source: "owner_assignment",
              granted_by: "owner-1",
              granted_at: "2026-08-01T00:00:00Z",
              expires_at: null,
            },
          ],
        ];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

const authority = await resolveManagedExecutionAuthority({
  connection: authorityConnection(),
  envelope,
});
assert.equal(authority.resource_grant.grant_id, "grant-1");
assert.equal(authority.resource_grant.exact_resource, true);
await assert.rejects(
  resolveManagedExecutionAuthority({
    connection: authorityConnection({ dispatchAllowed: 0 }),
    envelope,
  }),
  (error) => error.code === "managed_execution_capability_dispatch_blocked",
);
await assert.rejects(
  resolveManagedExecutionAuthority({
    connection: authorityConnection({ permission: "view" }),
    envelope: normalizeManagedExecutionEnvelope({
      ...base,
      effect_class: "destructive",
    }),
  }),
  (error) => error.code === "managed_execution_resource_grant_required",
);

const snapshot = buildManagedAuthoritySnapshot({
  envelope,
  access: {
    decision: "ALLOW_SELF_SERVE",
    reason: "low_risk_self_serve",
    service_mode: "self_serve",
    plan_key: "growth",
    resolved_at: "2026-08-02T05:00:00.000Z",
  },
  gate: readGate,
  authority,
});
assert.match(snapshot.fingerprint_sha256, /^[a-f0-9]{64}$/);
assert.equal(snapshot.resource_grant.permission, "operate");
assert.equal(snapshot.secrets_included, false);

const managedRun = {
  run_id: "run-1",
  status: "pending",
  execution_context_json: JSON.stringify({
    contract: "tenant-managed-execution-v1",
    authority_snapshot: snapshot,
  }),
};
assert.equal(
  assertManagedExecutionStepEligibility({ run: managedRun, holds: [] })
    .allowed,
  true,
);
const approvalSnapshot = buildManagedAuthoritySnapshot({
  envelope: normalizeManagedExecutionEnvelope({
    ...base,
    effect_class: "destructive",
  }),
  access: {
    decision: "ALLOW_SELF_SERVE",
    service_mode: "self_serve",
  },
  gate: resolveManagedExecutionGate({
    access_decision: "ALLOW_SELF_SERVE",
    effect_class: "destructive",
  }),
  authority,
});
assert.throws(
  () =>
    assertManagedExecutionStepEligibility({
      run: {
        ...managedRun,
        status: "running",
        execution_context_json: JSON.stringify({
          contract: "tenant-managed-execution-v1",
          authority_snapshot: approvalSnapshot,
        }),
      },
      holds: [],
    }),
  (error) => error.code === "managed_execution_approval_evidence_missing",
);
assert.equal(
  assertManagedExecutionStepEligibility({
    run: {
      ...managedRun,
      status: "running",
      execution_context_json: JSON.stringify({
        contract: "tenant-managed-execution-v1",
        authority_snapshot: approvalSnapshot,
      }),
    },
    holds: [{ status: "approved" }],
  }).allowed,
  true,
);

function membershipConnection({
  role = "supervisor",
  status = "active",
  duplicate = false,
} = {}) {
  return {
    async query(sql, params) {
      assert(sql.includes("FROM memberships"));
      assert.deepEqual(params, ["tenant-1", "reviewer-1"]);
      const row = {
        user_id: "reviewer-1",
        role,
        status,
      };
      return [duplicate ? [row, row] : [row]];
    },
  };
}

const approvalHold = {
  tenant_id: "tenant-1",
  required_role: "supervisor",
};
await assert.doesNotReject(
  assertManagedExecutionApprovalAuthority({
    connection: membershipConnection(),
    hold: approvalHold,
    decisionBy: "reviewer-1",
  }),
);
await assert.doesNotReject(
  assertManagedExecutionApprovalAuthority({
    connection: membershipConnection({ role: "owner" }),
    hold: approvalHold,
    decisionBy: "reviewer-1",
  }),
);
await assert.doesNotReject(
  assertManagedExecutionApprovalAuthority({
    connection: {
      async query() {
        throw new Error("platform admin authority must not query tenant membership");
      },
    },
    hold: approvalHold,
    decisionBy: "backend_api_key",
  }),
);
await assert.rejects(
  assertManagedExecutionApprovalAuthority({
    connection: membershipConnection({ role: "certified_reviewer" }),
    hold: approvalHold,
    decisionBy: "reviewer-1",
  }),
  (error) => error.code === "managed_execution_approval_role_required",
);
await assert.rejects(
  assertManagedExecutionApprovalAuthority({
    connection: membershipConnection({ status: "disabled" }),
    hold: approvalHold,
    decisionBy: "reviewer-1",
  }),
  (error) =>
    error.code ===
    "managed_execution_approval_active_membership_required",
);
await assert.rejects(
  assertManagedExecutionApprovalAuthority({
    connection: membershipConnection({ duplicate: true }),
    hold: approvalHold,
    decisionBy: "reviewer-1",
  }),
  (error) =>
    error.code === "managed_execution_approval_membership_ambiguous",
);

assert.equal(
  assertManagedExecutionTransition({
    current_status: "pending",
    next_status: "running",
  }),
  true,
);
assert.throws(
  () =>
    assertManagedExecutionTransition({
      current_status: "completed",
      next_status: "running",
    }),
  (error) => error.code === "managed_execution_transition_forbidden",
);
const projection = projectManagedExecutionState({
  run: { run_id: "run-2", status: "completed" },
  holds: [{ status: "open" }],
  steps: [{ status: "running" }],
  binding: {
    task_ticket_id: "task-2",
    lifecycle_state: "verified",
  },
});
assert.equal(projection.lifecycle_state, "reconciliation_required");
assert(
  projection.contradictions.includes("run_active_while_approval_open"),
);
assert(
  projection.contradictions.includes("terminal_run_has_running_steps"),
);

const source = [
  "managedExecutionCore.js",
  "managedExecutionAuthority.js",
  "managedExecutionPersistence.js",
  "managedExecutionRunService.js",
  "managedExecutionDecisionService.js",
  "managedExecutionApprovalAuthorization.js",
  "routes/managedExecutionRouteAuthorization.js",
  "routes/managedExecutionRoutes.js",
]
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");
const wrapper = readFileSync(
  "routes/workflowOrchestrationRoutes.js",
  "utf8",
);
const legacyRoutes = readFileSync(
  "routes/workflowOrchestrationLegacyRoutes.js",
  "utf8",
);
const migration = readFileSync(
  "migrations/1043_sprint69_tenant_managed_execution_lifecycle.sql",
  "utf8",
);

for (const contract of [
  "v_platform_capabilities_effective_evidence",
  "v_workspace_resource_grant_effective",
  "createOrAppendSupportTicketWithIntegrityAtomic",
  "managed_execution_bindings",
  "managed_execution_step_requests",
  "managed_execution_events",
  "assertManagedExecutionAuthorityStillEffective",
  "managed_execution_active_scope_ambiguous",
  "managed_execution_terminal_steps_active",
  "managed_execution_approval_role_required",
  "managed_execution_principal_scope_mismatch",
]) {
  assert(source.includes(contract), `missing runtime contract: ${contract}`);
}

assert(source.includes('router.post("/managed-execution-runs"'));
assert(source.includes("managed_execution_route_required"));
assert(source.includes("approval_authority_verified"));
assert(source.includes("bindCreationScope(req)"));
assert(wrapper.includes("buildManagedExecutionRouteAuthorization"));
assert(wrapper.includes("buildManagedExecutionRoutes"));
assert(wrapper.includes("workflowOrchestrationLegacyRoutes.js"));
assert(!wrapper.includes("workflowOrchestrationRoutesBase.js"));
for (const route of [
  'router.post("/workflow-runs"',
  'router.get("/workflow-runs/:id"',
  'router.get("/tenants/:id/workflow-runs"',
  'router.patch("/workflow-runs/:id/status"',
  'router.post("/workflow-runs/:id/steps"',
  'router.post("/approval-holds/:id/decide"',
]) {
  assert(
    legacyRoutes.includes(route),
    `legacy orchestration route must remain discoverable: ${route}`,
  );
}
for (const table of [
  "managed_execution_bindings",
  "managed_execution_step_requests",
  "managed_execution_events",
  "v_managed_execution_lifecycle_readiness",
]) {
  assert(migration.includes(table), `missing migration contract: ${table}`);
}
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration));

console.log("tenant managed execution lifecycle tests passed");