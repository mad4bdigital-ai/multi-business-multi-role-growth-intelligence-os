import assert from "node:assert/strict";
import { generateSessionInsightContractPayloadPreview } from "./sessionInsightPromotionPayloadPreviewService.js";

function makePool() {
  const state = { calls: [], insert: null, row: null };
  return {
    state,
    async query(sql, params = []) {
      state.calls.push({ sql, params });
      const compact = String(sql).replace(/\s+/g, " ").trim();
      if (compact.startsWith("SELECT r.apply_request_id")) {
        return [[{
          apply_request_id: "promo_apply_req_1",
          preview_id: "promo_preview_1",
          promotion_id: "promo_1",
          insight_id: "ins_1",
          promotion_type: "development_backlog_item",
          target_surface: "development_backlog",
          request_status: "blocked_requires_capability_envelope",
          apply_request_execution_allowed: 0,
          proposed_write_json: JSON.stringify({
            proposed_surface: "development_backlog",
            proposed_operation: "would_create_development_backlog_item",
            title: "Payload preview test",
            body: "Generate a dry-run development backlog payload.",
            backlog_policy_canonical_write_executed: false,
            provider_call_executed: false,
            external_write_executed: false,
            secrets_included: false,
          }),
          apply_request_secrets_included: 0,
          proposal_title: "Payload preview proposal",
          proposal_text: "Proposal text.",
          risk_level: "medium",
          confidence: 0.75,
          promotion_secrets_included: 0,
          contract_key: "session_insight.development_backlog.dry_run_contract.v1",
          adapter_key: "session_insight.development_backlog.skeleton_adapter",
          contract_mode: "dry_run_contract",
          contract_status: "active",
          payload_schema_json: JSON.stringify({ type: "object" }),
          required_fields_json: JSON.stringify(["title", "description", "acceptance_criteria", "source_promotion_id", "source_insight_id", "risk_level", "confidence"]),
          forbidden_fields_json: JSON.stringify(["secret", "password", "token", "credential_payload", "provider_call", "external_write", "execute", "apply_now"]),
          sample_payload_json: JSON.stringify({ title: "Development backlog draft", description: "Dry-run only." }),
          validator_rules_json: JSON.stringify(["must_include_source_ids", "must_not_write_backlog"]),
          contract_safety_contract_json: JSON.stringify({ dry_run_contract_only: true, secrets_included: false }),
          apply_supported: 0,
          contract_execution_allowed: 0,
          contract_secrets_included: 0,
          adapter_readiness_status: "mapped_skeleton_blocked_for_capability_envelope",
          contract_readiness_status: "mapped_dry_run_contract_blocked_for_apply_adapter",
        }]];
      }
      if (compact.startsWith("INSERT INTO session_insight_promotion_payload_previews")) {
        assert(compact.includes("'dry_run_payload_preview', 0, 0"), "payload preview insert must be dry-run and disallow execution/target write");
        const payload = JSON.parse(params[10]);
        const validation = JSON.parse(params[11]);
        const safety = JSON.parse(params[12]);
        assert.equal(payload.source_promotion_id, "promo_1");
        assert.equal(payload.source_insight_id, "ins_1");
        assert(Array.isArray(payload.acceptance_criteria));
        assert.equal(validation.valid_for_dry_run_contract, true);
        assert(validation.blockers.includes("dry_run_payload_preview_only"));
        assert(validation.blockers.includes("target_adapter_apply_not_implemented"));
        assert.equal(safety.payload_preview_only, true);
        assert.equal(safety.execution_allowed, false);
        assert.equal(safety.target_write_allowed, false);
        assert.equal(safety.backlog_policy_canonical_write_executed, false);
        assert.equal(safety.provider_call_executed, false);
        assert.equal(safety.secrets_included, false);
        state.insert = { sql, params };
        state.row = {
          payload_preview_id: params[0],
          apply_request_id: params[1],
          preview_id: params[2],
          promotion_id: params[3],
          insight_id: params[4],
          adapter_key: params[5],
          contract_key: params[6],
          target_surface: params[7],
          promotion_type: params[8],
          payload_status: params[9],
          payload_mode: "dry_run_payload_preview",
          execution_allowed: 0,
          target_write_allowed: 0,
          payload_json: params[10],
          validation_result_json: params[11],
          safety_contract_json: params[12],
          created_by: params[13],
          secrets_included: 0,
        };
        return [{ affectedRows: 1 }];
      }
      if (compact.startsWith("SELECT * FROM session_insight_promotion_payload_previews")) {
        return [[{ ...state.row }]];
      }
      return [[]];
    },
  };
}

{
  const pool = makePool();
  const result = await generateSessionInsightContractPayloadPreview({
    pool,
    input: { apply_request_id: "promo_apply_req_1", created_by: "test_payload_preview" },
  });
  assert.equal(result.ok, true);
  assert.equal(result.payload_preview.apply_request_id, "promo_apply_req_1");
  assert.equal(result.payload_preview.payload_mode, "dry_run_payload_preview");
  assert.equal(result.payload_preview.execution_allowed, false);
  assert.equal(result.payload_preview.target_write_allowed, false);
  assert.equal(result.payload_preview.validation_result.valid_for_dry_run_contract, true);
  assert.equal(result.payload_preview.payload_json.source_promotion_id, "promo_1");
  assert.equal(result.payload_preview.safety_contract.runtime_promotion_executed, false);
  assert.equal(result.payload_preview.safety_contract.external_write_executed, false);
  assert.equal(result.payload_preview.safety_contract.secrets_included, false);
  assert.equal(pool.state.insert !== null, true);
}

{
  const pool = makePool();
  await assert.rejects(
    () => generateSessionInsightContractPayloadPreview({ pool, input: {} }),
    /apply_request_id is required/
  );
}

{
  const pool = makePool();
  const originalQuery = pool.query.bind(pool);
  pool.query = async (sql, params = []) => {
    const compact = String(sql).replace(/\s+/g, " ").trim();
    if (compact.startsWith("SELECT r.apply_request_id")) {
      const [rows] = await originalQuery(sql, params);
      rows[0].contract_secrets_included = 1;
      return [rows];
    }
    return originalQuery(sql, params);
  };
  await assert.rejects(
    () => generateSessionInsightContractPayloadPreview({ pool, input: { apply_request_id: "promo_apply_req_1" } }),
    /secret-flagged apply request, promotion, or contract/
  );
}

console.log("session insight contract payload preview service tests passed");
