#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchesPattern } from "./e2e-phase-governance.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");

function normalize(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\.\//, "");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function gitNameOnly(root, args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).split(/\r?\n/).map(normalize).filter(Boolean);
  } catch {
    return [];
  }
}

function changedFiles(root, base, head) {
  const files = new Set();
  const candidates = [
    base ? `${base}...${head || "HEAD"}` : null,
    process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}...HEAD` : null,
    "origin/main...HEAD",
    "HEAD~1...HEAD"
  ].filter(Boolean);

  for (const range of candidates) {
    const committed = gitNameOnly(root, ["diff", "--name-only", range]);
    if (committed.length) {
      for (const file of committed) files.add(file);
      break;
    }
  }

  for (const file of gitNameOnly(root, ["diff", "--name-only"])) files.add(file);
  for (const file of gitNameOnly(root, ["diff", "--name-only", "--cached"])) files.add(file);
  for (const file of gitNameOnly(root, ["ls-files", "--others", "--exclude-standard"])) files.add(file);
  return [...files].sort();
}

function parseArgs(argv) {
  const options = {
    root: REPO_ROOT,
    base: null,
    head: "HEAD",
    featureKey: null,
    title: null,
    deliveryMode: "multi_pr",
    force: false,
    refreshScope: false,
    dryRun: false
  };
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
    else if (arg === "--base") options.base = read();
    else if (arg.startsWith("--base=")) options.base = arg.slice(7);
    else if (arg === "--head") options.head = read();
    else if (arg.startsWith("--head=")) options.head = arg.slice(7);
    else if (arg === "--feature-key") options.featureKey = read();
    else if (arg.startsWith("--feature-key=")) options.featureKey = arg.slice(14);
    else if (arg === "--title") options.title = read();
    else if (arg.startsWith("--title=")) options.title = arg.slice(8);
    else if (arg === "--delivery-mode") options.deliveryMode = read();
    else if (arg.startsWith("--delivery-mode=")) options.deliveryMode = arg.slice(16);
    else if (arg === "--force") options.force = true;
    else if (arg === "--refresh-scope") options.refreshScope = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function specKeys(files, specRoot) {
  const prefix = `${normalize(specRoot)}/`;
  return [...new Set(files.filter((file) => file.startsWith(prefix)).map((file) => file.slice(prefix.length).split("/")[0]).filter(Boolean))];
}

function inferredFeatureKey(options, files, policy) {
  if (options.featureKey) return normalize(options.featureKey);
  const keys = specKeys(files, policy.spec_root);
  if (keys.length === 1) return keys[0];
  if (keys.length > 1) throw new Error(`Multiple Spec Kits changed: ${keys.join(", ")}. Pass --feature-key.`);
  throw new Error("Could not infer a feature key. Pass --feature-key for non-Spec changes.");
}

function contractPath(root, featureKey, files, policy) {
  const specDirectory = normalize(path.posix.join(policy.spec_root, featureKey));
  const hasSpec = files.some((file) => file === specDirectory || file.startsWith(`${specDirectory}/`)) || fs.existsSync(path.join(root, specDirectory));
  return hasSpec
    ? normalize(path.posix.join(specDirectory, policy.spec_contract_file))
    : normalize(path.posix.join(policy.non_spec_contract_root, `${featureKey}.json`));
}

function runtimeScope(files, policy) {
  return [...new Set(files.filter((file) => policy.runtime_patterns.some((pattern) => matchesPattern(file, pattern))))].sort();
}

function titleFromFeatureKey(featureKey) {
  return featureKey
    .replace(/^\d+[-_]?/, "")
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ") || featureKey;
}

function buildContract(featureKey, title, deliveryMode, scope) {
  return {
    $schema: "../../.specify/schemas/e2e-phases.schema.json",
    schema_version: 1,
    feature_key: featureKey,
    title,
    delivery_mode: deliveryMode,
    current_phase: "mvp",
    scope: { include: scope },
    merge_contract: { minimum_phase: "mvp" },
    phases: [
      {
        id: "mvp",
        status: "blocked",
        objective: "Deliver the smallest complete runtime entrypoint-to-observable-readback journey.",
        blockers: [
          "Replace this blocker with the concrete missing runtime, persistence, integration, or E2E test work."
        ],
        planned_e2e_journey: {
          id: `${featureKey}-mvp-journey`,
          required_level: "synthetic_runtime",
          actor: "Replace with the real actor",
          entrypoint: "Replace with the real HTTP, CLI, event, or scheduled entrypoint",
          terminal_outcome: "Replace with the observable readback or user-visible outcome",
          steps: [
            "Invoke the real entrypoint",
            "Cross the owned runtime layers",
            "Read back and assert the terminal outcome"
          ]
        }
      },
      { id: "operational", status: "planned", objective: "Add operational controls while preserving the MVP journey." },
      { id: "resilient", status: "planned", objective: "Prove fault recovery, reconciliation, and bounded failure behavior." },
      { id: "canary", status: "planned", objective: "Run the same journey against a live non-production target." },
      { id: "production", status: "planned", objective: "Verify exact Production SHA and runtime readback." }
    ]
  };
}

function writeAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const policy = readJson(path.join(options.root, ".specify", "e2e-phase-governance.json"));
  const files = changedFiles(options.root, options.base, options.head);
  const featureKey = inferredFeatureKey(options, files, policy);
  const relativeContract = contractPath(options.root, featureKey, files, policy);
  const absoluteContract = path.join(options.root, relativeContract);
  const scope = runtimeScope(files, policy);
  const specScope = relativeContract.startsWith(`${policy.spec_root}/`)
    ? [normalize(path.posix.dirname(relativeContract) + "/**")]
    : [];
  const proposedScope = [...new Set([...specScope, ...scope])].sort();
  if (!proposedScope.length) throw new Error("No Spec or runtime changes were detected for this feature.");

  const existed = fs.existsSync(absoluteContract);
  let contract;
  if (existed) {
    if (!options.refreshScope && !options.force) {
      throw new Error(`${relativeContract} already exists. Use --refresh-scope to add changed files or --force to replace it.`);
    }
    if (options.refreshScope) {
      contract = readJson(absoluteContract);
      contract.scope = contract.scope || {};
      contract.scope.include = [...new Set([...(contract.scope.include || []), ...proposedScope])].sort();
    } else {
      contract = buildContract(featureKey, options.title || titleFromFeatureKey(featureKey), options.deliveryMode, proposedScope);
    }
  } else {
    contract = buildContract(featureKey, options.title || titleFromFeatureKey(featureKey), options.deliveryMode, proposedScope);
  }

  const output = {
    ok: true,
    action: existed ? (options.refreshScope ? "scope_refreshed" : "replaced") : "created",
    feature_key: featureKey,
    contract_path: relativeContract,
    changed_files: files,
    proposed_scope: contract.scope.include,
    dry_run: options.dryRun,
    secrets_included: false
  };

  if (!options.dryRun) writeAtomic(absoluteContract, contract);
  console.log(JSON.stringify({ ...output, contract }, null, 2));
}

main();
