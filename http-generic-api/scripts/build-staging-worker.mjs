#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeStagingActivationGatewayBundle } from "../stagingActivationGatewayBundle.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const args = new Map(process.argv.slice(2).map((arg) => {
  const index = arg.indexOf("=");
  return index === -1 ? [arg, ""] : [arg.slice(0, index), arg.slice(index + 1)];
}));
const sourceSha = String(args.get("--source-sha") || "").toLowerCase();
const outputDir = path.resolve(root, args.get("--output-dir") || ".artifacts/activation-gateway-staging");
const lifetimeHours = Number(args.get("--lifetime-hours") || 168);

assert.match(sourceSha, /^[a-f0-9]{40}$/u, "source SHA must be an exact 40-character commit");
assert.ok(Number.isInteger(lifetimeHours) && lifetimeHours >= 1 && lifetimeHours <= 720, "attestation lifetime must be 1..720 hours");

const bundle = await writeStagingActivationGatewayBundle({
  sourceSha,
  repositoryRoot: root,
  outputDir,
  lifetimeHours,
});

console.log(JSON.stringify({
  ok: true,
  deployment_id: bundle.deployment_id,
  expires_at: bundle.expires_at,
  policy_hash: bundle.policy_hash,
  source_commit: bundle.source_sha,
  worker_bundle_sha256: bundle.worker_bundle_sha256,
  recovery_ingress_key_id: bundle.origin_trust.key_id,
  recovery_origin_trust_contract: bundle.origin_trust.contract,
  public_recovery_trust_embedded: true,
  provider_credentials_included: false,
  production_deploy: false,
  database_mutation: false,
  secrets_included: false,
}));
