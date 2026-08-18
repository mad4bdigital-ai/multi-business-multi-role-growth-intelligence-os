#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = path.join(repoRoot, ".github/derived-state-governance.json");
const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
const artifact = (registry.artifacts || []).find((entry) => entry.artifact_id === "remote_mcp_write_scope_inventory");
if (!artifact) throw new Error("remote_mcp_write_scope_inventory is not registered");
if (artifact.currentness_projection?.mode !== "semantic_projection") throw new Error("Remote MCP currentness must declare semantic_projection mode");

const jsonOutput = artifact.outputs?.find((entry) => entry.endsWith(".json"));
const markdownOutput = artifact.outputs?.find((entry) => entry.endsWith(".md"));
if (!jsonOutput || !markdownOutput) throw new Error("Remote MCP semantic projection requires JSON and Markdown outputs");

const scratchRoot = path.join(repoRoot, ".git", "remote-mcp-semantic-currentness");
const scratchJson = path.relative(repoRoot, path.join(scratchRoot, "inventory.json")).replaceAll("\\", "/");
const scratchMarkdown = path.relative(repoRoot, path.join(scratchRoot, "inventory.md")).replaceAll("\\", "/");
fs.rmSync(scratchRoot, { recursive: true, force: true });
fs.mkdirSync(scratchRoot, { recursive: true });

const generated = spawnSync(process.execPath, ["scripts/remote-mcp-write-scope-inventory.mjs"], {
  cwd: repoRoot,
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
  env: {
    ...process.env,
    REMOTE_MCP_WRITE_SCOPE_INVENTORY_JSON: scratchJson,
    REMOTE_MCP_WRITE_SCOPE_INVENTORY_MARKDOWN: scratchMarkdown,
  },
});
if (generated.error || generated.status !== 0) {
  fs.rmSync(scratchRoot, { recursive: true, force: true });
  throw new Error(`Remote MCP inventory projection generation failed: ${String(generated.stderr || generated.error?.message || "unknown").slice(-3000)}`);
}

function normalizedJson(file) {
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const field of artifact.currentness_projection.ignored_json_fields || []) delete value[field];
  return JSON.stringify(value);
}

function normalizedMarkdown(file) {
  const patterns = (artifact.currentness_projection.ignored_markdown_line_patterns || []).map((source) => new RegExp(source, "u"));
  return fs.readFileSync(file, "utf8")
    .split(/\r?\n/u)
    .filter((line) => !patterns.some((pattern) => pattern.test(line)))
    .join("\n")
    .trimEnd();
}

const committedJson = path.join(repoRoot, jsonOutput);
const committedMarkdown = path.join(repoRoot, markdownOutput);
const expectedJson = path.join(repoRoot, scratchJson);
const expectedMarkdown = path.join(repoRoot, scratchMarkdown);
const jsonCurrent = normalizedJson(committedJson) === normalizedJson(expectedJson);
const markdownCurrent = normalizedMarkdown(committedMarkdown) === normalizedMarkdown(expectedMarkdown);
fs.rmSync(scratchRoot, { recursive: true, force: true });

if (!jsonCurrent || !markdownCurrent) {
  console.error(JSON.stringify({
    ok: false,
    artifact_id: artifact.artifact_id,
    mode: artifact.currentness_projection.mode,
    json_current: jsonCurrent,
    markdown_current: markdownCurrent,
    ignored_json_fields: artifact.currentness_projection.ignored_json_fields || [],
    ignored_markdown_line_patterns: artifact.currentness_projection.ignored_markdown_line_patterns || [],
    secrets_included: false,
  }));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  artifact_id: artifact.artifact_id,
  mode: artifact.currentness_projection.mode,
  json_current: true,
  markdown_current: true,
  ignored_observability_fields: artifact.currentness_projection.ignored_json_fields || [],
  repository_mutation_performed: false,
  secrets_included: false,
}));
