import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const adminCliRoutes = readFileSync("routes/adminCliRoutes.js", "utf8");

assert(adminCliRoutes.includes('resource === "workflow" && command === "run"'), "GitHub REST fallback must support gh workflow run");
assert(adminCliRoutes.includes('workflow run fallback requires a workflow file name or workflow id'), "workflow run fallback must validate workflow id");
assert(adminCliRoutes.includes('/actions/workflows/${encodeURIComponent(workflowId)}/dispatches'), "workflow run fallback must call workflow dispatches REST endpoint");
assert(adminCliRoutes.includes('body: { ref, ...(Object.keys(inputs).length ? { inputs } : {}) }'), "workflow run fallback must send ref and optional inputs");
assert(adminCliRoutes.includes('dispatched: true'), "workflow run fallback must return dispatched readback");

assert(adminCliRoutes.includes('if (apiTarget.startsWith(`/${repoPrefix}`))'), "GitHub API fallback must normalize slash-prefixed repo targets");
assert(adminCliRoutes.includes('if (apiTarget.startsWith(repoPrefix))'), "GitHub API fallback must normalize repo-prefixed targets");
assert(adminCliRoutes.includes('/^\\/actions\\/workflows\\/[^/]+\\/dispatches$/.test(apiTarget)'), "GitHub API fallback must allow workflow dispatch mutation path");
assert(adminCliRoutes.includes('workflow dispatches'), "Unsupported-path error should mention workflow dispatches");
assert(adminCliRoutes.includes('api <workflow-dispatch-path> -X POST -f ref=<ref>'), "Unsupported-args error should mention gh api workflow dispatch fallback");

console.log("GitHub workflow dispatch fallback tests passed");
