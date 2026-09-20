import { createHash } from "node:crypto";

const CONSTANT_NAMES = Object.freeze([
  "REPOSITORY_POLICY_CAPABILITY_KEY",
  "REPOSITORY_POLICY_OPERATION_INTENT",
  "REPOSITORY_POLICY_RUNTIME_SURFACE",
  "REPOSITORY_POLICY_SOURCE_TIER",
  "DEFAULT_REPOSITORY_BINDING_KEY",
]);

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizedSource(source = "") {
  return String(source || "").replace(/\r\n/g, "\n");
}

function constantDeclaration(source, name) {
  const match = source.match(new RegExp(`^const ${name} = (.+);$`, "m"));
  if (!match) throw new Error(`repository_policy_source_contract_constant_missing:${name}`);
  return match[1].trim();
}

function extractFunction(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`repository_policy_source_contract_function_missing:${marker}`);
  const signatureEnd = source.indexOf(") {", start);
  if (signatureEnd < 0) throw new Error(`repository_policy_source_contract_function_signature_missing:${marker}`);
  const bodyStart = signatureEnd + 2;

  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1] || "";

    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1).trim();
    }
  }
  throw new Error(`repository_policy_source_contract_function_unterminated:${marker}`);
}

function lineStartingWith(source, prefix) {
  const line = source.split("\n").map((item) => item.trim()).find((item) => item.startsWith(prefix));
  if (!line) throw new Error(`repository_policy_source_contract_line_missing:${prefix}`);
  return line;
}

export function repositoryPolicyEnvelopeSourceContract(source = "") {
  const normalized = normalizedSource(source);
  const dryRunSelection = lineStartingWith(normalized, "const dryRun =");
  if (!dryRunSelection.startsWith("const dryRun = repositoryPolicyDryRun ||")) {
    throw new Error("repository_policy_source_contract_short_circuit_order_invalid");
  }

  const snapshot = {
    contract: "mad4b.github-repository-policy-envelope-source-contract.v1",
    constants: Object.fromEntries(CONSTANT_NAMES.map((name) => [name, constantDeclaration(normalized, name)])),
    repository_policy_envelope_requested_sha256: sha256(extractFunction(normalized, "function repositoryPolicyEnvelopeRequested")),
    exact_repository_policy_surface_sha256: sha256(extractFunction(normalized, "function exactRepositoryPolicySurface")),
    build_repository_policy_envelope_dry_run_sha256: sha256(extractFunction(normalized, "export async function buildRepositoryPolicyEnvelopeDryRun")),
    ledger_repository_policy_builder_sha256: sha256(lineStartingWith(normalized, "const repositoryPolicyDryRun = await buildRepositoryPolicyEnvelopeDryRun")),
    ledger_repository_policy_short_circuit_first: true,
    secrets_included: false,
  };

  return {
    ...snapshot,
    fingerprint: sha256(JSON.stringify(snapshot)),
  };
}
