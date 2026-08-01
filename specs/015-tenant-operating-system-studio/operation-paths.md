# Operation Paths

## OP-001 — Create a package draft

```text
principal/context resolution
→ authoring capability check
→ create package definition
→ create draft version
→ persist owner and lineage
→ return draft receipt/readback
```

No publication, installation, connection, permission, or runtime effect.

## OP-002 — Add or revise a component

```text
resolve package draft and component scope
→ validate component type eligibility
→ validate strict schema
→ reject secrets/unrestricted code
→ persist immutable component draft revision
→ update package draft reference
→ compile/readback candidate
```

## OP-003 — AI-assisted package generation

```text
resolve bounded authoring context
→ minimize input and apply sensitivity policy
→ dispatch provider job
→ validate structured output and semantics
→ create proposed draft components only
→ show unsupported/missing/conflicting items
→ human edits or accepts draft content
```

AI cannot publish, activate, grant, bind credentials, or choose hidden client scope.

## OP-004 — Validate and compile a package version

```text
exact draft candidate
→ manifest/schema/reference validation
→ component/dependency cycle detection
→ policy and eligibility composition
→ profile/activity applicability
→ compatibility and migration checks
→ test-plan generation
→ normalized manifest + lineage + hash
→ validation report
```

Compilation is read-only with respect to live systems.

## OP-005 — Publish a package version

```text
validated immutable candidate
→ publication authority
→ audience/install/customization policy
→ required security/marketplace review
→ exact-candidate approval
→ compare-and-set publication pointer
→ event/invalidation
→ same-cycle readback
```

Publication does not install or activate the package.

## OP-006 — Plan an installation

```text
resolve target Tenant/Workspace/Brand/client
→ verify package publication/audience eligibility
→ create installation intent
→ inventory profiles/resources/connections/roles
→ identify missing configuration and approvals
→ create draft installation revision
→ return readiness/gap plan
```

No credentials are read and no authority is created.

## OP-007 — Configure an installation

```text
load exact draft installation revision
→ apply sparse schema-valid overrides
→ add approved extensions
→ bind resource/connection references
→ resolve role templates and required capabilities
→ compile effective installation
→ conflicts/lineage/version vector/hash
→ impact preview
```

Caller-supplied IDs are constraints only and cannot override authenticated scope.

## OP-008 — Sandbox and acceptance

```text
exact package + installation candidate hash
→ isolated sample dataset
→ sandbox-only adapters/effects
→ contract/state/security/isolation/accessibility tests
→ canonical structured evidence
→ classify ready/warning/blocked/stale
```

Sandbox data and effects never silently become production state.

## OP-009 — Activate an installation revision

```text
ready candidate
→ fresh context and authority
→ package/component/publication freshness
→ required resource/connection readiness
→ acceptance evidence freshness
→ approvals and effect boundary
→ compare-and-set active revision
→ generated surface/event invalidation
→ same-cycle readback
```

Activation does not bypass final per-operation authorization.

## OP-010 — Execute an installed system operation

```text
principal and exact installation context
→ active revision and resource resolution
→ capability/policy/approval evaluation
→ workflow/lifecycle expected-state checks
→ adapter readiness and effect classification
→ idempotent dispatch/outbox
→ delivery/readback/evidence
→ state transition and user-visible status
```

## OP-011 — Upgrade an installation

```text
target package version available
→ three-way comparison
→ compatibility/conflict/migration report
→ proposed installation revision
→ sandbox/acceptance
→ owner approval
→ activate/readback
→ retain prior revision for rollback
```

## OP-012 — Roll back

```text
incident or owner request
→ freeze new risky effects
→ reconcile unknown outcomes
→ validate rollback target and dependencies
→ create/activate rollback revision
→ invalidate surfaces/caches/jobs as required
→ smoke/readback
```

History is preserved.

## OP-013 — Fork or export a package

```text
verify ownership/export rights
→ select exportable definitions
→ remove installation/client/private state
→ reject secrets/grants/signed URLs
→ generate provenance/content hashes
→ create tenant-owned draft fork or export manifest
→ validate/readback
```

## OP-014 — Agency/client handover

```text
ownership and contract verification
→ package/installation/data/file/connection inventory
→ transferability findings
→ backup/export and client operator readiness
→ recreate/transfer client-owned dependencies
→ critical workflow tests under client principal
→ revoke agency delegation
→ continuity and denial readback
```

## OP-015 — Suspend, uninstall, or retire

```text
impact inventory
→ block new effects
→ drain/reconcile jobs and callbacks
→ revoke temporary/public links
→ preserve/export/retain records and files
→ archive generated surfaces
→ dependency/readback report
```

Destructive deletion is a separate data-lifecycle operation.

## OP-016 — Reconcile PR #3922 and PR #4432

```text
inventory candidate artifacts
→ classify generic substrate vs child-pack content
→ map duplicate Spec 014 identities and dependencies
→ compare against current main foundations
→ produce extraction matrix
→ reconstruct bounded current-main child branches
→ validate under Spec 015 contracts
```

No history rewrite or direct merge of stale/diverged branches is required.