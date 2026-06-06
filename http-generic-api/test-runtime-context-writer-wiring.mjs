import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const auditLogger = readFileSync(new URL("./auditLogger.js", import.meta.url), "utf8");
const sessionArchive = readFileSync(new URL("./sessionArchiveService.js", import.meta.url), "utf8");
const observabilityRoutes = readFileSync(new URL("./routes/observabilityRoutes.js", import.meta.url), "utf8");
const connectorExecutor = readFileSync(new URL("./connectorExecutor.js", import.meta.url), "utf8");
const outputSinkRouter = readFileSync(new URL("./outputSinkRouter.js", import.meta.url), "utf8");
const localGatewayToolsRoutes = readFileSync(new URL("./routes/localGatewayToolsRoutes.js", import.meta.url), "utf8");

for (const [label, source] of [
  ["auditLogger", auditLogger],
  ["sessionArchiveService", sessionArchive],
  ["observabilityRoutes", observabilityRoutes],
  ["connectorExecutor", connectorExecutor],
  ["outputSinkRouter", outputSinkRouter],
  ["localGatewayToolsRoutes", localGatewayToolsRoutes],
]) {
  for (const token of ["tenant_id", "user_id", "actor_id", "actor_type", "brand_key", "correlation_id"]) {
    assert.ok(source.includes(token), `${label} should wire ${token}`);
  }
}

for (const token of ["workspace_id", "workspace_key", "brand_id", "request_id", "session_id", "conversation_id", "execution_context_json"]) {
  assert.ok(auditLogger.includes(token), `audit logger should persist ${token}`);
  assert.ok(connectorExecutor.includes(token), `connector executor should persist ${token}`);
}

assert.match(sessionArchive, /INSERT INTO `gpt_session_turns`[\s\S]*execution_context_json/);
assert.match(sessionArchive, /INSERT INTO `session_events`[\s\S]*workspace_key[\s\S]*brand_key[\s\S]*correlation_id/);
assert.match(observabilityRoutes, /INSERT INTO `telemetry_spans`[\s\S]*execution_context_json/);
assert.match(connectorExecutor, /INSERT INTO `workflow_runs`[\s\S]*execution_context_json/);
assert.match(connectorExecutor, /INSERT INTO `step_runs`[\s\S]*execution_context_json/);
assert.match(connectorExecutor, /INSERT INTO `telemetry_spans`[\s\S]*execution_context_json/);
assert.match(connectorExecutor, /writeAuditLogAsync\([\s\S]*brand_key/);
assert.match(outputSinkRouter, /INSERT INTO `sink_dispatch_log`[\s\S]*execution_context_json/);
assert.match(outputSinkRouter, /writeAuditLog\([\s\S]*brand_key/);
assert.match(localGatewayToolsRoutes, /INSERT INTO `local_gateway_tool_call_log`[\s\S]*execution_context_json/);
assert.match(localGatewayToolsRoutes, /INSERT INTO `approval_holds`[\s\S]*execution_context_json/);
assert.doesNotMatch(`${auditLogger}\n${sessionArchive}\n${observabilityRoutes}\n${connectorExecutor}\n${outputSinkRouter}\n${localGatewayToolsRoutes}`, /secrets_included:\s*true/);

console.log("runtime context writer wiring tests passed");
