import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const routes = fs.readFileSync(path.join(__dirname, "routes/gptToolsRoutes.js"), "utf8");
const migration = fs.readFileSync(path.join(__dirname, "migrations/20260729_auth_mad4b_proxy_rollout_surface.sql"), "utf8");
const rollout = fs.readFileSync(path.join(__dirname, "authMad4bProxyRolloutTool.js"), "utf8");
const edgeWorker = fs.readFileSync(path.join(repoRoot, "edge/auth-mad4b-proxy/src/worker.mjs"), "utf8");
const edgeProxy = fs.readFileSync(path.join(repoRoot, "edge/auth-mad4b-proxy/src/proxy.mjs"), "utf8");

assert.match(routes, /name:\s*"auth_mad4b_proxy_rollout"/);
assert.match(routes, /toolKey === "auth_mad4b_proxy_rollout"/);
assert.match(routes, /runAuthMad4bProxyRollout\(args \|\| \{\}/);
assert.match(routes, /additionalProperties:\s*false/);

for (const value of [
  "auth_mad4b_proxy_deploy_authority_v1",
  "auth_mad4b_proxy_deploy_apply_policy_v1",
  "auth_mad4b_proxy_deploy_v1",
  "177b60cd-427e-4564-abf3-0ff70791a03c",
  "cloudflare://accounts/dd1024b934e907723484568d97c7c74c/workers/scripts/auth-mad4b-proxy",
  "bind_tool_auth_mad4b_proxy_rollout",
]) {
  assert.ok(migration.includes(value), `migration must include ${value}`);
}

for (const forbiddenPolicy of [
  "'dns_write_allowed', FALSE",
  "'worker_route_write_allowed', FALSE",
  "'custom_domain_binding_allowed', FALSE",
  "'subdomain_write_allowed', FALSE",
  "'secret_write_allowed', FALSE",
  "'secret_return_allowed', FALSE",
]) {
  assert.ok(migration.includes(forbiddenPolicy), `migration must forbid ${forbiddenPolicy}`);
}

assert.match(rollout, /script_name:\s*"auth-mad4b-proxy"/);
assert.match(rollout, /account_id:\s*"dd1024b934e907723484568d97c7c74c"/);
assert.match(rollout, /method:\s*"PUT",\s*\n\s*formData/);
assert.match(rollout, /restore_previous_deployment_versions/);
assert.match(rollout, /worker_source_contains_exact_modules/);
assert.match(rollout, /health_status_200/);
assert.equal(rollout.includes("/dns_records"), false);
assert.equal(rollout.includes("/workers/routes"), false);
assert.equal(rollout.includes("/secrets"), false);
assert.equal(rollout.includes("/subdomain\","), false);

assert.match(edgeWorker, /createAuthProxyHandler/);
assert.match(edgeProxy, /EDGE_ORIGIN_UNAVAILABLE/);

console.log("auth mad4b proxy rollout surface tests passed");
