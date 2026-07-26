# Threat Model

## Protected assets

- tenant data and cross-tenant isolation;
- workflow and agent definitions;
- authority grants and approval holds;
- credential references and provider access;
- run state and audit evidence;
- callback and adapter channels;
- platform catalog integrity;
- fork lineage and upgrade decisions.

## Trust boundaries

1. Client/GPT to `auth.mad4b.com`.
2. API boundary to application/domain services.
3. Application to SQL authority and outbox.
4. Runtime dispatcher to external adapters/providers.
5. External provider callback to callback ingress.
6. Platform catalog to tenant installation/fork.
7. Platform admin authority to tenant-owned resources.

## Threats and controls

### Cross-tenant object access

**Threat:** Guessing another tenant's IDs or binding references.

**Controls:** object-level authorization, owner-container checks, tenant-scoped queries, deny-by-default, negative tests, and audited platform-admin exceptions.

### Authority confused with execution class

**Controls:** authority resolver ignores execution class; principal/grant/resource evidence is mandatory.

### Unsafe tenant override

**Threat:** Override widens permissions, disables approvals, selects an untrusted adapter, or raises limits.

**Controls:** typed definitions, sparse allowlist, deny-wins constraints, bounds, compatibility validation, immutable snapshot.

### Fork escapes governance

**Controls:** mandatory constraints attach through policy graph and are re-evaluated on compile/run; fork copies no credentials or grants.

### Callback spoofing or replay

**Controls:** signed body, opaque token, nonce, expiry, event binding, idempotency, request hash, rate limits, audit.

### Duplicate external effects

**Controls:** transactional outbox, operation-scoped idempotency, provider receipt inspection, unknown-outcome state, CAS transitions.

### SSRF or arbitrary endpoint execution

**Controls:** registry-resolved fixed domains/path templates, no arbitrary provider URL, input validation, outbound allowlist, response limits.

### Credential exfiltration

**Controls:** references only, least-privilege resolution at dispatch, no secrets in logs/snapshots/callbacks, redaction verification, no fork copying.

### Approval reuse

**Controls:** hold binds plan/settings/authority/adapter hashes, exact operation/resource, expiry, and one-time consumption where required.

### Catalog supply-chain compromise

**Controls:** immutable hashable versions, certification evidence, publication approval, compatibility report, staged rollout, retirement and kill switch.

### Graph cycle or ambiguity

**Controls:** cycle validation, deterministic ordering, `block_on_ambiguity`, snapshot lineage.

### Audit tampering

**Controls:** append-only ledgers, hashes, immutable evidence references, separated write/readback actors for high risk, retention policy.

## Security test requirements

- horizontal and vertical authorization matrices;
- property tests for merge operators and deny precedence;
- concurrent claim/transition tests;
- callback replay/skew/signature tests;
- timeout unknown-outcome tests;
- fork/override policy escape tests;
- secret scanning and log-redaction tests;
- SSRF/path/query injection tests;
- approval hash mismatch and expiry tests.
