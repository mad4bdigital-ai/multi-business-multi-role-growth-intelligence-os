#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");

function normalize(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\.\//, "");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function parseArgs(argv) {
  const options = { root: REPO_ROOT, contract: null, base: null, head: "HEAD", force: false, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const read = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
      index += 1;
      return value;
    };
    if (arg === "--root") options.root = path.resolve(read());
    else if (arg.startsWith("--root=")) options.root = path.resolve(arg.slice(7));
    else if (arg === "--contract") options.contract = normalize(read());
    else if (arg.startsWith("--contract=")) options.contract = normalize(arg.slice(11));
    else if (arg === "--base") options.base = read();
    else if (arg.startsWith("--base=")) options.base = arg.slice(7);
    else if (arg === "--head") options.head = read();
    else if (arg.startsWith("--head=")) options.head = arg.slice(7);
    else if (arg === "--force") options.force = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.contract) throw new Error("--contract is required.");
  return options;
}

function changedFiles(root, base, head) {
  const candidates = [
    base ? `${base}...${head}` : null,
    process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}...${head}` : null,
    "origin/main...HEAD",
    "HEAD~1...HEAD"
  ].filter(Boolean);
  for (const range of candidates) {
    try {
      return execFileSync("git", ["diff", "--name-only", range], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }).split(/\r?\n/).map(normalize).filter(Boolean);
    } catch {}
  }
  return [];
}

function bucketFor(file) {
  const normalized = normalize(file);
  const name = path.posix.basename(normalized).toLowerCase();
  if (normalized.startsWith("specs/") || normalized.includes("/contracts/") || /(?:openapi|schema|policy|manifest|config)/i.test(name)) return "contracts";
  if (normalized.startsWith("migrations/") || normalized.startsWith("database/") || /(?:migration|repository|persistence|ledger|store)/i.test(name)) return "data";
  if (normalized.startsWith("frontend/") || normalized.startsWith("apps/") || /(?:frontend|dashboard|page|component|view|ui)/i.test(name)) return "frontend";
  if (normalized.startsWith("workers/") || /(?:worker|adapter|connector|transport|executor)/i.test(name)) return "worker";
  if (normalized.startsWith(".github/") || /(?:^test-|\.test\.|\.spec\.|guard|verification|diagnostic)/i.test(normalized)) return "verification";
  return "runtime";
}

const META = Object.freeze({
  contracts: { title: "Contracts and boundaries", deliverable: "Versioned specification, schema, and integration contracts" },
  data: { title: "Durable data and state", deliverable: "Additive persistence, state machine, and migration-safe repositories" },
  runtime: { title: "Application runtime", deliverable: "Runtime services and entrypoint wiring" },
  worker: { title: "Workers and provider adapters", deliverable: "Bounded worker execution and provider integration" },
  frontend: { title: "Frontend and operator surfaces", deliverable: "User-visible flows and operational projections" },
  verification: { title: "Verification and E2E", deliverable: "Convergence tests and executable E2E journey evidence" }
});

function dependenciesFor(id, present) {
  const deps = [];
  const add = (value) => { if (present.has(value) && value !== id) deps.push(value); };
  if (id === "data") add("contracts");
  if (id === "runtime") { add("contracts"); add("data"); }
  if (id === "worker") { add("contracts"); add("data"); add("runtime"); }
  if (id === "frontend") { add("contracts"); add("runtime"); }
  if (id === "verification") for (const value of ["contracts", "data", "runtime", "worker", "frontend"]) add(value);
  return deps;
}

function sanitizeFeatureKey(value) {
  return normalize(value).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function plannedJourneyId(contract) {
  const current = (contract.phases || []).find((phase) => phase.id === contract.current_phase);
  return current?.planned_e2e_journey?.id || current?.e2e_journeys?.[0]?.id || `${contract.feature_key}-mvp-e2e`;
}

function buildPlan(contract, files) {
  const grouped = new Map();
  for (const file of files) {
    if (file === normalize(contract.__contract_path || "")) continue;
    const bucket = bucketFor(file);
    const rows = grouped.get(bucket) || [];
    rows.push(file);
    grouped.set(bucket, rows);
  }
  if (!grouped.size) throw new Error("No changed files were available to split into workstreams.");
  if (!grouped.has("verification")) {
    const slug = sanitizeFeatureKey(contract.feature_key).replace(/^\d+[-_]?/, "");
    grouped.set("verification", [`http-generic-api/test-${slug}-e2e.mjs`]);
  }
  const order = ["contracts", "data", "runtime", "worker", "frontend", "verification"].filter((id) => grouped.has(id));
  const present = new Set(order);
  const feature = sanitizeFeatureKey(contract.feature_key);
  const workstreams = order.map((id) => ({
    id,
    title: META[id].title,
    status: "planned",
    owner_type: "unassigned",
    branch_pattern: `gpt/${feature}/${id}-*`,
    scope: { include: [...new Set(grouped.get(id))].sort() },
    depends_on: dependenciesFor(id, present),
    deliverables: [META[id].deliverable],
    integration_points: [`${feature}:${id}:v1`],
    required_tests: []
  }));
  return {
    enabled: true,
    strategy: "dependency_dag",
    file_ownership: "exclusive_by_default",
    merge_policy: "workstream_commits_then_e2e_rollup",
    no_partial_feature_merge: true,
    workstreams,
    declared_overlaps: [],
    integration: {
      branch_pattern: `gpt/${feature}/integration-*`,
      required_workstreams: workstreams.map((row) => row.id),
      e2e_journey_ids: [plannedJourneyId(contract)],
      convergence_tests: []
    }
  };
}

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const absoluteContract = path.resolve(options.root, options.contract);
  const rootPrefix = `${path.resolve(options.root)}${path.sep}`;
  if (!absoluteContract.startsWith(rootPrefix)) throw new Error("Contract path escapes repository root.");
  if (!fs.existsSync(absoluteContract)) throw new Error(`Contract not found: ${options.contract}`);
  const contract = readJson(absoluteContract);
  if (contract.parallel_work && !options.force) throw new Error("parallel_work already exists. Use --force to regenerate it.");
  contract.__contract_path = options.contract;
  const files = changedFiles(options.root, options.base, options.head);
  const plan = buildPlan(contract, files);
  delete contract.__contract_path;
  contract.parallel_work = plan;
  if (!options.dryRun) writeAtomic(absoluteContract, contract);
  console.log(JSON.stringify({
    ok: true,
    action: options.dryRun ? "previewed" : "parallel_plan_written",
    contract_path: options.contract,
    workstream_count: plan.workstreams.length,
    workstreams: plan.workstreams.map((row) => ({ id: row.id, branch_pattern: row.branch_pattern, file_count: row.scope.include.length, depends_on: row.depends_on })),
    integration_branch_pattern: plan.integration.branch_pattern,
    dry_run: options.dryRun,
    secrets_included: false,
    contract
  }, null, 2));
}

main();
