const {
  formatStartupError,
  startApplication,
} = require("./hostinger-entrypoint-runtime.js");

// Hostinger loads the configured entry file through its own Node.js wrapper.
// The runtime must therefore start whenever this entrypoint is loaded.
const startupPromise = startApplication().catch((error) => {
  console.error(
    `[hostinger-root-entrypoint] startup failed:\n${formatStartupError(error)}`
  );
  process.exitCode = 1;
});

module.exports = {
  startupPromise,
};
