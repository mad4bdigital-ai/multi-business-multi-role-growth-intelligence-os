# DFR-007 — Policy-Bound, Cryptographically Attested, Claim-Level Verifiable Knowledge Fabric

## Status

**Approved design. Implementation is not authorized.**

The platform adopts a **Policy-Bound, Cryptographically Attested, Claim-Level Verifiable Knowledge Fabric**.

Artifacts and knowledge are represented by stable logical identities and immutable content-addressed versions. Every consequential version may be traced through authenticated source identity, signed ingestion/transformation attestations, claim/evidence/citation relationships, multi-dimensional trust assessment, policy inheritance, reproducibility evidence, versioned knowledge builds, retrieval evidence, and tamper-evident transparency records.

The platform explicitly separates:

```text
content integrity
publisher/source authenticity
provenance completeness
factual support
methodological quality
freshness
license compatibility
policy eligibility
publication approval
```

No checksum, signature, verification result, trust score, access grant, or publication state substitutes for another dimension.

No schema migration, content backfill, artifact publication, correction, retraction, erasure, knowledge indexing, embedding generation, model/provider call, credential read, external write, or production enforcement is authorized by this document.

## 1. Authoritative knowledge sequence

```text
authenticated source identity
→ immutable content-addressed source version
→ signed ingestion attestation
→ reproducible transformation manifest
→ immutable artifact version
→ claim/evidence/citation graph
→ multi-dimensional trust evaluation
→ policy-carrying eligibility decision
→ versioned knowledge build
→ retrieval/answer evidence
→ tamper-evident transparency record
→ correction, retraction, restriction, or disposition propagation
```

## 2. Stable artifact identity and immutable versions

An Artifact is a stable logical identity such as a report, document, dataset, prompt, template, image, transcript, source record, generated answer, knowledge source, evaluation set, or exported package.

An Artifact Version is immutable and binds:

```text
artifact_id
artifact_version_id
artifact_type/schema versions
canonical content checksum
stored representation checksum
content size/media type/encoding
source/version vector
ingestion/transformation manifests
producer principal/workflow/activity/model/tool
Effective Runtime Manifest
classification/policy envelope
observed/effective/freshness evidence
transparency record
```

A correction or content change creates a new version. Storage URI, Drive file ID, filename, database row ID, updated timestamp, or mutable provider alias is never sufficient version identity.

Canonical content checksum and stored-object checksum remain separate so encoding, packaging, compression, and representation changes are explainable.

## 3. Source identity and cryptographic attestations

Checksum proves equality against a known digest; it does not prove who produced the content or whether the producer was authorized.

Source identity may bind a registered person, organization, Tenant, service principal, provider, repository, database authority, device, instrument, publication, or external authority.

Attestation types include:

```text
source_identity_attestation
ingestion_attestation
content_integrity_attestation
transformation_attestation
verification_attestation
publication_attestation
correction_attestation
retraction_attestation
disposition_attestation
```

Each attestation binds the exact object/version, signer identity, authority/scope, signature algorithm/key reference, signed checksum, issued/expiry/revocation evidence, trust domain, and verification result.

Raw private keys and signing secrets are never stored in artifact registries.

For critical knowledge families, a tamper-evident transparency log records ordered entry hashes and periodic Merkle roots or equivalent append-only proofs. Independent witnesses may attest selected roots. The design does not require a public blockchain.

## 4. Claim-level epistemic graph

Artifact-wide labels are insufficient. A version may contain supported, uncertain, stale, opinion, predictive, or contradicted statements simultaneously.

Claims are addressable objects with exact location and context. Claim types include:

```text
fact
estimate
measurement
assumption
opinion
recommendation
prediction
policy_statement
legal_statement
commercial_statement
```

Claim relationships include:

```text
supported_by
contradicted_by
derived_from
qualifies
supersedes
equivalent_to
aggregates
valid_under_context
```

Each claim records canonical text/value checksum, location, semantic type, subject/predicate/object or structured representation where available, effective context, confidence evidence, review state, and usage limits.

Contradictory evidence is preserved and exposed to eligible resolvers. The system must not hide disagreement by collapsing all evidence into one score.

## 5. Citations and addressable evidence

A Citation links a specific Claim to a specific Source Version and exact locator, such as:

- page, section, paragraph, line, or character/byte range;
- JSON Pointer or object key;
- row, column, primary key, or query-result checksum;
- audio/video timestamp range;
- image region;
- chunk ID and checksum;
- immutable repository commit/path/range;
- provider/reference identifier plus captured version evidence.

A floating URL, latest file, mutable database query, or current Drive document is not sufficient high-risk evidence without version capture or immutable snapshot evidence.

Citation validation checks target existence, locator validity, checksum, audience, license, disclosure policy, and whether the cited evidence actually supports the claim under the registered verification method.

## 6. Multi-dimensional trust vector

Verification is represented as independent trust dimensions rather than one `verified=true` flag or one composite score.

Initial dimensions include:

```text
identity_trust
content_integrity
source_authority
provenance_completeness
citation_coverage
factual_support
methodological_quality
freshness
license_compatibility
policy_eligibility
reproducibility
human_review
cross_source_corroboration
```

Each task/risk/publication profile declares mandatory dimensions, thresholds, freshness, confidence, review, and zero-tolerance conditions.

A weighted score may rank already eligible versions but cannot override a failed mandatory dimension.

Examples:

- internal low-risk drafting may accept declared provenance and moderate freshness;
- financial/legal/regulated output requires authoritative sources, exact citations, current evidence, and independent review;
- public publication requires license, attribution, Brand, safety, citation, and freshness approval;
- model training or evaluation requires explicit purpose, license, consent/data policy, provenance, dataset quality, and reproducibility evidence.

## 7. Reproducible knowledge builds

Every generated summary, dataset, knowledge chunk, embedding, index, report, evaluation set, or answer may bind a Reproducibility Manifest containing:

```text
exact source version set and order
transformation definition/version
handler/build digest
model provider/endpoint/version/inference profile
prompt/template checksum
parameters and canonicalization rules
runtime manifest and governance epochs
environment/tool dependencies
random seed or recorded nondeterministic inputs where applicable
expected output/schema/checksum class
```

Reproducibility classifications include:

```text
bit_reproducible
semantically_reproducible
bounded_nondeterministic
not_reproducible
```

A reproduction run creates new evidence and never rewrites the original build. Difference classification, tolerance, reviewer, and reason are preserved.

Non-reproducible content may remain usable for bounded purposes, but cannot silently receive a stronger trust tier.

## 8. Policy-carrying artifact versions

Every Artifact Version carries or resolves an immutable Policy Envelope referencing:

```text
classification and sensitivity
purpose and lawful-basis/consent constraints
eligible audiences and disclosure profile
ownership and license terms
attribution requirements
allowed transformations and derivative uses
model/provider inference, embedding, evaluation, and training permissions
residency and transfer constraints
retention, legal hold, and subject restrictions
publication and export constraints
```

Derived policy is conservative:

```text
most restrictive applicable source policy
+ transformation-specific restrictions
+ destination/use policy
```

A summary, redaction, anonymization, or format conversion does not automatically become public or unrestricted. Declassification requires a registered transformation, verification, authority, and approval.

Access authority does not imply license permission. License permission does not imply object authority. Authenticity does not imply factual truth. Factual support does not imply publication approval.

## 9. Selective-disclosure provenance

Full provenance may itself contain Tenant-private, personal, contractual, security-sensitive, or legally protected information.

The platform supports registered provenance projections such as:

```text
public
tenant_member
tenant_admin
operator
auditor
legal
regulator
```

A projection may disclose an opaque source/evidence reference, checksum, source class, trust result, and attestation status without exposing restricted content or identity.

Selective disclosure never fabricates a simpler lineage, hides a material contradiction, or claims a stronger trust result. Redaction and omission are explicit and checksummed.

## 10. Knowledge source, chunk, embedding, and index versions

Knowledge sources and indexes are versioned artifacts rather than mutable unnamed stores.

A Knowledge Index Version binds:

```text
exact source version membership
eligibility/filter decisions
normalization/redaction/chunking profile versions
chunk version identities and checksums
embedding provider/model/version/inference profile
vector dimensions/distance policy
retrieval and reranking policy versions
index/build checksum
classification/audience/license/residency
freshness and invalidation state
```

Each Chunk Version links to the exact Source Version and precise locator. Each Embedding Version links to the Chunk Version, exact embedding model/profile, dimensions, preprocessing, and checksum.

No index build silently replaces a prior version. Alias movement resolves to an exact captured version before use.

## 11. Retrieval and answer evidence

A consequential retrieval produces immutable evidence containing:

```text
query or intent checksum
Tenant/principal/context/purpose
authorized index/version candidate set
selected index versions
retrieved chunk versions and locators
scores and reranking evidence
excluded sources and stable reasons
citation/claim set
manifest and governance epochs
freshness and trust decisions
```

Retrieval rank cannot override audience, purpose, data, license, freshness, retraction, or verification gates.

Generated answers link claims and citations to retrieval evidence and exact source/chunk versions. Unsupported claims remain marked unsupported, assumption, opinion, or prediction rather than being presented as sourced fact.

## 12. Correction, supersession, and retraction

Corrections create new immutable versions and explicit `corrects`/`supersedes` relations.

Retraction:

- prevents new eligible use according to policy;
- preserves allowed historical/audit evidence;
- advances the artifact governance epoch;
- invalidates affected caches, retrieval sets, indexes, manifests, and promotion candidates;
- identifies descendants requiring rebuild, restriction, correction, notification, or manual review.

A corrected Artifact does not silently rewrite historical outputs that used the prior version. Those outputs retain source evidence and may receive impact/review status.

## 13. Disposition, erasure, and legal hold

Retraction is not erasure. Erasure is governed by DFR-003 and may remove content from primary storage and derived surfaces while preserving a minimal no-content tombstone where legally and operationally permitted.

Disposition actions may include:

```text
delete
rebuild
invalidate
retract
anonymize
aggregate
archive
retain_under_hold
notify
```

Propagation covers summaries, chunks, embeddings, indexes, Agent memory, evaluation datasets, analytics, reports, exports, caches, provider copies, backups, and promotion candidates.

Legal hold prevents specified deletion or mutation but never grants read or reuse authority.

## 14. Dynamic authorities

Initial typed versioned registries and records include:

```text
artifact_type_registry
artifact_schema_registry
artifact_registry
artifact_versions
artifact_content_objects
artifact_representations
artifact_source_identity_registry
artifact_attestation_type_registry
artifact_identity_attestations
artifact_integrity_attestations
artifact_transparency_log
artifact_transparency_roots
artifact_transparency_witnesses
artifact_provenance_edge_type_registry
artifact_provenance_edges
artifact_source_evidence
artifact_claim_type_registry
artifact_claims
artifact_claim_relation_type_registry
artifact_claim_relations
artifact_claim_evidence
artifact_citations
artifact_transformation_runs
artifact_trust_dimension_registry
artifact_trust_policy_versions
artifact_trust_assessments
artifact_verification_policy_registry
artifact_verification_runs
artifact_verification_results
artifact_policy_envelopes
artifact_policy_inheritance_runs
artifact_reproducibility_manifests
artifact_reproduction_runs
artifact_selective_disclosure_profiles
artifact_provenance_projections
artifact_publication_decisions
artifact_freshness_policies
knowledge_source_registry
knowledge_source_versions
knowledge_chunk_versions
knowledge_embedding_versions
knowledge_index_registry
knowledge_index_versions
knowledge_index_memberships
knowledge_retrieval_evidence
artifact_correction_runs
artifact_retraction_runs
artifact_disposition_runs
artifact_dependency_invalidation_events
artifact_governance_epochs
```

Registry data selects only allowlisted schemas, verification methods, transformation handlers, signing providers, storage adapters, model profiles, and policy operators. It cannot inject arbitrary executable code, SQL, shell, URLs, headers, or credential values.

## 15. Lifecycle

Representative Artifact Version lifecycle:

```text
discovered
→ ingested
→ validated
→ verification_required | verified
→ publication_required | published
→ stale | restricted
→ superseded | corrected | retracted
→ disposition_pending
→ content_erased_with_tombstone | archived
```

Artifact logical identity and each version have separate lifecycle projections. Historical versions remain reconstructable subject to legal erasure, retention, and disclosure policy.

Knowledge Index lifecycle includes building, validating, active, stale, invalidated, rebuilding, restricted, retired, and archived.

## 16. Eligibility resolver

Before an Artifact Version, Claim, Citation, Chunk, Embedding, Index, or Retrieval Result is used, the resolver evaluates:

```text
exact version resolution
object authority and Tenant scope
purpose/data-use eligibility
content integrity and source authenticity
provenance completeness and contradiction state
required trust dimensions
freshness and effective time
sensitivity/audience/selective disclosure
license/attribution/permitted transformation
residency/transfer
retention/legal hold/subject restriction
retraction/correction/dependency invalidation
manifest/governance epoch
```

Missing, stale, conflicting, revoked, unsupported, or ambiguous mandatory evidence fails closed for consequential use.

## 17. Effective Runtime Manifest integration

The manifest binds applicable:

```text
artifact/version/content/schema checksums
source version set
attestation/transparency evidence
provenance graph checksum
claim/evidence/citation set
transformation/reproducibility manifests
trust policy and assessments
policy envelope/inheritance decision
freshness/effective-time evidence
knowledge source/chunk/embedding/index versions
retrieval/reranking/citation evidence
correction/retraction/disposition state
artifact-governance epoch and expiry
```

Pre-use or pre-publication revalidation checks version existence, integrity, source/attestation revocation, trust/freshness, policy eligibility, retraction/invalidation, and governance epoch.

## 18. API direction

Tenant/resource surfaces:

```text
GET  /tenant/artifacts
GET  /tenant/artifacts/{artifactId}
GET  /tenant/artifacts/{artifactId}/versions
GET  /tenant/artifact-versions/{versionId}
GET  /tenant/artifact-versions/{versionId}/provenance
GET  /tenant/artifact-versions/{versionId}/claims
GET  /tenant/artifact-versions/{versionId}/citations
GET  /tenant/artifact-versions/{versionId}/trust
GET  /tenant/artifact-versions/{versionId}/policy-envelope
GET  /tenant/artifact-versions/{versionId}/reproducibility
GET  /tenant/artifact-versions/{versionId}/transparency
POST /tenant/artifacts/{artifactId}/correction-runs/preview
POST /tenant/artifacts/{artifactId}/correction-runs
POST /tenant/artifacts/{artifactId}/retraction-runs/preview
POST /tenant/artifacts/{artifactId}/retraction-runs
GET  /tenant/knowledge-sources
GET  /tenant/knowledge-indexes
GET  /tenant/knowledge-indexes/{indexId}/versions
GET  /tenant/knowledge-retrieval-evidence/{evidenceId}
```

Admin/governance surfaces include source/attestation, trust policy, verification, transparency, reproducibility, index-build, correction/retraction, invalidation, and disposition previews/runs.

All mutations require exact object authority, version preconditions, idempotency, bounded schemas, approval/separation of duties where required, immutable evidence, audit, governance-epoch invalidation, and same-cycle readback.

Preview performs no content write, signing, publication, correction, retraction, deletion, index/embedding build, model/provider call, credential read, cache invalidation, notification, or external write.

## 19. Stable blocking conditions

```text
ARTIFACT_NOT_FOUND
ARTIFACT_VERSION_MISSING
ARTIFACT_VERSION_AMBIGUOUS
ARTIFACT_CHECKSUM_MISMATCH
ARTIFACT_SCHEMA_UNSUPPORTED
ARTIFACT_SOURCE_IDENTITY_UNVERIFIED
ARTIFACT_ATTESTATION_MISSING
ARTIFACT_ATTESTATION_INVALID
ARTIFACT_ATTESTATION_REVOKED
ARTIFACT_TRANSPARENCY_PROOF_INVALID
ARTIFACT_PROVENANCE_INCOMPLETE
ARTIFACT_PROVENANCE_CYCLE
ARTIFACT_SOURCE_VERSION_UNAVAILABLE
ARTIFACT_CLAIM_UNSUPPORTED
ARTIFACT_CLAIM_CONTRADICTED
CITATION_TARGET_UNRESOLVED
CITATION_LOCATOR_INVALID
ARTIFACT_TRUST_POLICY_MISSING
ARTIFACT_TRUST_THRESHOLD_NOT_MET
ARTIFACT_VERIFICATION_MISSING
ARTIFACT_VERIFICATION_STALE
ARTIFACT_FRESHNESS_EXPIRED
ARTIFACT_AUDIENCE_DENIED
ARTIFACT_LICENSE_INCOMPATIBLE
ARTIFACT_POLICY_INHERITANCE_FAILED
ARTIFACT_REPRODUCIBILITY_INSUFFICIENT
ARTIFACT_SELECTIVE_DISCLOSURE_DENIED
ARTIFACT_RESTRICTED
ARTIFACT_RETRACTED
ARTIFACT_CORRECTION_REQUIRED
ARTIFACT_RETENTION_CONFLICT
ARTIFACT_LEGAL_HOLD_CONFLICT
KNOWLEDGE_INDEX_STALE
KNOWLEDGE_INDEX_INVALIDATED
KNOWLEDGE_CHUNK_SOURCE_RETRACTED
KNOWLEDGE_EMBEDDING_PROFILE_STALE
KNOWLEDGE_RETRIEVAL_EVIDENCE_MISSING
ARTIFACT_GOVERNANCE_EPOCH_CHANGED
```

## 20. Hard invariants

- Artifact logical identity is stable; content-bearing versions are immutable and content-addressed.
- Storage location, filename, mutable URL, latest alias, or modified timestamp is never sufficient version identity.
- Checksum proves integrity, not source authenticity or factual truth.
- Signature proves control of a signing identity, not factual truth or publication eligibility.
- Trust dimensions remain independently explainable; weighted ranking cannot override mandatory gates.
- Claim-level support and contradiction remain visible and versioned.
- Consequential citations target exact immutable source versions and locators.
- Derived policy is at least as restrictive as all applicable source and destination policies unless an approved declassification transformation proves otherwise.
- Provenance disclosure obeys audience policy without fabricating or materially hiding lineage.
- Knowledge chunks, embeddings, indexes, and retrieval evidence link to exact source/build/model versions.
- Correction creates a new version; retraction blocks new eligible use; neither rewrites historical evidence.
- Erasure propagates through derivatives under DFR-003 and may retain only permitted minimal tombstones.
- Reproducibility evidence preserves exact source, handler/model, prompt/template, parameter, and environment versions.
- Registry rows cannot inject arbitrary executable behavior, provider endpoints, headers, or secrets.
- Missing, stale, conflicting, unsupported, revoked, or ambiguous mandatory evidence fails closed.

## 21. Scope boundaries

DFR-007 defines artifact/knowledge identity, provenance, claims, trust, policy inheritance, reproducibility, selective disclosure, correction/retraction, knowledge builds, and retrieval evidence.

It integrates with but does not replace:

- DFR-003 for data purpose, classification, retention, legal hold, subject rights, and erasure;
- DFR-005 for exact model eligibility and evaluation/readiness;
- DFR-006 for durable Workflow/Activity/Effect execution and recovery;
- DFR-008 for complete temporal/geospatial semantics;
- DFR-009 for software package/SBOM/code supply-chain trust;
- DFR-010 for general quality evaluation and promotion governance;
- DFR-011 for platform-wide contract/schema compatibility.

## 22. Migration direction

Existing `output_artifacts`, `json_assets`, `json_asset_subject_links`, `memory_scope_links`, `platform_graph_*`, `session_drive_artifacts`, session summaries, Drive references, knowledge surfaces, and execution evidence remain compatibility sources.

Migration is additive and family-specific:

```text
inventory and classify
→ register logical Artifact identities
→ capture immutable versions/checksums where evidence exists
→ link source and transformation evidence
→ mark incomplete/unknown provenance explicitly
→ shadow eligibility/trust/policy resolution
→ build versioned knowledge projections
→ test correction/retraction/disposition propagation
→ canary reads and publication families
→ retire legacy authority only after parity and rollback
```

Backfill never invents source, signature, verification, license, freshness, or claim support. It does not invoke models/providers, generate embeddings, publish, correct, retract, erase, notify, or write externally merely to populate registries.

## 23. Final decision

> **DFR-007 — Policy-Bound, Cryptographically Attested, Claim-Level Verifiable Knowledge Fabric.** The platform uses stable Artifact identities and immutable content-addressed versions, authenticated source identities, signed attestations, tamper-evident transparency records, claim/evidence/citation graphs, multi-dimensional trust, conservative policy inheritance, reproducibility manifests, selective-disclosure provenance, and versioned knowledge chunks/embeddings/indexes/retrieval evidence. Correction creates a new version, retraction prevents new eligible use, and disposition propagates through derivatives without rewriting permitted history. No checksum, signature, trust score, access grant, license, or publication decision substitutes for another required gate.
