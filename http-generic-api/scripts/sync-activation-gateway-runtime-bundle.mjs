import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(apiRoot, "..");
const sourceRoot = path.join(repoRoot, "edge", "activation-gateway");
const targetRoot = path.join(apiRoot, "activation-gateway-runtime");
const mode = process.argv.includes("--write") ? "write" : "check";

const files = [
  "src/worker.mjs",
  "src/gateway.mjs",
  "generated/route-policy.json",
  "generated/route-policy.staging.json",
];

function normalizeText(value) {
  return String(value).replace(/\r\n?/g, "\n");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function readNormalized(filePath) {
  return normalizeText(await fs.readFile(filePath, "utf8"));
}

const entries = [];
const driftFiles = [];
for (const relativePath of files) {
  const sourcePath = path.join(sourceRoot, ...relativePath.split("/"));
  const targetPath = path.join(targetRoot, ...relativePath.split("/"));
  const content = await readNormalized(sourcePath);
  let existing = null;
  try { existing = await readNormalized(targetPath); } catch {}
  if (existing !== content) driftFiles.push(relativePath);
  if (mode === "write") {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, content, "utf8");
  }
  entries.push({ path: relativePath, sha256: sha256(content), bytes: Buffer.byteLength(content, "utf8") });
}

const combinedHash = crypto.createHash("sha256");
for (const entry of [...entries].sort((left, right) => left.path.localeCompare(right.path))) {
  combinedHash.update(entry.path);
  combinedHash.update("\0");
  combinedHash.update(entry.sha256);
  combinedHash.update("\0");
}
const manifest = {
  schema_version: 1,
  source: "edge/activation-gateway",
  target: "http-generic-api/activation-gateway-runtime",
  file_count: entries.length,
  bundle_hash_sha256: combinedHash.digest("hex"),
  files: entries,
  secrets_included: false,
};
const manifestPath = path.join(targetRoot, "bundle-manifest.json");
const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
let existingManifest = null;
try { existingManifest = await readNormalized(manifestPath); } catch {}
if (existingManifest !== manifestText) driftFiles.push("bundle-manifest.json");
if (mode === "write") {
  await fs.mkdir(targetRoot, { recursive: true });
  await fs.writeFile(manifestPath, manifestText, "utf8");
}

const result = {
  ok: mode === "write" || driftFiles.length === 0,
  mode,
  source_root: path.relative(repoRoot, sourceRoot).replaceAll("\\", "/"),
  target_root: path.relative(repoRoot, targetRoot).replaceAll("\\", "/"),
  drift_files: driftFiles,
  manifest,
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;

// Build an isolated, source-attested Staging deployment tree. Never deploy here.
// The bundle digest covers the canonical source set BEFORE identity injection
// (avoids a self-referential hash); output_hashes cover the actual emitted bytes.
if (process.argv.includes("--build-staging")) {
  if (!result.ok) throw new Error("Gateway runtime bundle must be current before building");
  const outputIndex = process.argv.indexOf("--output-dir");
  const output = outputIndex < 0 ? "" : process.argv[outputIndex + 1];
  if (!output || !path.isAbsolute(output) || path.resolve(output).startsWith(`${repoRoot}${path.sep}`)) {
    throw new Error("An isolated absolute --output-dir outside the repository is required");
  }
  const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: repoRoot, encoding: "utf8" });
  if (dirty.trim()) throw new Error("Worker build requires a clean exact source commit");
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  const buildFiles = ["src/worker-staging.mjs", "src/gateway.mjs", "generated/route-policy.staging.json"];
  const sources = await Promise.all(buildFiles.map(async (name) => ({ path: name, content: await readNormalized(path.join(sourceRoot, name)) })));
  const identity = { source_sha: sourceSha, bundle_sha256: sha256(JSON.stringify(sources)) };
  await fs.mkdir(output, { recursive: false, mode: 0o700 });
  const outputs = [];
  for (const source of sources) {
    const content = source.path === "src/worker-staging.mjs"
      ? source.content.replace("/* WORKER_BUILD_IDENTITY */ null", JSON.stringify(identity)) : source.content;
    await fs.mkdir(path.dirname(path.join(output, source.path)), { recursive: true });
    await fs.writeFile(path.join(output, source.path), content, { flag: "wx" });
    outputs.push({ path: source.path, sha256: sha256(content) });
  }
  await fs.writeFile(path.join(output, "worker-build-manifest.json"), JSON.stringify({
    contract: "mad4b.staging-worker-build.v1", ...identity,
    digest_scope: "canonical_source_set_before_identity_injection",
    output_hashes: outputs, entrypoint: "src/worker-staging.mjs", deployment_performed: false,
  }, null, 2));
  console.log(JSON.stringify({ staging_build: identity, output_dir: output, deployment_performed: false }));
}
