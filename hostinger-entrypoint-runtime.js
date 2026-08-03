const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const repositoryRoot = __dirname;
const ADMIN_SHELL_ALLOWLIST_ENV = "ADMIN_SHELL_ALLOWLIST";
const CAPABILITY_APPROVAL_ALIAS = "capability_resolution_envelope_approve";

function resolveApplicationRoot() {
  return resolve(repositoryRoot, "http-generic-api");
}

function resolveManifestGeneratorPath(applicationRoot = resolveApplicationRoot()) {
  return resolve(applicationRoot, "scripts", "generate-deployment-manifest.mjs");
}

function resolveCapabilityApprovalScriptPath(applicationRoot = resolveApplicationRoot()) {
  return resolve(
    applicationRoot,
    "scripts",
    "capability-resolution-envelope-approve.mjs"
  );
}

function parseShellAllowlist(rawValue) {
  const text = String(rawValue || "").trim();
  if (!text) return {};

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `${ADMIN_SHELL_ALLOWLIST_ENV} must be valid JSON before Hostinger startup: ${error.message}`
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${ADMIN_SHELL_ALLOWLIST_ENV} must be a JSON object.`);
  }

  return parsed;
}

function configureHostingerApprovalAlias({
  applicationRoot = resolveApplicationRoot(),
  env = process.env,
  nodeExecutable = process.execPath,
} = {}) {
  const existing = parseShellAllowlist(env[ADMIN_SHELL_ALLOWLIST_ENV]);
  const scriptPath = resolveCapabilityApprovalScriptPath(applicationRoot);
  const next = {
    ...existing,
    [CAPABILITY_APPROVAL_ALIAS]: {
      command: nodeExecutable,
      args: [scriptPath],
      display_name: "Approve capability resolution envelope",
      allow_extra_args: true,
      max_extra_args: 12,
      timeout_ms: 120000,
    },
  };

  env[ADMIN_SHELL_ALLOWLIST_ENV] = JSON.stringify(next);
  return {
    alias: CAPABILITY_APPROVAL_ALIAS,
    command: nodeExecutable,
    args: [scriptPath],
    previous_alias_present: Object.prototype.hasOwnProperty.call(
      existing,
      CAPABILITY_APPROVAL_ALIAS
    ),
    preserved_alias_count: Object.keys(existing).filter(
      (key) => key !== CAPABILITY_APPROVAL_ALIAS
    ).length,
  };
}

async function refreshDeploymentManifest({
  applicationRoot = resolveApplicationRoot(),
  env = process.env,
  importer = (specifier) => import(specifier),
} = {}) {
  const generatorPath = resolveManifestGeneratorPath(applicationRoot);
  const generatorModule = await importer(pathToFileURL(generatorPath).href);

  if (typeof generatorModule?.generateDeploymentManifest !== "function") {
    throw new Error("Hostinger deployment manifest generator export is unavailable.");
  }
  if (!generatorModule?.ROOT_ENTRYPOINT_BRANCH_LOCK_ENV) {
    throw new Error("Hostinger deployment manifest branch-lock contract is unavailable.");
  }

  const result = generatorModule.generateDeploymentManifest({
    env,
    argv: ["--branch=Production"],
    outputPath: resolve(applicationRoot, "deployment-manifest.json"),
  });

  if (result?.manifest?.branch !== "Production") {
    throw new Error("Hostinger root deployment manifest did not resolve Production branch provenance.");
  }

  env[generatorModule.ROOT_ENTRYPOINT_BRANCH_LOCK_ENV] = "Production";
  return result;
}

async function startApplication({
  chdir = process.chdir,
  importer = (specifier) => import(specifier),
  manifestRefresher = refreshDeploymentManifest,
  manifestEnv = process.env,
  manifestImporter = (specifier) => import(specifier),
  runtimeEnv = manifestEnv,
  nodeExecutable = process.execPath,
} = {}) {
  const applicationRoot = resolveApplicationRoot();

  await manifestRefresher({
    applicationRoot,
    env: manifestEnv,
    importer: manifestImporter,
  });

  configureHostingerApprovalAlias({
    applicationRoot,
    env: runtimeEnv,
    nodeExecutable,
  });

  const entrypoint = resolve(applicationRoot, "server.js");
  chdir(applicationRoot);
  return importer(pathToFileURL(entrypoint).href);
}

function formatStartupError(error) {
  if (error instanceof Error) {
    return error.stack || `${error.name}: ${error.message}`;
  }
  return String(error);
}

module.exports = {
  ADMIN_SHELL_ALLOWLIST_ENV,
  CAPABILITY_APPROVAL_ALIAS,
  configureHostingerApprovalAlias,
  formatStartupError,
  parseShellAllowlist,
  refreshDeploymentManifest,
  resolveApplicationRoot,
  resolveCapabilityApprovalScriptPath,
  resolveManifestGeneratorPath,
  startApplication,
};
