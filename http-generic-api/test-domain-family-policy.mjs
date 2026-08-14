import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const policy = JSON.parse(read("http-generic-api/config/domain-family-policy.json"));
const deployment = JSON.parse(read("http-generic-api/config/deployment-branch-policy.json"));
const env = read("http-generic-api/.env.staging.example");
const compose = parse(read("http-generic-api/docker-compose.staging.yml"));

assert.equal(policy.enforcement_mode, "fail_closed");
assert.deepEqual(policy.default_route, {
  action: "http_status",
  status: 404,
  reason: "unmatched_hostname_is_not_routable",
});

const production = Object.values(policy.environments.production.hostnames);
const staging = Object.values(policy.environments.staging.hostnames);
const productionNames = production.map((entry) => entry.hostname);
const stagingNames = staging.map((entry) => entry.hostname);
assert.deepEqual(productionNames, ["auth.mad4b.com", "mcp.mad4b.com", "activation.mad4b.com"]);
assert.deepEqual(stagingNames, ["dev.mad4b.com", "mcp_dev.mad4b.com", "activation_dev.mad4b.com"]);
assert.equal(new Set([...productionNames, ...stagingNames]).size, 6);
assert.equal(production.some((entry) => entry.origin_kind !== "hostinger_production"), false);
assert.equal(staging.some((entry) => entry.origin_kind !== "local_staging_app"), false);
assert.equal(policy.environments.production.tunnel_enabled, false);
assert.equal(policy.environments.staging.tunnel_enabled, true);
assert.notEqual(policy.environments.production.credential_namespace, policy.environments.staging.credential_namespace);

assert.deepEqual(deployment.production.hostnames, productionNames);
assert.deepEqual(deployment.staging.hostnames, stagingNames);
assert.equal(deployment.connector_recovery.excluded_from_hostname_families, true);

for (const hostname of productionNames) assert.equal(env.includes(hostname), false, `staging env must not contain Production hostname ${hostname}`);
assert.match(env, /CLOUDFLARE_TUNNEL_ENVIRONMENT=staging/);
assert.match(env, /CLOUDFLARE_TUNNEL_HOSTNAMES=dev\.mad4b\.com,mcp_dev\.mad4b\.com,activation_dev\.mad4b\.com/);
assert.match(env, /CLOUDFLARE_TUNNEL_ORIGIN_APP=http:\/\/app:8080/);
assert.match(env, /CLOUDFLARE_TUNNEL_TOKEN=\s*$/m);
assert.match(env, /MIGRATION_APPLIED=false/);
assert.match(env, /DATABASE_MUTATED=false/);

const tunnel = compose.services.cloudflared;
assert.deepEqual(tunnel.profiles, ["tunnel"]);
assert.match(String(tunnel.command), /--token/);
assert.equal(String(tunnel.environment.TUNNEL_ENVIRONMENT), "${CLOUDFLARE_TUNNEL_ENVIRONMENT:-staging}");
assert.equal(String(tunnel.environment.TUNNEL_ORIGIN_APP), "${CLOUDFLARE_TUNNEL_ORIGIN_APP:-http://app:8080}");
assert.equal(String(tunnel.environment.TUNNEL_HOSTNAMES), "${CLOUDFLARE_TUNNEL_HOSTNAMES:-dev.mad4b.com,mcp_dev.mad4b.com,activation_dev.mad4b.com}");

console.log("domain_family_policy=PASS");
