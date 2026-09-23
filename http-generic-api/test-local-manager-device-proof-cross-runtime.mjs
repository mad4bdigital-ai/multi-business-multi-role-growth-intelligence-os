import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { _testingLocalManagerDeviceLink as pairing } from "./services/localManagerDeviceLinkService.js";

const here = dirname(fileURLToPath(import.meta.url));
const project = resolve(here, "../apps/local-manager-device-proof-certification/Mad4B.LocalManager.DeviceProofCertification.csproj");
const stdout = execFileSync("dotnet", ["run", "--project", project, "--configuration", "Release"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const line = stdout.split(/\r?\n/u).map((value) => value.trim()).filter((value) => value.startsWith("{") && value.endsWith("}")).at(-1);
assert.ok(line, "cross-runtime .NET signer must emit JSON evidence");
const vector = JSON.parse(line);

assert.equal(vector.ok, true);
assert.equal(vector.contract, "mad4b.local-manager.device-proof.v1");
assert.equal(vector.secrets_included, false);

const publicDer = Buffer.from(vector.public_key_spki, "base64");
assert.equal(
  crypto.createHash("sha256").update(publicDer).digest("hex"),
  vector.public_key_fingerprint_sha256,
  "Node and .NET must agree on the public-key fingerprint",
);

const row = {
  session_id: vector.session_id,
  metadata_json: JSON.stringify({
    device_public_key_spki: vector.public_key_spki,
    device_public_key_fingerprint_sha256: vector.public_key_fingerprint_sha256,
    device_proof_challenge_sha256: crypto.createHash("sha256").update(vector.challenge).digest("hex"),
  }),
};

assert.equal(pairing.verifyDevicePossession({
  row,
  displayCode: vector.display_code,
  pollToken: vector.poll_token,
  challenge: vector.challenge,
  signature: vector.signature_der,
}), true, ".NET DER signature must verify through the production Node verifier");

assert.equal(pairing.verifyDevicePossession({
  row,
  displayCode: vector.display_code,
  pollToken: vector.poll_token,
  challenge: vector.challenge,
  signature: vector.signature_ieee_p1363,
}), false, "production Node verifier must reject the wrong ECDSA wire encoding");

assert.equal(pairing.verifyDevicePossession({
  row,
  displayCode: vector.display_code,
  pollToken: vector.poll_token + "-wrong",
  challenge: vector.challenge,
  signature: vector.signature_der,
}), false, "proof must be bound to the poll token");

console.log(JSON.stringify({
  ok: true,
  certification: "local_manager_device_proof_dotnet_node_interop",
  dsa_encoding: "der",
  secrets_included: false,
}));
