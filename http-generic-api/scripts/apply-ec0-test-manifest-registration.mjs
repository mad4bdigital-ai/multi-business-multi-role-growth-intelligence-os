#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(scriptDir, "..");
const manifestPath = path.join(apiRoot, "scripts", "test-manifest.mjs");
const command = `  "node test-execution-capsule-contract.mjs",`;
const anchor = `  "node test-context-kernel-application-use-cases.mjs",`;

let source = fs.readFileSync(manifestPath, "utf8");
if (source.includes(command)) {
  console.log("EC0 test command already registered");
  process.exit(0);
}
const first = source.indexOf(anchor);
if (first < 0) throw new Error("Context Kernel application test anchor not found");
if (source.indexOf(anchor, first + anchor.length) >= 0) {
  throw new Error("Context Kernel application test anchor is not unique");
}
source = `${source.slice(0, first + anchor.length)}\n${command}${source.slice(first + anchor.length)}`;
fs.writeFileSync(manifestPath, source);
console.log("EC0 test command registered");
