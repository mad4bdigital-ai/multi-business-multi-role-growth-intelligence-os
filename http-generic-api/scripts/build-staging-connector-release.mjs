#!/usr/bin/env node
// Materialize a deterministic Connector Agent release from exact Git-archive sources.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createReleaseManifest, RELEASE_DIRECTORY } from "./staging-connector-release-contract.mjs";

function option(name) {
  const at = process.argv.indexOf(name);
  assert(at >= 0 && process.argv[at + 1] && !process.argv[at + 1].startsWith("--"), `missing_${name}`);
  return path.resolve(process.argv[at + 1]);
}

export function buildRelease(sourceRoot, destination) {
  assert(path.basename(destination) === RELEASE_DIRECTORY, "connector_release_output_name_invalid");
  assert(!destination.startsWith(sourceRoot + path.sep + "local-connector" + path.sep), "connector_release_output_overlaps_sources");
  const manifest = createReleaseManifest(sourceRoot);
  // Fail before touching output if any declared file is invalid or unavailable.
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(path.join(destination, "local-connector"), { recursive: true });
  for (const item of manifest.files.filter((f) => f.path.startsWith("local-connector/"))) {
    const out = path.join(destination, item.path);
    fs.copyFileSync(path.join(sourceRoot, item.path), out, fs.constants.COPYFILE_EXCL);
  }
  fs.writeFileSync(path.join(destination, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  const entries = fs.readdirSync(path.join(destination, "local-connector"), { withFileTypes: true });
  assert(entries.every((entry) => entry.isFile()), "connector_release_unexpected_output_directory");
  assert.equal(entries.length, manifest.files.filter((f) => f.path.startsWith("local-connector/")).length, "connector_release_incomplete_output");
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sourceRoot = option("--source-root");
  const destination = option("--output-dir");
  const manifest = buildRelease(sourceRoot, destination);
  console.log(JSON.stringify({ ok: true, contract: manifest.contract,
    files: manifest.files.length, connector_files: manifest.files.filter((f) => f.path.startsWith("local-connector/")).length,
    output_dir: destination, secrets_included: false }));
}
