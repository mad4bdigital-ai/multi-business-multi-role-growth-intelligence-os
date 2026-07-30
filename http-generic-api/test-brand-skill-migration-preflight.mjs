import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessBrandSkillMigrationPreflight } from "./brandSkillMigrationPreflight.js";

const REQUIRED_COLLATION = "utf8mb4_uca1400_ai_ci";
const GENERIC_REQUIRED_COLLATION = "uca1400_ai_ci";
const DEFAULT_BASELINE_OBJECTS = [
  { TABLE_NAME: "agent_skill_grants", TABLE_TYPE: "BASE TABLE" },
  { TABLE_NAME: "v_effective_agent_skill_grants", TABLE_TYPE: "VIEW" },
];
const DEFAULT_BASELINE_COLUMNS = [
  "grant_id",
  "agent_id",
  "skill_id",
  "tenant_id",
  "brand_key",
].map((COLUMN_NAME) => ({
  COLUMN_NAME,
  DATA_TYPE: "varchar",
  COLLATION_NAME: REQUIRED_COLLATION,
}));
const DEFAULT_AGENT_SKILL_COLUMNS = [
  { COLUMN_NAME: "skill_id", DATA_TYPE: "varchar", COLLATION_NAME: REQUIRED_COLLATION },
  { COLUMN_NAME: "skill_key", DATA_TYPE: "varchar", COLLATION_NAME: REQUIRED_COLLATION },
  { COLUMN_NAME: "status", DATA_TYPE: "enum", COLLATION_NAME: REQUIRED_COLLATION },
];

function buildPool({
  targetObjects = [],
  baselineObjects = DEFAULT_BASELINE_OBJECTS,
  baselineColumns = DEFAULT_BASELINE_COLUMNS,
  agentSkillColumns = DEFAULT_AGENT_SKILL_COLUMNS,
  availableCollation = REQUIRED_COLLATION,
} = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, " ").trim();
      queries.push({ sql: text, params: [...params] });
      assert.match(text, /^SELECT\b/i, `preflight query must be read-only: ${text}`);
      if (text.includes("SELECT VERSION()")) {
        return [[{ version: "10.11.8-MariaDB", version_comment: "MariaDB Server" }]];
      }
      if (text.includes("information_schema.COLLATIONS")) {
        assert.deepEqual(params, [REQUIRED_COLLATION, GENERIC_REQUIRED_COLLATION]);
        return availableCollation ? [[{ COLLATION_NAME: availableCollation }]] : [[]];
      }
      if (text.includes("SELECT SHA2")) {
        return [[{ sha2_probe: "a".repeat(64) }]];
      }
      if (text.includes("information_schema.TABLES") && params.includes("v_effective_user_brand_skill_grants")) {
        return [targetObjects];
      }
      if (text.includes("information_schema.TABLES") && params.includes("v_effective_agent_skill_grants")) {
        return [baselineObjects];
      }
      if (text.includes("information_schema.COLUMNS") && text.includes("TABLE_NAME = 'agent_skills'")) {
        return [agentSkillColumns];
      }
      if (text.includes("information_schema.COLUMNS") && text.includes("TABLE_NAME = 'v_effective_agent_skill_grants'")) {
        return [baselineColumns];
      }
      throw new Error(`Unexpected preflight query: ${text}`);
    },
  };
}

const compatiblePool = buildPool();
const compatible = await assessBrandSkillMigrationPreflight({
  pool: compatiblePool,
  requireRuntimeBaseline: true,
});
assert.equal(compatible.ready, true);
assert.equal(compatible.status, "pass");
assert.equal(compatible.runtime_baseline_required, true);
assert.equal(compatible.runtime_baseline_checked, true);
assert(compatible.queries_executed.includes("baseline_agent_skill_objects"));
assert(compatible.queries_executed.includes("baseline_agent_skill_view_contract"));
assert.equal(compatible.applies_sql, false);
assert.equal(compatible.provider_calls, false);
assert.equal(compatible.external_writes, false);
assert.equal(compatible.secrets_included, false);
assert(compatiblePool.queries.every(({ sql }) => /^SELECT\b/i.test(sql)));

const genericAlias = await assessBrandSkillMigrationPreflight({
  pool: buildPool({ availableCollation: GENERIC_REQUIRED_COLLATION }),
  requireRuntimeBaseline: true,
});
assert.equal(genericAlias.ready, true);
assert.equal(
  genericAlias.checks.find((item) => item.key === "required_collation")?.evidence?.observed_collation,
  GENERIC_REQUIRED_COLLATION,
);

const unavailableCollation = await assessBrandSkillMigrationPreflight({
  pool: buildPool({ availableCollation: "" }),
  requireRuntimeBaseline: true,
});
assert.equal(unavailableCollation.ready, false);
assert(unavailableCollation.failed_check_keys.includes("required_collation"));

const missingView = await assessBrandSkillMigrationPreflight({
  pool: buildPool({
    baselineObjects: [{ TABLE_NAME: "agent_skill_grants", TABLE_TYPE: "BASE TABLE" }],
  }),
  requireRuntimeBaseline: true,
});
assert.equal(missingView.ready, false);
assert(missingView.failed_check_keys.includes("baseline_agent_skill_objects"));

const missingColumn = await assessBrandSkillMigrationPreflight({
  pool: buildPool({
    baselineColumns: DEFAULT_BASELINE_COLUMNS.filter((row) => row.COLUMN_NAME !== "brand_key"),
  }),
  requireRuntimeBaseline: true,
});
assert.equal(missingColumn.ready, false);
assert(missingColumn.failed_check_keys.includes("baseline_agent_skill_view_contract"));

const incompatibleCollation = await assessBrandSkillMigrationPreflight({
  pool: buildPool({
    baselineColumns: DEFAULT_BASELINE_COLUMNS.map((row) => row.COLUMN_NAME === "skill_id"
      ? { ...row, COLLATION_NAME: "utf8mb4_unicode_ci" }
      : row),
  }),
  requireRuntimeBaseline: true,
});
assert.equal(incompatibleCollation.ready, false);
assert(incompatibleCollation.failed_check_keys.includes("baseline_agent_skill_view_contract"));

const compatibilityMode = await assessBrandSkillMigrationPreflight({ pool: buildPool() });
assert.equal(compatibilityMode.ready, true);
assert.equal(compatibilityMode.runtime_baseline_required, false);
assert.equal(compatibilityMode.runtime_baseline_checked, false);
assert.equal(
  compatibilityMode.checks.find((item) => item.key === "baseline_agent_skill_contract")?.status,
  "skip",
);
assert(!compatibilityMode.queries_executed.includes("baseline_agent_skill_objects"));

const cli = readFileSync(new URL("./scripts/brand-skill-migration-preflight.mjs", import.meta.url), "utf8");
assert(cli.includes("let pool = null"));
assert(cli.includes("requireRuntimeBaseline: true"));
assert(cli.includes('message: "Brand skill migration preflight failed."'));
assert.doesNotMatch(cli, /message:\s*error\?\.message/);
assert.match(cli, /try\s*\{[\s\S]*pool = getPool\(\)/);

console.log("PASS brand skill migration baseline preflight");
