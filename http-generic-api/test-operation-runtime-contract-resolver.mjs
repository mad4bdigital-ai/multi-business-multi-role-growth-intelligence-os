import assert from "node:assert/strict";
import { getOperationContract } from "./operationContractRegistry.js";
import { createOperationRuntimeContractResolver } from "./operationRuntimeContractResolver.js";

function sqlError(code, status = 0, message = code) {
  const error = new Error(message);
  error.code = code;
  if (status) error.status = status;
  return error;
}

function sqlSuccess() {
  return {
    ok: true,
    operation_key: "repo.change.preview",
    version: 1,
    revision_hash: "a".repeat(64),
    contract: Object.freeze({
      operation_key: "repo.change.preview",
      version: 1,
      revision_hash: "a".repeat(64),
      definition: Object.freeze({ operation_key: "repo.change.preview", version: 1, steps: [Object.freeze({ step_key: "load" })] }),
      source: "sql_operation_registry",
      read_only: true,
      secrets_included: false
    }),
    cache: { cache_hit: true },
    fallback_used: false
  };
}

{
  let staticCalls = 0;
  let switchCalls = 0;
  const resolver = createOperationRuntimeContractResolver({
    load_sql: async () => sqlSuccess(),
    get_static_contract: () => { staticCalls += 1; return getOperationContract("repo.change.preview"); },
    evaluate_kill_switch: () => { switchCalls += 1; throw new Error("switch must not be evaluated on SQL success"); }
  });
  const result = await resolver.resolve({ operation_key: "repo.change.preview", version: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.resolution_source, "sql_operation_registry");
  assert.equal(result.contract_kind, "sql_runtime_contract");
  assert.equal(result.fallback_used, false);
  assert.equal(staticCalls, 0);
  assert.equal(switchCalls, 0);
}

{
  const resolver = createOperationRuntimeContractResolver({
    load_sql: async () => { throw sqlError("operation_runtime_contract_not_found", 404); },
    env: {}
  });
  const result = await resolver.resolve({ operation_key: "repo.change.preview", version: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.resolution_source, "legacy_code_registry");
  assert.equal(result.contract_kind, "legacy_code_contract");
  assert.equal(result.fallback_used, true);
  assert.equal(result.fallback_reason.classification, "migration_gap");
  assert.equal(result.fallback_switch.blocked, false);
  assert.equal(result.fallback_switch.mutation, false);
  assert.equal(result.fallback_switch.gated_action, true);
  assert.equal(result.sql_authority_primary, true);
  assert.equal(result.legacy_code_authority_temporary, true);
  assert.equal(Object.isFrozen(result.contract), true);
  assert.equal(Object.isFrozen(result.contract.definition), true);
  assert.match(result.revision_hash, /^[0-9a-f]{64}$/);
  assert.equal(result.database_writes_performed, false);
  assert.equal(result.runtime_activation_changed, false);
}

{
  const resolver = createOperationRuntimeContractResolver({
    load_sql: async () => { throw sqlError("operation_runtime_contract_not_found", 404); },
    env: { CAPABILITY_KILL_SWITCH_OPERATION_CONTRACT_CODE_FALLBACK: "true" }
  });
  await assert.rejects(
    resolver.resolve({ operation_key: "repo.change.preview", version: 1 }),
    (error) => error.code === "operation_contract_code_fallback_disabled" && error.status === 503
  );
}

for (const code of [
  "operation_runtime_contract_revision_hash_mismatch",
  "operation_runtime_contract_identity_mismatch",
  "operation_runtime_contract_lifecycle_blocked",
  "operation_runtime_contract_step_count_invalid"
]) {
  const original = sqlError(code, 409);
  let staticCalls = 0;
  const resolver = createOperationRuntimeContractResolver({
    load_sql: async () => { throw original; },
    get_static_contract: () => { staticCalls += 1; return getOperationContract("repo.change.preview"); }
  });
  await assert.rejects(
    resolver.resolve({ operation_key: "repo.change.preview", version: 1 }),
    (error) => error === original
  );
  assert.equal(staticCalls, 0, `${code} must not invoke code fallback`);
}

{
  const resolver = createOperationRuntimeContractResolver({
    load_sql: async () => { throw sqlError("ETIMEDOUT"); },
    env: {}
  });
  const result = await resolver.resolve({ operation_key: "repo.change.preview", version: 1 });
  assert.equal(result.fallback_used, true);
  assert.equal(result.fallback_reason.classification, "sql_unavailable");
  assert.equal(result.fallback_reason.retryable, true);
}

{
  const resolver = createOperationRuntimeContractResolver({
    load_sql: async () => { throw sqlError("operation_runtime_contract_not_found", 404); },
    env: {}
  });
  await assert.rejects(
    resolver.resolve({ operation_key: "repo.change.preview", version: 2 }),
    (error) => error.code === "operation_contract_code_fallback_version_unsupported"
  );
}

{
  const resolver = createOperationRuntimeContractResolver({
    load_sql: async () => { throw sqlError("operation_runtime_contract_not_found", 404); },
    env: {}
  });
  await assert.rejects(
    resolver.resolve({ operation_key: "repo.unknown.preview", version: 1 }),
    (error) => error.code === "operation_contract_code_fallback_not_registered" && error.status === 404
  );
}

{
  const resolver = createOperationRuntimeContractResolver({
    load_sql: async () => { throw sqlError("operation_runtime_contract_not_found", 404); },
    evaluate_kill_switch: () => ({ blocked: false, switch_key: null, gated_action: false }),
    get_static_contract: () => getOperationContract("repo.change.preview")
  });
  await assert.rejects(
    resolver.resolve({ operation_key: "repo.change.preview", version: 1 }),
    (error) => error.code === "operation_contract_code_fallback_policy_missing"
  );
}

{
  const resolver = createOperationRuntimeContractResolver({
    load_sql: async () => { throw new Error("loader must not be reached"); }
  });
  await assert.rejects(
    resolver.resolve({ operation_key: "repo.change.preview", version: 1, credential_payload: "forbidden" }),
    (error) => error.code === "operation_runtime_contract_resolver_unknown_field"
  );
}

console.log("operation runtime contract resolver tests passed");
