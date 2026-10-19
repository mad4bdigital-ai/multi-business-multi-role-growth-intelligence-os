#!/usr/bin/env node
// Build-time and source-time verification; no credentials or DB access.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const imageMode = process.argv.includes("--image");
const repoRoot = imageMode
  ? "/app/repo-inspect"
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const routes = fs.readFileSync(path.join(repoRoot, "http-generic-api/routes/connectorAgentRoutes.js"), "utf8");
const registry = routes.match(/const FILES = \{([\s\S]*?)\n\};/);
assert(registry, "connector_asset_registry_missing");
assert(routes.includes("const ROOT = PACKAGED_REPO_ROOT"), "connector_asset_snapshot_binding_missing");
const assets = [...registry[1].matchAll(/relativePath: "([^"]+)"/g)].map((m) => m[1]);
const local = assets.filter((p) => p.startsWith("local-connector/"));
assert(assets.length >= 15 && local.length >= 14, "connector_asset_manifest_incomplete");
assert.equal(new Set(assets).size, assets.length, "connector_asset_duplicate_path");
assert(assets.includes("http-generic-api/openapi/openapi.gpt-action.local-connector.yaml"), "connector_asset_openapi_missing");
for (const file of assets) {
  assert(/^(?:local-connector\/[a-z0-9-]+\.(?:mjs|ps1)|http-generic-api\/openapi\/openapi\.gpt-action\.local-connector\.yaml)$/u.test(file), "connector_asset_path_not_allowlisted");
  const absolute = path.join(repoRoot, file);
  assert(fs.statSync(absolute).isFile() && fs.statSync(absolute).size > 0, `connector_asset_missing_or_empty:${file}`);
}
// .dockerignore governs the sent build context but is not itself copied into the image.
if (!imageMode) {
  const ignoreRules = new Set(fs.readFileSync(path.join(repoRoot, ".dockerignore"), "utf8").split(/\r?\n/));
  assert(ignoreRules.has("!local-connector/"), "connector_asset_parent_excluded");
  assert(!ignoreRules.has("!local-connector/**"), "connector_asset_directory_wildcard_forbidden");
  const allowlisted = [...ignoreRules].filter((r) => r.startsWith("!local-connector/") && r !== "!local-connector/");
  assert.deepEqual(allowlisted.sort(), local.map((f) => `!${f}`).sort(), "connector_asset_allowlist_mismatch");
}
if (imageMode) {
  const entries = fs.readdirSync(path.join(repoRoot, "local-connector"), { withFileTypes: true });
  assert(entries.every((e) => e.isFile()), "connector_asset_image_unexpected_directory");
  assert.deepEqual(entries.map((e) => e.name).sort(), local.map((f) => path.basename(f)).sort(), "connector_asset_image_file_set_mismatch");
}
console.log(JSON.stringify({
  ok: true, contract: "mad4b.staging-connector-asset-bundle.v1",
  mode: imageMode ? "image" : "source", asset_count: assets.length,
  connector_file_count: local.length, secrets_included: false
}));
