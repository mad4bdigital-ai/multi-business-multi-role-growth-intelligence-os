import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const productionPath = path.join(repoRoot, "edge", "activation-gateway", "generated", "route-policy.json");
const stagingPath = path.join(repoRoot, "edge", "activation-gateway", "generated", "route-policy.staging.json");
const EXPECTED = new Map([
  ["GET /admin/recovery/staging/contract", "getStagingRecoveryAdminContract"],
  ["GET /admin/recovery/staging/readiness", "getStagingRecoveryAdminReadiness"],
  ["GET /admin/recovery/staging/certification", "getStagingRecoveryCertificationStatus"],
  ["POST /admin/recovery/staging/gateway/rollout-plan", "previewStagingActivationGatewayRolloutPlan"],
  ["POST /admin/recovery/staging/gateway/dark-deploy-dry-run", "prepareStagingActivationGatewayDarkDeployDryRun"],
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

test("staging route policy exposes bounded Staging Recovery reads and Gateway preflight only", () => {
  const production = readJson(productionPath);
  const staging = readJson(stagingPath);
  assert.equal(staging.policy_key, "activation_gateway_staging");
  assert.equal(staging.public_host, "activation-dev.mad4b.com");
  assert.equal(staging.upstream_origin, "https://dev.mad4b.com");
  assert.equal(staging.read_stale_grace_seconds, 0);
  assert.deepEqual(staging.ready_provenance, {
    required: true,
    health_path: "/health",
    require_policy_hash: true,
    require_source_commit: true,
  });
  for (const [signature, operationId] of EXPECTED) {
    const [method, routePath] = signature.split(" ", 2);
    const route = staging.routes.find((entry) => entry.path === routePath && entry.method === method);
    assert.ok(route, `missing staging route ${signature}`);
    for (const field of ["request_body_limit_bytes", "response_body_limit_bytes", "timeout_ms"]) {
      assert(Number.isSafeInteger(route[field]) && route[field] > 0, `${signature}: ${field} must be bounded`);
    }
    const isMutationClass = method === "POST";
    assert.equal(route.mutation, isMutationClass, signature);
    assert.equal(route.freshness_class, isMutationClass ? "mutation_strict" : "recovery_strict", signature);
    assert.deepEqual(route.operation_ids, [operationId], signature);
    assert.deepEqual(route.surfaces, ["activation_admin_staging", "admin_recovery_staging"], signature);
    assert.deepEqual(route.allowed_query_parameters, [], signature);
    assert.equal(production.routes.some((entry) => entry.path === routePath && entry.method === method), false, `Production policy must not expose ${signature}`);
  }
  assert.equal(staging.routes.some((entry) => entry.path.includes("dark-deploy") && entry.method !== "POST"), false);
  assert.equal(staging.routes.some((entry) => entry.path.startsWith("/admin/recovery/staging/gateway/") && !EXPECTED.has(`${entry.method} ${entry.path}`)), false);
  assert.deepEqual(staging.source_surfaces, ["activation_admin_staging", "admin_recovery_staging", "tenant_activation_staging"]);
  assert.equal(staging.secrets_included, false);
});

console.log("Staging Recovery route-policy isolation tests passed");
