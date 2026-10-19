#!/usr/bin/env node
// Real Docker BuildKit build-context smoke check for exact Connector release assets.
// Run against a clean Git checkout in CI; no credentials or deployed runtime access.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "http-generic-api/routes/connectorAgentRoutes.js"), "utf8");
const registry = source.match(/const FILES = \{([\s\S]*?)\n\};/);
assert(registry, "connector_docker_smoke_registry_missing");
const files = [...registry[1].matchAll(/relativePath: "local-connector\/([^"]+)"/g)]
  .map((match) => match[1]);
assert(files.length >= 14, "connector_docker_smoke_registry_empty");
assert.equal(files.length, new Set(files).size, "connector_docker_smoke_duplicate_filename");
assert(files.every((file) => /^[a-z0-9-]+\.(?:mjs|ps1)$/u.test(file)), "connector_docker_smoke_unsafe_asset_filename");
for (const file of files) assert(fs.statSync(path.join(root, "local-connector", file)).isFile());

const listed = files.map((file) => `'${file}'`).join(" ");
const dockerfile = [
  "# syntax=docker/dockerfile:1.7",
  "FROM busybox:1.36",
  "COPY local-connector/ /release/",
  `RUN set -eu; for name in ${listed}; do test -f "/release/$name"; test ! -L "/release/$name"; done; test "$(find /release -mindepth 1 | wc -l)" -eq ${files.length}`,
  "",
].join("\n");
const execution = spawnSync("docker", ["build", "--no-cache", "--progress", "plain", "--file", "-", "."], {
  cwd: root,
  encoding: "utf8",
  input: dockerfile,
  timeout: 180_000,
  maxBuffer: 16 * 1024 * 1024,
});
if (execution.error || execution.status !== 0) {
  process.stderr.write(String(execution.stderr || "").slice(-12000));
  process.stderr.write(String(execution.stdout || "").slice(-12000));
  throw new Error(`connector_docker_smoke_failed: ${String(execution.error?.message || execution.status)}`);
}
console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.staging-connector-docker-build-context.v1",
  verified_with: "docker_buildkit",
  expected_release_files: files.length,
  unlisted_content_allowed: false,
  secrets_included: false,
}));
