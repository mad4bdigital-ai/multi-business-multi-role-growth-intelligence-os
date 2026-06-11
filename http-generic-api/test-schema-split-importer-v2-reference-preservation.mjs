import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pipeline = readFileSync("schemaImportPipeline.js", "utf8");
const routes = readFileSync("routes/schemaImportRoutes.js", "utf8");
const migration = readFileSync("migrations/274_sprint68_schema_split_importer_v2_reference_preservation.sql", "utf8");

assert(pipeline.includes("preserveParentSchemaReference"), "pipeline must support preserveParentSchemaReference");
assert(pipeline.includes("action_schema:${actionKey}"), "parent action must point to SQL-backed action_schema:<action_key>");
assert(pipeline.includes("schema_json, openai_schema_file_id"), "pipeline must update action schema metadata explicitly");
assert(pipeline.includes("const actionSchemaJson = preserve ? null"), "preserve mode must keep actions.schema_json empty instead of storing full parent schema");
assert(pipeline.includes("schema_overlay_parent_action_key"), "endpoint split rows must keep parent action overlay metadata");
assert(pipeline.includes("child_openai_schema_file_id"), "endpoint split rows must keep parent schema source reference");
assert(pipeline.includes("source_sha256"), "schema import jobs must record source hash");
assert(pipeline.includes("source_bytes"), "schema import jobs must record source size");
assert(pipeline.includes("runActionReferenceImport"), "pipeline must expose action reference import entry point");
assert(pipeline.includes("ref:schema:"), "action reference import must support ref:schema:* assets");
assert(pipeline.includes("Drive/file references should be imported through upload/repo or mirrored into json_assets first"), "unresolved Drive references must fail transparently without hidden provider dependency");

assert(routes.includes('router.post("/admin/schema-import/action-ref"'), "routes must expose action-ref schema import endpoint");
assert(routes.includes("runActionReferenceImport"), "route must call action reference import pipeline");
assert(routes.includes("preserve_parent_schema_reference !== false"), "action-ref route must preserve parent schema references by default");

assert(migration.includes("source_type ENUM('upload','repo_link','rollback','action_ref')"), "migration must add action_ref source type");
assert(migration.includes("source_sha256"), "migration must add source_sha256");
assert(migration.includes("parent_schema_ref"), "migration must add parent_schema_ref");
assert(migration.includes("preserve_parent_schema_reference"), "migration must add preservation flag");
assert(migration.includes("schema_import_action_ref"), "migration must register governed admin tool");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "migration must not use destructive SQL");

console.log("schema split importer v2 reference preservation tests passed");
