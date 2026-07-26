import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./routes/outputSinkRoutes.js", import.meta.url), "utf8");

assert(source.includes('import { dispatchPlan } from "../connectorExecutor.js";'), "outputSinkRoutes must import dispatchPlan");
assert(source.includes('router.post("/execution-plans/:id/dispatch"'), "outputSinkRoutes must expose execution plan dispatch route");
assert(source.includes('apply must be boolean'), "dispatch route must validate apply as boolean");
assert(source.includes('publish_status must be draft or publish'), "dispatch route must validate publish_status");
assert(source.includes('dispatchPlan(req.params.id'), "dispatch route must call dispatchPlan with the route plan id");

console.log("execution plan dispatch route regression test passed");
