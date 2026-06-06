#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  changedFilesForRange,
  classifyChangedFiles,
  renderImpactMarkdown,
  resolveDiffRange,
  runGit,
} from "./docs-impact-classifier.mjs";

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    write: false,
    base: "",
    head: "",
    mode: process.env.GITHUB_EVENT_NAME || "manual",
    outDir: "docs/auto-docs-agent",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--write") args.write = true;
    else if (item === "--base") args.base = argv[++i] || "";
    else if (item.startsWith("--base=")) args.base = item.slice("--base=".length);
    else if (item === "--head") args.head = argv[++i] || "";
    else if (item.startsWith("--head=")) args.head = item.slice("--head=".length);
    else if (item === "--mode") args.mode = argv[++i] || args.mode;
    else if (item.startsWith("--mode=")) args.mode = item.slice("--mode=".length);
    else if (item === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (item.startsWith("--out-dir=")) args.outDir = item.slice("--out-dir=".length);
  }
  return args;
}

function readEvent() {
  const file = process.env.GITHUB_EVENT_PATH;
  if (!file || !fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function slug(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "manual";
}

function shortSha() {
  return (process.env.GITHUB_SHA || runGit(["rev-parse", "HEAD"], { allowFailure: true }) || "manual").slice(0, 12);
}

function entryName(mode = "manual") {
  const event = readEvent();
  if (event?.pull_request?.number) return `pr-${event.pull_request.number}.md`;
  if (event?.after) return `commit-${String(event.after).slice(0, 12)}.md`;
  if (process.env.GITHUB_REF_NAME) return `${slug(process.env.GITHUB_REF_NAME)}-${shortSha()}.md`;
  return `manual-${shortSha()}.md`;
}

function ensureReadme(outDir) {
  const file = path.join(outDir, "README.md");
  if (fs.existsSync(file)) return;
  const content = `# Automated Docs Agent Notes\n\nThis directory is maintained by the Docs Agent workflow. Each generated note records the documentation impact of a PR or commit so runtime, schema, deployment, and tenant-facing changes do not disappear into chat history or transient CI logs.\n\nGenerated notes are reviewable evidence. They do not replace targeted human documentation for high-risk changes, but they make the required docs targets explicit and keep the repository auto-mergeable when a follow-up documentation note is enough.\n\nRules:\n\n- No secrets or credential values.\n- No generated canonical root edits without canonical source edits.\n- High-risk notes must name required docs and validation evidence.\n- Docs-only agent PRs may be auto-merged only after CI passes.\n`;
  fs.writeFileSync(file, content);
}

function writeGithubOutput(values = {}) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  const lines = [];
  for (const [key, value] of Object.entries(values)) {
    lines.push(`${key}=${String(value).replace(/\n/g, "%0A")}`);
  }
  fs.appendFileSync(outputPath, `${lines.join("\n")}\n`);
}

export function runDocsAgent(options = {}) {
  const range = resolveDiffRange({ base: options.base, head: options.head });
  const changedFiles = changedFilesForRange(range);
  const impact = classifyChangedFiles(changedFiles);
  const result = {
    range,
    ...impact,
    wrote: false,
    output_path: "",
  };

  if (!impact.should_generate) {
    writeGithubOutput({
      should_write: "false",
      risk: impact.risk,
      auto_merge_candidate: impact.auto_merge_candidate ? "true" : "false",
      output_path: "",
    });
    return result;
  }

  if (!options.write) {
    writeGithubOutput({
      should_write: "true",
      risk: impact.risk,
      auto_merge_candidate: impact.auto_merge_candidate ? "true" : "false",
      output_path: "",
    });
    return result;
  }

  const outDir = options.outDir || "docs/auto-docs-agent";
  fs.mkdirSync(outDir, { recursive: true });
  ensureReadme(outDir);
  const filename = entryName(options.mode);
  const outputPath = path.join(outDir, filename);
  const title = filename.startsWith("pr-")
    ? `Docs Agent Impact Note for ${filename.replace(/\.md$/, "").toUpperCase()}`
    : `Docs Agent Impact Note for ${filename.replace(/\.md$/, "")}`;
  fs.writeFileSync(outputPath, renderImpactMarkdown({ range, ...impact }, { title }));
  result.wrote = true;
  result.output_path = outputPath;

  writeGithubOutput({
    should_write: "true",
    risk: impact.risk,
    auto_merge_candidate: impact.auto_merge_candidate ? "true" : "false",
    output_path: outputPath,
  });
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs();
  const result = runDocsAgent(args);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
