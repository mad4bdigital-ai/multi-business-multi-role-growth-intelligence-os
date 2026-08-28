import assert from "node:assert/strict";
import express from "express";

process.env.NODE_ENV = "staging";
process.env.REMOTE_MCP_ENVIRONMENT = "staging";
process.env.ACTIVATION_STAGING_GATEWAY_ENABLED = "true";
process.env.REMOTE_MCP_TRUST_PROXY_HOST_HEADERS = "true";
const { buildActivationHostGatewayRoutes, activationHostGatewayAllowedPaths } = await import("./routes/activationHostGatewayRoutes.js");
const { buildStagingRecoveryAdminRoutes } = await import("./routes/stagingRecoveryAdminRoutes.js");

const app = express();
app.use(buildActivationHostGatewayRoutes({ enabled: true }));
app.use(buildStagingRecoveryAdminRoutes({
  env: process.env,
  requireBackendApiKey: (_req, _res, next) => next(),
  requireAdminPrincipal: (_req, _res, next) => next(),
}));
app.use((req, res) => res.status(404).json({ ok: false, code: "downstream_not_reached" }));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
try {
  const port = server.address().port;
  const get = (path, host) => fetch(`http://127.0.0.1:${port}${path}`, {
    headers: { "x-forwarded-host": host },
  });
  const getWithHeaders = (path, headers) => fetch(`http://127.0.0.1:${port}${path}`, { headers });
  const schema = await get("/openapi.tenant-gpt.activation.staging.yaml", "activation-dev.mad4b.com");
  assert.equal(schema.status, 200);
  const schemaText = await schema.text();
  assert.match(schemaText, /https:\/\/activation-dev\.mad4b\.com/);
  assert.doesNotMatch(schemaText, /https:\/\/auth\.mad4b\.com\/(?:auth|oauth)(?:\/|$)|https:\/\/activation\.mad4b\.com(?:\/|$)|https:\/\/mcp\.mad4b\.com(?:\/|$)/);
  const recoveryContract = await get("/admin/recovery/staging/contract", "activation-dev.mad4b.com");
  assert.equal(recoveryContract.status, 403, "host headers alone never prove Gateway ingress");
  const recoveryContractBody = await recoveryContract.json();
  assert.equal(recoveryContractBody.error.code, "RECOVERY_TRUSTED_INGRESS_REQUIRED");
  const directOriginRecovery = await get("/admin/recovery/staging/contract", "dev.mad4b.com");
  assert.equal(directOriginRecovery.status, 404);

  const adminSchema = await get("/openapi.custom-gpt.activation-admin.staging.yaml", "activation-dev.mad4b.com");
  assert.equal(adminSchema.status, 200);
  const adminSchemaText = await adminSchema.text();
  assert.match(adminSchemaText, /getStagingRecoveryAdminContract/);
  assert.match(adminSchemaText, /x-mad4b-registration:/);
  assert.match(adminSchemaText, /registration_set: admin_activation_staging/);
  const retiredRecoverySchema = await get("/openapi.custom-gpt.recovery-admin.staging.yaml", "activation-dev.mad4b.com");
  assert.equal(retiredRecoverySchema.status, 404, "standalone Recovery schema must not remain a public registration artifact");
  const conflictingHostClaims = await getWithHeaders("/openapi.tenant-gpt.activation.staging.yaml", {
    "x-forwarded-host": "untrusted.invalid",
    "x-original-host": "activation-dev.mad4b.com",
  });
  assert.equal(conflictingHostClaims.status, 404, "gateway must reject conflicting trusted host claims");
  const consistentHostClaims = await getWithHeaders("/openapi.tenant-gpt.activation.staging.yaml", {
    "x-forwarded-host": "activation-dev.mad4b.com",
    "x-original-host": "activation-dev.mad4b.com",
  });
  assert.equal(consistentHostClaims.status, 200, "gateway may accept repeated identical trusted host claims");
  const wrongHost = await get("/openapi.tenant-gpt.activation.staging.yaml", "dev.mad4b.com");
  assert.equal(wrongHost.status, 404);
  const forbidden = await get("/auth/login", "activation-dev.mad4b.com");
  assert.equal(forbidden.status, 404);
  const health = await get("/health", "activation-dev.mad4b.com");
  assert.equal(health.status, 503, "gateway must not report origin readiness without server deployment evidence");
  const localDockerEnv = {
    NODE_ENV: "staging",
    REMOTE_MCP_ENVIRONMENT: "staging",
    DEPLOYMENT_ENVIRONMENT: "staging_local_windows_docker",
    ACTIVATION_STAGING_GATEWAY_ENABLED: "true",
    REMOTE_MCP_TRUST_PROXY_HOST_HEADERS: "true",
  };
  const localDockerPolicy = activationHostGatewayAllowedPaths({ env: localDockerEnv });
  assert.equal(localDockerPolicy.environment_key, "staging");
  assert.equal(localDockerPolicy.runtime_variant, "staging_local_windows_docker");
  assert.equal(localDockerPolicy.runtime_class, "local_windows_docker");
  assert.equal(localDockerPolicy.gateway_key, "activation_gateway_staging");
  assert(localDockerPolicy.exact_paths.includes("/admin-gpt/activation-openapi"));
  assert(localDockerPolicy.path_prefixes.includes("/admin/recovery/staging/"));

  const localApp = express();
  localApp.use(buildActivationHostGatewayRoutes({ env: localDockerEnv, enabled: true }));
  localApp.use((req, res) => res.status(404).json({ ok: false, code: "downstream_not_reached" }));
  const localServer = localApp.listen(0, "127.0.0.1");
  await new Promise((resolve) => localServer.once("listening", resolve));
  try {
    const localPort = localServer.address().port;
    const localSchema = await fetch(`http://127.0.0.1:${localPort}/openapi.custom-gpt.activation-admin.staging.yaml`, {
      headers: { "x-forwarded-host": "activation-dev.mad4b.com" },
    });
    assert.equal(localSchema.status, 200);
    assert.match(await localSchema.text(), /getStagingRecoveryAdminReadiness/);
  } finally {
    await new Promise((resolve, reject) => localServer.close((error) => error ? reject(error) : resolve()));
  }

  const conflictingEnv = { ...localDockerEnv, DEPLOYMENT_ENVIRONMENT: "production" };
  const conflictingPolicy = activationHostGatewayAllowedPaths({ env: conflictingEnv });
  assert.equal(conflictingPolicy.environment_key, null);
  assert.deepEqual(conflictingPolicy.exact_paths, []);
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
console.log("staging_activation_gateway=PASS");
