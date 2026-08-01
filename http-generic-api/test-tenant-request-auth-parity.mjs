import assert from "node:assert/strict";
import fs from "node:fs";

const plan = JSON.parse(fs.readFileSync("frontend-surface-dispatch.generated.json", "utf8"));
const operations = plan.families.flatMap((family) => family.operations || []);

for (const signature of [
  "GET /tenants/{tenantId}/requests",
  "GET /tenants/{tenantId}/requests/{ticketId}",
]) {
  const matches = operations.filter(
    (operation) => operation.signature === signature
      && operation.source_file === "routes/supportTicketRoutes.js",
  );
  assert.equal(matches.length, 1, `${signature} must have one generated dispatch operation`);
  const [operation] = matches;
  assert.equal(operation.runtime_auth?.state, "resolved", `${signature} runtime auth evidence must resolve`);
  assert.equal(operation.runtime_auth?.profile, "user_jwt", `${signature} must require the central User JWT profile`);
  assert(
    operation.runtime_auth?.guard_chain?.includes("requireTenantUserJwt"),
    `${signature} must preserve the statically recognized central tenant JWT guard`,
  );
  assert.equal(operation.auth_parity?.state, "equivalent", `${signature} runtime auth must match OpenAPI userJwtAuth`);
  assert.deepEqual(operation.runtime_auth?.alternatives, [["userJwtAuth"]]);
}

for (const signature of [
  "GET /me/support/tickets",
  "POST /me/support/tickets",
]) {
  const matches = operations.filter(
    (operation) => operation.signature === signature
      && operation.source_file === "routes/supportTicketLifecycleIntegrityRoutes.js",
  );
  assert.equal(matches.length, 1, `${signature} from synchronized main must remain in the combined generated dispatch`);
  const [operation] = matches;
  assert.equal(operation.runtime_auth?.state, "resolved", `${signature} runtime auth evidence must remain resolved after synchronization`);
  assert.equal(operation.runtime_auth?.profile, "user_jwt", `${signature} must retain its User JWT profile after generated merge`);
}

assert.equal(plan.coverage.auth_contract_gap_count, 0, "tenant inbox routes must not introduce auth parity gaps");
console.log("tenant request and synchronized support-ticket generated auth parity regression passed");
