# Platform Plugin governance roadmap checkpoint — 2026-05-28

## Current checkpoint

The Platform Plugin governance track is complete through Phase 44.

Current live status:

```text
main CI: success
OpenAPI Auto Sync: success
Hostinger: auto deploy from main
CRM sample dispatch: HTTP 200 OK
policy queue: healthy
policy rollback/history: verified live
secrets_included=false
```

Reference live sample:

```text
plugin_key: tenant.nagy_sample_crm_20260525
action_key: crm.contact.list
tenant_id: e989a841-fce0-4ced-be76-463e8202a066
user_id: 0e76b224-7671-47dd-ad68-014fb042df80
mock_provider: crm
mock_resource: contacts
smoke target: /platform/mock-providers/crm/contacts
```

## Completed phases

| Phase | Status | Result |
|---|---:|---|
| 31 | Complete | Action manifest diagnostic/admin route. |
| 32 | Complete | Execution authority platform graph projection and validation. |
| 33 | Complete | Full execution readiness dry-run with brand/business/skill/graph checks. |
| 34 | Complete | Guarded plugin REST dispatch with readiness enforcement and endpoint registry fallback. |
| 35 | Complete | Controlled provider smoke gate: expected origin, GET-only, no body, no secrets. |
| 36 | Complete | Platform-owned CRM smoke target returning 200 OK. |
| 37 | Complete | Reusable mock provider harness under `/platform/mock-providers`. |
| 38 | Complete | Smoke certification registry and certification/status tools. |
| 39 | Complete | Smoke certification enforced before dispatch readiness and promotion. |
| 40 | Complete | Certification expiry and dispatch-time drift guard. |
| 41 | Complete | Recertification queue and bounded dry-run-first batch runner. |
| 42 | Complete | Recertification policy registry with effective-policy resolution. |
| 43 | Complete | Policy upsert governance audit with before/after and changed fields. |
| 44 | Complete | Policy history, rollback preview, and confirmed rollback apply. |

## Architecture now in place

```text
plugin/action registry
→ action manifest diagnostic
→ execution readiness dry-run
→ plugin resolver
→ credential / connection / skill / action grant checks
→ smoke certification gate
→ expiry and drift checks
→ provider smoke / dispatch
→ execution_log evidence
→ recertification queue
→ policy-regulated recertification batch
→ policy audit/history/rollback
```

## Remaining objective

The foundation is complete. Remaining work is governance hardening, private-path parity, inventory coverage, and real-provider onboarding.

The 2026-05-31 recovery and resource-authority checkpoint adds a broader requirement: platform plugins must model evidence-backed recovery, retry, conflict handling, and resource authority before writes to tenant, user, brand, or external resources. See `docs/platform-governance-recovery-resource-authority-2026-05-31.md`.

## Next planned phases

### Phase 45 — Policy diff and approval hold before risky changes

Add approval hold for risky policy fields instead of immediate apply.

Risky fields:

```text
auto_recertification_enabled
allowed_expected_origin
max_batch_size
provider_smoke_required
status
large certification_ttl_days changes
```

Expected result:

```text
approval_required=true
approval_hold_id
diff_summary
risk_level
```

Apply should require approval evidence or an explicit privileged override.

### Phase 46 — Private plugin dispatch certification parity

Bring the same smoke/certification/expiry/drift controls to the private contribution dispatch path:

```text
platform_plugin_contribution_private_dispatch_rest
```

Required result:

```text
private contribution dispatch cannot execute without scoped smoke certification evidence
private contribution promotion cannot bypass private smoke proof
```

### Phase 47 — Active plugin certification inventory

Scan all active `app_integrations` / action bindings and produce a certification coverage report:

```text
certified
expired
missing
blocked_by_drift
preview_only
eligible_for_mock_smoke
needs_real_provider_smoke
```

### Phase 48 — Real provider onboarding template

Create a repeatable onboarding template for real providers:

```text
connection intake
safe read-only smoke endpoint
auth validation without secret exposure
provider-specific policy
certification and recertification schedule
rollback plan
```

### Phase 49 — Production CRM provider smoke

Replace the sample mock target with a real CRM provider target under the same guards:

```text
real provider base URL
read-only contact/list smoke
expected-origin guard
provider smoke 200 OK
real-provider certification row
```

### Phase 50 — Promotion gate full coverage report

Generate a final report that proves:

```text
all promotable plugin actions have smoke certification
uncertified actions are preview_only
private and public paths follow parity rules
policy changes are audited or approval-held
```

## Definition of done for the full track

The full track is done when:

1. Risky policy changes require approval hold.
2. Public and private plugin dispatch paths have smoke certification parity.
3. All active plugin/action bindings have a coverage state.
4. At least one real provider has a successful smoke certification.
5. Promotion cannot bypass certification or approval.
6. Recertification queue/batch are policy-governed and auditable.
7. Rollback remains confirmed, audited, and secret-free.

## Documentation pointers

- `docs/platform-governance-recovery-resource-authority-2026-05-31.md`
- `docs/ai-intelligence-runtime-plan-checkpoint-2026-05-31.md`
- `docs/recovery-capability-taxonomy-foundation.md`
- `docs/resource-authority-registry-foundation.md`
- `docs/platform-plugin-smoke-certification-governance.md`
- `docs/platform-plugin-recertification-policy-governance.md`
- `docs/platform-plugin-promotion.md`
- `docs/platform-plugin-private-rest-dispatch.md`
- `docs/platform-plugin-contribution-intake.md`
