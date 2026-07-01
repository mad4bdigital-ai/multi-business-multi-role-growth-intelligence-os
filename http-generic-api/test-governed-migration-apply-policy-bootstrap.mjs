import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  bootstrapGovernedMigrationApplyPolicy,
  governedMigrationApplyPolicyBootstrapConfirmation,
  GOVERNED_MIGRATION_EXECUTE_APPLY_POLICY,
} from "./governedMigrationApplyPolicyBootstrap.js";

let policyRow = null;
let insertCount = 0;
let referencedEnvelope = null;

const fakePool = {
  async query(sql, params = []) {
    if (/SELECT[\s\S]+FROM capability_apply_authorization_policy_registry/i.test(sql)) {
      return [policyRow ? [policyRow] : []];
    }
    if (/INSERT INTO capability_apply_authorization_policy_registry/i.test(sql)) {
      insertCount += 1;
      const [
        policyKey,
        appKey,
        capabilityKey,
        operationIntent,
        runtimeSurface,
        allowedSourceTiersJson,
        policyJson,
        notes,
      ] = params;
      policyRow = {
        policy_key: policyKey,
        app_key: appKey,
        capability_key: capabilityKey,
        operation_intent: operationIntent,
        runtime_surface: runtimeSurface,
        status: "active",
        allow_external_write: 0,
        allow_credential_binding: 0,
        allow_no_credential_binding: 1,
        requires_ready_for_dispatch: 1,
        requires_dispatch_allowed: 1,
        requires_zero_blocking_gaps: 1,
        requires_audit_evidence: 1,
        requires_readback: 1,
        requires_typed_confirmation: 1,
        requires_same_cycle_dry_run: 1,
        allowed_source_tiers_json: allowedSourceTiersJson,
        policy_json: policyJson,
        notes,
        created_at: "2026-06-30T00:00:00.000Z",
        updated_at: "2026-06-30T00:00:00.000Z",
      };
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL in test: ${sql}`);
  },
};

const resolveEnvelope = async ({ source, acceptedAppKeys, acceptedIntents }) => {
  assert.equal(source.capability_envelope_id, "env-policy-bootstrap-1");
  assert.deepEqual(acceptedAppKeys, ["platform_orchestration"]);
  assert(acceptedIntents.includes("governed_migration_apply_policy_bootstrap"));
  return { ok: true, envelope_id: "env-policy-bootstrap-1" };
};
const markReferenced = async ({ envelopeId, executionRef }) => {
  referencedEnvelope = { envelopeId, executionRef };
};

const input = {
  confirm: governedMigrationApplyPolicyBootstrapConfirmation(),
  decision_note: "Authorize the one fixed governed migration execution apply policy after reviewed bootstrap deployment.",
  capability_envelope_id: "env-policy-bootstrap-1",
};

const created = await bootstrapGovernedMigrationApplyPolicy(input, {
  pool: fakePool,
  auth: { tenant_id: "00000000-0000-0000-0000-000000000000", user_id: "admin-user" },
  resolveEnvelope,
  markReferenced,
});
assert.equal(created.ok, true);
assert.equal(created.policy_created, true);
assert.equal(created.idempotent, false);
assert.equal(insertCount, 1);
assert.equal(created.policy.policy_key, "governed_migration_execute_apply_v1");
assert.equal(created.policy.capability_key, "governed_migration_execute");
assert.equal(created.policy.runtime_surface, "auth_host");
assert.deepEqual(created.policy.allowed_source_tiers_json, ["platform_managed_fallback"]);
assert.equal(created.policy.policy_json.governed_runner_only, true);
assert.equal(created.provider_call_executed, false);
assert.equal(created.external_write_executed, false);
assert.equal(created.secrets_included, false);
assert.deepEqual(referencedEnvelope, {
  envelopeId: "env-policy-bootstrap-1",
  executionRef: "capability_apply_policy:governed_migration_execute_apply_v1",
});

const idempotent = await bootstrapGovernedMigrationApplyPolicy(input, {
  pool: fakePool,
  auth: { tenant_id: "00000000-0000-0000-0000-000000000000", user_id: "admin-user" },
  resolveEnvelope,
  markReferenced,
});
assert.equal(idempotent.policy_created, false);
assert.equal(idempotent.idempotent, true);
assert.equal(insertCount, 1);

await assert.rejects(
  () => bootstrapGovernedMigrationApplyPolicy({ ...input, runtime_surface: "custom" }, {
    pool: fakePool,
    resolveEnvelope,
    markReferenced,
  }),
  (error) => error.code === "governed_migration_apply_policy_unknown_input"
);
await assert.rejects(
  () => bootstrapGovernedMigrationApplyPolicy({ ...input, confirm: "WRONG" }, {
    pool: fakePool,
    resolveEnvelope,
    markReferenced,
  }),
  (error) => error.code === "governed_migration_apply_policy_confirmation_required"
);

assert.equal(GOVERNED_MIGRATION_EXECUTE_APPLY_POLICY.allow_external_write, 0);
assert.equal(GOVERNED_MIGRATION_EXECUTE_APPLY_POLICY.allow_credential_binding, 0);
assert.equal(GOVERNED_MIGRATION_EXECUTE_APPLY_POLICY.allow_no_credential_binding, 1);
assert.equal(GOVERNED_MIGRATION_EXECUTE_APPLY_POLICY.requires_same_cycle_dry_run, 1);

const moduleSource = readFileSync("governedMigrationApplyPolicyBootstrap.js", "utf8");
const routeSource = readFileSync("routes/gptToolsRoutes.js", "utf8");
assert(routeSource.includes('name: "governed_migration_apply_policy_bootstrap"'));
assert(routeSource.includes("bootstrapGovernedMigrationApplyPolicy"));
assert(routeSource.includes('const: "BOOTSTRAP_GOVERNED_MIGRATION_EXECUTE_APPLY_POLICY"'));
assert(routeSource.includes('"no_provider_call", "no_external_write", "no_secrets"'));
assert.doesNotMatch(moduleSource, /fetch\(|axios|child_process|exec\(|spawn\(/i);
assert.doesNotMatch(moduleSource, /api[_-]?key|client_secret|refresh_token|private_key/i);

console.log("governed migration apply policy bootstrap tests passed");
