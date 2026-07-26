import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  policyHash as runtimePolicyHash,
  stableJson as runtimeStableJson,
  verifyDeploymentAttestation as runtimeVerifyDeploymentAttestation,
} from "./activationGatewayAttestation.js";
import {
  policyHash as canonicalPolicyHash,
  stableJson as canonicalStableJson,
  verifyDeploymentAttestation as canonicalVerifyDeploymentAttestation,
} from "../edge/activation-gateway/src/gateway.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const canonicalRoot = path.join(repoRoot, "edge", "activation-gateway");
const runtimeRoot = path.join(__dirname, "activation-gateway-runtime");
const files = ["src/worker.mjs", "src/gateway.mjs", "generated/route-policy.json"];

for (const relativePath of files) {
  const canonical = fs.readFileSync(path.join(canonicalRoot, ...relativePath.split("/")), "utf8").replace(/\r\n?/g, "\n");
  const runtime = fs.readFileSync(path.join(runtimeRoot, ...relativePath.split("/")), "utf8").replace(/\r\n?/g, "\n");
  assert.equal(runtime, canonical, `${relativePath} runtime bundle matches canonical source`);
}

const manifest = JSON.parse(fs.readFileSync(path.join(runtimeRoot, "bundle-manifest.json"), "utf8"));
assert.equal(manifest.schema_version, 1);
assert.equal(manifest.file_count, files.length);
assert.equal(manifest.secrets_included, false);
assert.deepEqual(manifest.files.map((entry) => entry.path), files);

const policy = JSON.parse(fs.readFileSync(path.join(runtimeRoot, "generated", "route-policy.json"), "utf8"));
assert.equal(await runtimePolicyHash(policy, crypto.webcrypto), await canonicalPolicyHash(policy, crypto.webcrypto));
assert.equal(runtimeStableJson({ z: 1, a: { y: 2, b: 3 } }), canonicalStableJson({ z: 1, a: { y: 2, b: 3 } }));

const pair = await crypto.webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const publicJwk = await crypto.webcrypto.subtle.exportKey("jwk", pair.publicKey);
const attestation = {
  content_hash_sha256: policy.content_hash_sha256,
  deployment_id: "bundle-parity-fixture",
  expires_at: new Date(Date.now() + 60000).toISOString(),
  source_commit: "a".repeat(40),
  surface_registry_version: Number(policy.surface_registry_version),
};
const signature = await crypto.webcrypto.subtle.sign(
  { name: "Ed25519" },
  pair.privateKey,
  new TextEncoder().encode(runtimeStableJson(attestation)),
);
const env = {
  ACTIVATION_GATEWAY_DEPLOYMENT_ATTESTATION_JSON: JSON.stringify({ ...attestation, signature_b64url: Buffer.from(signature).toString("base64url") }),
  ACTIVATION_GATEWAY_POLICY_PUBLIC_KEY_JWK: JSON.stringify(publicJwk),
};
const runtimeVerification = await runtimeVerifyDeploymentAttestation(policy, env, { cryptoImpl: crypto.webcrypto });
const canonicalVerification = await canonicalVerifyDeploymentAttestation(policy, env, { cryptoImpl: crypto.webcrypto });
assert.deepEqual(runtimeVerification, canonicalVerification);
assert.equal(runtimeVerification.ok, true);
assert.equal(runtimeVerification.stale, false);

const rolloutSource = fs.readFileSync(path.join(__dirname, "activationGatewayRolloutTool.js"), "utf8");
assert.doesNotMatch(rolloutSource, /\.\.\/edge\/activation-gateway/);
assert.doesNotMatch(rolloutSource, /edge\/activation-gateway\/src/);
assert.match(rolloutSource, /activation-gateway-runtime/);
assert.match(rolloutSource, /\.\/activationGatewayAttestation\.js/);

console.log("Activation Gateway runtime bundle parity tests passed.");
