import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import { _testingLocalManagerDeviceLink as pairing } from "./services/localManagerDeviceLinkService.js";

// frontend-surface-operation: post /local-manager/device-link/devices/{sessionId}/revoke
// frontend-surface-operation: post /local-manager/device/n8n/provision

const routesSource = fs.readFileSync(new URL("./routes/localManagerBetaRoutes.js", import.meta.url), "utf8");
const serviceSource = fs.readFileSync(new URL("./services/localManagerDeviceLinkService.js", import.meta.url), "utf8");
const clientSource = fs.readFileSync(new URL("../apps/local-manager-windows/DeviceLinkClient.cs", import.meta.url), "utf8");
const openapiSource = fs.readFileSync(new URL("./openapi.yaml", import.meta.url), "utf8");

test("login and session restore never approve a pairing without the explicit button gesture", () => {
  const completeAuth = routesSource.match(/async function completeAuth[\s\S]*?\n\}/u)?.[0] || "";
  const initialize = routesSource.match(/async function initializeLinkDevicePage[\s\S]*?\n\}/u)?.[0] || "";
  assert.doesNotMatch(completeAuth, /approveDevice\s*\(/u);
  assert.doesNotMatch(initialize, /approveDevice\s*\(/u);
  assert.match(routesSource, /\$\('approve'\)\.onclick = approveDevice/u);
  assert.match(routesSource, /consent:'approve_device'/u);
  assert.match(routesSource, /pairing_fingerprint:pairingFingerprint/u);
});

test("browser user JWT is session-only and never persisted in localStorage", () => {
  assert.match(routesSource, /sessionStorage\.setItem\('mlm_user_token'/u);
  assert.match(routesSource, /sessionStorage\.getItem\('mlm_user_token'/u);
  assert.doesNotMatch(routesSource, /localStorage\.(?:setItem|getItem)\('mlm_user_token'/u);
});

test("public preview is an explicit narrow DTO with an immutable pairing fingerprint", () => {
  const row = {
    session_id: "session-1",
    display_code: "ABCD-EFGH",
    status: "pending",
    device_id: "device-1",
    hostname: "workstation-1",
    platform: "windows",
    app_version: "1.2.3",
    expires_at: new Date("2030-01-01T00:00:00.000Z"),
    user_id: "private-user",
    tenant_id: "private-tenant",
    metadata_json: JSON.stringify({ ip_seen: "127.0.0.1", user_agent: "secret-agent" }),
  };
  const preview = pairing.sanitizePublicPairingPreview(row, row.display_code);
  assert.deepEqual(Object.keys(preview).sort(), ["app_version", "device_id", "display_label", "effective_status", "expires_at", "hostname", "pairing_fingerprint", "platform"].sort());
  assert.equal(preview.pairing_fingerprint.length, 64);
  assert.equal(JSON.stringify(preview).includes("127.0.0.1"), false);
  assert.equal(JSON.stringify(preview).includes("secret-agent"), false);
  assert.equal(Object.hasOwn(preview, "metadata"), false);
  assert.equal(Object.hasOwn(preview, "session_id"), false);
});

test("device proof-of-possession accepts the session key and rejects a different key", () => {
  const key = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const wrongKey = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicDer = key.publicKey.export({ format: "der", type: "spki" });
  const challenge = "challenge-1";
  const pollToken = "poll-token-1";
  const displayCode = "ABCD-EFGH";
  const row = {
    session_id: "session-1",
    metadata_json: JSON.stringify({
      device_public_key_spki: publicDer.toString("base64"),
      device_public_key_fingerprint_sha256: crypto.createHash("sha256").update(publicDer).digest("hex"),
      device_proof_challenge_sha256: crypto.createHash("sha256").update(challenge).digest("hex"),
    }),
  };
  const pollHash = crypto.createHash("sha256").update(pollToken).digest("hex");
  const canonical = ["mad4b.local-manager.device-proof.v1", row.session_id, displayCode, pollHash, challenge].join("\n");
  const sign = (privateKey) => crypto.sign("sha256", Buffer.from(canonical), privateKey).toString("base64");
  assert.equal(pairing.verifyDevicePossession({ row, displayCode, pollToken, challenge, signature: sign(key.privateKey) }), true);
  assert.equal(pairing.verifyDevicePossession({ row, displayCode, pollToken, challenge, signature: sign(wrongKey.privateKey) }), false);
  assert.equal(pairing.verifyDevicePossession({ row, displayCode, pollToken, challenge: "wrong", signature: sign(key.privateKey) }), false);
});

test("credential-bearing responses are truthful and explicitly unsafe to log", () => {
  assert.deepEqual(pairing.credentialDelivery(["poll_token"]), {
    contains_credentials: true,
    safe_to_log: false,
    credential_delivery: { intentional: true, fields: ["poll_token"], transport: "tls_response_body" },
    secrets_included: true,
  });
  assert.match(serviceSource, /credentialDelivery\(\["device_access_token"\]\)/u);
  assert.match(openapiSource, /contains_credentials: \{ type: boolean, enum: \[true\] \}/u);
});

test("device-facing alias errors are sanitized", () => {
  const aliasFunction = serviceSource.match(/async function inspectLocalConnectorAliasForDeviceLink[\s\S]*?\n\}\n\nexport async function requireLocalManagerUser/u)?.[0] || "";
  assert.match(aliasFunction, /code: "connector_alias_write_failed", request_id: crypto\.randomUUID\(\)/u);
  assert.match(aliasFunction, /code: "connector_alias_read_failed", request_id: crypto\.randomUUID\(\)/u);
  assert.doesNotMatch(aliasFunction, /err\?\.message|error\?\.message|String\((?:err|error)\)/u);
});

test("revoke invalidates the durable session and n8n provisioning is authenticated and covered", () => {
  assert.match(serviceSource, /SET status = 'revoked'/u);
  assert.match(serviceSource, /status IN \('approved','completed'\)/u);
  assert.match(routesSource, /\/local-manager\/device-link\/devices\/:sessionId\/revoke/u);
  assert.match(routesSource, /\/local-manager\/device\/n8n\/provision/u);
  assert.match(serviceSource, /export async function provisionDeviceN8n[\s\S]*?const principal = await requireLocalManagerUser\(req\)/u);
  assert.match(openapiSource, /operationId: revokeLocalManagerLinkedDevice/u);
  assert.match(openapiSource, /operationId: provisionLocalManagerDeviceN8n/u);
});

test("Windows client generates and proves possession of a P-256 pairing key", () => {
  assert.match(clientSource, /ECDsa\.Create\(ECCurve\.NamedCurves\.nistP256\)/u);
  assert.match(clientSource, /ExportSubjectPublicKeyInfo/u);
  assert.match(clientSource, /mad4b\.local-manager\.device-proof\.v1/u);
  assert.match(clientSource, /SignData\([^;]*HashAlgorithmName\.SHA256/u);
});
