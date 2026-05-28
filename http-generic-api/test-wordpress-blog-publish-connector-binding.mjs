import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./connectorExecutor.js", import.meta.url), "utf8");

assert(
  source.includes("dispatchWordpressBlogPublish"),
  "connectorExecutor must import/use dispatchWordpressBlogPublish"
);

assert(
  source.includes("isWordpressBlogPublishWorkflow(plan.workflow_key)"),
  "connectorExecutor must classify the blog publish workflow as WordPress-routed"
);

assert(
  source.includes("result = await dispatchWordpressBlogPublish(plan, { ...deps, brand });"),
  "connectorExecutor must dispatch the blog publish workflow through the dedicated orchestrator"
);

console.log("wordpress blog publish connector binding test passed");
