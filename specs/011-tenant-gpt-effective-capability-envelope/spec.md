# Feature Specification: Tenant GPT Effective Capability Envelope

**Branch:** `gpt/011-tenant-gpt-effective-capability-envelope`  
**Status:** specification implementation started  
**Source ticket:** `0314ec00-6ca0-4f4d-af4a-7532f85c4a7c`

## Problem

Tenant GPT can understand user intent while still presenting options, recommendations, or execution claims that are not bound to the current Brand, exact resource, exact connection, effective authority, verified schema, or current readiness. This creates wrong-resource risk, scope widening, stale-evidence decisions, misleading callability, contradictory next actions, and exposure of internal platform detail.

## Scope

- Natural-language intent resolution into canonical capability candidates.
- Context inheritance: Tenant → Workspace → Brand → Business Type → Business Activity → Resource Tree → App/Provider → Exact Connection → Capability → Tool/Action → Input Schema → Role/Authority → Runtime/Policy.
- Effective Capability Envelope (ECE) projection.
- Multi-dimensional readiness and freshness.
- Exact resource and connection binding.
- Schema-driven interactive questionnaires.
- Contradiction detection before recommendations.
- Resource-scoped grants and invitations.
- Preview, approval, idempotency, execution, readback, reconciliation, retry, and support continuity.
- Arabic/localized labels with stable internal keys.
- Customer-safe projection and bounded diagnostics.
- WordPress, ads, CRM, analytics, workflows, devices, connections, infrastructure, and future capabilities.

## Non-goals

- No replacement of existing capability governance, resource authority, connection authority, or operation orchestration.
- No caller-supplied Tenant/user identity as authority.
- No provider mutation from a questionnaire option.
- No copying Admin tools into Tenant catalogs.
- No global cutover.
- No secrets, raw credentials, table names, unrestricted graph IDs, foreign-scope references, stack traces, or raw provider errors in Tenant responses.
- No invitation, publishing, campaign activation, device action, migration, merge, or deployment in this specification branch.

## Definitions

- **Intent option:** conversational choice used to narrow the request; never execution authority.
- **Capability:** canonical governed operation identity.
- **Tool:** governed interface exposing a capability on a surface.
- **Action:** bounded operation with typed inputs, effect, and readback.
- **ECE:** short-lived no-secret projection binding principal scope, resource, connection, capability, schema, readiness, authority, policy, and next step.
- **Live evidence:** same-cycle or unexpired verified provider/runtime evidence.
- **Indexed evidence:** non-sensitive metadata with source, observed time, schema fingerprint, verification status, and expiry.
- **Inferred option:** intent suggestion without verified executable binding.

## Core scenarios

### Brand-scoped manager invitation

A Workspace owner requests Manager access for one Brand. The system resolves the exact Brand, previews direct and inherited access, uses a resource-scoped grant when callable, requires approval where configured, applies idempotently, and reads back the effective grant. It must not substitute a Workspace-wide invitation without explicit informed approval.

### WordPress travel content

A user selects “trip or activity”. The system treats this as intent, resolves Brand and exact WordPress Site/Connection, discovers verified content types such as `tour`, `trip`, or `activity`, loads the real schema, asks only missing fields, previews target/status, and creates a draft only when authorized. Without verified matching resources, the option remains inferred and non-executable.

### Draft-only authority

When direct publishing is unavailable but draft creation is allowed, the assistant states the verified limit and offers the draft path without implying publish authority.

### Healthy devices

If enabled healthy devices already satisfy the need, install/reinstall recommendations are suppressed. Local Manager is used for management, consent, repair, or adding a device.

### Ads, CRM, analytics, workflows, and support retry

Each domain resolves its exact resource, connection, live schema, authority, approval, and readback contract. After remediation, the original operation can be retried with fresh evidence while retaining valid non-sensitive context.

## Functional requirements

### Identity and context

- **FR-001:** Tenant and user identity MUST come from the authenticated principal; caller overrides are ignored or rejected.
- **FR-002:** Workspace MUST resolve before Brand or resource discovery.
- **FR-003:** Brand resolution MUST use canonical authorized references; ambiguity fails closed.
- **FR-004:** The pilot canonical key is `allroyalegypt_wp`; `allroyallegypt_wp` MUST NOT silently inherit authority.
- **FR-005:** Business Activity MUST resolve through `business_activity_type_registry` before compatibility decisions.
- **FR-006:** Resource graph expansion MUST return only authorized nodes.

### Intent resolution

- **FR-007:** The resolver MUST accept natural language without requiring a capability key.
- **FR-008:** Candidate ranking MUST use resource context, activity compatibility, Tenant exposure, readiness, and authority.
- **FR-009:** General inference MAY suggest options but MUST label them `inferred_only` until verified.
- **FR-010:** Questionnaire selections MUST NOT grant capability, resource, connection, or execution authority.
- **FR-011:** Ambiguous top-ranked executable candidates MUST produce clarification.

### Effective Capability Envelope

- **FR-012:** Every executable or previewable recommendation MUST be backed by one ECE.
- **FR-013:** The ECE MUST bind principal scope, Workspace, Brand/resource, Business Activity, app/provider, exact connection, canonical capability, tool/action, schema revision/fingerprint, authority revision, readiness revision, policy revision, request hash, and expiry.
- **FR-014:** The ECE MUST derive from existing authorities and MUST NOT become independent authority.
- **FR-015:** Tenant projection MUST omit secrets, raw credentials, internal tables, unrestricted graph IDs, stack traces, and foreign scope.
- **FR-016:** Mutation ECEs MUST be single-use by default; stale revisions block execution.
- **FR-017:** Candidate state MUST be `executable_now`, `preview_only`, `blocked`, or `inferred_only`.

### Exact resource and connection binding

- **FR-018:** Selection MUST validate Tenant + Workspace + Brand + exact resource + grant + connection.
- **FR-019:** `app_key`, provider family, domain string, or connection status alone MUST NOT select a connection.
- **FR-020:** `metadata_only`, invalid credentials, pending, expired, revoked, inaccessible, or unverified connections MUST NOT be operation-ready.
- **FR-021:** A connection belonging to another resource MUST fail before provider access.
- **FR-022:** Explicit connection pins MUST be checked against current links and grants.

### Readiness and evidence

- **FR-023:** Readiness MUST expose `configured`, `credentials_present`, `authorized`, `reachable`, `schema_verified`, and `operation_ready` independently.
- **FR-024:** Every dimension MUST include status, checked time, evidence reference, expiry, and public blocker when false or unknown.
- **FR-025:** Indexed evidence MUST include source, observed/verified time, verification state, schema fingerprint, expiry, and supersession state.
- **FR-026:** Live evidence MUST override indexed evidence for execution decisions.
- **FR-027:** Expired evidence or schema drift MUST force revalidation.
- **FR-028:** Legacy `active` or `ready` booleans MAY remain for compatibility but MUST NOT be execution authority.

### Tool callability and projection

- **FR-029:** A tool MAY be shown callable only when descriptor, active export, callable route, effective authority, current readiness, certification, mutation policy, and required readback agree.
- **FR-030:** Admin-only or shadow-only tools MUST NOT appear as executable Tenant tools.
- **FR-031:** Projected descriptors MUST include `callable_now`, `blocked_reason`, `authority_source`, `readiness_checked_at`, and optional `fallback_tool`.
- **FR-032:** Projection drift MUST create a typed blocking gap and observability signal.

### Questionnaire

- **FR-033:** Questions MUST derive from the selected action schema plus Brand, activity, and resource context.
- **FR-034:** The system MUST ask only missing fields and preserve verified values across turns.
- **FR-035:** Options MUST state evidence class: `live_verified`, `indexed_verified`, `inferred_only`, or `blocked`.
- **FR-036:** Localized labels MAY vary while stable internal keys remain fixed.
- **FR-037:** Sensitive/internal schema fields MUST NOT become user questions.
- **FR-038:** Schema drift MUST invalidate only affected answers.

### Contradiction detection

- **FR-039:** Every next-action recommendation MUST be compared with the current operating snapshot.
- **FR-040:** Healthy enabled devices MUST suppress install/reinstall recommendations when they satisfy the request.
- **FR-041:** Recommendations conflicting with authority, resource state, operation state, or verified completion MUST be suppressed or replaced.
- **FR-042:** Suppression MUST record a no-secret reason code.

### Preview and operation lifecycle

- **FR-043:** Mutations MUST preview target, exact connection, effect, changed fields, authority, approvals, idempotency, quota/audit requirements, and readback plan.
- **FR-044:** Preview MUST perform no provider mutation.
- **FR-045:** Approval MUST bind actor, ECE, action, resource, request hash, effect, and expiry.
- **FR-046:** Execution MUST use the operation orchestrator; routes and agents MUST NOT call providers directly.
- **FR-047:** Provider acknowledgement MUST be distinct from verified success.
- **FR-048:** Unknown provider outcome MUST permit reconciliation/readback only and forbid blind retry.
- **FR-049:** Retry MUST revalidate current evidence and reuse operation/idempotency state where safe.
- **FR-050:** Successful mutation MUST produce same-cycle readback or explicit unverified state.

### Resource-scoped grants

- **FR-051:** Grants SHOULD support Brand, Site, App, Workflow, Campaign, Asset, Project, and Workspace scopes where modeled.
- **FR-052:** Brand access MUST NOT widen to Workspace scope without informed approval.
- **FR-053:** Preview MUST display direct and inherited access.
- **FR-054:** Grant creation MUST be idempotent and read back from the effective-grant view.
- **FR-055:** Existing broader access MUST be detected before duplicate grant creation.

### Domain coverage

- **FR-056:** WordPress MUST resolve site, content type, taxonomy, fields, draft/publish authority, and object readback.
- **FR-057:** Ads MUST resolve provider profile, account, campaign capability, budget/quota authority, approval, and spend/status readback.
- **FR-058:** CRM MUST resolve object, pipeline/stage, field schema, ownership, authority, and record revision readback.
- **FR-059:** Analytics MUST resolve data source, metric/dimension schema, date range, freshness, and evidence.
- **FR-060:** Workflow inspect, preview, activate, deactivate, and run MUST remain distinct capabilities.
- **FR-061:** Device operations MUST validate ownership, health, heartbeat, capability support, consent, and readback.
- **FR-062:** Future providers MUST enter through the same capability, schema, readiness, authority, preview, and readback contract.

### Support and customer-safe output

- **FR-063:** Blocked operations MUST return a stable operation reference and missing requirements.
- **FR-064:** Support tickets MUST link operation, capability, resource, and evidence references without secrets.
- **FR-065:** Similar reports SHOULD deduplicate into an existing ticket while preserving history.
- **FR-066:** After remediation, the original operation MUST be retryable without restating valid context.
- **FR-067:** Tenant responses MUST use localized customer-safe messages and stable public codes only.
- **FR-068:** Arabic labels, questions, errors, and previews MUST be supported independently from technical keys.

### API, architecture, observability, and rollout

- **FR-069:** Public contracts MUST use OpenAPI 3.1 and structured error envelopes.
- **FR-070:** Interfaces MUST delegate to application services; domain policy MUST NOT depend on transport or provider SDKs.
- **FR-071:** Provider adapters MUST receive a pre-authorized, resource-bound execution context.
- **FR-072:** Responses MUST be bounded and return durable detail references for large diagnostics.
- **FR-073:** Metrics MUST cover resolution latency, clarification, inferred options, contradiction suppression, stale evidence, wrong-resource blocks, projection drift, verified execution, and retry success.
- **FR-074:** Existing Tenant tools and questionnaires MUST remain compatible during shadow comparison.
- **FR-075:** Rollout and rollback MUST be per-capability and per-Tenant.
- **FR-076:** No cutover is permitted until isolation, projection, schema, preview, approval, readback, localization, and regression tests pass.

## Success criteria

- No executable recommendation lacks an ECE.
- Zero cross-Brand or cross-resource connection selection in the acceptance matrix.
- `metadata_only` and invalid credentials never produce operation-ready.
- Brand-scoped invitations never widen silently to Workspace.
- WordPress options match verified content types/schemas or remain inferred.
- Healthy existing devices suppress reinstall guidance.
- Tenant output contains no secrets, internal tables, foreign identifiers, or raw upstream errors.
- Every mutation cohort has preview, approval policy, idempotency, and certified readback.
- Support retry resumes the original operation context.
- Shadow comparison records no unexplained new allow before cutover.
