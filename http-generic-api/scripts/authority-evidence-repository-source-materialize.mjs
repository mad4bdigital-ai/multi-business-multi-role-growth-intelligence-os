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

function writeNewFile(repositoryRoot, relativePath, content) {
  const normalized = relativePath.replaceAll("\\", "/");
  const absolutePath = path.resolve(repositoryRoot, normalized);
  const relative = path.relative(repositoryRoot, absolutePath).replaceAll("\\", "/");
  if (relative !== normalized) throw new Error(`Output path escaped repository root: ${relativePath}`);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  if (fs.existsSync(absolutePath)) throw new Error(`Refusing to overwrite existing file: ${relativePath}`);
  const temporary = `${absolutePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content);
  fs.renameSync(temporary, absolutePath);
}

export function runAuthorityEvidenceRepositorySourceMaterialize(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const repositoryRoot = fs.realpathSync(path.resolve(process.cwd(), options.repositoryRoot));
  const materialized = materializeAuthorityEvidenceRepositorySourceDocuments({
    sources: readJson(options.sourcesFile, "authority source snapshots"),
    source_directory: options.outputDir,
  });
  for (const document of materialized.documents) {
    writeNewFile(repositoryRoot, document.source_file, document.content);
  }
  writeNewFile(
    repositoryRoot,
    options.reportFile.replaceAll("\\", "/"),
    `${JSON.stringify(materialized.report, null, 2)}\n`,
  );
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

export const _testingAuthorityEvidenceRepositorySourceMaterialize = Object.freeze({ parseArgs });

if (directExecution()) {
  try {
    process.exitCode = runAuthorityEvidenceRepositorySourceMaterialize();
  } catch (error) {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  }
}
