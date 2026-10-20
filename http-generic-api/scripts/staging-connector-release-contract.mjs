// Single reader for the Connector Agent's API FILES registry.
// No runtime imports, credentials or mutation; used by staging packaging and QA.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const CONTRACT = "mad4b.staging-connector-release.v1";
export const RELEASE_DIRECTORY = ".staging-connector-release";

export function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function readDeclaredAssets(root) {
  const source = fs.readFileSync(path.join(root, "http-generic-api/routes/connectorAgentRoutes.js"), "utf8");
  const match = source.match(/const FILES = \{([\s\S]*?)\n\};/u);
  assert(match, "connector_release_registry_missing");
  assert(source.includes("const ROOT = PACKAGED_REPO_ROOT"), "connector_release_snapshot_binding_missing");
  const body = match[1];
  const keys = [...body.matchAll(/^  "([^"]+)": \{/gmu)].map((m) => m[1]);
  const paths = [...body.matchAll(/relativePath: "([^"]+)"/gu)].map((m) => m[1]);
  assert(keys.length >= 15 && keys.length === paths.length, "connector_release_registry_entry_mismatch");
  assert.equal(new Set(keys).size, keys.length, "connector_release_duplicate_key");
  assert.equal(new Set(paths).size, paths.length, "connector_release_duplicate_source");
  for (const item of paths) {
    assert(/^(?:local-connector\/[a-z0-9-]+\.(?:mjs|ps1)|http-generic-api\/openapi\/openapi\.gpt-action\.local-connector\.yaml)$/u.test(item), "connector_release_invalid_source_path");
    const abs = path.join(root, item);
    const stat = fs.lstatSync(abs);
    assert(stat.isFile() && stat.size > 0 && !stat.isSymbolicLink(), `connector_release_invalid_file:${item}`);
  }
  assert(paths.some((item) => item.startsWith("local-connector/")), "connector_release_no_local_files");
  assert(paths.some((item) => item.startsWith("http-generic-api/openapi/")), "connector_release_no_openapi");
  return { paths: paths.sort(), registrySha256: digest(source) };
}

export function createReleaseManifest(root) {
  const { paths, registrySha256 } = readDeclaredAssets(root);
  return {
    contract: CONTRACT,
    registry_source: "http-generic-api/routes/connectorAgentRoutes.js",
    registry_sha256: registrySha256,
    files: paths.map((item) => {
      const data = fs.readFileSync(path.join(root, item));
      return { path: item, size: data.length, sha256: digest(data) };
    }),
    secrets_included: false,
  };
}

export function assertReleaseManifest(root, manifest) {
  assert(manifest?.contract === CONTRACT && manifest?.secrets_included === false, "connector_release_manifest_contract_mismatch");
  const expected = createReleaseManifest(root);
  assert.deepEqual(manifest, expected, "connector_release_manifest_content_mismatch");
  return expected.files.filter((item) => item.path.startsWith("local-connector/"));
}
