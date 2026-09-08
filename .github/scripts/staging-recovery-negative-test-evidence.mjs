#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STAGING_RECOVERY_REQUIRED_NEGATIVE_TESTS } from "../../http-generic-api/stagingRecoveryCertificationProtocol.js";

const SHA40 = /^[a-f0-9]{40}$/u;
const TEST_SUITES = Object.freeze({
  wrong_plan_hash: "test-recovery-execution-ticket.mjs",
  wrong_step: "test-recovery-execution-ticket.mjs",
  expired_approval: "test-recovery-execution-ticket.mjs",
  approval_reuse: "test-recovery-execution-ticket.mjs",
  cross_target_approval: "test-recovery-execution-ticket.mjs",
  cross_sha_approval: "test-recovery-execution-ticket.mjs",
  cross_environment_approval: "test-recovery-execution-ticket.mjs",
  caller_ticket_fields: "test-recovery-action-bridge.mjs",
  ticket_replay: "test-recovery-execution-ticket.mjs",
  expired_ticket: "test-recovery-execution-ticket.mjs",
  cross_target_ticket: "test-recovery-execution-ticket.mjs",
  cross_sha_ticket: "test-recovery-execution-ticket.mjs",
  idempotency_race: "test-recovery-kernel.mjs",
  restart_durability: "test-staging-recovery-phase-b-concurrency.mjs",
  lost_fence: "test-recovery-kernel.mjs",
  provider_timeout_unknown_outcome: "test-recovery-kernel.mjs",
  partial_execution_reconciliation: "test-recovery-kernel.mjs",
  readback_failure: "test-recovery-kernel.mjs",
  artifact_drift: "test-recovery-activation-readiness.mjs",
  schema_precondition_drift: "test-recovery-kernel.mjs",
});

function required(env, key) {
  const value = String(env[key] || "").trim();
  if (!value) throw Object.assign(new Error(`${key} is required`), { code: "RECOVERY_NEGATIVE_TEST_EVIDENCE_INPUT_MISSING" });
  return value;
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export async function writeNegativeTestEvidence({ env = process.env } = {}) {
  const exactSha = required(env, "GITHUB_SHA").toLowerCase();
  if (!SHA40.test(exactSha)) throw Object.assign(new Error("GITHUB_SHA must be an exact lowercase 40-character SHA."), { code: "RECOVERY_NEGATIVE_TEST_EVIDENCE_SHA_INVALID" });
  if (String(env.RECOVERY_STAGING_NEGATIVE_TEST_SUITES_PASSED || "").trim() !== "true") {
    throw Object.assign(new Error("Negative-test evidence can be emitted only after the exact-SHA governed suites pass in the same job."), { code: "RECOVERY_NEGATIVE_TEST_SUITES_NOT_ATTESTED" });
  }
  const output = path.resolve(required(env, "RECOVERY_STAGING_NEGATIVE_TEST_EVIDENCE_FILE"));
  const generatedAt = new Date().toISOString();
  const cases = Object.fromEntries(STAGING_RECOVERY_REQUIRED_NEGATIVE_TESTS.map((key) => {
    const suite = TEST_SUITES[key];
    if (!suite) throw Object.assign(new Error(`No governed suite mapping exists for ${key}.`), { code: "RECOVERY_NEGATIVE_TEST_SUITE_MAPPING_MISSING" });
    return [key, {
      status: "pass",
      suite,
      evidence_hash: hash(JSON.stringify({ contract: "mad4b.staging-recovery-negative-test-case.v1", exact_sha: exactSha, key, suite })),
    }];
  }));
  const evidence = {
    contract: "mad4b.staging-recovery-negative-test-evidence.v1",
    all_passed: true,
    exact_sha: exactSha,
    generated_at: generatedAt,
    cases,
    secrets_included: false,
  };
  await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  return evidence;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const evidence = await writeNegativeTestEvidence();
  process.stdout.write(`${JSON.stringify({ all_passed: evidence.all_passed, exact_sha: evidence.exact_sha, case_count: Object.keys(evidence.cases).length, secrets_included: false })}\n`);
}
