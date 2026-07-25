import assert from "node:assert/strict";
// frontend-surface-operation: POST /ai/implementation-plan
// frontend-external-effect-proof: POST /ai/implementation-plan
// frontend-surface-operation: POST /ai/task-manifest
// frontend-external-effect-proof: POST /ai/task-manifest
import { generateImplementationPlan } from "./services/planningResolver.js";
import { generateTaskManifest } from "./services/taskResolver.js";
import { resolveAiIntentMaturation } from "./services/intentMaturationResolver.js";
import { buildAiResolverRoutes } from "./routes/aiResolverRoutes.js";

function createMockFetch() {
  const calls = [];

  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const body = JSON.parse(options.body);
    const prompt = body.messages[1].content;

    if (prompt.includes("Build a simple notification system")) {
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: "# Implementation Plan\n\n## Goal Description\nBuild a basic notification queue.\n\n## Proposed Changes\n- [NEW] notificationQueue.js\n- [MODIFY] server.js"
            }
          }],
          usage: { total_tokens: 150 }
        })
      };
    }

    if (prompt.includes("Here is the Implementation Plan")) {
      return {
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: "- [ ] Create notificationQueue.js file\n- [ ] Implement queue logic\n- [ ] Inject into server.js execution facade\n- [ ] Test the integration"
            }
          }],
          usage: { total_tokens: 80 }
        })
      };
    }

    return { ok: false, status: 400, text: async () => "Unknown prompt" };
  };

  fetchImpl.calls = calls;
  return fetchImpl;
}

async function invokeRoute(router, path, body = {}) {
  const layer = router.stack.find(item => item.route?.path === path);
  assert.ok(layer, `route ${path} is registered`);

  const stack = layer.route.stack.map(item => item.handle);
  let statusCode = 200;
  let jsonBody;
  const req = { body };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      jsonBody = value;
      return this;
    }
  };

  let idx = 0;
  const next = async (err) => {
    if (err) throw err;
    const handler = stack[++idx];
    if (handler) {
      await handler(req, res, next);
    }
  };

  await stack[0](req, res, next);
  return { statusCode, body: jsonBody };
}

const fetchImpl = createMockFetch();

const planResult = await generateImplementationPlan({
  userPrompt: "Build a simple notification system",
  apiKey: "mock-key-123",
  fetchImpl
});

assert.match(planResult.planMarkdown, /Implementation Plan/);
assert.equal(planResult.usage.total_tokens, 150);
assert.equal(planResult.provider_interaction, "model_inference");
assert.equal(planResult.provider_write_performed, false);
assert.equal(planResult.tools_executed, false);
assert.equal(planResult.secrets_included, false);

const taskResult = await generateTaskManifest({
  implementationPlan: planResult.planMarkdown,
  systemContext: "intent_key: ai_task_manifest_generation",
  apiKey: "mock-key-123",
  fetchImpl
});

assert.match(taskResult.taskMarkdown, /Create notificationQueue/);
assert.equal(taskResult.usage.total_tokens, 80);
assert.equal(taskResult.provider_interaction, "model_inference");
assert.equal(taskResult.provider_write_performed, false);
assert.equal(taskResult.tools_executed, false);
assert.equal(taskResult.secrets_included, false);
assert.equal(fetchImpl.calls.length, 2);
assert(fetchImpl.calls.every((call) => call.url === "https://api.openai.com/v1/chat/completions"));
assert(fetchImpl.calls.every((call) => call.options.method === "POST"));
assert(fetchImpl.calls.every((call) => {
  const payload = JSON.parse(call.options.body);
  return payload.tools === undefined && payload.tool_choice === undefined;
}));

await assert.rejects(
  () => generateImplementationPlan({ userPrompt: "", apiKey: "mock-key-123", fetchImpl }),
  /userPrompt is required/
);

await assert.rejects(
  () => generateTaskManifest({ implementationPlan: "", apiKey: "mock-key-123", fetchImpl }),
  /implementationPlan is required/
);

const router = buildAiResolverRoutes({
  requireBackendApiKey: (_req, _res, next) => next(),
  generateImplementationPlan,
  generateTaskManifest
});

assert.ok(router.stack.some(layer => layer.route?.path === "/ai/implementation-plan"));
assert.ok(router.stack.some(layer => layer.route?.path === "/ai/task-manifest"));

const intent = resolveAiIntentMaturation({
  intent_key: "ai_custom_plan_generation",
  route_id: "route_ai_plan",
  workflow_id: "wf_ai_plan"
});

assert.equal(intent.maturation_status, "matured");
assert.equal(intent.intent_key, "ai_custom_plan_generation");
assert.equal(intent.execution_intent.route_selection_mode, "first_class_intent");
assert.equal(intent.route_workflow_state.route_id, "route_ai_plan");

const routeCalls = [];
const routeRouter = buildAiResolverRoutes({
  requireBackendApiKey: (_req, _res, next) => next(),
  async generateImplementationPlan(input) {
    routeCalls.push({ type: "plan", input });
    return { planMarkdown: "# Route Plan", usage: { total_tokens: 12 } };
  },
  async generateTaskManifest(input) {
    routeCalls.push({ type: "task", input });
    return { taskMarkdown: "- [ ] Route task", usage: { total_tokens: 7 } };
  }
});

const planRoute = await invokeRoute(routeRouter, "/ai/implementation-plan", {
  userPrompt: "Build a simple notification system",
  intent_key: "ai_custom_plan_generation",
  route_id: "route_ai_plan",
  workflow_id: "wf_ai_plan"
});

assert.equal(planRoute.statusCode, 200);
assert.equal(planRoute.body.intent_maturation.intent_key, "ai_custom_plan_generation");
assert.match(routeCalls[0].input.systemContext, /First-class intent maturation context/);
assert.match(routeCalls[0].input.systemContext, /route_ai_plan/);

const taskRoute = await invokeRoute(routeRouter, "/ai/task-manifest", {
  implementationPlan: "# Route Plan",
  intent_key: "ai_task_manifest_generation",
  intent_maturation: planRoute.body.intent_maturation
});

assert.equal(taskRoute.statusCode, 200);
assert.equal(taskRoute.body.intent_maturation.intent_key, "ai_task_manifest_generation");
assert.equal(taskRoute.body.intent_maturation.upstream_intent_key, "ai_custom_plan_generation");
assert.equal(taskRoute.body.intent_maturation.route_workflow_state.route_id, "route_ai_plan");
assert.equal(taskRoute.body.intent_maturation.route_workflow_state.workflow_id, "wf_ai_plan");
assert.match(routeCalls[1].input.systemContext, /route_ai_plan/);

console.log("AI resolver tests passed");
