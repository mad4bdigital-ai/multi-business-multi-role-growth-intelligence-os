#!/usr/bin/env node
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { collectAuthorityCatalogCensus } from "../authorityCatalogCensus.js";
import { assessUeacpAuthorityFoundation } from "../ueacpAuthorityFoundationAssessment.js";

function parseArgs(argv) {
  const options = {
    classificationFile: null,
    authorityPathInventoryFile: null,
    censusFile: null,
    reportFile: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const readValue = (name) => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
      index += 1;
      return value;
    };
    if (argument === "--classification-file") options.classificationFile = readValue(argument);
    else if (argument.startsWith("--classification-file=")) options.classificationFile = argument.slice(argument.indexOf("=") + 1);
    else if (argument === "--authority-path-inventory-file") options.authorityPathInventoryFile = readValue(argument);
    else if (argument.startsWith("--authority-path-inventory-file=")) options.authorityPathInventoryFile = argument.slice(argument.indexOf("=") + 1);
    else if (argument === "--census-file") options.censusFile = readValue(argument);
    else if (argument.startsWith("--census-file=")) options.censusFile = argument.slice(argument.indexOf("=") + 1);
    else if (argument === "--report-file") options.reportFile = readValue(argument);
    else if (argument.startsWith("--report-file=")) options.reportFile = argument.slice(argument.indexOf("=") + 1);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.classificationFile) throw new Error("--classification-file is required.");
  if (!options.authorityPathInventoryFile) throw new Error("--authority-path-inventory-file is required.");
  return options;
}

function readJson(filePath, label) {
  const resolved = path.resolve(process.cwd(), filePath);
  try {
    return JSON.parse(readFileSync(resolved, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${label} JSON at ${resolved}: ${error.message}`);
  }
}

function writeReport(filePath, report) {
  if (!filePath) return;
  const resolved = path.resolve(process.cwd(), filePath);
  mkdirSync(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`);
  renameSync(temporary, resolved);
}

export async function runUeacpAuthorityFoundationAssessment(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseArgs(argv);
  const classificationBundle = readJson(options.classificationFile, "classification");
  const authorityPathInventory = readJson(options.authorityPathInventoryFile, "authority-path inventory");
  const census = options.censusFile
    ? readJson(options.censusFile, "census")
    : await (dependencies.collectCensus ?? collectAuthorityCatalogCensus)();
  const report = assessUeacpAuthorityFoundation({
    census,
    authorityPathInventory,
    classificationBundle,
  });
  writeReport(options.reportFile, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.ok ? 0 : 2;
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  return pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(fileURLToPath(import.meta.url)).href;
}

if (isDirectExecution()) {
  try {
    process.exitCode = await runUeacpAuthorityFoundationAssessment();
  } catch (error) {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  }
}
