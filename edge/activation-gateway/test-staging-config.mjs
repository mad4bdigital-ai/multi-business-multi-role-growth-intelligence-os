import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const policy = JSON.parse(fs.readFileSync(path.join(root, "generated/route-policy.staging.json"), "utf8"));
const wrangler = JSON.parse(fs.readFileSync(path.join(root, "wrangler.staging.jsonc"), "utf8"));

assert.equal(wrangler.name, "mad4b-activation-gateway-staging");
assert.equal(wrangler.main, "src/worker-staging.mjs");
assert.equal(wrangler.workers_dev, true);
assert.equal(wrangler.vars.ACTIVATION_GATEWAY_ENFORCE_HOST, "true");
assert.equal(policy.policy_key, "activation_gateway_staging");
assert.equal(policy.public_host, "activation-dev.mad4b.com");
assert.equal(policy.upstream_origin, "https://dev.mad4b.com");
assert.notEqual(policy.public_host, "activation.mad4b.com");
assert.notEqual(policy.upstream_origin, "https://auth.mad4b.com");
assert.equal(policy.deployment_signature_required, true);
assert.equal(policy.secrets_included, false);
assert.match(fs.readFileSync(path.join(root, "src/worker-staging.mjs"), "utf8"), /route-policy\.staging\.json/u);
console.log("activation_gateway_staging_config=PASS");
