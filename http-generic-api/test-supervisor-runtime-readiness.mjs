import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  inspectStaticSupervisorRuntimeReadiness,
  inspectLiveSupervisorSchema,
} from "./supervisorRuntimeReadiness.js";

const staticResult = inspectStaticSupervisorRuntimeReadiness();
const readinessSource = readFileSync(new URL("./supervisorRuntimeReadiness.js", import.meta.url), "utf8");
const cliSource = readFileSync(new URL("./scripts/supervisor-runtime-readiness.mjs", import.meta.url), "utf8");
assert.match(readinessSource, /BINARY a\.execution_layer = BINARY tr\.execution_layer/);
assert.match(readinessSource, /BINARY sg\.agent_id = BINARY a\.agent_id/);
assert.match(readinessSource, /BINARY fallback\.agent_id = BINARY source\.fallback_agent_id/);
assert.match(cliSource, /finally \{/);
assert.match(cliSource, /await getPool\(\)\.end\(\)/);
assert.equal(staticResult.mode, "static");
assert.equal(staticResult.secrets_included, false);
assert.equal(staticResult.checks.find((item) => item.id === "atomic_plan_dispatch_claim")?.ok, true);
assert.equal(staticResult.checks.find((item) => item.id === "claimed_plan_failure_recovery")?.ok, true);
assert.equal(staticResult.checks.find((item) => item.id === "deterministic_healthy_agent_selection")?.ok, true);
assert.equal(staticResult.checks.find((item) => item.id === "skill_gate_fail_closed")?.ok, true);
assert.equal(staticResult.checks.find((item) => item.id === "fallback_agent_runtime")?.ok, true);
assert.equal(staticResult.checks.find((item) => item.id === "chain_cycle_depth_guard")?.ok, true);
assert.equal(staticResult.checks.find((item) => item.id === "global_capability_envelope_gate")?.ok, true);
assert.equal(staticResult.execution_ready, true);

const mockPool = {
  async query(sql) {
    if (sql.includes("information_schema.TABLES")) {
      return [[
        "agents",
        "agent_delegations",
        "agent_skills",
        "agent_skill_grants",
        "task_routes",
        "execution_plans",
        "workflow_runs",
        "step_runs",
        "agent_chain_events",
        "agent_handoff_state_registry",
        "capability_resolution_envelope_ledger",
        "budget_quota_authority_registry",
      ].map((TABLE_NAME) => ({ TABLE_NAME }))];
    }
    if (sql.includes("information_schema.COLUMNS")) {
      return [[
        ["agents", "agent_id"], ["agents", "health_status"], ["agents", "fallback_agent_id"],
        ["execution_plans", "plan_id"], ["execution_plans", "agent_id"], ["execution_plans", "plan_status"],
        ["agent_chain_events", "event_id"], ["agent_chain_events", "root_event_id"],
        ["agent_chain_events", "parent_event_id"], ["agent_chain_events", "chain_depth"],
        ["agent_chain_events", "max_chain_depth"], ["agent_chain_events", "workflow_path_json"],
        ["agent_chain_events", "source_run_id"], ["agent_chain_events", "dispatched_run_id"],
        ["agent_chain_events", "target_workflow_key"], ["agent_chain_events", "fallback_agent_id"],
        ["agent_chain_events", "status"], ["agent_chain_events", "failure_reason"],
        ["agent_handoff_state_registry", "state_id"], ["agent_handoff_state_registry", "tenant_id"],
        ["agent_handoff_state_registry", "expires_at"], ["agent_handoff_state_registry", "consumed_at"],
        ["agent_handoff_state_registry", "revoked_at"],
      ].map(([TABLE_NAME, COLUMN_NAME]) => ({ TABLE_NAME, COLUMN_NAME }))];
    }
    if (sql.includes("FROM task_routes tr")) return [[]];
    if (sql.includes("FROM agents source")) return [[]];
    throw new Error("Unexpected readiness query");
  },
};

const liveResult = await inspectLiveSupervisorSchema({ pool: mockPool });
assert.equal(liveResult.ok, true);
assert.equal(liveResult.schema_ready, true);
assert.equal(liveResult.secrets_included, false);

console.log("supervisor runtime readiness tests passed");
