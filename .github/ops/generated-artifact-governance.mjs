#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(here, "../..");

function normalizePathname(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "");
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

export function globToRegExp(pattern) {
  const normalized = normalizePathname(pattern);
  let source = "";
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];
    if (ch === "*") {
      const next = normalized[i + 1];
      if (next === "*") {
        const after = normalized[i + 2];
        i += 1;
        if (after === "/") {
          i += 1;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else {
      source += escapeRegex(ch);
    }
  }
  return new RegExp(`^${source}$`);
}

export function matchesPattern(pathname, pattern) {
  return globToRegExp(pattern).test(normalizePathname(pathname));
}

export function loadGeneratedArtifactRegistry(root = defaultRoot) {
  const registryPath = path.join(root, ".github/governance/generated-artifact-registry.json");
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  assert.equal(registry.contract, "mad4b.generated-artifact-registry.v1");
  assert.equal(registry.schema_version, 1);
  assert.equal(registry.defaults?.unknown_output, "deny");
  assert.equal(registry.defaults?.unknown_owner, "deny");
  return registry;
}

export function classifyGeneratedArtifact(pathname, registry) {
  const normalized = normalizePathname(pathname);
  const matches = registry.artifacts.filter((artifact) =>
    (artifact.patterns || []).some((pattern) => matchesPattern(normalized, pattern)),
  );
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous generated artifact classification for ${normalized}: ${matches
        .map((artifact) => artifact.id)
        .join(", ")}`,
    );
  }
  return matches[0];
}

export function resolveArtifactOwners(pathname, registry) {
  return classifyGeneratedArtifact(pathname, registry)?.owners || [];
}

export function assertOwnerCanWrite(owner, pathname, registry) {
  const artifact = classifyGeneratedArtifact(pathname, registry);
  if (!artifact) {
    throw new Error(`Unknown or unregistered generated artifact: ${normalizePathname(pathname)}`);
  }
  if (!(artifact.owners || []).includes(owner)) {
    throw new Error(
      `Generated artifact owner ${owner} is not authorized for ${normalizePathname(pathname)}; allowed=${(
        artifact.owners || []
      ).join(",")}`,
    );
  }
  return artifact;
}

function classifyAgainstPolicy(pathname, classes = []) {
  return classes.filter((entry) =>
    (entry.patterns || []).some((pattern) => matchesPattern(pathname, pattern)),
  );
}

export function assertEnvironmentClassification(pathname, registry, deploymentPolicy) {
  const artifact = classifyGeneratedArtifact(pathname, registry);
  if (!artifact) throw new Error(`Unknown generated artifact: ${pathname}`);
  const classes = classifyAgainstPolicy(
    pathname,
    deploymentPolicy.environment_impact?.path_classes || [],
  );
  if (!classes.some((entry) => entry.id === artifact.environment_class)) {
    throw new Error(
      `Environment classification mismatch for ${pathname}: registry=${artifact.environment_class}, policy=${classes
        .map((entry) => entry.id)
        .join(",") || "unclassified"}`,
    );
  }
  return classes;
}

export function assertAutomationOwnership(pathname, registry, automationPolicy) {
  const artifact = classifyGeneratedArtifact(pathname, registry);
  if (!artifact) throw new Error(`Unknown generated artifact: ${pathname}`);
  const group = (automationPolicy.resource_groups || []).find(
    (entry) => entry.key === "repository-generated-artifacts",
  );
  assert.ok(group, "repository-generated-artifacts resource group is required.");
  const owned = (group.write_patterns || []).some((pattern) => matchesPattern(pathname, pattern));
  if (!owned) {
    throw new Error(`Automation ownership policy does not register ${pathname}`);
  }
  return group;
}

export function assertConstitutionClassification(pathname, registry, constitution) {
  const artifact = classifyGeneratedArtifact(pathname, registry);
  if (!artifact) throw new Error(`Unknown generated artifact: ${pathname}`);
  const classes = classifyAgainstPolicy(pathname, constitution.surface_classes || []);
  if (!classes.some((entry) => entry.id === artifact.surface_class)) {
    throw new Error(
      `Constitution classification mismatch for ${pathname}: registry=${artifact.surface_class}, constitution=${classes
        .map((entry) => entry.id)
        .join(",") || "unknown"}`,
    );
  }
  return classes;
}

export function buildGeneratedArtifactGovernanceReport(registry, sources = {}) {
  const findings = [];
  for (const artifact of registry.artifacts || []) {
    if (!Array.isArray(artifact.owners) || artifact.owners.length === 0) {
      findings.push({ artifact: artifact.id, code: "missing_owner" });
    }
    if (!artifact.surface_class) findings.push({ artifact: artifact.id, code: "missing_surface_class" });
    if (!artifact.environment_class) {
      findings.push({ artifact: artifact.id, code: "missing_environment_class" });
    }
    if (!artifact.auto_merge || typeof artifact.auto_merge.allowed !== "boolean") {
      findings.push({ artifact: artifact.id, code: "missing_auto_merge_rule" });
    }
    for (const pattern of artifact.patterns || []) {
      if (pattern.includes("*.md") && !pattern.includes("/")) {
        findings.push({ artifact: artifact.id, code: "root_markdown_wildcard_forbidden", pattern });
      }
    }
  }
  if (sources.constitution && sources.deploymentPolicy && sources.automationPolicy) {
    const representative = {
      "docs-agent-impact-notes": "docs/auto-docs-agent/main-0123456789ab.md",
      "repository-maintenance-status": "docs/repo-maintenance-status.md",
      "surface-contract-documents": "docs/surface-contract-governance-dashboard.json",
      "surface-contract-governance-documents": "docs/ai-docs-agent-governance.md",
      "surface-contract-root-documents": "Updating Registry Patch Index.md",
      "canonical-markdown-generated-candidates": "canonicals/example/generated.md",
    };
    for (const artifact of registry.artifacts || []) {
      const sample = representative[artifact.id];
      if (!sample) continue;
      try {
        assertConstitutionClassification(sample, registry, sources.constitution);
        assertEnvironmentClassification(sample, registry, sources.deploymentPolicy);
        assertAutomationOwnership(sample, registry, sources.automationPolicy);
      } catch (error) {
        findings.push({ artifact: artifact.id, code: "authority_mismatch", message: error.message });
      }
    }
  }
  return {
    contract: "mad4b.generated-artifact-governance-report.v1",
    artifact_count: (registry.artifacts || []).length,
    finding_count: findings.length,
    ok: findings.length === 0,
    findings,
  };
}

function parseArgs(argv) {
  const args = { command: "", owner: "", pathname: "", root: defaultRoot };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!args.command && !token.startsWith("--")) args.command = token;
    else if (token === "--owner") args.owner = argv[++i] || "";
    else if (token.startsWith("--owner=")) args.owner = token.slice(8);
    else if (token === "--path") args.pathname = argv[++i] || "";
    else if (token.startsWith("--path=")) args.pathname = token.slice(7);
    else if (token === "--root") args.root = path.resolve(argv[++i] || defaultRoot);
    else if (token.startsWith("--root=")) args.root = path.resolve(token.slice(7));
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const registry = loadGeneratedArtifactRegistry(args.root);
  if (args.command === "classify" || args.command === "assert-owner") {
    assert.ok(args.owner, "--owner is required.");
    assert.ok(args.pathname, "--path is required.");
    const artifact = assertOwnerCanWrite(args.owner, args.pathname, registry);
    process.stdout.write(
      `${JSON.stringify({
        contract: "mad4b.generated-artifact-classification.v1",
        path: normalizePathname(args.pathname),
        owner: args.owner,
        artifact_id: artifact.id,
        surface_class: artifact.surface_class,
        environment_class: artifact.environment_class,
        auto_merge_allowed: artifact.auto_merge?.allowed === true,
        required_check: artifact.auto_merge?.required_check || null,
      })}\n`,
    );
    return;
  }
  if (args.command === "verify-registry") {
    const constitution = JSON.parse(
      fs.readFileSync(path.join(args.root, "http-generic-api/config/repository-governance-constitution.json"), "utf8"),
    );
    const deploymentPolicy = JSON.parse(
      fs.readFileSync(path.join(args.root, "http-generic-api/config/deployment-branch-policy.json"), "utf8"),
    );
    const automationPolicy = JSON.parse(
      fs.readFileSync(
        path.join(args.root, "http-generic-api/scripts/taxonomy/automation-overlap-policy.json"),
        "utf8",
      ),
    );
    const report = buildGeneratedArtifactGovernanceReport(registry, {
      constitution,
      deploymentPolicy,
      automationPolicy,
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) process.exitCode = 1;
    return;
  }
  throw new Error("Usage: generated-artifact-governance.mjs classify --owner <owner> --path <path> | verify-registry");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
