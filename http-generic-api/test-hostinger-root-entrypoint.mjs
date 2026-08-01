import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "..");
const applicationRoot = resolve(repositoryRoot, "http-generic-api");
const rootPackage = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8"));
const require = createRequire(import.meta.url);
const { resolveApplicationRoot, startApplication } = require("../hostinger-entrypoint-runtime.js");

assert.equal(rootPackage.main, "server.js");
assert.equal(rootPackage.scripts.start, "node server.js");
assert.equal(rootPackage.scripts.postinstall, "cd http-generic-api && npm ci --omit=dev");
assert.equal(resolveApplicationRoot(), applicationRoot);

let changedDirectory = null;
let importedEntrypoint = null;
const importResult = { imported: true };

const result = await startApplication({
  chdir: (directory) => {
    changedDirectory = directory;
  },
  importer: async (specifier) => {
    importedEntrypoint = specifier;
    return importResult;
  },
});

assert.equal(changedDirectory, applicationRoot);
assert.equal(importedEntrypoint, pathToFileURL(resolve(applicationRoot, "server.js")).href);
assert.equal(result, importResult);

console.log("Hostinger root entrypoint wrapper preserves the application cwd and nested server entrypoint.");
