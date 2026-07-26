import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const readiness = readFileSync(new URL("./releaseReadiness.js", import.meta.url), "utf8");
const remoteRuntime = readFileSync(new URL("./remoteRuntime.js", import.meta.url), "utf8");

assert.ok(
  readiness.includes("205_sprint67_runtime_context_dimension_enrichment.sql"),
  "release readiness should track migration 205 as expected ledger coverage"
);

for (const token of [
  "tenantId: target.tenant_id",
  "userId: target.user_id",
  "appKey: \"remote_ssh_runtime\"",
  "resourceType: \"remote_runtime_target\"",
  "correlationId: traceId",
  "executionContext:",
  "actionKey: \"remote_runtime_probe\"",
  "actionKey: \"remote_runtime_dispatch_dry_run\"",
]) {
  assert.ok(remoteRuntime.includes(token), `remoteRuntime should include ${token}`);
}

for (const token of [
  "tenant_id: target.tenant_id",
  "user_id: target.user_id",
  "app_key: \"remote_ssh_runtime\"",
  "resource_type: \"remote_runtime_target\"",
  "resource_id:",
  "target_id:",
  "secrets_included: false",
]) {
  assert.ok(remoteRuntime.includes(token), `remoteRuntime outputSummary should include ${token}`);
}

assert.doesNotMatch(remoteRuntime, /secrets_included:\s*true/);

console.log("context activation follow-up regression passed");
