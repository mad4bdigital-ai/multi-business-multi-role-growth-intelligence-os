#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { finalizeAuthorityEvidenceRepositoryManifest } from
  "../authorityEvidenceRepositorySourceMaterializer.js";

function parseArgs(argv) {
  const options = {
    materializationReport: null,
    repository: null,
    observedRef: null,
    manifestOutput: null,
    repositoryRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const take = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
      index += 1;
      return value;
    };
    if (argument === "--materialization-report") options.materializationReport = take();
    else if (argument.startsWith("--materialization-report=")) options.materializationReport = argument.slice(25);
    else if (argument === "--repository") options.repository = take();
    else if (argument.startsWith("--repository=")) options.repository = argument.slice(13);
    else if (argument === "--observed-ref") options.observedRef = take();
    else if (argument.startsWith("--observed-ref=")) options.observedRef = argument.slice(15);
    else if (argument === "--manifest-output") options.manifestOutput = take();
    else if (argument.startsWith("--manifest-output=")) options.manifestOutput = argument.slice(18);
    else if (argument === "--repository-root") options.repositoryRoot = take();
    else if (argument.startsWith("--repository-root=")) options.repositoryRoot = argument.slice(18);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.materializationReport || !options.repository || !options.observedRef || !options.manifestOutput) {
    throw new Error("--materialization-report, --repository, --observed-ref, and --manifest-output are required.");
  }
  return options;
}

function readJson(filePath, label) {
  const resolved = path.resolve(process.cwd(), filePath);
  try {
    return JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${label} at ${resolved}: ${error.message}`);
  }
}

function lstatOrNull(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function prepareNewFile(repositoryRoot, relativePath) {
  const normalized = String(relativePath ?? "").trim().replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (
    !normalized
    || normalized.startsWith("/")
    || normalized.includes("\0")
    || segments.some((segment) => !segment || segment === "." || segment === ".." || segment === ".git")
  ) {
    throw new Error(`Unsafe repository output path: ${relativePath}`);
  }
  const absolutePath = path.resolve(repositoryRoot, normalized);
  if (path.relative(repositoryRoot, absolutePath).replaceAll("\\", "/") !== normalized) {
    throw new Error(`Output path escaped repository root: ${relativePath}`);
  }

  let current = repositoryRoot;
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    const stat = lstatOrNull(current);
    if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) {
      throw new Error(`Unsafe intermediate output directory: ${path.relative(repositoryRoot, current)}`);
    }
  }
  if (lstatOrNull(absolutePath)) throw new Error(`Refusing to overwrite existing file: ${relativePath}`);
  return { normalized, absolutePath, parentPath: path.dirname(absolutePath) };
}

function ensureSafeParent(repositoryRoot, parentPath, createdDirectories) {
  const relative = path.relative(repositoryRoot, parentPath).replaceAll("\\", "/");
  const segments = relative === "" ? [] : relative.split("/");
  let current = repositoryRoot;
  for (const segment of segments) {
    current = path.join(current, segment);
    const existing = lstatOrNull(current);
    if (!existing) {
      fs.mkdirSync(current);
      createdDirectories.push(current);
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Unsafe intermediate output directory: ${path.relative(repositoryRoot, current)}`);
    }
    if (fs.realpathSync(current) !== path.resolve(current)) {
      throw new Error(`Intermediate output directory escaped repository root: ${path.relative(repositoryRoot, current)}`);
    }
  }
}

function writeNewFile(repositoryRoot, relativePath, content) {
  const prepared = prepareNewFile(repositoryRoot, relativePath);
  const createdDirectories = [];
  let temporary = null;
  let linked = false;
  try {
    ensureSafeParent(repositoryRoot, prepared.parentPath, createdDirectories);
    if (lstatOrNull(prepared.absolutePath)) {
      throw new Error(`Refusing to overwrite existing file: ${prepared.normalized}`);
    }
    temporary = `${prepared.absolutePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, String(content), { flag: "wx" });
    fs.linkSync(temporary, prepared.absolutePath);
    linked = true;
    fs.unlinkSync(temporary);
    temporary = null;
  } catch (error) {
    if (temporary) {
      try { fs.unlinkSync(temporary); } catch {}
    }
    if (linked) {
      try { fs.unlinkSync(prepared.absolutePath); } catch {}
    }
    for (const directory of createdDirectories.reverse()) {
      try { fs.rmdirSync(directory); } catch {}
    }
    throw error;
  }
}

export function runAuthorityEvidenceRepositoryManifestFinalize(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const repositoryRoot = fs.realpathSync(path.resolve(process.cwd(), options.repositoryRoot));
  const finalized = finalizeAuthorityEvidenceRepositoryManifest({
    materialization_report: readJson(options.materializationReport, "source materialization report"),
    repository: options.repository,
    observed_ref: options.observedRef,
    repository_root: repositoryRoot,
  });
  writeNewFile(repositoryRoot, options.manifestOutput, `${JSON.stringify(finalized.manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    status: "ready_for_manifest_review",
    observed_ref: finalized.manifest.observed_ref,
    source_document_count: finalized.source_document_count,
    manifest_sha256: finalized.manifest_sha256,
    repository_mutation_performed: false,
    secrets_included: false,
  })}\n`);
  return 0;
}

function directExecution() {
  return Boolean(process.argv[1])
    && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(fileURLToPath(import.meta.url)).href;
}

export const _testingAuthorityEvidenceRepositoryManifestFinalize = Object.freeze({
  parseArgs,
  prepareNewFile,
  writeNewFile,
});

if (directExecution()) {
  try {
    process.exitCode = runAuthorityEvidenceRepositoryManifestFinalize();
  } catch (error) {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  }
}
