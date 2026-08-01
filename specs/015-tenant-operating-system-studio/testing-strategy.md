# Testing Strategy

## 1. Contract tests

Validate:

- package, installation, lifecycle, and convergence JSON Schemas;
- OpenAPI 3.1 parsing and operation identity uniqueness;
- manifest file inventory;
- requirement/task/acceptance/operation references;
- no duplicate canonical keys;
- no dependency, component, lifecycle, entity, or workflow cycles;
- no secret-like fields or values in definitions and fixtures;
- no unrestricted executable code or network expressions.

## 2. Domain and state-machine tests

- package lifecycle transitions;
- installation lifecycle transitions;
- installation revision immutability;
- lifecycle state/transition validation;
- expected-state/version conflicts;
- terminal-state recovery restrictions;
- upgrade and rollback transitions;
- delegation and handover transitions.

## 3. Compiler determinism tests

For identical package, component, profile, override, binding, policy, and context revisions:

- normalized output bytes are identical;
- lineage order is canonical;
- context/compilation hash is identical;
- conflict ordering is stable;
- no current clock or unordered provider response affects compilation.

## 4. Compatibility tests

- optional additive entity field;
- required field addition;
- field type change;
- relationship cardinality change;
- lifecycle state removal/rename;
- transition guard/effect change;
- workflow input/output change;
- form field/handler change;
- file retention/sharing policy tightening;
- AI output schema/model-policy change;
- package dependency range change;
- local override/extension conflict;
- fork behavior after upstream update.

## 5. Security tests

- cross-Tenant, cross-Workspace, cross-Brand, wrong-installation, and wrong-resource denial;
- caller-supplied scope cannot override principal authority;
- package/UI/form visibility does not grant operation authority;
- revoked delegation denies before file/provider/credential resolution;
- tenant package cannot remove mandatory platform policy;
- package export/fork excludes credentials, grants, signed URLs, runtime records, and client data;
- AI cannot publish, activate, grant, share, spend, deploy, or delete;
- prompt injection in uploaded package documentation remains untrusted content;
- marketplace package provenance/signature failure blocks installation.

## 6. Agency/client isolation tests

Test two client Brands and two client-owned Tenants:

- same package key with different installation IDs;
- independent records, files, queues, search, embeddings, reports, budgets, recipients, connections, prompts/results, and approvals;
- agency portfolio uses allowlisted summaries only;
- copied form/client links cannot cross scope;
- client operation continues after agency revocation;
- former agency principal is denied after revocation.

## 7. Forms and client-link tests

- dynamic options use authorized target records;
- internal IDs hidden from client UI;
- prefill context signed/bound and non-overridable;
- duplicate submissions are idempotent;
- expired/revoked links fail safely;
- partial handler failure does not lose raw accepted submission;
- mobile Arabic RTL and accessibility behavior.

## 8. File-policy tests

- original preservation;
- deterministic naming and collision sequence;
- MIME/extension mismatch;
- checksum and exact duplicate;
- semantic duplicate candidate without deletion;
- restricted/quarantine routing;
- personal/shared storage authority mismatch;
- rename/move/share/delete/restore idempotency and readback;
- cross-client folder and shortcut isolation.

## 9. AI tests

- structured output schema validity;
- semantic invalid values;
- unsupported component/action proposal;
- hallucinated authority or provider readiness;
- sensitive-data policy and manual fallback;
- budget/rate limit/provider outage;
- model/prompt/schema/policy lineage;
- Arabic/mixed-language golden set;
- deterministic non-AI validators remain source of truth.

## 10. Generated surface tests

- table/detail/form/kanban/calendar/timeline/queue/dashboard/portal/report rendering;
- field/action allowlists;
- empty, pending, failed, blocked, stale, and not-applicable states;
- server-side denial independent of UI;
- Arabic RTL and English;
- 360px, 390px, tablet, desktop;
- WCAG 2.2 AA automated and manual evidence;
- surface-catalog and mounted-route parity.

## 11. Installation E2E journeys

### Journey A — Freelancer

```text
create package draft
→ add entities/forms/lifecycle/workflow/UI
→ validate
→ sandbox
→ publish private
→ install for own Brand
→ activate
→ operate
→ upgrade
→ rollback
```

### Journey B — Agency with two clients

```text
publish agency package
→ install Client A
→ install Client B
→ distinct overrides/connections
→ operate both
→ attempt cross-client access
→ upgrade one only
→ export Client A handover
```

### Journey C — Client-owned Tenant

```text
client installs package
→ grants agency delegation
→ agency operates
→ prepare handover
→ client operator test
→ revoke agency
→ verify continuity and denial
```

### Journey D — Evidence Intelligence Pack

Intake, file, AI/manual review, review decision, downstream link, failure recovery.

### Journey E — Retail Commerce Pack

Profile/Blueprint resolution and sandbox-only package composition, without enforcing retail components on unrelated packages.

## 12. Reliability tests

- worker crash and lease expiry;
- duplicate outbox/callback;
- unknown provider outcome;
- disabled Redis/queue degradation where supported;
- stale cache/profile/package invalidation;
- partial migration and rollback;
- backup/restore;
- package publisher suspension/retirement;
- high-volume compile/list/search/portfolio projections;
- bounded fan-out, schedule, quota, and cost limits.

## 13. Evidence requirements

Every result binds:

```text
repository and exact candidate SHA
package key/version/hash
installation ref/revision/context hash
component/policy/profile/connection revisions
suite/case version
environment and effect class
result and reason codes
canonical evidence refs
secrets_included = false
```

A test run against one installation, package version, branch, or environment cannot certify another.