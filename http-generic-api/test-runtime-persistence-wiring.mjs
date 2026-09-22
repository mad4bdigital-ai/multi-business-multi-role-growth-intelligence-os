import assert from "node:assert/strict";
import fs from "node:fs";
import { getRuntimePersistencePool } from "./db.js";
import { resolveRuntimePersistenceExecutor } from "./runtimePersistenceWriteAuthority.js";

const required = {
  RUNTIME_PERSISTENCE_DB_HOST: "127.0.0.1",
  RUNTIME_PERSISTENCE_DB_NAME: "runtime_persistence_test",
  RUNTIME_PERSISTENCE_DB_USER: "runtime_persistence_writer",
  RUNTIME_PERSISTENCE_DB_PASSWORD: "not-used-by-this-test",
};
const previous = Object.fromEntries(Object.keys(required).map((key) => [key, process.env[key]]));
for (const key of Object.keys(required)) delete process.env[key];
assert.throws(() => getRuntimePersistencePool(), (error) => error.code === "RUNTIME_PERSISTENCE_DB_CONFIG_MISSING");
Object.assign(process.env, required);
process.env.RUNTIME_PERSISTENCE_DB_PORT = "3306";
const pool = getRuntimePersistencePool();
assert.equal(typeof pool.query, "function");
assert.equal(resolveRuntimePersistenceExecutor({ runtimePersistencePool: pool }), pool);
assert.equal(resolveRuntimePersistenceExecutor({ runtimePersistencePoolFactory: () => pool }), pool);
const sentinel = { query() {} };
assert.equal(resolveRuntimePersistenceExecutor({ runtimePersistencePool: sentinel }), sentinel);
assert.throws(
  () => resolveRuntimePersistenceExecutor({ pool: sentinel }),
  (error) => error.code === "RUNTIME_PERSISTENCE_GENERIC_FALLBACK_FORBIDDEN",
);
assert.throws(
  () => resolveRuntimePersistenceExecutor({ connection: sentinel }),
  (error) => error.code === "RUNTIME_PERSISTENCE_GENERIC_FALLBACK_FORBIDDEN",
);

const dbSource = fs.readFileSync(new URL("./db.js", import.meta.url), "utf8");
const authoritySource = fs.readFileSync(new URL("./runtimePersistenceWriteAuthority.js", import.meta.url), "utf8");
const routeSource = fs.readFileSync(new URL("./routes/gptToolsRoutes.js", import.meta.url), "utf8");
const legacyRouteSource = fs.readFileSync(new URL("./routes/gptToolsRoutesLegacy.js", import.meta.url), "utf8");
const smokeSource = fs.readFileSync(new URL("./governedResponseChunkDurableRecoverySmoke.js", import.meta.url), "utf8");
const serverSource = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8");
const deploymentInfoRouteSource = fs.readFileSync(new URL("./routes/deploymentInfoRoutes.js", import.meta.url), "utf8");
assert.match(dbSource, /export function getRuntimePersistencePool\(\)/u);
assert.match(routeSource, /getPool, getRuntimePersistencePool/u);
assert.match(routeSource, /runtimePersistencePoolFactory: runtimeDeps\.runtimePersistencePoolFactory \|\| getRuntimePersistencePool/u);
assert.match(dbSource, /RUNTIME_PERSISTENCE_DB/u);
assert.match(dbSource, /\$\{prefix\}_USER/u);
assert.match(authoritySource, /getRuntimePersistencePool\(\)/u);
assert.match(routeSource, /async function dispatchTool\(callerType, toolKey, args, req, runtimeDeps = \{\}\)/u);
assert.match(routeSource, /dispatchToolImpl\(callerType, toolKey, args, req, runtimeDeps\)/u);
assert.match(routeSource, /async function dispatchToolImpl\(callerType, toolKey, args, req, runtimeDeps = \{\}\)/u);
assert.match(routeSource, /maybeChunkToolResponseBody\([\s\S]*?runtimeDeps\)/u);
assert.match(routeSource, /runtimePersistencePoolFactory: runtimeDeps\.runtimePersistencePoolFactory/u);
assert.match(legacyRouteSource, /runtimePersistencePoolFactory: runtimePersistencePoolFactory \|\| getRuntimePersistencePool/u);
assert.match(smokeSource, /const pool = deps\.runtimePersistencePool/u);
assert.match(smokeSource, /runtimePersistencePool: pool/u);
assert.doesNotMatch(smokeSource, /const pool = deps\.pool/u, "durable recovery smoke must not use generic pool fallback");
assert.match(routeSource, /const runtimeDeps = \{ runtimePersistencePoolFactory \}/u);
assert.match(routeSource, /runtimeDeps\.actAsUserAdapter = actAsUserAdapter \|\| null/u);
assert.match(routeSource, /runtimeDeps\.actAsUserAuthorityResolver = actAsUserAuthorityResolver \|\| null/u);
assert.match(routeSource, /act-as-user\/sessions/u);
assert.doesNotMatch(routeSource, /chunkPersistenceDeps/u, "module-scope dispatch must not depend on a build-local lexical variable");
assert.match(serverSource, /runtimePoolFactory: getPool/u);
assert.match(serverSource, /runtimePersistencePoolFactory: getRuntimePersistencePool/u);
assert.match(dbSource, /export function getPool\(\)/u);
assert.match(serverSource, /import \{ getPool, getRuntimePersistencePool, testConnection \} from "\.\/db\.js";/u);
assert.match(
  serverSource,
  /const runtimeDatabaseReadExecutor = Object\.freeze\(\{\s*query: \(\.\.\.args\) => getPool\(\)\.query\(\.\.\.args\),\s*\}\);/u,
  "server composition must expose a lazy query-capable Runtime DB executor",
);
assert.match(
  serverSource,
  /registerRoutes\(app, \{[\s\S]*?\.\.\.recoveryCompositionDependencies,[\s\S]*?runtimePool: runtimeDatabaseReadExecutor,[\s\S]*?runtimePersistencePoolFactory: getRuntimePersistencePool,/u,
  "deployment-info must receive Runtime DB separately from Runtime Persistence DB",
);
assert.match(
  deploymentInfoRouteSource,
  /const executor = runtimePool\s*\|\| pool\s*\|\| \(typeof runtimePoolFactory === "function"\s*\? await runtimePoolFactory\(\)\s*: null\);/u,
  "deployment-info semantic readiness must prefer an injected Runtime DB executor and fall back only to the Runtime DB factory",
);
assert.doesNotMatch(
  serverSource,
  /runtimePool:\s*getPool\(\)/u,
  "Runtime DB wiring must stay lazy and must not initialize the pool during startup",
);
assert.doesNotMatch(
  serverSource,
  /runtimePool:\s*getRuntimePersistencePool/u,
  "Runtime Persistence DB must never be substituted for the Runtime DB workspace_registry reader",
);

await pool.end();
for (const [key, value] of Object.entries(previous)) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
console.log(JSON.stringify({ ok: true, contract: "mad4b.runtime-persistence-wiring.v1", secrets_included: false }));
