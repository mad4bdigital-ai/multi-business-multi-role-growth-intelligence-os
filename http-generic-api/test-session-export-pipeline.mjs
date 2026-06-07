import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./sessionExportPipeline.js", import.meta.url), "utf8");

assert.match(source, /FROM\s+(?:`|\\`)gpt_session_turns(?:`|\\`)/, "session export must read GPT turn index from gpt_session_turns");
assert.ok(source.includes("content_preview"), "session export should include bounded turn previews");
assert.ok(source.includes("content_sha256"), "session export should include turn content hashes");
assert.ok(source.includes("drive_doc_id"), "session export should include transcript doc references");
assert.ok(source.includes("drive_anchor"), "session export should include transcript anchors");
assert.ok(source.includes("drive_jsonl_id || session.raw_drive_id"), "session export must prefer archive JSONL before legacy raw dump");
assert.ok(source.includes("raw_records_source"), "session export should disclose which Drive sidecar supplied raw records");
assert.ok(source.includes('"drive_jsonl_id"'), "session export should identify drive_jsonl_id raw-record source");
assert.ok(source.includes('"raw_drive_id"'), "session export should retain legacy raw_drive_id fallback");
assert.ok(source.includes("SQL stores previews/hashes only"), "session export should document preview-only SQL semantics");
assert.ok(!source.includes("SELECT * FROM `session_turns`"), "session export must not read empty legacy session_turns table for GPT archives");

console.log("session export pipeline tests passed");
