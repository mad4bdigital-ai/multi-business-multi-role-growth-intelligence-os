import assert from "node:assert/strict";

import {
  computeInvalidatedDimensions,
  createContextHash,
  createContextRevision,
  validateContextRevision,
} from "./contextKernel/domain/index.js";

const base = {
  principal: { principalType: "tenant_user", principalRef: "user-a" },
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
  authority: {
    ownerScopeType: "workspace",
    ownerScopeRef: "workspace-a",
    ownerScopeRevision: "owner-rev-1",
  },
  capability: { capabilityKey: "repo.read", manifestVersion: 1 },
  secret: "must-not-affect-public-hash",
  nested: { accessToken: "must-not-affect-public-hash" },
};

const baseHash = createContextHash(base);
assert.match(baseHash, /^[a-f0-9]{64}$/u);
assert.equal(
  createContextHash({ ...base, secret: "different-secret", nested: { accessToken: "different-token" } }),
  baseHash,
  "sensitive values must not affect the public context hash",
);
assert.notEqual(
  createContextHash({
    ...base,
    authority: { ...base.authority, ownerScopeRevision: "owner-rev-2" },
  }),
  baseHash,
  "owner-scope revision movement must change the context hash",
);

const revision = createContextRevision(base);
assert.match(revision, /^[a-f0-9]{64}$/u);
assert.deepEqual(validateContextRevision({ expectedRevision: revision, actualRevision: revision }), {
  valid: true,
  reasonCodes: [],
  actualRevision: revision,
});
assert.equal(
  validateContextRevision({ expectedRevision: revision, actualRevision: "stale-revision" }).valid,
  false,
);

const authorityInvalidation = computeInvalidatedDimensions(["authority"]);
assert.deepEqual(authorityInvalidation, ["authority", "capability", "plan", "approval", "execution"]);

const workspaceInvalidation = computeInvalidatedDimensions(["workspace"]);
assert.deepEqual(workspaceInvalidation, [
  "workspace",
  "brand",
  "resource",
  "connection",
  "authority",
  "capability",
  "plan",
  "approval",
  "execution",
]);

assert.throws(() => computeInvalidatedDimensions(["unknown"]), /Unknown context dimension/u);

console.log("context kernel integrity regression tests passed");
