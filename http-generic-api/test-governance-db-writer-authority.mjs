import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveGovernanceDbConfig } from "./governanceDb.js";

const runtimeOnly = {
  DB_HOST: "db.internal",
  DB_PORT: "3306",
  DB_NAME: "platform",
  DB_USER: "runtime_reader",
  DB_PASSWORD: "runtime-secret-value",
};

assert.throws(
  () => resolveGovernanceDbConfig(runtimeOnly),
  (error) => {
    assert.equal(error?.code, "GOVERNANCE_DB_CONFIG_MISSING");
    assert.equal(error?.details?.governance_identity_required, true);
    assert.equal(error?.details?.runtime_identity_fallback_allowed, false);
    assert.equal(error?.details?.secrets_included, false);
    assert.ok(error?.details?.missing?.includes("GOVERNANCE_DB_USER"));
    assert.ok(error?.details?.missing?.includes("GOVERNANCE_DB_PASSWORD"));
    assert.doesNotMatch(String(error?.message || ""), /runtime-secret-value/);
    assert.doesNotMatch(JSON.stringify(error?.details || {}), /runtime-secret-value/);
    return true;
  },
  "runtime DB credentials must never satisfy the governance writer identity",
);

const inheritedEndpoint = resolveGovernanceDbConfig({
  ...runtimeOnly,
  GOVERNANCE_DB_USER: "governance_writer",
  GOVERNANCE_DB_PASSWORD: "governance-secret-value",
  GOVERNANCE_DB_CONNECTION_LIMIT: "99",
});
assert.equal(inheritedEndpoint.host, "db.internal");
assert.equal(inheritedEndpoint.port, 3306);
assert.equal(inheritedEndpoint.database, "platform");
assert.equal(inheritedEndpoint.user, "governance_writer");
assert.equal(inheritedEndpoint.password, "governance-secret-value");
assert.equal(inheritedEndpoint.connectionLimit, 5, "writer connection limit must remain bounded");
assert.notEqual(inheritedEndpoint.user, runtimeOnly.DB_USER);
assert.notEqual(inheritedEndpoint.password, runtimeOnly.DB_PASSWORD);

const dedicatedEndpoint = resolveGovernanceDbConfig({
  ...runtimeOnly,
  GOVERNANCE_DB_HOST: "governance-db.internal",
  GOVERNANCE_DB_PORT: "3307",
  GOVERNANCE_DB_NAME: "governance_platform",
  GOVERNANCE_DB_USER: "governance_writer",
  GOVERNANCE_DB_PASSWORD: "governance-secret-value",
  GOVERNANCE_DB_CONNECTION_LIMIT: "0",
});
assert.equal(dedicatedEndpoint.host, "governance-db.internal");
assert.equal(dedicatedEndpoint.port, 3307);
assert.equal(dedicatedEndpoint.database, "governance_platform");
assert.equal(dedicatedEndpoint.connectionLimit, 1);

const governanceDbSource = readFileSync(new URL("./governanceDb.js", import.meta.url), "utf8");
assert.match(governanceDbSource, /GOVERNANCE_DB_USER/);
assert.match(governanceDbSource, /GOVERNANCE_DB_PASSWORD/);
assert.match(governanceDbSource, /runtime_identity_fallback_allowed: false/);
assert.doesNotMatch(governanceDbSource, /GOVERNANCE_DB_USER\s*\|\|\s*(?:env\.)?DB_USER/);
assert.doesNotMatch(governanceDbSource, /GOVERNANCE_DB_PASSWORD\s*\|\|\s*(?:env\.)?DB_PASSWORD/);

const createSource = readFileSync(new URL("./scripts/capability-resolution-envelope-create.mjs", import.meta.url), "utf8");
assert.match(createSource, /const readPool = deps\.readPool \|\| getPool\(\)/);
assert.match(createSource, /const writerPool = deps\.writerPool \|\| getGovernancePool\(\)/);
assert.match(createSource, /await writerPool\.query\(`INSERT INTO capability_resolution_envelope_ledger/);

const approveSource = readFileSync(new URL("./scripts/capability-resolution-envelope-approve.mjs", import.meta.url), "utf8");
assert.match(approveSource, /getGovernancePool/);
assert.match(approveSource, /same-cycle readback/i);
assert.doesNotMatch(approveSource, /from "\.\.\/db\.js"/);

const applySource = readFileSync(new URL("./scripts/capability-resolution-envelope-apply-authorize.mjs", import.meta.url), "utf8");
assert.match(applySource, /getGovernancePool/);
assert.match(applySource, /same-cycle readback/i);
assert.doesNotMatch(applySource, /from "\.\.\/db\.js"/);

const guardSource = readFileSync(new URL("./capabilityResolutionEnvelopeGuard.js", import.meta.url), "utf8");
assert.match(guardSource, /resolveLifecycleMutationPool/);
assert.match(guardSource, /transactionPool: transactionPool \|\| legacyTransactionPool/);
assert.match(guardSource, /return getGovernancePool\(\)/);
assert.match(guardSource, /normalizedMode !== "apply"/);
assert.match(guardSource, /pool: writerPool \|\| getGovernancePool\(\)/);

const bootstrapSource = readFileSync(new URL("./governedMigrationAuthorizationBootstrap.js", import.meta.url), "utf8");
assert.match(bootstrapSource, /const readPool = deps\.readPool \|\| getPool\(\)/);
assert.match(bootstrapSource, /const writerPool = deps\.writerPool \|\| getGovernancePool\(\)/);
assert.match(bootstrapSource, /pool: readPool/);
assert.match(bootstrapSource, /pool: writerPool/);
assert.doesNotMatch(bootstrapSource, /deps\.pool \|\| getGovernancePool/);

console.log("Governance DB writer authority boundary tests passed");
