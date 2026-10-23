#!/usr/bin/env node
// Source and final-image verifier for exact-manifest Connector Agent releases.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readDeclaredAssets, assertReleaseManifest, digest, RELEASE_DIRECTORY } from "./staging-connector-release-contract.mjs";

const imageMode = process.argv.includes("--image");
const repoRoot = imageMode
  ? "/app/repo-inspect"
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { paths } = readDeclaredAssets(repoRoot);
const local = paths.filter((item) => item.startsWith("local-connector/"));

if (!imageMode) {
  const lines = fs.readFileSync(path.join(repoRoot, ".dockerignore"), "utf8")
    .split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith("#"));
  assert(lines.includes("**"), "connector_release_context_must_be_deny_by_default");
  assert(lines.includes(`!${RELEASE_DIRECTORY}/`), "connector_release_parent_exception_missing");
  assert(lines.includes(`!${RELEASE_DIRECTORY}/**`), "connector_release_bundle_exception_missing");
  assert(!lines.some((s) => s.startsWith("!local-connector")), "connector_release_raw_sources_must_be_excluded");
  assert(!lines.includes("!**"), "connector_release_wildcard_source_exception_forbidden");
  console.log(JSON.stringify({ ok: true, contract: "mad4b.staging-connector-asset-bundle.v2",
    mode: "source", manifest_authority: "connectorAgentRoutes.FILES",
    asset_count: paths.length, connector_file_count: local.length, secrets_included: false }));
} else {
  const manifestFile = "/app/connector-release-manifest.json";
  const actualText = fs.readFileSync(manifestFile, "utf8");
  const manifest = JSON.parse(actualText);
  const localFiles = assertReleaseManifest(repoRoot, manifest);
  const provenance = JSON.parse(fs.readFileSync("/staging-build-context.json", "utf8"));
  assert(provenance?.source === "git_archive_exact_commit" &&
    provenance?.secrets_included === false, "connector_release_untrusted_image_provenance");
  assert(provenance.connector_release_manifest_sha256 === digest(actualText),
    "connector_release_provenance_digest_mismatch");
  const entries = fs.readdirSync(path.join(repoRoot, "local-connector"), { withFileTypes: true });
  assert(entries.every((entry) => entry.isFile()), "connector_asset_image_unexpected_directory");
  assert.deepEqual(entries.map((entry) => entry.name).sort(),
    localFiles.map((file) => path.basename(file.path)).sort(), "connector_asset_image_file_set_mismatch");
  console.log(JSON.stringify({ ok: true, contract: "mad4b.staging-connector-asset-bundle.v2",
    mode: "image", manifest_authority: "connectorAgentRoutes.FILES",
    asset_count: paths.length, connector_file_count: local.length,
    manifest_sha256: digest(actualText), secrets_included: false }));
}
