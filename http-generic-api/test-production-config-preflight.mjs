import assert from "node:assert/strict";
import { evaluateProductionConfig } from "./productionConfigPreflight.js";

const base = {
  NODE_ENV: "production",
  RELEASE_TRIGGER_DEPLOYMENT_BRANCH: "Production",
  JWT_SECRET: "jwt_secret_fixture_32_characters_long_x",
  TENANT_GPT_SSO_SIGNING_SECRET: "sso_secret_fixture_32_characters_long_y",
  TENANT_GPT_OAUTH_CLIENT_SECRET: "oauth_client_fixture_32_characters_long_z",
  REMOTE_MCP_TRUST_PROXY_HOST_HEADERS: "true",
  REMOTE_MCP_TRUSTED_INGRESS_ATTESTED: "true",
  REMOTE_MCP_TRUSTED_INGRESS_STRIP_CALLER_HEADERS: "true",
  QUEUE_WORKER_ENABLED: "true",
  REDIS_URL: "redis://fixture:6379",
  CONTROL_PLANE_WRITE_AUTHORITY_ENABLED: "true",
  CONTROL_PLANE_WRITE_DB_HOST: "db",
  CONTROL_PLANE_WRITE_DB_NAME: "growth_control_plane",
  CONTROL_PLANE_WRITE_DB_USER: "control_plane_writer",
  CONTROL_PLANE_WRITE_DB_PASSWORD: "writer_fixture_password",
  DB_USER: "runtime_reader",
};

const ready = evaluateProductionConfig(base);
assert.equal(ready.ok, true);
assert.equal(ready.status, "ready");
assert.equal(ready.secrets.every((item) => item.secrets_included === false), true);
assert.equal(ready.queue.status, "ready");
assert.equal(ready.control_plane_write.status, "configured");

const missingSso = evaluateProductionConfig({ ...base, TENANT_GPT_SSO_SIGNING_SECRET: "" });
assert.equal(missingSso.ok, false);
assert.match(missingSso.errors.join("\n"), /TENANT_GPT_SSO_SIGNING_SECRET is missing/);

const shortJwt = evaluateProductionConfig({ ...base, JWT_SECRET: "short" });
assert.equal(shortJwt.ok, false);
assert.match(shortJwt.errors.join("\n"), /JWT_SECRET must be at least 32 characters/);

const duplicateSecrets = evaluateProductionConfig({
  ...base,
  TENANT_GPT_SSO_SIGNING_SECRET: base.JWT_SECRET,
});
assert.equal(duplicateSecrets.ok, false);
assert.match(duplicateSecrets.errors.join("\n"), /must be distinct/);

const ingressNotAttested = evaluateProductionConfig({
  ...base,
  REMOTE_MCP_TRUSTED_INGRESS_ATTESTED: "false",
});
assert.equal(ingressNotAttested.ok, false);
assert.match(ingressNotAttested.errors.join("\n"), /REMOTE_MCP_TRUSTED_INGRESS_ATTESTED=true/);

const queueMissingRedis = evaluateProductionConfig({ ...base, QUEUE_WORKER_ENABLED: "true", REDIS_URL: "" });
assert.equal(queueMissingRedis.ok, false);
assert.match(queueMissingRedis.errors.join("\n"), /REDIS_URL is required/);

const writerMissingConfig = evaluateProductionConfig({
  ...base,
  CONTROL_PLANE_WRITE_AUTHORITY_ENABLED: "true",
  CONTROL_PLANE_WRITE_DB_HOST: "",
  CONTROL_PLANE_WRITE_DB_NAME: "",
  CONTROL_PLANE_WRITE_DB_USER: "",
  CONTROL_PLANE_WRITE_DB_PASSWORD: "",
});
assert.equal(writerMissingConfig.ok, false);
assert.match(writerMissingConfig.errors.join("\n"), /Control Plane write authority is enabled/);

const writerReusesRuntimeIdentity = evaluateProductionConfig({
  ...base,
  CONTROL_PLANE_WRITE_AUTHORITY_ENABLED: "true",
  CONTROL_PLANE_WRITE_DB_HOST: "db",
  CONTROL_PLANE_WRITE_DB_NAME: "growth",
  CONTROL_PLANE_WRITE_DB_USER: "runtime_user",
  CONTROL_PLANE_WRITE_DB_PASSWORD: "writer_password",
  DB_USER: "runtime_user",
});
assert.equal(writerReusesRuntimeIdentity.ok, false);
assert.match(writerReusesRuntimeIdentity.errors.join("\n"), /distinct from DB_USER/);

console.log("test-production-config-preflight: ok");
