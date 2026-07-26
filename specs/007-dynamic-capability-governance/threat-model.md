# Threat Model

## Protected assets

- tenant and workspace isolation;
- canonical capability and policy authority;
- resource ownership and grants;
- credentials and secret references;
- approvals and invocation envelopes;
- provider resources and external effects;
- certification/readback evidence;
- audit/debt integrity;
- repository and deployment state.

## Threat actors

- authenticated Tenant user exceeding scope;
- compromised Tenant token;
- malicious or misconfigured Admin caller;
- buggy route/tool projection;
- stale or compromised adapter;
- provider returning ambiguous outcomes;
- registry drift or conflicting migrations;
- automation replaying approvals or envelopes.

## Threats and mitigations

### Alias confusion and selector smuggling

**Threat:** caller selects an Admin or weaker-policy alias of the same operation.  
**Mitigation:** exactly one selector, canonical identity before policy, alias parity, conflict denial, Tenant/Admin exposure separation.

### Automatic unsafe projection

**Threat:** registry presence causes callable Tenant export.  
**Mitigation:** projection is non-authoritative; requires tenant-safe policy, bounded schema, authority, rollout, and explicit reconciliation apply.

### Policy downgrade by surface metadata

**Threat:** permissive tags or adapter metadata remove canonical obligations.  
**Mitigation:** surface overrides only strengthen; compiler rejects downgrade; manifest source evidence is auditable.

### Cross-tenant resource access

**Threat:** caller supplies foreign tenant, workspace, brand, site, repo, or connection ID.  
**Mitigation:** signed identity, capability-specific resource binding, scoped joins, foreign-reference denial before credential/provider access.

### Credential confusion or exposure

**Threat:** adapter chooses broader credentials or secrets appear in output.  
**Mitigation:** credentials resolve after authority, exact binding scope, reference-only context, output/log secret scanners, no provider auth fields in Tenant schema.

### Approval and envelope replay

**Threat:** approval for one request/resource is reused.  
**Mitigation:** request hash, resource, capability, revision, expiry, single-use envelope, idempotency reservation, optimistic concurrency.

### Certification bypass

**Threat:** endpoint active status is treated as certified.  
**Mitigation:** separate current versioned certification and readback contract; stale/drifted/revoked states block.

### Provider ambiguity and duplicate effects

**Threat:** timeout or retry creates duplicate external mutation.  
**Mitigation:** idempotency identity, acknowledgement/readback separation, unknown-effect state, no blind retry, manual intervention/compensation path.

### Evidence forgery or silent repair

**Threat:** dashboard state marks issue resolved without matching execution evidence.  
**Mitigation:** append-only evidence, operation/resource fingerprints, same-cycle readback, capability debt closure audit.

### Registry poisoning

**Threat:** unreviewed OpenAPI or descriptor row becomes execution authority.  
**Mitigation:** discovery rows are non-callable until governed binding/policy/certification; source provenance and revision validation.

### Denial of service

**Threat:** full inventory compilation or gap queries exhaust resources.  
**Mitigation:** keyset pagination, scan limits, checkpoints, advisory locks, incremental revisions, bounded responses, circuit breakers.

### Rollback weakening containment

**Threat:** disabling new enforcement restores unsafe legacy access.  
**Mitigation:** P0 containment is independent and cannot be disabled by cohort rollback; unsafe Tenant/Admin mappings stay blocked.

## Security review triggers

- new effect/risk class;
- new resource authority model;
- Tenant projection of a previously Admin-only operation;
- provider write, send, spend, publish, deploy, credential, destructive, or local-device capability;
- adapter or readback contract version change;
- approval reuse or bounded-automatic policy;
- cross-tenant inheritance or platform fallback.
