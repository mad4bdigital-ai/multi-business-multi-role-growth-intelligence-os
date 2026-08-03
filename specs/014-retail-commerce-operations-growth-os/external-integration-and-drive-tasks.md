# External Integration and Workspace File Fabric Tasks

All tasks remain unimplemented. Checkbox completion requires code, tests, review, and evidence in the relevant child PR.

## Phase A — Domain Authority Foundation

- [ ] A001 Define canonical `domain_key` registry and ownership rules.
- [ ] A002 Add additive migration for `domain_authority_bindings`.
- [ ] A003 Add immutable authority revision history.
- [ ] A004 Enforce one active writer per scope/domain with database uniqueness.
- [ ] A005 Add Domain Authority repository in infrastructure layer.
- [ ] A006 Add application resolver using Context Kernel evidence.
- [ ] A007 Reject zero-authority and ambiguous-authority writes.
- [ ] A008 Bind authority revision and mapping version into execution plans.
- [ ] A009 Invalidate plans and approvals on authority drift.
- [ ] A010 Add tenant/workspace/brand isolation tests.

## Phase B — Canonical Ports and Anti-Corruption

- [ ] B001 Define provider-neutral domain port interfaces.
- [ ] B002 Add `external_entity_bindings` persistence.
- [ ] B003 Add stable canonical-to-provider identity mapping service.
- [ ] B004 Prevent external IDs from granting resource authority.
- [ ] B005 Version mapping profiles independently from adapters.
- [ ] B006 Add collision and remapping conflict tests.
- [ ] B007 Add migration/backfill strategy for existing provider references.
- [ ] B008 Add bounded mapping readback evidence.

## Phase C — Provider Webhook Inbox

- [ ] C001 Add Inbox and processing-attempt migrations.
- [ ] C002 Add provider-specific signature verification plug-in interface.
- [ ] C003 Add timestamp and replay-window enforcement.
- [ ] C004 Add event-ID and payload-hash deduplication.
- [ ] C005 Acknowledge provider independently from business processing.
- [ ] C006 Add async Inbox worker and retry schedule.
- [ ] C007 Add unknown-outcome/readback transition.
- [ ] C008 Add dead-letter state and operator recovery.
- [ ] C009 Add bounded payload classification and redaction.
- [ ] C010 Add cross-connection and cross-tenant rejection tests.

## Phase D — Adapter Registry and Certification

- [ ] D001 Add adapter definition and version tables.
- [ ] D002 Add capability claim and constraint tables.
- [ ] D003 Add certification run and test-result tables.
- [ ] D004 Validate adapter/version/provider API/mapping compatibility.
- [ ] D005 Block authoritative activation without valid certificate.
- [ ] D006 Add certificate expiry, revocation, and replacement lifecycle.
- [ ] D007 Implement shared certification runner.
- [ ] D008 Implement no-secret evidence validator.
- [ ] D009 Add Sandbox connection profiles.
- [ ] D010 Add certification reporting UI and API.

## Phase E — Workspace File Domain Core

- [ ] E001 Define canonical file, folder, revision, permission, and operation models.
- [ ] E002 Add `workspace_file_records` migration.
- [ ] E003 Add parent-binding and external-binding persistence.
- [ ] E004 Add operational entity relation table.
- [ ] E005 Add file operation and item ledgers.
- [ ] E006 Add file readback evidence table.
- [ ] E007 Add retention/classification policy bindings.
- [ ] E008 Add Personal/Company/Brand owner-scope predicates.
- [ ] E009 Add file domain state machines.
- [ ] E010 Add Resource API safe read projections.

## Phase F — Google Drive Adapter v1

- [ ] F001 Replace fixed action switch with `WorkspaceFileAuthorityPort` implementation.
- [ ] F002 Resolve minimum OAuth scopes from capability policy.
- [ ] F003 Preserve current legacy action compatibility during transition.
- [ ] F004 Implement list with bounded pagination and Shared Drive options.
- [ ] F005 Implement escaped metadata/full-text search.
- [ ] F006 Implement metadata and safe content/export reads.
- [ ] F007 Stream binary data without coercing arbitrary bytes to text.
- [ ] F008 Implement small multipart upload.
- [ ] F009 Implement resumable upload and interruption recovery.
- [ ] F010 Implement folder creation under exact parent.
- [ ] F011 Implement rename with expected version.
- [ ] F012 Implement move with explicit add/remove parent semantics.
- [ ] F013 Implement copy with target owner-scope validation.
- [ ] F014 Implement trash and restore.
- [ ] F015 Implement high-risk permanent-delete capability separately.
- [ ] F016 Normalize provider errors without raw response disclosure.
- [ ] F017 Add same-cycle or explicit async readback for every mutation.
- [ ] F018 Add idempotency ledger integration.
- [ ] F019 Add quota and retry normalization.
- [ ] F020 Add full adapter certification tests.

## Phase G — Google Docs, Sheets, and Slides Creation

- [ ] G001 Route native document creation through dedicated API adapters.
- [ ] G002 Create Google Doc in exact parent and read back parent/name/type.
- [ ] G003 Create Google Sheet and optional initial worksheets safely.
- [ ] G004 Create Google Slides deck with bounded initial content.
- [ ] G005 Separate Drive file authority from Docs/Sheets/Slides content mutation authority.
- [ ] G006 Add revision and concurrency contracts for native documents.
- [ ] G007 Add export representation matrix.
- [ ] G008 Add scope-specific certification tests.

## Phase H — Permissions and Sharing

- [ ] H001 Add safe permission projection service.
- [ ] H002 Add internal user/group reader and writer grants.
- [ ] H003 Add permission removal with readback.
- [ ] H004 Handle inherited Shared Drive permissions.
- [ ] H005 Block `anyone` sharing by default.
- [ ] H006 Add external-domain policy and approval hold.
- [ ] H007 Add ownership-transfer step-up and separate capability.
- [ ] H008 Prevent personal-account sharing by workspace membership alone.
- [ ] H009 Add permission widening and downgrade audit evidence.
- [ ] H010 Add cross-tenant and email disclosure tests.

## Phase I — Revisions, Changes, and Reconciliation

- [ ] I001 Add revision-list and restore/copy service.
- [ ] I002 Add connection/space-scoped change cursor persistence.
- [ ] I003 Implement Drive Changes API worker.
- [ ] I004 Deduplicate repeated changes.
- [ ] I005 Handle deletion and trash transitions.
- [ ] I006 Detect invalid/stale cursor and launch bounded reconciliation.
- [ ] I007 Add periodic full reconciliation policy.
- [ ] I008 Add search-index freshness state.
- [ ] I009 Add missed-change and readback-mismatch alerts.
- [ ] I010 Add Shared Drive removal/reconnect tests.

## Phase J — Batch File Operations

- [ ] J001 Define batch operation compiler.
- [ ] J002 Reuse Sequential Plan Orchestrator for per-item steps.
- [ ] J003 Add deterministic per-item idempotency.
- [ ] J004 Add create-folder-tree operation.
- [ ] J005 Add batch upload operation.
- [ ] J006 Add batch move/copy/archive operations.
- [ ] J007 Add manifest and checksum generation.
- [ ] J008 Add stop/cancel/resume behavior.
- [ ] J009 Add partial-success result with requested/completed/failed/skipped counts.
- [ ] J010 Add compensating rollback only for safe reversible actions.
- [ ] J011 Implement the full RetailOS demo-package Drive reference case.
- [ ] J012 Verify no completed item duplicates after retry.

## Phase K — File Search and Knowledge Access

- [ ] K001 Add provider metadata search adapter.
- [ ] K002 Add authorized platform metadata index.
- [ ] K003 Revalidate live authority before returning indexed results.
- [ ] K004 Add bounded extracted-text pipeline by classification.
- [ ] K005 Bind extraction to exact file revision and provenance.
- [ ] K006 Add semantic retrieval only for approved content classes.
- [ ] K007 Prevent credentials, private content, and prohibited PII from evidence/indexes.
- [ ] K008 Add user-visible freshness and source labels.
- [ ] K009 Add deletion/permission-change deindexing.
- [ ] K010 Add search leakage tests across tenants and Brands.

## Phase L — APIs, Agent Tools, and UI

- [ ] L001 Implement `workspace-files.openapi.yaml` through Route/Controller/Application/Domain/Infrastructure layers.
- [ ] L002 Add Personal Workspace file endpoints.
- [ ] L003 Add Company Workspace file endpoints.
- [ ] L004 Add Brand file endpoints.
- [ ] L005 Add operation-status and recovery endpoints.
- [ ] L006 Register governed agent tools against application services only.
- [ ] L007 Ensure GPT context never receives provider credentials.
- [ ] L008 Add Arabic RTL responsive file workspace.
- [ ] L009 Add folder tree, search, filters, recent, shared, archive, and trash views.
- [ ] L010 Add batch upload progress and per-item recovery UI.
- [ ] L011 Add manifest/readback summary UI.
- [ ] L012 Add permission and destructive-action confirmation UX.
- [ ] L013 Add mobile upload and camera/file picker behavior.
- [ ] L014 Add WCAG 2.2 AA tests.

## Phase M — Operations and SLOs

- [ ] M001 Define file API availability and latency SLOs.
- [ ] M002 Define upload throughput and completion SLOs.
- [ ] M003 Define change-cursor freshness and reconciliation SLOs.
- [ ] M004 Add provider quota dashboards.
- [ ] M005 Add unknown-outcome, dead-letter, and readback mismatch alerts.
- [ ] M006 Add connection readiness and scope drift alerts.
- [ ] M007 Add retention and evidence access controls.
- [ ] M008 Add disaster recovery for metadata/operation ledgers.
- [ ] M009 Add provider outage degraded-mode runbook.
- [ ] M010 Add permission incident and accidental deletion runbook.

## Phase N — Pilot and Closeout

- [ ] N001 Select first pilot owner scope and Google account topology.
- [ ] N002 Run adapter certification in Sandbox.
- [ ] N003 Run reference batch case with real provider readback.
- [ ] N004 Run cross-user and cross-tenant denial suite.
- [ ] N005 Run large resumable upload fault injection.
- [ ] N006 Run permission widening approval test.
- [ ] N007 Run change cursor and reconciliation test.
- [ ] N008 Run responsive/accessibility acceptance.
- [ ] N009 Complete security, privacy, API, database, and operations reviews.
- [ ] N010 Promote through governed release and production readback.
- [ ] N011 Update completion evidence only after child PRs merge.
- [ ] N012 Keep unresolved provider/topology limitations in tracked backlog.
