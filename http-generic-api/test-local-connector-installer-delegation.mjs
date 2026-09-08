import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { _testingLocalConnectorInstallerDelegation as subject } from "./routes/localConnectorInstallerDelegationRoutes.js";

const env = { BACKEND_API_KEY: "test-backend-key" };

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", env.BACKEND_API_KEY).update(body).digest("base64url");
  return `${body}.${sig}`;
}

const token = sign({
  user_id: "u1",
  tenant_id: "t1",
  device_id: "device-1",
  format: "bat",
  capabilities: ["windows_control"],
  permission_grants: { allowed_paths: ["C:\\work"] },
  app_managed: true,
  exp: Math.floor(Date.now() / 1000) + 600,
});

const payload = subject.decodeAndVerifyInstallerToken(token, env);
assert.equal(payload.format, "bat");
assert.equal(payload.device_id, "device-1");

const ps1Token = subject.signInstallerToken({ ...payload, format: "ps1" }, env);
const ps1Payload = subject.decodeAndVerifyInstallerToken(ps1Token, env);
assert.equal(ps1Payload.format, "ps1");
assert.deepEqual(ps1Payload.permission_grants, payload.permission_grants);
assert.deepEqual(ps1Payload.capabilities, payload.capabilities);
assert.equal(ps1Payload.exp, payload.exp);

const bat = subject.buildCanonicalBootstrapBat({
  ps1Url: `https://dev.mad4b.com/connector-agent/installer.ps1?token=${encodeURIComponent(ps1Token)}`,
  deviceId: payload.device_id,
  appManaged: true,
});
assert.match(bat, /connector-agent\/installer\.ps1/);
assert.match(bat, /Canonical Local Connector installer/);
assert.doesNotMatch(bat, /cloudflared service install/i);
assert.doesNotMatch(bat, /nssm install Mad4B-LocalConnector-Cloudflared/i);
assert.doesNotMatch(bat, /Start-Service cloudflared/i);

assert.throws(() => subject.decodeAndVerifyInstallerToken(`${token}tampered`, env), /Invalid installer download token/);
assert.throws(() => subject.decodeAndVerifyInstallerToken(sign({ format: "bat", exp: 1 }), env), /expired/);

console.log("local connector installer delegation contract: ok");
