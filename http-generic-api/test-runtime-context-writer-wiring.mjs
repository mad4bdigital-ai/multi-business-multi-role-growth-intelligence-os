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

for (const [label, source, table] of [
  ["sessionArchiveService", sessionArchive, "gpt_session_turns"],
  ["sessionArchiveService", sessionArchive, "session_events"],
  ["observabilityRoutes", observabilityRoutes, "telemetry_spans"],
  ["connectorExecutor", connectorExecutor, "workflow_runs"],
  ["connectorExecutor", connectorExecutor, "step_runs"],
  ["connectorExecutor", connectorExecutor, "telemetry_spans"],
  ["outputSinkRouter", outputSinkRouter, "sink_dispatch_log"],
  ["localGatewayToolsRoutes", localGatewayToolsRoutes, "local_gateway_tool_call_log"],
  ["localGatewayToolsRoutes", localGatewayToolsRoutes, "approval_holds"],
]) {
  assert.ok(source.includes(table), `${label} should write ${table}`);
  assert.ok(source.includes("execution_context_json"), `${label} should write execution_context_json`);
}
assert.ok(sessionArchive.includes("workspace_key") && sessionArchive.includes("brand_key") && sessionArchive.includes("correlation_id"));
assert.match(connectorExecutor, /writeAuditLogAsync\([\s\S]*brand_key/);
assert.match(outputSinkRouter, /writeAuditLog\([\s\S]*brand_key/);
assert.doesNotMatch(`${auditLogger}\n${sessionArchive}\n${observabilityRoutes}\n${connectorExecutor}\n${outputSinkRouter}\n${localGatewayToolsRoutes}`, /secrets_included:\s*true/);

console.log("runtime context writer wiring tests passed");
