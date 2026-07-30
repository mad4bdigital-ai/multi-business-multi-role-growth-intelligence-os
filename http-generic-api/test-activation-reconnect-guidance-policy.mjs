import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTIVATION_ERROR_GUIDANCE,
  ACTIVATION_RECONNECT_ALLOWED_ERROR_CODES,
  ACTIVATION_RECONNECT_FORBIDDEN_STAGES,
  classifyActivationFailureStage,
  isActivationReconnectForbiddenStage,
  resolveActivationReconnectGuidance,
} from "./activationReconnectGuidancePolicy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "specs",
      "012-tenant-activation-lifecycle",
      "implementation",
      "pr-2a-lifecycle-contracts.json",
    ),
    "utf8",
  ),
);

assert.equal(contract.runtime_authority, false);
assert.deepEqual(
  ACTIVATION_RECONNECT_ALLOWED_ERROR_CODES,
  contract.reconnect_policy.allowed_error_codes,
);
assert.deepEqual(
  ACTIVATION_RECONNECT_FORBIDDEN_STAGES,
  contract.reconnect_policy.forbidden_stages,
);
assert.equal(contract.reconnect_policy.deployment_mismatch_reconnect_required, false);

const expectedClassifications = {
  USER_JWT_REQUIRED: "gateway",
  USER_JWT_INVALID: "gateway",
  TOKEN_RESOURCE_INVALID: "gateway",
  MEMBERSHIP_REQUIRED: "membership",
  WORKSPACE_NOT_READY: "workspace",
  CONNECTION_REQUIRED: "connection",
  BOOTSTRAP_VALIDATING: "bootstrap",
  VALIDATION_RATE_LIMITED: "provider_validation",
  ACTIVATION_DEPENDENCY_UNAVAILABLE: "tool_readiness",
  ACTIVATION_OUTCOME_UNKNOWN: "dispatch_unknown_outcome",
  DEPLOYMENT_STALE: "deployment",
  ACTIVATION_CONTRACT_ERROR: "contract",
};

assert.deepEqual(
  Object.keys(ACTIVATION_ERROR_GUIDANCE),
  contract.errors.map(({ code }) => code),
);

for (const errorContract of contract.errors) {
  const policy = ACTIVATION_ERROR_GUIDANCE[errorContract.code];
  assert(policy, `missing guidance for ${errorContract.code}`);
  assert.deepEqual(
    {
      http_status: policy.http_status,
      stage: policy.stage,
      retryable: policy.retryable,
      reconnect_required: policy.reconnect_required,
      user_action: policy.user_action,
      readback: policy.readback,
    },
    {
      http_status: errorContract.http_status,
      stage: errorContract.stage,
      retryable: errorContract.retryable,
      reconnect_required: errorContract.reconnect_required,
      user_action: errorContract.user_action,
      readback: errorContract.readback,
    },
  );

  assert.deepEqual(classifyActivationFailureStage(errorContract.code), {
    error_code: errorContract.code,
    source_stage: errorContract.stage,
    stage_classification: expectedClassifications[errorContract.code],
  });

  const unverified = resolveActivationReconnectGuidance({
    error_code: errorContract.code,
    observed_stage: errorContract.stage,
    auth_failure_verified: false,
  });
  assert.equal(unverified.reconnect_required, false);

  if (errorContract.reconnect_required) {
    assert.equal(unverified.user_action, null);
    assert.equal(
      unverified.guidance_suppressed_reason,
      "auth_failure_not_verified",
    );
  } else {
    assert.equal(unverified.user_action, errorContract.user_action);
    assert(
      ["stage_forbids_reconnect", "contract_does_not_require_reconnect"].includes(
        unverified.guidance_suppressed_reason,
      ),
    );
  }

  const verified = resolveActivationReconnectGuidance({
    error_code: errorContract.code,
    observed_stage: errorContract.stage,
    auth_failure_verified: true,
  });
  const reconnectExpected =
    errorContract.reconnect_required === true &&
    contract.reconnect_policy.allowed_error_codes.includes(errorContract.code);
  assert.equal(verified.reconnect_required, reconnectExpected);
  assert.equal(verified.user_action, errorContract.user_action);
}

for (const stage of ACTIVATION_RECONNECT_FORBIDDEN_STAGES) {
  assert.equal(isActivationReconnectForbiddenStage(stage), true);
}
assert.equal(isActivationReconnectForbiddenStage("gateway"), false);
assert.equal(isActivationReconnectForbiddenStage("unknown"), false);

for (const errorCode of [
  "MEMBERSHIP_REQUIRED",
  "WORKSPACE_NOT_READY",
  "CONNECTION_REQUIRED",
  "BOOTSTRAP_VALIDATING",
  "VALIDATION_RATE_LIMITED",
  "ACTIVATION_DEPENDENCY_UNAVAILABLE",
  "ACTIVATION_OUTCOME_UNKNOWN",
  "DEPLOYMENT_STALE",
  "ACTIVATION_CONTRACT_ERROR",
]) {
  const errorContract = contract.errors.find(({ code }) => code === errorCode);
  const result = resolveActivationReconnectGuidance({
    error_code: errorCode,
    observed_stage: errorContract.stage,
    auth_failure_verified: true,
  });
  assert.equal(result.reconnect_required, false, `${errorCode} must not reconnect`);
}

for (const errorCode of ACTIVATION_RECONNECT_ALLOWED_ERROR_CODES) {
  const errorContract = contract.errors.find(({ code }) => code === errorCode);
  const result = resolveActivationReconnectGuidance({
    error_code: errorCode,
    observed_stage: errorContract.stage,
    auth_failure_verified: true,
  });
  assert.equal(result.reconnect_required, true);
  assert.equal(result.user_action, errorContract.user_action);
}

assert.throws(
  () =>
    resolveActivationReconnectGuidance({
      error_code: "USER_JWT_INVALID",
      observed_stage: "deployment",
      auth_failure_verified: true,
    }),
  (error) =>
    error?.code === "activation_guidance_stage_mismatch" && error?.status === 409,
);
assert.throws(
  () => resolveActivationReconnectGuidance({ error_code: "INVENTED_ERROR" }),
  (error) =>
    error?.code === "activation_guidance_error_code_invalid" && error?.status === 400,
);
assert.equal(
  resolveActivationReconnectGuidance({
    error_code: "USER_JWT_REQUIRED",
    observed_stage: "gateway",
    auth_failure_verified: "true",
  }).reconnect_required,
  false,
);

for (const runtimeFile of [
  "server.js",
  "activationSessionLifecycleService.js",
  "activationHardResponseService.js",
]) {
  const source = fs.readFileSync(path.join(__dirname, runtimeFile), "utf8");
  assert.doesNotMatch(
    source,
    /activationReconnectGuidancePolicy/,
    `${runtimeFile} must not wire the T028 policy foundation`,
  );
}

const classificationSuite = fs.readFileSync(
  path.join(__dirname, "test-activation-classification.mjs"),
  "utf8",
);
assert.match(
  classificationSuite,
  /import "\.\/test-activation-reconnect-guidance-policy\.mjs";/,
);

console.log("activation reconnect guidance policy tests passed");
