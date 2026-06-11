import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

for (const migrationFile of [
  "278_sprint68_session_insight_capability_envelope_actual_request_preflight.sql",
  "279_sprint68_session_insight_capability_envelope_actual_request_dispatch.sql",
  "280_sprint68_session_insight_capability_envelope_approval_gate.sql",
]) {
  const migrationSql = readFileSync(`migrations/${migrationFile}`, "utf8");
  const objectNames = Array.from(migrationSql.matchAll(/CREATE (?:TABLE IF NOT EXISTS|OR REPLACE VIEW) `([^`]+)`/g), (match) => match[1]);
  for (const objectName of objectNames) {
    assert(objectName.length <= 64, `${migrationFile}: ${objectName} must fit MySQL/MariaDB 64-character identifier limit`);
  }
}

const bindingHardeningMigration = readFileSync("migrations/910_sprint68_session_insight_capability_binding_hardening.sql", "utf8");
const governedMigrationRunner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

for (const expected of [
  "session_insight",
  "session_insight_development_backlog_apply",
  "session_insight_integration_backlog_apply",
  "session_insight_runtime_repair_backlog_apply",
  "session_insight_backlog_target_write_execute",
  "credential_source", "'none'",
  "provider_calls_allowed", "false",
  "credential_payload_reads_allowed", "false",
  "external_writes_allowed", "false",
  "secrets_included", "false",
]) {
  assert(bindingHardeningMigration.includes(expected), `binding hardening migration must include ${expected}`);
}
assert(governedMigrationRunner.includes("910_sprint68_session_insight_capability_binding_hardening.sql"), "governed migration runner must allowlist migration 910");

import {
  createSessionInsightCapabilityEnvelopeActualRequest,
  listSessionInsightCapabilityEnvelopeActualRequests,
} from "./sessionInsightCapabilityEnvelopeActualRequestService.js";

const REQUIRED_TYPED_CONFIRM = "REQUEST_ACTUAL_CAPABILITY_ENVELOPE_NO_EXECUTION";

function makePool() {
  const dispatchPayload = JSON.stringify({
    app_key: "session_insight",
    workspace_key: "workspace-1",
    dispatch_not_called: true,
    actual_capability_envelope_requested: false,
    approval_hold_created: false,
    adapter_apply_executed: false,
    execution_allowed: false,
    target_write_allowed: false,
    secrets_included: false,
  });
  const validationPayload = JSON.stringify({ valid_for_dispatch_dry_run: true, secrets_included: false });
  const preflightResult = JSON.stringify({ valid_for_actual_request_preflight: true, secrets_included: false });
  const state = {
    calls: [],
    insert: null,
    actualRequest: null,
    preflight: {
      actual_request_preflight_id: "capability_actual_request_preflight_1",
      dispatch_dry_run_id: "capability_dispatch_dry_run_1",
      request_gate_id: "capability_request_gate_1",
      capability_plan_id: "capability_plan_1",
      payload_preview_id: "payload_preview_1",
      apply_request_id: "promo_apply_req_1",
      promotion_id: "promo_1",
      insight_id: "ins_1",
      target_surface: "development_backlog",
      promotion_type: "development_backlog_item",
      capability_key: "session_insight_development_backlog_apply",
      operation_intent: "development_backlog_item",
      runtime_surface: "development_backlog",
      preflight_status: "actual_request_preflight_passed",
      preflight_policy_status: "ready_for_actual_capability_envelope_request",
      actual_capability_envelope_requested: 0,
      actual_capability_envelope_id: null,
      approval_hold_created: 0,
      execution_allowed: 0,
      target_write_allowed: 0,
      dispatch_status: "dispatch_dry_run_generated",
      dispatch_mode: "dry_run_no_dispatch",
      dispatch_review_status: "dispatch_dry_run_approved",
      dispatch_policy_status: "dispatch_dry_run_approved_but_not_dispatched",
      dispatch_payload_json: dispatchPayload,
      validation_result_json: validationPayload,
      request_review_status: "request_approved",
      request_policy_status: "request_approved_but_not_dispatched",
      tenant_id: "tenant-1",
      user_id: "user-1",
      workspace_key: "workspace-1",
      promotion_decision_status: "approved",
      promotion_approval_status: "approved",
      promotion_status: "ready",
      promotion_allowed: 0,
      source_dispatch_payload_sha256: "",
      source_validation_sha256: "",
      preflight_result_json: preflightResult,
      secrets_included: 0,
      dispatch_secrets_included: 0,
      request_gate_secrets_included: 0,
      promotion_secrets_included: 0,
    },
  };
  return {
    state,
    async query(sql, params = []) {
      state.calls.push({ sql, params });
      const compact = String(sql).replace(/\s+/g, " ").trim();
      if (compact.startsWith("SELECT p.*, d.dispatch_status")) {
        const crypto = await import("node:crypto");
        const sha = (value) => crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
        return [[{
          ...state.preflight,
          source_dispatch_payload_sha256: sha(state.preflight.dispatch_payload_json),
          source_validation_sha256: sha(state.preflight.validation_result_json),
        }]];
      }
      if (compact.startsWith("SELECT COUNT(*) AS count FROM session_insight_capability_envelope_actual_requests")) {
        return [[{ count: state.actualRequest ? 1 : 0 }]];
      }
      if (compact.startsWith("INSERT INTO session_insight_capability_envelope_actual_requests")) {
        assert(compact.includes("'actual_envelope_requested'"), "actual request must record envelope request");
        assert(compact.includes("'actual_envelope_requested_but_not_approved'"), "actual request must remain unapproved");
        assert(compact.includes("1, ?, ?, ?, ?, ?, 0, 0, 0"), "actual request must not create hold, execution, or target write");
        const requestPayload = JSON.parse(params[20]);
        const requestResult = JSON.parse(params[21]);
        const safety = JSON.parse(params[22]);
        assert.equal(requestPayload.typed_confirm, REQUIRED_TYPED_CONFIRM);
        assert.equal(requestPayload.calls_capability_resolution, true);
        assert.equal(requestPayload.creates_actual_capability_envelope, true);
        assert.equal(requestPayload.creates_approval_hold, false);
        assert.equal(requestPayload.execution_allowed, false);
        assert.equal(requestPayload.target_write_allowed, false);
        assert.equal(requestResult.envelope_id, "actual_envelope_1");
        assert.equal(safety.actual_request_ledger_only, true);
        assert.equal(safety.actual_capability_envelope_requested, true);
        assert.equal(safety.approval_hold_created, false);
        assert.equal(safety.adapter_apply_executed, false);
        assert.equal(safety.execution_allowed, false);
        assert.equal(safety.target_write_allowed, false);
        assert.equal(safety.secrets_included, false);
        state.actualRequest = {
          actual_request_id: params[0],
          actual_request_preflight_id: params[1],
          dispatch_dry_run_id: params[2],
          request_gate_id: params[3],
          capability_plan_id: params[4],
          payload_preview_id: params[5],
          apply_request_id: params[6],
          promotion_id: params[7],
          insight_id: params[8],
          target_surface: params[9],
          promotion_type: params[10],
          capability_key: params[11],
          operation_intent: params[12],
          runtime_surface: params[13],
          actual_request_status: "actual_envelope_requested",
          actual_request_policy_status: "actual_envelope_requested_but_not_approved",
          actual_capability_envelope_requested: 1,
          actual_capability_envelope_id: params[14],
          actual_capability_envelope_status: params[15],
          actual_capability_envelope_decision: params[16],
          actual_capability_envelope_dispatch_allowed: params[17],
          actual_capability_envelope_apply_allowed: params[18],
          approval_hold_created: 0,
          execution_allowed: 0,
          target_write_allowed: 0,
          source_preflight_sha256: params[19],
          request_payload_json: params[20],
          request_result_json: params[21],
          safety_contract_json: params[22],
          typed_confirm: params[23],
          created_by: params[24],
          secrets_included: 0,
        };
        state.insert = { sql, params };
        return [{ affectedRows: 1 }];
      }
      if (compact.startsWith("SELECT * FROM session_insight_capability_envelope_actual_requests WHERE actual_request_id")) {
        return [[{ ...state.actualRequest }]];
      }
      if (compact.startsWith("SELECT r.* FROM session_insight_capability_envelope_actual_requests")) {
        return [[{ ...state.actualRequest }]];
      }
      if (compact.startsWith("SELECT actual_request_status")) {
        return [[{
          actual_request_status: "actual_envelope_requested",
          actual_request_policy_status: "actual_envelope_requested_but_not_approved",
          approval_hold_created: 0,
          execution_allowed: 0,
          target_write_allowed: 0,
          count: 1,
        }]];
      }
      if (compact.startsWith("SELECT issue_code")) {
        return [[]];
      }
      return [[]];
    },
  };
}

const mockEnvelopeCreator = async ({ requestedBy, ttlMinutes, passthrough }) => {
  assert.equal(requestedBy, "gpt_admin");
  assert.equal(ttlMinutes, 60);
  assert(passthrough.includes("--tenant-id"));
  assert(passthrough.includes("tenant-1"));
  assert.equal(passthrough.includes("--explain"), false, "actual request passthrough must not include explain policy payloads");
  return {
    ok: true,
    envelope_id: "actual_envelope_1",
    envelope_status: "ready_requires_approval",
    decision: "ready_requires_approval",
    dispatch_allowed: true,
    apply_allowed: false,
    approval_required: true,
    blocking_gap_count: 0,
    secrets_included: false,
  };
};

{
  const pool = makePool();
  const result = await createSessionInsightCapabilityEnvelopeActualRequest({
    pool,
    capabilityEnvelopeCreator: mockEnvelopeCreator,
    input: {
      actual_request_preflight_id: "capability_actual_request_preflight_1",
      typed_confirm: REQUIRED_TYPED_CONFIRM,
      created_by: "gpt_admin",
      ttl_minutes: 60,
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.actual_request.actual_capability_envelope_requested, true);
  assert.equal(result.actual_request.actual_capability_envelope_id, "actual_envelope_1");
  assert.equal(result.actual_request.actual_capability_envelope_status, "ready_requires_approval");
  assert.equal(result.actual_request.approval_hold_created, false);
  assert.equal(result.actual_request.execution_allowed, false);
  assert.equal(result.actual_request.target_write_allowed, false);
  assert.equal(result.safety_contract.actual_capability_envelope_requested, true);
  assert.equal(result.safety_contract.approval_hold_created, false);
  assert.equal(result.safety_contract.adapter_apply_executed, false);
  assert.equal(result.safety_contract.target_write_allowed, false);
  assert.equal(pool.state.insert !== null, true);
}

{
  const pool = makePool();
  await createSessionInsightCapabilityEnvelopeActualRequest({
    pool,
    capabilityEnvelopeCreator: mockEnvelopeCreator,
    input: { actual_request_preflight_id: "capability_actual_request_preflight_1", typed_confirm: REQUIRED_TYPED_CONFIRM, created_by: "gpt_admin" },
  });
  const result = await listSessionInsightCapabilityEnvelopeActualRequests({ pool, filters: { limit: 5 } });
  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.equal(result.actual_requests[0].actual_capability_envelope_requested, true);
  assert.equal(result.actual_requests[0].approval_hold_created, false);
  assert.equal(result.actual_requests[0].execution_allowed, false);
  assert.equal(result.actual_requests[0].target_write_allowed, false);
  assert.equal(result.issues.length, 0);
  assert.equal(result.actual_request_policy.requires_typed_confirm, REQUIRED_TYPED_CONFIRM);
  assert.equal(result.actual_request_policy.creates_approval_hold, false);
  assert.equal(result.actual_request_policy.secrets_included, false);
}

{
  const pool = makePool();
  await assert.rejects(
    () => createSessionInsightCapabilityEnvelopeActualRequest({
      pool,
      capabilityEnvelopeCreator: mockEnvelopeCreator,
      input: { actual_request_preflight_id: "capability_actual_request_preflight_1", typed_confirm: "WRONG" },
    }),
    /typed_confirm must equal REQUEST_ACTUAL_CAPABILITY_ENVELOPE_NO_EXECUTION/
  );
}

{
  const pool = makePool();
  pool.state.preflight.preflight_status = "actual_request_preflight_blocked";
  await assert.rejects(
    () => createSessionInsightCapabilityEnvelopeActualRequest({
      pool,
      capabilityEnvelopeCreator: mockEnvelopeCreator,
      input: { actual_request_preflight_id: "capability_actual_request_preflight_1", typed_confirm: REQUIRED_TYPED_CONFIRM },
    }),
    /actual capability envelope request validation failed/
  );
}

console.log("session insight capability envelope actual request service tests passed");
