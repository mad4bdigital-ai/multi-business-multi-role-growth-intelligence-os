import assert from "node:assert/strict";
import { createSessionInsightPromotionApplyRequest } from "./sessionInsightPromotionApplyRequestService.js";

function makePool() {
  const state = {
    calls: [],
    inserts: [],
    request: null,
    source: {
      preview_id: "promo_preview_1",
      promotion_id: "promo-1",
      insight_id: "ins-1",
      preview_promotion_type: "development_backlog_item",
      preview_target_surface: "development_backlog",
      preview_execution_allowed: 0,
      proposed_write_json: JSON.stringify({
        proposed_surface: "development_backlog",
        proposed_operation: "would_create_development_backlog_item",
        source_promotion_id: "promo-1",
        source_insight_id: "ins-1",
        runtime_write_executed: false,
        backlog_policy_canonical_write_executed: false,
        provider_call_executed: false,
        external_write_executed: false,
        raw_transcript_included: false,
        secrets_included: false,
      }),
      blockers_json: JSON.stringify(["executor_layer_not_implemented"]),
      dry_run_result_json: JSON.stringify({ execution_allowed: false, no_runtime_effects: true }),
      preview_safety_contract_json: JSON.stringify({ runtime_promotion_executed: false, secrets_included: false }),
      preview_secrets_included: 0,
      promotion_type: "development_backlog_item",
      target_surface: "development_backlog",
      decision_status: "approved",
      approval_status: "approved",
      promotion_status: "ready",
      promotion_allowed: 0,
      promotion_executor_key: null,
      proposal_title: "Approved development proposal",
      proposal_text: "Would become a development backlog item later.",
      tenant_id: "tenant-1",
      workspace_key: "workspace-1",
      target_scope_type: "workspace",
      target_scope_ref: "workspace-1",
      promotion_secrets_included: 0,
    },
  };
  return {
    state,
    async query(sql, params = []) {
      state.calls.push({ sql, params });
      const compact = String(sql).replace(/\s+/g, " ").trim();
      if (compact.startsWith("SELECT e.preview_id")) {
        return [[{ ...state.source }]];
      }
      if (compact.startsWith("INSERT INTO session_insight_promotion_apply_requests")) {
        assert(compact.includes("'blocked_requires_capability_envelope', 1, NULL"), "apply request must stay capability-gated");
        assert(compact.includes("1, NULL, 0, 'not_executed'"), "apply request must require adapter and keep execution disabled");
        const proposedWrite = JSON.parse(params[7]);
        const gating = JSON.parse(params[8]);
        const safety = JSON.parse(params[9]);
        assert.equal(proposedWrite.backlog_policy_canonical_write_executed, false);
        assert(gating.blockers.includes("capability_envelope_required"));
        assert(gating.blockers.includes("target_adapter_required"));
        assert(gating.blockers.includes("apply_executor_not_implemented"));
        assert.equal(gating.execution_allowed, false);
        assert.equal(safety.execution_allowed, false);
        assert.equal(safety.runtime_promotion_executed, false);
        assert.equal(safety.backlog_policy_canonical_write_executed, false);
        assert.equal(safety.provider_call_executed, false);
        assert.equal(safety.secrets_included, false);
        state.request = {
          apply_request_id: params[0],
          preview_id: params[1],
          promotion_id: params[2],
          insight_id: params[3],
          promotion_type: params[4],
          target_surface: params[5],
          requested_operation: params[6],
          request_status: "blocked_requires_capability_envelope",
          capability_envelope_required: 1,
          capability_envelope_id: null,
          adapter_key_required: 1,
          target_adapter_key: null,
          execution_allowed: 0,
          execution_status: "not_executed",
          proposed_write_json: params[7],
          gating_result_json: params[8],
          safety_contract_json: params[9],
          requested_by: params[10],
          decision_notes: params[11],
          secrets_included: 0,
        };
        state.inserts.push({ sql, params });
        return [{ affectedRows: 1 }];
      }
      if (compact.startsWith("SELECT * FROM session_insight_promotion_apply_requests")) {
        return [[{ ...state.request }]];
      }
      return [[]];
    },
  };
}

{
  const pool = makePool();
  const result = await createSessionInsightPromotionApplyRequest({
    pool,
    input: { preview_id: "promo_preview_1", requested_by: "gpt_admin", decision_notes: "Create blocked apply request." },
  });
  assert.equal(result.ok, true);
  assert.equal(result.apply_request.preview_id, "promo_preview_1");
  assert.equal(result.apply_request.request_status, "blocked_requires_capability_envelope");
  assert.equal(result.apply_request.capability_envelope_required, true);
  assert.equal(result.apply_request.capability_envelope_id, null);
  assert.equal(result.apply_request.adapter_key_required, true);
  assert.equal(result.apply_request.target_adapter_key, null);
  assert.equal(result.apply_request.execution_allowed, false);
  assert.equal(result.apply_request.execution_status, "not_executed");
  assert.equal(result.safety_contract.skeleton_only, true);
  assert.equal(result.safety_contract.runtime_promotion_executed, false);
  assert.equal(result.safety_contract.backlog_policy_canonical_write_executed, false);
  assert.equal(result.safety_contract.external_write_executed, false);
  assert.equal(result.safety_contract.secrets_included, false);
  assert.equal(pool.state.inserts.length, 1);
}

{
  const pool = makePool();
  await assert.rejects(
    () => createSessionInsightPromotionApplyRequest({ pool, input: {} }),
    /preview_id is required/
  );
}

{
  const pool = makePool();
  pool.state.source.preview_secrets_included = 1;
  await assert.rejects(
    () => createSessionInsightPromotionApplyRequest({ pool, input: { preview_id: "promo_preview_1" } }),
    /secret-flagged preview or promotion/
  );
}

console.log("session insight promotion apply request service tests passed");
