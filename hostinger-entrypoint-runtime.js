const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  bootstrapRuntimeAuthSecrets,
} = require("./runtime-auth-secret-bootstrap.js");

const repositoryRoot = __dirname;

function resolveApplicationRoot() {
  return resolve(repositoryRoot, "http-generic-api");
}

async function startApplication({
  chdir = process.chdir,
  importer = (specifier) => import(specifier),
  env = process.env,
} = {}) {
  const authSecretBootstrap = bootstrapRuntimeAuthSecrets(env);
  if (!authSecretBootstrap.configured && String(env.NODE_ENV || "").trim().toLowerCase() === "production") {
    const error = new Error(
      "Production auth startup requires JWT_SECRET, USER_JWT_SECRET, AUTH_JWT_SECRET, or BACKEND_API_KEY."
    );
    error.code = "AUTH_SECRET_CONFIGURATION_MISSING";
    throw error;
  }

  const applicationRoot = resolveApplicationRoot();
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
  resolveApplicationRoot,
  startApplication,
};
