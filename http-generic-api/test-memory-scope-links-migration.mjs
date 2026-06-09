import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/252_sprint68_memory_scope_links_foundation.sql", import.meta.url), "utf8");

assert.match(migration, /CREATE TABLE IF NOT EXISTS `memory_scope_links`/);
assert.match(migration, /CREATE OR REPLACE VIEW `v_memory_scope_link_registry_issues`/);
assert.match(migration, /resource_scope_hash` CHAR\(64\) NULL/);
assert.match(migration, /writer-provided SHA-256/);
assert.doesNotMatch(migration, /GENERATED ALWAYS AS/);
assert.doesNotMatch(migration, /SHA2\(CONCAT_WS/);
assert.match(migration, /secrets_included` TINYINT\(1\) NOT NULL DEFAULT 0/);

console.log("Memory scope links migration compatibility guard passed");
