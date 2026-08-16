import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const manifest = JSON.parse(read("autopilot-portable-staging/manifest.json"));

for (const entry of manifest.files) {
  const content = read(entry.path);
  const digest = crypto.createHash("sha256").update(content).digest("hex");
  assert.equal(digest, entry.sha256, `manifest hash mismatch: ${entry.path}`);
}

const compose = parse(read("http-generic-api/docker-compose.staging.yml"));
const env = read("http-generic-api/.env.staging.example");
const policy = JSON.parse(read("http-generic-api/config/domain-family-policy.json"));
const autopilot = read("autopilot-portable-staging/Start-AutoPilot.ps1");
const windowsPreflight = read("autopilot-portable-staging/Staging-Windows-Preflight.ps1");
const tunnel = compose.services.cloudflared;

assert.deepEqual(tunnel.profiles, ["tunnel"]);
assert.match(String(tunnel.image), /@sha256:/);
assert.equal(tunnel.depends_on.app.condition, "service_healthy");
assert.match(String(tunnel.command), /\$\{CLOUDFLARE_TUNNEL_TOKEN:-\}/);
assert.match(env, /^CLOUDFLARE_TUNNEL_HOSTNAMES=dev\.mad4b\.com,mcp_dev\.mad4b\.com\s*$/m);
assert.doesNotMatch(env, /^CLOUDFLARE_TUNNEL_HOSTNAMES=.*activation-dev/m);
assert.match(env, /^REMOTE_MCP_ENABLED=true\s*$/m);
assert.match(env, /^REMOTE_MCP_OAUTH_ENABLED=true\s*$/m);
assert.match(env, /^REMOTE_MCP_RESOURCE_URL=https:\/\/mcp_dev\.mad4b\.com\s*$/m);
assert.match(env, /^CLOUDFLARE_TUNNEL_ORIGIN_APP=http:\/\/app:8080\s*$/m);
assert.match(env, /^CLOUDFLARE_TUNNEL_TOKEN=\s*$/m);
assert.match(env, /^TENANT_GPT_SSO_COOKIE_MODE=host_only\s*$/m);
assert.match(env, /^MIGRATION_APPLIED=false\s*$/m);
assert.match(env, /^DATABASE_MUTATED=false\s*$/m);
assert.deepEqual(policy.environments.staging.active_tunnel_hostnames, ["dev.mad4b.com", "mcp_dev.mad4b.com"]);
assert.deepEqual(policy.environments.staging.active_worker_custom_domains, ["activation-dev.mad4b.com"]);
assert.deepEqual(policy.environments.staging.reserved_disabled_hostnames, []);
assert.match(windowsPreflight, /function Test-StagingWsl2DistributionReady/);
assert.match(windowsPreflight, /-replace "\\x00", ""/);
assert.match(windowsPreflight, /function Wait-StagingWsl2Distribution/);
assert.match(autopilot, /Staging-Windows-Preflight\.ps1/);
assert.match(autopilot, /Test-StagingWsl2Ready/);
assert.match(autopilot, /Assert-Sha/);
assert.match(autopilot, /Working tree is not clean/);
assert.match(autopilot, /DOCKER_HOST/);
assert.match(autopilot, /DOCKER_CONTEXT/);
assert.match(autopilot, /MIGRATION_APPLIED=false/);
assert.match(autopilot, /DATABASE_MUTATED=false/);
assert.doesNotMatch(autopilot, /Invoke-WebRequest|curl|cloudflare.*api|hostinger.*api/i);

console.log("staging_autopilot_closure=PASS");
