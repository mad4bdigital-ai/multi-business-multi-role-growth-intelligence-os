# Threat Model

## Assets

Tenant isolation, platform administrative control, capability grants, connection references, approvals, delegation evidence, runtime certifications, decision integrity, and projection correctness.

## Trust boundaries

1. Client to authentication boundary
2. API to Control Plane
3. Control Plane to SQL/cache/events
4. Control Plane to projection surfaces
5. PEP to Data Plane/provider adapters
6. Admin delegation and break-glass
7. Tenant-to-Tenant resource boundary

## Threats and controls

### T1: Tenant scope injection

Caller supplies another tenant/workspace. Controls: immutable signed actor; subject normalization; membership validation; rejection of unapproved expansion; negative tests.

### T2: Admin wildcard bypass

`is_admin` or zero tenant bypasses policy. Controls: explicit platform scope; same PDP; visibility separate from execution; no generic bypass branch.

### T3: Confused deputy through support

Support action is attributed to tenant or exceeds diagnostic scope. Controls: actor/subject separation; operation-bound delegation; reason/ticket/expiry; audit lineage.

### T4: Tool visibility escalation

Visible tool is called without operation authority. Controls: dispatch PEP; manifest binding; exports never grant authority.

### T5: Connection substitution

Attacker forces a broader or platform-owned connection. Controls: deterministic ranking; ownership checks; source-tier policy; ambiguity blocking; selected connection bound to manifest.

### T6: Stale authorization reuse

Grant or membership is revoked after decision. Controls: version vectors; invalidation; TTL; final revalidation; single-use write manifests.

### T7: Approval replay

Approval is reused for another payload/resource. Controls: request hash and revision binding; expiry; consumption; idempotency; operation/resource binding.

### T8: Graph overreach

Inheritance exposes restricted resources. Controls: typed allowlisted relations; bounded traversal; restriction precedence; explicit inheritance; property tests.

### T9: Projection data leak

Dashboard/counts reveal unauthorized existence. Controls: projections consume authorized sets; caller-aware aggregation and redaction.

### T10: Policy tampering

Registry row silently expands authority. Controls: policy versioning; governed PAP; review/rollback metadata; audit; code invariants.

### T11: PDP outage bypass

Local services allow execution when PDP is unavailable. Controls: fail closed for mutations; no fallback authorization implementation.

### T12: Cache poisoning or stale projection

Incorrect cache persists. Controls: version-keyed cache; manifest hash checks; invalidation; live critical revalidation; reconciliation.

### T13: Explanation disclosure

Reason details leak private resources or policy internals. Controls: caller-aware redaction; safe codes; privileged diagnostics separated from Tenant responses.

### T14: Service-principal overreach

Agent inherits human/platform authority. Controls: explicit assignment and grants; actor lineage; no ambient credentials; resource-bound execution.

### T15: Decision-ledger leakage

Logs store tokens or sensitive payloads. Controls: hashes/references; schema rejection of secret-like fields; retention/access policy.

## Residual risks

Central PDP availability/latency, policy authoring mistakes, invalidation delay, complex shared-resource relations, and break-glass misuse. These require SLOs, synthetic testing, reconciliation, peer review, and post-incident audit.
