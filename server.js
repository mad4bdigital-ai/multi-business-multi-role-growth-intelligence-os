const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const repositoryRoot = __dirname;

function resolveApplicationRoot() {
  return resolve(repositoryRoot, "http-generic-api");
}

async function startApplication({
  chdir = process.chdir,
  importer = (specifier) => import(specifier),
} = {}) {
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

// Hostinger loads the configured entry file through its own Node.js wrapper.
// In that environment `require.main === module` is not guaranteed, so startup
// must occur whenever this entrypoint is loaded.
const startupPromise = startApplication().catch((error) => {
  console.error(
    `[hostinger-root-entrypoint] startup failed:\n${formatStartupError(error)}`
  );
  process.exitCode = 1;
});

module.exports = {
  formatStartupError,
  resolveApplicationRoot,
  startApplication,
  startupPromise,
};
