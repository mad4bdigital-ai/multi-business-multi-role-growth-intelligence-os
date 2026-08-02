#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..", "..");
const REGULAR_GIT_MODES = new Set(["100644", "100755"]);

function normalize(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\.\//u, "");
}

function ensureLexicallyInside(root, relativePath) {
  const normalized = normalize(relativePath);
  if (!normalized || path.posix.isAbsolute(normalized) || normalized.split("/").includes("..")) return null;
  const rootPath = path.resolve(root);
  const resolved = path.resolve(rootPath, normalized);
  if (resolved !== rootPath && !resolved.startsWith(`${rootPath}${path.sep}`)) return null;
  return { normalized, rootPath, resolved };
}

function inspectPathChain(located) {
  if (!located) {
    return {
      lexically_inside: false,
      exists: false,
      realpath_inside: false,
      symbolic_link_components: [],
      regular_file: false,
    };
  }

  const symbolicLinkComponents = [];
  let current = located.rootPath;
  for (const segment of located.normalized.split("/")) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) symbolicLinkComponents.push(normalize(path.relative(located.rootPath, current)));
    } catch (error) {
      if (error?.code === "ENOENT") {
        return {
          lexically_inside: true,
          exists: false,
          realpath_inside: false,
          symbolic_link_components: symbolicLinkComponents,
          regular_file: false,
        };
      }
      throw error;
    }
  }

  const finalStats = fs.lstatSync(located.resolved);
  const rootReal = fs.realpathSync(located.rootPath);
  const targetReal = fs.realpathSync(located.resolved);
  const realpathInside = targetReal === rootReal || targetReal.startsWith(`${rootReal}${path.sep}`);
  return {
    lexically_inside: true,
    exists: true,
    realpath_inside: realpathInside,
    symbolic_link_components: symbolicLinkComponents,
    regular_file: finalStats.isFile() && !finalStats.isSymbolicLink(),
  };
}

function gitIndexEntry(root, relativePath) {
  const output = execFileSync("git", ["ls-files", "--stage", "--", relativePath], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (!output) return null;
  const lines = output.split(/\r?\n/u).filter(Boolean);
  if (lines.length !== 1) return { ambiguous: true, lines };
  const match = /^(\d{6})\s+([0-9a-f]{40,64})\s+(\d+)\t(.+)$/u.exec(lines[0]);
  if (!match) return { malformed: true, raw: lines[0] };
  return {
    mode: match[1],
    object_sha: match[2],
    stage: Number(match[3]),
    path: normalize(match[4]),
  };
}

function inspectRequiredPath(root, relativePath) {
  const located = ensureLexicallyInside(root, relativePath);
  const chain = inspectPathChain(located);
  const index = located ? gitIndexEntry(root, located.normalized) : null;
  return {
    path: normalize(relativePath),
    ...chain,
    tracked: Boolean(index && !index.ambiguous && !index.malformed),
    git_mode: index?.mode || null,
    git_stage: Number.isInteger(index?.stage) ? index.stage : null,
    git_object_sha: index?.object_sha || null,
    canonical_index_path: index?.path || null,
    regular_git_blob: Boolean(index && REGULAR_GIT_MODES.has(index.mode) && index.stage === 0 && index.path === normalize(relativePath)),
    ambiguous_index_entry: Boolean(index?.ambiguous),
    malformed_index_entry: Boolean(index?.malformed),
  };
}

export function enforceGitIndexIntegrity({ root = REPO_ROOT, report }) {
  if (!report || typeof report !== "object") throw new Error("A parsed contract reference integrity report is required.");
  const requiredPaths = new Set([
    ...(Array.isArray(report.targeted_contracts) ? report.targeted_contracts : []),
    ...(Array.isArray(report.checked_evidence) ? report.checked_evidence.map((item) => item?.path) : []),
  ].filter(Boolean).map(normalize));

  const pathIntegrity = [...requiredPaths].sort().map((relativePath) => inspectRequiredPath(root, relativePath));
  const findings = [];
  for (const item of pathIntegrity) {
    if (!item.lexically_inside) {
      findings.push({ code: "repository_path_escapes_root", path: item.path });
    } else if (!item.exists) {
      findings.push({ code: "repository_path_missing", path: item.path });
    } else {
      if (item.symbolic_link_components.length > 0) {
        findings.push({ code: "repository_path_contains_symbolic_link", path: item.path, components: item.symbolic_link_components });
      }
      if (!item.realpath_inside) findings.push({ code: "repository_path_realpath_escapes_root", path: item.path });
      if (!item.regular_file) findings.push({ code: "repository_path_not_regular_file", path: item.path });
    }

    if (!item.tracked) findings.push({ code: "repository_path_not_tracked", path: item.path });
    else if (!item.regular_git_blob) {
      findings.push({
        code: "repository_path_not_regular_stage_zero_blob",
        path: item.path,
        git_mode: item.git_mode,
        git_stage: item.git_stage,
        canonical_index_path: item.canonical_index_path,
      });
    }
  }

  return {
    ...report,
    ok: Boolean(report.ok) && findings.length === 0,
    path_integrity_contract: "mad4b.e2e-contract-git-index-integrity.v1",
    required_repository_paths: [...requiredPaths].sort(),
    path_integrity: pathIntegrity,
    findings: [...(Array.isArray(report.findings) ? report.findings : []), ...findings],
    secrets_included: false,
  };
}

function writeAtomic(file, payload) {
  const resolved = path.resolve(file);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`);
  fs.renameSync(temporary, resolved);
}

function parseArgs(argv) {
  const options = { root: REPO_ROOT, reportFile: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const read = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
      index += 1;
      return value;
    };
    if (argument === "--root") options.root = path.resolve(read());
    else if (argument.startsWith("--root=")) options.root = path.resolve(argument.slice(7));
    else if (argument === "--report-file") options.reportFile = path.resolve(read());
    else if (argument.startsWith("--report-file=")) options.reportFile = path.resolve(argument.slice(14));
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.reportFile) throw new Error("--report-file is required.");
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = JSON.parse(fs.readFileSync(options.reportFile, "utf8"));
  const result = enforceGitIndexIntegrity({ root: options.root, report });
  writeAtomic(options.reportFile, result);
  const output = JSON.stringify(result, null, 2);
  if (!result.ok) {
    console.error(output);
    process.exit(1);
  }
  console.log(output);
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) main();
