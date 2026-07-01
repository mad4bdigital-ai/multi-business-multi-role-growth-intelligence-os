import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  dispatchRuntimeEndpointWithMutationGuard,
  runtimeEndpointMutationConfirmation,
} from "./runtimeEndpointMutationGuard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function passivePreview(method = "POST", riskClass = "infrastructure_mutation") {
  return {
    status: 200,
    body: {
      ok: true,
      dry_run: true,
      outbound_request_executed: false,
      method,
      risk: { risk_class: riskClass },
      runtime_readiness: { status: "ready", can_execute: true },
    },
  };
}

const future = "2099-01-01 00:00:00";
const validEnvelope = {
  envelope_id: "11111111-1111-4111-8111-111111111111",
  app_key: "github",
  capability_key: "repo_patch_apply",
  operation_intent: "repo_mutation",
  envelope_status: "ready_for_dispatch",
  dispatch_allowed: 1,
  apply_allowed: 0,
  secrets_included: 0,
  execution_status: "not_executed",
  expires_at: future,
};

const baseMutation = {
  parent_action_key: "github_api_mcp",
  endpoint_key: "github_dispatch_workflow",
  path_params: { owner: "mad4bdigital-ai", repo: "growth-os", workflow_id: "ci.yml" },
  body: { ref: "gpt/example" },
  mutation_approval: {
    approved: true,
    capability_envelope_id: validEnvelope.envelope_id,
    typed_confirmation: "EXECUTE_RUNTIME_ENDPOINT_GITHUB_DISPATCH_WORKFLOW",
    app_key: "github",
    capability_key: "repo_patch_apply",
    operation_intent: "repo_mutation",
  },
  dry_run_preflight_completed: true,
  approved_preflight_dry_run_validated: true,
  live_execution_approved: true,
  readback: { required: true, expected_workflow: "ci.yml", expected_ref: "gpt/example" },
};

assert.equal(
  runtimeEndpointMutationConfirmation("github_dispatch_workflow"),
  "EXECUTE_RUNTIME_ENDPOINT_GITHUB_DISPATCH_WORKFLOW"
);

{
  const calls = [];
  const result = await dispatchRuntimeEndpointWithMutationGuard({
    parent_action_key: "github_api_mcp",
    endpoint_key: "github_get_repository",
    path_params: { owner: "mad4bdigital-ai", repo: "growth-os" },
  }, {
    dispatch: async (payload) => {
      calls.push(payload);
      return payload.dry_run
        ? passivePreview("GET", "read_only")
        : { status: 200, body: { ok: true, data: { full_name: "mad4bdigital-ai/growth-os" } } };
    },
  });
  assert.equal(result.body.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].dry_run, true);
  assert.equal(calls[0].preflight_only, true);
  assert.equal(calls[1].dry_run, false);
}

{
  const calls = [];
  await assert.rejects(
    dispatchRuntimeEndpointWithMutationGuard({ ...baseMutation, mutation_approval: {} }, {
      dispatch: async (payload) => {
        calls.push(payload);
        return passivePreview();
      },
    }),
    (error) => error?.code === "runtime_endpoint_mutation_approval_required" && error?.status === 403
  );
  assert.equal(calls.length, 1, "missing approval must block before live dispatch");
}

{
  const calls = [];
  await assert.rejects(
    dispatchRuntimeEndpointWithMutationGuard({
      ...baseMutation,
      mutation_approval: { ...baseMutation.mutation_approval, typed_confirmation: "WRONG" },
    }, {
      dispatch: async (payload) => {
        calls.push(payload);
        return passivePreview();
      },
    }),
    (error) => error?.code === "runtime_endpoint_mutation_confirmation_required"
  );
  assert.equal(calls.length, 1, "invalid typed confirmation must block before live dispatch");
}

{
  const calls = [];
  await assert.rejects(
    dispatchRuntimeEndpointWithMutationGuard({ ...baseMutation, readback: { required: true } }, {
      dispatch: async (payload) => {
        calls.push(payload);
        return passivePreview();
      },
    }),
    (error) => error?.code === "runtime_endpoint_mutation_readback_contract_required"
  );
  assert.equal(calls.length, 1, "missing concrete readback must block before live dispatch");
}

{
  const calls = [];
  await assert.rejects(
    dispatchRuntimeEndpointWithMutationGuard(baseMutation, {
      dispatch: async (payload) => {
        calls.push(payload);
        return passivePreview();
      },
      loadEnvelope: async () => ({ ...validEnvelope, envelope_status: "blocked", dispatch_allowed: 0 }),
    }),
    (error) => error?.code === "runtime_endpoint_mutation_envelope_not_ready"
  );
  assert.equal(calls.length, 1, "invalid envelope must block before live dispatch");
}

{
  const calls = [];
  const result = await dispatchRuntimeEndpointWithMutationGuard(baseMutation, {
    dispatch: async (payload) => {
      calls.push(payload);
      return payload.dry_run ? passivePreview() : { status: 200, body: { ok: true, status: 204 } };
    },
    loadEnvelope: async () => validEnvelope,
  });
  assert.equal(result.body.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].dry_run, true);
  assert.equal(calls[0].live_execution_approved, false);
  assert.equal(calls[1].dry_run, false);
  assert.equal(calls[1].preflight_only, false);
}

{
  const calls = [];
  const result = await dispatchRuntimeEndpointWithMutationGuard({ ...baseMutation, preflight_only: true }, {
    dispatch: async (payload) => {
      calls.push(payload);
      return passivePreview();
    },
  });
  assert.equal(result.body.dry_run, true);
  assert.equal(calls.length, 1);
}

const routes = fs.readFileSync(path.join(__dirname, "routes", "systemLayerRoutes.js"), "utf8");
assert.ok(routes.includes("dispatchRuntimeEndpointWithMutationGuard"));
assert.ok(routes.includes("dispatch: (candidate) => callRuntimeEndpointViaFacade(candidate, deps)"));

const migration = fs.readFileSync(
  path.join(__dirname, "migrations", "20260701_runtime_endpoint_mutation_guard_and_github_workflow_dispatch.sql"),
  "utf8"
);
for (const token of [
  "github_dispatch_workflow",
  "github_list_workflow_runs",
  "/actions/workflows/{workflow_id}/dispatches",
  "github_workflow_dispatch_run_readback_v1",
  "runtime_endpoint_mutation_guard_v1",
  "EXECUTE_RUNTIME_ENDPOINT_<ENDPOINT_KEY>",
]) {
  assert.ok(migration.includes(token), `migration missing ${token}`);
}
assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/i);

console.log("runtime endpoint mutation guard tests passed");
