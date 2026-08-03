import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ROOT_ENTRYPOINT_BRANCH_LOCK_ENV } from "./scripts/generate-deployment-manifest.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "..");
const applicationRoot = resolve(repositoryRoot, "http-generic-api");
const rootPackage = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8"));
const require = createRequire(import.meta.url);
const {
  refreshDeploymentManifest,
  resolveApplicationRoot,
  resolveManifestGeneratorPath,
  startApplication,
} = require("../hostinger-entrypoint-runtime.js");

assert.equal(rootPackage.main, "server.js");
assert.equal(rootPackage.scripts.start, "node server.js");
assert.equal(rootPackage.scripts.postinstall, "cd http-generic-api && npm ci --omit=dev");
assert.equal(resolveApplicationRoot(), applicationRoot);
assert.equal(
  resolveManifestGeneratorPath(),
  resolve(applicationRoot, "scripts", "generate-deployment-manifest.mjs")
);

const manifestEnv = {
  DEPLOYMENT_COMMIT_SHA: "a".repeat(40),
};
let generatorSpecifier = null;
let generatorOptions = null;
const generatedManifest = {
  ok: true,
  manifest: {
    branch: "Production",
    commit_sha: manifestEnv.DEPLOYMENT_COMMIT_SHA,
  },
};

const refreshResult = await refreshDeploymentManifest({
  applicationRoot,
  env: manifestEnv,
  importer: async (specifier) => {
    generatorSpecifier = specifier;
    return {
      ROOT_ENTRYPOINT_BRANCH_LOCK_ENV,
      generateDeploymentManifest: (options) => {
        generatorOptions = options;
        return generatedManifest;
      },
    };
  },
});

assert.equal(
  generatorSpecifier,
  pathToFileURL(resolveManifestGeneratorPath(applicationRoot)).href
);
assert.equal(generatorOptions.env, manifestEnv);
assert.deepEqual(generatorOptions.argv, ["--branch=Production"]);
assert.equal(
  generatorOptions.outputPath,
  resolve(applicationRoot, "deployment-manifest.json")
);
assert.equal(refreshResult, generatedManifest);
assert.equal(manifestEnv[ROOT_ENTRYPOINT_BRANCH_LOCK_ENV], "Production");

const sequence = [];
let changedDirectory = null;
let importedEntrypoint = null;
let manifestRefreshInput = null;
let branchLockAtServerImport = null;
const importResult = { imported: true };
const manifestImporter = async () => ({ unused: true });
const startupManifestEnv = {
  DEPLOYMENT_COMMIT_SHA: "b".repeat(40),
  DEPLOYMENT_BRANCH: "main",
};

const result = await startApplication({
  chdir: (directory) => {
    sequence.push("chdir");
    changedDirectory = directory;
  },
  importer: async (specifier) => {
    sequence.push("server-import");
    branchLockAtServerImport = startupManifestEnv[ROOT_ENTRYPOINT_BRANCH_LOCK_ENV];
    importedEntrypoint = specifier;
    return importResult;
  },
  manifestRefresher: async (input) => {
    sequence.push("manifest-refresh");
    manifestRefreshInput = input;
    input.env[ROOT_ENTRYPOINT_BRANCH_LOCK_ENV] = "Production";
    return generatedManifest;
  },
  manifestEnv: startupManifestEnv,
  manifestImporter,
});

assert.deepEqual(sequence, ["manifest-refresh", "chdir", "server-import"]);
assert.equal(manifestRefreshInput.applicationRoot, applicationRoot);
assert.equal(manifestRefreshInput.env, startupManifestEnv);
assert.equal(manifestRefreshInput.importer, manifestImporter);
assert.equal(changedDirectory, applicationRoot);
assert.equal(importedEntrypoint, pathToFileURL(resolve(applicationRoot, "server.js")).href);
assert.equal(branchLockAtServerImport, "Production");
assert.equal(result, importResult);

const mismatchedEnv = {};
await assert.rejects(
  refreshDeploymentManifest({
    applicationRoot,
    env: mismatchedEnv,
    importer: async () => ({
      ROOT_ENTRYPOINT_BRANCH_LOCK_ENV,
      generateDeploymentManifest: () => ({
        ok: true,
        manifest: { branch: "main", commit_sha: "c".repeat(40) },
      }),
    }),
  }),
  /did not resolve Production branch provenance/
);
assert.equal(mismatchedEnv[ROOT_ENTRYPOINT_BRANCH_LOCK_ENV], undefined);

let chdirAfterFailure = false;
let importAfterFailure = false;
await assert.rejects(
  startApplication({
    manifestRefresher: async () => {
      throw new Error("manifest refresh failed");
    },
    chdir: () => {
      chdirAfterFailure = true;
    },
    importer: async () => {
      importAfterFailure = true;
    },
  }),
  /manifest refresh failed/
);
assert.equal(chdirAfterFailure, false);
assert.equal(importAfterFailure, false);

console.log(
  "Hostinger root entrypoint locks Production provenance before importing the nested server."
);
