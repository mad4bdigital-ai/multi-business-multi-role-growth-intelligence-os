import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveGovernanceDbConfig } from "./governanceDb.js";
import { _testingCapabilityResolutionEnvelopeGuardFacade } from "./capabilityResolutionEnvelopeGuard.js";

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

const runtimePool = {
  query: async () => [],
  getConnection: async () => null,
};
const transactionConnection = {
  query: async () => [],
  beginTransaction: async () => {},
  commit: async () => {},
  rollback: async () => {},
  release: () => {},
};
const writerSentinel = { query: async () => [] };
const {
  isExplicitLifecycleTransaction,
  resolveLifecycleMutationPool,
} = _testingCapabilityResolutionEnvelopeGuardFacade;

assert.equal(isExplicitLifecycleTransaction(runtimePool), false, "a general runtime pool must never qualify as a lifecycle transaction");
assert.equal(isExplicitLifecycleTransaction(transactionConnection), true, "an already-open SQL connection may qualify for transaction-bound lifecycle work");
assert.equal(
  resolveLifecycleMutationPool({ legacyPool: runtimePool, governancePoolFactory: () => writerSentinel }),
  writerSentinel,
  "legacy general runtime pool injection must resolve to the dedicated Governance writer",
);
assert.equal(
  resolveLifecycleMutationPool({ legacyPool: transactionConnection, governancePoolFactory: () => writerSentinel }),
  transactionConnection,
  "legacy compatibility is bounded to an actual transaction connection only",
);
assert.equal(
  resolveLifecycleMutationPool({ transactionPool: transactionConnection, governancePoolFactory: () => writerSentinel }),
  transactionConnection,
  "explicit transactionPool must preserve same-cycle execution transaction semantics",
);
assert.throws(
  () => resolveLifecycleMutationPool({ transactionPool: runtimePool, governancePoolFactory: () => writerSentinel }),
  (error) => error?.code === "CAPABILITY_ENVELOPE_LIFECYCLE_TRANSACTION_INVALID"
    && error?.details?.general_runtime_pool_allowed === false
    && error?.details?.secrets_included === false,
  "explicit transactionPool must fail closed when a broad pool is supplied",
);

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
assert.match(guardSource, /isExplicitLifecycleTransaction/);
assert.match(guardSource, /typeof candidate\.getConnection !== "function"/);
assert.match(guardSource, /legacyPool/);
assert.match(guardSource, /return governancePoolFactory\(\)/);
assert.match(guardSource, /CAPABILITY_ENVELOPE_LIFECYCLE_TRANSACTION_INVALID/);
assert.match(guardSource, /normalizedMode !== "apply"/);
assert.match(guardSource, /pool: writerPool \|\| getGovernancePool\(\)/);

const bootstrapSource = readFileSync(new URL("./governedMigrationAuthorizationBootstrap.js", import.meta.url), "utf8");
assert.match(bootstrapSource, /const readPool = deps\.readPool \|\| getPool\(\)/);
assert.match(bootstrapSource, /const writerPool = deps\.writerPool \|\| getGovernancePool\(\)/);
assert.match(bootstrapSource, /pool: readPool/);
assert.match(bootstrapSource, /pool: writerPool/);
assert.doesNotMatch(bootstrapSource, /deps\.pool \|\| getGovernancePool/);

console.log("Governance DB writer authority boundary tests passed");
