# Agency, Freelancer, Client, and Brand Ownership Contracts

## 1. Purpose

Define how freelancers, agencies, consultancies, and service companies create reusable systems for clients without confusing package ownership, installation ownership, business-data ownership, file ownership, provider ownership, or delegated operating authority.

## 2. Supported operating models

## Model A — Clients as Brands inside an agency Tenant

```text
Tenant: Agency
├─ Workspace: Strategy
├─ Workspace: Delivery
├─ Brand: Client A
├─ Brand: Client B
└─ Brand: Client C
```

Use when the agency contractually operates and hosts the client system inside its own Tenant.

Requirements:

- each client Brand has exact resource boundaries;
- every package installation is Brand-bound;
- client data, files, connections, prompts/results, queues, reports, budgets, and approvals are independent;
- Workspace defaults may be reused only where explicitly inheritable;
- no connection, Drive root, recipient, provider account, or report audience silently falls back across Brands;
- client portal access resolves one exact Brand and installation.

## Model B — Client-owned Tenant with agency delegation

```text
Tenant: Client
└─ Workspace / Brand / Package Installation
   └─ delegated agency operators
```

Use when the client must retain direct ownership and continuity.

Requirements:

- the client owns Tenant, Workspace/Brand, installation, business data, and client-owned connections;
- agency access uses explicit delegated grants;
- grants identify capability, exact target resource, environment/effect class, validity window, and constraints;
- revocation blocks future operations before credential/resource resolution;
- agency removal does not suspend the system unless the package depends on agency-owned non-transferable services;
- handover reports identify those dependencies before contract end.

## Model C — Shared-by-agreement package, client-owned installation

An agency retains package intellectual property while the client owns the installation and data.

Requirements:

- package publication terms define install/use/upgrade/export rights;
- package source may remain private while normalized contracts and installed version remain auditable;
- expiration of a commercial agreement cannot silently delete client data or historical operation;
- continuity rules specify whether the installed version remains operable, enters support-ended mode, or requires migration.

## Model D — Client-specific fork

A client-specific package fork is owned according to explicit agreement.

Requirements:

- immutable origin lineage;
- separate publication and support policy;
- no automatic upstream rewrite;
- mandatory platform security remains inherited;
- transfer/export classification is explicit.

## 3. Ownership dimensions

The platform MUST store these dimensions independently:

| Dimension | Example owner |
|---|---|
| Package definition/IP | Agency Tenant |
| Package publication | Agency or platform policy |
| Package installation | Client Tenant or agency Brand |
| Business records | Installation owner/client contract |
| Files | Exact Drive/storage authority |
| Provider account | Client, agency, or platform-managed account |
| Connection/credential | Exact owner scope and provider binding |
| Workflow execution | Current authorized principal and resource authority |
| Generated deliverable | Contract-defined client/agency ownership |
| Audit evidence | Platform/installation retention policy |
| AI prompt template | Package publisher |
| AI result | Installation/business-data policy |

No ownership dimension is inferred from another.

## 4. Delegation contract

A delegated agency relationship declares:

```text
delegation_id
source_tenant_or_agency_ref
target_tenant_ref
target_workspace_ref
target_brand_refs[]
principal_or_group_refs[]
capability_keys[]
resource_selectors[]
environment_effect_classes[]
approval_requirements
valid_from / valid_until
revocation_policy
status
revision
audit_ref
```

Delegation never carries credentials. It only permits a principal to request operations through normal context, capability, policy, approval, and readback gates.

## 5. Portfolio views

Agency portfolio projections MAY include allowlisted operational facts such as:

- installation health;
- overdue review count;
- unresolved blockers;
- delivery status;
- budget consumption summary;
- SLA summary;
- package version and upgrade state;
- consented KPI summaries.

They MUST NOT expose by default:

- raw client files;
- private messages;
- credentials or provider payloads;
- detailed financial/customer records;
- another client's prompts/results;
- cross-client search results;
- unrestricted report exports.

Every portfolio metric retains source Brand/Tenant, definition, freshness, confidence, and access classification.

## 6. Reusable defaults versus client-private state

Reusable across clients:

- package definitions and versions;
- generic schemas;
- role templates;
- workflow templates;
- lifecycle definitions;
- form templates;
- file-policy templates;
- prompt templates;
- report templates;
- sample data and tests;
- runbooks and documentation.

Never inherited across clients:

- records and submissions;
- files and evidence;
- provider connections and credentials;
- approvals and grants;
- client-specific prompts/results where classified private;
- recipients and contact lists;
- budgets and billing data;
- active operation/job state;
- audit payloads containing client content.

## 7. Client access

Client roles may include:

```text
client_owner
client_admin
client_operator
client_reviewer
client_approver
client_viewer
```

Role names are templates only. Actual authority derives from principal, membership/delegation, resource bindings, capabilities, constraints, policy, and exact installation context.

Client users must never be required to enter internal Tenant/Workspace/Brand/package IDs in ordinary forms or portals.

## 8. Handover and exit

Before agency access is ended, the system generates:

- active package/install/version inventory;
- package ownership and usage-rights summary;
- business-record and file inventory;
- provider/connection ownership matrix;
- delegated grants and pending approvals;
- active jobs, callbacks, schedules, and external sends;
- non-transferable dependencies;
- export/readback/backup status;
- client operator readiness and missing roles;
- recommended order of access revocation.

Safe order:

1. freeze new high-risk changes;
2. reconcile unknown outcomes;
3. complete backup/export/readback;
4. transfer or recreate client-owned connections;
5. grant client operators required authority;
6. test critical workflows under client principals;
7. revoke agency delegation;
8. verify system continuity and denial of former agency access;
9. close handover with evidence.

## 9. Required isolation tests

- agency operator authorized for Client A cannot list, search, fetch, mutate, export, or infer Client B resources;
- shared package key does not create shared runtime data partitions;
- copied prefilled form link cannot escape its assigned client context;
- client-owned connection cannot resolve from an agency-owned Brand;
- agency portfolio query applies per-client field allowlists;
- revoked delegation denies before file/provider/credential access;
- changing package publisher or support status does not change client data ownership;
- fork and export contain no grants, credentials, client records, or signed URLs;
- handover preserves operation using client principals after agency revocation.