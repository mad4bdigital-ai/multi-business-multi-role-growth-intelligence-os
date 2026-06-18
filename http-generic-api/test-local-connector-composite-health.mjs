import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classifyLocalConnectorCompositeHealth,
  probeLocalConnectorPublicHealth,
  probeLocalConnectorPublicHealthWithRetry,
} from "./localConnectorCompositeHealth.js";

function response(status, payload = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  };
}

{
  const probe = await probeLocalConnectorPublicHealth({
    tunnelUrl: "https://connector.example",
    fetchImpl: async (url) => {
      assert.equal(url, "https://connector.example/health");
      return response(200, { ok: true, service: "local-connector", hostname: "Essam", platform: "win32", uptime: 100 });
    },
  });
  assert.equal(probe.status, "pass");
  assert.equal(probe.hostname, "Essam");
  const composite = classifyLocalConnectorCompositeHealth({ tunnelStatus: "healthy", publicProbe: probe });
  assert.equal(composite.status, "active");
  assert.equal(composite.repair_required, false);
}

{
  const statuses = [530, 530, 200];
  const delays = [];
  const probe = await probeLocalConnectorPublicHealthWithRetry({
    tunnelUrl: "https://connector.example/",
    fetchImpl: async () => {
      const status = statuses.shift();
      return response(status, { ok: status === 200, service: "local-connector" });
    },
    sleepImpl: async (delayMs) => { delays.push(delayMs); },
  });
  assert.equal(probe.status, "pass");
  assert.equal(probe.retry_evidence.attempt_count, 3);
  assert.equal(probe.retry_evidence.recovered_on_retry, true);
  assert.equal(probe.retry_evidence.retry_exhausted, false);
  assert.deepEqual(delays, [750, 1500]);
}

{
  const probe = await probeLocalConnectorPublicHealthWithRetry({
    tunnelUrl: "https://connector.example/",
    fetchImpl: async () => response(530),
    sleepImpl: async () => {},
  });
  assert.equal(probe.status, "http_error");
  assert.equal(probe.http_status, 530);
  assert.equal(probe.retry_evidence.attempt_count, 3);
  assert.equal(probe.retry_evidence.recovered_on_retry, false);
  assert.equal(probe.retry_evidence.retry_exhausted, true);
  assert.equal(probe.retry_evidence.policy_key, "cloudflare_1033_retry_before_repair_v1");
}

{
  let attempts = 0;
  const probe = await probeLocalConnectorPublicHealthWithRetry({
    tunnelUrl: "https://connector.example/",
    fetchImpl: async () => {
      attempts += 1;
      return response(401, { error: { code: "unauthorized" } });
    },
    sleepImpl: async () => { throw new Error("authorization failures must not retry"); },
  });
  assert.equal(probe.status, "authorization_gated");
  assert.equal(attempts, 1);
  assert.equal(probe.retry_evidence.attempt_count, 1);
  assert.equal(probe.retry_evidence.retry_exhausted, false);
  const composite = classifyLocalConnectorCompositeHealth({ tunnelStatus: "healthy", publicProbe: probe });
  assert.equal(composite.status, "authorization_gated");
  assert.equal(composite.repair_required, false);
}

{
  const composite = classifyLocalConnectorCompositeHealth({
    tunnelStatus: "healthy",
    publicProbe: { status: "transport_error" },
  });
  assert.equal(composite.status, "degraded_local_service");
  assert.equal(composite.repair_required, true);
}

{
  const composite = classifyLocalConnectorCompositeHealth({
    tunnelStatus: "down",
    publicProbe: { status: "transport_error" },
  });
  assert.equal(composite.status, "degraded_tunnel");
  assert.equal(composite.repair_required, true);
}

{
  const probe = await probeLocalConnectorPublicHealth({ tunnelUrl: "" });
  assert.equal(probe.status, "not_attempted");
  const composite = classifyLocalConnectorCompositeHealth({ tunnelStatus: null, publicProbe: probe });
  assert.equal(composite.status, "validating");
  assert.equal(composite.repair_required, true);
}

const routeSource = readFileSync("routes/adminCliRoutes.js", "utf8");
assert.match(routeSource, /probeLocalConnectorPublicHealthWithRetry/);
assert.match(routeSource, /admin_cli\.local_connector_self_repair\.not_required/);
assert.match(routeSource, /installer_generated: false/);
assert.match(routeSource, /retry_evidence: publicHealthProbe\.retry_evidence/);

const openApiSource = readFileSync("openapi.yaml", "utf8");
assert.match(openApiSource, /retry bounded connector health/i);
assert.doesNotMatch(openApiSource, /CALL IMMEDIATELY when connector\.mad4b\.com returns error 1033/i);

const policyMigrationSource = readFileSync("migrations/318_sprint69_local_connector_transient_retry_policy.sql", "utf8");
assert.match(policyMigrationSource, /Cloudflare 1033 Retry Before Repair/);
assert.match(policyMigrationSource, /'max_attempts', 3/);
assert.match(policyMigrationSource, /'require_retry_exhaustion_before_repair', true/);
assert.match(policyMigrationSource, /'forbid_installer_when_retry_recovers', true/);
assert.match(policyMigrationSource, /secrets_included=false/);

console.log("local connector composite health tests passed");
