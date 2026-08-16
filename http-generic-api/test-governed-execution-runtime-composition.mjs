import assert from "node:assert/strict";
import test from "node:test";

import {
  GOVERNED_EXECUTION_RUNTIME_CONTRACT_CHAIN,
  createGovernedExecutionRuntimeResolver,
} from "./governedExecutionRuntimeComposition.js";

function buildDependencies({ overrides = {}, calls = [] } = {}) {
  const base = {
    async resolveContext({ request }) {
      calls.push("context_kernel");
      assert.equal(request.tenant_id, "caller-tenant-override");
      return {
        tenant_id: "tenant-authoritative",
        workspace_id: "workspace-authoritative",
        context_hash: "context-hash-1",
        context_revision: "context-revision-1",
        access_token: "must-not-project",
      };
    },
    async compileCapabilityManifest({ request, context }) {
      calls.push("capability_manifest");
      assert.equal(request.tenant_id, undefined, "caller tenant identity must not flow downstream");
      assert.equal(context.tenant_id, "tenant-authoritative");
      return {
        context_hash: "context-hash-1",
        manifest_revision: "manifest-revision-1",
        capabilities: [{ capability_key: "repo.read", available: true }],
      };
    },
    async resolveAuthorityPreflight({ context }) {
      calls.push("authority_preflight");
      assert.equal(context.tenant_id, "tenant-authoritative");
      return {
        context_hash: "context-hash-1",
        preflight_id: "preflight-1",
        decision: "allow",
        allowed: true,
        authority_revision: "authority-preflight-revision-1",
      };
    },
    async compilePlan() {
      calls.push("plan");
      return {
        context_hash: "context-hash-1",
        plan_id: "plan-1",
        status: "ready",
        effect: "read_only",
        readback_required: true,
      };
    },
    async resolveApprovalOrDelegation() {
      calls.push("approval_or_delegation");
      return {
        context_hash: "context-hash-1",
        status: "not_required",
      };
    },
    async resolveFinalAuthority() {
      calls.push("final_authority");
      return {
        context_hash: "context-hash-1",
        authoritative: true,
        allowed: true,
        decision: "allow",
        enforcement_mode: "authoritative",
        authority_revision: "authority-final-revision-1",
        password: "must-not-project",
      };
    },
    async resolveLifecycleReadiness() {
      calls.push("track_b_readiness");
      return {
        ready: true,
        readiness_status: "ready_for_review",
        runtime_consumer_enabled: false,
        migration_applied: false,
        database_mutated: false,
        provider_called: false,
        secrets_included: false,
      };
    },
    async resolveDurableExecutionReadiness() {
      calls.push("durable_execution");
      return {
        ready: true,
        status: "ready",
        execution_id: "execution-readiness-1",
        execution_performed: false,
      };
    },
    async resolveAdapterReadiness() {
      calls.push("adapter");
      return {
        ready: true,
        status: "ready",
        adapter_key: "repository-read-adapter",
        revision: "adapter-revision-1",
      };
    },
    async resolveReadbackReadiness() {
      calls.push("readback");
      return {
        ready: true,
        verified: true,
        status: "verified",
        readback_revision: "readback-revision-1",
      };
    },
  };
  return { ...base, ...overrides };
}

const readRequest = Object.freeze({
  tenant_id: "caller-tenant-override",
  workspace_id: "caller-workspace-override",
  operation: "repository.inspect",
  capability_key: "repo.read",
  requested_effect: "read_only",
  authorization: "Bearer should-never-project",
});

test("read-only composition follows the canonical chain and emits no execution grant", async () => {
  const calls = [];
  const resolver = createGovernedExecutionRuntimeResolver(buildDependencies({ calls }));
  const result = await resolver(readRequest);

  assert.equal(result.surface_ready, true);
  assert.equal(result.readiness.ready, true);
  assert.equal(result.final_authority.authoritative, true);
  assert.equal(result.final_authority.allowed, true);
  assert.equal(result.context.tenant_id, "tenant-authoritative");
  assert.equal(result.context.access_token, undefined);
  assert.equal(result.final_authority.password, undefined);
  assert.equal(result.executes_provider, false);
  assert.equal(result.execution_performed, false);
  assert.equal(result.mutation_cutover_authorized, false);
  assert.equal(result.selects_connection, false);
  assert.equal(result.creates_authority, false);
  assert.equal(result.secrets_included, false);
  assert.deepEqual(result.stage_trace, [
    "context_kernel",
    "capability_manifest",
    "authority_preflight",
    "plan",
    "approval_or_delegation",
    "final_authority",
    "track_b_readiness",
    "durable_execution",
    "adapter",
    "readback",
  ]);
  assert.deepEqual(calls, result.stage_trace);
  assert.deepEqual(GOVERNED_EXECUTION_RUNTIME_CONTRACT_CHAIN, [
    "context_kernel",
    "capability_manifest",
    "authority_preflight",
    "plan",
    "approval_or_delegation",
    "final_authority",
    "durable_execution",
    "adapter",
    "readback",
    "surface_projection",
  ]);
});

test("shadow authority cannot become final authority or reach durable/adapter/readback readiness", async () => {
  const calls = [];
  const dependencies = buildDependencies({
    calls,
    overrides: {
      async resolveFinalAuthority() {
        calls.push("final_authority");
        return {
          context_hash: "context-hash-1",
          authoritative: false,
          allowed: true,
          decision: "allow",
          enforcement_mode: "shadow_only",
          legacy_runtime_authoritative: true,
        };
      },
    },
  });
  const result = await createGovernedExecutionRuntimeResolver(dependencies)(readRequest);

  assert.equal(result.surface_ready, false);
  assert.ok(result.blockers.some((entry) => entry.code === "FINAL_AUTHORITY_NOT_AUTHORITATIVE"));
  assert.equal(result.durable_execution, null);
  assert.equal(result.adapter, null);
  assert.equal(result.readback, null);
  assert.equal(calls.includes("durable_execution"), false);
  assert.equal(calls.includes("adapter"), false);
  assert.equal(calls.includes("readback"), false);
});

test("mutation cutover remains fail-closed even with explicit authority and approval", async () => {
  const calls = [];
  const dependencies = buildDependencies({
    calls,
    overrides: {
      async resolveApprovalOrDelegation() {
        calls.push("approval_or_delegation");
        return {
          context_hash: "context-hash-1",
          status: "approved",
          approval_id: "approval-1",
        };
      },
    },
  });
  const result = await createGovernedExecutionRuntimeResolver(dependencies)({
    ...readRequest,
    requested_effect: "mutation",
  });

  assert.equal(result.surface_ready, false);
  assert.equal(result.mutation_cutover_authorized, false);
  assert.ok(result.blockers.some((entry) => entry.code === "TRACK_A_MUTATION_CUTOVER_NOT_AUTHORIZED"));
  assert.ok(result.blockers.some((entry) => entry.code === "TRACK_B_RUNTIME_CONSUMER_DISABLED"));
  assert.equal(result.durable_execution, null);
  assert.equal(result.adapter, null);
  assert.equal(result.readback, null);
});

test("context hash drift fails closed", async () => {
  const calls = [];
  const dependencies = buildDependencies({
    calls,
    overrides: {
      async compileCapabilityManifest() {
        calls.push("capability_manifest");
        return {
          context_hash: "different-context-hash",
          manifest_revision: "manifest-revision-2",
          capabilities: [{ capability_key: "repo.read", available: true }],
        };
      },
    },
  });
  const result = await createGovernedExecutionRuntimeResolver(dependencies)(readRequest);

  assert.equal(result.surface_ready, false);
  assert.ok(result.blockers.some((entry) => entry.code === "CONTEXT_HASH_MISMATCH"));
});

test("side-effect evidence in a readiness dependency blocks projection", async () => {
  const calls = [];
  const dependencies = buildDependencies({
    calls,
    overrides: {
      async resolveAdapterReadiness() {
        calls.push("adapter");
        return {
          ready: true,
          status: "ready",
          adapter_key: "unsafe-adapter",
          provider_called: true,
        };
      },
    },
  });
  const result = await createGovernedExecutionRuntimeResolver(dependencies)(readRequest);

  assert.equal(result.surface_ready, false);
  assert.ok(result.blockers.some((entry) => entry.code === "PROVIDER_CALL_OBSERVED"));
  assert.equal(result.executes_provider, false);
});

test("missing composition dependency fails closed with bounded evidence", async () => {
  const dependencies = buildDependencies();
  delete dependencies.resolveFinalAuthority;
  const result = await createGovernedExecutionRuntimeResolver(dependencies)(readRequest);

  assert.equal(result.surface_ready, false);
  assert.equal(result.final_authority, null);
  assert.ok(result.blockers.some((entry) => entry.code === "COMPOSITION_DEPENDENCY_MISSING" && entry.dependency === "resolveFinalAuthority"));
  assert.equal(result.secrets_included, false);
});
