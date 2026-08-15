import assert from "node:assert/strict";
import { createGptExecutionCapsule } from "./routes/gptToolsRoutes.js";

const capsule = createGptExecutionCapsule({ operation_key: "repo.change.execute" });
assert.equal(capsule.contract, "gpt.execution_capsule.v1");
assert.equal(capsule.operation_key, "repo.change.execute");
assert.equal(capsule.secrets_included, false);
assert.equal(capsule.manifest_schema_promise, null);
assert.equal(capsule.descriptor_cache instanceof Map, true);
assert.equal(capsule.metrics.manifest_schema_loads, 0);
assert.equal(capsule.metrics.descriptor_resolutions, 0);

const descriptor = Object.freeze({ method: "POST", tags: ["repository"], inputSchema: { type: "object" } });
capsule.descriptor_cache.set("tenant:repo.change.execute", descriptor);
assert.deepEqual(capsule.descriptor_cache.get("tenant:repo.change.execute"), descriptor);
assert.equal(capsule.metrics.duplicate_schema_queries, 0);

console.log("GPT execution capsule contract tests passed");
