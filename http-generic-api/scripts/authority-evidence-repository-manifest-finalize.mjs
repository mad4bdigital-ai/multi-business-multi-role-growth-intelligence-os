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

function writeNewFile(repositoryRoot, relativePath, content) {
  const normalized = relativePath.replaceAll("\\", "/");
  const absolutePath = path.resolve(repositoryRoot, normalized);
  if (path.relative(repositoryRoot, absolutePath).replaceAll("\\", "/") !== normalized) {
    throw new Error(`Output path escaped repository root: ${relativePath}`);
  }
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  if (fs.existsSync(absolutePath)) throw new Error(`Refusing to overwrite existing file: ${relativePath}`);
  const temporary = `${absolutePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content);
  fs.renameSync(temporary, absolutePath);
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

export const _testingAuthorityEvidenceRepositoryManifestFinalize = Object.freeze({ parseArgs });

if (directExecution()) {
  try {
    process.exitCode = runAuthorityEvidenceRepositoryManifestFinalize();
  } catch (error) {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  }
}
