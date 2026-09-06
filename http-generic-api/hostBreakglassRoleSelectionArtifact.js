import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { getGitHubAppInstallationToken } from "./githubAppAuth.js";
import { canonicalizeRoleSelection, computeRoleSelectionProofHash } from "./roleSelectionProof.js";

export const HOST_BREAKGLASS_ROLE_SELECTION_ARTIFACT_CONTRACT = "mad4b.host-breakglass-role-selection-proof.v1";
const SHA40 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_CORRELATION = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const INSPECTION_RUN = /^run:github:([1-9][0-9]{0,18})$/u;
const FINDING = /^finding:[0-9a-f]{16,64}$/u;
const ROLE_ORDER = Object.freeze(["runtime", "governance", "runtime_persistence"]);
const WORKFLOW = "production-runtime-parity-evidence.yml";
const MAX_ZIP_BYTES = 2 * 1024 * 1024;
const MAX_PROOF_BYTES = 64 * 1024;
const MAX_RESULT_BYTES = 128 * 1024;
const MAX_ARTIFACT_AGE_MS = 24 * 60 * 60 * 1000;

function text(value, max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function fail(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
  throw error;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === "string" ? value : JSON.stringify(stable(value)), "utf8");
  return createHash("sha256").update(bytes).digest("hex");
}

async function resolveToken({ env = process.env, fetchImpl = fetch, tokenResolver = getGitHubAppInstallationToken } = {}) {
  const direct = text(env.RUNTIME_BREAKGLASS_GITHUB_TOKEN, 4096);
  if (direct) return direct;
  try {
    const token = await tokenResolver({
      action: {
        github_app_id: env.RUNTIME_BREAKGLASS_GITHUB_APP_ID || env.GITHUB_APP_ID,
        github_app_installation_id: env.RUNTIME_BREAKGLASS_GITHUB_APP_INSTALLATION_ID || env.GITHUB_APP_INSTALLATION_ID,
        secret_store_ref: env.RUNTIME_BREAKGLASS_GITHUB_APP_PRIVATE_KEY_REF || "",
      },
      fetchImpl,
    });
    if (token) return String(token);
  } catch (error) {
    fail(503, "host_breakglass_role_selection_provenance_unavailable", "The GitHub artifact proof authority is unavailable.", { cause_code: error?.code || "github_artifact_auth_failed" });
  }
  fail(503, "host_breakglass_role_selection_provenance_unavailable", "The GitHub artifact proof authority is not configured.");
}

async function githubJson(pathname, { token, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`https://api.github.com${pathname}`, {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "mad4b-host-breakglass-proof-resolver" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) fail(response.status >= 500 ? 502 : response.status, "host_breakglass_role_selection_github_request_failed", "GitHub durable proof lookup failed.", { upstream_status: response.status, github_message: payload?.message || null });
  return payload;
}

async function githubZip(pathname, { token, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`https://api.github.com${pathname}`, {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "mad4b-host-breakglass-proof-resolver" },
    redirect: "follow",
  });
  if (!response.ok) fail(response.status >= 500 ? 502 : response.status, "host_breakglass_role_selection_artifact_download_failed", "GitHub durable proof artifact download failed.", { upstream_status: response.status });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_ZIP_BYTES) fail(409, "host_breakglass_role_selection_artifact_invalid", "Durable proof artifact ZIP is empty or exceeds the bounded size limit.");
  return buffer;
}

function findEocd(zip) {
  const minimum = Math.max(0, zip.length - 65557);
  for (let offset = zip.length - 22; offset >= minimum; offset -= 1) if (zip.readUInt32LE(offset) === 0x06054b50) return offset;
  return -1;
}

function extractZipEntry(zip, expectedName, maxBytes = MAX_PROOF_BYTES) {
  const eocd = findEocd(zip);
  if (eocd < 0) fail(409, "host_breakglass_role_selection_artifact_invalid", "Durable proof artifact ZIP has no valid central directory.");
  const entryCount = zip.readUInt16LE(eocd + 10);
  const centralSize = zip.readUInt32LE(eocd + 12);
  const centralOffset = zip.readUInt32LE(eocd + 16);
  if (entryCount < 1 || entryCount > 32 || centralOffset + centralSize > eocd) fail(409, "host_breakglass_role_selection_artifact_invalid", "Durable proof artifact ZIP directory is outside the bounded contract.");
  let cursor = centralOffset;
  const matches = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > zip.length || zip.readUInt32LE(cursor) !== 0x02014b50) fail(409, "host_breakglass_role_selection_artifact_invalid", "Durable proof artifact ZIP central entry is invalid.");
    const flags = zip.readUInt16LE(cursor + 8);
    const method = zip.readUInt16LE(cursor + 10);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const uncompressedSize = zip.readUInt32LE(cursor + 24);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd + extraLength + commentLength > zip.length) fail(409, "host_breakglass_role_selection_artifact_invalid", "Durable proof artifact ZIP entry exceeds its directory bounds.");
    const name = zip.subarray(nameStart, nameEnd).toString("utf8");
    if (name === expectedName) matches.push({ flags, method, compressedSize, uncompressedSize, localOffset });
    cursor = nameEnd + extraLength + commentLength;
  }
  if (matches.length !== 1) fail(409, "host_breakglass_role_selection_artifact_invalid", "Durable proof artifact must contain exactly one canonical evidence file.", { expected_name: expectedName, match_count: matches.length });
  const entry = matches[0];
  if ((entry.flags & 0x1) !== 0 || ![0, 8].includes(entry.method) || entry.uncompressedSize < 1 || entry.uncompressedSize > maxBytes || entry.compressedSize > MAX_ZIP_BYTES) fail(409, "host_breakglass_role_selection_artifact_invalid", "Durable proof artifact entry uses an unsupported or unsafe ZIP representation.");
  if (entry.localOffset + 30 > zip.length || zip.readUInt32LE(entry.localOffset) !== 0x04034b50) fail(409, "host_breakglass_role_selection_artifact_invalid", "Durable proof artifact local header is invalid.");
  const localNameLength = zip.readUInt16LE(entry.localOffset + 26);
  const localExtraLength = zip.readUInt16LE(entry.localOffset + 28);
  const dataStart = entry.localOffset + 30 + localNameLength + localExtraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > zip.length) fail(409, "host_breakglass_role_selection_artifact_invalid", "Durable proof artifact entry data exceeds ZIP bounds.");
  const compressed = zip.subarray(dataStart, dataEnd);
  let output;
  try {
    output = entry.method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: maxBytes });
  } catch {
    fail(409, "host_breakglass_role_selection_artifact_invalid", "Durable proof artifact entry could not be decompressed safely.");
  }
  if (output.length !== entry.uncompressedSize || output.length > maxBytes) fail(409, "host_breakglass_role_selection_artifact_invalid", "Durable proof artifact entry size does not match its central directory.");
  return output;
}

function deriveProofFromResult(result, { expectedSha, targetKey, runId, correlationId, artifactCreatedAt, now = Date.now() } = {}) {
  if (!result || typeof result !== "object" || Array.isArray(result)) fail(409, "host_breakglass_role_selection_artifact_invalid", "Full-inspection result is not a JSON object.");
  if (result.secrets_included !== false || result.database_mutation_performed !== false || result.migration_apply_performed !== false || result.grant_mutation_performed !== false || result.mode !== "dry_run" || result.operation !== "read_only" || result.full_inspection !== true) {
    fail(409, "host_breakglass_role_selection_artifact_invalid", "Durable role-selection proof requires a no-secret, read-only full inspection.");
  }
  if (text(result.source_binding?.expected_sha || result.source_binding?.repository_sha || expectedSha, 64).toLowerCase() !== expectedSha) fail(409, "host_breakglass_role_selection_sha_mismatch", "Full-inspection artifact is bound to a different source SHA.");
  if (text(result.target_key, 128) !== targetKey) fail(409, "host_breakglass_role_selection_target_mismatch", "Full-inspection artifact is bound to a different target key.");
  const selectedRoles = canonicalizeRoleSelection(result.selected_rebuild_roles);
  if (!selectedRoles.length) fail(409, "host_breakglass_role_selection_no_zero_object_roles", "Full inspection did not identify any selected zero-object role.");
  const classifications = result.role_database_object_classifications && typeof result.role_database_object_classifications === "object" ? result.role_database_object_classifications : {};
  const counts = result.role_database_object_counts && typeof result.role_database_object_counts === "object" ? result.role_database_object_counts : {};
  const fingerprints = result.role_database_object_count_fingerprints && typeof result.role_database_object_count_fingerprints === "object" ? result.role_database_object_count_fingerprints : {};
  const roleObjectCountFingerprints = {};
  const selectedRoleCounts = {};
  const selectedRoleClassifications = {};
  for (const role of selectedRoles) {
    if (!ROLE_ORDER.includes(role) || classifications[role] !== "zero_objects" || Number(counts?.[role]?.total) !== 0) fail(409, "host_breakglass_role_selection_nonzero_role", "A selected rebuild role is not proven zero-object by the durable inspection artifact.", { role });
    const fingerprint = text(fingerprints[role], 128).toLowerCase();
    if (!SHA256.test(fingerprint)) fail(409, "host_breakglass_role_selection_fingerprint_invalid", "A selected rebuild role lacks a canonical object-count fingerprint.", { role });
    roleObjectCountFingerprints[role] = fingerprint;
    selectedRoleCounts[role] = { total: Number(counts[role].total), tables: Number(counts[role].tables || 0), views: Number(counts[role].views || 0), triggers: Number(counts[role].triggers || 0), routines: Number(counts[role].routines || 0), events: Number(counts[role].events || 0) };
    selectedRoleClassifications[role] = classifications[role];
  }
  const compositeTargetFingerprint = text(result.target_binding?.target_fingerprint, 128).toLowerCase();
  if (!SHA256.test(compositeTargetFingerprint)) fail(409, "host_breakglass_role_selection_target_fingerprint_invalid", "Full-inspection artifact lacks a canonical target fingerprint.");
  const generatedAtMs = Date.parse(artifactCreatedAt || "");
  if (!Number.isFinite(generatedAtMs) || Number(now) - generatedAtMs > MAX_ARTIFACT_AGE_MS || generatedAtMs > Number(now) + 60_000) fail(409, "host_breakglass_role_selection_artifact_expired", "Full-inspection artifact is stale or has an invalid creation time.");
  const evidenceProjection = {
    contract: "mad4b.host-breakglass-full-inspection-evidence.v1",
    expected_sha: expectedSha,
    target_key: targetKey,
    workflow_run_id: String(runId),
    correlation_id: correlationId,
    selected_roles: selectedRoles,
    role_database_object_counts: selectedRoleCounts,
    role_database_object_classifications: selectedRoleClassifications,
    role_database_object_count_fingerprints: roleObjectCountFingerprints,
    composite_target_fingerprint: compositeTargetFingerprint,
    role_selection_source: text(result.role_selection_source, 96),
    database_mutation_performed: false,
    secrets_included: false,
  };
  const inspectionEvidenceHash = sha256(evidenceProjection);
  const findingIds = selectedRoles.map((role) => `finding:${sha256({ expected_sha: expectedSha, inspection_evidence_hash: inspectionEvidenceHash, role, classification: "zero_objects" }).slice(0, 32)}`).sort();
  const proof = {
    contract: HOST_BREAKGLASS_ROLE_SELECTION_ARTIFACT_CONTRACT,
    source: "durable_full_inspection",
    expected_sha: expectedSha,
    target_key: targetKey,
    correlation_id: correlationId,
    workflow_run_id: String(runId),
    inspection_run_id: `run:github:${runId}`,
    inspection_evidence_hash: inspectionEvidenceHash,
    finding_ids: findingIds,
    selected_roles: selectedRoles,
    role_object_count_fingerprints: roleObjectCountFingerprints,
    composite_target_fingerprint: compositeTargetFingerprint,
    role_database_object_counts: selectedRoleCounts,
    role_database_object_classifications: selectedRoleClassifications,
    generated_at: new Date(generatedAtMs).toISOString(),
    expires_at: new Date(generatedAtMs + MAX_ARTIFACT_AGE_MS).toISOString(),
    database_mutation_performed: false,
    secrets_included: false,
  };
  return { ...proof, selection_hash: computeRoleSelectionProofHash(proof) };
}

function validateCanonicalProof(proof, expected = {}, now = Date.now()) {
  if (!proof || typeof proof !== "object" || Array.isArray(proof) || proof.contract !== HOST_BREAKGLASS_ROLE_SELECTION_ARTIFACT_CONTRACT || proof.source !== "durable_full_inspection" || proof.secrets_included !== false || proof.database_mutation_performed !== false) fail(409, "host_breakglass_role_selection_artifact_invalid", "Durable role-selection proof envelope is invalid.");
  if (!SHA40.test(text(proof.expected_sha, 64).toLowerCase()) || text(proof.expected_sha, 64).toLowerCase() !== expected.expected_sha) fail(409, "host_breakglass_role_selection_sha_mismatch", "Durable role-selection proof is bound to a different source SHA.");
  if (text(proof.target_key, 128) !== expected.target_key || text(proof.inspection_run_id, 128) !== `run:github:${expected.run_id}` || text(proof.workflow_run_id, 32) !== String(expected.run_id) || text(proof.correlation_id, 128) !== expected.correlation_id) fail(409, "host_breakglass_role_selection_provenance_mismatch", "Durable role-selection proof run/target binding does not match the resolved GitHub evidence.");
  if (!SHA256.test(text(proof.inspection_evidence_hash, 128).toLowerCase()) || !SHA256.test(text(proof.composite_target_fingerprint, 128).toLowerCase())) fail(409, "host_breakglass_role_selection_artifact_invalid", "Durable role-selection proof digest fields are invalid.");
  const selectedRoles = canonicalizeRoleSelection(proof.selected_roles);
  if (!selectedRoles.length || JSON.stringify(selectedRoles) !== JSON.stringify(proof.selected_roles)) fail(409, "host_breakglass_role_selection_artifact_invalid", "Durable role-selection proof roles are not canonical.");
  for (const role of selectedRoles) {
    if (proof.role_database_object_classifications?.[role] !== "zero_objects" || Number(proof.role_database_object_counts?.[role]?.total) !== 0 || !SHA256.test(text(proof.role_object_count_fingerprints?.[role], 128).toLowerCase())) fail(409, "host_breakglass_role_selection_nonzero_role", "Durable role-selection proof contains a selected role without zero-object evidence.", { role });
  }
  if (!Array.isArray(proof.finding_ids) || !proof.finding_ids.length || proof.finding_ids.some((id) => !FINDING.test(String(id)))) fail(409, "host_breakglass_role_selection_artifact_invalid", "Durable role-selection proof finding references are invalid.");
  if (Date.parse(proof.expires_at || 0) <= Number(now)) fail(409, "host_breakglass_role_selection_artifact_expired", "Durable role-selection proof has expired.");
  const selectionHash = computeRoleSelectionProofHash({ ...proof, selected_roles: selectedRoles });
  if (text(proof.selection_hash, 128).toLowerCase() !== selectionHash) fail(409, "host_breakglass_role_selection_hash_invalid", "Durable role-selection proof hash is not canonical.");
  return { ...proof, selected_roles: selectedRoles, selection_hash: selectionHash };
}

export async function resolveDurableRoleSelectionProof(input = {}, {
  repository = "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
  env = process.env,
  fetchImpl = fetch,
  tokenResolver = getGitHubAppInstallationToken,
  now = Date.now(),
} = {}) {
  const expectedSha = text(input.expected_sha, 64).toLowerCase();
  const targetKey = text(input.target_key || "production-runtime", 128);
  const environmentKey = text(input.environment_key || "production_hostinger_autodeploy", 64);
  if (environmentKey !== "production_hostinger_autodeploy" || input.operation_key !== "database.rebuild_empty" || input.action !== "apply_migration") fail(403, "host_breakglass_role_selection_provenance_unavailable", "Durable role-selection artifacts are restricted to Production selected-role rebuild apply.");
  if (!SHA40.test(expectedSha)) fail(400, "host_breakglass_expected_sha_invalid", "expected_sha must be a lowercase 40-character SHA.");
  const inspectionRunId = text(input.role_selection_proof?.inspection_run_id || input.inspection_run_id, 128);
  const runMatch = inspectionRunId.match(INSPECTION_RUN);
  if (!runMatch) fail(503, "host_breakglass_role_selection_provenance_unavailable", "Role-selective apply requires a durable GitHub full-inspection run reference.");
  const runId = runMatch[1];
  const token = await resolveToken({ env, fetchImpl, tokenResolver });
  const [owner, repo] = repository.split("/");
  const run = await githubJson(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${encodeURIComponent(runId)}`, { token, fetchImpl });
  const runName = text(run.display_title || run.run_name, 512);
  const suffix = `-${expectedSha}`;
  const prefix = "runtime-breakglass-";
  const correlationId = runName.startsWith(prefix) && runName.endsWith(suffix) ? runName.slice(prefix.length, -suffix.length) : "";
  if (String(run.id) !== String(runId) || !String(run.path || "").endsWith(WORKFLOW) || run.event !== "workflow_dispatch" || run.head_branch !== "main" || run.status !== "completed" || run.conclusion !== "success" || !SAFE_CORRELATION.test(correlationId)) fail(409, "host_breakglass_role_selection_provenance_mismatch", "Referenced GitHub run is not the canonical successful full-inspection authority for this SHA.");
  const artifacts = await githubJson(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${encodeURIComponent(runId)}/artifacts?per_page=100`, { token, fetchImpl });
  const expectedArtifactName = `production-runtime-bootstrap-dry_run-${expectedSha}-${runId}`;
  const matches = (Array.isArray(artifacts.artifacts) ? artifacts.artifacts : []).filter((artifact) => artifact?.name === expectedArtifactName && artifact?.expired !== true);
  if (matches.length !== 1) fail(409, matches.length ? "host_breakglass_role_selection_artifact_ambiguous" : "host_breakglass_role_selection_artifact_missing", "Exactly one non-expired durable full-inspection artifact is required.", { artifact_name: expectedArtifactName, candidate_count: matches.length });
  const artifact = matches[0];
  const createdAt = artifact.created_at || run.updated_at || run.created_at;
  const zip = await githubZip(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/artifacts/${encodeURIComponent(String(artifact.id))}/zip`, { token, fetchImpl });
  let proof;
  try {
    proof = JSON.parse(extractZipEntry(zip, "role-selection-proof.json", MAX_PROOF_BYTES).toString("utf8"));
  } catch (error) {
    if (error?.code) throw error;
    const rawResult = extractZipEntry(zip, "result.json", MAX_RESULT_BYTES);
    let result;
    try { result = JSON.parse(rawResult.toString("utf8")); } catch { fail(409, "host_breakglass_role_selection_artifact_invalid", "Durable full-inspection result JSON is invalid."); }
    proof = deriveProofFromResult(result, { expectedSha, targetKey, runId, correlationId, artifactCreatedAt: createdAt, now });
  }
  return validateCanonicalProof(proof, { expected_sha: expectedSha, target_key: targetKey, run_id: runId, correlation_id: correlationId }, now);
}

export const __hostBreakglassRoleSelectionArtifactTest = Object.freeze({ extractZipEntry, deriveProofFromResult, validateCanonicalProof, sha256 });
