import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const migration = readFileSync(
  join(__dirname, "migrations/113_sprint62x_session_summary_graph_collation_guard.sql"),
  "utf8"
);

assert(
  migration.includes("v_session_summary_graph_attachments"),
  "session summary graph attachment view must exist"
);

assert(
  /ja\.source_asset_ref\s*=\s*ss\.summary_id\s+COLLATE\s+utf8mb4_unicode_ci/i.test(migration),
  "cross-family summary_id join must use explicit utf8mb4_unicode_ci collation"
);

assert(
  !/ALTER\s+TABLE\s+`?session_summaries`?/i.test(migration),
  "collation guard must not broad-alter session_summaries in the view migration"
);

console.log("db collation guard tests passed");
