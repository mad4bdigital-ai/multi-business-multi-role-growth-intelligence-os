import assert from "node:assert/strict";
import { stableOperationHash } from "./operationRegistryContracts.js";
import { buildOperationCapabilityAuthorityContext } from "./operationCapabilityAuthorityContext.js";
import {
  buildCapabilityRenewalRequest,
  finalizeOperationCapabilityLifecycle,
  prepareOperationCapabilityLifecycle,
} from "./operationCapabilityLifecycleService.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

function reports({ source = "sql_operation_registry", mode = "apply", effectClass = "repository_mutation" } = {}) {
  const bindingSnapshot = {
    app_key: "platform_orchestration",
    capability_key: "repository_write",
    operation_intent: "repository_change_apply",
    runtime_surface: "repository_change_runtime",
    requested_source_tier: "managed",
    secrets_included: false,
  };
  const bindingHash = stableOperationHash(bindingSnapshot);
  const contract = {
    operation_key: "repo.change.execute",
    version: 1,
    revision_hash: HASH_A,
    definition: { operation_key: "repo.change.execute", version: 1 },
  };
  return {
    contract_resolution: {
      ok: true,
      resolution_source: source,
      fallback_used: source !== "sql_operation_registry",
      contract,
    },
    authority_preflight: {
      ok: true,
      preflight_status: "ready_for_governed_authority_handoff",
      capability_shadow: {
        capability_key: "repository_write",
        requested_mode: mode,
        manifest: { effect_class: effectClass },
      },
    },
    revision_pin: {
      record: {
        run_id: "11111111-1111-4111-8111-111111111111",
        operation_key: "repo.change.execute",
        operation_version: 1,
        manifest_hash: HASH_B,
        source_revision_hash: HASH_C,
        revisions: [
          { revision_type: "contract", revision_key: "repo.change.execute.v1", revision_hash: HASH_A, snapshot: contract.definition },
          { revision_type: "binding", revision_key: "repository-write", revision_hash: bindingHash, snapshot: bindingSnapshot },
        ],
      },
    },
  };
}

{
  const context = buildOperationCapabilityAuthorityContext(reports());
  assert.equal(context.requires_capability, true);
  assert.equal(context.operation_key, "repo.change.execute");
  assert.equal(context.profile.capability_key, "repository_write");
  assert.equal(context.profile.operation_intent, "repository_change_apply");
  assert.equal(context.profile.runtime_surface, "repository_change_runtime");
  assert.match(context.binding_sha256, /^[0-9a-f]{64}$/);
  assert.match(context.capability_sha256, /^[0-9a-f]{64}$/);
  assert.equal(context.runtime_dispatch_authorized, false);
  assert.equal(Object.isFrozen(context), true);
}

assert.throws(
  () => buildOperationCapabilityAuthorityContext(reports({ source: "legacy_code_registry" })),
  (error) => error.code === "operation_capability_legacy_fallback_cannot_authorize_mutation",
);

{
  const context = buildOperationCapabilityAuthorityContext(reports());
  let resolvedArgs = null;
  const result = await prepareOperationCapabilityLifecycle({
    pool: {},
    auth: { tenant_id: "tenant-1", user_id: "user-1" },
    input: { capability_envelope_id: "existing-envelope" },
    operationKey: "repo.change.execute",
    authorityContext: context,
    resolveEnvelope: async (args) => {
      resolvedArgs = args;
      return {
        ok: true,
        envelope_id: "existing-envelope",
        app_key: "platform_orchestration",
        capability_key: "repository_write",
        operation_intent: "repository_change_apply",
        selected_runtime_surface: "repository_change_runtime",
      };
    },
  });
  assert.equal(result.status, "ready");
  assert.deepEqual(resolvedArgs.acceptedCapabilityKeys, ["repository_write"]);
  assert.deepEqual(resolvedArgs.acceptedIntents, ["repository_change_apply"]);
  assert.equal(result.authority_context.run_id, context.run_id);
}

{
  const context = buildOperationCapabilityAuthorityContext(reports());
  let renewalRequest = null;
  let verificationCalls = 0;
  const result = await prepareOperationCapabilityLifecycle({
    pool: {},
    auth: { tenant_id: "tenant-1", user_id: "user-1" },
    input: {},
    operationKey: "repo.change.execute",
    authorityContext: context,
    createEnvelope: async (request) => {
      renewalRequest = request;
      return {
        ok: true,
        envelope_id: "renewed-envelope",
        envelope_status: "ready_for_dispatch",
        decision: "ready_for_dispatch",
        dispatch_allowed: true,
        approval_required: false,
        blocking_gap_count: 0,
      };
    },
    resolveEnvelope: async () => {
      verificationCalls += 1;
      return {
        ok: true,
        envelope_id: "renewed-envelope",
        app_key: "platform_orchestration",
        capability_key: "repository_write",
        operation_intent: "repository_change_apply",
        selected_runtime_surface: "repository_change_runtime",
      };
    },
  });
  assert.equal(result.status, "renewed_ready");
  assert.equal(verificationCalls, 1);
  assert.ok(renewalRequest.passthrough.includes("repository_write"));
  assert.ok(renewalRequest.passthrough.includes("repository_change_apply"));
  assert.ok(renewalRequest.passthrough.includes("repository_change_runtime"));
}

{
  const context = buildOperationCapabilityAuthorityContext(reports());
  const request = buildCapabilityRenewalRequest({
    operationKey: "repo.change.execute",
    authorityContext: context,
    input: {},
  });
  assert.ok(request.passthrough.includes("repository_write"));
  assert.ok(request.passthrough.includes("repository_change_apply"));
  assert.ok(request.passthrough.includes("repository_change_runtime"));
}

{
  let transition = null;
  const result = await finalizeOperationCapabilityLifecycle({
    pool: {},
    lifecycle: { required: true, status: "ready", source: "existing", operation_key: "repo.change.execute", envelope_id: "envelope-1" },
    result: { ok: true, run_id: "run-1" },
    transitionEnvelope: async (args) => {
      transition = args;
      return { ok: true, status: "capability_resolution_envelope_consumed" };
    },
  });
  assert.equal(result.status, "consumed");
  assert.equal(transition.action, "consume");
  assert.equal(transition.executionRef, "operation_run:run-1");
}

{
  const retained = await finalizeOperationCapabilityLifecycle({
    lifecycle: { required: true, envelope_id: "envelope-1", source: "existing" },
    result: { ok: false, status: "blocked" },
    transitionEnvelope: async () => { throw new Error("must not transition"); },
  });
  assert.equal(retained.status, "retained_for_bounded_retry");
}

console.log("operation capability authority context tests passed");
