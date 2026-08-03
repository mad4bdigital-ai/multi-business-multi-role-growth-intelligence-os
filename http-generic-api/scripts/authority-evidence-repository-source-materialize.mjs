#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { materializeAuthorityEvidenceRepositorySourceDocuments } from
  "../authorityEvidenceRepositorySourceMaterializer.js";

function parseArgs(argv) {
  const options = {
    sourcesFile: null,
    outputDir: null,
    reportFile: null,
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
    if (argument === "--sources-file") options.sourcesFile = take();
    else if (argument.startsWith("--sources-file=")) options.sourcesFile = argument.slice(15);
    else if (argument === "--output-dir") options.outputDir = take();
    else if (argument.startsWith("--output-dir=")) options.outputDir = argument.slice(13);
    else if (argument === "--report-file") options.reportFile = take();
    else if (argument.startsWith("--report-file=")) options.reportFile = argument.slice(14);
    else if (argument === "--repository-root") options.repositoryRoot = take();
    else if (argument.startsWith("--repository-root=")) options.repositoryRoot = argument.slice(18);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.sourcesFile || !options.outputDir || !options.reportFile) {
    throw new Error("--sources-file, --output-dir, and --report-file are required.");
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

function normalizeNewOutput(repositoryRoot, relativePath) {
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
  return { relativePath: normalized, absolutePath, parentPath: path.dirname(absolutePath) };
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

function writeNewFilesAtomically(repositoryRoot, files) {
  const prepared = files.map((file) => ({
    ...normalizeNewOutput(repositoryRoot, file.relativePath),
    content: String(file.content),
  }));
  const uniquePaths = new Set(prepared.map((entry) => entry.relativePath));
  if (uniquePaths.size !== prepared.length) throw new Error("Duplicate repository output paths are forbidden.");

  const createdFiles = [];
  const createdDirectories = [];
  const temporaryFiles = [];
  try {
    for (let index = 0; index < prepared.length; index += 1) {
      const entry = prepared[index];
      ensureSafeParent(repositoryRoot, entry.parentPath, createdDirectories);
      if (lstatOrNull(entry.absolutePath)) {
        throw new Error(`Refusing to overwrite existing file: ${entry.relativePath}`);
      }
      const temporary = `${entry.absolutePath}.${process.pid}.${index}.tmp`;
      temporaryFiles.push(temporary);
      fs.writeFileSync(temporary, entry.content, { flag: "wx" });
      fs.linkSync(temporary, entry.absolutePath);
      fs.unlinkSync(temporary);
      temporaryFiles.pop();
      createdFiles.push(entry.absolutePath);
    }
  } catch (error) {
    for (const temporary of temporaryFiles.reverse()) {
      try { fs.unlinkSync(temporary); } catch {}
    }
    for (const filePath of createdFiles.reverse()) {
      try { fs.unlinkSync(filePath); } catch {}
    }
    for (const directory of createdDirectories.reverse()) {
      try { fs.rmdirSync(directory); } catch {}
    }
    throw error;
  }
}

export function runAuthorityEvidenceRepositorySourceMaterialize(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const repositoryRoot = fs.realpathSync(path.resolve(process.cwd(), options.repositoryRoot));
  const materialized = materializeAuthorityEvidenceRepositorySourceDocuments({
    sources: readJson(options.sourcesFile, "authority source snapshots"),
    source_directory: options.outputDir,
  });
  writeNewFilesAtomically(repositoryRoot, [
    ...materialized.documents.map((document) => ({
      relativePath: document.source_file,
      content: document.content,
    })),
    {
      relativePath: options.reportFile,
      content: `${JSON.stringify(materialized.report, null, 2)}\n`,
    },
  ]);
  process.stdout.write(`${JSON.stringify({
    status: materialized.report.status,
    source_document_count: materialized.report.source_document_count,
    source_bundle_sha256: materialized.report.source_bundle_sha256,
    materialization_sha256: materialized.report.materialization_sha256,
    repository_mutation_performed: false,
    secrets_included: false,
  })}\n`);
  return 0;
}

function directExecution() {
  return Boolean(process.argv[1])
    && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(fileURLToPath(import.meta.url)).href;
}

export const _testingAuthorityEvidenceRepositorySourceMaterialize = Object.freeze({
  parseArgs,
  normalizeNewOutput,
  writeNewFilesAtomically,
});

if (directExecution()) {
  try {
    process.exitCode = runAuthorityEvidenceRepositorySourceMaterialize();
  } catch (error) {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  }
}
