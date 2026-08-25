import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildSchemaIntelligenceMaps, stripSqlComments } from "./platform-work-map-schema-intelligence.mjs";

test("schema intelligence ignores SQL comments and literal examples while retaining real quoted DDL", () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "work-map-schema-intelligence-"));
  try {
    fs.mkdirSync(path.join(repoRoot, ".specify"), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, "http-generic-api", "migrations"), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, ".specify", "work-map-schema-classification-registry.json"),
      JSON.stringify({ rules: [], intentional_unclassified: [] }),
    );
    fs.writeFileSync(path.join(repoRoot, "memory_schema.json"), JSON.stringify({ properties: {} }));
    const sql = [
      "-- CREATE VIEW with ER 1267 in explanatory prose",
      "/* CREATE TABLE ghost_table (`ghost_id` BIGINT NOT NULL); */",
      "CREATE TABLE `activation_runs` (",
      "  `id` BIGINT NOT NULL",
      ");",
      "INSERT INTO `activation_runs` (`id`) VALUES ('CREATE VIEW with');",
      "CREATE OR REPLACE VIEW `v_activation_readiness` AS",
      "SELECT 'CREATE VIEW with' AS `message` FROM `activation_runs`;",
      "# CREATE VIEW with another comment",
    ].join("\n");
    fs.writeFileSync(path.join(repoRoot, "http-generic-api", "migrations", "001_fixture.sql"), sql);

    const commentFree = stripSqlComments(sql);
    assert.doesNotMatch(commentFree, /CREATE VIEW with ER 1267/);
    assert.doesNotMatch(commentFree, /ghost_table/);
    assert.match(commentFree, /CREATE OR REPLACE VIEW `v_activation_readiness`/);

    const result = buildSchemaIntelligenceMaps({ repoRoot });
    assert.equal(result.metrics.tables_discovered, 1);
    assert.equal(result.metrics.views_discovered, 1);
    assert.equal(result.metrics.unresolved_unclassified_objects, 0);
    assert.match(result.maps["data-model-domain-map.md"], /`v_activation_readiness`/);
    assert.doesNotMatch(result.maps["data-model-domain-map.md"], /\| `with` \|/);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});
