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

const dbSource = fs.readFileSync(new URL("./db.js", import.meta.url), "utf8");
const authoritySource = fs.readFileSync(new URL("./runtimePersistenceWriteAuthority.js", import.meta.url), "utf8");
const routeSource = fs.readFileSync(new URL("./routes/gptToolsRoutes.js", import.meta.url), "utf8");
const serverSource = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8");
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
assert.match(routeSource, /const runtimeDeps = \{ runtimePersistencePoolFactory \}/u);
assert.doesNotMatch(routeSource, /chunkPersistenceDeps/u, "module-scope dispatch must not depend on a build-local lexical variable");
assert.match(serverSource, /runtimePersistencePoolFactory: getRuntimePersistencePool/u);

await pool.end();
for (const [key, value] of Object.entries(previous)) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
console.log(JSON.stringify({ ok: true, contract: "mad4b.runtime-persistence-wiring.v1", secrets_included: false }));
