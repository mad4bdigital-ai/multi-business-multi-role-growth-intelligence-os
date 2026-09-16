import assert from "node:assert/strict";
import {
  catalogGovernedResources,
  planGovernedResource,
  resolveGovernedResource,
} from "./platformResourceRecipeCapability.js";

const recipe = {
  recipe_key: "staging.activation_gateway.plan_fixture",
  resource_type: "cloudflare_worker",
  operation_key: "activation_gateway.staging_plan_fixture",
  adapter_key: "staging_activation_gateway_profile_apply",
  risk_class: "read",
  mode: "plan",
  read_only: 1,
  requires_dry_run: 1,
  requires_capability_envelope: 0,
  requires_typed_confirmation: 0,
  requires_same_cycle_readback: 0,
  authority_requirement_key: null,
  graph_write_policy: "none",
  engine_key: null,
  status: "active",
  input_schema_json: null,
  output_schema_json: null,
  policy_json: null,
  notes: "governance pool regression fixture",
};
const step = {
  step_order: 1,
  step_key: "inspect",
  step_kind: "db_read",
  parent_action_key: null,
  endpoint_key: null,
  tool_key: null,
  source_table: "runtime_deployment_manifest",
  source_pk_template_json: null,
  query_template_json: null,
  body_template_json: null,
  response_projection_json: null,
  required: 1,
  on_error_policy: "fail_closed",
  status: "active",
};

const governanceSql = [];
const runtimeSql = [];
const governancePool = {
  async query(sql, params = []) {
    governanceSql.push(String(sql));
    if (String(sql).includes("platform_resource_recipe_steps")) return [[step], []];
    if (String(sql).includes("platform_resource_recipes")) return [[recipe], []];
    throw new Error(`unexpected governance query: ${sql} :: ${JSON.stringify(params)}`);
  },
};
const runtimePool = {
  async query(sql, params = []) {
    const text = String(sql);
    runtimeSql.push(text);
    assert.equal(text.includes("platform_resource_recipes"), false, "runtime pool must not read platform_resource_recipes");
    assert.equal(text.includes("platform_resource_recipe_steps"), false, "runtime pool must not read platform_resource_recipe_steps");
    if (text.includes("platform_resource_types")) {
      return [[{
        resource_type: "cloudflare_worker",
        resource_family: "provider_resource",
        provider_key: "cloudflare",
        display_name: "Cloudflare Worker",
      }], []];
    }
    if (text.includes("platform_resource_adapters")) {
      return [[{
        adapter_key: "staging_activation_gateway_profile_apply",
        adapter_kind: "server_governed",
        installed_tool_key: null,
      }], []];
    }
    throw new Error(`unexpected runtime query: ${sql} :: ${JSON.stringify(params)}`);
  },
};
const deps = { governancePool, runtimePool };
const resource_ref = { resource_uri: "cloudflare_worker://staging/activation-gateway" };

const resolved = await resolveGovernedResource({ recipe_key: recipe.recipe_key, resource_type: recipe.resource_type, resource_ref }, deps);
assert.equal(resolved.ok, true);
assert.equal(resolved.recipe_hint.provider_key, "cloudflare");

const catalog = await catalogGovernedResources({ resource_type: recipe.resource_type, include_steps: true }, deps);
assert.equal(catalog.ok, true);
assert.equal(catalog.count, 1);
assert.equal(catalog.recipes[0].adapter_kind, "server_governed");
assert.equal(catalog.steps_by_recipe[recipe.recipe_key][0].step_key, "inspect");

const plan = await planGovernedResource({ recipe_key: recipe.recipe_key, resource_ref, dry_run: true }, deps);
assert.equal(plan.ok, true);
assert.equal(plan.tool, "governed_resource_plan");
assert.equal(plan.recipe.provider_key, "cloudflare");
assert.equal(plan.execution_plan.steps[0].step_key, "inspect");
assert.equal(plan.provider_calls_made, 0);
assert.equal(plan.execution_allowed, false);

assert.equal(governanceSql.some((sql) => sql.includes("platform_resource_recipes")), true);
assert.equal(governanceSql.some((sql) => sql.includes("platform_resource_recipe_steps")), true);
assert.equal(runtimeSql.some((sql) => sql.includes("platform_resource_types")), true);
assert.equal(runtimeSql.some((sql) => sql.includes("platform_resource_adapters")), true);
console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.platform-resource-recipe-governance-read-routing.v1",
  runtime_recipe_reads: 0,
  runtime_step_reads: 0,
  governance_recipe_reads: governanceSql.filter((sql) => sql.includes("platform_resource_recipes")).length,
  governance_step_reads: governanceSql.filter((sql) => sql.includes("platform_resource_recipe_steps")).length,
  provider_calls_made: 0,
  mutations_executed: false,
  secrets_included: false,
}));
