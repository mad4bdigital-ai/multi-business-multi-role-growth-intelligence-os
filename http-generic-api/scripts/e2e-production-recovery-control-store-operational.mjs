#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  createProductionRecoveryControlStore,
  createProductionRecoveryFencedLock,
  getProductionRecoveryControlStoreSchemaPlan,
  PRODUCTION_RECOVERY_CONTROL_STORE_CONTRACT,
  PRODUCTION_RECOVERY_LOCK_CONTRACT,
  RECOVERY_CONTROL_STORE_SCHEMA_STATEMENTS,
  RECOVERY_DURABLE_STORE_CONTRACT,
} from "../productionRecoveryControlStore.js";

const REQUIRED_STORE_METHODS = Object.freeze([
  "putRun",
  "getRun",
  "putPlan",
  "getPlan",
  "putFinding",
  "getFinding",
  "getRunByIdempotency",
  "appendEvidenceEvent",
  "putIdempotencyReceipt",
  "putApproval",
  "getApprovalByPlanStep",
  "claimExecution",
  "reserveApproval",
  "getExecutionTicket",
  "putExecutionTicket",
  "reserveExecutionTicket",
  "releaseExecutionTicket",
  "finalizeExecutionTicket",
  "releaseExecutionClaim",
  "releaseApprovalReservation",
]);
const REQUIRED_LOCK_METHODS = Object.freeze(["acquire", "heartbeat", "assertFence", "release"]);
const REQUIRED_TABLES = Object.freeze([
  "recovery_control_records",
  "recovery_control_run_idempotency",
  "recovery_control_idempotency_receipts",
  "recovery_control_approval_index",
  "recovery_control_execution_claims",
  "recovery_control_approval_reservations",
  "recovery_control_approval_finalizations",
  "recovery_control_execution_tickets",
  "recovery_control_evidence_events",
  "recovery_control_exception_events",
  "recovery_control_locks",
]);

let poolAccesses = 0;
const noConnectionPoolProvider = () => {
  poolAccesses += 1;
  throw new Error("synthetic source contract must not access the database");
};

const store = createProductionRecoveryControlStore({ poolProvider: noConnectionPoolProvider });
const lock = createProductionRecoveryFencedLock({ poolProvider: noConnectionPoolProvider });
const schemaPlan = getProductionRecoveryControlStoreSchemaPlan();

assert.equal(store.recovery_store_contract, RECOVERY_DURABLE_STORE_CONTRACT);
assert.equal(store.implementation_contract, PRODUCTION_RECOVERY_CONTROL_STORE_CONTRACT);
assert.equal(store.independent_of_target_databases, true);
assert.equal(store.target_database_binding, "forbidden");
assert.equal(store.durability, "independent_mysql_control_store");
assert.equal(store.shared_replica_safe, true);
assert.equal(store.schema_auto_apply, false);
assert.equal(store.provider_accessed, false);

for (const method of REQUIRED_STORE_METHODS) assert.equal(typeof store[method], "function", `missing store method ${method}`);
for (const method of REQUIRED_LOCK_METHODS) {
  assert.equal(typeof store.recoveryLock[method], "function", `missing embedded lock method ${method}`);
  assert.equal(typeof lock[method], "function", `missing standalone lock method ${method}`);
}
assert.equal(store.recoveryLock.contract, PRODUCTION_RECOVERY_LOCK_CONTRACT);
assert.equal(store.recoveryLock.durable, true);
assert.equal(store.recoveryLock.shared_replica_safe, true);

assert.equal(schemaPlan.auto_apply, false);
assert.equal(schemaPlan.production_mutation_allowed, false);
assert.equal(schemaPlan.database_connection_performed, false);
assert.equal(schemaPlan.database_mutation_performed, false);
assert.equal(schemaPlan.secrets_included, false);
assert.equal(schemaPlan.statement_count, RECOVERY_CONTROL_STORE_SCHEMA_STATEMENTS.length);
assert.ok(schemaPlan.statement_count >= REQUIRED_TABLES.length);

const schemaText = RECOVERY_CONTROL_STORE_SCHEMA_STATEMENTS.join("\n");
for (const table of REQUIRED_TABLES) assert.match(schemaText, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`, "u"), `missing schema table ${table}`);
assert.match(schemaText, /PRIMARY KEY \(idempotency_key\)/u);
assert.match(schemaText, /PRIMARY KEY \(reservation_key\)/u);
assert.match(schemaText, /state VARCHAR\(32\) NOT NULL DEFAULT 'issued'/u);
assert.match(schemaText, /fence_counter BIGINT UNSIGNED NOT NULL DEFAULT 0/u);
assert.match(schemaText, /UNIQUE KEY uq_recovery_control_lease_id \(lease_id\)/u);
assert.doesNotMatch(schemaText, /\b(?:DROP|TRUNCATE)\s+TABLE\b/iu);

// Construction and schema planning are deliberately connection-free. The next
// resilient phase owns disposable-store concurrency/restart certification.
assert.equal(poolAccesses, 0);

process.stdout.write(`${JSON.stringify({
  ok: true,
  contract: "mad4b.production-recovery-control-store-operational-e2e.v1",
  store_contract: PRODUCTION_RECOVERY_CONTROL_STORE_CONTRACT,
  durable_store_contract: RECOVERY_DURABLE_STORE_CONTRACT,
  lock_contract: PRODUCTION_RECOVERY_LOCK_CONTRACT,
  required_store_methods: REQUIRED_STORE_METHODS.length,
  required_lock_methods: REQUIRED_LOCK_METHODS.length,
  schema_statements: schemaPlan.statement_count,
  database_connection_performed: false,
  database_mutation_performed: false,
  production_mutation_allowed: false,
  provider_mutation_performed: false,
  deployment_or_restart_executed: false,
  secrets_included: false,
}, null, 2)}\n`);
