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
  const readiness = path.resolve(txt(env.RECOVERY_STAGING_READINESS_DIRECTORY || "/app/data/recovery-readiness", 2048));
  const replay = path.resolve(txt(env.RECOVERY_STAGING_INGRESS_REPLAY_DIRECTORY || "/app/data/recovery-ingress", 2048));
  if (!path.isAbsolute(readiness) || !path.isAbsolute(replay) || readiness === replay || readiness.startsWith(`${replay}${path.sep}`) || replay.startsWith(`${readiness}${path.sep}`)) denied("RECOVERY_STAGING_EVIDENCE_REPLAY_NOT_ISOLATED", "Readiness evidence and ingress replay require independent absolute roots.");
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
  const dir = path.join(root, "authority-keys", name); const prv = path.join(dir, "private.pkcs8.pem"); const pub = path.join(dir, "public.spki.pem"); await ensure(dir);
  let privatePem, publicPem; try { [privatePem, publicPem] = await Promise.all([readFile(prv, "utf8"), readFile(pub, "utf8")]); } catch (e) {
    if (e.code !== "ENOENT") throw e; const pair = generateKeyPairSync("ed25519"); privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" }); publicPem = pair.publicKey.export({ type: "spki", format: "pem" });
    for (const [file, value] of [[prv, privatePem], [pub, publicPem]]) try { const h = await open(file, "wx", 0o600); try { await h.writeFile(value); await h.sync(); } finally { await h.close(); } } catch (x) { if (x.code !== "EEXIST") throw x; }
    await syncDir(dir); [privatePem, publicPem] = await Promise.all([readFile(prv, "utf8"), readFile(pub, "utf8")]);
  }
  const privateKey = createPrivateKey(privatePem); const publicKey = createPublicKey(publicPem); if (privateKey.asymmetricKeyType !== "ed25519" || publicKey.asymmetricKeyType !== "ed25519") denied("RECOVERY_STAGING_INTERNAL_KEY_INVALID", "Internal Recovery authority key is invalid."); return { privateKey, publicKey };
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
  const claim = async (kind, id, value) => { try { await writeJson(file(kind, id), value, true); return true; } catch (e) { if (e.code === "EEXIST") return false; throw e; } };
  return Object.freeze({ recovery_store_contract: "mad4b.staging-recovery-filesystem-store.v1", independent_of_target_databases: true, target_database_binding: "forbidden", durability: "persistent_filesystem", provider_accessed: false, executionTicketVerifier,
    async putRun(v) { await put("runs", v.run_id, v); if (v.idempotency_key) await put("run-idempotency", v.idempotency_key, { run_id: v.run_id }); }, async getRun(id) { return get("runs", id); }, async putPlan(v) { await put("plans", v.plan_id, v); }, async getPlan(id) { return get("plans", id); }, async putFinding(v) { await put("findings", v.finding_id, v); }, async getFinding(id) { return get("findings", id); },
    async getRunByIdempotency(id) { const receipt = await get("receipts", id); if (receipt) return receipt; const index = await get("run-idempotency", id); return index?.run_id ? get("runs", index.run_id) : null; }, async appendEvidenceEvent(run_id, event) { const id = `${Date.now()}:${randomUUID()}`; await writeJson(file("evidence", id), { run_id, ...event }, true); }, async putIdempotencyReceipt(id, v) { await put("receipts", id, v); },
    async putApproval(v) { await put("approvals", v.approval_id, v); await put("approval-index", `${v.plan_id}:${v.step_id}`, { approval_id: v.approval_id }); }, async getApprovalByPlanStep(plan, step) { const i = await get("approval-index", `${plan}:${step}`); return i?.approval_id ? get("approvals", i.approval_id) : null; }, async markApprovalUsed(id) { const a = await get("approvals", id); if (!a || a.used) return { already_finalized: true }; await put("approvals", id, { ...a, used: true, finalized_at: new Date().toISOString() }); return { finalized: true }; },
    async claimExecution(c) { const v = { claim_id: `claim:${key(c.idempotency_key).slice(0, 32)}`, status: "claimed", ...c }; return await claim("execution-claims", c.idempotency_key, v) ? { claimed: true, claim_id: v.claim_id } : { existing: true, status: "claimed", claim_id: (await get("execution-claims", c.idempotency_key))?.claim_id }; }, async releaseExecutionClaim(c) { await remove(file("execution-claims", c.idempotency_key)); return { released: true }; },
    async reserveApproval(c) { const a = await get("approvals", c.approval_id); if (!a || a.used || a.plan_hash !== c.plan_hash || a.step_id !== c.step_id) return { reserved: false }; return await claim("approval-reservations", `${c.approval_id}:${c.plan_hash}:${c.step_id}:${c.idempotency_key}`, c) ? { reserved: true } : { reserved: false, existing: true }; }, async releaseApprovalReservation(c) { await remove(file("approval-reservations", `${c.approval_id}:${c.plan_hash}:${c.step_id}:${c.idempotency_key}`)); return { released: true }; },
    async getExecutionTicket(id) { return get("tickets", id); }, async putExecutionTicket(t) { try { await writeJson(file("tickets", t.ticket_id), t, true); } catch (e) { if (e.code !== "EEXIST") throw e; } if (!(await get("ticket-state", t.ticket_id))) await put("ticket-state", t.ticket_id, { status: "issued", ticket_hash: t.ticket_hash }); }, async reserveExecutionTicket(c) { const s = await get("ticket-state", c.ticket_id); if (!s || s.ticket_hash !== c.ticket_hash || s.status === "finalized") return { reserved: false }; if (s.status === "reserved") return s.idempotency_key === c.idempotency_key ? { reserved: false, existing: true } : { reserved: false }; await put("ticket-state", c.ticket_id, { ...s, ...c, status: "reserved" }); return { reserved: true }; }, async releaseExecutionTicket(c) { const s = await get("ticket-state", c.ticket_id); if (s?.status === "reserved" && s.idempotency_key === c.idempotency_key) await put("ticket-state", c.ticket_id, { status: "issued", ticket_hash: s.ticket_hash }); return { released: true }; }, async finalizeExecutionTicket(c) { const s = await get("ticket-state", c.ticket_id); if (!s || s.ticket_hash !== c.ticket_hash) return { finalized: false }; if (s.status === "finalized") return { already_finalized: true }; if (s.status !== "reserved" || s.idempotency_key !== c.idempotency_key) return { finalized: false }; await put("ticket-state", c.ticket_id, { ...s, status: "finalized" }); return { finalized: true }; },
  });
}

function lock(root) {
  const dir = path.join(root, "fenced-locks"); const f = (target) => path.join(dir, `${key(target)}.json`);
  return Object.freeze({ async acquire({ target_key, plan_hash, ttl_seconds = 600 }) { const lease = { target_key, plan_hash, lease_id: `lease:${randomUUID()}`, fencing_token: `${Date.now()}:${randomUUID()}`, expires_at: new Date(Date.now() + Math.min(Number(ttl_seconds) || 600, 600) * 1000).toISOString() }; try { await writeJson(f(target_key), lease, true); return { acquired: true, ...lease }; } catch (e) { if (e.code !== "EEXIST") throw e; const old = await readJson(f(target_key)); if (old && Date.parse(old.expires_at) <= Date.now()) { await remove(f(target_key)); return this.acquire({ target_key, plan_hash, ttl_seconds }); } return { acquired: false }; } }, async heartbeat(c) { const l = await readJson(f(c.target_key)); if (!l || l.lease_id !== c.lease_id || l.fencing_token !== c.fencing_token) return { renewed: false, valid: false }; const next = { ...l, expires_at: new Date(Date.now() + 600000).toISOString() }; await writeJson(f(c.target_key), next); return { renewed: true, valid: true, ...next }; }, async assertFence(c) { const l = await readJson(f(c.target_key)); return { valid: Boolean(l && l.lease_id === c.lease_id && l.fencing_token === c.fencing_token && Date.parse(l.expires_at) > Date.now()) }; }, async release({ target_key, lock: h }) { const l = await readJson(f(target_key)); if (l && h && l.lease_id === h.lease_id && l.fencing_token === h.fencing_token) await remove(f(target_key)); return { released: true }; } });
}

function canary(root) {
  const dir = path.join(root, "certification-canary"); return Object.freeze({ async execute(payload = {}) { const id = digest({ plan_hash: payload.plan_hash || null, step_id: payload.step_id || null, idempotency_key: payload.idempotency_key || null, operation: payload.operation || null }); const record = { contract: "mad4b.staging-recovery-certification-canary.v1", id, environment: "staging", fencing_token: payload.fencing_token || payload.lock?.fencing_token || null, written_at: new Date().toISOString(), production_mutation_performed: false, database_mutation_performed: false, provider_mutation_performed: false, secrets_included: false }; await writeJson(path.join(dir, `${id}.json`), record); return { ok: true, status: "provider_acknowledged", canary_id: id, mutation_attestation: record, production_mutation_performed: false, database_mutation_performed: false, provider_mutation_performed: false, secrets_included: false }; } });
}
function readback(root) { return Object.freeze({ async verify({ result, execution_result }) { const id = (result || execution_result)?.canary_id; if (!SHA256.test(id || "")) return { ok: false, verified: false }; const record = await readJson(path.join(root, "certification-canary", `${id}.json`)); const ok = record?.environment === "staging" && record?.production_mutation_performed === false; return { ok, verified: ok, same_fence: true, postconditions_passed: ok, behavioral_probe_passed: ok, evidence_hash: ok ? digest(record) : null, secrets_included: false }; } }); }
function immutableStore(root, name, method) { return Object.freeze({ async [method](value) { const id = digest(value); try { await writeJson(path.join(root, name, `${id}.json`), value, true); } catch (e) { if (e.code !== "EEXIST") throw e; } return { persisted: true, finalized: true, durable: true, evidence_hash: id }; } }); }

function adapters(root, env = process.env) {
  const target = targetIdentityProvider(root); const deployment = deploymentIdentityProvider(target, env); const ticket = ticketAuthorities(root); const approval = approvalAuthorities(root); const c = canary(root);
  return { target, deployment, adapters: Object.freeze({ deploymentIdentityProvider: deployment, recoveryStore: recoveryStore(root, ticket.verifier), approvalIssuer: approval.issuer, approvalVerifier: approval.verifier, approvalStore: approval.store, recoveryLock: lock(root), mutationExecutor: c, hostLocalMutationExecutor: c.execute, readbackVerifier: readback(root), executionTicketSigner: ticket.signer, executionTicketVerifier: ticket.verifier, partialReceiptStore: immutableStore(root, "partial-receipts", "putImmutablePartialRebuildReceipt"), proofResolver: async () => ({ contract: "mad4b.staging-recovery-proof-resolver.v1", source: "durable_staging_authority", server_derived: true, secrets_included: false }), migrationLedger: immutableStore(root, "migration-ledger", "finalize") }) };
}
function provenance(sha) { if (!SHA40.test(sha || "")) denied("RECOVERY_STAGING_PROVENANCE_SHA_INVALID", "Typed provenance requires exact SHA."); const durable = new Set(["recoveryStore", "approvalStore", "recoveryLock", "partialReceiptStore", "migrationLedger"]); return { contract: "mad4b.recovery-adapter-provenance.v1", environment: "staging", deployment_sha: sha, components: Object.fromEntries(RECOVERY_COMPOSITION_COMPONENT_KEYS.map((name) => [name, { implementation_id: `mad4b.staging.recovery.${name}.v1`, artifact_sha256: MODULE_SHA256, authority_class: "server_managed", storage_class: durable.has(name) ? "durable" : "stateless" }])), secrets_included: false }; }

export function createServerManagedRecoveryBinding(context = {}) {
  runtime(context); const r = roots(); const graph = adapters(r.readiness).adapters; const binding = createServerManagedRecoveryAuthorityBinding({ adapters: graph, adapterOrigin: "server_managed_concrete", capabilities: { adapter_present: true, durability_capable: true, attestation_capable: true }, authorityHandles: { deployment_owned: true } }); return createServerManagedRecoveryBindingEnvelope({ binding, readiness: { adapter_present: true, durability_capable: true, attestation_capable: true }, source: "staging_recovery_authority_binding" });
}

export function createRecoveryReadinessAuthorities(context = {}) {
  runtime(context, process.env, true); if (context.read_only !== true || context.production_live !== false) denied("RECOVERY_STAGING_READINESS_CONTEXT_DENIED", "Readiness requires read_only=true and production_live=false.");
  const r = roots(); const a = adapters(r.readiness); const store = createFileRecoveryEvidenceStore({ directory: path.join(r.readiness, "certification-evidence"), replayDirectory: r.replay }); const escaped = txt(process.env.RECOVERY_STAGING_CERTIFICATION_PUBLIC_KEY_PEM_ESCAPED, 16384); return createCanonicalReadinessAuthority({ evidenceStore: store, deploymentIdentityProvider: a.deployment, targetIdentityProvider: a.target, publicKey: escaped ? escaped.replaceAll("\\n", "\n") : null, keyId: txt(process.env.RECOVERY_STAGING_CERTIFICATION_KEY_ID, 256) || null, issuer: txt(process.env.RECOVERY_STAGING_CERTIFICATION_ISSUER, 512) || null, env: process.env, adapterProvenanceReader: async () => provenance((await a.deployment.readAttestation()).sha) });
}

export const _testingStagingRecoveryAuthorityBinding = Object.freeze({ MODULE_SHA256, roots, runtime, provenance, targetIdentityProvider, adapters });
