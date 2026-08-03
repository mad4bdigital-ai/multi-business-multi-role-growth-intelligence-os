import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FEATURE_KEY = "014-retail-commerce-operations-growth-os";
const SPEC_ROOT = path.resolve(HERE, "..", "specs", FEATURE_KEY);
const CONTRACT_ROOT = path.join(SPEC_ROOT, "contracts");

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolute = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(absolute) : [absolute];
    })
    .sort();
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function relative(file) {
  return path.relative(SPEC_ROOT, file).replaceAll("\\", "/");
}

assert.equal(fs.existsSync(SPEC_ROOT), true, `Retail Commerce spec root must exist: ${SPEC_ROOT}`);

const files = walk(SPEC_ROOT);
const jsonFiles = files.filter((file) => file.endsWith(".json"));
const yamlFiles = files.filter((file) => /\.ya?ml$/u.test(file));
const markdownFiles = files.filter((file) => file.endsWith(".md"));
const governedFiles = [...jsonFiles, ...yamlFiles, ...markdownFiles];

assert.equal(governedFiles.length, files.length, "The specification package may contain only JSON, YAML, and Markdown artifacts");
assert(jsonFiles.length > 0, "The package must contain JSON contracts");
assert(yamlFiles.length > 0, "The package must contain YAML/OpenAPI contracts");
assert(markdownFiles.length > 0, "The package must contain Markdown specification artifacts");

for (const file of jsonFiles) {
  assert.doesNotThrow(() => readJson(file), `JSON must parse: ${relative(file)}`);
}

for (const file of yamlFiles) {
  const source = fs.readFileSync(file, "utf8");
  assert.doesNotThrow(() => YAML.parse(source), `YAML must parse: ${relative(file)}`);
}

for (const file of markdownFiles) {
  const source = fs.readFileSync(file, "utf8");
  assert(source.trim().length > 0, `Markdown must not be empty: ${relative(file)}`);
  assert.doesNotMatch(source, /^(<<<<<<<|=======|>>>>>>>)\s*$/mu, `Markdown must not contain merge markers: ${relative(file)}`);
}

const manifest = readJson(path.join(SPEC_ROOT, "manifest.json"));
const completion = readJson(path.join(SPEC_ROOT, "completion.json"));
const workMap = readJson(path.join(SPEC_ROOT, "work-map-integration.json"));
const e2e = readJson(path.join(SPEC_ROOT, "e2e-phases.json"));

for (const [name, contract] of Object.entries({ manifest, completion, workMap, e2e })) {
  assert.equal(contract.feature_key, FEATURE_KEY, `${name} feature_key must match the bounded package identity`);
}

const requiredArtifacts = new Set([
  ...(manifest.artifacts?.required || []),
  "manifest.json",
  "completion.json",
  "work-map-integration.json",
  "e2e-phases.json",
]);
for (const artifact of requiredArtifacts) {
  assert.equal(fs.existsSync(path.join(SPEC_ROOT, artifact)), true, `Required artifact must exist: ${artifact}`);
}
assert.deepEqual(manifest.artifacts?.omitted || [], [], "No required specification artifacts may be omitted");
assert.equal(manifest.artifacts?.present, true, "Manifest must declare the specification artifact set present");

const jsonSchemaFiles = fs.readdirSync(CONTRACT_ROOT)
  .filter((name) => name.endsWith(".schema.json"))
  .sort();
assert(jsonSchemaFiles.length > 0, "At least one JSON Schema contract is required");
for (const name of jsonSchemaFiles) {
  const schema = readJson(path.join(CONTRACT_ROOT, name));
  assert.equal(typeof schema.$schema, "string", `${name} must declare $schema`);
  assert.equal(typeof schema.type, "string", `${name} must declare a top-level type`);
}

const openApiFiles = fs.readdirSync(CONTRACT_ROOT)
  .filter((name) => name.endsWith(".openapi.yaml"))
  .sort();
assert(openApiFiles.length > 0, "At least one OpenAPI contract is required");
for (const name of openApiFiles) {
  const document = YAML.parse(fs.readFileSync(path.join(CONTRACT_ROOT, name), "utf8"));
  assert.match(String(document.openapi || ""), /^3\./u, `${name} must be OpenAPI 3.x`);
  assert(document.paths && typeof document.paths === "object", `${name} must declare paths`);
}

const falseOnlyFlags = [
  "production_mutation",
  "provider_write",
  "wordpress_woocommerce_write",
  "google_drive_write",
  "migration_apply",
  "deployment_required",
  "secrets_included",
];
for (const flag of falseOnlyFlags) {
  assert.equal(manifest[flag], false, `manifest.${flag} must remain false in the specification-only package`);
  assert.equal(completion[flag], false, `completion.${flag} must remain false before governed implementation`);
}

assert.equal(manifest.authority?.specification_is_runtime_authority, false, "Specification must never become runtime authority");
assert.equal(manifest.authority?.mutation_authority_created, false, "Specification must not create mutation authority");
assert.equal(manifest.authority?.provider_execution_authorized, false, "Specification must not authorize provider execution");
assert.equal(manifest.authority?.wordpress_woocommerce_write_authorized, false, "Specification must not authorize WordPress/WooCommerce writes");
assert.equal(manifest.authority?.google_drive_write_authorized, false, "Specification must not authorize Google Drive writes");
assert.equal(completion.status, "in_progress", "Completion must remain truthful before implementation and production proof");
assert.equal(completion.post_merge_audit_completed, false, "Post-merge implementation audit must not be claimed by the specification package");

assert.equal(workMap.review_state, "ready_for_implementation", "Work Map review must remain implementation-ready");
assert.equal(workMap.implementation_readiness?.status, "ready", "Work Map implementation readiness must be ready");
assert.deepEqual(workMap.dimension_discovery?.unresolved || [], [], "Work Map dimensions must have no unresolved entries");
assert.equal(workMap.secrets_included, false, "Work Map evidence must remain secret-free");

assert.equal(e2e.current_phase, "mvp", "The specification handoff phase must remain MVP");
const phaseById = new Map((e2e.phases || []).map((phase) => [phase.id, phase]));
assert.equal(phaseById.get("mvp")?.status, "implemented", "Specification handoff MVP must be implemented");
for (const phase of ["operational", "resilient", "canary", "production"]) {
  assert.equal(phaseById.get(phase)?.status, "planned", `${phase} must remain planned until separately authorized implementation evidence exists`);
}

const forbiddenImplementationExtensions = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".sql", ".sh", ".ps1", ".php"]);
const implementationFiles = files.filter((file) => forbiddenImplementationExtensions.has(path.extname(file).toLowerCase()));
assert.deepEqual(implementationFiles, [], "The specification package must not contain runtime, migration, or execution scripts");

console.log(JSON.stringify({
  ok: true,
  test: "retail_commerce_specification_baseline",
  feature_key: FEATURE_KEY,
  artifact_counts: {
    total: files.length,
    json: jsonFiles.length,
    yaml: yamlFiles.length,
    markdown: markdownFiles.length,
  },
  specification_only: true,
  runtime_implementation_started: false,
  migration_apply: false,
  provider_write: false,
  deployment: false,
  production_mutation: false,
  secrets_included: false,
}));
