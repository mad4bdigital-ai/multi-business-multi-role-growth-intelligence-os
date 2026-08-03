const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const repositoryRoot = __dirname;

function resolveApplicationRoot() {
  return resolve(repositoryRoot, "http-generic-api");
}

function resolveManifestGeneratorPath(applicationRoot = resolveApplicationRoot()) {
  return resolve(applicationRoot, "scripts", "generate-deployment-manifest.mjs");
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

  return generatorModule.generateDeploymentManifest({
    env,
    argv: ["--branch=Production"],
    outputPath: resolve(applicationRoot, "deployment-manifest.json"),
  });
}

async function startApplication({
  chdir = process.chdir,
  importer = (specifier) => import(specifier),
  manifestRefresher = refreshDeploymentManifest,
  manifestEnv = process.env,
  manifestImporter = (specifier) => import(specifier),
} = {}) {
  const applicationRoot = resolveApplicationRoot();

  await manifestRefresher({
    applicationRoot,
    env: manifestEnv,
    importer: manifestImporter,
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
  formatStartupError,
  refreshDeploymentManifest,
  resolveApplicationRoot,
  resolveManifestGeneratorPath,
  startApplication,
};
