import assert from "node:assert/strict";
import { readSessionInsightTargetAdapterRegistry } from "./sessionInsightPromotionTargetAdapterRegistryService.js";

function makePool() {
  const state = { calls: [] };
  return {
    state,
    async query(sql, params = []) {
      state.calls.push({ sql, params });
      const compact = String(sql).replace(/\s+/g, " ").trim();
      if (compact.startsWith("SELECT a.*")) {
        assert(compact.includes("a.secrets_included = 0"), "registry list must exclude secret flagged adapters");
        return [[
          {
            adapter_key: "session_insight.development_backlog.skeleton_adapter",
            display_name: "Development Backlog Skeleton Adapter",
            promotion_type: "development_backlog_item",
            target_surface: "development_backlog",
            target_operation: "would_create_development_backlog_item",
            adapter_family: "development_backlog_executor",
            implementation_status: "skeleton",
            execution_mode: "registry_only",
            apply_supported: 0,
            capability_key_required: "session_insight_development_backlog_apply",
            capability_envelope_required: 1,
            dry_run_tool_key: "session_insight_promotion_executor_dry_run",
            apply_tool_key: null,
            policy_key: "session_insight_target_adapter_registry_policy_v1",
            validator_commands_json: JSON.stringify(["node test-session-insight-target-adapter-registry-service.mjs"]),
            safety_contract_json: JSON.stringify({
              registry_only: true,
              apply_supported: false,
              capability_envelope_required: true,
              target_adapter_implementation_required: true,
              runtime_promotion_executed: false,
              backlog_policy_canonical_write_executed: false,
              provider_call_executed: false,
              credential_payload_read: false,
              external_write_executed: false,
              raw_transcript_included: false,
              secrets_included: false,
            }),
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
            requested_operation: "would_create_development_backlog_item",
            request_status: "blocked_requires_capability_envelope",
            execution_allowed: 0,
            execution_status: "not_executed",
            adapter_key: "session_insight.development_backlog.skeleton_adapter",
            adapter_status: "active",
            adapter_apply_supported: 0,
            capability_key_required: "session_insight_development_backlog_apply",
            mapping_status: "mapped_skeleton_blocked_for_capability_envelope",
            blockers_json: JSON.stringify([
              "capability_envelope_required",
              "target_adapter_apply_not_implemented",
              "apply_supported_false_by_policy",
            ]),
          },
        ]];
      }
      return [[]];
    },
  };
}

{
  const pool = makePool();
  const result = await readSessionInsightTargetAdapterRegistry({ pool, filters: { limit: 5 } });
  assert.equal(result.ok, true);
  assert.equal(result.adapter_count, 1);
  assert.equal(result.adapters[0].implementation_status, "skeleton");
  assert.equal(result.adapters[0].apply_supported, false);
  assert.equal(result.adapters[0].capability_envelope_required, true);
  assert.equal(result.adapters[0].apply_tool_key, null);
  assert.equal(result.adapters[0].safety_contract.backlog_policy_canonical_write_executed, false);
  assert.equal(result.adapters[0].safety_contract.provider_call_executed, false);
  assert.equal(result.adapters[0].safety_contract.secrets_included, false);
  assert.equal(result.apply_request_mappings[0].mapping_status, "mapped_skeleton_blocked_for_capability_envelope");
  assert.equal(result.apply_request_mappings[0].execution_allowed, false);
  assert.equal(result.apply_request_mappings[0].adapter_apply_supported, false);
  assert(result.apply_request_mappings[0].blockers.includes("apply_supported_false_by_policy"));
  assert.equal(result.registry_policy.registry_only, true);
  assert.equal(result.registry_policy.apply_supported_default, false);
  assert.equal(result.registry_policy.execution_allowed, false);
  assert.equal(result.registry_policy.secrets_included, false);
}

console.log("session insight target adapter registry service tests passed");
