import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [
  routes,
  resolver,
  migration,
  runner,
  brandReferenceTest,
  brandWorkspaceTest,
  platformResourceTest,
  brandWorkspaceDocs,
] = await Promise.all([
  readFile(new URL("./routes/systemLayerRoutes.js", import.meta.url), "utf8"),
  readFile(new URL("./platformResourceContextResolver.js", import.meta.url), "utf8"),
  readFile(new URL("./migrations/1030_sprint69_generic_platform_resource_context.sql", import.meta.url), "utf8"),
  readFile(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8"),
  readFile(new URL("./test-brand-reference-resolver.mjs", import.meta.url), "utf8"),
  readFile(new URL("./test-brand-workspace-context-resolver.mjs", import.meta.url), "utf8"),
  readFile(new URL("./test-platform-resource-context-resolver.mjs", import.meta.url), "utf8"),
  readFile(new URL("../docs/dynamic-brand-workspace-context.md", import.meta.url), "utf8"),
]);

for (const expected of [
  'from "../platformResourceContextResolver.js"',
  "...PLATFORM_RESOURCE_CONTEXT_SYSTEM_TOOLS",
  'source_key: "platform_resource_context_v1"',
  'readiness_tool: "platform_resource_context_readiness_smoke"',
]) {
  assert(routes.includes(expected), expected);
}

for (const expected of [
  'name: "platform_resource_context_resolve"',
  'name: "platform_resource_context_catalog"',
  'name: "platform_resource_context_related"',
  'name: "platform_resource_context_diagnostic_handoff"',
  'name: "platform_resource_context_readiness_smoke"',
  "export async function platformResourceContextResolve",
  "export async function platformResourceContextCatalog",
  "export async function platformResourceContextRelated",
  "export async function platformResourceContextDiagnosticHandoff",
  "export async function platformResourceContextReadinessSmoke",
  'skill_key: "resource_reference_interpreter_v1"',
  'connectivity_status: "not_checked"',
]) {
  assert(resolver.includes(expected), expected);
}

for (const expected of [
  "'platform_resource_context_v1'",
  "'platform_resource_context_resolve'",
  "'platform_resource_context_catalog'",
  "'platform_resource_context_related'",
  "'platform_resource_context_diagnostic_handoff'",
  "'resource_reference_interpreter_v1'",
  "'platform_resource_context_dynamic_policy_v1'",
  "'brand_workspace_context_resolve'",
  "tool_count_expected",
]) {
  assert(migration.includes(expected), expected);
}

assert(migration.includes("    5,\n    'active'"));
assert(!/\bDELETE\s+FROM\b/i.test(migration));
assert(!/\bTRUNCATE\b/i.test(migration));
assert(!/\bDROP\s+(TABLE|VIEW|DATABASE)\b/i.test(migration));
assert(runner.includes('"1030_sprint69_generic_platform_resource_context.sql"'));

const genericFixtureSources = [
  brandReferenceTest,
  brandWorkspaceTest,
  platformResourceTest,
  brandWorkspaceDocs,
];
const allowedPublicDomain = (hostname) =>
  hostname === "mad4b.com"
  || hostname.endsWith(".mad4b.com")
  || hostname.endsWith(".test")
  || hostname.endsWith(".example")
  || hostname === "google.com"
  || hostname.endsWith(".google.com")
  || hostname === "googleapis.com"
  || hostname.endsWith(".googleapis.com");

for (const source of genericFixtureSources) {
  assert(source.includes("Growth Intelligence Platform") || source.includes("منصة ذكاء النمو"));
  const hosts = [...source.matchAll(/https?:\/\/([^/\s"'`]+)/g)]
    .map((match) => match[1].toLowerCase().replace(/^www\./, ""))
    .filter((host) => !host.includes("${"));
  for (const host of hosts) {
    assert.equal(allowedPublicDomain(host), true, `unexpected public fixture domain: ${host}`);
  }
}

console.log("generic platform resource context wiring tests passed");
