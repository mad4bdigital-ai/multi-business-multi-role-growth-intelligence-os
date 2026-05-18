# Local Development Documents Review - 2026-05-18

Source path reviewed read-only:

`D:\Nagy\Multi-Business-Multi-Role-Growth-Intelligence-OS\Development`

The local connector exposed this path on host `Essam`. The auth-host device facade returned a temporary 502, so the review used the direct local connector PowerShell read path. No local files were written or changed.

## Files reviewed

Top-level documents and spreadsheets:

- `Multi-Business, Multi-Role Growth Intelligence OS.docx`
- `Human Layer Migration.docx`
- `New plan Universal Governed Execution Adaptation Plan.docx`
- `Actor Role backend code-path enforcement.docx`
- `comparison matrix with columns for input style, inference level, sync_async behavior, required fields, and ideal use cases_.docx`
- `كيف سيتعامل المستخدم مع واجهة تطبيق الويب؟.docx`
- `الفكرة التي كتبتها قوية جدًا، لكنها تحتاج إعادة تنظيم طبقي حتى لا تختلط عند التنفيذ بين_.docx`
- `report.docx`
- `tracking report.docx`
- `الخدمات الرئيسية لمنصة MAD4B.docx`
- `خطة عمل مشروع MAD4B.docx`
- `نموذج خدمات MAD4B.docx`
- `نموذج عمل مشروع MAD4B.docx`
- `Businesses Models.xlsx`
- `جدول بيانات بدون عنوان.xlsx`

Subfolder reviewed:

`Governed-AI-Human-Managed-Platform`

Important packages:

- `governed_ai_human_managed_platform_complete.zip`
- `governed_ai_human_managed_platform_blueprint.zip`
- `governed_ai_human_managed_platform_engineering_kit.zip`
- `governed_ai_human_managed_platform_repo_starter.zip`
- phase packs through `phase111`

## Core conclusion

The local material changes the recomposition target from only:

> multi-business + governed execution

into:

> multi-business + multi-role + tenant scoped + commercial entitlement aware + human oversight capable + governed prompt-to-run execution.

Tourism remains legacy/activity-specific, not the platform default.

## High-value concepts extracted

### 1. Multi-business, multi-role operating system

The system is described as a governed multi-tenant prompt-to-run orchestration platform for business tools, business data, measurement systems, reporting, and AI agents.

Important implications:

- `business_activity_types` is not enough by itself.
- Activity resolution must be layered with tenant type, actor role, brand scope, client scope, service mode, entitlement, and workflow risk.
- Execution must not be allowed only because an activity/workflow exists.

### 2. Parent / child / specialization logic

The Arabic layered design document emphasizes:

- Parent logic is general authority.
- Child logic is specialization.
- Child logic may specialize by industry/activity, business model, brand, actor role, or execution persona.
- No child or brand-specific logic may silently override parent governance.
- Overrides require adaptation records.

Platform implication:

`business_activity_type_key` must be first, but not the only selector. Add compatibility checks among:

- parent logic family
- child/specialization logic
- business model adaptation
- actor/execution role
- brand path
- engines
- workflow variant

### 3. Human oversight and assisted operations

`Human Layer Migration.docx` and the governed platform packages describe a formal human layer:

- reviewer
- auditor
- supervisor
- managed operator
- trainee/certified/senior reviewer ladder
- review assignment
- escalation
- approval
- assisted service packages
- managed execution

This is not cosmetic UI. It is a runtime and commercial layer.

Platform implication:

Review should not be a boolean only. It should resolve:

- review type
- required assistance role
- assignment queue
- SLA/entitlement
- approval hold
- escalation path
- output validation record

### 4. Service modes

The zipped complete platform pack defines service modes:

- `self_serve`
- `assisted`
- `managed`

Mode classifications:

- `self_serve_capable`
- `assistance_optional`
- `assistance_recommended`
- `assistance_required_by_policy`
- `managed_service_only`

Platform implication:

Every feature/workflow/package should carry service mode eligibility, not just execution class.

### 5. Tenant and persona types

The complete pack defines tenant types:

- `platform_owner`
- `partner_organization`
- `freelancer_operator`
- `managed_client_account`
- `brand`

Personas include:

- platform admin
- partner admin
- freelancer owner
- managed client admin
- brand admin/user
- reviewer / auditor / supervisor

Platform implication:

Access control must evaluate tenant relationship and actor role, not only backend admin/user JWT.

### 6. Access and scope model

The access model requires decision factors:

- actor identity
- role
- tenant scope
- governance level
- commercial eligibility
- connector installation/permission
- sensitive action policy
- assistance or managed service mode

Scope dimensions:

- tenant
- partner/child
- freelancer
- client
- brand
- review
- supervision
- managed service

Policy: deny-by-default when mismatch exists.

### 7. UI implications

The UI document says web interaction should route user requests through:

1. actor role extraction;
2. governance level resolution;
3. brand/client scope resolution;
4. access gate;
5. route/workflow/action/endpoint dispatch;
6. execution status, review, approvals, and history.

Platform implication:

The backend must enforce the gate before dispatch. UI visibility alone is insufficient.

### 8. Execution architecture risk

The Universal Governed Execution Adaptation Plan emphasizes:

- freeze execution contract;
- route/workflow/action identity resolution;
- governed writeback through logical surfaces;
- model/provider portability;
- no path tied to one GPT/provider;
- execution.js structural decision;
- route-level CI coverage;
- writeback verification.

Platform implication:

Our clean staging should explicitly classify `execution.js` and shared runtime dispatch paths as promotion blockers until wired/tested.

## DB comparison snapshot

Relevant DB surfaces already exist partially:

| Surface/table | Current status |
|---|---|
| `tenants` | populated |
| `role_assignments` | partially populated |
| `assistance_roles` | populated |
| `approval_holds` | empty |
| `entitlements` | empty |
| `tenant_relationships` | empty |
| `admin_scope_grants` | empty |

Interpretation:

The human/role/tenant/commercial layer has DB scaffolding, but the runtime path is not yet fully operational. It should be staged as `validating`, not `active`, until route enforcement, entitlement checks, review assignment, approval holds, and readback are connected.

## Required updates to staging contracts

The clean staging files should include these explicit state families:

1. `multi_business_activity_state`
2. `tenant_role_access_state`
3. `service_mode_state`
4. `human_oversight_state`
5. `commercial_entitlement_state`

## Decision impact

Before answering whether `business_activity_type_key` should be required for every business-facing workflow, the answer must account for a richer gate:

A business-facing workflow should not only require activity. It should require the minimum viable context envelope:

- activity
- tenant
- actor role
- service mode
- entitlement when commercial limits apply
- brand/client scope when scoped
- human review/approval route when policy requires it

## Recommended classification

- Multi-business activity resolution: required for business-facing outputs.
- Tenant/actor/scope access gate: required before execution.
- Service mode classification: required before offering or dispatching workflow.
- Human oversight: conditionally required by workflow risk, package, or entitlement.
- Commercial entitlement: required for paid/limited/managed features.

## Promotion warning

Do not promote the current staging layer until these local-development concepts are reflected in the clean schema and bootstrap/router/loader contracts.
