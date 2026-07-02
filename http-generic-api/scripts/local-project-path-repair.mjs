#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

function parseArgs(argv = process.argv.slice(2)) {
  const args = { mode: "dry_run" };
  let applySeen = false;
  let drySeen = false;
  for (const arg of argv) {
    if (arg === "--apply") { args.mode = "apply"; applySeen = true; continue; }
    if (arg === "--dry-run") { args.mode = "dry_run"; drySeen = true; continue; }
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) args[m[1].replace(/-/g, "_")] = m[2];
  }
  if (applySeen && drySeen) throw new Error("Conflicting mode flags: use either --dry-run or --apply, not both.");
  return args;
}

function clean(value = "") {
  return String(value ?? "").trim();
}

function required(args, key) {
  const value = clean(args[key]);
  if (!value) throw new Error(`Missing required argument --${key.replace(/_/g, "-")}`);
  if (/[\0\r\n]/.test(value)) throw new Error(`${key} contains invalid control characters`);
  return value;
}

function splitList(value = "") {
  return clean(value).split(/[;,]/).map(v => v.trim()).filter(Boolean);
}

function pathInsideRoot(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

async function canonicalExistingPath(value, label) {
  const resolved = path.resolve(value);
  const real = await fs.realpath(resolved);
  if (!pathInsideRoot(real, resolved) && !pathInsideRoot(resolved, real)) {
    const err = new Error(`${label} resolves through an unexpected canonical path.`);
    err.code = "local_project_path_canonical_mismatch";
    throw err;
  }
  return real;
}

async function canonicalAllowedRoots(value = "") {
  const roots = [];
  for (const root of splitList(value)) {
    roots.push(await canonicalExistingPath(root, "allowed_root"));
  }
  return roots;
}

function assertWithinAllowedRoots(candidate, allowedRoots, label) {
  if (!allowedRoots.length) {
    const err = new Error(`${label} requires at least one allowlisted root.`);
    err.code = "local_project_path_allowed_root_required";
    throw err;
  }
  if (!allowedRoots.some((root) => pathInsideRoot(candidate, root))) {
    const err = new Error(`${label} is outside the allowlisted file roots.`);
    err.code = "local_project_path_outside_allowed_roots";
    err.details = { label, secrets_included: false };
    throw err;
  }
}

function safeRelativePath(rel = "") {
  const normalized = String(rel || "").split(path.sep).join("/");
  if (!normalized || normalized.startsWith("../") || normalized.includes("/../") || path.isAbsolute(normalized)) {
    const err = new Error("File traversal is not allowed in local project path repair.");
    err.code = "local_project_path_traversal_blocked";
    throw err;
  }
  return normalized;
}

function usage() {
  return `Usage:\n\nnode scripts/local-project-path-repair.mjs \\\n  --source-path=<old_or_source_path> \\\n  --target-path=<new_or_partial_path> \\\n  [--markers=.git,package.json] \\\n  [--exclude=node_modules,.cache,dist,coverage] \\\n  [--manifest-path=<path>] \\\n  [--apply|--dry-run]\n\nDefault is dry-run. Apply mode copies missing files only and never deletes the source path.`;
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function statOrNull(p) {
  try { return await fs.stat(p); } catch { return null; }
}

function shouldExclude(rel, excludes) {
  const normalized = rel.split(path.sep).join("/");
  return excludes.some(ex => normalized === ex || normalized.startsWith(`${ex}/`) || normalized.includes(`/${ex}/`));
}

async function walk(root, excludes, prefix = "", skippedSymlinks = []) {
  const out = [];
  const entries = await fs.readdir(path.join(root, prefix), { withFileTypes: true });
  for (const entry of entries) {
    const rel = path.join(prefix, entry.name);
    if (shouldExclude(rel, excludes)) continue;
    safeRelativePath(rel);
    const abs = path.join(root, rel);
    if (entry.isSymbolicLink()) {
      skippedSymlinks.push(rel.split(path.sep).join("/"));
      continue;
    }
    if (entry.isDirectory()) {
      out.push(...await walk(root, excludes, rel, skippedSymlinks));
    } else if (entry.isFile()) {
      const st = await fs.stat(abs);
      out.push({ rel, abs, size: st.size, mtimeMs: st.mtimeMs });
    }
  }
  return out;
}

async function sha256File(file) {
  const data = await fs.readFile(file);
  return createHash("sha256").update(data).digest("hex");
}

async function copyMissingFile(sourceAbs, targetAbs) {
  await fs.mkdir(path.dirname(targetAbs), { recursive: true });
  await fs.copyFile(sourceAbs, targetAbs, fs.constants.COPYFILE_EXCL);
}

async function main() {
  const args = parseArgs();
  const sourcePath = await canonicalExistingPath(required(args, "source_path"), "source_path");
  const targetPath = await canonicalExistingPath(required(args, "target_path"), "target_path");
  const markers = splitList(args.markers || ".git,package.json");
  const excludes = splitList(args.exclude || "node_modules,.cache,dist,coverage");
  const apply = args.mode === "apply";
  const allowedRoots = await canonicalAllowedRoots(args.allowed_roots || process.env.LOCAL_PROJECT_ALLOWED_ROOTS || "");
  const manifestPath = path.resolve(clean(args.manifest_path || path.join(targetPath, ".mad4b-local-path-repair.json")));

  if (apply) {
    assertWithinAllowedRoots(sourcePath, allowedRoots, "source_path");
    assertWithinAllowedRoots(targetPath, allowedRoots, "target_path");
    assertWithinAllowedRoots(path.dirname(manifestPath), allowedRoots, "manifest_path");
  }
  if (!(await exists(sourcePath))) throw new Error(`source_path does not exist: ${sourcePath}`);
  if (!(await exists(targetPath))) throw new Error(`target_path does not exist: ${targetPath}`);

  const markerStatus = [];
  for (const marker of markers) {
    markerStatus.push({ marker, source: await exists(path.join(sourcePath, marker)), target: await exists(path.join(targetPath, marker)) });
  }

  const skippedSymlinks = [];
  const sourceFiles = await walk(sourcePath, excludes, "", skippedSymlinks);
  const missing = [];
  const conflicts = [];
  let checked = 0;

  for (const file of sourceFiles) {
    checked += 1;
    const targetAbs = path.join(targetPath, file.rel);
    if (!pathInsideRoot(path.resolve(targetAbs), targetPath)) {
      const err = new Error("Target file path escaped the canonical target root.");
      err.code = "local_project_path_target_escape_blocked";
      throw err;
    }
    const targetStat = await statOrNull(targetAbs);
    if (!targetStat) {
      missing.push(file);
      continue;
    }
    if (targetStat.size !== file.size) {
      conflicts.push({ rel: file.rel, sourceSize: file.size, targetSize: targetStat.size });
    }
  }

  let copied = 0;
  if (apply) {
    for (const file of missing) {
      const targetAbs = path.resolve(targetPath, safeRelativePath(file.rel));
      if (!pathInsideRoot(targetAbs, targetPath)) {
        const err = new Error("Target file path escaped the canonical target root.");
        err.code = "local_project_path_target_escape_blocked";
        throw err;
      }
      await copyMissingFile(file.abs, targetAbs);
      copied += 1;
    }
  }

  const manifest = {
    ok: true,
    repair_run_id: randomUUID(),
    mode: apply ? "apply" : "dry-run",
    sourcePath,
    targetPath,
    allowedRoots,
    markers: markerStatus,
    excludes,
    symlinksSkipped: skippedSymlinks.length,
    symlinkPreview: skippedSymlinks.slice(0, 50),
    filesChecked: checked,
    filesMissing: missing.length,
    filesCopied: copied,
    conflictsFound: conflicts.length,
    missingPreview: missing.slice(0, 50).map(f => ({ rel: f.rel, size: f.size })),
    conflictsPreview: conflicts.slice(0, 50),
    warnings: [
      "This script never deletes the source path.",
      "Apply mode copies missing files only; conflicting files are reported but not overwritten.",
      "Symlinks are skipped to prevent traversal outside canonical local project roots."
    ],
    createdAt: new Date().toISOString()
  };

  if (apply || clean(args.write_manifest) === "true") {
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    manifest.manifestPath = manifestPath;
  }

  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: { code: err.code || "local_project_path_repair_failed", message: err.message }, usage: usage() }, null, 2));
  process.exitCode = 1;
});
