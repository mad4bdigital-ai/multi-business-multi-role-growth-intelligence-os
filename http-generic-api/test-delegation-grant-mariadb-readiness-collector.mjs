import assert from "node:assert/strict";
import {
  collectDelegationGrantMariaDbReadinessEvidence,
  _testingDelegationGrantMariaDbReadinessCollector,
} from "./delegationGrantMariaDbReadinessCollector.js";
import { _testingDelegationGrantMariaDbValidation } from "./delegationGrantMariaDbValidationService.js";

class FakeReadinessPool {
  constructor({ ledger = true, view = true, engine = "InnoDB", version = "11.4.8-MariaDB" } = {}) {
    this.options = { ledger, view, engine, version };
    this.queries = [];
  }

  async query(sql, params = []) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    this.queries.push({ sql: normalized, params: structuredClone(params) });

    if (normalized.includes("FROM governed_migration_ledger")) {
      if (!this.options.ledger) return [[]];
      return [[{
        run_id: "11111111-1111-4111-8111-111111111111",
        migration_file: params[0],
        migration_checksum_sha256: params[1],
        mode: "apply",
        statement_count: 2,
        preflight_status: "pass",
        preflight_risk_count: 0,
        applied_at: "2026-07-30T07:00:00.000Z",
        secrets_included: 0,
      }]];
    }
    if (normalized.includes("FROM information_schema.tables") && normalized.includes("table_name IN")) {
      return [[
        { table_name: "agent_delegations", engine: this.options.engine, table_collation: "utf8mb4_unicode_ci" },
        { table_name: "repository_automation_receipts", engine: this.options.engine, table_collation: "utf8mb4_unicode_ci" },
      ]];
    }
    if (normalized.includes("FROM information_schema.columns")) {
      return [[..._testingDelegationGrantMariaDbValidation.REQUIRED_AGENT_COLUMNS].map((column_name) => ({ column_name }))];
    }
    if (normalized.includes("FROM information_schema.statistics") && normalized.includes("agent_delegations")) {
      return [[..._testingDelegationGrantMariaDbValidation.REQUIRED_AGENT_INDEXES].map((index_name) => ({ index_name }))];
    }
    if (normalized.includes("FROM information_schema.statistics") && normalized.includes("repository_automation_receipts")) {
      return [[..._testingDelegationGrantMariaDbValidation.REQUIRED_RECEIPT_INDEXES].map((index_name) => ({ index_name }))];
    }
    if (normalized.includes("FROM information_schema.views")) {
      return [this.options.view ? [{ table_name: "effective_agent_delegation_grants_v" }] : []];
    }
    if (normalized.includes("FROM information_schema.schemata")) {
      return [[{ character_set: "utf8mb4", collation: "utf8mb4_unicode_ci" }]];
    }
    if (normalized.startsWith("SELECT @@VERSION")) {
      return [[{ version: this.options.version, sql_mode: "STRICT_TRANS_TABLES,NO_ZERO_DATE" }]];
    }
    if (normalized.includes("JSON_VALID")) return [[{ json_supported: 1 }]];
    if (normalized.includes("transaction_isolation")) return [[{ transaction_isolation: "READ-COMMITTED" }]];
    if (normalized.includes("tx_isolation")) return [[{ transaction_isolation: "READ-COMMITTED" }]];
    throw new Error(`Unexpected readiness SQL: ${normalized}`);
  }
}

{
  const pool = new FakeReadinessPool();
  const evidence = await collectDelegationGrantMariaDbReadinessEvidence({
    pool,
    now: "2026-07-30T07:10:00.000Z",
  });
  assert.equal(evidence.status, "verified_applied");
  assert.equal(evidence.migration_applied, true);
  assert.equal(evidence.readback_complete, true);
  assert.equal(evidence.statement_count, 2);
  assert.equal(evidence.ledger_match_count, 1);
  assert.equal(evidence.guarantees.metadata_queries_only, true);
  assert.equal(evidence.guarantees.database_write_performed, false);
  assert.ok(pool.queries.every(({ sql }) => /^SELECT\b/i.test(sql)));
}

{
  const pool = new FakeReadinessPool({ ledger: false, view: false, engine: "MyISAM" });
  const evidence = await collectDelegationGrantMariaDbReadinessEvidence({
    pool,
    expectedMigrationChecksum: "a".repeat(64),
    now: "2026-07-30T07:10:00.000Z",
  });
  assert.equal(evidence.status, "blocked");
  assert.equal(evidence.migration_applied, false);
  assert.equal(evidence.checksum_pin_match, false);
  assert.ok(evidence.blockers.includes("DELEGATION_MARIADB_LEDGER_APPLY_REQUIRED"));
  assert.ok(evidence.blockers.includes("DELEGATION_MARIADB_EFFECTIVE_VIEW_MISSING"));
  assert.ok(evidence.blockers.includes("DELEGATION_MARIADB_INNODB_REQUIRED"));
}

assert.equal(
  _testingDelegationGrantMariaDbReadinessCollector.checkConstraintsEnforced("11.4.8-MariaDB"),
  true,
);
assert.equal(
  _testingDelegationGrantMariaDbReadinessCollector.checkConstraintsEnforced("10.1.48-MariaDB"),
  false,
);

console.log("delegation grant MariaDB readiness collector tests passed");
