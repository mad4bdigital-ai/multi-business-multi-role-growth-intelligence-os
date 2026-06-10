import assert from "node:assert/strict";
import { readSessionInsightAdapterDryRunContracts } from "./sessionInsightPromotionAdapterContractService.js";

function makePool() {
  const state = { calls: [] };
  return {
    state,
    async query(sql, params = []) {
      state.calls.push({ sql, params });
      const compact = String(sql).replace(/\s+/g, " ").trim();
      if (compact.startsWith("SELECT c.*")) {
        assert(compact.includes("c.secrets_included = 0"), "contract list must exclude secret flagged contracts");
        return [[
          {
            contract_key: "session_insight.development_backlog.dry_run_contract.v1",
            adapter_key: "session_insight.development_backlog.skeleton_adapter",
            promotion_type: "development_backlog_item",
            target_surface: "development_backlog",
            contract_version: "v1",
            contract_status: "active",
            contract_mode: "dry_run_contract",
            payload_schema_json: JSON.stringify({ type: "object", additionalProperties: false }),
            required_fields_json: JSON.stringify(["title", "description", "source_promotion_id", "source_insight_id"]),
            forbidden_fields_json: JSON.stringify(["secret", "password", "token", "credential_payload", "provider_call", "external_write", "execute"]),
            sample_payload_json: JSON.stringify({ title: "Development backlog draft", description: "Dry-run only." }),
            validator_rules_json: JSON.stringify(["must_include_source_ids", "must_not_write_backlog"]),
            safety_contract_json: JSON.stringify({
              dry_run_contract_only: true,
              apply_supported: false,
              execution_allowed: false,
              runtime_promotion_executed: false,
              backlog_policy_canonical_write_executed: false,
              provider_call_executed: false,
              credential_payload_read: false,
              external_write_executed: false,
              raw_transcript_included: false,
              secrets_included: false,
            }),
            apply_supported: 0,
            execution_allowed: 0,
            status: "active",
            secrets_included: 0,
          },
        ]];
      }
      if (compact.startsWith("SELECT r.apply_request_id")) {
        return [[
          {
            apply_request_id: "promo_apply_req_1",
            preview_id: "promo_preview_1",
            promotion_id: "promo_1",
            promotion_type: "development_backlog_item",
            target_surface: "development_backlog",
            adapter_key: "session_insight.development_backlog.skeleton_adapter",
            adapter_readiness_status: "mapped_skeleton_blocked_for_capability_envelope",
            contract_key: "session_insight.development_backlog.dry_run_contract.v1",
            contract_status: "active",
            contract_mode: "dry_run_contract",
            request_status: "blocked_requires_capability_envelope",
            contract_readiness_status: "mapped_dry_run_contract_blocked_for_apply_adapter",
            execution_allowed: 0,
            apply_supported: 0,
            blockers_json: JSON.stringify(["dry_run_contract_only", "target_adapter_apply_not_implemented"]),
          },
        ]];
      }
      return [[]];
    },
  };
}

{
  const pool = makePool();
  const result = await readSessionInsightAdapterDryRunContracts({ pool, filters: { limit: 5 } });
  assert.equal(result.ok, true);
  assert.equal(result.contract_count, 1);
  assert.equal(result.contracts[0].contract_mode, "dry_run_contract");
  assert.equal(result.contracts[0].apply_supported, false);
  assert.equal(result.contracts[0].execution_allowed, false);
  assert(result.contracts[0].required_fields.includes("source_promotion_id"));
  assert(result.contracts[0].forbidden_fields.includes("credential_payload"));
  assert.equal(result.contracts[0].safety_contract.backlog_policy_canonical_write_executed, false);
  assert.equal(result.contracts[0].safety_contract.provider_call_executed, false);
  assert.equal(result.contracts[0].safety_contract.secrets_included, false);
  assert.equal(result.apply_request_mappings[0].contract_readiness_status, "mapped_dry_run_contract_blocked_for_apply_adapter");
  assert.equal(result.apply_request_mappings[0].execution_allowed, false);
  assert.equal(result.apply_request_mappings[0].apply_supported, false);
  assert(result.apply_request_mappings[0].blockers.includes("dry_run_contract_only"));
  assert.equal(result.contract_policy.dry_run_contract_only, true);
  assert.equal(result.contract_policy.execution_allowed, false);
  assert.equal(result.contract_policy.secrets_included, false);
}

console.log("session insight adapter dry-run contract service tests passed");
