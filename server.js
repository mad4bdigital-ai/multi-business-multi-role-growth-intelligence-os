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

if (require.main === module) {
  startApplication().catch((error) => {
    console.error("[hostinger-root-entrypoint] startup failed:", error?.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  resolveApplicationRoot,
  startApplication,
};
