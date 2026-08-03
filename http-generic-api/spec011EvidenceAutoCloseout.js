import { createHash } from "node:crypto";
import { buildStructuredDiagnosis, validateStructuredDiagnosis } from "./spec011Phase5ValidationCi.js";
import { previewOperation } from "./operationOrchestrator.js";

export const SPEC011_EVIDENCE_AUTO_CLOSEOUT_VERSION = "spec011-evidence-auto-closeout-v1";
export const CLOSEOUT_CONFIRMATION = "CREATE_GOVERNED_CLOSEOUT_PR";

export const CLOSEOUT_DOCUMENT_KINDS = Object.freeze([
  "manifest_json",
  "completion_json",
  "checklist_markdown",
  "tasks_markdown",
  "delivery_state_json",
]);

export const AUTHORITATIVE_EVIDENCE_FAMILIES = Object.freeze([
  "pull_request",
  "workflow_run",
  "workflow_artifact",
  "main_readback",
  "migration_ledger",
  "production_parity",
  "post_merge_audit",
]);

const REQUIRED_DOCUMENT_KINDS = new Set(CLOSEOUT_DOCUMENT_KINDS);
const EVIDENCE_FAMILY_SET = new Set(AUTHORITATIVE_EVIDENCE_FAMILIES);
const PASS_STATUSES = new Set(["pass", "success", "verified", "merged", "complete", "complete_on_main"]);
const HASH_40 = /^[0-9a-f]{40}$/;
const HASH_64 = /^[0-9a-f]{64}$/;
const TASK_ID_PATTERN = /^T\d{3}$/;
const MAX_DOCUMENT_BYTES = 768 * 1024;
const MAX_CHANGESET_BYTES = 2 * 1024 * 1024;
const MAX_EVIDENCE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const SECRET_KEY_PATTERN = /(?:^|_)(?:password|passwd|secret(?!s_included$)|token|credential|private[_-]?key|client[_-]?secret|api[_-]?key|authorization|cookie|session)(?:$|_)/i;
const SECRET_VALUE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+\-/]+=*/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b(?:ghp_|github_pat_|ya29\.)[A-Za-z0-9_.\-]+\b/,
];
const FAMILY_SOURCE_PREFIXES = Object.freeze({
  pull_request: ["github://pull/"],
  workflow_run: ["github://actions/run/"],
  workflow_artifact: ["github://actions/artifact/"],
  main_readback: ["git://blob/", "github://contents/"],
  migration_ledger: ["migration://ledger/"],
  production_parity: ["production://parity/", "runtime://readback/"],
  post_merge_audit: ["audit://post-merge/", "github://pull/"],
});

function closeoutError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function compact(value, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sha256(value) {
  const bytes = typeof value === "string" ? value : JSON.stringify(stable(value));
  return createHash("sha256").update(bytes).digest("hex");
}

function assertSecretFree(value, path = "input", depth = 0) {
  if (depth > 14) throw closeoutError("CLOSEOUT_INPUT_DEPTH_EXCEEDED", "Closeout input exceeds maximum depth.", { path });
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      throw closeoutError("CLOSEOUT_SECRET_VALUE_REJECTED", `Secret-like value is not allowed at ${path}.`, { path });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSecretFree(entry, `${path}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key) && key !== "secrets_included") {
      throw closeoutError("CLOSEOUT_SECRET_FIELD_REJECTED", `Secret-like field is not allowed at ${path}.${key}.`, {
        path: `${path}.${key}`,
      });
    }
    assertSecretFree(nested, `${path}.${key}`, depth + 1);
  }
}

function normalizeGitSha(value, field) {
  const sha = compact(value, 40).toLowerCase();
  if (!HASH_40.test(sha)) throw closeoutError("CLOSEOUT_GIT_SHA_INVALID", `${field} must be a 40-character Git SHA.`, { field });
  return sha;
}

function normalizeSha256(value, field) {
  const digest = compact(value, 64).toLowerCase();
  if (!HASH_64.test(digest)) throw closeoutError("CLOSEOUT_DIGEST_INVALID", `${field} must be a SHA-256 digest.`, { field });
  return digest;
}

function normalizeIso(value, field) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw closeoutError("CLOSEOUT_TIMESTAMP_INVALID", `${field} must be a valid timestamp.`, { field });
  return date.toISOString();
}

function uniqueStrings(values, max = 500) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => compact(value, max)).filter(Boolean))].sort();
}

function sourceRefAllowed(family, sourceRef) {
  return (FAMILY_SOURCE_PREFIXES[family] || []).some((prefix) => sourceRef.startsWith(prefix));
}

function normalizeEvidenceObservation(entry = {}, { now, maxAgeMs, subject } = {}) {
  assertSecretFree(entry, "evidence");
  const family = compact(entry.family, 64).toLowerCase();
  if (!EVIDENCE_FAMILY_SET.has(family)) {
    throw closeoutError("CLOSEOUT_EVIDENCE_FAMILY_INVALID", "Evidence family is not authoritative for closeout.", { family });
  }
  const evidenceId = compact(entry.evidence_id, 191);
  const sourceRef = compact(entry.source_ref, 1000);
  const observedAt = normalizeIso(entry.observed_at, "observed_at");
  const status = compact(entry.status, 64).toLowerCase();
  const normalizedSubject = compact(entry.subject, 300);
  if (!evidenceId || !sourceRef || !normalizedSubject) {
    throw closeoutError("CLOSEOUT_EVIDENCE_IDENTITY_REQUIRED", "Evidence id, source ref, and subject are required.", { family });
  }
  if (normalizedSubject !== subject) {
    throw closeoutError("CLOSEOUT_EVIDENCE_SUBJECT_MISMATCH", "Evidence belongs to a different closeout subject.", {
      expected_subject: subject,
      observed_subject: normalizedSubject,
      evidence_id: evidenceId,
    });
  }
  if (!sourceRefAllowed(family, sourceRef)) {
    throw closeoutError("CLOSEOUT_EVIDENCE_SOURCE_NOT_AUTHORITATIVE", "Evidence source reference is not authoritative for its family.", {
      family,
      source_ref: sourceRef,
    });
  }
  if (!PASS_STATUSES.has(status)) {
    throw closeoutError("CLOSEOUT_EVIDENCE_STATUS_NOT_PASS", "Only passing or verified evidence may close work.", {
      evidence_id: evidenceId,
      status,
    });
  }
  if (entry.authoritative !== true || entry.immutable !== true || entry.secrets_included !== false) {
    throw closeoutError("CLOSEOUT_EVIDENCE_BOUNDARY_INVALID", "Evidence must be authoritative, immutable, and secret-free.", {
      evidence_id: evidenceId,
    });
  }
  const ageMs = now.getTime() - new Date(observedAt).getTime();
  if (ageMs < -5 * 60 * 1000 || ageMs > maxAgeMs) {
    throw closeoutError("CLOSEOUT_EVIDENCE_STALE", "Evidence is outside the accepted observation window.", {
      evidence_id: evidenceId,
      age_ms: ageMs,
      max_age_ms: maxAgeMs,
    });
  }
  return Object.freeze({
    evidence_id: evidenceId,
    family,
    subject: normalizedSubject,
    source_ref: sourceRef,
    digest_sha256: normalizeSha256(entry.digest_sha256, "digest_sha256"),
    observed_at: observedAt,
    status,
    authoritative: true,
    immutable: true,
    payload: stable(entry.payload || {}),
    secrets_included: false,
  });
}

export async function collectAuthoritativeEvidence({
  subject,
  required_families = ["pull_request", "workflow_run", "workflow_artifact", "main_readback"],
  optional_families = [],
  max_age_ms = MAX_EVIDENCE_AGE_MS,
  now = new Date(),
} = {}, { readers = {} } = {}) {
  const normalizedSubject = compact(subject, 300);
  if (!normalizedSubject) throw closeoutError("CLOSEOUT_SUBJECT_REQUIRED", "subject is required.");
  const required = uniqueStrings(required_families, 64);
  const optional = uniqueStrings(optional_families, 64).filter((family) => !required.includes(family));
  for (const family of [...required, ...optional]) {
    if (!EVIDENCE_FAMILY_SET.has(family)) throw closeoutError("CLOSEOUT_EVIDENCE_FAMILY_INVALID", "Unknown evidence family.", { family });
  }
  const observations = [];
  for (const family of [...required, ...optional]) {
    const reader = readers[family];
    if (typeof reader !== "function") {
      if (required.includes(family)) throw closeoutError("CLOSEOUT_EVIDENCE_READER_REQUIRED", "Required evidence reader is unavailable.", { family });
      continue;
    }
    const result = await reader({ subject: normalizedSubject, family, secrets_included: false });
    const rows = Array.isArray(result) ? result : result ? [result] : [];
    if (required.includes(family) && rows.length !== 1) {
      throw closeoutError("CLOSEOUT_EVIDENCE_CARDINALITY_INVALID", "Each required evidence family must resolve exactly once.", {
        family,
        observed_count: rows.length,
      });
    }
    for (const row of rows) observations.push(normalizeEvidenceObservation(row, {
      now: now instanceof Date ? now : new Date(now),
      maxAgeMs: Math.max(60_000, Math.min(MAX_EVIDENCE_AGE_MS, Number(max_age_ms) || MAX_EVIDENCE_AGE_MS)),
      subject: normalizedSubject,
    }));
  }
  const ids = observations.map((entry) => entry.evidence_id);
  if (new Set(ids).size !== ids.length) throw closeoutError("CLOSEOUT_EVIDENCE_ID_DUPLICATE", "Evidence ids must be unique.");
  for (const family of required) {
    if (!observations.some((entry) => entry.family === family)) {
      throw closeoutError("CLOSEOUT_EVIDENCE_FAMILY_MISSING", "Required evidence family is missing.", { family });
    }
  }
  const sorted = observations.sort((a, b) => a.family.localeCompare(b.family) || a.evidence_id.localeCompare(b.evidence_id));
  const packet = {
    schema_version: 1,
    version: SPEC011_EVIDENCE_AUTO_CLOSEOUT_VERSION,
    subject: normalizedSubject,
    required_families: required,
    optional_families: optional,
    observations: sorted,
    collected_at: (now instanceof Date ? now : new Date(now)).toISOString(),
    secrets_included: false,
  };
  assertSecretFree(packet, "evidence_packet");
  return Object.freeze({ ...packet, evidence_fingerprint_sha256: sha256(packet) });
}

function normalizeDocument(document = {}) {
  const kind = compact(document.kind, 64).toLowerCase();
  if (!REQUIRED_DOCUMENT_KINDS.has(kind)) throw closeoutError("CLOSEOUT_DOCUMENT_KIND_INVALID", "Unsupported closeout document kind.", { kind });
  const path = compact(document.path, 500).replace(/^\/+/, "");
  const content = String(document.content ?? "");
  if (!path || path.includes("..") || path.startsWith(".git/")) throw closeoutError("CLOSEOUT_DOCUMENT_PATH_INVALID", "Document path is invalid.", { path });
  if (!content || Buffer.byteLength(content) > MAX_DOCUMENT_BYTES) {
    throw closeoutError("CLOSEOUT_DOCUMENT_SIZE_INVALID", "Document content is empty or exceeds the bounded size.", {
      path,
      bytes: Buffer.byteLength(content),
    });
  }
  if (["manifest_json", "completion_json", "delivery_state_json"].includes(kind)) {
    try { JSON.parse(content); } catch {
      throw closeoutError("CLOSEOUT_DOCUMENT_JSON_INVALID", "Structured closeout document is not valid JSON.", { path, kind });
    }
  }
  if (kind === "manifest_json" && !path.endsWith("manifest.json")) throw closeoutError("CLOSEOUT_MANIFEST_PATH_INVALID", "Manifest document path must end in manifest.json.", { path });
  if (kind === "completion_json" && !path.endsWith("completion.json")) throw closeoutError("CLOSEOUT_COMPLETION_PATH_INVALID", "Completion document path must end in completion.json.", { path });
  if (kind === "tasks_markdown" && !path.endsWith("tasks.md")) throw closeoutError("CLOSEOUT_TASKS_PATH_INVALID", "Tasks document path must end in tasks.md.", { path });
  if (kind === "checklist_markdown" && !path.includes("/checklists/") && !path.endsWith("checklist.md")) {
    throw closeoutError("CLOSEOUT_CHECKLIST_PATH_INVALID", "Checklist document must use a governed checklist path.", { path });
  }
  return {
    kind,
    path,
    content,
    blob_sha: normalizeGitSha(document.blob_sha, `${kind}.blob_sha`),
    content_sha256: sha256(content),
  };
}

function parsePointer(pointer) {
  const value = compact(pointer, 1000);
  if (!value.startsWith("/") || value.includes("//")) throw closeoutError("CLOSEOUT_JSON_POINTER_INVALID", "A valid JSON Pointer is required.", { pointer: value });
  return value.slice(1).split("/").map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function setPointer(root, pointer, value) {
  const segments = parsePointer(pointer);
  let current = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (!current[segment] || typeof current[segment] !== "object" || Array.isArray(current[segment])) current[segment] = {};
    current = current[segment];
  }
  current[segments.at(-1)] = stable(value);
}

function evidenceIndex(packet) {
  return new Map(packet.observations.map((entry) => [entry.evidence_id, entry]));
}

function requireEvidenceRefs(refs, index, context) {
  const ids = uniqueStrings(refs, 191);
  if (!ids.length) throw closeoutError("CLOSEOUT_EVIDENCE_REFERENCE_REQUIRED", "Every semantic mutation requires evidence references.", { context });
  for (const id of ids) {
    if (!index.has(id)) throw closeoutError("CLOSEOUT_EVIDENCE_REFERENCE_UNKNOWN", "Semantic mutation references unknown evidence.", { context, evidence_id: id });
  }
  return ids;
}

function toggleMarkdownItem(content, item, { task = false } = {}) {
  const target = compact(item, 500);
  const lines = content.split("\n");
  const matcher = task
    ? new RegExp(`^- \\[([ xX])\\] ${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`)
    : new RegExp(`^- \\[([ xX])\\] ${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  const matches = lines.map((line, index) => matcher.test(line) ? index : -1).filter((index) => index >= 0);
  if (matches.length !== 1) {
    throw closeoutError("CLOSEOUT_MARKDOWN_ANCHOR_AMBIGUOUS", "Markdown closeout item must resolve exactly once.", {
      item: target,
      match_count: matches.length,
    });
  }
  const index = matches[0];
  lines[index] = lines[index].replace(/^- \[[ xX]\]/, "- [x]");
  return lines.join("\n");
}

function allTasksComplete(content) {
  return !content.split("\n").some((line) => /^- \[ \] T\d{3}\b/.test(line));
}

function terminalEvidenceReady(packet) {
  const families = new Set(packet.observations.map((entry) => entry.family));
  return ["migration_ledger", "production_parity", "post_merge_audit"].every((family) => families.has(family));
}

function normalizeMutationEntries(entries = [], context, index) {
  return (Array.isArray(entries) ? entries : []).map((entry, position) => ({
    pointer: compact(entry.pointer, 1000),
    value: stable(entry.value),
    evidence_ids: requireEvidenceRefs(entry.evidence_ids, index, `${context}[${position}]`),
  }));
}

export function generateCloseoutChangeSet({ documents = [], intent = {}, evidence_packet } = {}) {
  assertSecretFree(intent, "closeout_intent");
  if (!evidence_packet || evidence_packet.version !== SPEC011_EVIDENCE_AUTO_CLOSEOUT_VERSION) {
    throw closeoutError("CLOSEOUT_EVIDENCE_PACKET_REQUIRED", "A validated authoritative evidence packet is required.");
  }
  const normalizedDocuments = documents.map(normalizeDocument);
  const kinds = normalizedDocuments.map((document) => document.kind);
  if (new Set(kinds).size !== kinds.length) throw closeoutError("CLOSEOUT_DOCUMENT_KIND_DUPLICATE", "Each closeout document kind may appear once.");
  for (const kind of REQUIRED_DOCUMENT_KINDS) {
    if (!kinds.includes(kind)) throw closeoutError("CLOSEOUT_DOCUMENT_KIND_MISSING", "Closeout change set requires every governed document kind.", { kind });
  }
  const index = evidenceIndex(evidence_packet);
  const manifestUpdates = normalizeMutationEntries(intent.manifest_updates, "manifest_updates", index);
  const completionUpdates = normalizeMutationEntries(intent.completion_updates, "completion_updates", index);
  const deliveryUpdates = normalizeMutationEntries(intent.delivery_state_updates, "delivery_state_updates", index);
  const taskClosures = (Array.isArray(intent.task_closures) ? intent.task_closures : []).map((entry, position) => {
    const taskId = compact(entry.task_id, 16).toUpperCase();
    if (!TASK_ID_PATTERN.test(taskId)) throw closeoutError("CLOSEOUT_TASK_ID_INVALID", "Task closure requires a canonical task id.", { position, task_id: taskId });
    return { task_id: taskId, evidence_ids: requireEvidenceRefs(entry.evidence_ids, index, `task_closures[${position}]`) };
  });
  const checklistClosures = (Array.isArray(intent.checklist_closures) ? intent.checklist_closures : []).map((entry, position) => ({
    item: compact(entry.item, 500),
    evidence_ids: requireEvidenceRefs(entry.evidence_ids, index, `checklist_closures[${position}]`),
  }));
  if (![manifestUpdates, completionUpdates, deliveryUpdates, taskClosures, checklistClosures].some((entries) => entries.length)) {
    throw closeoutError("CLOSEOUT_INTENT_EMPTY", "Closeout intent must contain at least one semantic mutation.");
  }

  const changes = [];
  let tasksAfter = null;
  for (const document of normalizedDocuments) {
    let after = document.content;
    const operations = [];
    if (document.kind === "manifest_json") {
      const value = JSON.parse(after);
      for (const mutation of manifestUpdates) {
        setPointer(value, mutation.pointer, mutation.value);
        operations.push({ type: "json_pointer_set", pointer: mutation.pointer, evidence_ids: mutation.evidence_ids });
      }
      after = `${JSON.stringify(value, null, 2)}\n`;
    } else if (document.kind === "completion_json") {
      const value = JSON.parse(after);
      for (const mutation of completionUpdates) {
        setPointer(value, mutation.pointer, mutation.value);
        operations.push({ type: "json_pointer_set", pointer: mutation.pointer, evidence_ids: mutation.evidence_ids });
      }
      after = `${JSON.stringify(value, null, 2)}\n`;
    } else if (document.kind === "delivery_state_json") {
      const value = JSON.parse(after);
      for (const mutation of deliveryUpdates) {
        setPointer(value, mutation.pointer, mutation.value);
        operations.push({ type: "json_pointer_set", pointer: mutation.pointer, evidence_ids: mutation.evidence_ids });
      }
      after = `${JSON.stringify(value, null, 2)}\n`;
    } else if (document.kind === "tasks_markdown") {
      for (const closure of taskClosures) {
        after = toggleMarkdownItem(after, closure.task_id, { task: true });
        operations.push({ type: "markdown_task_complete", anchor: closure.task_id, evidence_ids: closure.evidence_ids });
      }
      tasksAfter = after;
    } else if (document.kind === "checklist_markdown") {
      for (const closure of checklistClosures) {
        after = toggleMarkdownItem(after, closure.item);
        operations.push({ type: "markdown_checklist_complete", anchor: closure.item, evidence_ids: closure.evidence_ids });
      }
    }
    if (after === document.content) continue;
    changes.push({
      kind: document.kind,
      path: document.path,
      expected_blob_sha: document.blob_sha,
      before_sha256: document.content_sha256,
      after_sha256: sha256(after),
      after_content: after,
      operations,
      semantic_mutation: true,
      parse_ok: true,
      bounded: Buffer.byteLength(after) <= MAX_DOCUMENT_BYTES,
      completion_contract_valid: document.kind !== "completion_json" || (() => {
        const parsed = JSON.parse(after);
        return parsed.schema_version === 1 && compact(parsed.feature_key, 300) !== "" && ["in_progress", "complete", "blocked"].includes(parsed.status);
      })(),
      secrets_included: false,
    });
  }
  const totalBytes = changes.reduce((sum, change) => sum + Buffer.byteLength(change.after_content), 0);
  if (!changes.length || totalBytes > MAX_CHANGESET_BYTES) {
    throw closeoutError("CLOSEOUT_CHANGESET_SIZE_INVALID", "Generated closeout change set is empty or exceeds the bounded size.", {
      change_count: changes.length,
      total_bytes: totalBytes,
    });
  }
  const requestsTerminal = [...manifestUpdates, ...completionUpdates, ...deliveryUpdates]
    .some((mutation) => mutation.pointer === "/status" && mutation.value === "complete");
  if (requestsTerminal && (!tasksAfter || !allTasksComplete(tasksAfter) || !terminalEvidenceReady(evidence_packet))) {
    throw closeoutError("CLOSEOUT_TERMINAL_COMPLETION_NOT_PROVEN", "Terminal completion requires every task plus migration, Production parity, and post-merge audit evidence.");
  }
  const changeSet = {
    schema_version: 1,
    version: SPEC011_EVIDENCE_AUTO_CLOSEOUT_VERSION,
    subject: evidence_packet.subject,
    evidence_fingerprint_sha256: evidence_packet.evidence_fingerprint_sha256,
    changes: changes.sort((a, b) => a.path.localeCompare(b.path)),
    total_bytes: totalBytes,
    force_push_allowed: false,
    protected_branch_write_allowed: false,
    secrets_included: false,
  };
  assertSecretFree(changeSet, "change_set");
  return Object.freeze({ ...changeSet, change_set_sha256: sha256(changeSet) });
}

export function validateCloseoutChangeSet(changeSet = {}) {
  const blockers = [];
  const changes = Array.isArray(changeSet.changes) ? changeSet.changes : [];
  const kinds = new Set(changes.map((change) => change.kind));
  if (changeSet.version !== SPEC011_EVIDENCE_AUTO_CLOSEOUT_VERSION) blockers.push("CLOSEOUT_VERSION_INVALID");
  if (!HASH_64.test(compact(changeSet.evidence_fingerprint_sha256, 64))) blockers.push("CLOSEOUT_EVIDENCE_FINGERPRINT_REQUIRED");
  if (!HASH_64.test(compact(changeSet.change_set_sha256, 64))) blockers.push("CLOSEOUT_CHANGESET_FINGERPRINT_REQUIRED");
  if (!changes.length || changes.length > 5) blockers.push("CLOSEOUT_CHANGE_COUNT_INVALID");
  if (Number(changeSet.total_bytes) > MAX_CHANGESET_BYTES) blockers.push("CLOSEOUT_CHANGESET_UNBOUNDED");
  for (const change of changes) {
    if (!REQUIRED_DOCUMENT_KINDS.has(change.kind)) blockers.push(`CLOSEOUT_KIND_INVALID:${change.kind || "missing"}`);
    if (!compact(change.path, 500)) blockers.push("CLOSEOUT_PATH_REQUIRED");
    if (!HASH_40.test(compact(change.expected_blob_sha, 40))) blockers.push(`CLOSEOUT_BLOB_SHA_INVALID:${change.path || "unknown"}`);
    if (!HASH_64.test(compact(change.before_sha256, 64)) || !HASH_64.test(compact(change.after_sha256, 64))) blockers.push(`CLOSEOUT_CONTENT_DIGEST_INVALID:${change.path || "unknown"}`);
    if (sha256(String(change.after_content ?? "")) !== change.after_sha256) blockers.push(`CLOSEOUT_AFTER_DIGEST_MISMATCH:${change.path || "unknown"}`);
    if (change.semantic_mutation !== true || !Array.isArray(change.operations) || change.operations.length === 0) blockers.push(`CLOSEOUT_SEMANTIC_OPERATION_REQUIRED:${change.path || "unknown"}`);
    if (change.parse_ok !== true || change.bounded !== true || change.secrets_included !== false) blockers.push(`CLOSEOUT_CHANGE_BOUNDARY_INVALID:${change.path || "unknown"}`);
    if (change.kind === "completion_json" && change.completion_contract_valid !== true) blockers.push(`CLOSEOUT_COMPLETION_CONTRACT_INVALID:${change.path || "unknown"}`);
    if (["manifest_json", "completion_json", "delivery_state_json"].includes(change.kind)) {
      try { JSON.parse(change.after_content); } catch { blockers.push(`CLOSEOUT_JSON_PARSE_FAILED:${change.path || "unknown"}`); }
    }
  }
  const diagnosis = buildStructuredDiagnosis({
    gateId: "evidence_auto_closeout_semantic_mutation",
    status: blockers.length ? "fail" : "pass",
    code: blockers.length ? "EVIDENCE_AUTO_CLOSEOUT_VALIDATION_FAILED" : "PASS",
    summary: "Validate authoritative evidence-bound closeout mutations before repository commit.",
    blockers: [...new Set(blockers)],
    evidenceRefs: [compact(changeSet.evidence_fingerprint_sha256, 64), compact(changeSet.change_set_sha256, 64)].filter(Boolean),
    remediation: blockers.length ? ["Regenerate the closeout change set from fresh authoritative evidence and exact repository blobs."] : [],
    metadata: { change_count: changes.length, kinds: [...kinds].sort(), total_bytes: Number(changeSet.total_bytes) || 0 },
  });
  const coverage = validateStructuredDiagnosis(diagnosis);
  return {
    ok: blockers.length === 0 && coverage.ok,
    status: blockers.length === 0 && coverage.ok ? "pass" : "fail",
    blockers: [...new Set([...blockers, ...coverage.blockers])],
    diagnosis,
    secrets_included: false,
  };
}

function unwrapToolResult(result) {
  let current = result;
  for (let depth = 0; depth < 8; depth += 1) {
    if (!current || typeof current !== "object") break;
    if (current.result && typeof current.result === "object") { current = current.result; continue; }
    if (current.body && typeof current.body === "object") { current = current.body; continue; }
    if (current.data && typeof current.data === "object") { current = current.data; continue; }
    break;
  }
  return current || {};
}

function normalizePatchReceipt(result, expectedPaths) {
  const raw = unwrapToolResult(result);
  const commitSha = compact(raw.commit_sha || raw.head_sha || raw.branch_sha, 40).toLowerCase();
  const changedFiles = uniqueStrings(raw.changed_files || raw.paths || [], 500);
  const unknown = raw.unknown_outcome === true || raw.status === "unknown_outcome";
  if (unknown) return { status: "reconciliation_required", unknown_outcome: true, secrets_included: false };
  if (raw.ok === false || !HASH_40.test(commitSha) || raw.readback_verified !== true || raw.force_push_used === true) {
    throw closeoutError("CLOSEOUT_PATCH_RECEIPT_INVALID", "Atomic repository patch did not return an exact verified receipt.", {
      commit_sha: commitSha || null,
      readback_verified: raw.readback_verified === true,
      force_push_used: raw.force_push_used === true,
    });
  }
  const missing = expectedPaths.filter((path) => !changedFiles.includes(path));
  if (missing.length) throw closeoutError("CLOSEOUT_PATCH_READBACK_INCOMPLETE", "Patch receipt does not cover every generated path.", { missing_paths: missing });
  return { status: "completed", commit_sha: commitSha, changed_files: changedFiles, readback_verified: true, force_push_used: false, secrets_included: false };
}

async function dispatchEndpoint(dispatch, endpointKey, { owner, repo, path_params = {}, query = {}, body, mutation_approval, preflight_only = false } = {}) {
  return dispatch("github_rest_endpoint_dispatch", {
    tool_args: {
      parent_action_key: "github_api_mcp",
      endpoint_key: endpointKey,
      path_params: { owner, repo, ...path_params },
      query,
      ...(body === undefined ? {} : { body }),
      credential_scope: "platform",
      mutation_approval,
      preflight_only,
      readback_required: true,
      secrets_included: false,
    },
  });
}

async function reconcilePullRequestCreation({ dispatch, owner, repo, branch, base, expectedHeadSha }) {
  const list = await dispatchEndpoint(dispatch, "github_list_pull_requests", {
    owner,
    repo,
    query: { state: "open", head: `${owner}:${branch}`, base, per_page: 10 },
  });
  const raw = unwrapToolResult(list);
  const rows = Array.isArray(raw) ? raw : Array.isArray(raw.items) ? raw.items : Array.isArray(raw.pull_requests) ? raw.pull_requests : [];
  const matches = rows.filter((pr) => compact(pr?.head?.ref || pr?.head_ref, 255) === branch
    && compact(pr?.base?.ref || pr?.base_ref, 255) === base
    && compact(pr?.head?.sha || pr?.head_sha, 40).toLowerCase() === expectedHeadSha);
  if (matches.length === 1) return { status: "recovered", pull_request: matches[0], same_operation_evidence_verified: true, secrets_included: false };
  if (matches.length > 1) return { status: "blocked", blocker: "closeout_pr_creation_ambiguous", candidate_count: matches.length, secrets_included: false };
  return { status: "reconciliation_required", blocker: "closeout_pr_creation_outcome_unknown", automatic_retry_allowed: false, secrets_included: false };
}

export async function createGovernedCloseoutPullRequest({
  owner,
  repo,
  base_branch = "main",
  closeout_branch,
  expected_base_sha,
  title,
  body,
  commit_message,
  idempotency_key,
  confirmation,
  mutation_approval,
  change_set,
} = {}, deps = {}) {
  assertSecretFree({ owner, repo, base_branch, closeout_branch, title, body, commit_message, idempotency_key, mutation_approval }, "pr_request");
  if (confirmation !== CLOSEOUT_CONFIRMATION) {
    return { ok: true, status: "awaiting_approval", required_confirmation: CLOSEOUT_CONFIRMATION, secrets_included: false };
  }
  const validation = validateCloseoutChangeSet(change_set);
  if (!validation.ok) return { ok: false, status: "blocked", validation, secrets_included: false };
  const dispatch = deps.dispatch;
  if (typeof dispatch !== "function") throw closeoutError("CLOSEOUT_DISPATCH_REQUIRED", "Governed repository dispatch is required.");
  const branch = compact(closeout_branch, 255).replace(/^refs\/heads\//, "");
  const base = compact(base_branch, 255).replace(/^refs\/heads\//, "");
  if (!branch || !base || ["main", "master", "production", "prod"].includes(branch.toLowerCase())) {
    throw closeoutError("CLOSEOUT_BRANCH_INVALID", "Closeout must use a non-protected feature branch.", { branch });
  }
  const baseSha = normalizeGitSha(expected_base_sha, "expected_base_sha");
  const preview = (deps.previewOperation || previewOperation);
  const repositoryPreview = await preview({
    operation_key: "repo.change.preview",
    automation_key: "pr_delivery",
    owner: compact(owner, 191),
    repo: compact(repo, 191),
    branch,
    default_branch: base,
    changed_files: change_set.changes.map((change) => change.path),
    expected_base_sha: baseSha,
    idempotency_key: compact(idempotency_key, 191),
  }, deps.operationDeps || deps);
  if (repositoryPreview?.ok === false) return { ok: false, status: "blocked", repository_preview: repositoryPreview, secrets_included: false };

  const patchResult = await dispatch("repo_patch_batch_apply", {
    owner: compact(owner, 191),
    repo: compact(repo, 191),
    branch,
    default_branch: base,
    expected_base_sha: baseSha,
    expected_branch_sha: null,
    create_branch: true,
    changes: change_set.changes.map((change) => ({
      path: change.path,
      content: change.after_content,
      expected_blob_sha: change.expected_blob_sha,
      before_sha256: change.before_sha256,
      after_sha256: change.after_sha256,
      semantic_operations: change.operations,
    })),
    commit_message: compact(commit_message, 500),
    idempotency_key: compact(idempotency_key, 191),
    mutation_approval,
    confirm: "APPLY_GOVERNED_CLOSEOUT_CHANGESET",
    force: false,
    force_push: false,
    readback_required: true,
    evidence_fingerprint_sha256: change_set.evidence_fingerprint_sha256,
    change_set_sha256: change_set.change_set_sha256,
    secrets_included: false,
  });
  const patchReceipt = normalizePatchReceipt(patchResult, change_set.changes.map((change) => change.path));
  if (patchReceipt.status === "reconciliation_required") {
    return { ok: false, status: "reconciliation_required", stage: "repository_patch", patch_receipt: patchReceipt, automatic_retry_allowed: false, secrets_included: false };
  }

  const createResult = await dispatchEndpoint(dispatch, "github_create_pull_request", {
    owner: compact(owner, 191),
    repo: compact(repo, 191),
    body: {
      title: compact(title, 250),
      head: branch,
      base,
      body: compact(body, 20_000),
      draft: false,
    },
    mutation_approval,
  });
  const createRaw = unwrapToolResult(createResult);
  let pullRequest = createRaw.pull_request || createRaw;
  if (createRaw.unknown_outcome === true || createRaw.status === "unknown_outcome") {
    const reconciled = await reconcilePullRequestCreation({
      dispatch,
      owner: compact(owner, 191),
      repo: compact(repo, 191),
      branch,
      base,
      expectedHeadSha: patchReceipt.commit_sha,
    });
    if (reconciled.status !== "recovered") {
      return { ok: false, status: reconciled.status, stage: "pull_request_create", reconciliation: reconciled, automatic_retry_allowed: false, secrets_included: false };
    }
    pullRequest = reconciled.pull_request;
  }
  const pullNumber = Number(pullRequest?.number || pullRequest?.pull_number);
  if (!Number.isInteger(pullNumber) || pullNumber <= 0) {
    throw closeoutError("CLOSEOUT_PULL_REQUEST_RECEIPT_INVALID", "Create pull request did not return a pull request number.");
  }
  const readbackResult = await dispatchEndpoint(dispatch, "github_get_pull_request", {
    owner: compact(owner, 191),
    repo: compact(repo, 191),
    path_params: { pull_number: pullNumber },
  });
  const readback = unwrapToolResult(readbackResult);
  const readbackPr = readback.pull_request || readback;
  const blockers = [];
  if (Number(readbackPr.number || readbackPr.pull_number) !== pullNumber) blockers.push("pull_number_mismatch");
  if (compact(readbackPr.state, 32).toLowerCase() !== "open") blockers.push("pull_request_not_open");
  if (compact(readbackPr?.head?.ref || readbackPr.head_ref, 255) !== branch) blockers.push("head_branch_mismatch");
  if (compact(readbackPr?.base?.ref || readbackPr.base_ref, 255) !== base) blockers.push("base_branch_mismatch");
  if (compact(readbackPr?.head?.sha || readbackPr.head_sha, 40).toLowerCase() !== patchReceipt.commit_sha) blockers.push("head_sha_mismatch");
  if (blockers.length) {
    return { ok: false, status: "reconciliation_required", stage: "pull_request_readback", blockers, pull_number: pullNumber, automatic_retry_allowed: false, secrets_included: false };
  }
  return {
    ok: true,
    status: "created",
    pull_request: {
      number: pullNumber,
      state: "open",
      head_ref: branch,
      head_sha: patchReceipt.commit_sha,
      base_ref: base,
      html_url: compact(readbackPr.html_url, 1000) || null,
    },
    patch_receipt: patchReceipt,
    repository_preview: repositoryPreview,
    evidence_fingerprint_sha256: change_set.evidence_fingerprint_sha256,
    change_set_sha256: change_set.change_set_sha256,
    force_push_used: false,
    protected_branch_bypass_used: false,
    readback_verified: true,
    secrets_included: false,
  };
}

export async function executeEvidenceAutoCloseout(request = {}, deps = {}) {
  const evidencePacket = await collectAuthoritativeEvidence(request.evidence_request, {
    readers: deps.evidenceReaders || {},
  });
  const changeSet = generateCloseoutChangeSet({
    documents: request.documents,
    intent: request.intent,
    evidence_packet: evidencePacket,
  });
  const validation = validateCloseoutChangeSet(changeSet);
  if (!validation.ok) return { ok: false, status: "blocked", evidence_packet: evidencePacket, change_set: changeSet, validation, secrets_included: false };
  const pullRequest = await createGovernedCloseoutPullRequest({
    ...request.pull_request,
    change_set: changeSet,
  }, deps);
  return {
    ok: pullRequest.ok === true,
    status: pullRequest.status,
    evidence_packet: evidencePacket,
    change_set: changeSet,
    validation,
    pull_request: pullRequest,
    secrets_included: false,
  };
}

export const _testingSpec011EvidenceAutoCloseout = {
  stable,
  sha256,
  assertSecretFree,
  normalizeEvidenceObservation,
  normalizeDocument,
  setPointer,
  unwrapToolResult,
  normalizePatchReceipt,
  terminalEvidenceReady,
};
