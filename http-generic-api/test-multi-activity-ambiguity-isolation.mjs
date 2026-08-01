import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ACTIVITY_SELECTION_INTENT_FIELDS,
  DEFAULT_ACTIVITY_SELECTION_STATUSES,
  resolveActivityBindingSelection
} from "./src/domain/growthControlPlane/activityBindingSelection.js";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_WORKSPACE_ID = "44444444-4444-4444-8444-444444444444";
const BRAND_KEY = "example.brand";

const travelBinding = Object.freeze({
  activityBindingId: "55555555-5555-4555-8555-555555555555",
  tenantId: TENANT_ID,
  workspaceId: WORKSPACE_ID,
  brandKey: BRAND_KEY,
  activityTypeKey: "travel",
  activityPackKey: "travel.reference_pack",
  activityPackVersion: 1,
  status: "active",
  revision: 5
});

const hvacBinding = Object.freeze({
  activityBindingId: "66666666-6666-4666-8666-666666666666",
  tenantId: TENANT_ID,
  workspaceId: WORKSPACE_ID,
  brandKey: BRAND_KEY,
  activityTypeKey: "hvac_air_conditioning_services",
  activityPackKey: "hvac_air_conditioning_services.reference_pack",
  activityPackVersion: 1,
  status: "active",
  revision: 4
});

const foreignTenantBinding = Object.freeze({
  ...travelBinding,
  activityBindingId: "77777777-7777-4777-8777-777777777777",
  tenantId: OTHER_TENANT_ID,
  credentials: { token: "must-never-project" }
});

const foreignWorkspaceBinding = Object.freeze({
  ...hvacBinding,
  activityBindingId: "88888888-8888-4888-8888-888888888888",
  workspaceId: OTHER_WORKSPACE_ID
});

const inactiveBinding = Object.freeze({
  ...travelBinding,
  activityBindingId: "99999999-9999-4999-8999-999999999999",
  activityTypeKey: "seasonal_retail_program",
  status: "deprecated"
});

const scope = Object.freeze({
  tenantId: TENANT_ID,
  workspaceId: WORKSPACE_ID,
  brandKey: BRAND_KEY
});

assert.deepEqual(ACTIVITY_SELECTION_INTENT_FIELDS, [
  "activityBindingId",
  "activityTypeKey",
  "activityPackKey"
]);
assert.deepEqual(DEFAULT_ACTIVITY_SELECTION_STATUSES, ["active"]);

assert.throws(
  () => resolveActivityBindingSelection({
    bindings: [travelBinding, hvacBinding, foreignTenantBinding, foreignWorkspaceBinding, inactiveBinding],
    scope
  }),
  (error) => error.code === "GROWTH_CONTROL_ACTIVITY_SELECTION_AMBIGUOUS"
    && error.status === 409
    && error.details[0].candidateCount === 2
    && error.details[0].field === "activityIntent"
);

const travelSelection = resolveActivityBindingSelection({
  bindings: [travelBinding, hvacBinding, foreignTenantBinding, foreignWorkspaceBinding, inactiveBinding],
  scope,
  activityIntent: { activityTypeKey: "travel" }
});
assert.equal(travelSelection.binding.activityBindingId, travelBinding.activityBindingId);
assert.equal(travelSelection.binding.activityTypeKey, "travel");
assert.equal(travelSelection.binding.tenantId, TENANT_ID);
assert.equal(travelSelection.binding.workspaceId, WORKSPACE_ID);
assert.equal(travelSelection.binding.brandKey, BRAND_KEY);
assert.equal(travelSelection.selectionReason, "explicit_activity_intent");
assert.equal(travelSelection.candidateCount, 2);
assert.equal(travelSelection.providerCalls, false);
assert.equal(travelSelection.externalWrites, false);
assert.equal(travelSelection.secretsIncluded, false);
assert.match(travelSelection.evidenceSha256, /^[a-f0-9]{64}$/);
assert.equal(Object.hasOwn(travelSelection.binding, "credentials"), false);

const hvacSelection = resolveActivityBindingSelection({
  bindings: [travelBinding, hvacBinding],
  scope,
  activityIntent: { activityBindingId: hvacBinding.activityBindingId }
});
assert.equal(hvacSelection.binding.activityTypeKey, "hvac_air_conditioning_services");

const packSelection = resolveActivityBindingSelection({
  bindings: [travelBinding, hvacBinding],
  scope,
  activityIntent: { activityPackKey: "travel.reference_pack" }
});
assert.equal(packSelection.binding.activityBindingId, travelBinding.activityBindingId);

const singleSelection = resolveActivityBindingSelection({
  bindings: [travelBinding, foreignTenantBinding, foreignWorkspaceBinding, inactiveBinding],
  scope
});
assert.equal(singleSelection.binding.activityBindingId, travelBinding.activityBindingId);
assert.equal(singleSelection.selectionReason, "single_selectable_binding");
assert.equal(singleSelection.candidateCount, 1);

const repeatedSelection = resolveActivityBindingSelection({
  bindings: JSON.parse(JSON.stringify([travelBinding, hvacBinding])),
  scope: JSON.parse(JSON.stringify(scope)),
  activityIntent: { activityTypeKey: "travel" }
});
assert.equal(repeatedSelection.evidenceSha256, travelSelection.evidenceSha256);

const duplicateTravelBinding = {
  ...travelBinding,
  activityBindingId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  activityPackVersion: 2,
  revision: 1
};
assert.throws(
  () => resolveActivityBindingSelection({
    bindings: [travelBinding, duplicateTravelBinding],
    scope,
    activityIntent: { activityTypeKey: "travel" }
  }),
  (error) => error.code === "GROWTH_CONTROL_ACTIVITY_SELECTION_AMBIGUOUS"
    && error.status === 409
    && error.details[0].candidateCount === 2
);

assert.throws(
  () => resolveActivityBindingSelection({
    bindings: [travelBinding, hvacBinding],
    scope,
    activityIntent: {
      activityBindingId: travelBinding.activityBindingId,
      activityTypeKey: "travel"
    }
  }),
  (error) => error.code === "GROWTH_CONTROL_ACTIVITY_INTENT_INVALID"
    && error.status === 422
    && error.details[0].issue === "multiple_selectors"
);

assert.throws(
  () => resolveActivityBindingSelection({
    bindings: [travelBinding],
    scope,
    activityIntent: { activityTypeKey: "unknown_activity" }
  }),
  (error) => error.code === "GROWTH_CONTROL_ACTIVITY_BINDING_NOT_FOUND"
    && error.status === 404
);

assert.throws(
  () => resolveActivityBindingSelection({
    bindings: [foreignTenantBinding],
    scope,
    activityIntent: { activityBindingId: foreignTenantBinding.activityBindingId }
  }),
  (error) => error.code === "GROWTH_CONTROL_ACTIVITY_BINDING_NOT_FOUND"
    && error.status === 404
    && !JSON.stringify(error.details ?? []).includes(foreignTenantBinding.activityBindingId)
);

assert.throws(
  () => resolveActivityBindingSelection({
    bindings: [travelBinding],
    scope: { tenantId: TENANT_ID, workspaceId: WORKSPACE_ID }
  }),
  (error) => error.code === "GROWTH_CONTROL_ACTIVITY_SELECTION_SCOPE_INVALID"
    && error.status === 422
);

assert.throws(
  () => resolveActivityBindingSelection({
    bindings: [travelBinding],
    scope,
    activityIntent: { unsupported: "travel" }
  }),
  (error) => error.code === "GROWTH_CONTROL_ACTIVITY_INTENT_INVALID"
    && error.status === 422
    && error.details[0].issue === "unsupported"
);

const readySelection = resolveActivityBindingSelection({
  bindings: [{ ...travelBinding, status: "ready" }],
  scope,
  selectableStatuses: ["ready"]
});
assert.equal(readySelection.binding.status, "ready");

const selectorSource = readFileSync(
  "src/domain/growthControlPlane/activityBindingSelection.js",
  "utf8"
);
assert.equal(/(?:INSERT\s+INTO|UPDATE\s+[A-Za-z0-9_`]+\s+SET|DELETE\s+FROM)\s+/i.test(selectorSource), false);
assert.equal(selectorSource.includes("providerCalls: true"), false);
assert.equal(selectorSource.includes("externalWrites: true"), false);
assert.equal(selectorSource.includes("credentials"), false);
assert.equal(selectorSource.includes("token"), false);

console.log("multi-activity ambiguity and isolation tests passed");
