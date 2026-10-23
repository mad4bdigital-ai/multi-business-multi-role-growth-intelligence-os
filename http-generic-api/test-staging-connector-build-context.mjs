#!/usr/bin/env node
// Actual BuildKit packaging test. Source registry is the sole file-list authority.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertReleaseManifest, RELEASE_DIRECTORY } from "./scripts/staging-connector-release-contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mad4b-connector-buildkit-"));
const releaseDir = path.join(temp, RELEASE_DIRECTORY);

function execute(file, args, options = {}) {
  const result = spawnSync(file, args, {
    cwd: repoRoot, encoding: "utf8", timeout: 180_000,
    maxBuffer: 16 * 1024 * 1024, ...options,
  });
  if (result.error || result.status !== 0) {
    process.stderr.write(String(result.stderr || "").slice(-12000));
    process.stderr.write(String(result.stdout || "").slice(-12000));
    throw new Error(`connector_release_buildkit_command_failed:${file}:${String(result.error?.message || result.status)}`);
  }
  return result;
}

try {
  fs.copyFileSync(path.join(repoRoot, ".dockerignore"), path.join(temp, ".dockerignore"));
  execute(process.execPath, [
    path.join(repoRoot, "http-generic-api/scripts/build-staging-connector-release.mjs"),
    "--source-root", repoRoot, "--output-dir", releaseDir,
  ]);
  const manifest = JSON.parse(fs.readFileSync(path.join(releaseDir, "manifest.json"), "utf8"));
  const localFiles = assertReleaseManifest(repoRoot, manifest);
  // Adversarial fixtures: this raw Connector tree is not the generated release.
  const forbidden = path.join(temp, "local-connector", "future-nested");
  fs.mkdirSync(forbidden, { recursive: true });
  fs.writeFileSync(path.join(forbidden, "unlisted.txt"), "MUST_NOT_BE_PACKAGED\n");
  fs.writeFileSync(path.join(temp, "local-connector", "unlisted.mjs"), "MUST_NOT_BE_PACKAGED\n");

  const shellNames = localFiles.map((f) => `'${path.basename(f.path)}'`).join(" ");
  const dockerfile = [
    "# syntax=docker/dockerfile:1.7",
    "FROM busybox:1.36",
    `COPY ${RELEASE_DIRECTORY}/local-connector/ /release/`,
    `COPY ${RELEASE_DIRECTORY}/manifest.json /release-manifest.json`,
    `RUN set -eu; for name in ${shellNames}; do test -f "/release/$name"; test ! -L "/release/$name"; done; test "$(find /release -mindepth 1 | wc -l)" -eq ${localFiles.length}`,
    "",
  ].join("\n");
  execute("docker", ["build", "--no-cache", "--progress", "plain", "--file", "-", temp], {
    input: dockerfile, cwd: repoRoot,
  });
  console.log(JSON.stringify({
    ok: true,
    contract: "mad4b.staging-connector-docker-build-context.v2",
    verified_with: "docker_buildkit",
    manifest_source: "connectorAgentRoutes.FILES",
    connector_file_count: localFiles.length,
    unlisted_sources_included: false,
    secrets_included: false,
  }));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
