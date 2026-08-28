import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const productionPath = path.join(repoRoot, "edge", "activation-gateway", "generated", "route-policy.json");
const stagingPath = path.join(repoRoot, "edge", "activation-gateway", "generated", "route-policy.staging.json");
const EXPECTED = new Map([
  ["/admin/recovery/staging/contract", "getStagingRecoveryAdminContract"],
  ["/admin/recovery/staging/readiness", "getStagingRecoveryAdminReadiness"],
  ["/admin/recovery/staging/certification", "getStagingRecoveryCertificationStatus"],
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

test("staging route policy exposes only bounded Staging Recovery GET routes", () => {
  const production = readJson(productionPath);
  const staging = readJson(stagingPath);
  assert.equal(staging.policy_key, "activation_gateway_staging");
  assert.equal(staging.public_host, "activation-dev.mad4b.com");
  assert.equal(staging.upstream_origin, "https://dev.mad4b.com");
  for (const [routePath, operationId] of EXPECTED) {
    const route = staging.routes.find((entry) => entry.path === routePath);
    assert.ok(route, `missing staging route ${routePath}`);
    assert.equal(route.method, "GET", routePath);
    assert.equal(route.mutation, false, routePath);
    assert.deepEqual(route.operation_ids, [operationId], routePath);
    assert.deepEqual(route.surfaces, ["activation_admin_staging", "admin_recovery_staging"], routePath);
    assert.deepEqual(route.allowed_query_parameters, [], routePath);
    assert.equal(production.routes.some((entry) => entry.path === routePath), false, `Production policy must not expose ${routePath}`);
  }
  assert.deepEqual(staging.source_surfaces, ["activation_admin_staging", "admin_recovery_staging", "tenant_activation_staging"]);
  assert.equal(staging.secrets_included, false);
});

console.log("Staging Recovery route-policy isolation tests passed");
