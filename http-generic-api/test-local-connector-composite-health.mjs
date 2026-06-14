import assert from "node:assert/strict";
import {
  classifyLocalConnectorCompositeHealth,
  probeLocalConnectorPublicHealth,
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
  const probe = await probeLocalConnectorPublicHealth({
    tunnelUrl: "https://connector.example/",
    fetchImpl: async () => response(401, { error: { code: "unauthorized" } }),
  });
  assert.equal(probe.status, "authorization_gated");
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

const routeSource = await import("node:fs").then(({ readFileSync }) => readFileSync("routes/adminCliRoutes.js", "utf8"));
assert.match(routeSource, /probeLocalConnectorPublicHealth/);
assert.match(routeSource, /classifyLocalConnectorCompositeHealth/);
assert.match(routeSource, /admin_cli\.local_connector_self_repair\.not_required/);
assert.match(routeSource, /installer_generated: false/);
assert.match(routeSource, /composite_health: compositeHealth/);
assert.match(routeSource, /repair_required: compositeHealth\.repair_required/);

console.log("local connector composite health tests passed");
