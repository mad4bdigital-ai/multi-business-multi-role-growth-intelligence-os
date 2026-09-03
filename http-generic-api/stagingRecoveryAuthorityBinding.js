import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, verify } from "node:crypto";
import { constants, readFileSync } from "node:fs";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServerManagedRecoveryAuthorityBinding, createServerManagedRecoveryBindingEnvelope } from "./serverManagedRecoveryAuthorityBinding.js";
import { createServerManagedDeploymentIdentityProvider } from "./serverManagedDeploymentIdentityProvider.js";
import { createFileRecoveryEvidenceStore, createRecoveryReadinessAuthorities as createCanonicalReadinessAuthority } from "./recoveryReadinessEvidence.js";
import { RECOVERY_COMPOSITION_COMPONENT_KEYS } from "./recoveryComposition.js";
import { readDeploymentManifest } from "./deploymentManifest.js";
import { resolveRuntimeEnvironmentStrict } from "./runtimeEnvironmentResolver.js";

export const STAGING_RECOVERY_AUTHORITY_BINDING_CONTRACT = "mad4b.staging-recovery-authority-binding.v1";
const REPOSITORY = "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os";
const SHA40 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const MAX = 1024 * 1024;
const MODULE_SHA256 = createHash("sha256").update(readFileSync(fileURLToPath(import.meta.url))).digest("hex");
const KERNEL_MANIFEST = fileURLToPath(new URL("./config/recovery-kernel-manifest.json", import.meta.url));
const stable = (v) => Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v;
const canonical = (v) => JSON.stringify(stable(v));
const digest = (v) => createHash("sha256").update(Buffer.isBuffer(v) ? v : Buffer.from(typeof v === "string" ? v : canonical(v))).digest("hex");
const key = (v) => digest(String(v ?? ""));
const txt = (v, n = 512) => String(v ?? "").trim().slice(0, n);
function denied(code, message) { throw Object.assign(new Error(message), { code, status: 503, details: { secrets_included: false } }); }

function runtime(context = {}, env = process.env, readiness = false) {
  const r = resolveRuntimeEnvironmentStrict(env);
  if (!r.ok || r.environment_key !== "staging" || r.runtime_class !== "local_windows_docker" || r.runtime_class_explicit !== true) denied("RECOVERY_STAGING_AUTHORITY_RUNTIME_DENIED", "Recovery authority is limited to explicit local Windows/Docker Staging.");
  if (context.environment && context.environment !== "staging") denied("RECOVERY_STAGING_AUTHORITY_CONTEXT_DENIED", "Recovery authority environment mismatch.");
  if (context.runtime_class && context.runtime_class !== "local_windows_docker") denied("RECOVERY_STAGING_AUTHORITY_CONTEXT_DENIED", "Recovery authority runtime mismatch.");
  if (context.production_live === true) denied("RECOVERY_STAGING_PRODUCTION_LIVE_FORBIDDEN", "Production live authority is forbidden.");
  if (!readiness && context.requested_mode && context.requested_mode !== "injected_non_live") denied("RECOVERY_STAGING_BINDING_MODE_DENIED", "Only injected_non_live is accepted.");
  return r;
}

function roots(env = process.env) {
  const readinessConfigured = txt(env.RECOVERY_STAGING_READINESS_DIRECTORY || "/app/data/recovery-readiness", 2048);
  const replayConfigured = txt(env.RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY || "/app/data/recovery-ingress", 2048);
  if (!path.isAbsolute(readinessConfigured) || !path.isAbsolute(replayConfigured)) denied("RECOVERY_STAGING_EVIDENCE_REPLAY_NOT_ISOLATED", "Readiness evidence and ingress replay require independently configured absolute roots.");
  const readiness = path.resolve(readinessConfigured);
  const replay = path.resolve(replayConfigured);
  if (readiness === replay || readiness.startsWith(`${replay}${path.sep}`) || replay.startsWith(`${readiness}${path.sep}`)) denied("RECOVERY_STAGING_EVIDENCE_REPLAY_NOT_ISOLATED", "Readiness evidence and ingress replay require independent absolute roots.");
  return { readiness, replay };
}

async function syncDir(dir) { const h = await open(dir, "r"); try { await h.sync(); } finally { await h.close(); } }
async function ensure(dir) { await mkdir(dir, { recursive: true, mode: 0o700 }); }
async function readJson(file) {
  let h; try { h = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW); } catch (e) { if (e.code === "ENOENT") return null; throw e; }
  try { const s = await h.stat(); if (!s.isFile() || s.size > MAX) denied("RECOVERY_STAGING_STATE_INVALID", "Durable Recovery state is invalid."); return JSON.parse(await h.readFile("utf8")); } finally { await h.close(); }
}
async function writeJson(file, value, immutable = false) {
  const dir = path.dirname(file); await ensure(dir); const bytes = `${canonical(value)}\n`; if (Buffer.byteLength(bytes) > MAX) denied("RECOVERY_STAGING_STATE_TOO_LARGE", "Durable Recovery state exceeds its bound.");
  if (immutable) { const h = await open(file, "wx", 0o600); try { await h.writeFile(bytes); await h.sync(); } finally { await h.close(); } await syncDir(dir); return; }
  const temp = path.join(dir, `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`); const h = await open(temp, "wx", 0o600); try { await h.writeFile(bytes); await h.sync(); } finally { await h.close(); } await rename(temp, file); await syncDir(dir);
}
async function remove(file) { await rm(file, { force: true }); await ensure(path.dirname(file)); await syncDir(path.dirname(file)); }
async function immutableClaim(file, value) { try { await writeJson(file, value, true); return true; } catch (e) { if (e.code === "EEXIST") return false; throw e; } }

function targetIdentityProvider(root) {
  const file = path.join(root, "identity", "target.json");
  return Object.freeze({ async readIdentity() {
    let record = await readJson(file);
    if (!record) { const next = { contract: "mad4b.staging-recovery-target-identity.v1", environment: "staging", runtime_class: "local_windows_docker", instance_id: randomUUID(), secrets_included: false }; try { await writeJson(file, next, true); } catch (e) { if (e.code !== "EEXIST") throw e; } record = await readJson(file); }
    if (record?.contract !== "mad4b.staging-recovery-target-identity.v1" || record.environment !== "staging" || record.runtime_class !== "local_windows_docker" || !record.instance_id || record.secrets_included !== false) denied("RECOVERY_STAGING_TARGET_IDENTITY_INVALID", "Persistent Staging target identity is invalid.");
    return { environment: "staging", runtime_class: "local_windows_docker", target_fingerprint: digest({ contract: record.contract, environment: record.environment, runtime_class: record.runtime_class, instance_id: record.instance_id }), durable_identity: true, server_derived: true, secrets_included: false };
  } });
}

function deploymentIdentityProvider(targetProvider, env = process.env) {
  return createServerManagedDeploymentIdentityProvider({ environment: "staging", readServerAttestation: async () => {
    const result = readDeploymentManifest(env); const m = result?.manifest;
    if (!result?.ok || m?.repository !== REPOSITORY || m?.branch !== "main" || !SHA40.test(m.commit_sha || "") || !SHA40.test(m.tree_sha || "") || !SHA256.test(m.context_file_set_sha256 || "") || m.secrets_included !== false) denied("RECOVERY_STAGING_DEPLOYMENT_MANIFEST_INVALID", "Exact Staging deployment manifest is invalid.");
    const target = await targetProvider.readIdentity(); const recovery_manifest_hash = digest(await readFile(KERNEL_MANIFEST));
    const attestation_hash = digest({ repository: m.repository, branch: m.branch, deployment_sha: m.commit_sha, tree_sha: m.tree_sha, context_file_set_sha256: m.context_file_set_sha256, target_fingerprint: target.target_fingerprint, recovery_manifest_hash });
    return { contract: "mad4b.recovery-runtime-attestation.v1", repository: REPOSITORY, branch: "main", environment: "staging", deployment_sha: m.commit_sha, repository_sha: m.commit_sha, recovery_manifest_hash, attestation_hash, target_fingerprint: target.target_fingerprint, manifest_bound: true, read_only_probe: true, database_connection_performed: false, database_mutation_performed: false, provider_mutation_performed: false, secrets_included: false };
  } });
}

async function keys(root, name) {
  const dir = path.join(root, "authority-keys", name); const prv = path.join(dir, "private.pkcs8.pem"); await ensure(dir);
  let privatePem;
  try { privatePem = await readFile(prv, "utf8"); } catch (e) {
    if (e.code !== "ENOENT") throw e;
    const pair = generateKeyPairSync("ed25519"); const candidate = pair.privateKey.export({ type: "pkcs8", format: "pem" });
    try { const h = await open(prv, "wx", 0o600); try { await h.writeFile(candidate); await h.sync(); } finally { await h.close(); } await syncDir(dir); } catch (x) { if (x.code !== "EEXIST") throw x; }
    privatePem = await readFile(prv, "utf8");
  }
  let privateKey; let publicKey;
  try { privateKey = createPrivateKey(privatePem); publicKey = createPublicKey(privateKey); } catch { denied("RECOVERY_STAGING_INTERNAL_KEY_INVALID", "Internal Recovery authority key is invalid."); }
  if (privateKey.asymmetricKeyType !== "ed25519" || publicKey.asymmetricKeyType !== "ed25519") denied("RECOVERY_STAGING_INTERNAL_KEY_INVALID", "Internal Recovery authority key is invalid.");
  return { privateKey, publicKey };
}

function ticketAuthorities(root) {
  const signer = Object.freeze({ async sign({ payload, ticket_hash }) { const k = await keys(root, "execution-ticket"); return sign(null, Buffer.from(canonical({ payload, ticket_hash })), k.privateKey).toString("base64url"); } });
  const verifier = Object.freeze({ async verify({ ticket, ticket_hash }) { if (!ticket?.signature) return false; const k = await keys(root, "execution-ticket"); const payload = Object.fromEntries(Object.entries(ticket).filter(([x]) => !["ticket_id", "ticket_hash", "signature", "issued_at", "single_use", "content_not_included", "secrets_included"].includes(x))); return verify(null, Buffer.from(canonical({ payload, ticket_hash })), k.publicKey, Buffer.from(ticket.signature, "base64url")); } });
  return { signer, verifier };
}

function approvalAuthorities(root) {
  const storeRoot = path.join(root, "approval-challenges");
  const store = Object.freeze({ async putChallenge(c) { try { await writeJson(path.join(storeRoot, `${key(c.approval_id)}.json`), c, true); } catch (e) { if (e.code !== "EEXIST") throw e; } }, async getChallenge(id) { return readJson(path.join(storeRoot, `${key(id)}.json`)); } });
  const issuer = Object.freeze({ async createChallenge(c) { const k = await keys(root, "approval"); const payload = { approval_id: c.approval_id, plan_hash: c.plan_hash, step_id: c.step_id, expires_at: new Date(Date.now() + 300000).toISOString(), nonce: randomUUID() }; const encoded = Buffer.from(canonical(payload)).toString("base64url"); const signature = sign(null, Buffer.from(canonical(payload)), k.privateKey).toString("base64url"); return { authority: "server_managed", expires_at: payload.expires_at, server_token: `${encoded}.${signature}` }; } });
  const verifier = Object.freeze({ async verify({ token, approval, context }) { if (typeof token !== "string" || token.length > 4096) return false; const [encoded, signature] = token.split("."); if (!encoded || !signature) return false; let p; try { p = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { return false; } const k = await keys(root, "approval"); return Date.parse(p.expires_at) > Date.now() && p.approval_id === approval?.approval_id && p.plan_hash === approval?.plan_hash && p.step_id === approval?.step_id && (!context?.plan_hash || context.plan_hash === p.plan_hash) && verify(null, Buffer.from(canonical(p)), k.publicKey, Buffer.from(signature, "base64url")); } });
  return { store, issuer, verifier };
}

function recoveryStore(root, executionTicketVerifier) {
  const base = path.join(root, "kernel-store"); const file = (kind, id) => path.join(base, kind, `${key(id)}.json`); const get = (k, id) => readJson(file(k, id)); const put = (k, id, v) => writeJson(file(k, id), v);
  const claim = async (kind, id, value) => immutableClaim(file(kind, id), value);
  const approvalReservationId = (c) => `${c.approval_id}:${c.plan_hash}:${c.step_id}`;
  return Object.freeze({ recovery_store_contract: "mad4b.staging-recovery-filesystem-store.v1", independent_of_target_databases: true, target_database_binding: "forbidden", durability: "persistent_filesystem", provider_accessed: false, executionTicketVerifier,
    async putRun(v) { await put("runs", v.run_id, v); if (v.idempotency_key) await put("run-idempotency", v.idempotency_key, { run_id: v.run_id }); }, async getRun(id) { return get("runs", id); }, async putPlan(v) { await put("plans", v.plan_id, v); }, async getPlan(id) { return get("plans", id); }, async putFinding(v) { await put("findings", v.finding_id, v); }, async getFinding(id) { return get("findings", id); },
    async getRunByIdempotency(id) { const receipt = await get("receipts", id); if (receipt) return receipt; const index = await get("run-idempotency", id); return index?.run_id ? get("runs", index.run_id) : null; }, async appendEvidenceEvent(run_id, event) { const id = `${Date.now()}:${randomUUID()}`; await writeJson(file("evidence", id), { run_id, ...event }, true); }, async putIdempotencyReceipt(id, v) { await put("receipts", id, v); },
    async putApproval(v) { await put("approvals", v.approval_id, v); await put("approval-index", `${v.plan_id}:${v.step_id}`, { approval_id: v.approval_id }); }, async getApprovalByPlanStep(plan, step) { const i = await get("approval-index", `${plan}:${step}`); return i?.approval_id ? get("approvals", i.approval_id) : null; },
    async markApprovalUsed(id) { const a = await get("approvals", id); if (!a) return { already_finalized: true }; const finalized = await claim("approval-used", id, { approval_id: id, finalized_at: new Date().toISOString(), secrets_included: false }); if (!finalized) return { already_finalized: true }; await put("approvals", id, { ...a, used: true, finalized_at: new Date().toISOString() }); return { finalized: true }; },
    async claimExecution(c) { const v = { claim_id: `claim:${key(c.idempotency_key).slice(0, 32)}`, status: "claimed", ...c }; return await claim("execution-claims", c.idempotency_key, v) ? { claimed: true, claim_id: v.claim_id } : { existing: true, status: "claimed", claim_id: (await get("execution-claims", c.idempotency_key))?.claim_id }; }, async releaseExecutionClaim(c) { await remove(file("execution-claims", c.idempotency_key)); return { released: true }; },
    async reserveApproval(c) { const a = await get("approvals", c.approval_id); const used = await get("approval-used", c.approval_id); if (!a || a.used || used || a.plan_hash !== c.plan_hash || a.step_id !== c.step_id) return { reserved: false }; const id = approvalReservationId(c); const value = { ...c, reservation_id: id, reserved_at: new Date().toISOString(), secrets_included: false }; if (await claim("approval-reservations", id, value)) return { reserved: true }; const existing = await get("approval-reservations", id); return { reserved: false, existing: true, same_idempotency: existing?.idempotency_key === c.idempotency_key }; },
    async releaseApprovalReservation(c) { const id = approvalReservationId(c); const existing = await get("approval-reservations", id); if (existing?.idempotency_key !== c.idempotency_key) return { released: false }; await remove(file("approval-reservations", id)); return { released: true }; },
    async getExecutionTicket(id) { return get("tickets", id); },
    async putExecutionTicket(t) { try { await writeJson(file("tickets", t.ticket_id), t, true); } catch (e) { if (e.code !== "EEXIST") throw e; const existing = await get("tickets", t.ticket_id); if (!existing || existing.ticket_hash !== t.ticket_hash) denied("RECOVERY_STAGING_EXECUTION_TICKET_COLLISION", "Execution ticket identity cannot be rebound to different content."); } },
    async reserveExecutionTicket(c) { const ticket = await get("tickets", c.ticket_id); if (!ticket || ticket.ticket_hash !== c.ticket_hash || await get("ticket-finalized", c.ticket_id)) return { reserved: false }; const value = { ...c, reserved_at: new Date().toISOString(), secrets_included: false }; if (await claim("ticket-reservations", c.ticket_id, value)) return { reserved: true }; const existing = await get("ticket-reservations", c.ticket_id); return { reserved: false, existing: true, same_idempotency: existing?.idempotency_key === c.idempotency_key }; },
    async releaseExecutionTicket(c) { if (await get("ticket-finalized", c.ticket_id)) return { released: false, finalized: true }; const existing = await get("ticket-reservations", c.ticket_id); if (!existing || existing.ticket_hash !== c.ticket_hash || existing.idempotency_key !== c.idempotency_key) return { released: false }; await remove(file("ticket-reservations", c.ticket_id)); return { released: true }; },
    async finalizeExecutionTicket(c) { const ticket = await get("tickets", c.ticket_id); if (!ticket || ticket.ticket_hash !== c.ticket_hash) return { finalized: false }; const reservation = await get("ticket-reservations", c.ticket_id); if (!reservation || reservation.ticket_hash !== c.ticket_hash || reservation.idempotency_key !== c.idempotency_key) return { finalized: false }; if (!await claim("ticket-finalized", c.ticket_id, { ...c, status: "finalized", finalized_at: new Date().toISOString(), secrets_included: false })) return { already_finalized: true }; return { finalized: true }; },
  });
}

function lock(root) {
  const dir = path.join(root, "fenced-locks"); const f = (target) => path.join(dir, `${key(target)}.json`); const takeoverFile = (target, lease) => path.join(dir, "takeover-claims", `${key(`${target}:${lease.lease_id}:${lease.fencing_token}`)}.json`);
  return Object.freeze({
    async acquire({ target_key, plan_hash, ttl_seconds = 600 }) {
      const lease = { target_key, plan_hash, lease_id: `lease:${randomUUID()}`, fencing_token: `${Date.now()}:${randomUUID()}`, expires_at: new Date(Date.now() + Math.min(Number(ttl_seconds) || 600, 600) * 1000).toISOString() };
      try { await writeJson(f(target_key), lease, true); return { acquired: true, ...lease }; } catch (e) {
        if (e.code !== "EEXIST") throw e;
        const old = await readJson(f(target_key)); if (!old || Date.parse(old.expires_at) > Date.now()) return { acquired: false };
        const takeover = { contract: "mad4b.staging-recovery-lock-takeover.v1", target_key, prior_lease_id: old.lease_id, prior_fencing_token: old.fencing_token, prior_expires_at: old.expires_at, claimed_at: new Date().toISOString(), secrets_included: false };
        if (!await immutableClaim(takeoverFile(target_key, old), takeover)) return { acquired: false };
        const current = await readJson(f(target_key));
        if (!current || current.lease_id !== old.lease_id || current.fencing_token !== old.fencing_token || Date.parse(current.expires_at) > Date.now()) return { acquired: false };
        await remove(f(target_key));
        return this.acquire({ target_key, plan_hash, ttl_seconds });
      }
    },
    async heartbeat(c) { const l = await readJson(f(c.target_key)); if (!l || l.lease_id !== c.lease_id || l.fencing_token !== c.fencing_token || Date.parse(l.expires_at) <= Date.now()) return { renewed: false, valid: false }; const next = { ...l, expires_at: new Date(Date.now() + 600000).toISOString() }; await writeJson(f(c.target_key), next); return { renewed: true, valid: true, ...next }; },
    async assertFence(c) { const l = await readJson(f(c.target_key)); return { valid: Boolean(l && l.lease_id === c.lease_id && l.fencing_token === c.fencing_token && Date.parse(l.expires_at) > Date.now()) }; },
    async release({ target_key, lock: h }) { const l = await readJson(f(target_key)); if (l && h && l.lease_id === h.lease_id && l.fencing_token === h.fencing_token) await remove(f(target_key)); return { released: true }; },
  });
}

function canary(root) {
  const dir = path.join(root, "certification-canary");
  return Object.freeze({ async execute(payload = {}) {
    const identity = { plan_hash: payload.plan_hash || null, step_id: payload.step_id || null, idempotency_key: payload.idempotency_key || null, operation: payload.operation || null };
    const id = digest(identity);
    const record = { contract: "mad4b.staging-recovery-certification-canary.v1", id, ...identity, environment: "staging", fencing_token: payload.fencing_token || payload.lock?.fencing_token || null, written_at: new Date().toISOString(), production_mutation_performed: false, database_mutation_performed: false, provider_mutation_performed: false, secrets_included: false };
    try { await writeJson(path.join(dir, `${id}.json`), record, true); } catch (e) { if (e.code === "EEXIST") denied("RECOVERY_STAGING_CANARY_REPLAY_DENIED", "A Staging certification canary identity is immutable and cannot be executed twice."); throw e; }
    return { ok: true, status: "provider_acknowledged", canary_id: id, mutation_attestation: record, production_mutation_performed: false, database_mutation_performed: false, provider_mutation_performed: false, secrets_included: false };
  } });
}
function reconciliationFence(plan, step, run) {
  if (!run?.run_id || !Array.isArray(run.events)) return null;
  const matches = run.events.filter((event) => event?.event === "recovery_lock_acquired"
    && event?.phase === "locked"
    && event?.run_id === run.run_id
    && event?.plan_hash === plan?.plan_hash
    && event?.step_id === step?.step_id
    && txt(event?.fencing_token, 512));
  return matches.length === 1 ? txt(matches[0].fencing_token, 512) : null;
}
function readback(root) {
  return Object.freeze({
    independent_authority: true,
    role_aware: true,
    mutation_authority: false,
    async verify({ plan, step, run, fencing_token, same_cycle, reconciliation }) {
      const identity = { plan_hash: plan?.plan_hash || null, step_id: step?.step_id || null, idempotency_key: run?.idempotency_key || null, operation: step?.operation || null };
      const id = digest(identity); const record = await readJson(path.join(root, "certification-canary", `${id}.json`));
      const explicitFence = txt(fencing_token, 512) || null;
      const isReconciliation = same_cycle === false && reconciliation === true;
      const durableFence = isReconciliation ? reconciliationFence(plan, step, run) : null;
      const expectedFence = isReconciliation
        ? (explicitFence ? (explicitFence === durableFence ? explicitFence : null) : durableFence)
        : explicitFence;
      const sameFence = Boolean(record && expectedFence && record.fencing_token === expectedFence);
      const sameIdentity = Boolean(record && record.id === id && record.plan_hash === identity.plan_hash && record.step_id === identity.step_id && record.idempotency_key === identity.idempotency_key && record.operation === identity.operation);
      const ok = Boolean(record?.environment === "staging" && record?.production_mutation_performed === false && record?.database_mutation_performed === false && record?.provider_mutation_performed === false && sameFence && sameIdentity);
      return { ok, verified: ok, same_fence: sameFence, postconditions_passed: ok, behavioral_probe_passed: ok, evidence_hash: ok ? digest(record) : null, secrets_included: false };
    },
  });
}
function immutableStore(root, name, method) { return Object.freeze({ async [method](value) { const id = digest(value); try { await writeJson(path.join(root, name, `${id}.json`), value, true); } catch (e) { if (e.code !== "EEXIST") throw e; } return { persisted: true, finalized: true, durable: true, evidence_hash: id }; } }); }

function adapters(root, env = process.env) {
  const target = targetIdentityProvider(root); const deployment = deploymentIdentityProvider(target, env); const ticket = ticketAuthorities(root); const approval = approvalAuthorities(root); const c = canary(root);
  return { target, deployment, adapters: Object.freeze({ deploymentIdentityProvider: deployment, recoveryStore: recoveryStore(root, ticket.verifier), approvalIssuer: approval.issuer, approvalVerifier: approval.verifier, approvalStore: approval.store, recoveryLock: lock(root), mutationExecutor: c, hostLocalMutationExecutor: c.execute, readbackVerifier: readback(root), executionTicketSigner: ticket.signer, executionTicketVerifier: ticket.verifier, partialReceiptStore: immutableStore(root, "partial-receipts", "putImmutablePartialRebuildReceipt"), proofResolver: async () => ({ contract: "mad4b.staging-recovery-proof-resolver.v1", source: "durable_staging_authority", server_derived: true, secrets_included: false }), migrationLedger: immutableStore(root, "migration-ledger", "finalize") }) };
}
function provenance(sha) { if (!SHA40.test(sha || "")) denied("RECOVERY_STAGING_PROVENANCE_SHA_INVALID", "Typed provenance requires exact SHA."); const durable = new Set(["recoveryStore", "approvalStore", "recoveryLock", "partialReceiptStore", "migrationLedger"]); return { contract: "mad4b.recovery-adapter-provenance.v1", environment: "staging", deployment_sha: sha, components: Object.fromEntries(RECOVERY_COMPOSITION_COMPONENT_KEYS.map((name) => [name, { implementation_id: `mad4b.staging.recovery.${name}.v1`, artifact_sha256: MODULE_SHA256, authority_class: "server_managed", storage_class: durable.has(name) ? "durable" : "stateless" }])), secrets_included: false }; }

function createServerManagedRecoveryBindingForEnv(context = {}, env = process.env) {
  runtime(context, env); const r = roots(env); const graph = adapters(r.readiness, env).adapters; const binding = createServerManagedRecoveryAuthorityBinding({ adapters: graph, adapterOrigin: "server_managed_concrete", capabilities: { adapter_present: true, durability_capable: true, attestation_capable: true }, authorityHandles: { deployment_owned: true } }); return createServerManagedRecoveryBindingEnvelope({ binding, readiness: { adapter_present: true, durability_capable: true, attestation_capable: true }, source: "staging_recovery_authority_binding" });
}

export function createServerManagedRecoveryBinding(context = {}) {
  return createServerManagedRecoveryBindingForEnv(context, process.env);
}

function createRecoveryReadinessAuthoritiesForEnv(context = {}, env = process.env) {
  runtime(context, env, true); if (context.read_only !== true || context.production_live !== false) denied("RECOVERY_STAGING_READINESS_CONTEXT_DENIED", "Readiness requires read_only=true and production_live=false.");
  const r = roots(env); const a = adapters(r.readiness, env); const store = createFileRecoveryEvidenceStore({ directory: path.join(r.readiness, "certification-evidence"), replayDirectory: r.replay }); return createCanonicalReadinessAuthority({ evidenceStore: store, deploymentIdentityProvider: a.deployment, targetIdentityProvider: a.target, publicKey: null, keyId: null, issuer: null, env, adapterProvenanceReader: async () => provenance((await a.deployment.readAttestation()).sha) });
}

export function createRecoveryReadinessAuthorities(context = {}) {
  return createRecoveryReadinessAuthoritiesForEnv(context, process.env);
}

export const _testingStagingRecoveryAuthorityBinding = Object.freeze({ MODULE_SHA256, roots, runtime, provenance, targetIdentityProvider, adapters, createServerManagedRecoveryBindingForEnv, createRecoveryReadinessAuthoritiesForEnv });
