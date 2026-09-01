import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const args = new Map(process.argv.slice(2).map((arg) => {
  const index = arg.indexOf("=");
  return index === -1 ? [arg, ""] : [arg.slice(0, index), arg.slice(index + 1)];
}));
const sourceSha = String(args.get("--source-sha") || "").toLowerCase();
const outputDir = path.resolve(root, args.get("--output-dir") || ".artifacts/activation-gateway-staging");
const lifetimeHours = Number(args.get("--lifetime-hours") || 168);

assert.match(sourceSha, /^[a-f0-9]{40}$/, "source SHA must be an exact 40-character commit");
assert.ok(Number.isInteger(lifetimeHours) && lifetimeHours >= 1 && lifetimeHours <= 720, "attestation lifetime must be 1..720 hours");

const sourceDir = path.join(root, "edge", "activation-gateway", "src");
const workerPath = path.join(sourceDir, "worker-staging.mjs");
const gatewayPath = path.join(sourceDir, "gateway.mjs");
const policyPath = path.join(root, "edge", "activation-gateway", "generated", "route-policy.staging.json");
const workerTemplate = fs.readFileSync(workerPath, "utf8");
const gateway = fs.readFileSync(gatewayPath, "utf8");
const policyText = fs.readFileSync(policyPath, "utf8");
const policy = JSON.parse(policyText);

assert.equal(policy.policy_key, "activation_gateway_staging");
assert.equal(policy.public_host, "activation-dev.mad4b.com");
assert.match(policy.content_hash_sha256, /^[a-f0-9]{64}$/);

const graphDigest = crypto.createHash("sha256")
  .update("mad4b.activation-gateway-staging.bundle.v1\0")
  .update(workerTemplate).update("\0")
  .update(gateway).update("\0")
  .update(policyText)
  .digest("hex");
const workerBuildIdentity = { source_sha: sourceSha, bundle_sha256: graphDigest };
const marker = "/* WORKER_BUILD_IDENTITY */ null";
const moduleSpecifier = (fromFile, toFile) => {
  const relative = path.relative(path.dirname(fromFile), toFile).replaceAll(path.sep, "/");
  return JSON.stringify(relative.startsWith(".") ? relative : `./${relative}`);
};
assert.equal(workerTemplate.split(marker).length, 2, "worker identity marker must occur exactly once");
assert.equal(workerTemplate.split(moduleSpecifier(workerPath, policyPath)).length, 2, "staging policy import must occur exactly once");
const builtWorker = workerTemplate
  .replace(
    moduleSpecifier(workerPath, policyPath),
    moduleSpecifier(path.join(outputDir, "worker-staging.mjs"), path.join(outputDir, path.basename(policyPath))),
  )
  .replace(marker, JSON.stringify(workerBuildIdentity));
assert.equal(
  builtWorker.includes(moduleSpecifier(workerPath, policyPath)),
  false,
  "deployment artifact must not depend on source-tree policy topology",
);
assert.equal(
  builtWorker.includes(moduleSpecifier(path.join(outputDir, "worker-staging.mjs"), path.join(outputDir, path.basename(policyPath)))),
  true,
  "deployment artifact must import its co-located policy",
);

const deploymentId = `activation-staging-${sourceSha.slice(0, 12)}-${Date.now()}`;
const expiresAt = new Date(Date.now() + lifetimeHours * 60 * 60 * 1000).toISOString();
const unsigned = {
  content_hash_sha256: policy.content_hash_sha256,
  deployment_id: deploymentId,
  expires_at: expiresAt,
  source_commit: sourceSha,
  surface_registry_version: Number(policy.surface_registry_version),
  worker_build_sha: sourceSha,
  worker_bundle_sha256: graphDigest,
};
const stableValue = (value) => Array.isArray(value)
  ? value.map(stableValue)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]))
    : value;
const stableJson = (value) => `${JSON.stringify(stableValue(value), null, 2)}\n`;
const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
const signature = crypto.sign(null, Buffer.from(stableJson(unsigned)), privateKey).toString("base64url");
const attestation = { ...unsigned, signature_b64url: signature };
const publicJwk = publicKey.export({ format: "jwk" });

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "worker-staging.mjs"), builtWorker);
fs.writeFileSync(path.join(outputDir, "gateway.mjs"), gateway);
fs.writeFileSync(path.join(outputDir, "route-policy.staging.json"), policyText);
fs.writeFileSync(path.join(outputDir, "deployment-secrets.json"), JSON.stringify({
  ACTIVATION_GATEWAY_DEPLOYMENT_ATTESTATION_JSON: JSON.stringify(attestation),
  ACTIVATION_GATEWAY_POLICY_PUBLIC_KEY_JWK: JSON.stringify(publicJwk),
}, null, 2));
fs.writeFileSync(path.join(outputDir, "deployment-evidence.json"), stableJson({
  contract: "mad4b.activation-gateway-staging-deployment-evidence.v1",
  deployment_id: deploymentId,
  expires_at: expiresAt,
  policy_hash: policy.content_hash_sha256,
  public_host: policy.public_host,
  source_commit: sourceSha,
  worker_bundle_sha256: graphDigest,
  production_deploy: false,
  database_mutation: false,
  secrets_included: false,
}));

console.log(JSON.stringify({
  ok: true,
  deployment_id: deploymentId,
  expires_at: expiresAt,
  policy_hash: policy.content_hash_sha256,
  source_commit: sourceSha,
  worker_bundle_sha256: graphDigest,
  secrets_included: false,
}));
