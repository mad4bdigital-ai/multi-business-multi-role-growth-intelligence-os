import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chain = readFileSync(new URL("./chainEventDispatcher.js", import.meta.url), "utf8");
const sink = readFileSync(new URL("./outputSinkRouter.js", import.meta.url), "utf8");
const connector = readFileSync(new URL("./connectorExecutor.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/1003_sprint68_supervisor_chain_runtime_guards.sql", import.meta.url), "utf8");
const grantMigration = readFileSync(new URL("./migrations/1006_sprint69_supervisor_route_logic_skill_grants.sql", import.meta.url), "utf8");
const historicalChainMigration = readFileSync(new URL("./migrations/1007_sprint69_archive_invalid_historical_chain_events.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");

assert.match(connector, /required_agent_skill_grant_missing/);
assert.match(connector, /agent_skill_grant_resolution_failed/);
assert.match(connector, /validateDispatchCapabilityEnvelope/);
assert.match(connector, /resolveCapabilityExecutionEnvelope/);
assert.ok(
  connector.indexOf("const skillGrant = await validateAgentSkillGrant") < connector.indexOf("SET plan_status = 'executing'"),
  "skill grant validation must run before plan claim"
);
assert.ok(
  connector.indexOf("const capabilityEnvelope = await validateDispatchCapabilityEnvelope") < connector.indexOf("SET plan_status = 'executing'"),
  "applicable capability envelope validation must run before plan claim"
);

assert.match(chain, /resolveFallbackAgent/);
assert.match(chain, /chain-fallback:/);
assert.match(chain, /fallback_agent_id = \?/);
assert.match(chain, /chain_depth_exceeded/);

assert.match(sink, /chain_cycle_detected/);
assert.match(sink, /workflow_path_json/);
assert.match(sink, /dispatched_run_id/);
assert.match(sink, /split\(\/\[\|;,\]\//);

for (const column of [
  "root_event_id",
  "parent_event_id",
  "chain_depth",
  "max_chain_depth",
  "workflow_path_json",
  "dispatched_run_id",
  "fallback_agent_id",
  "failure_reason",
]) {
  assert.match(migration, new RegExp(column));
}
assert.match(migration, /CREATE INDEX IF NOT EXISTS `idx_chain_root_depth`/);
assert.match(migration, /CREATE INDEX IF NOT EXISTS `idx_chain_dispatched_run`/);
assert.match(grantMigration, /INSERT IGNORE INTO `agent_skill_grants`/);
assert.match(grantMigration, /logic\.evaluate_pack/);
assert.match(grantMigration, /TRIM\(tr\.active\)/);
assert.match(grantMigration, /NOT EXISTS/);
assert.match(historicalChainMigration, /workflow_identity_missing_historical/);
assert.match(historicalChainMigration, /e\.status = 'pending'/);
assert.match(historicalChainMigration, /w\.workflow_id IS NULL/);
assert.match(runner, /governed_migration_authorization_registry/);
assert.doesNotMatch(runner, /1003_sprint68_supervisor_chain_runtime_guards\.sql/);

console.log("supervisor chain runtime guard contracts passed");
