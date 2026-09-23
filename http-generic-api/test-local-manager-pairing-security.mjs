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
const deviceProofCryptoSource = fs.readFileSync(new URL("../apps/local-manager-windows/DeviceProofCrypto.cs", import.meta.url), "utf8");
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


test("explicit pairing consent rejects missing and stale fingerprints", () => {
  const row = {
    session_id: "session-consent",
    display_code: "ABCD-EFGH",
    status: "pending",
    device_id: "device-consent",
    hostname: "workstation-consent",
    platform: "windows",
    app_version: "2.0.0",
    expires_at: new Date("2030-01-01T00:00:00.000Z"),
    metadata_json: JSON.stringify({
      device_public_key_fingerprint_sha256: "1".repeat(64),
    }),
  };
  const fingerprint = pairing.pairingFingerprint(row, row.display_code);
  assert.equal(pairing.isExplicitPairingConsentValid({
    row, displayCode: row.display_code, consent: "", previewFingerprint: fingerprint,
  }), false);
  assert.equal(pairing.isExplicitPairingConsentValid({
    row, displayCode: row.display_code, consent: "approve_device", previewFingerprint: "0".repeat(64),
  }), false);
  assert.equal(pairing.isExplicitPairingConsentValid({
    row: { ...row, hostname: "changed-host" },
    displayCode: row.display_code,
    consent: "approve_device",
    previewFingerprint: fingerprint,
  }), false);
  assert.equal(pairing.isExplicitPairingConsentValid({
    row: {
      ...row,
      metadata_json: JSON.stringify({ device_public_key_fingerprint_sha256: "2".repeat(64) }),
    },
    displayCode: row.display_code,
    consent: "approve_device",
    previewFingerprint: fingerprint,
  }), false);
  assert.equal(pairing.isExplicitPairingConsentValid({
    row, displayCode: row.display_code, consent: "approve_device", previewFingerprint: fingerprint,
  }), true);
});

test("display-code collision retries are bounded and regenerate pairing secrets", async () => {
  const publicKey = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey
    .export({ format: "der", type: "spki" });
  const codes = ["AAAA-BBBB", "CCCC-DDDD", "EEEE-FFFF"];
  const tokens = ["poll-one", "challenge-one", "poll-two", "challenge-two", "poll-three", "challenge-three"];
  const sessions = ["session-one", "session-two", "session-three"];
  let calls = 0;
  const pool = {
    async query() {
      calls += 1;
      if (calls === 1) {
        const error = new Error("duplicate display code hash");
        error.code = "ER_DUP_ENTRY";
        error.errno = 1062;
        throw error;
      }
      return [{ affectedRows: 1 }];
    },
  };
  const created = await pairing.createDeviceLinkSessionWithRetry({
    pool,
    deviceId: "device-collision",
    hostname: "device-collision",
    platform: "windows",
    appVersion: "2.0.0",
    devicePublicKey: {
      encoded: publicKey.toString("base64"),
      fingerprint: crypto.createHash("sha256").update(publicKey).digest("hex"),
    },
    maxAttempts: 3,
    generators: {
      displayCode: () => codes.shift(),
      token: () => tokens.shift(),
      sessionId: () => sessions.shift(),
    },
  });
  assert.equal(calls, 2);
  assert.equal(created.insert_attempt, 2);
  assert.equal(created.displayCode, "CCCC-DDDD");
  assert.equal(created.pollToken, "poll-two");
  assert.equal(created.deviceProofChallenge, "challenge-two");
  assert.equal(created.sessionId, "session-two");

  const duplicatePool = {
    async query() {
      const error = new Error("duplicate");
      error.code = "ER_DUP_ENTRY";
      throw error;
    },
  };
  await assert.rejects(
    pairing.createDeviceLinkSessionWithRetry({
      pool: duplicatePool,
      deviceId: "device-exhausted",
      hostname: "device-exhausted",
      platform: "windows",
      appVersion: "2.0.0",
      devicePublicKey: {
        encoded: publicKey.toString("base64"),
        fingerprint: crypto.createHash("sha256").update(publicKey).digest("hex"),
      },
      maxAttempts: 2,
      generators: {
        displayCode: () => "ZZZZ-9999",
        token: () => "duplicate-token",
        sessionId: () => crypto.randomUUID(),
      },
    }),
    (error) => error?.code === "device_link_code_allocation_exhausted"
      && error?.details?.attempts === 2
      && error?.details?.duplicate_key_retries_exhausted === true,
  );
});

test("durable revocation and token ownership predicate reject replay immediately", () => {
  const payload = {
    jti: "jti-1",
    session_id: "session-1",
    device_id: "device-1",
    user_id: "user-1",
    tenant_id: "tenant-1",
  };
  const active = {
    status: "completed",
    revoked_at: null,
    device_token_jti: "jti-1",
    session_id: "session-1",
    device_id: "device-1",
    user_id: "user-1",
    tenant_id: "tenant-1",
  };
  assert.equal(pairing.isDeviceSessionAuthorizedForToken(active, payload), true);
  assert.equal(pairing.isDeviceSessionAuthorizedForToken({ ...active, revoked_at: new Date() }, payload), false);
  assert.equal(pairing.isDeviceSessionAuthorizedForToken({ ...active, status: "revoked" }, payload), false);
  assert.equal(pairing.isDeviceSessionAuthorizedForToken(active, { ...payload, jti: "stolen-jti" }), false);
  assert.equal(pairing.isDeviceSessionAuthorizedForToken(active, { ...payload, device_id: "other-device" }), false);
});

test("pairing start requires a valid P-256 public key primitive", () => {
  assert.equal(pairing.importDevicePublicKey(""), null);
  assert.equal(pairing.importDevicePublicKey(Buffer.from("not-a-public-key").toString("base64")), null);
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
  const sign = (privateKey) => crypto.sign("sha256", Buffer.from(canonical), { key: privateKey, dsaEncoding: "der" }).toString("base64");
  assert.equal(pairing.verifyDevicePossession({ row, displayCode, pollToken, challenge, signature: sign(key.privateKey) }), true);
  assert.equal(pairing.verifyDevicePossession({ row, displayCode, pollToken, challenge, signature: sign(wrongKey.privateKey) }), false);
  assert.equal(pairing.verifyDevicePossession({ row, displayCode, pollToken, challenge: "wrong", signature: sign(key.privateKey) }), false);
  assert.equal(pairing.verifyDevicePossession({ row, displayCode, pollToken: "wrong-token", challenge, signature: sign(key.privateKey) }), false);
  assert.equal(pairing.verifyDevicePossession({ row, displayCode, pollToken, challenge, signature: "" }), false);
  assert.match(serviceSource, /dsaEncoding: "der"/u);
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
  assert.match(clientSource, /DeviceProofCrypto\.BuildCanonical/u);
  assert.match(clientSource, /DeviceProofCrypto\.SignDerBase64/u);
  assert.match(deviceProofCryptoSource, /mad4b\.local-manager\.device-proof\.v1/u);
  assert.match(deviceProofCryptoSource, /DSASignatureFormat\.Rfc3279DerSequence/u);
});
