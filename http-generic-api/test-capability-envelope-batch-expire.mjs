import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CAPABILITY_ENVELOPE_BATCH_EXPIRE_MODES,
  planCapabilityEnvelopeBatchExpire,
  runCapabilityEnvelopeBatchExpire,
} from "./capabilityResolutionEnvelopeGuard.js";

const cutoff = "2026-07-17T00:00:00.000Z";
const governanceEnvelopeId = "governance-envelope-1";

function candidate(overrides = {}) {
  return {
    envelope_id: "candidate-1",
    capability_key: "repo_patch_apply",
    operation_intent: "repo_patch_apply",
    requested_by: "gpt_admin",
    envelope_status: "ready_requires_approval",
    execution_status: "not_executed",
    execution_ref: null,
    dispatch_allowed: 1,
    apply_allowed: 0,
    expires_at: new Date("2026-07-16T00:00:00.000Z"),
    created_at: new Date("2026-07-15T00:00:00.000Z"),
    secrets_included: 0,
    ...overrides,
  };
}

function governanceRow() {
  return {
    envelope_id: governanceEnvelopeId,
    tenant_id: "00000000-0000-0000-0000-000000000000",
    user_id: "f242960c-2857-4b4d-a504-ee50f8a278b4",
    workspace_id: "b50db01b-617e-4b7a-8bda-6bf4876f754f",
    workspace_key: null,
    brand_key: null,
    app_key: "platform_orchestration",
    capability_key: "capability_resolution_envelope_batch_expire",
    operation_intent: "capability_resolution_envelope_batch_expire",
    risk_class: "moderate",
    selected_source_tier: "platform_managed_fallback",
    selected_runtime_surface: "auth_host",
    authority_status: "passed",
    decision: "ready_for_dispatch",
    envelope_status: "ready_for_dispatch",
    dispatch_allowed: 1,
    apply_allowed: 0,
    approval_required: 0,
    quota_required: 0,
    audit_required: 1,
    readback_required: 1,
    blocking_gap_count: 0,
    execution_status: "not_executed",
    execution_ref: null,
    expires_at: new Date("2099-01-01T00:00:00.000Z"),
    secrets_included: 0,
    envelope_sha256: "a".repeat(64),
    envelope_json: JSON.stringify({ secrets_included: false }),
  };
}

function makeBatchPool(initialCandidates) {
  const rows = initialCandidates.map((row) => ({ ...row }));
  let governance = governanceRow();
  const calls = [];
  let committed = false;
  let rolledBack = false;

  function eligible(requestedBy, expiredBefore) {
    const cutoffDate = new Date(expiredBefore);
    return rows
      .filter((row) => row.requested_by === requestedBy)
      .filter((row) => row.expires_at && new Date(row.expires_at) < cutoffDate)
      .filter((row) => ["dry_run", "ready_requires_approval", "ready_for_dispatch"].includes(row.envelope_status))
      .filter((row) => row.execution_status === "not_executed")
      .filter((row) => !row.execution_ref)
      .filter((row) => Number(row.secrets_included || 0) === 0)
      .sort((left, right) => new Date(left.expires_at) - new Date(right.expires_at) || left.envelope_id.localeCompare(right.envelope_id));
  }

  const connection = {
    async beginTransaction() { calls.push("begin"); },
    async commit() { calls.push("commit"); committed = true; },
    async rollback() { calls.push("rollback"); rolledBack = true; },
    release() { calls.push("release"); },
    async query(sql, params = []) {
      const source = String(sql).replace(/\s+/g, " ").trim();
      calls.push({ source, params });

      if (source.startsWith("SELECT COUNT(*) AS total FROM capability_resolution_envelope_ledger")) {
        return [[{ total: eligible(params[0], params[1]).length }]];
      }
      if (source.startsWith("SELECT envelope_id, capability_key, operation_intent")) {
        const selected = eligible(params[0], params[1]).slice(0, Number(params[2]));
        return [selected.map((row) => ({
          envelope_id: row.envelope_id,
          capability_key: row.capability_key,
          operation_intent: row.operation_intent,
          envelope_status: row.envelope_status,
          execution_status: row.execution_status,
          expires_at: row.expires_at,
          created_at: row.created_at,
        }))];
      }
      if (source.startsWith("SELECT envelope_id, tenant_id")) {
        return [[governance].filter((row) => row?.envelope_id === params[0])];
      }
      if (source.includes("SET envelope_status = 'expired'") && source.includes("WHERE envelope_id IN")) {
        const requestedBy = params.at(-2);
        const expiredBefore = params.at(-1);
        const ids = new Set(params.slice(0, -2));
        let affectedRows = 0;
        for (const row of eligible(requestedBy, expiredBefore)) {
          if (!ids.has(row.envelope_id)) continue;
          row.envelope_status = "expired";
          row.dispatch_allowed = 0;
          row.apply_allowed = 0;
          affectedRows += 1;
        }
        return [{ affectedRows }];
      }
      if (source.startsWith("SELECT envelope_id, envelope_status, execution_status, dispatch_allowed")) {
        const ids = new Set(params);
        return [rows.filter((row) => ids.has(row.envelope_id)).map((row) => ({
          envelope_id: row.envelope_id,
          envelope_status: row.envelope_status,
          execution_status: row.execution_status,
          dispatch_allowed: row.dispatch_allowed,
          apply_allowed: row.apply_allowed,
          execution_ref: row.execution_ref,
          secrets_included: row.secrets_included,
        }))];
      }
      if (source.includes("SET execution_status = 'executed'") && params[1] === governanceEnvelopeId) {
        governance = {
          ...governance,
          execution_status: "executed",
          execution_ref: params[0],
          dispatch_allowed: 0,
          apply_allowed: 0,
        };
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${source}`);
    },
  };

  return {
    rows,
    calls,
    get governance() { return governance; },
    get committed() { return committed; },
    get rolledBack() { return rolledBack; },
    async query(sql, params) { return connection.query(sql, params); },
    async getConnection() { return connection; },
  };
}

assert.deepEqual(CAPABILITY_ENVELOPE_BATCH_EXPIRE_MODES, ["dry_run", "apply"]);

const baseCandidates = [
  candidate({ envelope_id: "candidate-1" }),
  candidate({ envelope_id: "candidate-2", expires_at: new Date("2026-07-16T01:00:00.000Z") }),
  candidate({ envelope_id: "executed", execution_status: "executed" }),
  candidate({ envelope_id: "referenced", execution_ref: "run-1" }),
  candidate({ envelope_id: "secret", secrets_included: 1 }),
  candidate({ envelope_id: "other-actor", requested_by: "another_actor" }),
];

{
  const pool = makeBatchPool(baseCandidates);
  const result = await runCapabilityEnvelopeBatchExpire({
    pool,
    mode: "dry_run",
    requestedBy: "gpt_admin",
    expiredBefore: cutoff,
    maxItems: 50,
  });
  assert.equal(result.ok, true);
  assert.equal(result.mode, "dry_run");
  assert.equal(result.plan.total_candidate_count, 2);
  assert.equal(result.plan.selected_candidate_count, 2);
  assert.equal(result.plan.apply_allowed, true);
  assert.deepEqual(result.plan.candidates.map((row) => row.envelope_id), ["candidate-1", "candidate-2"]);
  assert.match(result.plan.plan_sha256, /^[0-9a-f]{64}$/);
  assert.match(result.plan.confirm, /^EXPIRE_CAPABILITY_ENVELOPES_[0-9A-F]{12}$/);
  assert.equal(result.execution_allowed, false);
}

{
  const pool = makeBatchPool(baseCandidates);
  const plan = await planCapabilityEnvelopeBatchExpire({
    pool,
    requestedBy: "gpt_admin",
    expiredBefore: cutoff,
    maxItems: 1,
  });
  assert.equal(plan.total_candidate_count, 2);
  assert.equal(plan.selected_candidate_count, 1);
  assert.equal(plan.truncated, true);
  assert.equal(plan.apply_allowed, false);
  assert.equal(plan.blocking_reason, "candidate_limit_exceeded");
}

{
  const pool = makeBatchPool(baseCandidates);
  const dryRun = await runCapabilityEnvelopeBatchExpire({
    pool,
    mode: "dry_run",
    requestedBy: "gpt_admin",
    expiredBefore: cutoff,
    maxItems: 50,
  });
  const result = await runCapabilityEnvelopeBatchExpire({
    writerPool: pool,
    mode: "apply",
    requestedBy: "gpt_admin",
    expiredBefore: cutoff,
    maxItems: 50,
    expectedPlanSha256: dryRun.plan.plan_sha256,
    confirm: dryRun.plan.confirm,
    capabilityEnvelopeId: governanceEnvelopeId,
    reason: "Expire reviewed non-executed envelopes after TTL cleanup.",
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, "capability_envelope_batch_expire_applied");
  assert.equal(result.expired_count, 2);
  assert.equal(result.same_cycle_readback, true);
  assert.equal(pool.committed, true);
  assert.equal(pool.rolledBack, false);
  assert.equal(pool.governance.execution_status, "executed");
  assert.deepEqual(
    pool.rows.filter((row) => ["candidate-1", "candidate-2"].includes(row.envelope_id)).map((row) => row.envelope_status),
    ["expired", "expired"],
  );
  assert.equal(pool.rows.find((row) => row.envelope_id === "referenced").envelope_status, "ready_requires_approval");
}

{
  const pool = makeBatchPool(baseCandidates);
  await assert.rejects(
    () => runCapabilityEnvelopeBatchExpire({
      writerPool: pool,
      mode: "apply",
      requestedBy: "gpt_admin",
      expiredBefore: cutoff,
      maxItems: 50,
      expectedPlanSha256: "f".repeat(64),
      confirm: "EXPIRE_CAPABILITY_ENVELOPES_FFFFFFFFFFFF",
      capabilityEnvelopeId: governanceEnvelopeId,
      reason: "Reject changed batch plan after the reviewed dry run.",
    }),
    (error) => error.code === "capability_envelope_batch_expire_plan_changed" && error.status === 409,
  );
  assert.equal(pool.committed, false);
  assert.equal(pool.rolledBack, true);
  assert.ok(pool.rows.every((row) => row.envelope_status !== "expired"));
}

const guardSource = readFileSync(new URL("./capabilityResolutionEnvelopeGuard.js", import.meta.url), "utf8");
assert.match(guardSource, /writerPool/);
assert.match(guardSource, /normalizedMode !== "apply"/);
assert.match(guardSource, /getGovernancePool/);

const runtimeSource = readFileSync(new URL("./capabilityResolutionEnvelopeGuardRuntime.js", import.meta.url), "utf8");
assert.match(runtimeSource, /execution_ref IS NULL/);
assert.match(runtimeSource, /execution_status = 'not_executed'/);
assert.match(runtimeSource, /FOR UPDATE/);
assert.match(runtimeSource, /candidate_limit_exceeded/);
assert.match(runtimeSource, /transitionCapabilityEnvelopeLifecycle/);
assert.doesNotMatch(runtimeSource, /DELETE FROM capability_resolution_envelope_ledger/);

const gptToolsRoutes = readFileSync(new URL("./routes/gptToolsRoutes.js", import.meta.url), "utf8");
assert.match(gptToolsRoutes, /name: "capability_resolution_envelope_batch_expire"/);
assert.match(gptToolsRoutes, /internal:\/\/capability-resolution-envelope-batch-expire/);
assert.match(gptToolsRoutes, /CAPABILITY_ENVELOPE_BATCH_EXPIRE_MODES/);
assert.match(gptToolsRoutes, /runCapabilityEnvelopeBatchExpire/);
assert.match(gptToolsRoutes, /toolKey === "capability_resolution_envelope_batch_expire"/);
assert.match(gptToolsRoutes, /"typed_confirmation", "capability_envelope", "same_cycle_readback"/);

console.log("Capability envelope batch expiration tests passed");
