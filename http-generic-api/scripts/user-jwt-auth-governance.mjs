import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const API_ROOT = resolve(SCRIPT_DIR, "..");
const REPO_ROOT = resolve(API_ROOT, "..");

export const GIT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

export const HARDENED_AUTH_FILES = Object.freeze([
  "http-generic-api/userJwtAuth.js",
  "http-generic-api/runtimeGuards.js",
  "http-generic-api/routes/connectRoutes.js",
  "http-generic-api/routes/connectApiRoutes.js",
]);

const JWT_FALLBACK = /JWT_SECRET\s*(?:\|\||\?\?)\s*(?:"[^"]+"|'[^']+'|`[^`]+`)/;
const KNOWN_FALLBACK_LITERAL = /development_fallback_secret_only|["'`]dev-secret["'`]/;
const LOCAL_USER_JWT_GUARD = /\bfunction\s+(?:verifyUserJwt|requireUserJwt)\s*\(/;
const ROUTE_JWT_IMPORT = /\b(?:import|require\s*\().*\bjsonwebtoken\b/;

function git(args) {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: GIT_MAX_BUFFER_BYTES,
  }).trim();
}

function gitRefExists(ref) {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", ref], {
      cwd: REPO_ROOT,
      stdio: "ignore",
      maxBuffer: GIT_MAX_BUFFER_BYTES,
    });
    return true;
  } catch {
    return false;
  }
}

export function resolveBaselineRef(explicitRef = "") {
  if (explicitRef && gitRefExists(explicitRef)) return explicitRef;
  if (process.env.GITHUB_BASE_REF) {
    const remoteBase = `origin/${process.env.GITHUB_BASE_REF}`;
    if (gitRefExists(remoteBase)) return remoteBase;
  }
  const branch = process.env.GITHUB_REF_NAME || git(["branch", "--show-current"]);
  if (branch && !["main", "master"].includes(branch) && gitRefExists("origin/main")) {
    return "origin/main";
  }
  return gitRefExists("HEAD^") ? "HEAD^" : "";
}

export function addedLinesFromDiff(diffText) {
  const entries = [];
  let file = "";
  for (const line of String(diffText || "").split("\n")) {
    if (line.startsWith("+++ b/")) {
      file = line.slice("+++ b/".length);
      continue;
    }
    if (file && line.startsWith("+") && !line.startsWith("+++")) {
      entries.push({ file, text: line.slice(1) });
    }
  }
  return entries;
}

function isRuntimeSource(file) {
  return /\.(?:m?js)$/.test(file)
    && !file.endsWith("/scripts/user-jwt-auth-governance.mjs")
    && !/(?:^|\/)test-[^/]+\.m?js$/.test(file)
    && !/\.(?:test|spec)\.m?js$/.test(file);
}

export function addedLineViolations(entries) {
  const violations = [];
  for (const { file, text } of entries) {
    if (!isRuntimeSource(file)) continue;
    if (JWT_FALLBACK.test(text) || KNOWN_FALLBACK_LITERAL.test(text)) {
      violations.push({ file, rule: "jwt_secret_fallback", text: text.trim() });
    }
    if (file.includes("/routes/") && LOCAL_USER_JWT_GUARD.test(text)) {
      violations.push({ file, rule: "route_local_user_jwt_guard", text: text.trim() });
    }
    if (file.includes("/routes/") && ROUTE_JWT_IMPORT.test(text)) {
      violations.push({ file, rule: "route_local_jsonwebtoken_import", text: text.trim() });
    }
  }
  return violations;
}

export function hardenedFileViolations(readSource = (file) => readFileSync(resolve(REPO_ROOT, file), "utf8")) {
  const violations = [];
  for (const file of HARDENED_AUTH_FILES) {
    const source = readSource(file);
    if (JWT_FALLBACK.test(source) || KNOWN_FALLBACK_LITERAL.test(source)) {
      violations.push({ file, rule: "hardened_file_contains_jwt_fallback" });
    }
    if (file.includes("/routes/") && (LOCAL_USER_JWT_GUARD.test(source) || ROUTE_JWT_IMPORT.test(source))) {
      violations.push({ file, rule: "hardened_route_bypasses_shared_guard" });
    }
  }
  return violations;
}

function parseArgs(argv) {
  const baseline = argv.find((arg) => arg.startsWith("--baseline-ref="));
  return { baselineRef: baseline ? baseline.slice("--baseline-ref=".length) : "" };
}

export function runUserJwtAuthGovernance({ baselineRef = "" } = {}) {
  const resolvedBaseline = resolveBaselineRef(baselineRef);
  const diffs = [];
  if (resolvedBaseline) {
    diffs.push(git(["diff", "--unified=0", `${resolvedBaseline}...HEAD`, "--", "*.js", "*.mjs"]));
  }
  diffs.push(git(["diff", "--unified=0", "HEAD", "--", "*.js", "*.mjs"]));

  const violations = [
    ...hardenedFileViolations(),
    ...addedLineViolations(addedLinesFromDiff(diffs.filter(Boolean).join("\n"))),
  ];
  const unique = [...new Map(violations.map((item) => [JSON.stringify(item), item])).values()];
  if (unique.length) {
    for (const violation of unique) {
      console.error(`::error file=${violation.file},title=User JWT auth governance::${violation.rule}${violation.text ? `: ${violation.text}` : ""}`);
    }
    throw new Error(`User JWT auth governance found ${unique.length} violation(s).`);
  }
  return { baseline_ref: resolvedBaseline || null, violations: 0, hardened_files: HARDENED_AUTH_FILES.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = runUserJwtAuthGovernance(parseArgs(process.argv.slice(2)));
    console.log(`User JWT auth governance passed (${result.hardened_files} hardened files; baseline ${result.baseline_ref || "none"}).`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
