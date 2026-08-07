#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  REPO_ROOT,
  buildScaffoldManifest,
  parseWorkMapRegistry,
  validateRepository,
} from "./spec-kit-work-map-integration-gate.mjs";
import {
  applySchemaClassificationRegistry,
  validateSchemaClassification,
} from "./work-map-schema-classification.mjs";

const DEFAULT_POLICY_PATH = ".specify/spec-kit-work-map-integration-policy.json";
const SHA_PATTERN = /^[0-9a-f]{40}$/i;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function parseArg(args, flag) {
  const direct = args.find((value) => value.startsWith(`${flag}=`));
  if (direct) return direct.slice(flag.length + 1);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
}

function normalizePath(value) {
  return String(value || "").trim().replaceAll("\\", "/");
}

function requireSha(value, label) {
  const sha = String(value || "").trim().toLowerCase();
  if (!SHA_PATTERN.test(sha)) {
    throw new Error(`${label} must be an exact 40-character commit SHA`);
  }
  return sha;
}

function loadEventPayload(env = process.env) {
  const eventPath = String(env.GITHUB_EVENT_PATH || "").trim();
  if (!eventPath || !fs.existsSync(eventPath)) return {};
  return readJson(eventPath);
}

function gitDiffNames(root, baseSha, headSha) {
  for (const [label, sha] of [["base", baseSha], ["head", headSha]]) {
    try {
      execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], {
        cwd: root,
        stdio: ["ignore", "ignore", "pipe"],
      });
    } catch {
      throw new Error(`Work Map ${label} SHA is not available in the exact checkout: ${sha}`);
    }
  }
  let output;
  try {
    output = execFileSync("git", ["diff", "--name-only", `${baseSha}...${headSha}`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = String(error?.stderr || error?.message || error).trim().slice(0, 500);
    throw new Error(`Exact Work Map changed-file diff failed for ${baseSha}...${headSha}: ${detail}`);
  }
  return output.split(/\r?\n/).map(normalizePath).filter(Boolean);
}

async function fetchPullRequestIdentity({ repository, prNumber, token, fetchImpl = fetch }) {
  if (!repository || !/^\d+$/.test(String(prNumber || ""))) {
    throw new Error("workflow_dispatch requires an exact target pull request number");
  }
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetchImpl(`https://api.github.com/repos/${repository}/pulls/${prNumber}`, {
    headers,
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    throw new Error(`GitHub pull request read failed with HTTP ${response.status}`);
  }
  const payload = await response.json();
  return {
    baseSha: payload?.base?.sha,
    headSha: payload?.head?.sha,
    headRef: payload?.head?.ref,
    state: payload?.state,
  };
}

export async function resolveExactChangedFiles(options = {}) {
  const root = options.root || REPO_ROOT;
  const env = options.env || process.env;
  const event = options.eventPayload || loadEventPayload(env);
  const eventName = String(options.eventName || env.GITHUB_EVENT_NAME || "").trim();
  let baseSha;
  let headSha;

  const explicit = String(env.WORK_MAP_CHANGED_FILES_JSON || "").trim();
  if (explicit) {
    const values = JSON.parse(explicit);
    if (!Array.isArray(values) || values.some((value) => typeof value !== "string")) {
      throw new Error("WORK_MAP_CHANGED_FILES_JSON must be a JSON array of repository paths");
    }
    return [...new Set(values.map(normalizePath).filter(Boolean))].sort();
  }

  if (eventName === "pull_request" || eventName === "pull_request_target") {
    baseSha = event?.pull_request?.base?.sha;
    headSha = event?.pull_request?.head?.sha;
  } else if (eventName === "workflow_dispatch") {
    const prNumber = event?.inputs?.target_pr || env.TARGET_PR;
    const expectedHead = event?.inputs?.target_sha || env.EXPECTED_CHECKED_OUT_SHA;
    const identity = options.pullRequestIdentity || await fetchPullRequestIdentity({
      repository: env.GITHUB_REPOSITORY,
      prNumber,
      token: env.GITHUB_TOKEN || env.GH_TOKEN || "",
      fetchImpl: options.fetchImpl,
    });
    if (identity.state !== "open") throw new Error("Target pull request is not open");
    if (expectedHead && String(identity.headSha).toLowerCase() !== requireSha(expectedHead, "target head")) {
      throw new Error(`Target pull request head moved: expected ${expectedHead}, found ${identity.headSha}`);
    }
    baseSha = identity.baseSha;
    headSha = identity.headSha;
  } else if (eventName === "push") {
    baseSha = event?.before;
    headSha = event?.after;
  } else {
    throw new Error(`Exact Work Map changed-file resolution is unsupported for event ${eventName || "unknown"}`);
  }

  baseSha = requireSha(baseSha, "Work Map base");
  headSha = requireSha(headSha, "Work Map head");
  if (/^0{40}$/.test(baseSha)) throw new Error("Work Map base SHA cannot be the all-zero SHA");
  return (options.gitDiffNames || gitDiffNames)(root, baseSha, headSha);
}

export function buildEffectiveWorkMapRegistry(options = {}) {
  const root = options.root || REPO_ROOT;
  const policy = options.policy || readJson(path.join(root, DEFAULT_POLICY_PATH));
  const baseRegistry = options.baseRegistry || parseWorkMapRegistry({ root, policy });
  const effectiveRegistry = applySchemaClassificationRegistry(baseRegistry, {
    root,
    policy,
    ...(options.classificationOptions || {}),
  });
  return { root, policy, baseRegistry, effectiveRegistry };
}

export function validateGovernedRepository(options = {}) {
  const { root, policy, effectiveRegistry } = buildEffectiveWorkMapRegistry(options);
  const classification = validateSchemaClassification({
    root,
    policy,
    ...(options.classificationOptions || {}),
  });
  const repositoryOptions = {
    root,
    policy,
    registry: effectiveRegistry,
    all: options.all === true,
  };
  if (Object.prototype.hasOwnProperty.call(options, "changedFiles")) repositoryOptions.changedFiles = options.changedFiles;
  if (Object.prototype.hasOwnProperty.call(options, "newFeatures")) repositoryOptions.newFeatures = options.newFeatures;
  if (Object.prototype.hasOwnProperty.call(options, "implementationChanged")) repositoryOptions.implementationChanged = options.implementationChanged;
  const integration = validateRepository(repositoryOptions);
  return {
    ok: classification.ok && integration.findings.length === 0,
    findings: [
      ...classification.findings.map((finding) => ({ source: "schema_classification", ...finding })),
      ...integration.findings.map((finding) => ({ source: "spec_kit_integration", ...finding })),
    ],
    classification,
    integration,
    effective_registry: effectiveRegistry,
    policy,
  };
}

function scaffold(feature, options = {}) {
  const { root, policy, effectiveRegistry } = buildEffectiveWorkMapRegistry(options);
  const classification = validateSchemaClassification({ root, policy });
  if (!classification.ok) {
    console.error(JSON.stringify({
      ok: false,
      error: {
        code: "work_map_schema_classification_not_ready",
        message: "Resolve schema classification findings before scaffolding a Spec Kit integration manifest.",
        details: { findings: classification.findings },
      },
      secrets_included: false,
    }, null, 2));
    process.exit(1);
  }
  const manifest = buildScaffoldManifest(feature, {
    root,
    policy,
    registry: effectiveRegistry,
    owner: options.owner || "unassigned",
  });
  const outputPath = path.join(root, policy.spec_root, feature, policy.manifest_filename);
  const payload = `${JSON.stringify(manifest, null, 2)}\n`;
  if (options.stdout) process.stdout.write(payload);
  else {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, payload);
    console.log(JSON.stringify({
      ok: true,
      action: "scaffold",
      feature_key: feature,
      output: path.relative(root, outputPath).replaceAll("\\", "/"),
      map_count: effectiveRegistry.maps.length,
      domain_count: effectiveRegistry.domains.length,
      globally_classified_schema_objects: effectiveRegistry.globally_classified_schema_objects.length,
      intentionally_unclassified_schema_objects: effectiveRegistry.intentionally_unclassified_schema_objects.length,
      unresolved_schema_objects: effectiveRegistry.uncategorized_objects.length,
      secrets_included: false,
    }, null, 2));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const feature = parseArg(args, "--scaffold");
  if (feature) {
    scaffold(feature, {
      owner: parseArg(args, "--owner") || "unassigned",
      stdout: args.includes("--stdout"),
    });
    return;
  }

  const exactChangedFilesRequired = args.includes("--changed")
    && String(process.env.GITHUB_ACTIONS || "").toLowerCase() === "true";
  const changedFiles = exactChangedFilesRequired
    ? await resolveExactChangedFiles()
    : undefined;
  const result = validateGovernedRepository({
    all: args.includes("--all"),
    ...(changedFiles ? { changedFiles } : {}),
  });
  const payload = {
    ok: result.ok,
    gate: "fail_closed",
    policy_key: result.policy.policy_key,
    changed_file_resolution: exactChangedFilesRequired ? "exact_base_head" : "local_repository",
    changed_file_count: changedFiles?.length ?? null,
    work_maps_discovered: result.effective_registry.maps.length,
    schema_domains_discovered: result.effective_registry.domains.length,
    source_unresolved_or_intentional_count: result.classification.source_uncategorized_count,
    classified_from_legacy_matrix: result.classification.classified.length,
    intentionally_unclassified: result.classification.intentional_unclassified.length,
    unresolved_schema_objects: result.classification.unresolved.length,
    spec_kits_checked: result.integration.targets,
    new_spec_kits: result.integration.new_features,
    implementation_changed: result.integration.implementation_changed,
    findings: result.findings,
    secrets_included: false,
  };
  const writer = result.ok ? console.log : console.error;
  writer(JSON.stringify(payload, null, 2));
  if (!result.ok) process.exit(1);
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      error: {
        code: "work_map_exact_changed_file_resolution_failed",
        message: String(error?.message || error).slice(0, 1000),
      },
      gate: "fail_closed",
      secrets_included: false,
    }, null, 2));
    process.exit(1);
  });
}
