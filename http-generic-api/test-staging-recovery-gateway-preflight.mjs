// frontend-surface-operation: post /admin/recovery/staging/gateway/rollout-plan
// frontend-surface-operation: post /admin/recovery/staging/gateway/dark-deploy-dry-run

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  normalizeStagingRecoveryGatewayPreflightInput,
  prepareStagingRecoveryGatewayDarkDeployDryRun,
  previewStagingRecoveryGatewayRollout,
  STAGING_RECOVERY_GATEWAY_PREFLIGHT_CONTRACT,
} from "./stagingRecoveryGatewayPreflight.js";

const commit = "a".repeat(40);
const policyHash = "b".repeat(64);
const convergencePlan = "c".repeat(64);
const input = {
  expected_source_commit: commit,
  expected_policy_hash: policyHash,
  environment_convergence_plan_sha256: convergencePlan,
};
const runtimePool = { kind: "runtime" };
const governancePool = { kind: "governance" };
const auth = { mode: "backend_api_key", principal_type: "admin", is_admin: true };

const recoveryPreflightSource = fs.readFileSync(
  new URL("./stagingRecoveryGatewayPreflight.js", import.meta.url),
  "utf8",
);
assert.match(recoveryPreflightSource, /from "\.\/stagingActivationGatewayApplyAdapter\.js"/u);
assert.doesNotMatch(recoveryPreflightSource, /from "\.\/activationGatewayRolloutTool\.js"/u);

test("Gateway preflight rejects caller-selected provider and execution authority", () => {
  for (const forbidden of [
    "account_id",
    "resource_binding_id",
    "script_name",
    "target_key",
    "capability_envelope_id",
    "execution_nonce",
    "confirm",
    "dns_record",
    "custom_domain",
  ]) {
    assert.throws(
      () => normalizeStagingRecoveryGatewayPreflightInput({ ...input, [forbidden]: "caller-value" }),
      (error) => error?.code === "STAGING_RECOVERY_GATEWAY_PREFLIGHT_FIELD_FORBIDDEN"
        && error?.details?.fields?.includes(forbidden),
      forbidden,
    );
  }
});

test("rollout preview is non-persistent and never returns an executable plan identity", async () => {
  let observed = null;
  const result = await previewStagingRecoveryGatewayRollout(input, {
    runtimePool,
    governancePool,
    auth,
    env: { NODE_ENV: "staging" },
    async buildRolloutPlan(args, deps) {
      observed = { args, deps };
      return {
        ok: true,
        adapter: "staging_activation_gateway_profile_apply",
        classification: "staging_activation_gateway_apply_ready",
        apply_ready: true,
        plan_id: "should-not-escape-preview",
        plan_sha256: "d".repeat(64),
        required_confirmation: "should-not-escape-preview",
        profile_binding: { policy_key: "activation_gateway_staging" },
        resource_binding: { binding_id: "server-binding", account_id: "e".repeat(32), script_name: "mad4b-activation-gateway-staging" },
        workspace: { workspace_id: "workspace-server" },
        checks: [{ key: "profile_bound", ok: true }],
      };
    },
  });
  assert.equal(observed.args.mode, "dry_run");
  assert.equal(observed.args.account_id, undefined);
  assert.equal(observed.deps.runtimePool, runtimePool);
  assert.equal(observed.deps.governancePool, governancePool);
  assert.equal(observed.deps.auth, auth);
  assert.equal(result.contract, STAGING_RECOVERY_GATEWAY_PREFLIGHT_CONTRACT);
  assert.equal(result.preflight_ready, true);
  assert.equal(result.apply_ready, false);
  assert.equal(result.execution_plan_issued, false);
  assert.equal(result.execution_plan_identity_returned, false);
  assert.equal(result.plan_id, undefined);
  assert.equal(result.plan_sha256, undefined);
  assert.equal(result.required_confirmation, undefined);
  assert.equal(result.resolved_resource_binding.binding_id, "server-binding");
  assert.equal(result.provider_target_caller_selectable, false);
  assert.equal(result.governance_state_mutation_performed, false);
  assert.equal(result.target_database_mutation_performed, false);
  assert.equal(result.provider_mutation_performed, false);
  assert.equal(result.production_mutation_performed, false);
  assert.equal(result.convergence_binding.server_acknowledgement_verified, false);
  assert.equal(result.convergence_binding.operator_acknowledgement_is_execution_authority, false);
});

test("dark-deploy dry-run may persist only the governed execution plan and never issues apply authority", async () => {
  let observed = null;
  const result = await prepareStagingRecoveryGatewayDarkDeployDryRun(input, {
    runtimePool,
    governancePool,
    auth,
    env: { NODE_ENV: "staging" },
    async runDarkDeploy(args, deps) {
      observed = { args, deps };
      return {
        ok: true,
        tool: "activation_gateway_dark_deploy",
        adapter: "staging_activation_gateway_profile_apply",
        mode: "dry_run",
        apply_ready: true,
        plan_id: "00000000-0000-4000-8000-000000000001",
        plan_sha256: "d".repeat(64),
        required_confirmation: "DEPLOY_STAGING_GATEWAY_AAAAAAAAAAAA_DDDDDDDDDDDD",
        governance_state_mutation: true,
        resource_binding: { binding_id: "server-binding", account_id: "e".repeat(32), script_name: "mad4b-activation-gateway-staging" },
        execution: { will_execute: false, executed: false },
        secrets_included: false,
      };
    },
  });
  assert.equal(observed.args.mode, "dry_run");
  assert.equal(observed.args.account_id, undefined);
  assert.equal(observed.args.resource_binding_id, undefined);
  assert.equal(observed.args.capability_envelope_id, undefined);
  assert.equal(observed.deps.runtimePool, runtimePool);
  assert.equal(observed.deps.governancePool, governancePool);
  assert.equal(result.contract, STAGING_RECOVERY_GATEWAY_PREFLIGHT_CONTRACT);
  assert.equal(result.operation, "activation_gateway_dark_deploy_dry_run");
  assert.equal(result.apply_ready, true);
  assert.equal(result.execution_plan_issued, true);
  assert.equal(result.governance_state_mutation_performed, true);
  assert.equal(result.database_mutation, true);
  assert.equal(result.target_database_mutation_performed, false);
  assert.equal(result.provider_accessed, false);
  assert.equal(result.provider_mutation_performed, false);
  assert.equal(result.production_mutation_performed, false);
  assert.equal(result.apply_authority_issued, false);
  assert.equal(result.capability_envelope_issued, false);
  assert.equal(result.execution_nonce_issued, false);
  assert.equal(result.convergence_binding.server_acknowledgement_verified, false);
  assert.equal(result.convergence_binding.consequential_apply_authority_issued, false);
});

test("stale policy assertion stays on the Staging adapter and cannot fall through to Production", async () => {
  const staleInput = { ...input, expected_policy_hash: "f".repeat(64) };
  let authorityQueries = 0;
  const noQueryRuntimePool = {
    async query() {
      authorityQueries += 1;
      throw new Error("stale policy mismatch must fail before Runtime DB access");
    },
  };
  const noQueryGovernancePool = {
    async query() {
      authorityQueries += 1;
      throw new Error("stale policy mismatch must fail before Governance DB access");
    },
  };
  const deps = {
    runtimePool: noQueryRuntimePool,
    governancePool: noQueryGovernancePool,
    auth,
    env: { NODE_ENV: "staging" },
    async resolveCurrentCommit() { return commit; },
  };

  await assert.rejects(
    () => previewStagingRecoveryGatewayRollout(staleInput, deps),
    (error) => error?.code === "staging_activation_gateway_expected_policy_hash_mismatch",
  );
  await assert.rejects(
    () => prepareStagingRecoveryGatewayDarkDeployDryRun(staleInput, deps),
    (error) => error?.code === "staging_activation_gateway_expected_policy_hash_mismatch",
  );
  assert.equal(authorityQueries, 0);
});

test("preflight fails closed if an implementation reports provider access", async () => {
  await assert.rejects(
    () => previewStagingRecoveryGatewayRollout(input, {
      runtimePool,
      governancePool,
      auth,
      async buildRolloutPlan() {
        return { ok: true, apply_ready: true, provider_accessed: true, provider_calls_made: 1 };
      },
    }),
    (error) => error?.code === "STAGING_RECOVERY_GATEWAY_PROVIDER_ACCESS_FORBIDDEN"
      && error?.details?.provider_calls_made === 1,
  );

  await assert.rejects(
    () => previewStagingRecoveryGatewayRollout(input, {
      runtimePool,
      governancePool,
      auth,
      async buildRolloutPlan() {
        return { ok: true, apply_ready: true, provider_mutation_performed: true };
      },
    }),
    (error) => error?.code === "STAGING_RECOVERY_GATEWAY_PROVIDER_ACCESS_FORBIDDEN",
  );

  await assert.rejects(
    () => prepareStagingRecoveryGatewayDarkDeployDryRun(input, {
      runtimePool,
      governancePool,
      auth,
      async runDarkDeploy() {
        return { ok: true, apply_ready: true, provider_calls_made: 1, governance_state_mutation: false };
      },
    }),
    (error) => error?.code === "STAGING_RECOVERY_GATEWAY_PROVIDER_ACCESS_FORBIDDEN",
  );
});

console.log("Staging Recovery Gateway preflight wrapper tests passed");
