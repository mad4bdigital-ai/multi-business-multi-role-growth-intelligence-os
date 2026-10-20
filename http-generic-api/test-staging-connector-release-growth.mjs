#!/usr/bin/env node
// Prove adding a valid FILES entry expands release without any .dockerignore edit.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRelease } from "./scripts/build-staging-connector-release.mjs";
import { createReleaseManifest, assertReleaseManifest } from "./scripts/staging-connector-release-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mad4b-connector-release-growth-"));
const fixture = path.join(temp, "fixture");
const output = path.join(temp, ".staging-connector-release");
const newPath = "local-connector/future-mcp-module.mjs";
try {
  const baseline = createReleaseManifest(root);
  for (const item of baseline.files) {
    const dest = path.join(fixture, item.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(root, item.path), dest);
  }
  const routesPath = "http-generic-api/routes/connectorAgentRoutes.js";
  const routes = fs.readFileSync(path.join(root, routesPath), "utf8");
  const after = routes.replace(/(const FILES = \{)([\s\S]*?)(\n\};)/u, (whole, start, body, end) =>
    start + body + '\n  "future-mcp-module.mjs": {\n    relativePath: "local-connector/future-mcp-module.mjs",\n    contentType: "text/javascript; charset=utf-8",\n    executable: false,\n  },' + end);
  assert.notEqual(after, routes, "future_release_fixture_registry_injection_failed");
  fs.mkdirSync(path.dirname(path.join(fixture, routesPath)), { recursive: true });
  fs.writeFileSync(path.join(fixture, routesPath), after);
  const content = "export const futureMcpModule = true;\n";
  fs.writeFileSync(path.join(fixture, newPath), content);
  const packageManifest = buildRelease(fixture, output);
  assert.equal(packageManifest.files.length, baseline.files.length + 1);
  assert(packageManifest.files.some((file) => file.path === newPath));
  assert.equal(fs.readFileSync(path.join(output, newPath), "utf8"), content);
  const readback = JSON.parse(fs.readFileSync(path.join(output, "manifest.json"), "utf8"));
  assertReleaseManifest(fixture, readback);
  assert(!fs.readFileSync(path.join(root, ".dockerignore"), "utf8").includes(newPath),
    "future_release_dockerignore_must_not_be_edited");
  fs.writeFileSync(path.join(fixture, newPath), "export const futureMcpModule = false;\n");
  assert.throws(() => assertReleaseManifest(fixture, readback),
    /connector_release_manifest_content_mismatch/u, "file tamper must invalidate release digest");
  console.log(JSON.stringify({ ok: true, contract: "mad4b.staging-connector-release-growth.v1",
    baseline_files: baseline.files.length, generated_files: packageManifest.files.length,
    new_manifest_entry_auto_included: true, tampering_rejected: true, secrets_included: false }));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
