import assert from "node:assert/strict";
import { operationRevisionHash } from "./operationRegistryContracts.js";
import { createOperationRuntimeContractLoader } from "./operationRuntimeContractLoader.js";

function definition(operationKey, version, displayName, status = "active") {
  return {
    operation_key: operationKey,
    version,
    display_name: displayName,
    description: `${displayName} contract`,
    operation_class: "repository",
    scope_type: "admin",
    risk_level: "medium",
    execution_mode: "synchronous",
    input_schema_json: {
      type: "object",
      properties: { branch: { type: "string", minLength: 1 } },
      required: ["branch"],
      additionalProperties: false
    },
    output_schema_json: {
      type: "object",
      properties: { status: { type: "string", enum: ["ready", "blocked"] } },
      required: ["status"],
      additionalProperties: false
    },
    status,
    source_revision_hash: "a".repeat(64),
    compiler_version: "operation-registry-v1",
    metadata_json: { owner: "runtime_loader", secrets_included: false },
    created_by: "platform_admin_service",
    steps: [{
      step_key: "load",
      step_order: 10,
      depends_on: [],
      handler_key: "operation_context_get",
      capability_key: "repository_read",
      input_mapping_json: null,
      success_condition_json: null,
      retry_policy_json: null,
      failure_policy_json: null,
      timeout_seconds: 30,
      compensation_required: false,
      compensation_policy_key: null,
      status,
      metadata_json: null
    }]
  };
}

function record(operationKey, version, displayName, status = "active", id = 1) {
  const value = definition(operationKey, version, displayName, status);
  return {
    id,
    operation_id: `operation-${id}`,
    revision_hash: operationRevisionHash(value),
    created_at: "2026-07-24T00:00:00.000Z",
    updated_at: "2026-07-24T00:00:00.000Z",
    activated_at: status === "active" ? "2026-07-24T00:00:00.000Z" : null,
    superseded_at: null,
    definition: value
  };
}

function stateKey(operationKey, version) {
  return `${operationKey}:${version}`;
}

function harness(records) {
  const state = new Map(records.map((item) => [stateKey(item.definition.operation_key, item.definition.version), item]));
  const counters = { probes: 0, loads: 0 };
  const pool = {
    async query(sql, params = []) {
      assert.match(String(sql).replace(/\s+/g, " ").trim(), /^SELECT id,operation_id,operation_key,version,revision_hash,status,updated_at FROM operation_registry/);
      counters.probes += 1;
      const item = state.get(stateKey(params[0], Number(params[1])));
      if (!item) return [[]];
      return [[{
        id: item.id,
        operation_id: item.operation_id,
        operation_key: item.definition.operation_key,
        version: item.definition.version,
        revision_hash: item.revision_hash,
        status: item.definition.status,
        updated_at: item.updated_at
      }]];
    }
  };
  const loadVersion = async (operationKey, version) => {
    counters.loads += 1;
    const item = state.get(stateKey(operationKey, version));
    return item ? { ok: true, operation: item } : null;
  };
  return { state, counters, pool, loadVersion };
}

{
  const now = { value: 1_000 };
  const initial = record("repo.change.preview", 1, "Preview", "active", 1);
  const runtime = harness([initial]);
  const loader = createOperationRuntimeContractLoader({
    pool: runtime.pool,
    load_version: runtime.loadVersion,
    ttl_ms: 5_000,
    max_entries: 10,
    now: () => now.value
  });

  const first = await loader.load({ operation_key: "repo.change.preview", version: 1 });
  const second = await loader.load({ operation_key: "repo.change.preview", version: 1 });
  assert.equal(first.cache.cache_hit, false);
  assert.equal(second.cache.cache_hit, true);
  assert.equal(runtime.counters.probes, 2);
  assert.equal(runtime.counters.loads, 1);
  assert.equal(first.contract.definition.steps.length, 1);
  assert.equal(first.database_writes_performed, false);
  assert.equal(first.fallback_used, false);
  assert.equal(Object.isFrozen(first.contract), true);
  assert.equal(Object.isFrozen(first.contract.definition), true);

  const revised = record("repo.change.preview", 1, "Preview Revised", "active", 1);
  runtime.state.set(stateKey("repo.change.preview", 1), revised);
  const third = await loader.load({ operation_key: "repo.change.preview", version: 1 });
  assert.equal(third.cache.cache_hit, false);
  assert.equal(third.cache.revision_invalidated, true);
  assert.equal(third.contract.definition.display_name, "Preview Revised");
  assert.equal(runtime.counters.loads, 2);

  now.value += 6_000;
  const fourth = await loader.load({ operation_key: "repo.change.preview", version: 1 });
  assert.equal(fourth.cache.cache_hit, false);
  assert.equal(fourth.cache.cache_expired, true);
  assert.equal(runtime.counters.loads, 3);
}

{
  const records = [
    record("repo.cache.one", 1, "One", "active", 11),
    record("repo.cache.two", 1, "Two", "active", 12),
    record("repo.cache.three", 1, "Three", "active", 13)
  ];
  const runtime = harness(records);
  const loader = createOperationRuntimeContractLoader({
    pool: runtime.pool,
    load_version: runtime.loadVersion,
    ttl_ms: 10_000,
    max_entries: 2,
    now: () => 1_000
  });
  await loader.load({ operation_key: "repo.cache.one", version: 1 });
  await loader.load({ operation_key: "repo.cache.two", version: 1 });
  await loader.load({ operation_key: "repo.cache.three", version: 1 });
  assert.equal(loader.stats().entry_count, 2);
  await loader.load({ operation_key: "repo.cache.one", version: 1 });
  assert.equal(runtime.counters.loads, 4);
}

{
  const item = record("repo.single.flight", 1, "Single Flight", "active", 21);
  const runtime = harness([item]);
  let releaseLoad;
  const release = new Promise((resolve) => { releaseLoad = resolve; });
  let loadCalls = 0;
  const loader = createOperationRuntimeContractLoader({
    pool: runtime.pool,
    load_version: async () => {
      loadCalls += 1;
      await release;
      return { ok: true, operation: item };
    },
    now: () => 1_000
  });
  const first = loader.load({ operation_key: "repo.single.flight", version: 1 });
  const second = loader.load({ operation_key: "repo.single.flight", version: 1 });
  releaseLoad();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(loadCalls, 1);
  assert.equal(runtime.counters.probes, 1);
  assert.equal(firstResult.cache.single_flight_joined, false);
  assert.equal(secondResult.cache.single_flight_joined, true);
}

{
  const item = record("repo.hash.invalid", 1, "Invalid Hash", "active", 31);
  item.revision_hash = "f".repeat(64);
  const runtime = harness([item]);
  const loader = createOperationRuntimeContractLoader({ pool: runtime.pool, load_version: runtime.loadVersion });
  await assert.rejects(
    loader.load({ operation_key: "repo.hash.invalid", version: 1 }),
    (error) => error.code === "operation_runtime_contract_revision_hash_mismatch"
  );
}

{
  const item = record("repo.lifecycle.blocked", 1, "Blocked", "disabled", 41);
  const runtime = harness([item]);
  const loader = createOperationRuntimeContractLoader({ pool: runtime.pool, load_version: runtime.loadVersion });
  await assert.rejects(
    loader.load({ operation_key: "repo.lifecycle.blocked", version: 1 }),
    (error) => error.code === "operation_runtime_contract_lifecycle_blocked"
  );
  assert.equal(runtime.counters.loads, 0);
}

{
  const loader = createOperationRuntimeContractLoader({
    pool: { async query() { throw new Error("database must not be reached"); } },
    load_version: async () => { throw new Error("repository must not be reached"); }
  });
  await assert.rejects(
    loader.load({ operation_key: "bad", version: 0 }),
    (error) => error.code === "operation_runtime_contract_loader_invalid_version"
  );
}

console.log("operation runtime contract loader tests passed");
