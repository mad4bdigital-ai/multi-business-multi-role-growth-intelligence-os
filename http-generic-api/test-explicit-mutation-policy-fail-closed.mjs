import assert from "node:assert/strict";
import {
  classifyMutationPolicyRequirement,
  hasDeclaredMutationPolicy,
  evaluateRepositoryMutationPreflight,
  evaluateRepoPatchApplyPreflight,
  evaluateGptToolDispatchPreflight,
  evaluateAppActionPreflight,
  evaluateConnectorDispatchPreflight,
} from "./governedExecutionPreflight.js";
import { resolveAppActionMutationRequirement } from "./appAdapters/index.js";

const emptyPolicyDeps = {
  skipSurfaceAuthority: true,
  pool: {
    async query(sql) {
      const text = String(sql || "");
      if (text.includes("FROM `execution_policies`")) return [[]];
      if (text.includes("FROM platform_engine_policy_rules")) return [[]];
      throw new Error(`Unexpected SQL in empty policy test: ${text.slice(0, 120)}`);
    },
  },
};

assert.deepEqual(classifyMutationPolicyRequirement({ method: "GET" }), { required: false, classification: "read_only_http_method" });
assert.deepEqual(classifyMutationPolicyRequirement({ method: "POST", tags: ["read_only"] }), { required: false, classification: "read_only_tag" });
assert.deepEqual(classifyMutationPolicyRequirement({ method: "POST", tags: ["mutation"] }), { required: true, classification: "mutation_tag" });
assert.equal(hasDeclaredMutationPolicy({ tags: ["mutation", "capability_envelope", "readback"] }), true);
assert.equal(hasDeclaredMutationPolicy({ tags: ["mutation"] }), false);

const repositoryMutation = await evaluateRepositoryMutationPreflight({ operation: "github_pr_merge" }, emptyPolicyDeps);
assert.equal(repositoryMutation.ok, false);
assert.deepEqual(repositoryMutation.errors, ["mutation_policy_required"]);
assert.equal(repositoryMutation.evidence.reason, "repository_mutation_policy_not_configured");

const repoPatch = await evaluateRepoPatchApplyPreflight({ branch: "gpt/example" }, emptyPolicyDeps);
assert.equal(repoPatch.ok, false);
assert.deepEqual(repoPatch.errors, ["mutation_policy_required"]);

const readOnlyTool = await evaluateGptToolDispatchPreflight({ callerType: "tenant", toolKey: "read_status", method: "GET", tags: ["read_only"] }, emptyPolicyDeps);
assert.equal(readOnlyTool.ok, true);
assert.equal(readOnlyTool.classification, "allow");

const undeclaredMutationTool = await evaluateGptToolDispatchPreflight({ callerType: "admin", toolKey: "unsafe_write", method: "POST", tags: ["mutation"] }, emptyPolicyDeps);
assert.equal(undeclaredMutationTool.ok, false);
assert.deepEqual(undeclaredMutationTool.errors, ["mutation_policy_required"]);

const declaredMutationTool = await evaluateGptToolDispatchPreflight({ callerType: "admin", toolKey: "governed_write", method: "VIRTUAL", tags: ["mutation", "capability_envelope", "readback"] }, emptyPolicyDeps);
assert.equal(declaredMutationTool.ok, true);
assert.equal(declaredMutationTool.classification, "allow_with_declared_mutation_policy");

const unclassifiedTool = await evaluateGptToolDispatchPreflight({ callerType: "admin", toolKey: "unknown_classification" }, emptyPolicyDeps);
assert.equal(unclassifiedTool.ok, false);
assert.deepEqual(unclassifiedTool.errors, ["mutation_classification_required"]);

const readOnlyApp = await evaluateAppActionPreflight({ appKey: "github", actionKey: "read_file", mutationRequired: false }, emptyPolicyDeps);
assert.equal(readOnlyApp.ok, true);
const mutatingApp = await evaluateAppActionPreflight({ appKey: "github", actionKey: "write_file", mutationRequired: true }, emptyPolicyDeps);
assert.equal(mutatingApp.ok, false);
assert.deepEqual(mutatingApp.errors, ["mutation_policy_required"]);
const unclassifiedApp = await evaluateAppActionPreflight({ appKey: "future_app", actionKey: "future_action", mutationRequired: null }, emptyPolicyDeps);
assert.equal(unclassifiedApp.ok, false);
assert.deepEqual(unclassifiedApp.errors, ["mutation_classification_required"]);

const connectorPreview = await evaluateConnectorDispatchPreflight({ connectorType: "wordpress", apply: false }, emptyPolicyDeps);
assert.equal(connectorPreview.ok, true);
const connectorApply = await evaluateConnectorDispatchPreflight({ connectorType: "wordpress", apply: true }, emptyPolicyDeps);
assert.equal(connectorApply.ok, false);
assert.deepEqual(connectorApply.errors, ["mutation_policy_required"]);

assert.equal(resolveAppActionMutationRequirement("github", "read_file", {}), false);
assert.equal(resolveAppActionMutationRequirement("github", "write_file", {}), true);
assert.equal(resolveAppActionMutationRequirement("api_key", "call_api", { method: "GET" }), false);
assert.equal(resolveAppActionMutationRequirement("api_key", "call_api", { method: "PATCH" }), true);
assert.equal(resolveAppActionMutationRequirement("webhook", "call_webhook", {}), true);
assert.equal(resolveAppActionMutationRequirement("future_app", "future_action", {}), null);
const classifiedAppActions = {
  google_drive: { list_files: false, read_file: false, search_files: false, write_file: true, create_folder: true },
  notion: { read_page: false, list_databases: false, query_database: false, search: false, create_page: true, update_page: true },
  github: { list_repos: false, read_file: false, list_issues: false, write_file: true, create_issue: true, create_pr: true },
  slack: { list_channels: false, read_channel: false, list_users: false, send_message: true, upload_file: true },
  mcp: { tools_list: false, tools_call: true },
  makecom: { list_scenarios: false, get_scenario: false, trigger_webhook: true, run_scenario: true },
  n8n: { list_workflows: false, get_workflow: false, list_executions: false, trigger_webhook: true, execute_workflow: true },
  makecom_mcp: { mcp_initialize: false, mcp_tools_list: false, mcp_tools_call: true },
  wordpress_rest: {
    "wordpress_rest.validate_connection": false,
    "wordpress_rest.get_current_user": false,
    "wordpress_rest.read_users": false,
  },
};
for (const [appKey, actions] of Object.entries(classifiedAppActions)) {
  for (const [actionKey, expected] of Object.entries(actions)) {
    assert.equal(resolveAppActionMutationRequirement(appKey, actionKey, {}), expected, `${appKey}.${actionKey} must remain explicitly classified`);
  }
}

const gptToolsSource = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("./routes/gptToolsRoutes.js", import.meta.url), "utf8"));
assert.match(gptToolsSource, /resolveToolPreflightDescriptor/);
assert.match(gptToolsSource, /method: descriptor\.method/);
assert.match(gptToolsSource, /tags: descriptor\.tags/);
const appAdapterSource = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("./appAdapters/index.js", import.meta.url), "utf8"));
assert.match(appAdapterSource, /resolveAppActionMutationRequirement\(connection\.app_key, action_key, args\)/);
assert.match(appAdapterSource, /mutationRequired,/);

console.log("explicit mutation policy fail-closed tests passed");