#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import {
  createProductionRecoveryControlStore,
  createProductionRecoveryFencedLock,
  RECOVERY_CONTROL_STORE_SCHEMA_STATEMENTS,
} from "../productionRecoveryControlStore.js";

const CONTRACT = "mad4b.production-recovery-control-store-resilient-certification.v1";
const MODE = "disposable_ci";
const mode = String(process.env.PRODUCTION_RECOVERY_RESILIENT_CERTIFICATION_MODE || "").trim();
assert.equal(mode, MODE, "resilient certification is allowed only in disposable_ci mode");

const requiredEnv = [
  "RECOVERY_RESILIENT_TEST_DB_HOST",
  "RECOVERY_RESILIENT_TEST_DB_PORT",
  "RECOVERY_RESILIENT_TEST_DB_NAME",
  "RECOVERY_RESILIENT_TEST_DB_USER",
  "RECOVERY_RESILIENT_TEST_DB_PASSWORD",
];
const missing = requiredEnv.filter((key) => !String(process.env[key] || "").trim());
assert.deepEqual(missing, [], `missing disposable Recovery control-store test env: ${missing.join(", ")}`);

for (const forbidden of ["production", "hostinger_autodeploy", "Production"]) {
  assert.notEqual(String(process.env.ENVIRONMENT || "").trim(), forbidden, "Production runtime identity is forbidden in resilient certification");
  assert.notEqual(String(process.env.RUNTIME_CLASS || "").trim(), forbidden, "Production runtime class is forbidden in resilient certification");
}

const connectionConfig = Object.freeze({
  host: process.env.RECOVERY_RESILIENT_TEST_DB_HOST,
  port: Number(process.env.RECOVERY_RESILIENT_TEST_DB_PORT),
  database: process.env.RECOVERY_RESILIENT_TEST_DB_NAME,
  user: process.env.RECOVERY_RESILIENT_TEST_DB_USER,
  password: process.env.RECOVERY_RESILIENT_TEST_DB_PASSWORD,
  connectionLimit: 4,
  waitForConnections: true,
  queueLimit: 0,
});

function createPool() {
  return mysql.createPool(connectionConfig);
}

function countTrue(results, key) {
  return results.filter((value) => value?.[key] === true).length;
}

function containsForbiddenOutputKey(value, depth = 0) {
  if (depth > 8 || value == null) return false;
  if (Array.isArray(value)) return value.some((item) => containsForbiddenOutputKey(item, depth + 1));
  if (typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => (
    /(?:password|private[_-]?key|approval[_-]?token|ticket[_-]?signature|credential|secret)/iu.test(key)
      || containsForbiddenOutputKey(child, depth + 1)
  ));
}

const poolA = createPool();
const poolB = createPool();
let poolC = null;

try {
  for (const statement of RECOVERY_CONTROL_STORE_SCHEMA_STATEMENTS) await poolA.query(statement);

  const verifier = Object.freeze({
    verify: async () => ({ ok: true, disposable_certification_only: true, secrets_included: false }),
  });
  const storeA = createProductionRecoveryControlStore({ poolProvider: () => poolA, executionTicketVerifier: verifier });
  const storeB = createProductionRecoveryControlStore({ poolProvider: () => poolB, executionTicketVerifier: verifier });
  const lockA = createProductionRecoveryFencedLock({ poolProvider: () => poolA });
  const lockB = createProductionRecoveryFencedLock({ poolProvider: () => poolB });

  const planHash = "a".repeat(64);
  const ticketHash = "b".repeat(64);
  const approvalId = "approval:resilient-race";
  const stepId = "step:resilient-race";
  const ticketId = "ticket:resilient-race";

  await storeA.putApproval({
    approval_id: approvalId,
    plan_id: "plan:resilient",
    plan_hash: planHash,
    step_id: stepId,
    expected_sha: "c".repeat(40),
    used: false,
    secrets_included: false,
  });

  const approvalRace = await Promise.all([
    storeA.reserveApproval({ approval_id: approvalId, plan_hash: planHash, step_id: stepId, idempotency_key: "idem:approval-a" }),
    storeB.reserveApproval({ approval_id: approvalId, plan_hash: planHash, step_id: stepId, idempotency_key: "idem:approval-b" }),
  ]);
  assert.equal(countTrue(approvalRace, "reserved"), 1, "approval reservation race must have exactly one winner");

  await storeA.putExecutionTicket({
    ticket_id: ticketId,
    ticket_hash: ticketHash,
    plan_id: "plan:resilient",
    plan_hash: planHash,
    step_id: stepId,
    target_key: "target:resilient",
    target_fingerprint: "d".repeat(64),
    secrets_included: false,
  });

  const ticketRace = await Promise.all([
    storeA.reserveExecutionTicket({ ticket_id: ticketId, ticket_hash: ticketHash, idempotency_key: "idem:ticket-a" }),
    storeB.reserveExecutionTicket({ ticket_id: ticketId, ticket_hash: ticketHash, idempotency_key: "idem:ticket-b" }),
  ]);
  assert.equal(countTrue(ticketRace, "reserved"), 1, "execution-ticket reservation race must have exactly one winner");
  const winningTicketIdempotency = ticketRace[0]?.reserved === true ? "idem:ticket-a" : "idem:ticket-b";
  assert.equal((await storeA.finalizeExecutionTicket({ ticket_id: ticketId, ticket_hash: ticketHash, idempotency_key: winningTicketIdempotency })).finalized, true);

  const firstLock = await lockA.acquire({ target_key: "target:fence", plan_hash: planHash, ttl_seconds: 0.1 });
  assert.equal(firstLock.acquired, true);
  const busyLock = await lockB.acquire({ target_key: "target:fence", plan_hash: planHash, ttl_seconds: 0.1 });
  assert.equal(busyLock.acquired, false);
  assert.equal(busyLock.lock_busy, true);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const takeoverLock = await lockB.acquire({ target_key: "target:fence", plan_hash: planHash, ttl_seconds: 1 });
  assert.equal(takeoverLock.acquired, true);
  assert.equal(takeoverLock.fence_counter, firstLock.fence_counter + 1, "fence counter must increase on expired-lease takeover");
  assert.equal((await lockA.assertFence(firstLock)).valid, false, "stale fence must fail after takeover");
  assert.equal((await lockB.assertFence(takeoverLock)).valid, true, "new fence must remain valid");
  assert.equal((await lockB.release({ target_key: "target:fence", lock: takeoverLock })).released, true);

  await storeA.putRun({
    run_id: "run:resilient-restart",
    plan_id: "plan:resilient",
    step_id: "step:restart",
    idempotency_key: "idem:run-restart",
    status: "verified",
    secrets_included: false,
  });

  // The first claim response is intentionally discarded. A second replica must
  // resolve the durable claim as existing instead of creating a second claim.
  await storeA.claimExecution({ idempotency_key: "idem:ambiguous-claim", plan_id: "plan:resilient", step_id: "step:ambiguous" });
  const ambiguousRetry = await storeB.claimExecution({ idempotency_key: "idem:ambiguous-claim", plan_id: "plan:resilient", step_id: "step:ambiguous" });
  assert.equal(ambiguousRetry.existing, true);
  assert.equal(ambiguousRetry.status, "claimed");

  const event = { event: "resilient_certification", status: "verified", secrets_included: false };
  const eventFirst = await storeA.appendEvidenceEvent("run:resilient-restart", event);
  const eventReplay = await storeB.appendEvidenceEvent("run:resilient-restart", event);
  assert.equal(eventFirst.appended, true);
  assert.equal(eventReplay.appended, false, "identical append-only evidence must be replay-safe");

  await storeA.putIdempotencyReceipt("idem:receipt-restart", {
    run_id: "run:resilient-restart",
    status: "verified",
    secrets_included: false,
  });

  await poolA.end();
  await poolB.end();

  poolC = createPool();
  const storeAfterRestart = createProductionRecoveryControlStore({ poolProvider: () => poolC, executionTicketVerifier: verifier });
  const runAfterRestart = await storeAfterRestart.getRunByIdempotency("idem:run-restart");
  assert.equal(runAfterRestart?.run_id, "run:resilient-restart", "run/idempotency binding must survive pool/process recreation");
  const receiptAfterRestart = await storeAfterRestart.getRunByIdempotency("idem:receipt-restart");
  assert.equal(receiptAfterRestart?.status, "verified", "idempotency receipt must survive pool/process recreation");
  assert.equal(receiptAfterRestart?.secrets_included, false);

  const finalizedReplay = await storeAfterRestart.reserveExecutionTicket({
    ticket_id: ticketId,
    ticket_hash: ticketHash,
    idempotency_key: "idem:ticket-replay",
  });
  assert.equal(finalizedReplay.reserved, false, "finalized execution ticket must not be replayable after restart");
  const persistedTicket = await storeAfterRestart.getExecutionTicket(ticketId);
  assert.equal(persistedTicket?.ticket_hash, ticketHash, "execution ticket payload must remain durable after restart");

  const boundedEvidence = {
    approval_race_single_winner: true,
    execution_ticket_race_single_winner: true,
    execution_ticket_replay_rejected: true,
    fencing_takeover_monotonic: true,
    stale_fence_rejected: true,
    restart_durability_verified: true,
    ambiguous_claim_retry_resolved_existing: true,
    append_only_evidence_replay_safe: true,
    no_secret_receipt_verified: true,
  };
  assert.equal(containsForbiddenOutputKey(boundedEvidence), false);

  const report = {
    ok: true,
    contract: CONTRACT,
    mode: MODE,
    engine: "mariadb:11.4-disposable-ci",
    ...boundedEvidence,
    production_authorized: false,
    production_database_connection_performed: false,
    production_database_mutation_performed: false,
    provider_mutation_performed: false,
    deployment_or_restart_executed: false,
    live_activation_performed: false,
    secrets_included: false,
  };
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/production-recovery-control-store-resilient.json", `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await Promise.allSettled([
    poolA.end(),
    poolB.end(),
    poolC?.end?.(),
  ]);
}
