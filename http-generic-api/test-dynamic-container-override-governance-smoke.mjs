import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DYNAMIC_CONTAINER_OVERRIDE_GOVERNANCE_SMOKE_CONFIRM,
  buildDynamicContainerOverrideGovernanceSmokePlan,
  runDynamicContainerOverrideGovernanceSmoke
} from "./dynamicContainerOverrideGovernanceSmoke.js";

const plan=buildDynamicContainerOverrideGovernanceSmokePlan();
assert.equal(plan.confirmation,DYNAMIC_CONTAINER_OVERRIDE_GOVERNANCE_SMOKE_CONFIRM);
assert.deepEqual(plan.tests,[
  "self_approval_policy_verified",
  "distinct_dual_approval_required",
  "stale_authority_epoch_rejected",
  "one_time_consumption_enforced",
  "fixture_cleanup_verified"
]);
assert.equal(plan.fixtureStrategy,"transactional_disposable_rows");
assert.equal(plan.providerCalls,false);
assert.equal(plan.externalWrites,false);
assert.equal(plan.enforcementApplied,false);

const dryRun=await runDynamicContainerOverrideGovernanceSmoke({ mode:"dry_run" });
assert.equal(dryRun.ok,true);
assert.equal(dryRun.mode,"dry_run");
assert.equal(dryRun.results,null);
assert.equal(dryRun.cleanup,null);
assert.equal(dryRun.sameCycleReadbackVerified,false);
assert.equal(dryRun.targetExecuted,false);
assert.equal(dryRun.rolloutChanged,false);

const service=readFileSync(new URL("./dynamicContainerOverrideGovernanceSmoke.js",import.meta.url),"utf8");
const routes=readFileSync(new URL("./routes/dynamicContainerOverrideGovernanceSmokeRoutes.js",import.meta.url),"utf8");
const routeIndex=readFileSync(new URL("./routes/index.js",import.meta.url),"utf8");
const componentOpenapi=readFileSync(new URL("./openapi/container-authority.yaml",import.meta.url),"utf8");
const rootOpenapi=readFileSync(new URL("./openapi.yaml",import.meta.url),"utf8");
const migration=readFileSync(new URL("./migrations/20260723_dynamic_container_override_governance_smoke.sql",import.meta.url),"utf8");

assert.match(service,/resolveCapabilityExecutionEnvelope/);
assert.match(service,/transitionCapabilityEnvelopeLifecycle/);
assert.match(service,/beginTransaction/);
assert.match(service,/container_effective_context_ledger/);
assert.match(service,/SAVEPOINT override_smoke_duplicate_approval/);
assert.match(service,/SAVEPOINT override_smoke_duplicate_consumption/);
assert.match(service,/DELETE FROM container_override_consumptions/);
assert.match(service,/DELETE FROM container_effective_context_ledger/);
assert.match(service,/platform_closure_threads/);
assert.match(routes,/\/admin\/container-authority\/override-governance-smokes/);
assert.match(routes,/runDynamicContainerOverrideGovernanceSmoke/);
assert.match(routeIndex,/buildDynamicContainerOverrideGovernanceSmokeRoutes/);
assert.match(componentOpenapi,/OverrideGovernanceSmokeRequest:/);
assert.match(componentOpenapi,/OverrideGovernanceSmokeResponse:/);
assert.match(componentOpenapi,/operationId: createAdminContainerAuthorityOverrideGovernanceSmoke/);
assert.match(componentOpenapi,/x-registry-tool-key: dynamic_container_override_governance_smoke/);
assert.match(rootOpenapi,/\/admin\/container-authority\/override-governance-smokes:/);
assert.match(migration,/dynamic_container_override_governance_smoke_policy_v1/);
assert.match(migration,/transactional_disposable_rows/);
assert.match(migration,/no_provider_call/);
assert.match(migration,/no_external_write/);
assert.match(migration,/secrets_included=false/);

console.log("dynamic container override governance smoke contracts passed");
