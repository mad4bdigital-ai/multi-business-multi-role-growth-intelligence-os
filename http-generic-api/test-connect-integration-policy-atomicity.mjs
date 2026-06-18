import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routes = readFileSync("routes/connectApiRoutes.js", "utf8");
const policy = readFileSync("hybridIntegrationPolicy.js", "utf8");

assert(routes.includes('router.post("/connect/api/integration-policy"'), "connect integration policy update route must exist");
assert(
  routes.includes("pool.getConnection") && routes.includes("beginTransaction") && routes.includes("commit()") && routes.includes("rollback()"),
  "connect integration policy update must use a DB transaction when the pool supports it"
);
assert(
  routes.indexOf("SELECT * FROM `tenant_connections`") < routes.indexOf("upsertTenantIntegrationPolicies({"),
  "connect integration policy update must pre-read required connection context before mutation"
);
assert(
  routes.includes("readiness_unavailable") && routes.includes("hybrid_integration_readiness_unavailable"),
  "post-write readiness failures must be reported as degraded readback, not as a failed mutation response"
);
assert(
  policy.includes("db = null") && policy.includes("const executor = db || getPool();") && policy.includes("await executor.query("),
  "tenant integration policy writer must accept a transaction executor"
);
assert(
  policy.includes("return { updated: 0, skipped: true, reason: err.code }"),
  "tenant integration policy writer must not report partial progress for schema-missing skips"
);

console.log("connect integration policy atomicity guard passed");
