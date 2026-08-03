import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { accessSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ROOT_ENTRYPOINT_BRANCH_LOCK_ENV } from "./scripts/generate-deployment-manifest.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "..");
const applicationRoot = resolve(repositoryRoot, "http-generic-api");
const rootPackage = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8"));
const require = createRequire(import.meta.url);
const {
  ADMIN_SHELL_ALLOWLIST_ENV,
  CAPABILITY_APPROVAL_ALIAS,
  configureHostingerApprovalAlias,
  parseShellAllowlist,
  refreshDeploymentManifest,
  resolveApplicationRoot,
  resolveCapabilityApprovalScriptPath,
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
assert.equal(
  resolveCapabilityApprovalScriptPath(),
  resolve(applicationRoot, "scripts", "capability-resolution-envelope-approve.mjs")
);
assert.equal(isAbsolute(resolveCapabilityApprovalScriptPath()), true);
accessSync(resolveCapabilityApprovalScriptPath());
assert.deepEqual(parseShellAllowlist(""), {});
assert.throws(() => parseShellAllowlist("[]"), /must be a JSON object/);
assert.throws(() => parseShellAllowlist("{invalid"), /must be valid JSON/);

const existingAlias = {
  command: "/usr/bin/existing",
  args: ["--safe"],
};
const staleApprovalAlias = {
  command: "/usr/bin/node",
  args: ["http-generic-api/scripts/capability-resolution-envelope-approve.mjs"],
};
const configuredEnv = {
  [ADMIN_SHELL_ALLOWLIST_ENV]: JSON.stringify({
    existing_alias: existingAlias,
    [CAPABILITY_APPROVAL_ALIAS]: staleApprovalAlias,
  }),
};
const configured = configureHostingerApprovalAlias({
  applicationRoot,
  env: configuredEnv,
  nodeExecutable: "/opt/node/bin/node",
});
const configuredAllowlist = JSON.parse(configuredEnv[ADMIN_SHELL_ALLOWLIST_ENV]);
assert.deepEqual(configuredAllowlist.existing_alias, existingAlias);
assert.equal(configured.command, "/opt/node/bin/node");
assert.deepEqual(configured.args, [resolveCapabilityApprovalScriptPath(applicationRoot)]);
assert.equal(configured.previous_alias_present, true);
assert.equal(configured.preserved_alias_count, 1);
assert.deepEqual(configuredAllowlist[CAPABILITY_APPROVAL_ALIAS], {
  command: "/opt/node/bin/node",
  args: [resolveCapabilityApprovalScriptPath(applicationRoot)],
  display_name: "Approve capability resolution envelope",
  allow_extra_args: true,
  max_extra_args: 12,
  timeout_ms: 120000,
});

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
let approvalAliasAtServerImport = null;
let preservedAliasAtServerImport = null;
const importResult = { imported: true };
const manifestImporter = async () => ({ unused: true });
const startupManifestEnv = {
  DEPLOYMENT_COMMIT_SHA: "b".repeat(40),
  DEPLOYMENT_BRANCH: "main",
  [ADMIN_SHELL_ALLOWLIST_ENV]: JSON.stringify({
    preserved_alias: existingAlias,
    [CAPABILITY_APPROVAL_ALIAS]: staleApprovalAlias,
  }),
};

const result = await startApplication({
  chdir: (directory) => {
    sequence.push("chdir");
    changedDirectory = directory;
  },
  importer: async (specifier) => {
    sequence.push("server-import");
    branchLockAtServerImport = startupManifestEnv[ROOT_ENTRYPOINT_BRANCH_LOCK_ENV];
    const allowlist = JSON.parse(startupManifestEnv[ADMIN_SHELL_ALLOWLIST_ENV]);
    approvalAliasAtServerImport = allowlist[CAPABILITY_APPROVAL_ALIAS];
    preservedAliasAtServerImport = allowlist.preserved_alias;
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
  nodeExecutable: "/opt/hostinger/node",
});

assert.deepEqual(sequence, ["manifest-refresh", "chdir", "server-import"]);
assert.equal(manifestRefreshInput.applicationRoot, applicationRoot);
assert.equal(manifestRefreshInput.env, startupManifestEnv);
assert.equal(manifestRefreshInput.importer, manifestImporter);
assert.equal(changedDirectory, applicationRoot);
assert.equal(importedEntrypoint, pathToFileURL(resolve(applicationRoot, "server.js")).href);
assert.equal(branchLockAtServerImport, "Production");
assert.deepEqual(preservedAliasAtServerImport, existingAlias);
assert.deepEqual(approvalAliasAtServerImport, {
  command: "/opt/hostinger/node",
  args: [resolveCapabilityApprovalScriptPath(applicationRoot)],
  display_name: "Approve capability resolution envelope",
  allow_extra_args: true,
  max_extra_args: 12,
  timeout_ms: 120000,
});
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
const runtimeEnvAfterFailure = {};
await assert.rejects(
  startApplication({
    manifestRefresher: async () => {
      throw new Error("manifest refresh failed");
    },
    manifestEnv: runtimeEnvAfterFailure,
    runtimeEnv: runtimeEnvAfterFailure,
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
assert.equal(runtimeEnvAfterFailure[ADMIN_SHELL_ALLOWLIST_ENV], undefined);

console.log(
  "Hostinger root entrypoint locks Production provenance and the governed approval alias before importing the nested server."
);
