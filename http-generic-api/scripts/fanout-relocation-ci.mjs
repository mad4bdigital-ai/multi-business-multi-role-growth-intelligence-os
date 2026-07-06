#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(apiRoot, "..");
const scriptsRoot = path.resolve(apiRoot, "scripts");
const taxonomyPath = path.resolve(scriptsRoot, "taxonomy", "script-taxonomy.json");
const taxonomy = JSON.parse(readFileSync(taxonomyPath, "utf8"));

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  return [key, rest.length ? rest.join("=") : "true"];
}));

const mode = args.get("mode") || process.env.FANOUT_RELOCATION_MODE || "report";
const scope = args.get("scope") || process.env.FANOUT_RELOCATION_SCOPE || "scripts";
const maxFiles = Number(args.get("max-files") || process.env.FANOUT_RELOCATION_MAX_FILES || taxonomy.safety.maxFilesDefault || 20);
const json = args.has("json") || process.env.FANOUT_RELOCATION_JSON === "true";
const branchName = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || "local";
const protectedBranches = new Set(taxonomy.safety.forbidProtectedBranches || ["main", "master"]);
const textExt = new Set([".js", ".mjs", ".cjs", ".json", ".md", ".yml", ".yaml", ".sh", ".sql", ".txt"]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function classifyScript(name) {
  for (const category of taxonomy.categories) {
    if (category.key === "uncategorized") continue;
    if ((category.patterns || []).some((pattern) => new RegExp(pattern, "i").test(name))) return category;
  }
  return taxonomy.categories.find((category) => category.key === "uncategorized");
}

function hasRelativeSiblingScriptImport(content) {
  return /from\s+["']\.\//.test(content)
    || /import\(["']\.\//.test(content)
    || /new URL\(["']\.\//.test(content)
    || /readFileSync\(["']\.\//.test(content);
}

function listScriptCandidates() {
  return readdirSync(scriptsRoot).flatMap((name) => {
    const fullPath = path.join(scriptsRoot, name);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) return [];
    if (!name.endsWith(".mjs")) return [{ name, status: "manual_review", reason: "non_mjs_or_directory" }];
    const category = classifyScript(name);
    const destination = path.join("http-generic-api", "scripts", category.folder, name).replaceAll(path.sep, "/");
    const source = path.join("http-generic-api", "scripts", name).replaceAll(path.sep, "/");
    const content = readFileSync(fullPath, "utf8");
    const reasons = [];
    if (["test-manifest.mjs", "fanout-relocation-ci.mjs"].includes(name)) reasons.push("self_relocator_or_manifest");
    if (category.key === "uncategorized") reasons.push("unknown_taxonomy");
    if (hasRelativeSiblingScriptImport(content)) reasons.push("relative_sibling_script_import");
    return [{ name, source, destination, category: category.key, status: reasons.length ? "manual_review" : "safe_to_move", reasons }];
  });
}

function rewriteMovedScript(content) {
  return content
    .replaceAll('"../', '"../../')
    .replaceAll("'../", "'../../")
    .replaceAll('`../', '`../../');
}

function shouldScanFile(fullPath) {
  const rel = path.relative(repoRoot, fullPath);
  if (rel.startsWith(".git") || rel.includes("node_modules") || rel.includes(".next") || rel.includes("dist/")) return false;
  if (statSync(fullPath).isDirectory()) return false;
  return textExt.has(path.extname(fullPath));
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (![".git", "node_modules", ".next", "dist"].includes(name)) walk(full, out);
    } else if (shouldScanFile(full)) out.push(full);
  }
  return out;
}

function updateReferences(moves) {
  const files = walk(repoRoot);
  const replacements = moves.map((move) => ({
    from: new RegExp(escapeRegExp(move.source), "g"),
    to: move.destination,
    fromScriptPath: new RegExp(escapeRegExp(`scripts/${move.name}`), "g"),
    toScriptPath: `scripts/${move.category}/${move.name}`,
  }));
  const touched = [];
  for (const file of files) {
    let content = readFileSync(file, "utf8");
    const original = content;
    for (const replacement of replacements) {
      content = content.replace(replacement.from, replacement.to);
      content = content.replace(replacement.fromScriptPath, replacement.toScriptPath);
    }
    if (content !== original) {
      writeFileSync(file, content);
      touched.push(path.relative(repoRoot, file).replaceAll(path.sep, "/"));
    }
  }
  return touched;
}

function applyMoves(moves) {
  const applied = [];
  for (const move of moves) {
    const from = path.resolve(repoRoot, move.source);
    const to = path.resolve(repoRoot, move.destination);
    if (!existsSync(from)) continue;
    mkdirSync(path.dirname(to), { recursive: true });
    writeFileSync(to, rewriteMovedScript(readFileSync(from, "utf8")));
    unlinkSync(from);
    applied.push(move);
  }
  const touchedReferenceFiles = updateReferences(applied);
  return { applied, touchedReferenceFiles };
}

const candidates = scope === "scripts" || scope === "all" ? listScriptCandidates() : [];
const safeMoves = candidates.filter((candidate) => candidate.status === "safe_to_move").slice(0, maxFiles);
const report = {
  ok: true,
  mode,
  scope,
  branch: branchName,
  protected_branch: protectedBranches.has(branchName),
  candidate_count: candidates.length,
  safe_to_move_count: candidates.filter((candidate) => candidate.status === "safe_to_move").length,
  manual_review_count: candidates.filter((candidate) => candidate.status === "manual_review").length,
  max_files: maxFiles,
  planned_moves: safeMoves,
  taxonomy_version: taxonomy.version,
  secrets_included: false,
};

if (mode === "apply") {
  if (protectedBranches.has(branchName)) {
    console.error(`Refusing to apply fanout relocation on protected branch ${branchName}`);
    process.exit(2);
  }
  const result = applyMoves(safeMoves);
  report.applied_count = result.applied.length;
  report.applied_moves = result.applied;
  report.touched_reference_files = result.touchedReferenceFiles;
}

if (json) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`fanout relocation mode=${mode} scope=${scope} branch=${branchName}`);
  console.log(`candidates=${report.candidate_count} safe=${report.safe_to_move_count} manual_review=${report.manual_review_count}`);
  for (const move of safeMoves) console.log(`${mode === "apply" ? "MOVE" : "PLAN"} ${move.source} -> ${move.destination}`);
  if (mode === "apply") console.log(`applied=${report.applied_count || 0}`);
}
