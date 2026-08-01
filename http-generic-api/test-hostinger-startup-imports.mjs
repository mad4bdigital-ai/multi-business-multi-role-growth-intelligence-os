import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function checkSyntax(relativePath) {
  const absolutePath = join(__dirname, relativePath);
  const result = spawnSync(process.execPath, ["--check", absolutePath], {
    encoding: "utf8"
  });

  assert.equal(
    result.status,
    0,
    `${relativePath} must pass node --check.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`
  );
}

async function importModule(relativePath) {
  const absolutePath = join(__dirname, relativePath);
  await import(pathToFileURL(absolutePath).href);
}

const syntaxOnlyFiles = [
  "server.js",
  "routes/activationRoutes.js",
  "routes/gptSessionRoutes.js",
  "routes/devAgentRoutes.js",
  "sessionSummaryService.js",
  "agentModelRuntimeSettings.js",
  "n8nWorkflowRuntime.js",
  "routes/n8nWorkflowRuntimeRoutes.js",
  "devAgentRunner.js"
];

for (const file of syntaxOnlyFiles) {
  checkSyntax(file);
}

const serverSource = readFileSync(join(__dirname, "server.js"), "utf8");
assert(
  serverSource.includes("getAgentDeps, getCallModelForClass") ||
    serverSource.includes("getCallModelForClass, getAgentDeps"),
  "server.js must import agent model dependency wiring"
);
assert(
  serverSource.includes("getCallModelForClass,") && serverSource.includes("callModel: getAgentDeps().callModel"),
  "server.js must pass model deps into registerRoutes for dev-agent/session-summary routes"
);
assert(
  serverSource.includes("getCallModelForTaskAsync"),
  "server.js must pass task-specific model deps into registerRoutes"
);
assert(
  serverSource.includes("resolveAgentModelProvider"),
  "server.js must pass the effective model provider resolver into routes"
);
assert.equal(
  (serverSource.match(/app\.use\(createOperationRuntimeGuard\(\)\)/g) || []).length,
  1,
  "server.js must mount the operation runtime guard exactly once"
);
assert.equal(
  (serverSource.match(/app\.use\(createOperationRuntimeErrorHandler\(\)\)/g) || []).length,
  1,
  "server.js must mount the operation runtime error handler exactly once"
);

const devAgentRoutesSource = readFileSync(join(__dirname, "routes/devAgentRoutes.js"), "utf8");
assert(
  devAgentRoutesSource.includes('/dev-agent/model-readiness'),
  "dev agent model readiness diagnostic route must stay registered"
);
assert(
  devAgentRoutesSource.includes('/dev-agent/model-settings'),
  "dev agent governed model settings routes must stay registered"
);
const routesIndexSource = readFileSync(join(__dirname, "routes/index.js"), "utf8");
assert(
  routesIndexSource.includes("buildN8nWorkflowRuntimeRoutes"),
  "n8n workflow runtime routes must stay mounted"
);
assert.equal(
  (routesIndexSource.match(/buildBackupArtifactRoutes\(deps\)/g) || []).length,
  1,
  "backup artifact routes must be mounted exactly once"
);
assert.equal(
  (routesIndexSource.match(/buildRegistryDataManagementRoutes\(\{ \.\.\.deps, requireAdminPrincipal \}\)/g) || []).length,
  1,
  "registry data management routes must be mounted exactly once with admin and tenant guards"
);
assert.equal(
  routesIndexSource.includes("createOperationRuntimeGuard"),
  false,
  "operation runtime guard must be mounted only by server.js"
);
assert.equal(
  routesIndexSource.includes("createOperationRuntimeErrorHandler"),
  false,
  "operation runtime error handler must be mounted only by server.js"
);

const rootEntrypointSource = readFileSync(join(__dirname, "..", "server.js"), "utf8");
const rootRuntimeSource = readFileSync(
  join(__dirname, "..", "hostinger-entrypoint-runtime.js"),
  "utf8"
);
assert(
  rootRuntimeSource.includes("error.stack"),
  "root Hostinger runtime helpers must preserve startup stack traces"
);
assert.equal(
  /^\s*if\s*\(\s*require\.main\s*===\s*module\s*\)/m.test(rootEntrypointSource),
  false,
  "root Hostinger entrypoint must not depend on require.main detection"
);
assert(
  rootEntrypointSource.includes("const startupPromise = startApplication()"),
  "root Hostinger entrypoint must start when loaded by the platform wrapper"
);
assert(
  rootEntrypointSource.includes('require("./hostinger-entrypoint-runtime.js")'),
  "root Hostinger entrypoint must use the side-effect-free runtime helper module"
);
assert.equal(
  /const\s+startupPromise\s*=\s*startApplication\s*\(/.test(rootRuntimeSource),
  false,
  "Hostinger runtime helper imports must not launch the real server"
);

const modelReadinessMigration = readFileSync(
  join(__dirname, "migrations/114_sprint62y_register_model_readiness_tool.sql"),
  "utf8"
);
assert(
  modelReadinessMigration.includes("dev_agent_model_readiness"),
  "model readiness admin tool must stay registered through migration"
);

await importModule("sessionSummaryService.js");
await importModule("agentModelRuntimeSettings.js");
await importModule("routes/activationRoutes.js");
await importModule("routes/gptSessionRoutes.js");
await importModule("routes/devAgentRoutes.js");
await importModule("routes/index.js");
await importModule("devAgentRunner.js");

console.log("✓ Hostinger startup import guard passed");
