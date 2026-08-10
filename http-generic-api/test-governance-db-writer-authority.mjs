import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveGovernanceDbConfig } from "./governanceDb.js";
import {
  GOVERNANCE_DB_REQUIRED_PRIVILEGES,
  evaluateGovernanceGrantStatements,
  getGovernanceDbWriteReadiness,
  parseGovernanceGrantStatement,
} from "./governanceDbWriteReadiness.js";
import { _testingCapabilityResolutionEnvelopeGuardFacade } from "./capabilityResolutionEnvelopeGuard.js";
import {
  applyPlatformResourceAuthorityGrant,
  buildPlatformResourceAuthorityGrantPlan,
} from "./platformResourceAuthorityGrantTool.js";

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

assert.deepEqual(GOVERNANCE_DB_REQUIRED_PRIVILEGES.platform_resource_authority_bindings, ["SELECT", "INSERT"]);
assert.deepEqual(GOVERNANCE_DB_REQUIRED_PRIVILEGES.governed_tool_response_chunks, ["SELECT", "INSERT", "UPDATE", "DELETE"]);
assert.equal(parseGovernanceGrantStatement("GRANT INSERT, UPDATE ON `platform`.`example` TO `writer`@`%`").table, "example");

const exactGrantStatements = [
  "GRANT USAGE ON *.* TO `writer`@`%`",
  "GRANT SELECT, INSERT, UPDATE ON `platform`.`capability_resolution_envelope_ledger` TO `writer`@`%`",
  "GRANT INSERT ON `platform`.`approval_holds` TO `writer`@`%`",
  "GRANT SELECT, INSERT, UPDATE ON `platform`.`governed_migration_authorization_registry` TO `writer`@`%`",
  "GRANT SELECT, INSERT, UPDATE ON `platform`.`capability_apply_authorization_policy_registry` TO `writer`@`%`",
  "GRANT SELECT, INSERT, UPDATE ON `platform`.`runtime_dispatch_certification_registry` TO `writer`@`%`",
  "GRANT SELECT ON `platform`.`governed_migration_ledger` TO `writer`@`%`",
  "GRANT SELECT, INSERT ON `platform`.`platform_resource_authority_bindings` TO `writer`@`%`",
  "GRANT SELECT, INSERT, UPDATE, DELETE ON `platform`.`governed_tool_response_chunks` TO `writer`@`%`",
];

const exactReadiness = evaluateGovernanceGrantStatements({ database: "platform", grantStatements: exactGrantStatements });
assert.equal(exactReadiness.status, "ready");
assert.equal(exactReadiness.missing_count, 0);
assert.equal(exactReadiness.prohibited_grant_count, 0);
assert.equal(exactReadiness.raw_grants_included, false);
assert.equal(exactReadiness.secrets_included, false);

const missingEnvelopeInsert = evaluateGovernanceGrantStatements({
  database: "platform",
  grantStatements: exactGrantStatements.map((statement) => statement.replace(
    "SELECT, INSERT, UPDATE ON `platform`.`capability_resolution_envelope_ledger`",
    "SELECT, UPDATE ON `platform`.`capability_resolution_envelope_ledger`",
  )),
});
assert.equal(missingEnvelopeInsert.status, "degraded");
assert.ok(missingEnvelopeInsert.missing_privileges.some(
  ({ table, operation }) => table === "capability_resolution_envelope_ledger" && operation === "INSERT",
));

const missingChunkDelete = evaluateGovernanceGrantStatements({
  database: "platform",
  grantStatements: exactGrantStatements.map((statement) => statement.replace(
    "SELECT, INSERT, UPDATE, DELETE ON `platform`.`governed_tool_response_chunks`",
    "SELECT, INSERT, UPDATE ON `platform`.`governed_tool_response_chunks`",
  )),
});
assert.equal(missingChunkDelete.status, "degraded");
assert.ok(missingChunkDelete.missing_privileges.some(
  ({ table, operation }) => table === "governed_tool_response_chunks" && operation === "DELETE",
));

const broadGrant = evaluateGovernanceGrantStatements({
  database: "platform",
  grantStatements: [...exactGrantStatements, "GRANT INSERT, UPDATE ON `platform`.* TO `writer`@`%`"],
});
assert.equal(broadGrant.status, "degraded");
assert.ok(broadGrant.prohibited_privileges.some(({ reason }) => reason === "privilege_outside_reviewed_table_scope"));

const adminGrant = evaluateGovernanceGrantStatements({
  database: "platform",
  grantStatements: [...exactGrantStatements, "GRANT ALL PRIVILEGES ON *.* TO `writer`@`%` WITH GRANT OPTION"],
});
assert.equal(adminGrant.status, "degraded");
assert.ok(adminGrant.prohibited_privileges.some(({ privilege }) => privilege === "ALL PRIVILEGES"));
assert.ok(adminGrant.prohibited_privileges.some(({ privilege }) => privilege === "GRANT OPTION"));

const readinessWriterPool = {
  async query(sql) {
    if (sql.startsWith("SELECT CURRENT_USER()")) {
      return [[{ current_user: "writer@%", database_name: "platform" }]];
    }
    if (sql.startsWith("SHOW GRANTS")) {
      return [exactGrantStatements.map((statement) => ({ "Grants for writer@%": statement }))];
    }
    throw new Error(`Unexpected readiness SQL: ${sql}`);
  },
};
const liveStyleReadiness = await getGovernanceDbWriteReadiness({ writerPool: readinessWriterPool });
assert.equal(liveStyleReadiness.status, "ready");
assert.equal(liveStyleReadiness.principal, "writer@%");
assert.equal(liveStyleReadiness.database, "platform");
assert.equal(liveStyleReadiness.raw_grants_included, false);
assert.doesNotMatch(JSON.stringify(liveStyleReadiness), /GRANT SELECT|governance-secret-value|runtime-secret-value/);

const grantArgs = {
  tenant_id: "11111111-1111-4111-8111-111111111111",
  workspace_id: "22222222-2222-4222-8222-222222222222",
  user_id: "33333333-3333-4333-8333-333333333333",
  resource_type: "github_repo",
  resource_uri: "github://owner/repo",
  resource_ref: {
    branch: "gpt/governance-writer-test",
    expected_commit_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  },
  recipe_key: "repo_patch_apply",
};
const dryGrantPlan = buildPlatformResourceAuthorityGrantPlan(grantArgs);
let storedBindingRow = null;
let writerInsertCount = 0;
let writerSelectCount = 0;
let readerSelectCount = 0;
const resourceWriterPool = {
  async query(sql, params = []) {
    if (sql.includes("INSERT INTO platform_resource_authority_bindings")) {
      writerInsertCount += 1;
      storedBindingRow = {
        binding_id: params[0],
        tenant_id: params[1],
        workspace_id: params[2],
        user_id: params[3],
        resource_type: params[4],
        resource_uri: params[5],
        resource_ref_json: params[6],
        recipe_key: params[7],
        permission_level: params[8],
        allowed_modes_json: params[9],
        authority_source: params[10],
        expires_at: new Date("2026-08-10T20:00:00.000Z"),
        status: "active",
        created_at: new Date("2026-08-10T19:00:00.000Z"),
      };
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("FROM platform_resource_authority_bindings")) {
      writerSelectCount += 1;
      return [[storedBindingRow]];
    }
    throw new Error(`Unexpected resource writer SQL: ${sql}`);
  },
};
const resourceReadPool = {
  async query(sql) {
    if (sql.includes("FROM platform_resource_authority_bindings")) {
      readerSelectCount += 1;
      return [[storedBindingRow]];
    }
    throw new Error(`Unexpected resource reader SQL: ${sql}`);
  },
};
const appliedGrant = await applyPlatformResourceAuthorityGrant({
  ...grantArgs,
  mode: "apply",
  ttl_minutes: 30,
  confirm: dryGrantPlan.expected_confirm,
}, { writerPool: resourceWriterPool, readPool: resourceReadPool });
assert.equal(appliedGrant.readback_verified, true);
assert.equal(appliedGrant.runtime_readback_verified, true);
assert.equal(writerInsertCount, 1);
assert.equal(writerSelectCount, 1);
assert.equal(readerSelectCount, 1);

const governanceDbSource = readFileSync(new URL("./governanceDb.js", import.meta.url), "utf8");
assert.match(governanceDbSource, /GOVERNANCE_DB_USER/);
assert.match(governanceDbSource, /GOVERNANCE_DB_PASSWORD/);
assert.match(governanceDbSource, /runtime_identity_fallback_allowed: false/);
assert.doesNotMatch(governanceDbSource, /GOVERNANCE_DB_USER\s*\|\|\s*(?:env\.)?DB_USER/);
assert.doesNotMatch(governanceDbSource, /GOVERNANCE_DB_PASSWORD\s*\|\|\s*(?:env\.)?DB_PASSWORD/);

const readinessSource = readFileSync(new URL("./governanceDbWriteReadiness.js", import.meta.url), "utf8");
assert.match(readinessSource, /SHOW GRANTS FOR CURRENT_USER/);
assert.match(readinessSource, /runtime_db_write_authority_degraded/);
assert.match(readinessSource, /raw_grants_included: false/);
assert.match(readinessSource, /platform_resource_authority_bindings/);
assert.match(readinessSource, /governed_tool_response_chunks/);

const resourceAuthoritySource = readFileSync(new URL("./platformResourceAuthorityGrantTool.js", import.meta.url), "utf8");
assert.match(resourceAuthoritySource, /getGovernancePool/);
assert.match(resourceAuthoritySource, /const writerPool = deps\.writerPool \|\| getGovernancePool\(\)/);
assert.match(resourceAuthoritySource, /const readPool = deps\.readPool \|\| getPool\(\)/);
assert.match(resourceAuthoritySource, /await writerPool\.query/);
assert.match(resourceAuthoritySource, /runtime_readback_verified: true/);
assert.doesNotMatch(resourceAuthoritySource, /const pool = getPool\(\);\s*const bindingId/);

const chunkSource = readFileSync(new URL("./governedToolResponseChunkStore.js", import.meta.url), "utf8");
assert.match(chunkSource, /getGovernancePool/);
assert.match(chunkSource, /function readExecutor/);
assert.match(chunkSource, /function writeExecutor/);
assert.match(chunkSource, /return deps\.writerPool \|\| deps\.connection \|\| getGovernancePool\(\)/);
assert.doesNotMatch(chunkSource, /function writeExecutor[\s\S]{0,200}deps\.pool/);
assert.match(chunkSource, /await writeExecutor\(deps\)\.query\(\s*`INSERT INTO/);
assert.match(chunkSource, /await writeExecutor\(deps\)\.query\(\s*`UPDATE/);
assert.match(chunkSource, /await writeExecutor\(deps\)\.query\(\s*`DELETE/);

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
