import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/1009_sprint69_optional_manual_agent_delegation_tools.sql", import.meta.url), "utf8");
const routes = readFileSync(new URL("./routes/outputSinkRoutes.js", import.meta.url), "utf8");

for (const tool of [
  "agent_chain_event_create_manual",
  "agent_chain_event_dispatch_manual",
  "agent_delegation_contract_create_manual",
]) {
  assert.match(migration, new RegExp(tool));
}
assert.match(migration, /delegation_approved/);
assert.match(migration, /delegation_mode/);
assert.match(migration, /manual_api/);
assert.match(migration, /allow_fallback_agent/);
assert.doesNotMatch(migration, /dispatch-pending/);
assert.match(routes, /router\.post\("\/agent-chain-events"/);

console.log("optional manual agent delegation tool contracts passed");
